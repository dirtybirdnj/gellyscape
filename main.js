const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const PDFProcessor = require('./src/pdf-processor');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('renderer/index.html');

  // Open DevTools in development
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
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

// Open file dialog and select PDF
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'PDF Files', extensions: ['pdf'] }
    ]
  });

  if (canceled) {
    return null;
  }

  return filePaths[0];
});

// Process PDF file
ipcMain.handle('pdf:process', async (event, filePath) => {
  try {
    // Validate file extension
    const fileExtension = path.extname(filePath).toLowerCase();
    if (fileExtension !== '.pdf') {
      return {
        success: false,
        error: `Invalid file type: ${fileExtension || 'unknown'}. Only PDF files are supported. Please select a PDF file to process.`
      };
    }

    // Read the file
    const fileBuffer = await fs.readFile(filePath);

    // Verify PDF magic bytes (PDF files start with "%PDF-")
    const pdfMagicBytes = Buffer.from('%PDF-', 'utf8');
    if (fileBuffer.length < pdfMagicBytes.length ||
        !fileBuffer.subarray(0, pdfMagicBytes.length).equals(pdfMagicBytes)) {
      return {
        success: false,
        error: `File does not appear to be a valid PDF. The file may be corrupted or is not a PDF file.`
      };
    }

    // Process the PDF
    const processor = new PDFProcessor(fileBuffer);
    const result = await processor.process();

    return {
      success: true,
      data: result
    };
  } catch (error) {
    console.error('Error processing PDF:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

// Export raster layer
ipcMain.handle('export:raster', async (event, data) => {
  try {
    const { defaultPath, filters } = data;

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
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

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
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
