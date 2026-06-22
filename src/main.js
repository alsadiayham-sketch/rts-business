const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');

let mainWindow = null;

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

