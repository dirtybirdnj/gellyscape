// State management
let currentPDFData = null;
let currentFilePath = null;
let enabledLayers = new Set();
let allLayers = [];
let currentZoom = 1.0;

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const uploadSection = document.querySelector('.upload-section');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const metadataDiv = document.getElementById('metadata');
const layerControlsDiv = document.getElementById('layerControls');
const mapPreviewDiv = document.getElementById('mapPreview');
const mapStatsDiv = document.getElementById('mapStats');
const exportSvgBtn = document.getElementById('exportSvgBtn');
const whiteBackgroundCheck = document.getElementById('whiteBackgroundCheck');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomLevelSpan = document.getElementById('zoomLevel');
const debugExportBtn = document.getElementById('debugExportBtn');
const allLayersBtn = document.getElementById('allLayersBtn');
const noneLayersBtn = document.getElementById('noneLayersBtn');

// Event listeners
uploadBtn.addEventListener('click', handleUpload);
exportSvgBtn.addEventListener('click', handleExportSVG);
debugExportBtn.addEventListener('click', handleDebugExport);
zoomInBtn.addEventListener('click', () => adjustZoom(0.1));
zoomOutBtn.addEventListener('click', () => adjustZoom(-0.1));
zoomResetBtn.addEventListener('click', resetZoom);
allLayersBtn.addEventListener('click', enableAllLayers);
noneLayersBtn.addEventListener('click', disableAllLayers);

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

    showStatusWithProgress(`Processing ${fileName}...`, 'info');

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

    // Hide upload section after successful processing
    uploadSection.style.display = 'none';
    hideStatus();

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

  // Extract and display layers
  extractLayersFromData(data);

  // Display layer controls
  displayLayerControls();

  // Generate and display map preview
  generateMapPreview();

  // Scroll to results
  resultsDiv.scrollIntoView({ behavior: 'smooth' });
}

function extractLayersFromData(data) {
  allLayers = [];
  enabledLayers.clear();

  // Extract layer names from contentPaths if available
  if (data.contentPaths && data.contentPaths.paths) {
    const layerNames = new Set();

    data.contentPaths.paths.forEach(path => {
      if (path.layer) {
        layerNames.add(path.layer);
      }
    });

    // If no layer info on paths, try to get from metadata
    if (layerNames.size === 0 && data.layerNames) {
      Object.values(data.layerNames).forEach(name => layerNames.add(name));
    }

    // If still no layers, create a default "All Paths" layer
    if (layerNames.size === 0) {
      layerNames.add('All Paths');
    }

    allLayers = Array.from(layerNames).sort();

    // Enable all layers by default
    allLayers.forEach(layer => enabledLayers.add(layer));
  }

  console.log('Extracted layers:', allLayers);
}

function displayLayerControls() {
  layerControlsDiv.innerHTML = '';

  if (allLayers.length === 0) {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No layers found</div>';
    return;
  }

  // Calculate color swatches for each layer
  const layerColors = {};
  if (currentPDFData && currentPDFData.contentPaths) {
    currentPDFData.contentPaths.paths.forEach(path => {
      const layerName = path.layer;
      if (!layerName) return; // Skip paths without layer assignment

      if (!layerColors[layerName]) {
        layerColors[layerName] = new Set();
      }

      if (path.fill && path.fillColor) {
        layerColors[layerName].add(`rgb(${path.fillColor.join(',')})`);
      }
      if (path.stroke && path.strokeColor) {
        // Show actual stroke color (including black if that's what the layer uses)
        layerColors[layerName].add(`rgb(${path.strokeColor.join(',')})`);
      }
    });
  }

  console.log('Layer colors:', layerColors);

  allLayers.forEach(layerName => {
    const layerItem = document.createElement('div');
    layerItem.className = 'layer-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `layer-${layerName}`;
    checkbox.checked = enabledLayers.has(layerName);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        enabledLayers.add(layerName);
      } else {
        enabledLayers.delete(layerName);
      }
      generateMapPreview();
    });

    const label = document.createElement('label');
    label.className = 'checkbox-label';
    label.htmlFor = `layer-${layerName}`;
    label.appendChild(checkbox);

    // Add color swatches specific to this layer
    const colors = layerColors[layerName] ? Array.from(layerColors[layerName]).slice(0, 5) : [];
    if (colors.length > 0) {
      const swatchContainer = document.createElement('span');
      swatchContainer.style.cssText = 'display: inline-flex; gap: 2px; margin-right: 6px;';
      colors.forEach(color => {
        const swatch = document.createElement('span');
        swatch.style.cssText = `display: inline-block; width: 12px; height: 12px; border: 1px solid #ccc; background: ${color}; border-radius: 2px;`;
        swatchContainer.appendChild(swatch);
      });
      label.appendChild(swatchContainer);
    }

    const span = document.createElement('span');
    span.textContent = layerName;

    label.appendChild(span);
    layerItem.appendChild(label);
    layerControlsDiv.appendChild(layerItem);
  });
}

