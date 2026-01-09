console.log('Test script starting...');
console.log('process.type:', process.type);
const electron = require('electron');
console.log('electron type:', typeof electron);
console.log('electron keys:', Object.keys(electron).slice(0, 10));
if (electron.app) {
    console.log('electron.app exists');
    electron.app.on('ready', () => {
        console.log('App ready!');
        electron.app.quit();
    });
} else {
    console.log('electron.app does not exist');
}
