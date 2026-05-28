'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  // IP geolocation via main process — avoids CORS from file:// renderer context.
  getIpLocation: () => ipcRenderer.invoke('get-ip-location'),
});
