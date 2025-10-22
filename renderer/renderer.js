// State management
let currentPDFData = null;
let currentFilePath = null;

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const metadataDiv = document.getElementById('metadata');
const rasterLayersDiv = document.getElementById('rasterLayers');
const vectorLayersDiv = document.getElementById('vectorLayers');

// Event listeners
uploadBtn.addEventListener('click', handleUpload);

async function handleUpload() {
  try {
    // Show loading state
    showStatus('Selecting file...', 'info');
    uploadBtn.disabled = true;

    // Open file dialog
    const filePath = await window.electronAPI.openFile();

    if (!filePath) {
      hideStatus();
      uploadBtn.disabled = false;
      return;
    }

    currentFilePath = filePath;
    const fileName = filePath.split('/').pop();

    showStatus(`Processing ${fileName}...`, 'info');

    // Process PDF
    const result = await window.electronAPI.processPDF(filePath);

    if (!result.success) {
      showStatus(`Error: ${result.error}`, 'error');
      uploadBtn.disabled = false;
      return;
    }

    // Store data
    currentPDFData = result.data;

    // Display results
    displayResults(result.data);

    showStatus(`Successfully processed ${fileName}`, 'success');
    uploadBtn.disabled = false;

  } catch (error) {
    console.error('Error handling upload:', error);
    showStatus(`Error: ${error.message}`, 'error');
    uploadBtn.disabled = false;
  }
}

function displayResults(data) {
  // Show results section
  resultsDiv.style.display = 'block';

  // Display metadata
  displayMetadata(data.metadata, data.info);

  // Display raster layers
  displayRasterLayers(data.rasterLayers);

  // Display vector layers
  displayVectorLayers(data.vectorLayers);

  // Scroll to results
  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

function displayMetadata(metadata, info) {
  metadataDiv.innerHTML = '';

  const items = [
    { label: 'Title', value: metadata.title || info?.Title || 'Unknown' },
    { label: 'Creator', value: metadata.creator || info?.Creator || 'Unknown' },
    { label: 'Producer', value: metadata.producer || info?.Producer || 'Unknown' },
    { label: 'Pages', value: metadata.pageCount || 'Unknown' },
    { label: 'GeoPDF', value: metadata.isGeoPDF ? 'Yes' : 'No' },
    { label: 'Created', value: formatDate(metadata.creationDate || info?.CreationDate) }
  ];

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'metadata-item';
    div.innerHTML = `
      <div class="metadata-label">${item.label}</div>
      <div class="metadata-value">${item.value}</div>
    `;
    metadataDiv.appendChild(div);
  });
}

function displayRasterLayers(layers) {
  rasterLayersDiv.innerHTML = '';

  if (!layers || layers.length === 0) {
    rasterLayersDiv.innerHTML = '<div class="no-data">No raster layers found</div>';
    return;
  }

  layers.forEach((layer, index) => {
    const card = document.createElement('div');
    card.className = 'layer-card';

    const hasGeo = layer.geoReference?.hasGeoReference;

    card.innerHTML = `
      ${hasGeo ? '<span class="geo-badge">Georeferenced</span>' : ''}
      <div class="layer-title">${layer.name || `Raster Layer ${index + 1}`}</div>
      <div class="layer-info">
        <div class="layer-info-item">
          <span class="layer-info-label">Page:</span>
          <span class="layer-info-value">${layer.page + 1}</span>
        </div>
        <div class="layer-info-item">
          <span class="layer-info-label">Size:</span>
          <span class="layer-info-value">${layer.width} x ${layer.height}</span>
        </div>
        <div class="layer-info-item">
          <span class="layer-info-label">Format:</span>
          <span class="layer-info-value">${layer.format.toUpperCase()}</span>
        </div>
        <div class="layer-info-item">
          <span class="layer-info-label">Size:</span>
          <span class="layer-info-value">${formatBytes(layer.size)}</span>
        </div>
      </div>
      ${layer.dataUrl ? `<img src="${layer.dataUrl}" class="layer-preview" alt="Layer preview">` : ''}
      <button class="export-btn" onclick="exportRaster(${index})">Export Raster</button>
    `;

    rasterLayersDiv.appendChild(card);
  });
}

