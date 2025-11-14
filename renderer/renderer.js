// State management
let currentPDFData = null;
let currentFilePath = null;
let enabledLayers = new Set();
let allLayers = [];
let currentZoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;
let cachedBounds = null; // Cache the initial bounds to prevent jumping

// Layer categorization - defines which layers are plottable vector data vs overlays/annotations
// Plottable layers: Physical map features suitable for pen plotting
// Overlay layers: Text, labels, shields, grids, and other annotation elements
const OVERLAY_LAYER_PATTERNS = [
  'Boundaries',
  'County or Equivalent',
  'Geographic Names',
  'Map Elements',
  'Projection and Grids',
  'Road Names and Shields',
  'Structures',
  'Airports',
  'Barcode',
  'Department of Defense',
  'Federal Administrated Lands',
  'Images'
];

// Helper function to check if a layer should be categorized as overlay
function isOverlayLayer(layerName) {
  // Extract base layer name if it's a color sublayer
  const baseName = layerName.includes('::') ? layerName.split('::')[0] : layerName;

  // Text layers (with emoji prefix) are always overlays
  if (baseName.startsWith('📝 ')) {
    return true;
  }

  // Check if layer name matches any overlay patterns
  return OVERLAY_LAYER_PATTERNS.some(pattern =>
    baseName.toLowerCase().includes(pattern.toLowerCase())
  );
}

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const uploadSection = document.querySelector('.upload-section');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const metadataDiv = document.getElementById('metadata');
const layerControlsDiv = document.getElementById('layerControls');
const textLayerControlsDiv = document.getElementById('textLayerControls');
const mapPreviewDiv = document.getElementById('mapPreview');
const mapStatsDiv = document.getElementById('mapStats');
const exportSvgBtn = document.getElementById('exportSvgBtn');
const whiteBackgroundCheck = document.getElementById('whiteBackgroundCheck');
const cropMaskCheck = document.getElementById('cropMaskCheck');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomLevelSpan = document.getElementById('zoomLevel');
const exportStatusDiv = document.getElementById('exportStatus');
const layerDetailsSection = document.getElementById('layerDetailsSection');
const layerDetailsDiv = document.getElementById('layerDetails');
const selectAllLayersBtn = document.getElementById('selectAllLayersBtn');
const deselectAllLayersBtn = document.getElementById('deselectAllLayersBtn');
const selectAllTextLayersBtn = document.getElementById('selectAllTextLayersBtn');
const deselectAllTextLayersBtn = document.getElementById('deselectAllTextLayersBtn');
const toolbarDiv = document.getElementById('toolbar');
const exportLayersListDiv = document.getElementById('exportLayersList');
const fileInfoDiv = document.getElementById('fileInfo');
const fileNameDiv = document.getElementById('fileName');
const fileSizeDiv = document.getElementById('fileSize');
const vectorCountBadge = document.getElementById('vectorCountBadge');
const overlayCountBadge = document.getElementById('overlayCountBadge');

// Event listeners
uploadBtn.addEventListener('click', handleUpload);
exportSvgBtn.addEventListener('click', handleExportSVG);
cropMaskCheck.addEventListener('change', generateMapPreview);
zoomInBtn.addEventListener('click', () => adjustZoom(0.1));
zoomOutBtn.addEventListener('click', () => adjustZoom(-0.1));
zoomResetBtn.addEventListener('click', resetZoom);
selectAllLayersBtn.addEventListener('click', selectAllLayers);
deselectAllLayersBtn.addEventListener('click', deselectAllLayers);
selectAllTextLayersBtn.addEventListener('click', selectAllTextLayers);
deselectAllTextLayersBtn.addEventListener('click', deselectAllTextLayers);

// Panning event listeners
mapPreviewDiv.addEventListener('mousedown', startPan);
mapPreviewDiv.addEventListener('mousemove', doPan);
mapPreviewDiv.addEventListener('mouseup', endPan);
mapPreviewDiv.addEventListener('mouseleave', endPan);

// Zoom with mouse wheel
mapPreviewDiv.addEventListener('wheel', handleWheel);

// Tab switching
function switchTab(tabName) {
  // Hide all tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  // Remove active state from all tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show the selected tab panel
  const panel = document.getElementById(`${tabName}-panel`);
  if (panel) {
    panel.classList.add('active');
  }

  // Activate the selected tab button
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) {
    btn.classList.add('active');
  }
}

// Add click handlers to tab buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.target.getAttribute('data-tab');
    switchTab(tabName);
  });
});

// Set up progress listener for PDF processing
let progressUnsubscribe = null;
if (window.electronAPI && window.electronAPI.onPDFProgress) {
  progressUnsubscribe = window.electronAPI.onPDFProgress((progress) => {
    console.log('[Progress]', progress.operation, '-', progress.detail);

    // Update the status display with the current operation
    const statusMessage = `${progress.operation}: ${progress.detail}`;
    showStatusWithProgress(statusMessage, 'info');
  });
}

