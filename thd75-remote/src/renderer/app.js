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
  appLog('! ' + msg);
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
  fillSelect($('multA'), TUNE_STEPS, (n) => '×' + n);
  fillSelect($('multB'), TUNE_STEPS, (n) => '×' + n);
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
    if (state.batteryLevel !== null && state.batteryLevel !== undefined) {
      $('infoBatt').textContent = 'Battery: ' + ['▁', '▃', '▅', '█'][state.batteryLevel] + ' ' + state.batteryLevel + '/3';
    }
    $('infoIo').textContent = 'USB out: ' + ['AF', 'IF', 'Detect'][state.ioMode] || '?';

    for (const [band, key] of [['A', 'aBand'], ['B', 'bBand']]) {
      const b = state[key];
      $('freq' + band).textContent = fmtMHz(b.frequencyHz) + ' MHz';
      const vm = $('vm' + band);
      vm.textContent = ['VFO', 'Mem', 'Call', 'Wx'][b.vfoMode] || 'VM' + b.vfoMode;
      vm.classList.toggle('active', b.vfoMode !== 0);
      // Tuning buttons only work in VFO mode: FQ/UP sets are refused (N) otherwise.
      const vfo = b.vfoMode === 0;
      $('dn' + band).disabled = !vfo;
      $('up' + band).disabled = !vfo;
      $('mode' + band).value = String(b.mode);
      $('busy' + band).classList.toggle('on', !!b.busy);
      $('att' + band).checked = !!b.attenuator;
      const idx = b.stepIdx !== undefined ? b.stepIdx : STEPS_HZ.indexOf(b.stepHz);
      $('step' + band).value = String(idx === -1 ? 0 : idx);
      $('sm' + band).style.width = Math.min(100, (b.sMeter / 9) * 100) + '%';
    }

    $('infoSingle').classList.toggle('hidden', !state.singleBand);
    $('volSlider').value = String(state.audioGain);
    $('volNum').value = String(state.audioGain);
    $('gpsOn').checked = !!state.gps;
    $('gpsPc').checked = !!state.gpsPcOutput;
    $('tncOn').checked = state.tncMode !== 0;
    $('voxOn').checked = !!state.vox;
    $('txLed').classList.toggle('on', !!state.transmitting);
    $('txBandInfo').textContent = 'TX band ' + 'AB'[state.txBand ?? 0];
    // The card outline follows the radio's TX band (set by PTT echo), not a UI choice.
    $('bandA').classList.toggle('active-band', state.txBand === 0);
    $('bandB').classList.toggle('active-band', state.txBand === 1);
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

/**
 * Tune a band by N×step via an explicit FQ set. UP/DW are not used here:
 * they carry no band argument and act on the radio's main band only.
 */
function nudge(band, dir, multOverride) {
  if (!connected || !lastState) return;
  const b = band === 0 ? lastState.aBand : lastState.bBand;
  if (!b || b.vfoMode !== 0) { toast('Band ' + 'AB'[band] + ': switch to VFO first'); return; }
  const mult = multOverride !== undefined
    ? multOverride
    : TUNE_STEPS[Number(band === 0 ? $('multA').value : $('multB').value)] || 1;
  const stepHz = b.stepHz || 5000;
  return rpc('setFrequency', band, b.frequencyHz + dir * mult * stepHz);
}

/** Fire fn on click and repeat while the button is held, serialized. */
function bindRepeat(btn, fn) {
  let timer = null;
  let inFlight = false;
  const fire = () => {
    if (inFlight) return;
    inFlight = true;
    Promise.resolve(fn()).catch(() => {}).finally(() => { inFlight = false; });
  };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  btn.addEventListener('mousedown', () => {
    if (btn.disabled) return;
    fire();
    stop();
    timer = setInterval(fire, 220);
  });
  btn.addEventListener('mouseup', stop);
  btn.addEventListener('mouseleave', stop);
  window.addEventListener('blur', stop);
}

/** Mouse wheel over a band card tunes one step per notch, throttled. */
function bindWheel(card, band) {
  let lastAt = 0;
  card.addEventListener('wheel', (e) => {
    if (e.target.closest('select, input, .chan-row')) return; // native scroll in fields
    if (!connected) return;
    e.preventDefault();
    const now = Date.now();
    if (now - lastAt < 120) return;
    lastAt = now;
    nudge(band, e.deltaY < 0 ? +1 : -1, 1); // exactly one selected step per notch
  }, { passive: false });
}

