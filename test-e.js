console.log('=== Electron Process Test ===');
console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);

if (process.type === 'browser') {
    console.log('Running in main process');
    const { app } = require('electron');
    console.log('app:', typeof app);
    console.log('app.getName:', typeof app.getName);
} else {
    console.log('NOT in main/browser process');
}
