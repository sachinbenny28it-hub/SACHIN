const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('SACHINDesktop', Object.freeze({
  close: () => ipcRenderer.send('sachin-widget:close')
}));