function applyFreq(band) {
  // Accept both ',' and '.' as the decimal separator.
  const raw = $('freqEntry' + band).value.replace(/,/g, '.');
  const mhz = parseFloat(raw);
  if (!Number.isFinite(mhz) || mhz <= 0 || mhz > 1300) { toast('Bad frequency'); return; }
  const freqHz = Math.round(mhz * 1e6); // MHz -> Hz
  const b = lastState && (band === 0 ? lastState.aBand : lastState.bBand);
  // FQ sets only apply in VFO mode — switch automatically instead of failing.
  (b && b.vfoMode !== 0 ? rpc('setVfoMode', band, 0) : Promise.resolve())
    .then(() => rpc('setFrequency', band, freqHz))
    .catch(() => {});
}

/** Emulate the radio's A/B key: exchange the two bands' VFO contents.
 *  SETs are paced (live-verified): the firmware drops rapid-fire SET
 *  bursts, and FQ targets outside the receiving band's range are
 *  silently ignored, so cross-range swaps apply only the legal half. */
async function swapBands() {
  if (!connected || !lastState) return;
  const P = 200;
  const pace = (p) => p.then((r) => new Promise((res) => setTimeout(() => res(r), P)));
  appLog('swap A/B');
  try {
    const vmA = lastState.aBand.vfoMode;
    const vmB = lastState.bBand.vfoMode;
    if (vmA !== 0) await pace(rpc('setVfoMode', 0, 0));
    if (vmB !== 0) await pace(rpc('setVfoMode', 1, 0));
    if (vmA !== 0 || vmB !== 0) await new Promise((r) => setTimeout(r, 500)); // let AI FQ/MD/SF land
    const a = lastState.aBand;
    const b = lastState.bBand;
    await pace(rpc('setFrequency', 0, b.frequencyHz));
    await pace(rpc('setMode', 0, b.mode));
    await pace(rpc('setStep', 0, b.stepIdx));
    await pace(rpc('setFrequency', 1, a.frequencyHz));
    await pace(rpc('setMode', 1, a.mode));
    await pace(rpc('setStep', 1, a.stepIdx));
    if (vmB !== 0) await pace(rpc('setVfoMode', 1, vmB));
    if (vmA !== 0) await pace(rpc('setVfoMode', 0, vmA));
  } catch { /* toast already shown by rpc */ }
}

