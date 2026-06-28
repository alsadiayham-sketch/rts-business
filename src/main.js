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

  // Prevent opening DevTools via keyboard. F12 is intentionally left free so it
  // can be used as a configurable POS shortcut — DevTools is already disabled
  // via webPreferences.devTools:false, so F12 cannot open the inspector anyway.
  mainWindow.webContents.on('before-input-event', function (event, input) {
    if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
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
//
// `opts` (all optional, used by the Settings > Printer Test tool and saved preferences):
//   - deviceName : exact Windows printer name to print to. When omitted, the OS default
//                  printer is used (silent print always targets the default otherwise).
//   - pageSize   : 'auto' (or omitted) | '58mm' | '80mm'.
//        * 'auto'  -> do NOT pass a pageSize. The receipt CSS declares `@page {size:58mm auto}`
//                    and the thermal driver uses its own configured roll width. This is the
//                    simple, proven path. Passing a custom micron pageSize made many thermal
//                    drivers reject the job and feed a blank/tiny bill (the regression we fixed).
//        * '58mm'/'80mm' -> pass an explicit width with a measured height. Offered only as a
//                    fallback for printers that need an explicit size; let the user test which
//                    one actually prints cleanly on their hardware.
ipcMain.handle('print-html', function (event, html, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var printWin = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, devTools: false }
    });
    var done = false;
    function finish(result) {
      if (done) return;
      done = true;
      setTimeout(function () { if (printWin && !printWin.isDestroyed()) printWin.close(); }, 1000);
      resolve(result);
    }
    function runPrint(printOptions) {
      try {
        printWin.webContents.print(
          printOptions,
          function (success, failureReason) { finish({ success: success, reason: failureReason || '' }); }
        );
      } catch (e) {
        finish({ success: false, reason: String(e && e.message || e) });
      }
    }
    function doPrint() {
      var base = {
        silent: true,
        printBackground: true,
        color: false,
        margins: { marginType: 'none' }
      };
      if (opts.deviceName) base.deviceName = String(opts.deviceName);
      var mode = opts.pageSize;
      if (mode === '58mm' || mode === '80mm') {
        // Explicit width + height measured from the rendered receipt (microns @ 96dpi).
        var widthMicrons = mode === '80mm' ? 80000 : 58000;
        printWin.webContents.executeJavaScript(
          'Math.ceil((document.body && document.body.scrollHeight) || 0)'
        ).then(function (h) {
          var MICRONS_PER_PX = 264.5833;
          h = Number(h) || 0;
          if (h < 40) h = 600;
          var heightMicrons = Math.round(h * MICRONS_PER_PX) + 8000;
          if (heightMicrons < 60000) heightMicrons = 60000;
          base.pageSize = { width: widthMicrons, height: heightMicrons };
          runPrint(base);
        }).catch(function () {
          base.pageSize = { width: widthMicrons, height: 200000 };
          runPrint(base);
        });
      } else {
        // 'auto' / default: no pageSize — proven thermal path.
        runPrint(base);
      }
    }
    printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    printWin.webContents.on('did-finish-load', function () {
      // Small delay so the renderer fully lays out the receipt before printing.
      setTimeout(doPrint, 300);
    });
    printWin.webContents.on('did-fail-load', function () { finish({ success: false, reason: 'load failed' }); });
    setTimeout(function () { finish({ success: false, reason: 'timeout' }); }, 15000);
  });
});

// Returns the list of installed printers (name, display name, default flag, status)
// so the Settings > Printer Test tool can let the user pick the thermal printer.
ipcMain.handle('list-printers', function () {
  try {
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.getPrintersAsync) {
      return mainWindow.webContents.getPrintersAsync().then(function (printers) {
        return (printers || []).map(function (p) {
          return { name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault, status: p.status };
        });
      }).catch(function () { return []; });
    }
  } catch (e) {}
  return Promise.resolve([]);
});



