'use strict';
/**
 * TH-D75 CAT protocol engine, ported from ARFC-D75 (a/p.cs transport,
 * a/u.cs command layer, a/t.cs response parsers).
 *
 * The engine is transport-agnostic: give it anything with
 * `write(str)` and `on('data', (buf) => ...)`.
 */

const {
  BAND, MODE, STEPS_HZ, FINE_STEPS_HZ, TUNE_STEPS, IO_MODE, VFO_MODE,
  REGIONS, CR, ENTER_CONTROL_SEQUENCE, MIN_COMMAND_GAP_MS, RESPONSE_TIMEOUT_MS,
} = require('./commands');

const { EventEmitter } = require('events');

/** Delay before poking the radio with a bare CR to flush a queued reply. */
const WAKE_DELAY_MS = 80;

/** Command table: wire command -> { parse(payload) -> patch, event } */
const PARSERS = {
  // Live-verified: value is HERTZ (FQ 0,0144800000 = 144.800 MHz).
  FQ: (p) => ({ band: +p[0], frequencyHz: Number.parseInt(p.substr(2, 10), 10) }),
  MD: (p) => ({ band: +p[0], mode: +p[2] }),
  VM: (p) => ({ band: +p[0], vfoMode: +p[2] }),
  RA: (p) => ({ band: +p[0], attenuator: +p[2] }),
  SF: (p) => {
    // Radio answers with the step INDEX, not the Hz value (live-verified).
    const idx = Number.parseInt(p.substr(2), 10);
    return { band: +p[0], stepIdx: idx, stepHz: STEPS_HZ[idx] };
  },
  SH: (p) => ({ filter: +p[0], filterLevel: +p[2] }),
  SM: (p) => ({ band: +p[0], sMeter: +p[2] }),
  BY: (p) => ({ band: +p[0], busy: +p[2] === 1 }),
  TN: (p) => ({ tncMode: +p[0], dataBand: +p[2] }),
  BC: (p) => ({ band: +p[0], beatCancel: +p[2] }),
  AG: (p) => ({ audioGain: +p.substr(0, 3) }),
  VX: (p) => ({ vox: +p === 1 }),
  BT: (p) => ({ batteryType: +p }),
  BL: (p) => ({ batteryLevel: +p }),
  BS: (p) => ({ batteryStatus: +p }),
  FS: (p) => ({ fineStep: +p[0] }),
  FT: (p) => ({ fine: +p[0] === 1 }),
  FR: (p) => ({ fmRadio: +p[0] === 1 }),
  DL: (p) => ({ singleBand: +p[0] }),
  IO: (p) => ({ ioMode: +p[0] }),
  GP: (p) => ({ gps: +p[0] === 1, gpsPcOutput: +p[2] === 1 }),
  PS: (p) => ({ power: +p }),
  ID: (p) => ({ model: p }),
  FV: (p) => ({ firmware: p }),
  TY: (p) => ({ region: p[0], regionName: REGIONS[p[0]] || 'Unknown' }),
  GW: (p) => ({ dvGateway: +p }),
  AI: (p) => ({ aiInformation: +p }),
  // PTT confirmations (hamlib thd74 semantics: bare TX keys up, RX unkeys;
  // the echo carries the current TX band).
  TX: (p) => ({ transmitting: true, txBand: Number.parseInt(p, 10) }),
  RX: () => ({ transmitting: false }),
};

const BAND_KEY = (b) => (b === BAND.A ? 'aBand' : 'bBand');

class THD75Connection extends EventEmitter {
  constructor(transport) {
    super();
    this.transport = transport;
    this.rxBuffer = '';
    this.lastSendAt = 0;
    this.pending = []; // { cmd, resolve, reject, timer }
    this.busy = false;
    this.queue = [];
    this.state = freshState();
    this.log = [];
    // Radio answers the raw handshake frames with delayed '?' frames; the
    // original client never waits for them. Drop '?' while settling.
    this.rejectGraceUntil = 0;

    transport.on('data', (buf) => this._onData(buf));
    transport.on('close', () => this._onClose());
    transport.on('error', (err) => this.emit('error', err));
  }

  // ------------------------------------------------------------------ rx

