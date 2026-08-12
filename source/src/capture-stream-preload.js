'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on('capture-stream:command', wrapped);
  return () => ipcRenderer.removeListener('capture-stream:command', wrapped);
}

contextBridge.exposeInMainWorld('captureStreamHost', Object.freeze({
  onCommand: subscribe,
  emit: (payload) => ipcRenderer.send('capture-stream:event', payload),
}));
