const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (data) => ipcRenderer.invoke('file:save', data),

  // PDF processing
  processPDF: (filePath) => ipcRenderer.invoke('pdf:process', filePath),
  onPDFProgress: (callback) => {
    const subscription = (event, progress) => callback(progress);
    ipcRenderer.on('pdf:progress', subscription);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('pdf:progress', subscription);
  },

  // Export operations
  exportRaster: (data) => ipcRenderer.invoke('export:raster', data),
  exportVector: (data) => ipcRenderer.invoke('export:vector', data),

  // vpype operations
  checkVpype: () => ipcRenderer.invoke('vpype:check'),
  cropWithVpype: (data) => ipcRenderer.invoke('vpype:crop', data)
});
