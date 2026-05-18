const { app, BrowserWindow, ipcMain, Menu, session } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

const isDev = process.argv.includes('--dev');
const useLocalSignaling = process.argv.includes('--local') || isDev;

const SIGNALING_URL = useLocalSignaling
  ? 'ws://localhost:3000'
  : 'wss://brotalk.onrender.com';

let mainWindow = null;
let updateReady = false;
let autoUpdaterRef = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 720,
    minWidth: 480,
    minHeight: 560,
    title: 'BroTalk',
    autoHideMenuBar: true,
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
  console.log('[main] restart requested (update ready:', updateReady, ')');
  if (updateReady && autoUpdaterRef) {
    try {
      autoUpdaterRef.quitAndInstall(false, true);
      return;
    } catch (err) {
      console.error('[main] quitAndInstall failed:', err);
    }
  }
  app.relaunch();
  app.quit();
}

ipcMain.handle('get-config', () => ({
  signalingUrl: SIGNALING_URL,
  version: app.getVersion(),
}));

function setupAutoUpdater() {
  if (isDev) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.warn('[updater] electron-updater not installed:', err.message);
    return;
  }

  autoUpdaterRef = autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => console.error('[updater] error:', err));
  autoUpdater.on('checking-for-update', () => console.log('[updater] checking for updates…'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    if (mainWindow) mainWindow.webContents.send('update-status', { state: 'downloading', version: info.version });
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading: ${Math.round(p.percent)}%`);
    if (mainWindow) mainWindow.webContents.send('update-status', { state: 'downloading', percent: p.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded; will install on quit:', info.version);
    updateReady = true;
    if (mainWindow) mainWindow.webContents.send('update-status', { state: 'ready', version: info.version });
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('[updater] check failed:', err));
  }, 3000);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'mediaKeySystem') return callback(true);
    return callback(false);
  });

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
