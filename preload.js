const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (data) => ipcRenderer.invoke('file:save', data),

  // PDF processing
  processPDF: (filePath) => ipcRenderer.invoke('pdf:process', filePath),

  // Export operations
  exportRaster: (data) => ipcRenderer.invoke('export:raster', data),
  exportVector: (data) => ipcRenderer.invoke('export:vector', data)
});
