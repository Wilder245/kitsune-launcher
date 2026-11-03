const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('fox', {
  systemInfo: () => ipcRenderer.invoke('system:info'),
  listVersions: () => ipcRenderer.invoke('versions:list'),
  play: (req) => ipcRenderer.invoke('play', req),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onLog: on('log'),
  onProgress: on('progress'),
  onAuthCode: on('auth:code'),
  onGameState: on('game:state'),
});
