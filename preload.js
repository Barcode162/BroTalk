const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get-status'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update:status', (_event, data) => cb(data));
  },
});