async function handleUpload() {
  try {
    // Show loading state
    showStatus('Selecting file...', 'info');
    uploadBtn.disabled = true;
    document.body.style.cursor = 'wait';

    // Open file dialog
    const filePath = await window.electronAPI.openFile();

    if (!filePath) {
      hideStatus();
      uploadBtn.disabled = false;
      document.body.style.cursor = 'default';
      return;
    }

    currentFilePath = filePath;
    const fileName = filePath.split('/').pop();

    showStatusWithProgress(`Starting processing of ${fileName}...`, 'info');

    // Process PDF - this happens in the main process and keeps UI responsive
    // Progress updates will be received via the onPDFProgress listener above
    const result = await window.electronAPI.processPDF(filePath);

    if (!result.success) {
      showStatus(`Error: ${result.error}`, 'error');
      uploadBtn.disabled = false;
      document.body.style.cursor = 'default';
      return;
    }

    // Store data
    currentPDFData = result.data;

    // Display results
    displayResults(result.data);

    // Hide upload section after successful processing
    uploadSection.style.display = 'none';
    hideStatus();
    document.body.style.cursor = 'default';

  } catch (error) {
    console.error('Error handling upload:', error);
    showStatus(`Error: ${error.message}`, 'error');
    uploadBtn.disabled = false;
    document.body.style.cursor = 'default';
  }
}

function displayResults(data) {
  // Hide upload section and show results
  uploadSection.classList.add('hidden');
  resultsDiv.classList.add('active');
  toolbarDiv.style.display = 'flex';

  // Reset cached bounds for new PDF
  cachedBounds = null;

  // Update file info in toolbar
  updateFileInfo();

  // Display metadata
  displayMetadata(data.metadata, data.info, data);

  // Text data display removed - Text Data tab no longer exists
  // Removed: displayTextData(data);

  // Extract and display layers
  extractLayersFromData(data);

  // Display layer controls
  displayLayerControls();

  // Update tab counts
  updateTabCounts();

  // Generate and display map preview
  generateMapPreview();
}

function updateFileInfo() {
  if (!currentFilePath || !currentPDFData) {
    fileInfoDiv.style.display = 'none';
    return;
  }

  // Extract filename from path
  const fileName = currentFilePath.split('/').pop();

  // Get file size from metadata (added during PDF processing)
  const fileSize = currentPDFData.metadata?.fileSize;
  const fileSizeText = fileSize ? formatBytes(fileSize) : '';

  fileNameDiv.textContent = fileName;
  fileSizeDiv.textContent = fileSizeText;
  fileInfoDiv.style.display = 'flex';
}

function extractLayersFromData(data) {
  allLayers = [];
  enabledLayers.clear();

  // Extract layer names and colors from contentPaths if available
  if (data.contentPaths && data.contentPaths.paths) {
    const layerColorSublayers = new Set(); // Store "Layer::color" format
    const layerColors = {}; // Map of base layer name to Set of colors

    data.contentPaths.paths.forEach(path => {
      if (path.layer) {
        // Collect colors for this layer
        if (!layerColors[path.layer]) {
          layerColors[path.layer] = new Set();
        }

        // Determine the color for this path (prefer stroke, fall back to fill)
        let colorStr = null;
        if (path.stroke && path.strokeColor) {
          colorStr = `rgb(${path.strokeColor.join(',')})`;
        } else if (path.fill && path.fillColor) {
          colorStr = `rgb(${path.fillColor.join(',')})`;
        }

        if (colorStr) {
          layerColors[path.layer].add(colorStr);
          // Create sublayer: "LayerName::rgb(r,g,b)"
          layerColorSublayers.add(`${path.layer}::${colorStr}`);
        }
      }
    });

    // Add text layers from textObjectsByLayer
    if (data.contentPaths && data.contentPaths.textObjectsByLayer) {
      Object.keys(data.contentPaths.textObjectsByLayer).forEach(textLayer => {
        // Prefix text layers to distinguish them from path layers
        const textLayerName = `📝 ${textLayer}`;

        // Collect text colors (from fillColor)
        if (!layerColors[textLayerName]) {
          layerColors[textLayerName] = new Set();
        }

        data.contentPaths.textObjectsByLayer[textLayer].forEach(textObj => {
          if (textObj.fillColor && Array.isArray(textObj.fillColor)) {
            const colorStr = `rgb(${textObj.fillColor.join(',')})`;
            layerColors[textLayerName].add(colorStr);
            layerColorSublayers.add(`${textLayerName}::${colorStr}`);
          }
        });
      });
    }

    // If no layer info on paths, create a default "All Paths" layer
    if (layerColorSublayers.size === 0) {
      layerColorSublayers.add('All Paths::rgb(0,0,0)');
    }

    allLayers = Array.from(layerColorSublayers).sort();

    // Store color information in a global object for display
    window.layerColorInfo = {};
    window.layerBaseNames = {}; // Map from sublayer to base layer name
    allLayers.forEach(sublayer => {
      const [baseName, colorStr] = sublayer.split('::');
      window.layerBaseNames[sublayer] = baseName;
      window.layerColorInfo[sublayer] = [colorStr];
    });

    // Enable vector layers by default, but NOT overlay layers
    allLayers.forEach(layer => {
      if (!isOverlayLayer(layer)) {
        enabledLayers.add(layer);
      }
      // Overlay layers remain disabled by default
    });
  }

  console.log('Extracted color sublayers:', allLayers);
  console.log('Layer colors:', window.layerColorInfo);
}

function updateTabCounts() {
  // Count enabled vector layers
  const vectorLayers = allLayers.filter(l => !isOverlayLayer(l));
  const enabledVectorCount = vectorLayers.filter(l => enabledLayers.has(l)).length;

  // Count enabled overlay layers
  const overlayLayers = allLayers.filter(l => isOverlayLayer(l));
  const enabledOverlayCount = overlayLayers.filter(l => enabledLayers.has(l)).length;

  // Update badges - show only selected count
  if (vectorCountBadge) {
    vectorCountBadge.textContent = `(${enabledVectorCount})`;
  }
  if (overlayCountBadge) {
    overlayCountBadge.textContent = `(${enabledOverlayCount})`;
  }
}

