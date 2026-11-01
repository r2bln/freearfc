'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSources, parseModules, findRadioSource, findLoopback } = require('../src/main/audio');

test('parseSources extracts index, name, description, state', () => {
  const text = [
    'Source #6166',
    '\tState: SUSPENDED',
    '\tName: alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback',
    '\tDescription: TH-D75 Mono',
    '',
    'Source #53',
    '\tState: RUNNING',
    '\tName: alsa_output.pci-0000_00_1f.3.analog-stereo.monitor',
    '\tDescription: Monitor of Built-in Audio',
  ].join('\n');
  const sources = parseSources(text);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0], {
    index: 6166,
    name: 'alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback',
    description: 'TH-D75 Mono',
    state: 'SUSPENDED',
  });
  assert.equal(sources[1].state, 'RUNNING');
});

test('findRadioSource matches the TH-D75 USB capture device only', () => {
  const sources = parseSources([
    'Source #5920',
    '\tName: alsa_input.usb-046d_HD_Pro_Webcam_C920_B839941F-02.analog-stereo',
    '',
    'Source #6166',
    '\tName: alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback',
  ].join('\n'));
  const src = findRadioSource(sources);
  assert.ok(src);
  assert.equal(src.index, 6166);
});

test('findRadioSource returns null when the radio is absent', () => {
  const sources = parseSources('Source #53\n\tName: alsa_output.pci-0000_00_1f.3.analog-stereo.monitor\n');
  assert.equal(findRadioSource(sources), null);
});

test('parseModules and findLoopback match only the radio loopback', () => {
  const text = [
    'Module #77',
    '\tName: module-device-manager',
    '\tArgument: ',
    '',
    'Module #91',
    '\tName: module-loopback',
    `\tArgument: source=alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback latency_msec=120`,
    '',
    'Module #92',
    '\tName: module-loopback',
    '\tArgument: source=alsa_input.usb-046d_HD_Pro_Webcam_C920_B839941F-02.analog-stereo latency_msec=120',
  ].join('\n');
  const modules = parseModules(text);
  assert.equal(modules.length, 3);
  const lb = findLoopback(modules, 'alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback');
  assert.ok(lb);
  assert.equal(lb.index, 91);
  assert.equal(findLoopback(modules, 'alsa_input.usb-Other-00.analog-stereo'), null);
});
