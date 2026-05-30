const { app, BrowserWindow, ipcMain, Menu, session, shell } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

const isDev = process.argv.includes('--dev');
const useLocalSignaling = process.argv.includes('--local') || isDev;

const SIGNALING_URL = useLocalSignaling
  ? 'ws://localhost:3000'
  : 'wss://brotalk-22vs.onrender.com';

let mainWindow = null;
let autoUpdaterRef = null;
let updateDownloaded = false;
let installingUpdate = false;
let lastUpdateStatus = { state: 'idle' };

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 680,
    minHeight: 640,
    title: 'BroTalk',
    autoHideMenuBar: true,
    show: true,
    backgroundColor: '#1a1718',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'));

  if (isDev) mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = (input.key || '').toLowerCase();
    if (ctrl && key === 'r') {
      event.preventDefault();
      restartApp();
    } else if (ctrl && input.shift && key === 'i') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    } else if (key === 'f12') {
      event.preventDefault();
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function restartApp() {
  if (updateDownloaded && autoUpdaterRef) {
    try {
      autoUpdaterRef.quitAndInstall(true, true);
      return;
    } catch (err) {
      console.error('[main] quitAndInstall failed:', err);
    }
  }
  app.relaunch();
  app.quit();
}

function sendUpdate(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', status);
  }
}

function pushUpdateStatus(status) {
  lastUpdateStatus = { ...(lastUpdateStatus || {}), ...status };
  sendUpdate(lastUpdateStatus);
}

ipcMain.handle('get-config', () => ({
  signalingUrl: SIGNALING_URL,
  version: app.getVersion(),
}));

ipcMain.handle('update:get-status', () => lastUpdateStatus);

ipcMain.on('update:install', () => {
  if (!updateDownloaded || !autoUpdaterRef) return;
  installingUpdate = true;
  try {
    autoUpdaterRef.quitAndInstall(true, true);
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err);
    installingUpdate = false;
  }
});

ipcMain.on('open-mic-settings', () => {
  if (process.platform === 'win32') {
    shell.openExternal('ms-settings:privacy-microphone').catch((err) => {
      console.warn('[main] open mic settings failed:', err.message);
    });
  } else if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone').catch((err) => {
      console.warn('[main] open mic settings failed:', err.message);
    });
  }
});

function setupAutoUpdater() {
  if (isDev) {
    pushUpdateStatus({ state: 'not-available' });
    return;
  }
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[updater] electron-updater not installed:', err.message);
    pushUpdateStatus({ state: 'error', error: err.message });
    return;
  }

  autoUpdaterRef = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = true;

  let downloadVersion = '';

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err);
    pushUpdateStatus({ state: 'error', error: String(err && err.message || err) });
  });
  autoUpdater.on('checking-for-update', () => {
    pushUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    downloadVersion = info.version;
    pushUpdateStatus({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => {
    pushUpdateStatus({ state: 'not-available' });
  });
  autoUpdater.on('download-progress', (p) => {
    pushUpdateStatus({ state: 'downloading', percent: p.percent, version: downloadVersion });
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    pushUpdateStatus({ state: 'downloaded', version: info.version });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err);
      pushUpdateStatus({ state: 'error', error: err.message });
    });
  }, 400);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') return callback(true);
    return callback(false);
  });

  createMainWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (installingUpdate) return;
  if (process.platform !== 'darwin') app.quit();
});
