/**
 * AirBorneo Coming Home — offline Mac app.
 *
 * Starts the demo server (game + PeerJS pairing over HTTPS on the local Wi-Fi) inside the app and
 * shows the big-screen game fullscreen. Phones on the same Wi-Fi scan the QR code as usual.
 */
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Let the engine sound start without a click on the big screen.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let serverUrl = null;
let serverHost = null;

// The game is served with a self-signed certificate; trust it only for our own server.
app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  const ok = serverHost && new URL(url).hostname === serverHost;
  if (ok) event.preventDefault();
  callback(Boolean(ok));
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    fullscreen: true,
    backgroundColor: '#ffffff',
    title: 'AirBorneo Coming Home',
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(serverUrl);
  // Links to other sites (e.g. the README) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    const { startServer } = await import(pathToFileURL(path.join(__dirname, 'serve.mjs')).href);
    const server = await startServer({ distDir: path.join(__dirname, 'app'), certDir: path.join(app.getPath('userData'), 'certs') });
    serverUrl = server.url;
    serverHost = server.host;
  } catch (err) {
    dialog.showErrorBox('AirBorneo could not start', String(err && err.message ? err.message : err));
    app.quit();
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'toggleDevTools' }],
      },
      {
        label: 'Phone',
        submenu: [
          {
            label: 'Show controller address…',
            click: () =>
              dialog.showMessageBox({
                message: 'Phone controller',
                detail: `On a phone on the same Wi-Fi, open:\n${serverUrl}controller.html\n\nOr scan the QR code on the title screen. Accept the certificate warning once.`,
              }),
          },
        ],
      },
    ]),
  );
  await createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
