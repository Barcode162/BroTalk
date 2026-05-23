const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashApi', {
  getInfo: () => ipcRenderer.invoke('splash:get-info'),
  ready: () => ipcRenderer.send('splash:ready'),
  dismiss: () => ipcRenderer.send('splash:dismiss'),
  installUpdate: () => ipcRenderer.send('splash:install-update'),
  onUpdate: (cb) => {
    ipcRenderer.on('splash:update-status', (_event, data) => cb(data));
  },
});
