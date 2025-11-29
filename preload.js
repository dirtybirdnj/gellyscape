const { ipcRenderer } = require('electron');

// With nodeIntegration: true and contextIsolation: false,
// we expose APIs directly on window (contextBridge doesn't work)
window.electronAPI = {
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (data) => ipcRenderer.invoke('file:save', data),

  // PDF processing - lightweight version (keeps paths in main process)
  processPDFLightweight: (filePath) => ipcRenderer.invoke('pdf:processLightweight', filePath),
  getLayerInfo: () => ipcRenderer.invoke('pdf:getLayerInfo'),

  // SVG generation (runs in main process)
  generateSVG: (options) => ipcRenderer.invoke('svg:generate', options),
  exportSVG: (options) => ipcRenderer.invoke('svg:export', options),

  // Get debug info about layers and bounds
  getDebugInfo: () => ipcRenderer.invoke('pdf:getDebugInfo'),

  // Progress callback
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
  cropWithVpype: (data) => ipcRenderer.invoke('vpype:crop', data),

  // Path operations
  getGellyScapePath: () => ipcRenderer.invoke('path:gellyscape'),
  showInFinder: (filePath) => ipcRenderer.invoke('file:showInFinder', filePath),

  // File dialogs and writing
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),
  writeFile: (data) => ipcRenderer.invoke('file:write', data),

  // Recent files
  getRecentFiles: () => ipcRenderer.invoke('files:getRecent'),
  removeRecentFile: (filePath) => ipcRenderer.invoke('files:removeRecent', filePath),
  clearRecentFiles: () => ipcRenderer.invoke('files:clearRecent'),
  fileExists: (filePath) => ipcRenderer.invoke('files:exists', filePath),
  addRecentFile: (filePath, metadata) => ipcRenderer.invoke('files:addRecent', { filePath, metadata }),

  // Text extraction
  extractText: (filePath) => ipcRenderer.invoke('pdf:extractText', filePath),

  // Path inspection
  getLayerPaths: (layerName) => ipcRenderer.invoke('pdf:getLayerPaths', layerName),
  getPathGeometry: (layerName, pathIndex) => ipcRenderer.invoke('pdf:getPathGeometry', { layerName, pathIndex })
};
