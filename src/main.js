const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow = null;

// In-app auto-update (electron-updater). Pulls the new build from the public
// GitHub releases repo and installs it in place — no manual download needed.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdater(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data || {});
  }
}

autoUpdater.on('update-available', function (info) {
  sendUpdater('updater-available', { version: info && info.version });
});
autoUpdater.on('update-not-available', function () {
  sendUpdater('updater-none', {});
});
autoUpdater.on('download-progress', function (p) {
  sendUpdater('updater-progress', {
    percent: p.percent || 0,
    transferred: p.transferred || 0,
    total: p.total || 0,
    bytesPerSecond: p.bytesPerSecond || 0
  });
});
autoUpdater.on('update-downloaded', function (info) {
  sendUpdater('updater-downloaded', { version: info && info.version });
});
autoUpdater.on('error', function (err) {
  sendUpdater('updater-error', { message: String((err && err.message) || err) });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'ADA POS',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: true,
    backgroundColor: '#f8f9fc',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // Prevent opening DevTools via keyboard
  mainWindow.webContents.on('before-input-event', function (event, input) {
    if (input.key === 'F12' || (input.control && input.shift && (input.key === 'I' || input.key === 'i'))) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Security: Block new windows and navigation to external URLs
app.on('web-contents-created', function (event, contents) {
  contents.on('will-navigate', function (navEvent, url) {
    if (!url.startsWith('file://')) {
      navEvent.preventDefault();
    }
  });
  contents.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
});

// IPC: Show save dialog for export
ipcMain.handle('show-save-dialog', async function (event, options) {
  var result = await dialog.showSaveDialog(mainWindow, options);
  return result;
});

// IPC: Show open dialog for import
ipcMain.handle('show-open-dialog', async function (event, options) {
  var result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// IPC: Start the in-app update (download from GitHub releases).
// Returns ok:false with a reason so the renderer can fall back to a browser download.
ipcMain.handle('updater-start', async function () {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
});

// IPC: Quit and install the downloaded update, then relaunch.
ipcMain.handle('updater-install', function () {
  try {
    setImmediate(function () { autoUpdater.quitAndInstall(true, true); });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
});
// Loads the HTML in a hidden window and prints without a dialog (POS thermal printer).
ipcMain.handle('print-html', function (event, html) {
  return new Promise(function (resolve) {
    var printWin = new BrowserWindow({
      show: false,
      width: 380,
      height: 800,
      paintWhenInitiallyHidden: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: false, offscreen: false }
    });
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      setTimeout(function () { if (printWin && !printWin.isDestroyed()) printWin.close(); }, 1200);
      resolve(result);
    }
    function doPrint() {
      try {
        printWin.webContents.print(
          { silent: true, printBackground: true, color: false, margins: { marginType: 'none' } },
          function (success, failureReason) { finish({ success: success, reason: failureReason || '' }); }
        );
      } catch (e) {
        finish({ success: false, reason: String(e && e.message || e) });
      }
    }
    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    printWin.webContents.on('did-finish-load', function () {
      // Wait for the renderer to actually paint the receipt before printing,
      // otherwise the thermal printer spits out a blank page.
      setTimeout(doPrint, 450);
    });
    printWin.webContents.on('did-fail-load', function () { finish({ success: false, reason: 'load failed' }); });
    setTimeout(function () { finish({ success: false, reason: 'timeout' }); }, 15000);
  });
});