function generateMapPreview() {
  if (!currentPDFData || !currentPDFData.contentPaths) {
    mapPreviewDiv.innerHTML = '<div style="color: #999;">No map data available</div>';
    return;
  }

  // Debug: Export raw path data to console for analysis
  console.log('\n🔍 DEBUG: Exporting raw path data for comparison');
  console.log('Copy this to compare with working SVG:');
  const debugPaths = currentPDFData.contentPaths.paths.slice(0, 5).map(p => ({
    operations: p.operations,
    fill: p.fill,
    fillColor: p.fillColor,
    stroke: p.stroke,
    strokeColor: p.strokeColor,
    layer: p.layer
  }));
  console.log(JSON.stringify(debugPaths, null, 2));

  const svg = generateSVG(false); // false = no export, just preview
  mapPreviewDiv.innerHTML = svg;

  // Apply current zoom level
  updateZoomDisplay();

  // Update stats
  const paths = currentPDFData.contentPaths.paths;
  const enabledPaths = paths.filter(p => !p.layer || enabledLayers.has(p.layer));

  mapStatsDiv.innerHTML = `
    <div>Total paths: ${paths.length}</div>
    <div>Visible paths: ${enabledPaths.length}</div>
    <div>Layers: ${enabledLayers.size} of ${allLayers.length} enabled</div>
  `;
}

async function handleExportSVG() {
  try {
    if (!currentPDFData || !currentPDFData.contentPaths) {
      alert('No map data available to export');
      return;
    }

    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'export';

    // Get save path
    const result = await window.electronAPI.exportVector({
      defaultPath: `${fileName}_map.svg`
    });

    if (!result.success) {
      if (!result.canceled) {
        alert(`Export failed: ${result.error}`);
      }
      return;
    }

    // Generate SVG with export settings
    const svg = generateSVG(true); // true = export mode

    // Save file
    const saveResult = await window.electronAPI.saveFile({
      filePath: result.filePath,
      content: svg
    });

    if (saveResult.success) {
      alert(`SVG exported successfully to:\n${result.filePath}`);
    } else {
      alert(`Export failed: ${saveResult.error}`);
    }

  } catch (error) {
    console.error('Error exporting SVG:', error);
    alert(`Export error: ${error.message}`);
  }
}

