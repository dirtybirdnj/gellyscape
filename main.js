const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const PDFProcessor = require('./src/pdf-processor');
const ENCAPIProcessor = require('./src/enc-api-processor');
const SVGGenerator = require('./src/svg-generator');

const execAsync = promisify(exec);

let mainWindow;
let gellyScapeDir;
let recentFilesPath;
const MAX_RECENT_FILES = 20;

// Store processed PDF data in main process (avoid sending huge path arrays to renderer)
let currentPDFPaths = null;
let currentPDFMetadata = null;
let currentSVGGenerator = null;

// Create gellyscape directory in user's home folder
async function ensureGellyScapeDir() {
  const homeDir = os.homedir();
  gellyScapeDir = path.join(homeDir, 'gellyscape');
  recentFilesPath = path.join(gellyScapeDir, 'recent-files.json');

  try {
    await fs.mkdir(gellyScapeDir, { recursive: true });
    console.log('GellyScape directory ready:', gellyScapeDir);
  } catch (error) {
    console.error('Error creating GellyScape directory:', error);
  }

  return gellyScapeDir;
}

// Recent files management
async function loadRecentFiles() {
  try {
    const data = await fs.readFile(recentFilesPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist or is invalid - return empty array
    return [];
  }
}

async function saveRecentFiles(files) {
  try {
    await fs.writeFile(recentFilesPath, JSON.stringify(files, null, 2));
  } catch (error) {
    console.error('Error saving recent files:', error);
  }
}

async function addRecentFile(filePath, metadata = {}) {
  const recentFiles = await loadRecentFiles();

  // Create entry with metadata
  const entry = {
    path: filePath,
    name: path.basename(filePath),
    lastOpened: new Date().toISOString(),
    // Extract useful info from metadata
    title: metadata.Title || path.basename(filePath, '.pdf'),
    isGeoPDF: metadata.isGeoPDF || false,
    pageDimensions: metadata.pageDimensions || null,
    neatline: metadata.neatline || null,
    geoBounds: metadata.geoBounds || null,
    pathCount: metadata.pathCount || 0
  };

  // Remove if already exists (will re-add at top)
  const filteredFiles = recentFiles.filter(f => f.path !== filePath);

  // Add to beginning
  filteredFiles.unshift(entry);

  // Limit to max recent files
  const limitedFiles = filteredFiles.slice(0, MAX_RECENT_FILES);

  await saveRecentFiles(limitedFiles);
  return limitedFiles;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,  // Enable Node.js in renderer for direct PDF processing
      contextIsolation: false, // Required for nodeIntegration
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Disable caching in development to ensure code changes are picked up immediately
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    details.requestHeaders['Pragma'] = 'no-cache';
    callback({ requestHeaders: details.requestHeaders });
  });

  mainWindow.loadFile('renderer/index.html');

  // Open DevTools in development
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  await ensureGellyScapeDir();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

// Open file dialog and select PDF or ENC files
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'All Supported Files', extensions: ['pdf', '000'] },
      { name: 'PDF Files', extensions: ['pdf'] },
      { name: 'NOAA ENC Charts (S-57)', extensions: ['000'] }
    ]
  });

  if (canceled) {
    return null;
  }

  return filePaths[0];
});

// Helper: Detect file type from extension and content
function detectFileType(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();

  // Check by extension first
  if (ext === '.000') {
    return 'enc';
  }

  if (ext === '.pdf') {
    // Verify it's actually a PDF by checking magic bytes
    const pdfMagicBytes = Buffer.from('%PDF-', 'utf8');
    if (buffer.length >= pdfMagicBytes.length &&
        buffer.subarray(0, pdfMagicBytes.length).equals(pdfMagicBytes)) {
      return 'pdf';
    }
  }

  // Try to detect by content
  const pdfMagicBytes = Buffer.from('%PDF-', 'utf8');
  if (buffer.length >= pdfMagicBytes.length &&
      buffer.subarray(0, pdfMagicBytes.length).equals(pdfMagicBytes)) {
    return 'pdf';
  }

  // S-57 files start with specific ISO 8211 header
  // Check for DDR leader (first 24 bytes define the record)
  if (buffer.length >= 24) {
    // ISO 8211 files typically start with record length in ASCII
    const first5 = buffer.subarray(0, 5).toString('ascii');
    if (/^\d{5}$/.test(first5)) {
      return 'enc';
    }
  }

  return 'unknown';
}

