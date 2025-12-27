// preload.js - 렌더러와 메인 프로세스 간 안전한 통신
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 폴더 선택 다이얼로그
    selectFolder: () => ipcRenderer.invoke('select-folder'),

    // 파일 선택 다이얼로그
    selectFile: () => ipcRenderer.invoke('select-file'),

    // 여러 항목 선택 (폴더 또는 파일)
    selectMultiple: (type) => ipcRenderer.invoke('select-multiple', type),

    // 윈도우 컨트롤
    minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
    maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
    closeWindow: () => ipcRenderer.invoke('window-close'),

    // Electron 환경 확인
    isElectron: true
});
