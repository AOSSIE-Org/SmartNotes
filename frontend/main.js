const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
  });

  win.loadURL('http://127.0.0.1:5000');
}

app.whenReady().then(createWindow);