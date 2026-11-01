'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { THD75Connection } = require('../src/protocol/connection');

/** Mock serial transport: captures writes, lets tests inject RX bytes. */
class MockTransport extends EventEmitter {
  constructor() {
    super();
    this.written = [];
  }
  write(s) { this.written.push(s); }
  rx(s) {
    const buf = Buffer.from(s, 'latin1');
    this.emit('data', buf);
  }
  close() { this.emit('close'); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('frames are CR-terminated and queued with pacing', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('ID');
  await sleep(10);
  assert.deepStrictEqual(t.written, ['ID\r']);
  t.rx('ID TH-D75\r');
  assert.strictEqual(await p, 'TH-D75');
  assert.strictEqual(c.state.model, 'TH-D75');
});

test('partial frames across data chunks are reassembled', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('FV');
  await sleep(10);
  t.rx('FV 1.0');
  t.rx('0\rF');
  t.rx('V xyz\r');
  assert.strictEqual(await p, '1.00');
  assert.strictEqual(c.state.firmware, 'xyz');
});

test('FQ response updates band frequency (10 Hz units)', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('FQ', ' 0');
  await sleep(10);
  t.rx('FQ 0,0145000000\r');
  await p;
  assert.strictEqual(c.state.aBand.frequencyHz, 145000000); // 145.000 MHz in Hz
  assert.strictEqual(c.state.subBand, false);
});

test('setFrequency wire format matches original (D10, band,payload)', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.setFrequency(1, 430000000); // 430.000 MHz
  await sleep(10);
  assert.strictEqual(t.written[0], 'FQ 1,0430000000\r');
  t.rx('FQ 1,0430000000\r');
  await p;
  assert.strictEqual(c.state.bBand.frequencyHz, 430000000);
});

test('setStep encodes Hz value as uppercase hex', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  c.setStep(0, 0).catch(() => {}); // 5 kHz -> 0x1388
  await sleep(10);
  assert.strictEqual(t.written[0], 'SF 0,1388\r');
});

test('SM response updates s-meter and busy', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('SM', ' 1');
  await sleep(10);
  t.rx('SM 1,7\r');
  await p;
  assert.strictEqual(c.state.bBand.sMeter, 7);
});

test('? resolves the oldest waiter as a pulse (never an error)', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('MD', ' 9', { timeout: 40 });
  await sleep(10);
  t.rx('?\r');
  assert.strictEqual(await p, null); // pulse, no rejection
});

test('single-char frame (N / ?) resolves the oldest waiter like the original', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('FQ', ' 1,0446043750');
  await sleep(10);
  t.rx('N\r');
  assert.strictEqual(await p, null); // accepted, no echo payload
});

test('wake byte is sent when a waiter is still pending', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('ID', '', { timeout: 2000 });
  await sleep(10);
  t.written.length = 0;
  await sleep(120); // > WAKE_DELAY_MS
  assert.ok(t.written.includes('\r'), 'bare CR wake expected');
  t.rx('ID TH-D75\r');
  assert.strictEqual(await p, 'TH-D75');
});

test('timeout rejects waiter', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('ID', '', { timeout: 30 });
  await assert.rejects(p, /Timeout/);
});

test('enterControlMode sends the raw probe sequence', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  await c.enterControlMode();
  assert.deepStrictEqual(t.written, ['\r', '\r', '\x03\r', '\rTC 1\r', '\r\r']);
});

test('async AI frames patch state without a waiter', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const events = [];
  c.on('state', (s, cmd) => events.push(cmd));
  t.rx('BY 1,1\r'); // band B busy
  t.rx('MD 1,9\r'); // band B DV
  assert.strictEqual(c.state.bBand.busy, true);
  assert.strictEqual(c.state.bBand.mode, 9);
  assert.deepStrictEqual(events, ['BY', 'MD']);
});

test('AG/FS/UP/DW use fixed-width indices', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  c.setVolume(2).catch(() => {});
  c.setFineStep(3).catch(() => {});
  c.tuneUp(4).catch(() => {});
  c.tuneDown(0).catch(() => {});
  await sleep(40);
  assert.deepStrictEqual(t.written, ['AG 002\r', 'FS 3\r', 'UP 004\r', 'DW 000\r']);
  t.rx('AG 001\r');
  await sleep(5);
  assert.strictEqual(c.state.audioGain, 1);
  t.rx('FS 2\r');
  await sleep(5);
  assert.strictEqual(c.state.fineStep, 2);
});

test('port close rejects all pending', async () => {
  const t = new MockTransport();
  const c = new THD75Connection(t);
  const p = c.request('PS');
  await sleep(10);
  t.close();
  await assert.rejects(p, /Port closed/);
});
