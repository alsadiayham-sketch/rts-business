const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Aqqad POS',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