// Helper: Validate and read file, returning buffer and type
async function validateAndReadFile(filePath) {
  const fileExtension = path.extname(filePath).toLowerCase();
  const supportedExtensions = ['.pdf', '.000'];

  if (!supportedExtensions.includes(fileExtension)) {
    return {
      error: `Invalid file type: ${fileExtension || 'unknown'}. Supported formats: PDF (.pdf), NOAA ENC (.000)`
    };
  }

  const fileBuffer = await fs.readFile(filePath);
  const fileType = detectFileType(filePath, fileBuffer);

  if (fileType === 'unknown') {
    return { error: 'Unable to determine file type. Please select a valid PDF or S-57 ENC file.' };
  }

  return { buffer: fileBuffer, fileType };
}

// Legacy wrapper for backwards compatibility
async function validatePDFFile(filePath) {
  const result = await validateAndReadFile(filePath);
  if (result.error) return result;
  if (result.fileType !== 'pdf') {
    return { error: 'File does not appear to be a valid PDF.' };
  }
  return { buffer: result.buffer };
}

// Process PDF or ENC file and keep paths in main process
// Only sends layer metadata to renderer, not the full path data
ipcMain.handle('pdf:processLightweight', async (event, filePath) => {
  try {
    event.sender.send('pdf:progress', {
      operation: 'Loading',
      detail: 'Reading file...'
    });

    const validation = await validateAndReadFile(filePath);
    if (validation.error) {
      return { success: false, error: validation.error };
    }

    let result;

    if (validation.fileType === 'enc') {
      // .000 files require the API - direct file parsing is complex
      return {
        success: false,
        error: 'Local S-57 (.000) files are not directly supported.\n\nUse window.electronAPI.fetchENCArea() to load NOAA ENC chart data by geographic coordinates.\n\nExample:\nwindow.electronAPI.fetchENCArea(\n  { minLon: -73.25, minLat: 44.45, maxLon: -73.20, maxLat: 44.50 },\n  { scaleBand: "harbour", layers: ["coastline", "depthContour"] }\n)'
      };

    } else {
      // Process PDF file
      const processor = new PDFProcessor(validation.buffer);
      processor.setProgressCallback((progress) => {
        event.sender.send('pdf:progress', progress);
      });

      result = await processor.process();

      // Validate that this is a GeoPDF with extractable layers
      const isGeoPDF = result.metadata?.isGeoPDF || false;
      const hasLayers = result.metadata?.layers?.length > 0;
      const hasPaths = result.contentPaths?.paths?.length > 0;

      if (!isGeoPDF && !hasLayers && !hasPaths) {
        return {
          success: false,
          error: 'This PDF does not appear to be a USGS GeoPDF.\n\nGellyScape works with:\n• US Topo maps (7.5-minute, 1:24,000 scale)\n• 100K and 250K scale USGS maps\n• GeoPDF files from nationalmap.gov\n\nDownload free USGS topo maps at:\nhttps://apps.nationalmap.gov/downloader/\n\nFor NOAA ENC charts, use the API:\nwindow.electronAPI.fetchENCArea({ minLon, minLat, maxLon, maxLat })'
        };
      }
    }

    // Store paths in main process
    currentPDFPaths = result.contentPaths?.paths || [];
    currentPDFMetadata = result.metadata;

    // Create SVG generator with paths
    currentSVGGenerator = new SVGGenerator(currentPDFPaths);

    // Set neatline if available
    if (result.metadata.neatline) {
      currentSVGGenerator.setNeatline(result.metadata.neatline);
    }

    // Set page dimensions for proper viewBox sizing
    if (result.metadata.pageDimensions) {
      currentSVGGenerator.setPageDimensions(result.metadata.pageDimensions);
    }

    // Get layer info (lightweight - just names and counts)
    // For ENC files, use the layerInfo from the processor if available
    const layerInfo = result.layerInfo || currentSVGGenerator.getAvailableLayers();

    // Track in recent files
    const pathCount = currentPDFPaths.length;
    await addRecentFile(filePath, {
      ...result.metadata,
      pathCount,
      isENC: result.metadata.isENC || false
    });

    event.sender.send('pdf:progress', {
      operation: 'Complete',
      detail: 'Processing finished!'
    });

    // Return lightweight data (no path arrays)
    return {
      success: true,
      data: {
        metadata: result.metadata,
        layerInfo: layerInfo,
        pathCount: pathCount,
        pageCount: result.pageCount,
        // Include bounds from neatline or calculated
        bounds: result.metadata.neatline || null
      }
    };
  } catch (error) {
    console.error('Error processing file:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Fetch NOAA ENC data via API for a geographic area
ipcMain.handle('enc:fetchArea', async (event, { bounds, options }) => {
  try {
    event.sender.send('pdf:progress', {
      operation: 'Loading',
      detail: 'Fetching NOAA ENC chart data...'
    });

    const processor = new ENCAPIProcessor(bounds, {
      scaleBand: options?.scaleBand || 'harbour',
      layers: options?.layers || ['coastline', 'depthContour', 'shoreline']
    });

    processor.setProgressCallback((progress) => {
      event.sender.send('pdf:progress', progress);
    });

    const result = await processor.process();

    // Store paths in main process
    currentPDFPaths = result.contentPaths?.paths || [];
    currentPDFMetadata = result.metadata;

    // Create SVG generator with paths
    currentSVGGenerator = new SVGGenerator(currentPDFPaths);

    // Set neatline if available
    if (result.metadata.neatline) {
      currentSVGGenerator.setNeatline(result.metadata.neatline);
    }

    // Set page dimensions
    if (result.metadata.pageDimensions) {
      currentSVGGenerator.setPageDimensions(result.metadata.pageDimensions);
    }

    // Get layer info
    const layerInfo = result.layerInfo || currentSVGGenerator.getAvailableLayers();
    const pathCount = currentPDFPaths.length;

    event.sender.send('pdf:progress', {
      operation: 'Complete',
      detail: `Loaded ${pathCount} features from NOAA ENC`
    });

    return {
      success: true,
      data: {
        metadata: result.metadata,
        layerInfo: layerInfo,
        pathCount: pathCount,
        pageCount: 1,
        bounds: result.metadata.neatline
      }
    };
  } catch (error) {
    console.error('Error fetching ENC data:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Generate SVG from stored paths (runs in main process)
ipcMain.handle('svg:generate', async (event, { enabledLayers, bounds, options, uiOptions }) => {
  try {
    if (!currentSVGGenerator) {
      return {
        success: false,
        error: 'No file loaded. Please load a GeoPDF or NOAA ENC chart first.'
      };
    }

    // UI options for preview (neatline, document border)
    const uiOpts = {
      showNeatline: uiOptions?.showNeatline !== false, // Default true
      showDocBorder: uiOptions?.showDocBorder !== false // Default true
    };

    const result = currentSVGGenerator.generate(enabledLayers, bounds, uiOpts);

    return {
      success: true,
      svg: result.svg,
      stats: result.stats
    };
  } catch (error) {
    console.error('Error generating SVG:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Generate and save SVG directly to file (avoids sending large string to renderer)
ipcMain.handle('svg:export', async (event, { enabledLayers, bounds, options, filePath }) => {
  try {
    if (!currentSVGGenerator) {
      return {
        success: false,
        error: 'No file loaded. Please load a GeoPDF or ENC chart first.'
      };
    }

    // Update generator options
    if (options) {
      currentSVGGenerator.options = { ...currentSVGGenerator.options, ...options };
    }

    event.sender.send('pdf:progress', {
      operation: 'Generating SVG',
      detail: 'Building vector graphics...'
    });

    // Export WITHOUT UI overlays (no neatline/border)
    const result = currentSVGGenerator.generate(enabledLayers, bounds, {
      showNeatline: false,
      showDocBorder: false
    });

    event.sender.send('pdf:progress', {
      operation: 'Saving',
      detail: 'Writing file...'
    });

    // Save to file
    const finalPath = filePath || path.join(gellyScapeDir, `export-${Date.now()}.svg`);
    await fs.writeFile(finalPath, result.svg);

    return {
      success: true,
      filePath: finalPath,
      stats: result.stats
    };
  } catch (error) {
    console.error('Error exporting SVG:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Get current layer info (if PDF is already loaded)
ipcMain.handle('pdf:getLayerInfo', async () => {
  if (!currentSVGGenerator) {
    return { success: false, error: 'No file loaded' };
  }
  return {
    success: true,
    layerInfo: currentSVGGenerator.getAvailableLayers(),
    pathCount: currentPDFPaths?.length || 0
  };
});

// Get detailed debug info about layers and bounds
ipcMain.handle('pdf:getDebugInfo', async () => {
  if (!currentSVGGenerator) {
    return { success: false, error: 'No file loaded' };
  }
  return {
    success: true,
    debugInfo: currentSVGGenerator.getDebugInfo()
  };
});

// Extract text from PDF
ipcMain.handle('pdf:extractText', async (event, filePath) => {
  try {
    console.log('Extracting text from:', filePath);

    // Import the text extractor module
    const TextExtractor = require('./src/text-extractor');
    const extractor = new TextExtractor();

    const result = await extractor.extract(filePath);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error('Text extraction error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Get paths for a specific layer (for path inspection UI)
ipcMain.handle('pdf:getLayerPaths', async (event, layerName) => {
  try {
    if (!currentSVGGenerator) {
      return { paths: [], message: 'No file loaded' };
    }

    // Parse layer name to extract base layer and color
    const [baseName, colorStr] = layerName.includes('::')
      ? layerName.split('::')
      : [layerName, null];

    // Get paths matching this layer
    const paths = currentSVGGenerator.paths || [];
    const matchingPaths = [];

    paths.forEach((path, index) => {
      const pathLayer = path.layer || 'Unassigned';
      if (pathLayer !== baseName) return;

      // Check color match if specified
      if (colorStr) {
        let pathColor = null;
        if (path.stroke && path.strokeColor) {
          pathColor = `rgb(${path.strokeColor.join(',')})`;
        } else if (path.fill && path.fillColor) {
          pathColor = `rgb(${path.fillColor.join(',')})`;
        }
        if (pathColor !== colorStr) return;
      }

      // Calculate bounds for this path
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      if (path.operations) {
        for (const op of path.operations) {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        }
      }

      matchingPaths.push({
        index,
        operationCount: path.operations?.length || 0,
        hasStroke: !!path.stroke,
        hasFill: !!path.fill,
        bounds: minX !== Infinity ? {
          minX, minY, maxX, maxY,
          width: maxX - minX,
          height: maxY - minY
        } : null
      });
    });

    return { paths: matchingPaths, success: true };
  } catch (error) {
    console.error('Error getting layer paths:', error);
    return { paths: [], error: error.message, success: false };
  }
});

// Get geometry for a specific path (for highlighting)
ipcMain.handle('pdf:getPathGeometry', async (event, { layerName, pathIndex }) => {
  try {
    if (!currentSVGGenerator) {
      return null;
    }

    const paths = currentSVGGenerator.paths || [];
    const path = paths[pathIndex];

    if (!path || !path.operations) {
      return null;
    }

    // Build SVG path data
    let pathData = '';
    for (const op of path.operations) {
      switch (op.type) {
        case 'M':
          pathData += `M${op.x} ${op.y} `;
          break;
        case 'L':
          pathData += `L${op.x} ${op.y} `;
          break;
        case 'C':
          pathData += `C${op.x1} ${op.y1} ${op.x2} ${op.y2} ${op.x} ${op.y} `;
          break;
        case 'Q':
          pathData += `Q${op.x1} ${op.y1} ${op.x} ${op.y} `;
          break;
        case 'Z':
          pathData += 'Z ';
          break;
      }
    }

    return { pathData: pathData.trim() };
  } catch (error) {
    console.error('Error getting path geometry:', error);
    return null;
  }
});

// Export raster layer
ipcMain.handle('export:raster', async (event, data) => {
  try {
    const { defaultPath, filters } = data;

    // Use gellyscape directory if no path specified
    const finalDefaultPath = defaultPath || path.join(gellyScapeDir, 'export.tif');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: finalDefaultPath,
      filters: filters || [
        { name: 'GeoTIFF', extensions: ['tif', 'tiff'] },
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
      ]
    });

    if (canceled) {
      return { success: false, canceled: true };
    }

    return {
      success: true,
      filePath
    };
  } catch (error) {
    console.error('Error exporting raster:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Export vector layer
ipcMain.handle('export:vector', async (event, data) => {
  try {
    const { defaultPath, filters } = data;

    // Use gellyscape directory if no path specified
    const finalDefaultPath = defaultPath || path.join(gellyScapeDir, 'export.svg');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: finalDefaultPath,
      filters: filters || [
        { name: 'SVG', extensions: ['svg'] },
        { name: 'GeoJSON', extensions: ['geojson', 'json'] },
        { name: 'KML', extensions: ['kml'] },
        { name: 'CSV', extensions: ['csv'] }
      ]
    });

    if (canceled) {
      return { success: false, canceled: true };
    }

    return {
      success: true,
      filePath
    };
  } catch (error) {
    console.error('Error exporting vector:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Save file
ipcMain.handle('file:save', async (event, data) => {
  try {
    const { filePath, content, encoding = 'utf8' } = data;
    await fs.writeFile(filePath, content, encoding);

    return {
      success: true,
      filePath
    };
  } catch (error) {
    console.error('Error saving file:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Check if vpype is installed
ipcMain.handle('vpype:check', async () => {
  try {
    const { stdout } = await execAsync('vpype --version');
    return {
      success: true,
      installed: true,
      version: stdout.trim()
    };
  } catch (error) {
    return {
      success: true,
      installed: false,
      error: error.message
    };
  }
});

// Get gellyscape directory path
ipcMain.handle('path:gellyscape', async () => {
  return gellyScapeDir;
});

// Get recent files
ipcMain.handle('files:getRecent', async () => {
  return await loadRecentFiles();
});

// Remove a file from recent files list
ipcMain.handle('files:removeRecent', async (event, filePath) => {
  const recentFiles = await loadRecentFiles();
  const filtered = recentFiles.filter(f => f.path !== filePath);
  await saveRecentFiles(filtered);
  return filtered;
});

// Clear all recent files
ipcMain.handle('files:clearRecent', async () => {
  await saveRecentFiles([]);
  return [];
});

// Check if a file exists (for validating recent files)
ipcMain.handle('files:exists', async (event, filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// Add a file to recent files (called from renderer when processing directly)
ipcMain.handle('files:addRecent', async (event, { filePath, metadata }) => {
  return await addRecentFile(filePath, metadata);
});

// Show file in Finder/Explorer
ipcMain.handle('file:showInFinder', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('Error showing file in Finder:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Show save dialog
ipcMain.handle('dialog:save', async (event, options) => {
  try {
    const result = await dialog.showSaveDialog({
      title: options.title || 'Save File',
      defaultPath: options.defaultPath,
      filters: options.filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    return result.canceled ? null : result.filePath;
  } catch (error) {
    console.error('Error showing save dialog:', error);
    return null;
  }
});

// Write file
ipcMain.handle('file:write', async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error writing file:', error);
    return { success: false, error: error.message };
  }
});

// Run vpype crop command - process each layer individually to preserve layer structure
ipcMain.handle('vpype:crop', async (event, data) => {
  try {
    const { svgContent, cropX, cropY, cropWidth, cropHeight, paperSize } = data;

    // Round crop values to 2 decimal places for cleaner command
    const x = cropX.toFixed(2);
    const y = cropY.toFixed(2);
    const w = cropWidth.toFixed(2);
    const h = cropHeight.toFixed(2);


    // Parse the SVG to extract layers
    const layerRegex = /<g id="layer-([^"]+)" data-layer="([^"]+)">([\s\S]*?)<\/g>/g;
    const layers = [];
    let match;

    while ((match = layerRegex.exec(svgContent)) !== null) {
      layers.push({
        id: match[1],
        name: match[2],
        content: match[3]
      });
    }

    // Extract viewBox for creating individual layer SVGs
    const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 800 600';

    // Create temporary directory for this operation
    const tmpDir = os.tmpdir();
    const timestamp = Date.now();

    // Process each layer through vpype individually
    const processedLayers = [];

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];

      // Create a temporary SVG for this layer only
      const layerSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <g id="layer-${layer.id}" data-layer="${layer.name}">
${layer.content}
  </g>
</svg>`;

      const layerInputPath = path.join(tmpDir, `layer-${timestamp}-${i}-input.svg`);
      const layerOutputPath = path.join(tmpDir, `layer-${timestamp}-${i}-output.svg`);

      await fs.writeFile(layerInputPath, layerSvg, 'utf8');

      // Build vpype command for this layer
      const attrs = '--attr fill --attr stroke --attr stroke-width --attr stroke-linejoin --attr stroke-linecap --attr fill-rule';
      const cropCmd = `crop ${x}mm ${y}mm ${w}mm ${h}mm`;
      // Don't use --layer-label as it causes Python format string issues with special chars
      const command = `vpype read ${attrs} "${layerInputPath}" ${cropCmd} write "${layerOutputPath}"`;

      try {
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024
        });


        // Read the processed layer
        const processedSvg = await fs.readFile(layerOutputPath, 'utf8');

        // Extract the paths from the processed SVG (vpype outputs to layer 1)
        const pathsMatch = processedSvg.match(/<g[^>]*id="1"[^>]*>([\s\S]*?)<\/g>/);
        if (pathsMatch) {

          // Convert layer name: rgb(r,g,b) to hex and clean special chars for the SVG
          let displayName = layer.name;
          const rgbMatch = displayName.match(/rgb\((\d+),(\d+),(\d+)\)/);
          if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
            const hex = `${r}${g}${b}`;
            displayName = displayName.replace(/rgb\(\d+,\d+,\d+\)/, hex);
          }
          displayName = displayName.replace(/::/g, '-');

          processedLayers.push({
            name: displayName,
            id: layer.id,
            content: pathsMatch[1]
          });
        }

        // Clean up layer temp files
        await fs.unlink(layerInputPath).catch(() => {});
        await fs.unlink(layerOutputPath).catch(() => {});
      } catch (error) {
        console.warn(`Warning: Failed to process layer "${layer.name}":`, error.message);
        // Continue with other layers even if one fails
      }
    }


    // Reconstruct the final SVG with all processed layers
    let finalSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <title>Cropped GeoPDF - ${processedLayers.length} layers</title>
`;

    // Add each processed layer
    processedLayers.forEach(layer => {
      finalSvg += `  <g id="layer-${layer.id}" data-layer="${layer.name}">
${layer.content}
  </g>
`;
    });

    finalSvg += '</svg>';

    // Apply paper size layout if requested (to entire document)
    if (paperSize && paperSize !== 'original') {
      const finalInputPath = path.join(tmpDir, `final-${timestamp}-input.svg`);
      const finalOutputPath = path.join(tmpDir, `final-${timestamp}-output.svg`);

      await fs.writeFile(finalInputPath, finalSvg, 'utf8');

      const layoutCmd = `vpype read "${finalInputPath}" layout ${paperSize} write "${finalOutputPath}"`;
      await execAsync(layoutCmd, { maxBuffer: 10 * 1024 * 1024 });

      finalSvg = await fs.readFile(finalOutputPath, 'utf8');

      await fs.unlink(finalInputPath).catch(() => {});
      await fs.unlink(finalOutputPath).catch(() => {});
    }

    return {
      success: true,
      svg: finalSvg,
      layersProcessed: processedLayers.length
    };
  } catch (error) {
    console.error('Error running vpype:', error);
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || ''
    };
  }
});
