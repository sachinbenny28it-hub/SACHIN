const { app, BrowserWindow, dialog, ipcMain, Menu, globalShortcut } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_URL = 'http://localhost:4000';
let widgetWindow = null;
let serverProcess = null;
let quitting = false;
const APP_ORIGIN = new URL(APP_URL).origin;

function isSACHINUrl(value) {
  try { return new URL(value).origin === APP_ORIGIN; } catch { return false; }
}

async function healthyServer() {
  try {
    const response = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && health.database === 'connected';
  } catch { return false; }
}

async function startServer() {
  if (await healthyServer()) return true;

  serverProcess = spawn('node', ['server/index.js'], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: 'ignore',
    windowsHide: true
  });
  serverProcess.on('error', (error) => console.error('SACHIN server could not start:', error));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await healthyServer()) return true;
    if (serverProcess.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function openFullApp(url = `${APP_URL}/app.html`) {
  const fullWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: 'SACHIN',
    icon: path.join(PROJECT_ROOT, 'public', 'sachin-logo.png'),
    backgroundColor: '#0F1119',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:sachin'
    }
  });
  fullWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isSACHINUrl(target)) {
      setImmediate(() => openFullApp(target));
    }
    return { action: 'deny' };
  });
  fullWindow.webContents.on('will-navigate', (event, target) => {
    if (!isSACHINUrl(target)) event.preventDefault();
  });
  fullWindow.loadURL(url);
}

function createWidgetWindow() {
  widgetWindow = new BrowserWindow({
    width: 360,
    height: 390,
    minWidth: 340,
    minHeight: 360,
    resizable: true,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0F1119',
    show: false,
    title: 'SACHIN Widget',
    icon: path.join(PROJECT_ROOT, 'public', 'sachin-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:sachin'
    }
  });

  widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSACHINUrl(url)) setImmediate(() => openFullApp(url));
    return { action: 'deny' };
  });
  widgetWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSACHINUrl(url)) event.preventDefault();
  });

  widgetWindow.once('ready-to-show', () => widgetWindow?.show());
  widgetWindow.on('closed', () => {
    widgetWindow = null;
    if (!quitting) app.quit();
  });
  widgetWindow.loadURL(`${APP_URL}/widget.html`);
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'SACHIN',
      submenu: [
        { label: 'Open widget', accelerator: 'Ctrl+Shift+S', click: () => widgetWindow?.show() },
        { label: 'Open full app', click: () => openFullApp() },
        { type: 'separator' },
        { role: 'quit', label: 'Quit SACHIN' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Always on top', type: 'checkbox', checked: true, click: (item) => widgetWindow?.setAlwaysOnTop(item.checked) },
        { role: 'minimize' }
      ]
    }
  ]));
}

app.whenReady().then(async () => {
  if (!(await startServer())) {
    dialog.showErrorBox('SACHIN could not start', 'SACHIN needs its Express server, MySQL database, and a valid JWT_SECRET. Check your .env settings, run npm run db:init, and try again.');
    app.quit();
    return;
  }

  installMenu();
  createWidgetWindow();
  globalShortcut.register('CommandOrControl+Shift+S', () => widgetWindow?.show());
  ipcMain.on('sachin-widget:close', (event) => {
    if (widgetWindow && event.sender === widgetWindow.webContents) app.quit();
  });
});

app.on('will-quit', () => {
  quitting = true;
  globalShortcut.unregisterAll();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
});