async function handleDebugExport() {
  try {
    if (!currentPDFData || !currentPDFData.contentPaths) {
      alert('No map data available for debug export');
      return;
    }

    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'debug';

    // Get save path
    const result = await window.electronAPI.exportVector({
      defaultPath: `${fileName}_debug.json`
    });

    if (!result.success) {
      if (!result.canceled) {
        alert(`Export failed: ${result.error}`);
      }
      return;
    }

    // Create comprehensive debug data
    const debugData = {
      metadata: currentPDFData.metadata,
      layers: Array.from(enabledLayers),
      allLayerNames: allLayers,
      pathCount: currentPDFData.contentPaths.paths.length,
      statistics: currentPDFData.contentPaths.statistics,
      samplePaths: currentPDFData.contentPaths.paths.slice(0, 10).map(p => ({
        operations: p.operations,
        fill: p.fill,
        fillColor: p.fillColor,
        stroke: p.stroke,
        strokeColor: p.strokeColor,
        strokeWidth: p.strokeWidth,
        layer: p.layer,
        page: p.page
      })),
      layerNames: currentPDFData.layerNames
    };

    // Save file
    const saveResult = await window.electronAPI.saveFile({
      filePath: result.filePath,
      content: JSON.stringify(debugData, null, 2)
    });

    if (saveResult.success) {
      alert(`Debug data exported successfully to:\n${result.filePath}`);
    } else {
      alert(`Export failed: ${saveResult.error}`);
    }

  } catch (error) {
    console.error('Error exporting debug data:', error);
    alert(`Export error: ${error.message}`);
  }
}

function generateSVG(isExport) {
  const paths = currentPDFData.contentPaths.paths;
  const stats = currentPDFData.contentPaths.statistics || {};

  console.log('=== SVG GENERATION DEBUG ===');
  console.log('Total paths:', paths.length);
  console.log('Enabled layers:', Array.from(enabledLayers));

  // Filter paths by enabled layers
  const filteredPaths = paths.filter(path => {
    if (!path.layer || allLayers.length === 0) return true; // No layer info, include all
    return enabledLayers.has(path.layer);
  });

  console.log('Filtered paths:', filteredPaths.length);

  if (filteredPaths.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="200" y="150" text-anchor="middle" fill="#999">No paths to display</text></svg>';
  }

  // Sample first few paths for debugging
  console.log('Sample paths (first 3):');
  filteredPaths.slice(0, 3).forEach((path, i) => {
    console.log(`Path ${i}:`, {
      layer: path.layer,
      page: path.page,
      operationCount: path.operations?.length,
      fill: path.fill,
      stroke: path.stroke,
      firstOps: path.operations?.slice(0, 5)
    });
  });

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  filteredPaths.forEach(path => {
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) {
          minX = Math.min(minX, op.x);
          maxX = Math.max(maxX, op.x);
        }
        if (op.y !== undefined) {
          minY = Math.min(minY, op.y);
          maxY = Math.max(maxY, op.y);
        }
        // Handle curve control points
        if (op.x1 !== undefined) {
          minX = Math.min(minX, op.x1);
          maxX = Math.max(maxX, op.x1);
        }
        if (op.y1 !== undefined) {
          minY = Math.min(minY, op.y1);
          maxY = Math.max(maxY, op.y1);
        }
        if (op.x2 !== undefined) {
          minX = Math.min(minX, op.x2);
          maxX = Math.max(maxX, op.x2);
        }
        if (op.y2 !== undefined) {
          minY = Math.min(minY, op.y2);
          maxY = Math.max(maxY, op.y2);
        }
        if (op.x3 !== undefined) {
          minX = Math.min(minX, op.x3);
          maxX = Math.max(maxX, op.x3);
        }
        if (op.y3 !== undefined) {
          minY = Math.min(minY, op.y3);
          maxY = Math.max(maxY, op.y3);
        }
      });
    }
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const padding = 10;

  console.log('Bounding box:', { minX, minY, maxX, maxY });
  console.log('Dimensions:', { width, height });

  // Calculate center point for flipping
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  // Generate SVG header with viewBox
  const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;
  console.log('ViewBox:', viewBox);
  console.log('Center point:', { centerX, centerY });

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="${viewBox}">
  <g transform="scale(1, -1) translate(0, ${-2 * centerY})">
