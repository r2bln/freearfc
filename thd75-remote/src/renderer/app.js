'use strict';
/* Renderer logic for TH-D75 Remote. All radio I/O goes through the
 * preload bridge (window.thd75); protocol state arrives via events. */

const $ = (id) => document.getElementById(id);
let connected = false;
let applyingUi = false; // suppress change handlers while reflecting radio state

function fmtMHz(freq10) {
  if (!freq10) return '---.-----';
  const mhz = freq10 / 100000;
  let s = mhz.toFixed(5); // 10 Hz resolution
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
      const idx = STEPS_HZ.indexOf(b.stepHz);
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
  const freq10 = Math.round(raw * 100000); // MHz -> 10 Hz units
  rpc('setFrequency', bandOfTuneSelect(), freq10);
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
  $('volUp').onclick = () => rpc('getVolume').then((v) => {
    const lvl = Math.min(3, Number(v) + 1);
    rpc('setVolume', lvl);
  });
  $('volDown').onclick = () => rpc('getVolume').then((v) => {
    const lvl = Math.max(0, Number(v) - 1);
    rpc('setVolume', lvl);
  });
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