function displayLayerControls() {
  layerControlsDiv.innerHTML = '';
  textLayerControlsDiv.innerHTML = '';

  if (allLayers.length === 0) {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No layers found</div>';
    textLayerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No overlay layers found</div>';
    return;
  }

  // Separate plottable vector layers from overlay/annotation layers
  const vectorLayers = allLayers.filter(l => !isOverlayLayer(l)).sort((a, b) => a.localeCompare(b));
  const overlayLayers = allLayers.filter(l => isOverlayLayer(l)).sort((a, b) => {
    // Sort text layers (with emoji) separately
    const aIsText = a.startsWith('📝 ');
    const bIsText = b.startsWith('📝 ');
    if (aIsText && bIsText) {
      return a.substring(2).localeCompare(b.substring(2));
    }
    if (aIsText) return 1; // Text layers at bottom
    if (bIsText) return -1;
    return a.localeCompare(b);
  });

  // Populate plottable vector layers in Vector Data tab
  if (vectorLayers.length > 0) {
    vectorLayers.forEach(layerName => {
      const layerItem = createLayerControlItem(layerName);
      layerControlsDiv.appendChild(layerItem);
    });
  } else {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No plottable layers found</div>';
  }

  // Populate overlay/annotation layers in Overlay tab
  if (overlayLayers.length > 0) {
    overlayLayers.forEach(layerName => {
      const layerItem = createLayerControlItem(layerName);
      textLayerControlsDiv.appendChild(layerItem);
    });
  } else {
    textLayerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No overlay layers found</div>';
  }
}

function createLayerControlItem(layerName) {
  const layerItem = document.createElement('div');
  layerItem.className = 'layer-item';
  layerItem.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  // Parse layerName to extract base name and color
  const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];

  // Calculate path count for this specific color sublayer
  let pathCount = 0;
  if (currentPDFData && currentPDFData.contentPaths) {
    const paths = currentPDFData.contentPaths.paths;
    pathCount = paths.filter(p => {
      if (p.layer !== baseName) return false;
      if (!colorStr) return true;  // No color filter, count all

      // Check if path color matches
      let pathColor = null;
      if (p.stroke && p.strokeColor) {
        pathColor = `rgb(${p.strokeColor.join(',')})`;
      } else if (p.fill && p.fillColor) {
        pathColor = `rgb(${p.fillColor.join(',')})`;
      }
      return pathColor === colorStr;
    }).length;
  }

  // Path count badge on the left (outside the checkbox container)
  const countBadge = document.createElement('span');
  countBadge.style.cssText = 'font-size: 0.75em; color: #777; font-weight: 600; min-width: 40px; text-align: right; flex-shrink: 0;';
  countBadge.textContent = pathCount > 0 ? pathCount.toLocaleString() : '0';
  layerItem.appendChild(countBadge);

  // Container for checkbox, label, and swatches
  const checkboxContainer = document.createElement('div');
  checkboxContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  // Use a safe ID by replacing special characters and spaces
  const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
  checkbox.id = `layer-${safeId}`;
  checkbox.checked = enabledLayers.has(layerName);

  // DEBUG: Log checkbox creation
  console.log(`Creating checkbox for layer: "${layerName}" with ID: "layer-${safeId}"`);

  checkbox.addEventListener('change', () => {
    console.log(`Checkbox changed for: "${layerName}" (checked: ${checkbox.checked})`);
    if (checkbox.checked) {
      enabledLayers.add(layerName);
    } else {
      enabledLayers.delete(layerName);
    }
    updateTabCounts();
    generateMapPreview();
    updateExportLayersList();
  });

  const label = document.createElement('label');
  label.className = 'checkbox-label';
  label.htmlFor = `layer-${safeId}`;
  label.style.cssText = 'flex: 1; min-width: 0;';

  const span = document.createElement('span');
  // Display just the base layer name (without color suffix)
  span.textContent = baseName;

  label.appendChild(checkbox);
  label.appendChild(span);
  checkboxContainer.appendChild(label);

  // Add color swatches on the right if available
  const colors = window.layerColorInfo?.[layerName] || [];
  if (colors.length > 0) {
    const swatchContainer = document.createElement('span');
    swatchContainer.style.cssText = 'display: inline-flex; gap: 2px; flex-shrink: 0; margin-left: 6px;';

    // Show up to 3 colors
    colors.slice(0, 3).forEach(color => {
      const swatch = document.createElement('span');
      swatch.style.cssText = `
        display: inline-block;
        width: 12px;
        height: 12px;
        background: ${color};
        border: 1px solid #ccc;
        border-radius: 2px;
        flex-shrink: 0;
      `;
      swatchContainer.appendChild(swatch);
    });

    checkboxContainer.appendChild(swatchContainer);
  }

  layerItem.appendChild(checkboxContainer);

  return layerItem;
}

function selectAllLayers() {
  // Enable only plottable vector layers (not overlays)
  const vectorLayers = allLayers.filter(l => !isOverlayLayer(l));
  vectorLayers.forEach(layer => {
    enabledLayers.add(layer);
  });

  // Update all vector layer checkboxes
  vectorLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = true;
  });

  // Update counts and regenerate preview
  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
}

