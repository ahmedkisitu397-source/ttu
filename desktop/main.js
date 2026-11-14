// TTu desktop shell (Electron): loads the hosted app and keeps YouTube embeds in-window.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const path = require('path');

const START = process.env.TTU_URL || 'https://ttu.hadtah.com';
const ORIGIN = new URL(START).origin;

let win = null;
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function isAppUrl(url) {
  try { return new URL(url).origin === ORIGIN; } catch { return false; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 390,
    minHeight: 640,
    title: 'TTu',
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadURL(START);

  // Source links and "Watch on YouTube" open in the system browser.
  // youtube-nocookie iframes stay inside the app (they are not navigations).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  win.webContents.session.on('will-download', (_event, item) => {
    const name = item.getFilename() || 'TTu.pdf';
    const dest = dialog.showSaveDialogSync(win, {
      title: 'Save PDF',
      defaultPath: name,
      filters: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (!dest) { item.cancel(); return; }
    item.setSavePath(dest);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