`;

  // Add white background if requested (export only)
  if (isExport && whiteBackgroundCheck.checked) {
    svg += `    <rect x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="white"/>\n`;
  }

  // Add title
  svg += `    <title>GeoPDF Export - ${enabledLayers.size} layers</title>\n`;

  // Group paths by layer
  const pathsByLayer = {};
  filteredPaths.forEach(path => {
    const layerName = path.layer || 'default';
    if (!pathsByLayer[layerName]) {
      pathsByLayer[layerName] = [];
    }
    pathsByLayer[layerName].push(path);
  });

  // Generate path elements grouped by layer
  Object.keys(pathsByLayer).sort().forEach(layerName => {
    svg += `    <g id="layer-${layerName.replace(/[^a-zA-Z0-9]/g, '-')}" data-layer="${layerName}">\n`;

    pathsByLayer[layerName].forEach((path, index) => {
      const pathData = path.operations.map(op => {
        switch (op.type) {
          case 'moveto':
            return `M ${op.x} ${op.y}`;
          case 'lineto':
            return `L ${op.x} ${op.y}`;
          case 'curveto':
            return `C ${op.x1} ${op.y1} ${op.x2} ${op.y2} ${op.x3} ${op.y3}`;
          case 'rect':
            return `M ${op.x} ${op.y} L ${op.x + op.width} ${op.y} L ${op.x + op.width} ${op.y + op.height} L ${op.x} ${op.y + op.height} Z`;
          case 'closepath':
            return 'Z';
          default:
            return '';
        }
      }).join(' ');

      const fill = path.fill ? `rgb(${path.fillColor.join(',')})` : 'none';

      // Fix stroke colors - contour lines should be brown, not black
      // If stroke is black (0,0,0), replace with default contour brown
      let strokeColor = path.strokeColor;
      if (path.stroke && strokeColor[0] === 0 && strokeColor[1] === 0 && strokeColor[2] === 0) {
        // Default brown contour color from the map statistics
        strokeColor = [179, 134, 89];
      }
      const stroke = path.stroke ? `rgb(${strokeColor.join(',')})` : 'none';
      const strokeWidth = path.strokeWidth || 1;

      svg += `      <path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
    });

    svg += `    </g>\n`;
  });

  svg += `  </g>\n</svg>`;
  return svg;
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
// Helper functions
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.style.display = 'none';
}

function showStatusWithProgress(message, type) {
  statusDiv.innerHTML = `
    <div style="margin-bottom: 10px;">${message}</div>
    <div style="width: 100%; background: #e0e0e0; border-radius: 4px; overflow: hidden; height: 8px;">
      <div class="progress-bar" style="width: 100%; height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #667eea 100%); background-size: 200% 100%; animation: progressAnimation 2s linear infinite;"></div>
    </div>
  `;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';

  // Add keyframes for progress animation if not already added
  if (!document.getElementById('progress-animation-style')) {
    const style = document.createElement('style');
    style.id = 'progress-animation-style';
    style.textContent = `
      @keyframes progressAnimation {
        0% { background-position: 0% 0%; }
        100% { background-position: 200% 0%; }
      }
    `;
    document.head.appendChild(style);
  }
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

function adjustZoom(delta) {
  currentZoom = Math.max(0.1, Math.min(5.0, currentZoom + delta));
  updateZoomDisplay();
}

function resetZoom() {
  currentZoom = 1.0;
  updateZoomDisplay();
}

function enableAllLayers() {
  enabledLayers.clear();
  allLayers.forEach(layer => enabledLayers.add(layer));
  updateLayerCheckboxes();
  generateMapPreview();
}

function disableAllLayers() {
  enabledLayers.clear();
  updateLayerCheckboxes();
  generateMapPreview();
}

function updateLayerCheckboxes() {
  allLayers.forEach(layerName => {
    const checkbox = document.getElementById(`layer-${layerName}`);
    if (checkbox) {
      checkbox.checked = enabledLayers.has(layerName);
    }
  });
}

function updateZoomDisplay() {
  // Update zoom level text
  zoomLevelSpan.textContent = `${Math.round(currentZoom * 100)}%`;

  // Apply zoom to SVG
  const svg = mapPreviewDiv.querySelector('svg');
  if (svg) {
    svg.style.transform = `scale(${currentZoom})`;
    svg.style.transformOrigin = 'top left';
  }
}
