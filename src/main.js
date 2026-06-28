const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
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

// Gathers deep printer diagnostics via PowerShell (driver, port, paper size, status,
// default printer) plus Electron/Chrome/OS versions. This is what lets us tell WHY a
// thermal printer feeds a blank/tiny bill — almost always a wrong PaperSize or driver
// in the Windows printer config. Returned to the renderer to be logged + exported.
ipcMain.handle('printer-diagnostics', function () {
  var versions = {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    osRelease: require('os').release(),
    arch: process.arch
  };
  var psScript =
    '$ErrorActionPreference="SilentlyContinue";' +
    '$out = Get-CimInstance Win32_Printer | ForEach-Object {' +
    '  $cfg = $null;' +
    '  try { $cfg = Get-PrintConfiguration -PrinterName $_.Name -ErrorAction Stop } catch {};' +
    '  $jobs = @(Get-PrintJob -PrinterName $_.Name -ErrorAction SilentlyContinue | ForEach-Object {' +
    '    [PSCustomObject]@{ Id=$_.Id; Doc="$($_.DocumentName)"; Status="$($_.JobStatus)"; Size=$_.Size }' +
    '  });' +
    '  [PSCustomObject]@{' +
    '    Name=$_.Name; Default=$_.Default; DriverName=$_.DriverName; PortName=$_.PortName;' +
    '    WorkOffline=$_.WorkOffline; PrinterStatus=$_.PrinterStatus; PrinterState=$_.PrinterState;' +
    '    PaperSize= if($cfg){ "$($cfg.PaperSize)" } else { $null };' +
    '    Collate= if($cfg){ $cfg.Collate } else { $null };' +
    '    QueuedJobs= $jobs.Count; Jobs= $jobs;' +
    '    DriverPaper= ($_.PrinterPaperNames -join ", ")' +
    '  }' +
    '};' +
    'if($out -eq $null){ "[]" } else { $out | ConvertTo-Json -Depth 5 -Compress }';
  return new Promise(function (resolve) {
    var settled = false;
    function done(result) { if (settled) return; settled = true; resolve(result); }
    try {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 12000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        function (err, stdout, stderr) {
          var printers = [];
          try {
            var parsed = JSON.parse((stdout || '').trim() || '[]');
            printers = Array.isArray(parsed) ? parsed : [parsed];
          } catch (e) {}
          done({
            versions: versions,
            printers: printers,
            psError: err ? String(err.message || err) : (stderr ? String(stderr).trim() : '')
          });
        });
    } catch (e) {
      done({ versions: versions, printers: [], psError: String(e && e.message || e) });
    }
  });
});