  _onData(buf) {
    // ISO-8859-1: bytes map 1:1 to U+0000..U+00FF.
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    this.rxBuffer += s;
    let idx;
    while ((idx = this.rxBuffer.indexOf(CR)) !== -1) {
      const frame = this.rxBuffer.slice(0, idx);
      this.rxBuffer = this.rxBuffer.slice(idx + 1);
      if (frame.length > 0) this._onFrame(frame);
    }
  }

  _onFrame(frame) {
    this._pushLog('rx', frame);
    if (frame.length === 1) {
      // Live-verified: SET commands are answered with a single-char frame
      // ('N', or '?' for raw/wake frames) instead of a command echo. The
      // original client treats ANY single-char frame as a wake-up pulse
      // for the oldest waiter, and so do we.
      const w = this._takeOldestPending();
      if (w) w.resolve(null);
      return;
    }
    if (frame.length < 2) return;
    const cmd = frame.slice(0, 2);
    const payload = frame.length > 2 ? frame.slice(3) : '';
    const parser = PARSERS[cmd];
    if (parser) {
      try {
        const patch = parser(payload);
        this._applyPatch(cmd, patch);
        this.emit('frame', cmd, payload, patch);
      } catch (err) {
        this.emit('warning', `Bad ${cmd} frame: ${JSON.stringify(frame)}`);
      }
    }
    const waiter = this._takePending(cmd);
    if (waiter) waiter.resolve(payload);
  }

  _applyPatch(cmd, patch) {
    if ('band' in patch && patch.band !== undefined) {
      const key = BAND_KEY(patch.band);
      const { band, ...rest } = patch;
      Object.assign(this.state[key], rest);
      this.state.subBand = patch.band === BAND.B;
    } else {
      Object.assign(this.state, patch);
    }
    this.emit('state', this.state, cmd, patch);
  }

  _takeOldestPending() {
    const [w] = this.pending.splice(0, 1);
    if (w) {
      clearTimeout(w.timer);
      if (w.wakeTimer) clearTimeout(w.wakeTimer);
    }
    return w;
  }

  _takePending(cmd) {
    if (cmd === null) {
      // '?' rejects the most recent outstanding request
      return this.pending.shift() || null;
    }
    const i = this.pending.findIndex((w) => w.cmd === cmd);
    if (i === -1) return null;
    const [w] = this.pending.splice(i, 1);
    clearTimeout(w.timer);
    if (w.wakeTimer) clearTimeout(w.wakeTimer);
    return w;
  }

  _onClose() {
    for (const w of this.pending) {
      clearTimeout(w.timer);
      w.reject(new Error('Port closed'));
    }
    this.pending = [];
    this.emit('close');
  }

  // ------------------------------------------------------------------ tx

  async _send(line) {
    const now = Date.now();
    const wait = this.lastSendAt + MIN_COMMAND_GAP_MS - now;
    if (wait > 0) await sleep(wait);
    this.lastSendAt = Date.now();
    this._pushLog('tx', line);
    this.transport.write(line + CR);
  }

  /** Send a raw line (no waiting for a response). */
  sendRaw(line) {
    return this._send(line);
  }

