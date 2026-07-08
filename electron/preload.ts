const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (key: string) => ipcRenderer.invoke('set-api-key', key),
  clearApiKey: () => ipcRenderer.invoke('clear-api-key'),
  isFirstLaunch: () => ipcRenderer.invoke('is-first-launch'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
});

// Forward the 'open-settings' message from the Electron app menu to the renderer
// as a custom DOM event so the React app can pick it up.
ipcRenderer.on('open-settings', () => {
  window.dispatchEvent(new CustomEvent('electron-open-settings'));
});
