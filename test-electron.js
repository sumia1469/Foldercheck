const electron = require('electron');
console.log('electron type:', typeof electron);
console.log('electron value:', electron);
console.log('app type:', typeof electron.app);
console.log('ipcMain type:', typeof electron.ipcMain);

if (typeof electron === 'object') {
    const { app } = electron;
    app.whenReady().then(() => {
        console.log('App ready!');
        app.quit();
    });
} else {
    console.log('Electron module is not an object - possibly not running in Electron runtime');
    process.exit(1);
}
