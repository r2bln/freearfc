'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('thd75', {
  listPorts: () => ipcRenderer.invoke('ports:list'),
  connect: (path) => ipcRenderer.invoke('thd75:connect', { path }),
  disconnect: () => ipcRenderer.invoke('thd75:disconnect'),
  rpc: (method, ...args) => ipcRenderer.invoke('thd75:rpc', { method, args }),
  getState: () => ipcRenderer.invoke('thd75:state'),
  audioStatus: () => ipcRenderer.invoke('audio:status'),
  audioStart: () => ipcRenderer.invoke('audio:start'),
  audioStop: () => ipcRenderer.invoke('audio:stop'),
  onConnected: (cb) => ipcRenderer.on('thd75:connected', (_e, v) => cb(v)),
  onState: (cb) => ipcRenderer.on('thd75:state', (_e, v) => cb(v)),
  onLog: (cb) => ipcRenderer.on('thd75:log', (_e, v) => cb(v)),
  onClosed: (cb) => ipcRenderer.on('thd75:closed', () => cb()),
  onWarning: (cb) => ipcRenderer.on('thd75:warning', (_e, v) => cb(v)),
  onRejected: (cb) => ipcRenderer.on('thd75:rejected', () => cb()),
});
