'use strict';
/**
 * Route the radio's USB-audio output (AF/IF/Detect, selected via the CAT
 * `IO` command) to the default speakers through a PipeWire/PulseAudio
 * loopback module. Linux only: implemented via `pactl`.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);

/** Source name fragment the TH-D75 enumerates with (live: alsa_input.usb-JVCKENWOOD_TH-D75-02.mono-fallback). */
const RADIO_SOURCE_RE = /usb-[^,]*JVCKENWOOD.*TH-D75/i;
const LOOPBACK_LATENCY_MS = 120;

function pactl(...args) {
  return exec('pactl', args, { timeout: 5000 });
}

/** Parse `pactl list sources` text into [{ index, name, description, state }]. */
function parseSources(text) {
  const sources = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^Source #(\d+)\s*$/);
    if (m) { cur = { index: Number(m[1]), name: '', description: '', state: '' }; sources.push(cur); continue; }
    if (!cur) continue;
    let kv = line.match(/^\s*Name:\s*(.+)$/);
    if (kv) { cur.name = kv[1].trim(); continue; }
    kv = line.match(/^\s*Description:\s*(.+)$/);
    if (kv) { cur.description = kv[1].trim(); continue; }
    kv = line.match(/^\s*State:\s*(\S+)/);
    if (kv) cur.state = kv[1];
  }
  return sources;
}

/** Pick the radio capture device from parsed sources. */
function findRadioSource(sources) {
  return sources.find((s) => RADIO_SOURCE_RE.test(s.name)) || null;
}

/** Parse `pactl list modules` text into [{ index, name, argument }]. */
function parseModules(text) {
  const modules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^Module #(\d+)\s*$/);
    if (m) { cur = { index: Number(m[1]), name: '', argument: '' }; modules.push(cur); continue; }
    if (!cur) continue;
    let kv = line.match(/^\s*Name:\s*(.+)$/);
    if (kv) { cur.name = kv[1].trim(); continue; }
    kv = line.match(/^\s*Argument:\s*(.*)$/);
    if (kv) cur.argument = kv[1].trim();
  }
  return modules;
}

/** Find a loopback module attached to the given source, if any. */
function findLoopback(modules, sourceName) {
  return modules.find((mo) => mo.name === 'module-loopback'
    && new RegExp(`source=${escapeRe(sourceName)}(\\s|$)`).test(mo.argument)) || null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Current monitor state: { supported, active, source, moduleIndex, error }.
 * Detects loopbacks left over from a previous run too.
 */
async function getStatus() {
  if (process.platform !== 'linux') {
    return { supported: false, active: false, source: null, moduleIndex: null, error: 'Linux (PipeWire/PulseAudio) only' };
  }
  try {
    const { stdout } = await pactl('list', 'sources');
    const src = findRadioSource(parseSources(stdout));
    if (!src) {
      return { supported: true, active: false, source: null, moduleIndex: null, error: 'Radio audio device not found (radio off?)' };
    }
    const { stdout: modText } = await pactl('list', 'modules');
    const lb = findLoopback(parseModules(modText), src.name);
    return { supported: true, active: !!lb, source: src.name, moduleIndex: lb ? lb.index : null, error: null };
  } catch (err) {
    return { supported: true, active: false, source: null, moduleIndex: null, error: err.message };
  }
}

/** Attach the radio source to the default sink. Idempotent. */
async function start() {
  const st = await getStatus();
  if (!st.supported) throw new Error(st.error);
  if (st.error && !st.source) throw new Error(st.error);
  if (st.active) return st;
  const { stdout } = await pactl('load-module', 'module-loopback',
    `source=${st.source}`, `latency_msec=${LOOPBACK_LATENCY_MS}`);
  const index = Number.parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(index)) throw new Error('Unexpected pactl load-module reply');
  return { ...st, active: true, moduleIndex: index };
}

/** Detach the loopback (including one left over from an earlier run). */
async function stop() {
  const st = await getStatus();
  if (st.moduleIndex !== null) await pactl('unload-module', String(st.moduleIndex));
  return { ...st, active: false, moduleIndex: null };
}

module.exports = { parseSources, parseModules, findRadioSource, findLoopback, getStatus, start, stop };
