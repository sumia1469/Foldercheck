console.log('=== Electron Module Test ===');
console.log('CWD:', process.cwd());
console.log('NODE_PATH:', process.env.NODE_PATH);

try {
    const electron = require('electron');
    console.log('electron type:', typeof electron);
    
    if (typeof electron === 'string') {
        console.log('ERROR: electron is a string path:', electron);
    } else if (typeof electron === 'object') {
        console.log('electron keys:', Object.keys(electron));
        console.log('app exists:', !!electron.app);
        console.log('BrowserWindow exists:', !!electron.BrowserWindow);
    }
} catch (e) {
    console.log('Error loading electron:', e.message);
}