function displayVectorLayers(layers) {
  vectorLayersDiv.innerHTML = '';

  if (!layers || layers.length === 0) {
    vectorLayersDiv.innerHTML = '<div class="no-data">No vector layers found</div>';
    return;
  }

  // Group layers by page
  const layersByPage = {};
  layers.forEach(layer => {
    if (!layersByPage[layer.page]) {
      layersByPage[layer.page] = [];
    }
    layersByPage[layer.page].push(layer);
  });

  Object.keys(layersByPage).forEach(page => {
    const pageLayers = layersByPage[page];

    const card = document.createElement('div');
    card.className = 'layer-card';

    const vectorTypes = [...new Set(pageLayers.map(l => l.type))];
    const geometryCount = pageLayers.filter(l => l.geometry).length;

    card.innerHTML = `
      <div class="layer-title">Page ${parseInt(page) + 1} Vectors</div>
      <div class="layer-info">
        <div class="layer-info-item">
          <span class="layer-info-label">Objects:</span>
          <span class="layer-info-value">${pageLayers.length}</span>
        </div>
        <div class="layer-info-item">
          <span class="layer-info-label">Types:</span>
          <span class="layer-info-value">${vectorTypes.join(', ')}</span>
        </div>
        <div class="layer-info-item">
          <span class="layer-info-label">Geometries:</span>
          <span class="layer-info-value">${geometryCount}</span>
        </div>
      </div>
      <button class="export-btn" onclick="exportVector(${page})">Export as GeoJSON</button>
    `;

    vectorLayersDiv.appendChild(card);
  });
}

// Export functions
window.exportRaster = async function(layerIndex) {
  try {
    if (!currentPDFData || !currentPDFData.rasterLayers[layerIndex]) {
      alert('Layer data not available');
      return;
    }

    const layer = currentPDFData.rasterLayers[layerIndex];
    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'export';

    // Get save path
    const result = await window.electronAPI.exportRaster({
      defaultPath: `${fileName}_raster_${layerIndex}.${layer.format}`
    });

    if (!result.success) {
      if (!result.canceled) {
        alert(`Export failed: ${result.error}`);
      }
      return;
    }

    // Convert base64 to buffer
    if (layer.dataUrl) {
      const base64Data = layer.dataUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Save file
      const saveResult = await window.electronAPI.saveFile({
        filePath: result.filePath,
        content: buffer,
        encoding: 'binary'
      });

      if (saveResult.success) {
        alert(`Raster layer exported successfully to:\n${result.filePath}`);
      } else {
        alert(`Export failed: ${saveResult.error}`);
      }
    } else {
      alert('No image data available for export');
    }

  } catch (error) {
    console.error('Error exporting raster:', error);
    alert(`Export error: ${error.message}`);
  }
};

window.exportVector = async function(page) {
  try {
    if (!currentPDFData || !currentPDFData.vectorLayers) {
      alert('Vector data not available');
      return;
    }

    // Filter vectors for this page
    const pageVectors = currentPDFData.vectorLayers.filter(v => v.page === parseInt(page));

    if (pageVectors.length === 0) {
      alert('No vector data available for this page');
      return;
    }

    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'export';

    // Get save path
    const result = await window.electronAPI.exportVector({
      defaultPath: `${fileName}_vectors_page${parseInt(page) + 1}.geojson`
    });

    if (!result.success) {
      if (!result.canceled) {
        alert(`Export failed: ${result.error}`);
      }
      return;
    }

    // Create GeoJSON
    const features = pageVectors
      .filter(v => v.geometry)
      .map(v => ({
        type: 'Feature',
        geometry: v.geometry,
        properties: {
          type: v.type,
          subtype: v.subtype,
          title: v.title,
          contents: v.contents
        }
      }));

    const geoJSON = {
      type: 'FeatureCollection',
      features
    };

    // Save file
    const saveResult = await window.electronAPI.saveFile({
      filePath: result.filePath,
      content: JSON.stringify(geoJSON, null, 2)
    });

    if (saveResult.success) {
      alert(`Vector layer exported successfully to:\n${result.filePath}`);
    } else {
      alert(`Export failed: ${saveResult.error}`);
    }

  } catch (error) {
    console.error('Error exporting vector:', error);
    alert(`Export error: ${error.message}`);
  }
};

// Helper functions
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.style.display = 'none';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(dateString) {
  if (!dateString) return 'Unknown';

  try {
    // PDF dates are in format: D:YYYYMMDDHHmmSS
    if (dateString.startsWith('D:')) {
      const year = dateString.substring(2, 6);
      const month = dateString.substring(6, 8);
      const day = dateString.substring(8, 10);
      return `${year}-${month}-${day}`;
    }

    // Try parsing as regular date
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }

    return dateString;
  } catch (error) {
    return dateString;
  }
}