async function connect() {
  const path = $('portSelect').value;
  if (!path) { toast('No port selected'); return; }
  $('connectBtn').disabled = true;
  appLog('connect ' + path + ' …');
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

// ------------------------------------------------------------- audio

async function refreshAudio() {
  const btn = $('audioToggle');
  const info = $('audioInfo');
  try {
    const st = await window.thd75.audioStatus();
    btn.textContent = st.active ? 'On' : 'Off';
    btn.classList.toggle('primary', st.active);
    info.textContent = st.error || st.source || '';
    info.title = st.source || '';
  } catch (err) {
    info.textContent = err.message;
  }
}

function setVolumeFromUi(level) {
  const v = Math.max(0, Math.min(200, Math.round(level)));
  $('volSlider').value = String(v);
  $('volNum').value = String(v);
  if (applyingUi) return;
  rpc('setVolume', v).catch(() => {});
}

// ------------------------------------------------------------- local memory

const CH_KEY = 'thd75.channels';

function loadChans() {
  let chans;
  try { chans = JSON.parse(localStorage.getItem(CH_KEY)) || []; } catch { chans = []; }
  // v1 entries had no band column; migrate them into Band A.
  let migrated = false;
  for (const ch of chans) {
    if (ch.band !== 0 && ch.band !== 1) { ch.band = 0; migrated = true; }
  }
  if (migrated) localStorage.setItem(CH_KEY, JSON.stringify(chans));
  return chans;
}
function saveChans(chans) {
  localStorage.setItem(CH_KEY, JSON.stringify(chans));
  renderChans();
}

function addChan(band) {
  const b = band === 0 ? lastState.aBand : lastState.bBand;
  if (!b || !b.frequencyHz) { toast('No frequency to store yet'); return; }
  const chans = loadChans();
  chans.push({ name: fmtMHz(b.frequencyHz), freqHz: b.frequencyHz, mode: b.mode, band });
  saveChans(chans);
  appLog('local memory: stored ' + fmtMHz(b.frequencyHz) + ' into band ' + 'AB'[band]);
}

/** Recall into the entry's own band: force VFO, then mode and frequency. */
function recallChan(i) {
  const ch = loadChans()[i];
  if (!ch) return;
  const band = ch.band === 1 ? 1 : 0;
  appLog('local memory: recalling ' + (ch.name || fmtMHz(ch.freqHz)) + ' → band ' + 'AB'[band]);
  rpc('setVfoMode', band, 0)
    .then(() => rpc('setMode', band, Number(ch.mode) || 0))
    .then(() => rpc('setFrequency', band, ch.freqHz))
    .catch(() => {});
}

function renderChans() {
  const chans = loadChans();
  for (const [hostId, band] of [['chanListA', 0], ['chanListB', 1]]) {
    const host = $(hostId);
    host.innerHTML = '';
    const own = chans.map((ch, i) => [ch, i]).filter(([ch]) => (ch.band === 1 ? 1 : 0) === band);
    if (!own.length) {
      const empty = document.createElement('div');
      empty.className = 'tiny';
      empty.textContent = '(empty — “+” stores the current band)';
      host.appendChild(empty);
      continue;
    }
    for (const [ch, i] of own) {
      const row = document.createElement('div');
      row.className = 'chan-row';
      row.title = 'Click to recall into band ' + 'AB'[band];
      row.onclick = (e) => { if (!e.target.closest('input, select, button')) recallChan(i); };

      const name = document.createElement('input');
      name.type = 'text'; name.className = 'ch-name'; name.value = ch.name || '';
      name.onchange = () => { const c = loadChans(); c[i].name = name.value; saveChans(c); };
      row.appendChild(name);

      const freq = document.createElement('span');
      freq.className = 'ch-freq';
      freq.textContent = (ch.freqHz / 1e6).toFixed(5);
      row.appendChild(freq);

      const mode = document.createElement('select');
      mode.className = 'ch-mode';
      MODE.forEach((m, mi) => {
        const o = document.createElement('option');
        o.value = String(mi); o.textContent = m || '(reserved)';
        if (!m) o.disabled = true;
        mode.appendChild(o);
      });
      mode.value = String(ch.mode || 0);
      mode.onchange = () => { const c = loadChans(); c[i].mode = Number(mode.value); saveChans(c); };
      row.appendChild(mode);

      const del = document.createElement('button');
      del.className = 'ch-del'; del.textContent = '\u00d7';
      del.title = 'Delete entry';
      del.onclick = () => { const c = loadChans(); c.splice(i, 1); saveChans(c); };
      row.appendChild(del);

      host.appendChild(row);
    }
  }
}

// ---------------------------------------------------------------- app log

function appLog(line) {
  const el = $('appLog');
  if (!el) return;
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
    + ':' + String(t.getSeconds()).padStart(2, '0');
  const div = document.createElement('div');
  div.textContent = hh + '  ' + line;
  el.appendChild(div);
  while (el.childNodes.length > 300) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('refreshPorts').onclick = () => refreshPorts().catch((e) => toast(e.message));
  $('connectBtn').onclick = () => (connected ? window.thd75.disconnect() : connect());

  for (const band of ['A', 'B']) {
    const b = band === 'A' ? 0 : 1;
    $('applyFreq' + band).onclick = () => applyFreq(b);
    $('freqEntry' + band).addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFreq(b); });
    bindRepeat($('dn' + band), () => nudge(b, -1));
    bindRepeat($('up' + band), () => nudge(b, +1));
    bindWheel($('band' + band), b);
    // Click on a card's empty space swaps the bands, like the radio's A/B key.
    $('band' + band).addEventListener('click', (e) => {
      if (e.target.closest('input, select, button, .vm, .knob, .led, .smeter')) return;
      swapBands();
    });
    $('vm' + band).onclick = () => {
      if (applyingUi || !connected) return;
      const cur = (band === 'A' ? lastState.aBand : lastState.bBand).vfoMode;
      rpc('setVfoMode', b, cur === 0 ? 1 : 0); // toggle VFO <-> Memory
    };
    $('mode' + band).onchange = () => { if (!applyingUi) rpc('setMode', b, Number($('mode' + band).value)); };
    $('step' + band).onchange = () => { if (!applyingUi) rpc('setStep', b, Number($('step' + band).value)); };
    $('att' + band).onchange = () => { if (!applyingUi) rpc('setAttenuator', b, $('att' + band).checked ? 1 : 0); };
  }

  // Volume: slider, number field, and wheel over both
  $('volSlider').addEventListener('input', () => setVolumeFromUi(Number($('volSlider').value)));
  $('volNum').addEventListener('change', () => setVolumeFromUi(Number($('volNum').value || 0)));
  for (const id of ['volSlider', 'volNum']) {
    $(id).addEventListener('wheel', (e) => {
      if (!connected) return;
      e.preventDefault();
      const cur = Number($('volSlider').value) || 0;
      setVolumeFromUi(cur + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
  }

  $('gpsOn').onchange = () => { if (!applyingUi) rpc('setGps', $('gpsOn').checked ? 1 : 0, $('gpsPc').checked ? 1 : 0); };
  $('gpsPc').onchange = () => { if (!applyingUi) rpc('setGps', $('gpsOn').checked ? 1 : 0, $('gpsPc').checked ? 1 : 0); };
  $('tncOn').onchange = () => { if (!applyingUi) rpc('setTnc', $('tncOn').checked ? 1 : 0, 1); };
  $('voxOn').onchange = () => { if (!applyingUi) rpc('setVox', $('voxOn').checked); };

  // Local memory
  $('addChA').onclick = () => addChan(0);
  $('addChB').onclick = () => addChan(1);
  renderChans();

  // Audio monitor
  refreshAudio();
  $('audioToggle').onclick = async () => {
    const btn = $('audioToggle');
    btn.disabled = true;
    try {
      const st = await window.thd75.audioStatus();
      if (st.active) { await window.thd75.audioStop(); appLog('audio monitor off'); }
      else { await window.thd75.audioStart(); appLog('audio monitor on → ' + (st.source || '')); }
    } catch (err) {
      toast('Audio: ' + err.message);
    }
    btn.disabled = false;
    refreshAudio();
  };

  // PTT: hold the button to transmit; any release unkeys immediately.
  {
    const btn = $('pttBtn');
    let keyed = false;
    const up = () => {
      if (!keyed) return;
      keyed = false;
      btn.classList.remove('keyed');
      appLog('PTT off');
      rpc('unkeyPtt').catch(() => {});
    };
    btn.addEventListener('mousedown', () => {
      if (!connected || keyed) return;
      keyed = true;
      btn.classList.add('keyed');
      appLog('PTT on');
      rpc('keyPtt').catch(() => { keyed = false; btn.classList.remove('keyed'); });
    });
    btn.addEventListener('mouseup', up);
    btn.addEventListener('mouseleave', up);
    window.addEventListener('blur', up);
  }

  // Logs: tabs + collapse
  const showTab = (name) => {
    for (const pre of ['log', 'appLog']) $(pre).classList.toggle('hidden', pre !== (name === 'cat' ? 'log' : 'appLog'));
    for (const b of document.querySelectorAll('.tabbtn')) b.classList.toggle('on', b.dataset.tab === name);
  };
  for (const b of document.querySelectorAll('.tabbtn')) b.onclick = () => showTab(b.dataset.tab);
  showTab('app');
  $('logCollapse').onclick = () => {
    const body = $('logBody');
    const hidden = body.classList.toggle('hidden');
    $('logCollapse').textContent = hidden ? '+' : '\u2212';
  };

  window.thd75.onConnected(({ state }) => {
    connected = true;
    setStatus('ok', 'connected');
    $('connectBtn').textContent = 'Disconnect';
    $('radioInfo').classList.remove('hidden');
    appLog('connected; state synced');
    reflect(state);
  });
  window.thd75.onState((state) => reflect(state));
  window.thd75.onClosed(() => {
    connected = false;
    setStatus('', 'disconnected');
    $('connectBtn').textContent = 'Connect';
    appLog('disconnected');
  });
  window.thd75.onWarning((msg) => toast(msg));
  window.thd75.onRejected(() => toast('Radio rejected the last command (?)'));

  window.thd75.onLog(({ direction, frame }) => {
    const el = $('log');
    if (!el || el.classList.contains('hidden')) return;
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
appLog('TH-D75 Remote started');
