// Minimal Electron shell: opens the hosted TTu web app in its own window.
const { app, BrowserWindow, shell } = require('electron');
const URL_ = process.env.TTU_URL || 'https://ttu.hadtah.com';
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1100, height: 800, minWidth: 360, backgroundColor: '#f6fbf9', title: 'TTu',
    icon: __dirname + '/../public/icons/icon-256.png', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
  win.loadURL(URL_);
  // Source links open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(URL_)) shell.openExternal(url); return { action: 'deny' }; });
});
app.on('window-all-closed', () => app.quit());