// Sends RAW bytes straight to a printer via the Windows spooler (WritePrinter with the
// "RAW" datatype, P/Invoked through PowerShell). This is how dedicated POS apps drive
// thermal printers: ESC/POS commands bypass the GDI graphics driver entirely, so they
// print on hardware where Chromium's graphical print (and PDF viewers) come out blank.
// `opts`: { printerName, base64 }  -> base64 is the raw byte stream to send.
ipcMain.handle('print-raw', function (event, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var settled = false;
    function done(r) { if (settled) return; settled = true; resolve(r); }
    var printerName = String(opts.printerName || '');
    if (!printerName) { done({ success: false, reason: 'no-printer-selected' }); return; }
    var bytes;
    try { bytes = Buffer.from(String(opts.base64 || ''), 'base64'); }
    catch (e) { done({ success: false, reason: 'bad-data' }); return; }
    if (!bytes.length) { done({ success: false, reason: 'empty-data' }); return; }
    var tmpFile = path.join(os.tmpdir(), 'ada_raw_' + Date.now() + '.bin');
    try { fs.writeFileSync(tmpFile, bytes); }
    catch (e) { done({ success: false, reason: 'tmp-write-failed: ' + (e && e.message || e) }); return; }

    var psScript =
      '$ErrorActionPreference="Stop";' +
      '$code=@"' + '\n' +
      'using System;using System.IO;using System.Runtime.InteropServices;' + '\n' +
      'public class RawPrinterHelper{' + '\n' +
      '[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public class DOCINFOA{public string pDocName;public string pOutputFile;public string pDataType;}' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="OpenPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src,out IntPtr h,IntPtr pd);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="ClosePrinter",SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="StartDocPrinterW",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h,int level,[In] DOCINFOA di);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="EndDocPrinter",SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="StartPagePrinter",SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="EndPagePrinter",SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);' + '\n' +
      '[DllImport("winspool.Drv",EntryPoint="WritePrinter",SetLastError=true)] public static extern bool WritePrinter(IntPtr h,IntPtr buf,int count,out int written);' + '\n' +
      'public static string Send(string printer,byte[] bytes){IntPtr h;var di=new DOCINFOA();di.pDocName="ADA POS Receipt";di.pDataType="RAW";' + '\n' +
      'if(!OpenPrinter(printer,out h,IntPtr.Zero)) return "OPEN_FAIL:"+Marshal.GetLastWin32Error();' + '\n' +
      'string r="UNKNOWN";try{if(StartDocPrinter(h,1,di)){if(StartPagePrinter(h)){IntPtr p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);int w;bool ok=WritePrinter(h,p,bytes.Length,out w);Marshal.FreeHGlobal(p);EndPagePrinter(h);r=ok?("OK:"+w):("WRITE_FAIL:"+Marshal.GetLastWin32Error());}else{r="STARTPAGE_FAIL:"+Marshal.GetLastWin32Error();}EndDocPrinter(h);}else{r="STARTDOC_FAIL:"+Marshal.GetLastWin32Error();}}finally{ClosePrinter(h);}return r;}' + '\n' +
      '}' + '\n' +
      '"@;' +
      'Add-Type -TypeDefinition $code -Language CSharp;' +
      '$bytes=[System.IO.File]::ReadAllBytes($env:ADA_RAW_FILE);' +
      '[RawPrinterHelper]::Send($env:ADA_RAW_PRINTER,$bytes)';

    try {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 15000, windowsHide: true, env: Object.assign({}, process.env, { ADA_RAW_FILE: tmpFile, ADA_RAW_PRINTER: printerName }) },
        function (err, stdout, stderr) {
          try { fs.unlinkSync(tmpFile); } catch (e) {}
          var out = String(stdout || '').trim();
          if (!err && out.indexOf('OK:') === 0) done({ success: true, reason: out });
          else done({ success: false, reason: out || String((err && err.message) || stderr || 'raw-print-failed') });
        });
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch (e2) {}
      done({ success: false, reason: String(e && e.message || e) });
    }
  });
});

// Purges all pending jobs from a printer's queue. A single stuck/errored job (common
// after a failed graphical print to a thermal driver) blocks every later job — including
// RAW ESC/POS — so the printer goes silent. Clearing the queue unblocks it.
ipcMain.handle('clear-print-queue', function (event, printerName) {
  return new Promise(function (resolve) {
    var settled = false;
    function done(r) { if (settled) return; settled = true; resolve(r); }
    var name = String(printerName || '');
    var psScript = name
      ? '$ErrorActionPreference="SilentlyContinue";' +
        '$j = @(Get-PrintJob -PrinterName "' + name.replace(/"/g, '') + '");' +
        '$j | Remove-PrintJob; "REMOVED:" + $j.Count'
      : '$ErrorActionPreference="SilentlyContinue";' +
        '$n=0; Get-Printer | ForEach-Object { $j=@(Get-PrintJob -PrinterName $_.Name); $n+=$j.Count; $j | Remove-PrintJob }; "REMOVED:" + $n';
    try {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        { timeout: 12000, windowsHide: true },
        function (err, stdout, stderr) {
          var out = String(stdout || '').trim();
          if (!err && out.indexOf('REMOVED:') === 0) done({ success: true, removed: parseInt(out.split(':')[1], 10) || 0 });
          else done({ success: false, reason: out || String((err && err.message) || stderr || 'clear-failed') });
        });
    } catch (e) {
      done({ success: false, reason: String(e && e.message || e) });
    }
  });
});


