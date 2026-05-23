const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

const isDev = process.argv.includes('--dev');
const useLocalSignaling = process.argv.includes('--local') || isDev;

const SIGNALING_URL = useLocalSignaling
  ? 'ws://localhost:3000'
  : 'wss://brotalk.onrender.com';

let mainWindow = null;
let splashWindow = null;
let autoUpdaterRef = null;
let updateDownloaded = false;
let installingUpdate = false;
let splashReady = false;
let lastUpdateStatus = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#020403',
    show: true,
    skipTaskbar: false,
    title: 'BroTalk',
    webPreferences: {
      preload: path.join(__dirname, 'preload-splash.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  splashWindow.setMenuBarVisibility(false);
  splashWindow.loadFile(path.join(__dirname, 'public', 'splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    title: 'BroTalk',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0a0a0a',
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

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  const reveal = () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (splashWindow) {
      try { splashWindow.close(); } catch {}
    }
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', reveal);
  } else {
    reveal();
  }
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

function sendSplash(channel, payload) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send(channel, payload);
  }
}

function pushUpdateStatus(status) {
  lastUpdateStatus = { ...(lastUpdateStatus || {}), ...status };
  if (splashReady) sendSplash('splash:update-status', lastUpdateStatus);
}

ipcMain.handle('get-config', () => ({
  signalingUrl: SIGNALING_URL,
  version: app.getVersion(),
}));

ipcMain.handle('splash:get-info', () => ({
  version: app.getVersion(),
}));

ipcMain.on('splash:ready', () => {
  splashReady = true;
  if (lastUpdateStatus) sendSplash('splash:update-status', lastUpdateStatus);
});

ipcMain.on('splash:dismiss', () => {
  showMainWindow();
});

ipcMain.on('splash:install-update', () => {
  if (!updateDownloaded || !autoUpdaterRef) {
    showMainWindow();
    return;
  }
  installingUpdate = true;
  try {
    autoUpdaterRef.quitAndInstall(true, true);
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err);
    showMainWindow();
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

  createSplashWindow();
  createMainWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createSplashWindow();
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (installingUpdate) return;
  if (process.platform !== 'darwin') app.quit();
});