  /**
   * Send `CMD params`. params must already include the leading space.
   * Resolves with the response payload string, or null when nowait.
   * Sends are serialized with the 5 ms inter-command gap; waiters for
   * different commands may be outstanding at the same time, exactly like
   * the original `b` waiter collection in a/p.cs.
   */
  request(cmd, params = '', { wait = true, timeout = RESPONSE_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, params, wait, timeout, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    if (this.busy || this.queue.length === 0) return;
    this.busy = true;
    const job = this.queue.shift();
    const next = () => { this.busy = false; this._pump(); };
    this._send(job.cmd + job.params).then(() => {
      if (job.wait) {
        job.timer = setTimeout(() => {
          const i = this.pending.indexOf(job);
          if (i !== -1) this.pending.splice(i, 1);
          job.reject(new Error(`Timeout waiting for ${job.cmd}`));
        }, job.timeout);
        this.pending.push(job);
        // Live-verified: the radio processes its RX queue only when another
        // byte arrives, so poke it with a bare CR to flush the reply.
        job.wakeTimer = setTimeout(() => {
          if (this.pending.includes(job)) this.wake();
        }, WAKE_DELAY_MS);
      } else {
        job.resolve(null);
      }
    }).catch(job.reject)
      .finally(next);
  }

  /** Send a single CR to make the radio emit queued replies. */
  wake() {
    this._pushLog('tx', '(wake)');
    this.transport.write(CR);
  }

  // ------------------------------------------------------------- handshake

  /** Enter transceiver-control mode; mirrors a/u.r(). Delayed '?' replies
   *  to these raw frames are dropped for a grace period afterwards. */
  async enterControlMode() {
    for (const line of ENTER_CONTROL_SEQUENCE) {
      await this._send(line);
      await sleep(60);
    }
    this.rejectGraceUntil = Date.now() + 1200; // informational only
  }

  /**
   * Connect handshake, mirrors frmMainViewModel connect flow:
   * enter control mode, verify ID, refuse while DV gateway is active.
   */
  async connect() {
    await this.enterControlMode();
    const id = await this.getId();
    if (!id || !id.includes('TH-D75')) {
      this.emit('warning', `Unexpected radio identity: ${JSON.stringify(id)}`);
    }
    const gw = await this.request('GW');
    if (gw !== null && this.state.dvGateway !== 0 && !Number.isNaN(this.state.dvGateway)) {
      if (this.state.dvGateway !== 0) {
        throw new Error('DV gateway mode is active on the radio; disable it before connecting');
      }
    }
    return { id, state: this.state };
  }

  /**
   * Initial sync: read identity and full radio state (frmMainViewModel o()).
   * Live-verified against fw 1.03: every listed command except SH answers;
   * SH has no read form without parameters (the original never reads it on
   * connect), so it is skipped. A single command timing out degrades to a
   * warning instead of failing the connection.
   */
  async syncAll() {
    const reads = [
      ['TY'], ['PS'], ['FV'], ['AI'], ['RX'], ['FR'], ['GP'], ['TN'],
      ['DL'], ['BC'],
      ['FQ', ' 0'], ['FQ', ' 1'],
      ['MD', ' 0'], ['MD', ' 1'],
      ['VM', ' 0'], ['VM', ' 1'],
      ['RA', ' 0'], ['RA', ' 1'],
      ['SF', ' 0'], ['SF', ' 1'],
      ['AG'], ['FS'], ['FT'], ['IO'], ['VX'], ['BT'], ['BL'], ['BS'],
      ['BY', ' 0'], ['BY', ' 1'],
      ['SM', ' 0'], ['SM', ' 1'],
    ];
    for (const [cmd, params] of reads) {
      try {
        await this.request(cmd, params || '');
      } catch (err) {
        this.emit('warning', `sync: ${cmd} failed (${err.message})`);
      }
    }
    // Enable auto-information like the original so panel changes on the
    // radio itself stream to us. Fire-and-forget: never fails the connect.
    this.setAi(true).catch(() => {});
    return this.state;
  }

  // ------------------------------------------------------------ commands

  getId() { return this.request('ID'); }
  getFirmware() { return this.request('FV'); }
  getPower() { return this.request('PS'); }

  setAi(on) { return this.request('AI', ` ${on ? 1 : 0}`, { wait: false }); }

  /** frequencyHz: frequency in hertz, zero-padded to 10 digits. */
  setFrequency(band, frequencyHz) {
    return this.request('FQ', ` ${band},${String(frequencyHz).padStart(10, '0')}`);
  }

  getFrequency(band) { return this.request('FQ', ` ${band}`); }

  tuneUp(stepsIdx) { return this.request('UP', ` ${String(stepsIdx).padStart(3, '0')}`); }
  tuneDown(stepsIdx) { return this.request('DW', ` ${String(stepsIdx).padStart(3, '0')}`); }

  setMode(band, mode) { return this.request('MD', ` ${band},${mode}`); }
  getMode(band) { return this.request('MD', ` ${band}`); }

  /** stepIdx: index into STEPS_HZ; wire value is the Hz value as hex. */
  setStep(band, stepIdx) {
    const hz = STEPS_HZ[stepIdx];
    if (hz === undefined) throw new RangeError('bad step index');
    return this.request('SF', ` ${band},${hz.toString(16).toUpperCase()}`);
  }
  getStep(band) { return this.request('SF', ` ${band}`); }

  /** fineStepIdx: index into FINE_STEPS_HZ; wire value is the index. */
  setFineStep(fineStepIdx) { return this.request('FS', ` ${fineStepIdx}`); }
  setFine(on) { return this.request('FT', ` ${on ? 1 : 0}`); }

  setIoMode(mode) { return this.request('IO', ` ${mode}`); }
  getIoMode() { return this.request('IO'); }

  /** AF gain level as 3 digits (live radio reported 006; range not clamped). */
  setVolume(level) { return this.request('AG', ` ${String(level).padStart(3, '0')}`, { wait: false }); }
  getVolume() { return this.request('AG'); }

  setGps(on, pcOutput) { return this.request('GP', ` ${on ? 1 : 0},${pcOutput ? 1 : 0}`, { wait: false }); }
  getGps() { return this.request('GP'); }

  setTnc(mode, band) { return this.request('TN', ` ${mode},${band}`); }
  getTnc() { return this.request('TN'); }

  setSingleBand(on) { return this.request('DL', ` ${on ? 1 : 0}`); }
  getSingleBand() { return this.request('DL'); }

  setBeatCancel(band, on) { return this.request('BC', ` ${band},${on ? 1 : 0}`); }
  getBeatCancel() { return this.request('BC'); }

  setAttenuator(band, on) { return this.request('RA', ` ${band},${on ? 1 : 0}`); }
  getAttenuator(band) { return this.request('RA', ` ${band}`); }

  setVfoMode(band, mode) { return this.request('VM', ` ${band},${mode}`); }
  getVfoMode(band) { return this.request('VM', ` ${band}`); }

  setFmRadio(on) { return this.request('FR', ` ${on ? 1 : 0}`); }
  getFmRadio() { return this.request('FR'); }

  pollSMeter(band) { return this.request('SM', ` ${band}`, { wait: false }); }
  pollPower() { return this.request('PS', '', { wait: false }); }
  pollBattery() {
    return Promise.all([
      this.request('BL', '', { wait: false }),
      this.request('BS', '', { wait: false }),
    ]).catch(() => {});
  }

  /** VOX (menu 150): voice-activated transmit on the radio's own mic. */
  setVox(on) { return this.request('VX', ` ${on ? 1 : 0}`); }
  getVox() { return this.request('VX'); }

  /**
   * PTT (live-verified, hamlib thd74 semantics): a bare TX keys the radio
   * up on its current TX band; the echo "TX b" confirms and names the band.
   * A parameterized "TX n" is invalid (the radio answers '?'). Outside the
   * region's TX windows the key-up is refused (JP unit: 2 m / 70 cm only).
   */
  keyPtt() { return this.request('TX', ''); }
  /** PTT off; confirmed by an "RX" echo. */
  unkeyPtt() { return this.request('RX', ''); }

  _pushLog(direction, frame) {
    this.log.push({ t: Date.now(), direction, frame });
    if (this.log.length > 500) this.log.shift();
    this.emit('log', direction, frame);
  }
}

function freshState() {
  return {
    connected: false,
    model: '',
    firmware: '',
    region: '',
    regionName: '',
    power: 0,
    dvGateway: 0,
    aiInformation: 0,
    ioMode: IO_MODE.AF,
    audioGain: 0,
    fineStep: 0,
    fine: false,
    fmRadio: false,
    singleBand: 0,
    gps: false,
    gpsPcOutput: false,
    vox: false,
    transmitting: false,
    txBand: null,
    batteryLevel: null,
    batteryStatus: null,
    batteryType: null,
    tncMode: 0,
    dataBand: 0,
    subBand: false,
    filter: 0,
    filterLevel: 0,
    aBand: bandState(),
    bBand: bandState(),
  };
}

function bandState() {
  return {
    frequencyHz: 0,
    mode: 0,
    vfoMode: 0,
    attenuator: 0,
    stepIdx: 0,
    stepHz: 0,
    sMeter: 0,
    busy: false,
    beatCancel: 0,
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { THD75Connection, freshState, MODE, BAND, IO_MODE, STEPS_HZ, FINE_STEPS_HZ, TUNE_STEPS, VFO_MODE };
