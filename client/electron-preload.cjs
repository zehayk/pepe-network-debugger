const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openDevTools: () => ipcRenderer.send('open-devtools'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  openCertFolder: () => ipcRenderer.send('open-cert-folder'),
  onRequestClose: (cb) => ipcRenderer.on('request-close', () => cb()),
  confirmClose: () => ipcRenderer.send('confirm-close'),

  // Background service management
  serviceStatus: () => ipcRenderer.invoke('service-status'),
  serviceInstall: () => ipcRenderer.invoke('service-install'),
  serviceStart: () => ipcRenderer.invoke('service-start'),
  serviceStop: () => ipcRenderer.invoke('service-stop'),
  serviceUninstall: () => ipcRenderer.invoke('service-uninstall'),
  serviceRunInteractive: () => ipcRenderer.invoke('service-run-interactive'),
  notifyProxyChange: () => ipcRenderer.invoke('notify-proxy-change'),
})
