const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');

// Performance: disable hardware acceleration if not needed for 2D app
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-software-rasterizer');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Aqqad POS',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false, // Don't show until ready (faster perceived load)
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: false // Security: disable devtools in production
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // Show window once DOM is ready (faster perceived startup)
  mainWindow.once('ready-to-show', function () {
    mainWindow.show();
    mainWindow.focus();
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

