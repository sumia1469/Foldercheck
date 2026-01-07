// 최소한의 Electron 테스트
console.log('Script started');
console.log('Process type:', process.type);
console.log('Module search paths:', module.paths);

try {
    const electron = require('electron');
    console.log('electron type:', typeof electron);
    console.log('electron:', electron);

    if (typeof electron === 'object' && electron.app) {
        const { app, BrowserWindow } = electron;
        console.log('app:', typeof app);
        app.whenReady().then(() => {
            console.log('App ready!');
            const win = new BrowserWindow({ width: 400, height: 300 });
            win.loadURL('about:blank');
            setTimeout(() => app.quit(), 2000);
        });
    } else {
        console.error('Electron module not properly loaded');
        console.log('Possibly running outside Electron runtime');
        process.exit(1);
    }
} catch (err) {
    console.error('Error:', err);
    process.exit(1);
}
