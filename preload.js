const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update-status', (_event, data) => cb(data));
  },
});
