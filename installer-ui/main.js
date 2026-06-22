var electron = require('electron');
var path = require('path');
var fs = require('fs');
var execSync = require('child_process').execSync;

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var dialog = electron.dialog;
var shell = electron.shell;

var mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 560,
    minWidth: 620,
    minHeight: 560,
    maxWidth: 620,
    maxHeight: 560,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#f8f9fc',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', function () {
  app.quit();
});

ipcMain.handle('get-default-path', function () {
  return path.join(process.env.LOCALAPPDATA || 'C:\\Program Files', 'ADA POS');
});

ipcMain.handle('browse-folder', async function () {
  var result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('install', async function (event, options) {
  var installPath = options.path;
  var appSourcePath = path.join(__dirname, '..', 'app-payload');

  try {
    sendStage('Installing application files...');

    if (!fs.existsSync(installPath)) {
      fs.mkdirSync(installPath, { recursive: true });
    }

    if (fs.existsSync(appSourcePath)) {
      var files = getFileList(appSourcePath);
      copyDirSync(appSourcePath, installPath, files.length);
    } else {
      await simulateInstall(installPath);
    }

    sendStage('Creating shortcuts...');
    await wait(350);

    if (options.desktopShortcut) {
      createShortcut(
        path.join(process.env.USERPROFILE || '', 'Desktop', 'ADA POS.lnk'),
        path.join(installPath, 'ADA POS.exe'),
        installPath
      );
    }

    if (options.startMenuShortcut) {
      var startMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ADA POS');
      if (!fs.existsSync(startMenu)) {
        fs.mkdirSync(startMenu, { recursive: true });
      }

      createShortcut(
        path.join(startMenu, 'ADA POS.lnk'),
        path.join(installPath, 'ADA POS.exe'),
        installPath
      );
    }

    if (options.addToPath) {
      addFolderToUserPath(installPath);
    }

    sendStage('Registering ADA POS...');
    writeUninstaller(installPath);
    registerUninstaller(installPath);
    await wait(300);

    sendStage('Finalizing installation...');
    sendProgress({
      percent: 100,
      file: 'Installation complete'
    });
    await wait(350);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-app', function (event, installPath) {
  var exe = path.join(installPath, 'ADA POS.exe');
  if (fs.existsSync(exe)) {
    shell.openPath(exe);
  }
  app.quit();
});

ipcMain.handle('close', function () {
  app.quit();
});

function sendStage(text) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('install-stage', { text: text });
  }
}

function sendProgress(payload) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('install-progress', payload);
  }
}

function getFileList(src) {
  var files = [];
  var entries = fs.readdirSync(src, { withFileTypes: true });

  entries.forEach(function (entry) {
    var srcPath = path.join(src, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFileList(srcPath));
    } else {
      files.push(srcPath);
    }
  });

  return files;
}

function copyDirSync(src, dest, totalFiles) {
  var copiedFiles = 0;

  function walk(from, to) {
    if (!fs.existsSync(to)) {
      fs.mkdirSync(to, { recursive: true });
    }

    var entries = fs.readdirSync(from, { withFileTypes: true });

    entries.forEach(function (entry) {
      var srcPath = path.join(from, entry.name);
      var destPath = path.join(to, entry.name);

      if (entry.isDirectory()) {
        walk(srcPath, destPath);
        return;
      }

      fs.copyFileSync(srcPath, destPath);
      copiedFiles += 1;
      sendProgress({
        percent: totalFiles ? Math.min(92, Math.round((copiedFiles / totalFiles) * 92)) : 0,
        file: path.relative(src, srcPath)
      });
    });
  }

  walk(src, dest);
}

async function simulateInstall(installPath) {
  var demoFiles = [
    'ADA POS.exe',
    'resources\\app.asar',
    'resources\\assets\\logo.png',
    'resources\\data\\bootstrap.json',
    'locales\\en-US.pak',
    'chrome_100_percent.pak'
  ];

  var i;
  for (i = 0; i < demoFiles.length; i += 1) {
    await wait(280);
    ensureDemoFile(installPath, demoFiles[i], i === 0);
    sendProgress({
      percent: Math.round(((i + 1) / demoFiles.length) * 82),
      file: demoFiles[i]
    });
  }
}

