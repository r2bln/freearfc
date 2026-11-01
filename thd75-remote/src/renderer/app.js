'use strict';
/* Renderer logic for TH-D75 Remote. All radio I/O goes through the
 * preload bridge (window.thd75); protocol state arrives via events. */

const $ = (id) => document.getElementById(id);
let connected = false;
let lastState = null;
let applyingUi = false; // suppress change handlers while reflecting radio state

function fmtMHz(freqHz) {
  if (!freqHz) return '---.-----';
  const s = (freqHz / 1e6).toFixed(6); // Hz resolution
  const dot = s.indexOf('.');
  return s.slice(0, dot) + '.' + s.slice(dot + 1, dot + 4) + ' ' + s.slice(dot + 4);
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function fillSelect(sel, items, format) {
  sel.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = format(items[i], i);
    if (!items[i]) o.disabled = true;
    sel.appendChild(o);
  }
}

function initControls() {
  fillSelect($('modeA'), MODE, (m) => m || '(reserved)');
  fillSelect($('modeB'), MODE, (m) => m || '(reserved)');
  fillSelect($('stepA'), STEPS_HZ, (hz) => (hz / 1000) + ' kHz');
  fillSelect($('stepB'), STEPS_HZ, (hz) => (hz / 1000) + ' kHz');
  fillSelect($('fineStep'), FINE_STEPS_HZ, (hz) => hz + ' Hz');
}

// ---------------------------------------------------------------- ports

async function refreshPorts() {
  const ports = await window.thd75.listPorts();
  const sel = $('portSelect');
  sel.innerHTML = '';
  for (const p of ports) {
    const o = document.createElement('option');
    o.value = p.path;
    o.textContent = p.path + (p.manufacturer ? ` — ${p.manufacturer}` : '');
    sel.appendChild(o);
  }
  if (!ports.length) {
    const o = document.createElement('option');
    o.textContent = '(no serial ports found)';
    o.disabled = true;
    sel.appendChild(o);
  }
}

// ---------------------------------------------------------------- state

function reflect(state) {
  if (!state) return;
  lastState = state;
  applyingUi = true;
  try {
    $('infoModel').textContent = 'Model: ' + (state.model || '?');
    $('infoFw').textContent = 'FW: ' + (state.firmware || '?');
    $('infoRegion').textContent = 'Region: ' + (state.regionName || '?');
    $('infoPower').textContent = 'Power: ' + state.power;
    $('infoIo').textContent = 'USB out: ' + ['AF', 'IF', 'Detect'][state.ioMode] || '?';

    for (const [band, key] of [['A', 'aBand'], ['B', 'bBand']]) {
      const b = state[key];
      $('freq' + band).textContent = fmtMHz(b.frequency10Hz) + ' MHz';
      $('mode' + band).value = String(b.mode);
      $('busy' + band).classList.toggle('on', !!b.busy);
      $('att' + band).checked = !!b.attenuator;
      const idx = b.stepIdx !== undefined ? b.stepIdx : STEPS_HZ.indexOf(b.stepHz);
      $('step' + band).value = String(idx === -1 ? 0 : idx);
      $('sm' + band).style.width = Math.min(100, (b.sMeter / 9) * 100) + '%';
    }

    $('ioMode').value = String(state.ioMode);
    $('volVal').textContent = String(state.audioGain);
    $('gpsOn').checked = !!state.gps;
    $('gpsPc').checked = !!state.gpsPcOutput;
    $('tncOn').checked = state.tncMode !== 0;
    $('singleBand').checked = state.singleBand !== 0;
    $('fineTune').checked = !!state.fine;
    $('fineStep').value = String(state.fineStep);
  } finally {
    applyingUi = false;
  }
}

// ---------------------------------------------------------------- actions

async function rpc(method, ...args) {
  try {
    return await window.thd75.rpc(method, ...args);
  } catch (err) {
    toast(method + ': ' + err.message);
    throw err;
  }
}

function bandOfTuneSelect() { return Number($('tuneBand').value); }

function applyFreq() {
  const raw = parseFloat($('freqEntry').value.replace(',', '.'));
  if (!Number.isFinite(raw) || raw <= 0 || raw > 1300) { toast('Bad frequency'); return; }
  const freqHz = Math.round(raw * 1e6); // MHz -> Hz
  rpc('setFrequency', bandOfTuneSelect(), freqHz);
}