function deselectAllLayers() {
  // Disable only plottable vector layers (not overlays)
  const vectorLayers = allLayers.filter(l => !isOverlayLayer(l));
  vectorLayers.forEach(layer => {
    enabledLayers.delete(layer);
  });

  // Update all vector layer checkboxes
  vectorLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = false;
  });

  // Update counts and regenerate preview
  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
}

function selectAllTextLayers() {
  // Enable all overlay layers (text, annotations, etc.)
  const overlayLayers = allLayers.filter(l => isOverlayLayer(l));
  overlayLayers.forEach(layer => {
    enabledLayers.add(layer);
  });

  // Update all overlay layer checkboxes
  overlayLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = true;
  });

  // Update counts and regenerate preview
  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
}

function deselectAllTextLayers() {
  // Disable all overlay layers (text, annotations, etc.)
  const overlayLayers = allLayers.filter(l => isOverlayLayer(l));
  overlayLayers.forEach(layer => {
    enabledLayers.delete(layer);
  });

  // Update all overlay layer checkboxes
  overlayLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = false;
  });

  // Update counts and regenerate preview
  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
}

function displayLayerDetails() {
  if (!currentPDFData || !currentPDFData.contentPaths) {
    layerDetailsSection.style.display = 'none';
    return;
  }

  // Count paths per layer
  const layerStats = {};
  const paths = currentPDFData.contentPaths.paths;

  paths.forEach(path => {
    const layerName = path.layer || 'Unknown';
    if (!layerStats[layerName]) {
      layerStats[layerName] = { paths: 0, segments: 0 };
    }
    layerStats[layerName].paths++;

    // Count segments
    if (path.operations) {
      layerStats[layerName].segments += path.operations.length;
    }
  });

  // Sort by layer name
  const sortedLayers = Object.keys(layerStats).sort();

  layerDetailsDiv.innerHTML = '';

  sortedLayers.forEach(layerName => {
    const stats = layerStats[layerName];
    const item = document.createElement('div');
    item.className = 'layer-detail-item';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'layer-detail-name';
    nameSpan.textContent = layerName;

    const infoSpan = document.createElement('div');
    infoSpan.className = 'layer-detail-info';
    infoSpan.textContent = `${stats.paths} paths, ${stats.segments} segments`;

    item.appendChild(nameSpan);
    item.appendChild(infoSpan);
    layerDetailsDiv.appendChild(item);
  });

  layerDetailsSection.style.display = 'block';
}

