'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { THD75Connection } = require('./protocol/connection');
const audio = require('./main/audio');

let win = null;
let port = null;
let conn = null;
let pollTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: 'TH-D75 Remote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
  stopPolling();
  let tick = 0;
  pollTimer = setInterval(() => {
    if (!conn) return;
    conn.pollPower().catch(() => {});
    conn.pollSMeter(0).catch(() => {});
    conn.pollSMeter(1).catch(() => {});
    conn.request('BY', ' 0', { wait: false }).catch(() => {});
    conn.request('BY', ' 1', { wait: false }).catch(() => {});
    if (tick++ % 10 === 0) conn.pollBattery(); // every ~20 s
  }, 2000);
}

async function doConnect({ path: portPath }) {
  if (conn) throw new Error('Already connected');
  port = new SerialPort({
    path: portPath,
    baudRate: 115200,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    rtscts: false,
    // The original asserts DTR+RTS while talking to the virtual COM board.
    dtr: true,
    rts: true,
    autoOpen: false,
  });
  await new Promise((resolve, reject) => {
    port.open((err) => (err ? reject(err) : resolve()));
  });
  conn = new THD75Connection({
    write: (s) => { port.write(Buffer.from(s, 'latin1'), () => {}); },
    on: (ev, cb) => {
      if (ev === 'data') port.on('data', cb);
      if (ev === 'close') port.on('close', cb);
      if (ev === 'error') port.on('error', cb);
    },
  });
  conn.on('state', (state) => send('thd75:state', state));
  conn.on('log', (direction, frame) => send('thd75:log', { direction, frame, t: Date.now() }));
  conn.on('close', () => { stopPolling(); send('thd75:closed'); });
  conn.on('warning', (msg) => { if (!msg.startsWith('spurious')) send('thd75:warning', msg); });

  await conn.enterControlMode();
  const identity = await conn.getId();
  await conn.syncAll();
  startPolling();
  send('thd75:connected', { identity, state: conn.state });
  return { identity, state: conn.state };
}

async function doDisconnect() {
  stopPolling();
  if (conn) {
    try { await conn.setAi(false); } catch { /* best effort */ }
    conn = null;
  }
  if (port) {
    await new Promise((resolve) => {
      if (port.isOpen) port.close(() => resolve()); else resolve();
    });
    port = null;
  }
  send('thd75:closed');
}

/** Whitelisted protocol methods exposed to the renderer. */
const RPC = new Set([
  'getId', 'getFirmware', 'getPower',
  'setFrequency', 'getFrequency', 'tuneUp', 'tuneDown',
  'setMode', 'getMode', 'setStep', 'getStep', 'setFineStep', 'setFine',
  'setIoMode', 'getIoMode', 'setVolume', 'getVolume',
  'setGps', 'getGps', 'setTnc', 'getTnc',
  'setSingleBand', 'getSingleBand', 'setBeatCancel', 'getBeatCancel',
  'setAttenuator', 'getAttenuator', 'setVfoMode', 'getVfoMode',
  'setFmRadio', 'getFmRadio', 'setAi', 'pollSMeter', 'pollPower', 'pollBattery', 'syncAll',
  'setVox', 'getVox',
]);

ipcMain.handle('ports:list', () => SerialPort.list());
ipcMain.handle('thd75:connect', (_e, arg) => doConnect(arg).catch((err) => {
  doDisconnect().catch(() => {});
  throw err;
}));
ipcMain.handle('thd75:disconnect', () => doDisconnect());
ipcMain.handle('thd75:rpc', (_e, { method, args }) => {
  if (!conn) throw new Error('Not connected');
  if (!RPC.has(method)) throw new Error(`Method not allowed: ${method}`);
  return conn[method](...(args || []));
});
ipcMain.handle('thd75:state', () => (conn ? conn.state : null));

// Radio USB-audio monitoring (loopback to the default sink).
ipcMain.handle('audio:status', () => audio.getStatus());
ipcMain.handle('audio:start', () => audio.start());
ipcMain.handle('audio:stop', () => audio.stop());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { stopPolling(); app.quit(); });