async function connect() {
  const path = $('portSelect').value;
  if (!path) { toast('No port selected'); return; }
  $('connectBtn').disabled = true;
  try {
    await window.thd75.connect(path);
  } catch (err) {
    toast('Connect failed: ' + err.message);
    setStatus('err', 'failed');
  } finally {
    $('connectBtn').disabled = false;
  }
}

function setStatus(cls, text) {
  const el = $('connStatus');
  el.className = 'status ' + cls;
  el.textContent = text;
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('refreshPorts').onclick = () => refreshPorts().catch((e) => toast(e.message));
  $('connectBtn').onclick = () => (connected ? window.thd75.disconnect() : connect());

  $('applyFreq').onclick = applyFreq;
  $('freqEntry').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFreq(); });

  for (const btn of document.querySelectorAll('button.step')) {
    btn.onclick = () => {
      const n = Number(btn.dataset.n);
      rpc(btn.classList.contains('up') ? 'tuneUp' : 'tuneDown', n);
    };
  }

  for (const band of ['A', 'B']) {
    $('vm' + band).onclick = () => {
      if (applyingUi || !connected) return;
      const b = band === 'A' ? 0 : 1;
      const cur = (band === 'A' ? lastState.aBand : lastState.bBand).vfoMode;
      rpc('setVfoMode', b, cur === 0 ? 1 : 0); // toggle VFO <-> Memory
    };
    $('mode' + band).onchange = () => {
      if (applyingUi) return;
      rpc('setMode', band === 'A' ? 0 : 1, Number($('mode' + band).value));
    };
    $('step' + band).onchange = () => {
      if (applyingUi) return;
      rpc('setStep', band === 'A' ? 0 : 1, Number($('step' + band).value));
    };
    $('att' + band).onchange = () => {
      if (applyingUi) return;
      rpc('setAttenuator', band === 'A' ? 0 : 1, $('att' + band).checked ? 1 : 0);
    };
  }

  $('ioMode').onchange = () => { if (!applyingUi) rpc('setIoMode', Number($('ioMode').value)); };
  let lastVol = 0;
  window.thd75.onState((s) => { lastVol = s.audioGain; });
  $('volUp').onclick = () => rpc('setVolume', lastVol + 1);
  $('volDown').onclick = () => rpc('setVolume', Math.max(0, lastVol - 1));
  $('gpsOn').onchange = () => { if (!applyingUi) rpc('setGps', $('gpsOn').checked ? 1 : 0, $('gpsPc').checked ? 1 : 0); };
  $('gpsPc').onchange = () => { if (!applyingUi) rpc('setGps', $('gpsOn').checked ? 1 : 0, $('gpsPc').checked ? 1 : 0); };
  $('tncOn').onchange = () => { if (!applyingUi) rpc('setTnc', $('tncOn').checked ? 1 : 0, 1); };
  $('singleBand').onchange = () => { if (!applyingUi) rpc('setSingleBand', $('singleBand').checked ? 1 : 0); };
  $('fineTune').onchange = () => { if (!applyingUi) rpc('setFine', $('fineTune').checked); };
  $('fineStep').onchange = () => { if (!applyingUi) rpc('setFineStep', Number($('fineStep').value)); };

  window.thd75.onConnected(({ state }) => {
    connected = true;
    setStatus('ok', 'connected');
    $('connectBtn').textContent = 'Disconnect';
    $('radioInfo').classList.remove('hidden');
    reflect(state);
  });
  window.thd75.onState((state) => reflect(state));
  window.thd75.onClosed(() => {
    connected = false;
    setStatus('', 'disconnected');
    $('connectBtn').textContent = 'Connect';
  });
  window.thd75.onWarning((msg) => toast(msg));
  window.thd75.onRejected(() => toast('Radio rejected the last command (?)'));

  window.thd75.onLog(({ direction, frame }) => {
    if (!$('logEnabled').checked) return;
    const el = $('log');
    const line = document.createElement('div');
    line.className = direction;
    line.textContent = (direction === 'tx' ? '» ' : '« ') + frame.replace(/\r/g, '\\r');
    el.appendChild(line);
    while (el.childNodes.length > 300) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  });
}

initControls();
wire();
refreshPorts().catch((e) => toast(e.message));