function ensureDemoFile(installPath, relativeFile, isExecutable) {
  var targetFile = path.join(installPath, relativeFile);
  var targetDir = path.dirname(targetFile);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  if (isExecutable) {
    fs.writeFileSync(
      targetFile,
      'This is a placeholder ADA POS executable for installer UI testing.\r\n'
    );
    return;
  }

  fs.writeFileSync(
    targetFile,
    'Placeholder file created by ADA POS installer UI.\r\n'
  );
}

function writeUninstaller(installPath) {
  var scriptPath = path.join(installPath, 'Uninstall ADA POS.cmd');
  var scriptContent = [
    '@echo off',
    'setlocal',
    'set "INSTALL_DIR=%~dp0"',
    'set "APPDATA_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\ADA POS"',
    'if exist "%USERPROFILE%\\Desktop\\ADA POS.lnk" del /f /q "%USERPROFILE%\\Desktop\\ADA POS.lnk"',
    'if exist "%APPDATA_DIR%\\ADA POS.lnk" del /f /q "%APPDATA_DIR%\\ADA POS.lnk"',
    'if exist "%APPDATA_DIR%" rd /s /q "%APPDATA_DIR%"',
    'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ADAPOS" /f >nul 2>nul',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Start-Sleep -Milliseconds 400; Remove-Item -LiteralPath '%INSTALL_DIR%' -Recurse -Force\"",
    'endlocal'
  ].join('\r\n');

  fs.writeFileSync(scriptPath, scriptContent, 'utf8');
}

function registerUninstaller(installPath) {
  var exePath = path.join(installPath, 'ADA POS.exe');
  var uninstallPath = path.join(installPath, 'Uninstall ADA POS.cmd');
  var key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ADAPOS';

  execSync(
    'reg add "' + key + '" /v DisplayName /t REG_SZ /d "ADA POS" /f',
    { windowsHide: true }
  );
  execSync(
    'reg add "' + key + '" /v DisplayVersion /t REG_SZ /d "2.1.0" /f',
    { windowsHide: true }
  );
  execSync(
    'reg add "' + key + '" /v Publisher /t REG_SZ /d "ADA" /f',
    { windowsHide: true }
  );
  execSync(
    'reg add "' + key + '" /v InstallLocation /t REG_SZ /d "' + installPath + '" /f',
    { windowsHide: true }
  );
  execSync(
    'reg add "' + key + '" /v DisplayIcon /t REG_SZ /d "' + exePath + '" /f',
    { windowsHide: true }
  );
  execSync(
    'reg add "' + key + '" /v UninstallString /t REG_SZ /d "\\"' + uninstallPath + '\\"" /f',
    { windowsHide: true }
  );
}

function addFolderToUserPath(folderPath) {
  try {
    var ps = '$current = [Environment]::GetEnvironmentVariable("Path", "User"); ' +
      'if ($current -and $current.ToLower().Contains("' + escapeForPowerShell(folderPath.toLowerCase()) + '")) { return }; ' +
      '$newValue = if ($current) { $current + ";" + "' + escapeForPowerShell(folderPath) + '" } else { "' + escapeForPowerShell(folderPath) + '" }; ' +
      '[Environment]::SetEnvironmentVariable("Path", $newValue, "User")';

    execSync('powershell -NoProfile -Command "' + ps + '"', { windowsHide: true });
  } catch (e) {
    // PATH update is non-fatal
  }
}

function createShortcut(lnkPath, targetPath, workDir) {
  var lnkDir = path.dirname(lnkPath);
  if (!fs.existsSync(lnkDir)) {
    fs.mkdirSync(lnkDir, { recursive: true });
  }

  var ps =
    '$ws = New-Object -ComObject WScript.Shell; ' +
    '$s = $ws.CreateShortcut(\'' + escapePsString(lnkPath) + '\'); ' +
    '$s.TargetPath = \'' + escapePsString(targetPath) + '\'; ' +
    '$s.WorkingDirectory = \'' + escapePsString(workDir) + '\'; ' +
    '$s.IconLocation = \'' + escapePsString(targetPath) + '\'; ' +
    '$s.Save()';

  try {
    execSync('powershell -NoProfile -Command "' + ps + '"', { windowsHide: true });
  } catch (e) {
    // Shortcut creation is non-fatal
  }
}

function escapePsString(value) {
  return String(value).replace(/'/g, "''");
}

function escapeForPowerShell(value) {
  return String(value).replace(/`/g, '``').replace(/"/g, '`"');
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