function updateExportLayersList() {
  if (!exportLayersListDiv) return;

  if (enabledLayers.size === 0) {
    exportLayersListDiv.innerHTML = '<div style="color: #999; font-size: 0.9em; font-style: italic;">No layers enabled</div>';
    return;
  }

  // Count paths per enabled layer
  const layerPathCounts = {};
  if (currentPDFData && currentPDFData.contentPaths) {
    const paths = currentPDFData.contentPaths.paths;
    paths.forEach(path => {
      const layerName = path.layer || 'Unknown';
      if (enabledLayers.has(layerName)) {
        layerPathCounts[layerName] = (layerPathCounts[layerName] || 0) + 1;
      }
    });
  }

  // Separate plottable vector layers from overlay layers
  const sortedEnabledLayers = Array.from(enabledLayers).sort();
  const vectorLayers = sortedEnabledLayers.filter(l => !isOverlayLayer(l));
  const overlayLayers = sortedEnabledLayers.filter(l => isOverlayLayer(l));

  // Build the list HTML with sections
  let html = '';

  if (vectorLayers.length > 0) {
    html += '<div style="margin-bottom: 16px;"><h5 style="font-size: 0.8em; font-weight: 600; color: #667eea; margin-bottom: 8px; text-transform: uppercase;">Vector Layers</h5>';
    vectorLayers.forEach(layerName => {
      const pathCount = layerPathCounts[layerName] || 0;
      const colors = window.layerColorInfo?.[layerName] || [];
      const swatchesHTML = colors.slice(0, 3).map(color =>
        `<span style="display: inline-block; width: 10px; height: 10px; background: ${color}; border: 1px solid #ccc; border-radius: 2px; margin-left: 2px;"></span>`
      ).join('');

      html += `
        <div style="padding: 6px 10px; background: #f5f7ff; border-radius: 4px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.85em; color: #333; font-weight: 500; display: flex; align-items: center; gap: 6px;">
            <span>${layerName}</span>
            ${swatchesHTML}
          </div>
          <div style="font-size: 0.75em; color: #777; background: white; padding: 2px 8px; border-radius: 3px;">${pathCount}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  if (overlayLayers.length > 0) {
    html += '<div><h5 style="font-size: 0.8em; font-weight: 600; color: #667eea; margin-bottom: 8px; text-transform: uppercase;">Overlays</h5>';
    overlayLayers.forEach(layerName => {
      const pathCount = layerPathCounts[layerName] || 0;
      const colors = window.layerColorInfo?.[layerName] || [];
      const swatchesHTML = colors.slice(0, 3).map(color =>
        `<span style="display: inline-block; width: 10px; height: 10px; background: ${color}; border: 1px solid #ccc; border-radius: 2px; margin-left: 2px;"></span>`
      ).join('');

      html += `
        <div style="padding: 6px 10px; background: #f5f7ff; border-radius: 4px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.85em; color: #333; font-weight: 500; display: flex; align-items: center; gap: 6px;">
            <span>${layerName}</span>
            ${swatchesHTML}
          </div>
          <div style="font-size: 0.75em; color: #777; background: white; padding: 2px 8px; border-radius: 3px;">${pathCount}</div>
        </div>
      `;
    });
    html += '</div>';
  }

  exportLayersListDiv.innerHTML = html;
}

function generateMapPreview() {
  if (!currentPDFData || !currentPDFData.contentPaths) {
    mapPreviewDiv.innerHTML = '<div style="color: #999;">No map data available</div>';
    return;
  }

  const svg = generateSVG(false); // false = no export, just preview
  mapPreviewDiv.innerHTML = svg;

  // SVG now uses 100% width/height for preview, so no need for zoom calculation
  // Just reset zoom to 1.0 on first load
  if (currentZoom === 1.0 && panX === 0 && panY === 0) {
    currentZoom = 1.0;
  }

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

  // Update the export layers list
  updateExportLayersList();
}

async function handleExportSVG() {
  try {
    if (!currentPDFData || !currentPDFData.contentPaths) {
      showExportStatus('No map data available to export', 'error');
      return;
    }

    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'export';

    // Get save path
    const result = await window.electronAPI.exportVector({
      defaultPath: `${fileName}_map.svg`
    });

    if (!result.success) {
      if (!result.canceled) {
        showExportStatus(`Export failed: ${result.error}`, 'error');
      }
      return;
    }

    // Show progress
    showExportStatus('Generating SVG...', 'info');

    // Generate SVG with export settings
    const svg = generateSVG(true); // true = export mode

    // Save file
    const saveResult = await window.electronAPI.saveFile({
      filePath: result.filePath,
      content: svg
    });

    if (saveResult.success) {
      const filename = result.filePath.split('/').pop();
      showExportStatus(`✓ Saved ${filename}`, 'success');
      // Auto-hide success message after 5 seconds
      setTimeout(() => hideExportStatus(), 5000);
    } else {
      showExportStatus(`Export failed: ${saveResult.error}`, 'error');
    }

  } catch (error) {
    console.error('Error exporting SVG:', error);
    showExportStatus(`Export error: ${error.message}`, 'error');
  }
}

function getPaperDimensions(paperSize, originalWidth, originalHeight) {
  // Paper sizes in points (1 point = 1/72 inch)
  const sizes = {
    original: { width: Math.round(originalWidth), height: Math.round(originalHeight) },
    letter: { width: 612, height: 792 },      // 8.5" × 11"
    legal: { width: 612, height: 1008 },      // 8.5" × 14"
    tabloid: { width: 792, height: 1224 },    // 11" × 17"
    a4: { width: 595, height: 842 },          // 210mm × 297mm
    a3: { width: 842, height: 1191 },         // 297mm × 420mm
    a2: { width: 1191, height: 1684 },        // 420mm × 594mm
    a1: { width: 1684, height: 2384 },        // 594mm × 841mm
    a0: { width: 2384, height: 3370 }         // 841mm × 1189mm
  };

  const size = sizes[paperSize] || sizes.original;

  // Calculate aspect ratios
  const originalAspect = originalWidth / originalHeight;
  const paperAspect = size.width / size.height;

  // Fit content to paper size while maintaining aspect ratio
  let width, height;
  if (originalAspect > paperAspect) {
    // Content is wider - fit to width
    width = size.width;
    height = size.width / originalAspect;
  } else {
    // Content is taller - fit to height
    height = size.height;
    width = size.height * originalAspect;
  }

  return {
    width: `${Math.round(width)}pt`,
    height: `${Math.round(height)}pt`
  };
}

function generateSVG(isExport) {
  const paths = currentPDFData.contentPaths.paths;
  const stats = currentPDFData.contentPaths.statistics || {};

  // Filter paths by enabled color sublayers
  const filteredPaths = paths.filter(path => {
    if (!path.layer) return false;

    // Determine the color for this path (prefer stroke, fall back to fill)
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    if (!pathColor) return false;

    // Check if the color sublayer is enabled
    const sublayerName = `${path.layer}::${pathColor}`;
    return enabledLayers.has(sublayerName);
  });

  if (filteredPaths.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="200" y="150" text-anchor="middle" fill="#999">No paths to display</text></svg>';
  }

  // Calculate bounding box - use cached bounds if available for preview mode
  let minX, minY, maxX, maxY, width, height;

  if (!isExport && cachedBounds) {
    // Use cached bounds for preview to prevent jumping
    ({ minX, minY, maxX, maxY, width, height } = cachedBounds);
  } else {
    // Calculate bounds from all paths (for initial load or export)
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;

    paths.forEach(path => {
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

    width = maxX - minX;
    height = maxY - minY;

    // Cache the bounds for future preview renders
    if (!isExport) {
      cachedBounds = { minX, minY, maxX, maxY, width, height };
    }
  }

  const padding = 10;

  // Generate SVG header
  const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

  // For preview mode, use 100% width/height so it fits the container
  // For export mode, calculate dimensions based on paper size
  let widthAttr;
  if (isExport) {
    const paperSize = document.getElementById('paperSizeSelect')?.value || 'original';
    const dimensions = getPaperDimensions(paperSize, width, height);
    widthAttr = `width="${dimensions.width}" height="${dimensions.height}"`;
  } else {
    widthAttr = 'width="100%" height="100%"';
  }

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${widthAttr} viewBox="${viewBox}">
`;

  // Add white background if requested (export only)
  if (isExport && whiteBackgroundCheck.checked) {
    svg += `  <rect x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="white"/>\n`;
  }

  // Add title
  svg += `  <title>GeoPDF Export - ${enabledLayers.size} layers</title>\n`;

  // Store crop bounds for later use (after path generation)
  // Crop mask is added when checkbox is checked (both preview and export)
  // User can then manually process it in vector editors
  let cropMaskSvg = '';
  if (cropMaskCheck.checked) {
    // Calculate crop area - typically the inner map area excluding collar
    // For now, we'll inset by 5% on each side as a reasonable default
    const cropInset = Math.min(width, height) * 0.05;
    const cropX = minX + cropInset;
    const cropY = minY + cropInset;
    const cropWidth = width - (cropInset * 2);
    const cropHeight = height - (cropInset * 2);

    // Create a semi-transparent white frame around the crop area
    // This is a box with a hole cut out - the underlying layers are NOT cropped
    // User can manually process this mask layer in vector editors (Inkscape, Illustrator, etc.)
    cropMaskSvg += `  <g id="crop-mask" data-description="Crop guide - delete or use as clipping mask in vector editor">\n`;
    // Top bar
    cropMaskSvg += `    <rect x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${cropY - (minY - padding)}" fill="white" opacity="0.7"/>\n`;
    // Bottom bar
    cropMaskSvg += `    <rect x="${minX - padding}" y="${cropY + cropHeight}" width="${width + padding * 2}" height="${(maxY + padding) - (cropY + cropHeight)}" fill="white" opacity="0.7"/>\n`;
    // Left bar
    cropMaskSvg += `    <rect x="${minX - padding}" y="${cropY}" width="${cropX - (minX - padding)}" height="${cropHeight}" fill="white" opacity="0.7"/>\n`;
    // Right bar
    cropMaskSvg += `    <rect x="${cropX + cropWidth}" y="${cropY}" width="${(maxX + padding) - (cropX + cropWidth)}" height="${cropHeight}" fill="white" opacity="0.7"/>\n`;
    // Add border outline for the crop area
    cropMaskSvg += `    <rect x="${cropX}" y="${cropY}" width="${cropWidth}" height="${cropHeight}" fill="none" stroke="red" stroke-width="2" stroke-dasharray="10,5"/>\n`;
    cropMaskSvg += `  </g>\n`;
  }

  // Group paths by color sublayer
  const pathsByLayer = {};
  filteredPaths.forEach(path => {
    // Determine the color for this path
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    const sublayerName = `${path.layer}::${pathColor}`;
    if (!pathsByLayer[sublayerName]) {
      pathsByLayer[sublayerName] = [];
    }
    pathsByLayer[sublayerName].push(path);
  });

  // Generate path elements grouped by color sublayer
  // Render in REVERSE order of allLayers array - layers at top of UI list render last (appear on top)
  // This ensures proper z-ordering where later layers in the UI appear above earlier ones
  const layersToRender = allLayers.slice().reverse().filter(layer => pathsByLayer[layer]);

  // Add any layers not in allLayers (shouldn't happen, but failsafe)
  Object.keys(pathsByLayer).forEach(layerName => {
    if (!layersToRender.includes(layerName)) {
      layersToRender.push(layerName);
    }
  });

  layersToRender.forEach(layerName => {
    svg += `  <g id="layer-${layerName.replace(/[^a-zA-Z0-9]/g, '-')}" data-layer="${layerName}">\n`;

    pathsByLayer[layerName].forEach((path, index) => {
      // Always skip paths with pure white fill (artifacts/collar elements)
      if (path.fill && path.fillColor) {
        const [r, g, b] = path.fillColor;
        if (r === 255 && g === 255 && b === 255) {
          return; // Skip this path
        }
      }

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
      const stroke = path.stroke ? `rgb(${path.strokeColor.join(',')})` : 'none';
      //  Use lineWidth from PDF path, or default to 1 for visibility
      const strokeWidth = path.lineWidth !== undefined ? path.lineWidth : (path.strokeWidth || 1);

      svg += `    <path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
    });

    svg += `  </g>\n`;
  });

  // Add crop mask overlay on top of all paths
  if (cropMaskSvg) {
    svg += cropMaskSvg;
  }

  svg += '</svg>';
  return svg;
}

function displayMetadata(metadata, info, data) {
  metadataDiv.innerHTML = '';

  // Create section headers and organize by category
  const createSection = (title) => {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom: 16px;';

    const heading = document.createElement('h4');
    heading.textContent = title;
    heading.style.cssText = 'font-size: 0.9em; font-weight: 600; color: #667eea; margin: 0 0 8px 0; padding-bottom: 4px; border-bottom: 2px solid #e0e4ff;';
    section.appendChild(heading);

    return section;
  };

  const createItem = (label, value) => {
    const div = document.createElement('div');
    div.className = 'metadata-item';
    div.innerHTML = `<strong>${label}:</strong> ${value}`;
    return div;
  };

  // === DOCUMENT INFORMATION ===
  const docSection = createSection('Document Information');
  docSection.appendChild(createItem('Title', metadata.title || info?.Title || 'Unknown'));
  docSection.appendChild(createItem('Creator', metadata.creator || info?.Creator || 'Unknown'));
  docSection.appendChild(createItem('Producer', metadata.producer || info?.Producer || 'Unknown'));
  docSection.appendChild(createItem('Created', formatDate(metadata.creationDate || info?.CreationDate)));
  if (info?.ModDate) {
    docSection.appendChild(createItem('Modified', formatDate(info.ModDate)));
  }
  if (info?.Subject) {
    docSection.appendChild(createItem('Subject', info.Subject));
  }
  if (info?.Keywords) {
    docSection.appendChild(createItem('Keywords', info.Keywords));
  }
  metadataDiv.appendChild(docSection);

  // === PDF SPECIFICATIONS ===
  const pdfSection = createSection('PDF Specifications');
  pdfSection.appendChild(createItem('Pages', metadata.pageCount || 'Unknown'));
  pdfSection.appendChild(createItem('GeoPDF', metadata.isGeoPDF ? 'Yes ✓' : 'No'));
  pdfSection.appendChild(createItem('PDF Version', metadata.version || info?.PDFFormatVersion || 'Unknown'));

  if (currentFilePath) {
    try {
      const fs = require('fs');
      const stats = fs.statSync(currentFilePath);
      pdfSection.appendChild(createItem('File Size', formatBytes(stats.size)));
    } catch (e) {
      // Ignore if can't get file size
    }
  }

  // Page boxes information
  if (metadata.pageBoxes) {
    const boxes = [];
    if (metadata.pageBoxes.hasMediaBox) boxes.push('MediaBox');
    if (metadata.pageBoxes.hasCropBox) boxes.push('CropBox');
    if (metadata.pageBoxes.hasTrimBox) boxes.push('TrimBox');
    if (metadata.pageBoxes.hasBleedBox) boxes.push('BleedBox');
    if (metadata.pageBoxes.hasArtBox) boxes.push('ArtBox');
    if (boxes.length > 0) {
      pdfSection.appendChild(createItem('Page Boxes', boxes.join(', ')));
    }
  }

  metadataDiv.appendChild(pdfSection);

  // === PAGE DIMENSIONS ===
  if (metadata.pageDimensions) {
    const dimSection = createSection('Page Dimensions');
    const dims = metadata.pageDimensions;

    // Points
    dimSection.appendChild(createItem('Points (PDF units)',
      `${dims.widthPt.toFixed(2)} × ${dims.heightPt.toFixed(2)} pt`));

    // Inches
    dimSection.appendChild(createItem('Inches (print)',
      `${dims.widthIn.toFixed(2)}" × ${dims.heightIn.toFixed(2)}"`));

    // Millimeters
    dimSection.appendChild(createItem('Millimeters',
      `${dims.widthMm.toFixed(2)} × ${dims.heightMm.toFixed(2)} mm`));

    // Orientation
    const orientation = dims.widthPt > dims.heightPt ? 'Landscape' :
                       dims.widthPt < dims.heightPt ? 'Portrait' : 'Square';
    dimSection.appendChild(createItem('Orientation', orientation));

    // Aspect ratio
    const aspectRatio = dims.widthPt / dims.heightPt;
    dimSection.appendChild(createItem('Aspect Ratio',
      `${aspectRatio.toFixed(3)}:1`));

    // Estimated print size at 300 DPI
    const widthPx300 = Math.round(dims.widthIn * 300);
    const heightPx300 = Math.round(dims.heightIn * 300);
    dimSection.appendChild(createItem('Pixels @ 300 DPI',
      `${widthPx300.toLocaleString()} × ${heightPx300.toLocaleString()} px`));

    // Estimated print size at 150 DPI (common scan resolution)
    const widthPx150 = Math.round(dims.widthIn * 150);
    const heightPx150 = Math.round(dims.heightIn * 150);
    dimSection.appendChild(createItem('Pixels @ 150 DPI',
      `${widthPx150.toLocaleString()} × ${heightPx150.toLocaleString()} px`));

    metadataDiv.appendChild(dimSection);
  }

  // === LAYER INFORMATION ===
  if (data && allLayers && allLayers.length > 0) {
    const layerSection = createSection('Layer Information');
    layerSection.appendChild(createItem('Total Layers', allLayers.length.toString()));

    // Count layer types
    const vectorLayers = allLayers.filter(l => !l.startsWith('📝 ')).length;
    const textLayers = allLayers.filter(l => l.startsWith('📝 ')).length;

    if (vectorLayers > 0) {
      layerSection.appendChild(createItem('Vector Layers', vectorLayers.toString()));
    }
    if (textLayers > 0) {
      layerSection.appendChild(createItem('Text Layers', textLayers.toString()));
    }

    // Show layer names in a collapsible list
    if (data.layerNames && Object.keys(data.layerNames).length > 0) {
      const layerNamesDiv = document.createElement('div');
      layerNamesDiv.style.cssText = 'margin-top: 8px;';

      const layerNamesLabel = document.createElement('strong');
      layerNamesLabel.textContent = 'Layer Names:';
      layerNamesDiv.appendChild(layerNamesLabel);

      const layerNamesList = document.createElement('div');
      layerNamesList.style.cssText = 'font-size: 0.85em; color: #666; padding-left: 8px; margin-top: 4px; max-height: 150px; overflow-y: auto;';

      allLayers.slice(0, 20).forEach(name => {
        const layerItem = document.createElement('div');
        layerItem.textContent = `• ${name}`;
        layerItem.style.cssText = 'padding: 2px 0;';
        layerNamesList.appendChild(layerItem);
      });

      if (allLayers.length > 20) {
        const moreItem = document.createElement('div');
        moreItem.textContent = `... and ${allLayers.length - 20} more`;
        moreItem.style.cssText = 'padding: 2px 0; font-style: italic; color: #999;';
        layerNamesList.appendChild(moreItem);
      }

      layerNamesDiv.appendChild(layerNamesList);
      layerSection.appendChild(layerNamesDiv);
    }

    metadataDiv.appendChild(layerSection);
  }

  // === CONTENT STATISTICS ===
  if (data && data.contentPaths) {
    const contentSection = createSection('Content Statistics');

    // Path statistics
    if (data.contentPaths.paths) {
      contentSection.appendChild(createItem('Total Paths', data.contentPaths.paths.length.toLocaleString()));
    }

    // Text statistics
    if (data.contentPaths.textObjects && data.contentPaths.textObjects.length > 0) {
      contentSection.appendChild(createItem('Text Objects', data.contentPaths.textObjects.length.toLocaleString()));
    }

    // Detailed statistics from parser
    if (data.contentPaths.statistics) {
      const stats = data.contentPaths.statistics;

      if (stats.total) {
        contentSection.appendChild(createItem('Path Operations', stats.total.toLocaleString()));
      }

      if (stats.averageSegments) {
        contentSection.appendChild(createItem('Avg Segments/Path', stats.averageSegments.toFixed(1)));
      }

      // Color statistics
      if (stats.byColor && Object.keys(stats.byColor).length > 0) {
        contentSection.appendChild(createItem('Unique Colors', Object.keys(stats.byColor).length.toString()));
      }

      // Operation type breakdown
      if (stats.byOperation) {
        const opsDiv = document.createElement('div');
        opsDiv.style.cssText = 'margin-top: 8px;';

        const opsLabel = document.createElement('strong');
        opsLabel.textContent = 'Operation Types:';
        opsDiv.appendChild(opsLabel);

        const opsList = document.createElement('div');
        opsList.style.cssText = 'font-size: 0.85em; color: #666; padding-left: 8px; margin-top: 4px;';

        Object.entries(stats.byOperation)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .forEach(([op, count]) => {
            const opItem = document.createElement('div');
            const percentage = stats.total ? ((count / stats.total) * 100).toFixed(1) : '0';
            opItem.textContent = `• ${op}: ${count.toLocaleString()} (${percentage}%)`;
            opItem.style.cssText = 'padding: 2px 0;';
            opsList.appendChild(opItem);
          });

        opsDiv.appendChild(opsList);
        contentSection.appendChild(opsDiv);
      }
    }

    metadataDiv.appendChild(contentSection);
  }

  // === FONTS ===
  if (data && data.contentPaths && data.contentPaths.fontDetails) {
    const fonts = new Set();

    // Get fonts from fontDetails (actual BaseFont names like "Arial-Bold")
    Object.values(data.contentPaths.fontDetails).forEach(fontName => {
      if (fontName) {
        fonts.add(fontName);
      }
    });

    // Display fonts if any were found
    if (fonts.size > 0) {
      const fontSection = createSection('Fonts');
      fontSection.appendChild(createItem('Total Fonts', fonts.size.toString()));

      const fontsList = document.createElement('div');
      fontsList.style.cssText = 'font-size: 0.85em; color: #666; padding-left: 8px; margin-top: 4px;';

      const sortedFonts = Array.from(fonts).sort();
      sortedFonts.forEach(font => {
        const fontItem = document.createElement('div');
        fontItem.textContent = `• ${font}`;
        fontItem.style.cssText = 'padding: 2px 0;';
        fontsList.appendChild(fontItem);
      });

      fontSection.appendChild(fontsList);
      metadataDiv.appendChild(fontSection);
    }
  }
}

// FUNCTION REMOVED - Text Data tab no longer exists
// function displayTextData(data) { ... }
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
    <div style="margin-bottom: 10px; font-weight: 600;">${message}</div>
    <div style="margin-bottom: 8px; font-size: 0.85em; color: #666;">This may take 1-2 minutes for large files. Please wait...</div>
    <div style="width: 100%; background: #e0e0e0; border-radius: 4px; overflow: hidden; height: 12px; position: relative;">
      <div class="progress-bar" style="width: 100%; height: 100%; background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #667eea 100%); background-size: 200% 100%; animation: progressAnimation 1.5s linear infinite;"></div>
    </div>
    <div style="margin-top: 8px; font-size: 0.75em; color: #999; text-align: center;">Processing PDF layers and content streams...</div>
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

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
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
  panX = 0;
  panY = 0;
  updateZoomDisplay();
}

function updateZoomDisplay() {
  // Update zoom level text
  zoomLevelSpan.textContent = `${Math.round(currentZoom * 100)}%`;

  // Apply zoom and pan to SVG
  const svg = mapPreviewDiv.querySelector('svg');
  if (svg) {
    // Use center as transform origin for intuitive zooming
    svg.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
    svg.style.transformOrigin = 'center center';
  }
}

function startPan(e) {
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
  mapPreviewDiv.classList.add('panning');
}

function doPan(e) {
  if (!isPanning) return;

  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  updateZoomDisplay();
}

function endPan() {
  isPanning = false;
  mapPreviewDiv.classList.remove('panning');
}

function handleWheel(e) {
  e.preventDefault();

  // Zoom in/out with mouse wheel
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  adjustZoom(delta);
}

function showExportStatus(message, type) {
  exportStatusDiv.textContent = message;
  exportStatusDiv.className = `export-status ${type}`;
}

function hideExportStatus() {
  exportStatusDiv.className = 'export-status';
}

// Collapseable sections functionality
function toggleCollapse(contentId) {
  const content = document.getElementById(contentId);
  const icon = document.getElementById(`${contentId}-icon`);

  if (content && icon) {
    content.classList.toggle('collapsed');
    icon.classList.toggle('collapsed');
  }
}

// Make toggleCollapse available globally for inline onclick handlers
window.toggleCollapse = toggleCollapse;
