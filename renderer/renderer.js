// Node.js modules (available because nodeIntegration is enabled)
const fs = require('fs');
const path = require('path');
// PDFProcessor no longer needed in renderer - processing happens in main process
// const PDFProcessor = require('../src/pdf-processor');

// State management
let currentPDFData = null; // Now holds lightweight data (metadata, layerInfo, no paths)
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

// Crop mode state
let cropModeEnabled = false;
let cropRectangle = null; // SVG element for crop overlay
let cropX = 0;
let cropY = 0;
let cropWidth = 300; // mm
let cropHeight = 400; // mm
let cropScale = 1.0;
let isDraggingCrop = false;
let cropDragStartX = 0;
let cropDragStartY = 0;
let cropApplied = false; // Track if crop has been applied
let lastSavedFilePath = null; // Track the last saved file path

// Background color state
let bgColorEnabled = false;
let bgColorValue = '#ffffff';

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
  'Images',
  'Unassigned' // USGS logo and other unassigned elements
];

// Specific color sublayers that should be treated as overlays
// Format: { baseLayer: [colors] } - white shields only
const OVERLAY_COLOR_SUBLAYERS = {
  'Hydrography': ['rgb(255,255,255)'], // White shields/masks
  'Road Features': ['rgb(255,255,255)'], // White shields only
  'Transportation': ['rgb(255,255,255)'], // White shields only
  'Terrain': ['rgb(255,255,255)'], // White shields/masks
  'Woodland': ['rgb(255,255,255)'] // White shields/masks
};

// Overlay group categories for organizing the sidebar
const OVERLAY_GROUPS = {
  'Map Elements': ['Map Elements', 'Map Collar', 'Map Frame', 'Barcode', 'Images'],
  'Projection and Grids': ['Projection and Grids', 'Graticule'],
  'Structures': ['Structures', 'Airports'],
  // Everything else (Geographic Names, Boundaries, shields, Unassigned, etc.) goes to 'Other'
};

// Layers to exclude from bounds calculation
// These layers often contain coordinates that extend far beyond the actual map area
// Especially problematic in 2025 Topobuilder format where Map Collar has huge bounds
const BOUNDS_EXCLUDE_LAYERS = [
  'Map Collar',
  'Map Frame',
  'Projection and Grids',
  'Barcode',
  'Map Elements',
  'Graticule',
  'Map Surround',
  'Magnetic Declination',
  'Geographic Names', // Text labels can extend beyond map area
  'Emergency Services', // Can have scattered points far from map
  'Structures' // Building footprints can be outliers
];

// Smart layer naming - infer feature types from colors
// Maps base layer names + color patterns to descriptive names
const LAYER_COLOR_DESCRIPTORS = {
  'Contours': {
    'rgb(153,102,51)': 'Contours (Index - Light)',
    'rgb(102,51,0)': 'Contours (Index - Medium)',
    'rgb(51,25,0)': 'Contours (Index - Dark)',
    'rgb(153,76,0)': 'Contours (Intermediate)',
    'rgb(139,90,43)': 'Contours (Supplemental)'
  },
  'Hydrography': {
    'rgb(0,0,0)': 'Hydrography (Outlines)',
    'rgb(151,219,242)': 'Hydrography (Lakes - Light)',
    'rgb(190,232,255)': 'Hydrography (Lakes - Pale)',
    'rgb(0,92,230)': 'Hydrography (Rivers - Blue)',
    'rgb(0,112,255)': 'Hydrography (Streams)',
    'rgb(0,77,168)': 'Hydrography (Water Bodies)',
    'rgb(153,204,255)': 'Hydrography (Wetlands)',
    'rgb(204,235,197)': 'Hydrography (Marshes)'
  },
  'Transportation': {
    'rgb(0,0,0)': 'Roads (Primary - Black)',
    'rgb(255,0,0)': 'Roads (Highways - Red)',
    'rgb(209,110,0)': 'Roads (Secondary - Orange)',
    'rgb(204,204,204)': 'Roads (Local - Gray)',
    'rgb(156,156,156)': 'Roads (Minor - Light Gray)',
    'rgb(255,211,127)': 'Roads (Unimproved - Tan)'
  },
  'Road Features': {
    'rgb(0,0,0)': 'Roads (Primary)',
    'rgb(255,0,0)': 'Roads (Highways)',
    'rgb(209,110,0)': 'Roads (Secondary)',
    'rgb(204,204,204)': 'Roads (Local)',
    'rgb(156,156,156)': 'Roads (Minor)'
  },
  'Trails': {
    'rgb(0,0,0)': 'Trails (Primary)',
    'rgb(255,0,0)': 'Trails (Marked)',
    'rgb(139,69,19)': 'Trails (Unpaved)',
    'rgb(204,102,0)': 'Trails (Secondary)'
  },
  'Woodland': {
    'rgb(228,246,210)': 'Woodland (Forest - Light)',
    'rgb(209,255,189)': 'Woodland (Forest - Pale)',
    'rgb(180,215,155)': 'Woodland (Forest - Medium)',
    'rgb(137,205,102)': 'Woodland (Dense Forest)'
  }
};

// Helper function to get descriptive layer name
function getDescriptiveLayerName(baseName, colorStr) {
  // Check if we have a custom descriptor for this base name + color
  if (LAYER_COLOR_DESCRIPTORS[baseName] && LAYER_COLOR_DESCRIPTORS[baseName][colorStr]) {
    return LAYER_COLOR_DESCRIPTORS[baseName][colorStr];
  }

  // Fall back to base name
  return baseName;
}

// Helper function to check if a layer should be categorized as overlay
function isOverlayLayer(layerName) {
  // Extract base layer name and color if it's a color sublayer
  const [baseName, colorStr] = layerName.includes('::')
    ? layerName.split('::')
    : [layerName, null];

  // Text layers (with emoji prefix) are always overlays
  if (baseName.startsWith('📝 ')) {
    return true;
  }

  // Check if this specific color sublayer should be an overlay
  // (e.g., white shields, black airport runways)
  if (colorStr && OVERLAY_COLOR_SUBLAYERS[baseName]) {
    if (OVERLAY_COLOR_SUBLAYERS[baseName].includes(colorStr)) {
      return true;
    }
  }

  // Check if layer name matches any overlay patterns
  return OVERLAY_LAYER_PATTERNS.some(pattern =>
    baseName.toLowerCase().includes(pattern.toLowerCase())
  );
}

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const metadataDiv = document.getElementById('metadata');
const layerControlsDiv = document.getElementById('layerControls');
const textLayerControlsDiv = document.getElementById('textLayerControls');
const mapPreviewDiv = document.getElementById('mapPreview');
const mapStatsDiv = document.getElementById('mapStats');
const exportSvgBtn = document.getElementById('exportSvgBtn');
const whiteBackgroundCheck = document.getElementById('whiteBackgroundCheck');
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
const textCountBadge = document.getElementById('textCountBadge');

// Text extraction elements
const extractTextBtn = document.getElementById('extractTextBtn');
const fontListDiv = document.getElementById('fontList');
const textElementListDiv = document.getElementById('textElementList');
const textElementCountSpan = document.getElementById('textElementCount');
const exportTextJsonBtn = document.getElementById('exportTextJsonBtn');
const exportTextSvgBtn = document.getElementById('exportTextSvgBtn');

// Text extraction state
let extractedTextData = null;

// Crop mode elements
const cropModeBtn = document.getElementById('cropModeBtn');
const cropModeLabel = document.getElementById('cropModeLabel');
const cropControls = document.getElementById('cropControls');
const cropWidthInput = document.getElementById('cropWidthInput');
const cropHeightInput = document.getElementById('cropHeightInput');
const cropScaleSlider = document.getElementById('cropScaleSlider');
const cropScaleValue = document.getElementById('cropScaleValue');
const cropPositionDisplay = document.getElementById('cropPositionDisplay');
const cropActualSize = document.getElementById('cropActualSize');
const applyCropBtn = document.getElementById('applyCropBtn');

// Background color elements
const bgColorCheck = document.getElementById('bgColorCheck');
const bgColorPicker = document.getElementById('bgColorPicker');

// Loading gear element
const loadingGear = document.getElementById('loadingGear');

// Color tooltip element (created dynamically)
let colorTooltip = null;

// Event listeners
uploadBtn.addEventListener('click', handleUpload);
exportSvgBtn.addEventListener('click', handleExportSVG);
zoomInBtn.addEventListener('click', () => adjustZoom(0.1));
zoomOutBtn.addEventListener('click', () => adjustZoom(-0.1));
zoomResetBtn.addEventListener('click', resetZoom);
selectAllLayersBtn.addEventListener('click', selectAllLayers);
deselectAllLayersBtn.addEventListener('click', deselectAllLayers);
selectAllTextLayersBtn.addEventListener('click', selectAllTextLayers);
deselectAllTextLayersBtn.addEventListener('click', deselectAllTextLayers);

// Text extraction event listeners
if (extractTextBtn) {
  extractTextBtn.addEventListener('click', handleExtractText);
}
if (exportTextJsonBtn) {
  exportTextJsonBtn.addEventListener('click', handleExportTextJson);
}
if (exportTextSvgBtn) {
  exportTextSvgBtn.addEventListener('click', handleExportTextSvg);
}

// Crop mode event listeners
cropModeBtn.addEventListener('click', toggleCropMode);
cropWidthInput.addEventListener('input', updateCropDimensions);
cropHeightInput.addEventListener('input', updateCropDimensions);
cropScaleSlider.addEventListener('input', updateCropScale);
applyCropBtn.addEventListener('click', applyCrop);

// Background color event listeners
bgColorCheck.addEventListener('change', () => {
  bgColorEnabled = bgColorCheck.checked;
  bgColorPicker.disabled = !bgColorEnabled;
  generateMapPreview();
});
bgColorPicker.addEventListener('input', () => {
  bgColorValue = bgColorPicker.value;
  generateMapPreview();
});

// Panning event listeners
mapPreviewDiv.addEventListener('mousedown', startPan);
mapPreviewDiv.addEventListener('mousemove', doPan);
mapPreviewDiv.addEventListener('mouseup', endPan);
mapPreviewDiv.addEventListener('mouseleave', endPan);

// Zoom with mouse wheel
mapPreviewDiv.addEventListener('wheel', handleWheel);

// ============================================
// Loading Gear Indicator Functions
// ============================================

function showLoadingGear() {
  if (loadingGear) {
    loadingGear.classList.add('spinning');
  }
}

function hideLoadingGear() {
  if (loadingGear) {
    loadingGear.classList.remove('spinning');
  }
}

// ============================================
// Color Swatch Helper Functions
// ============================================

// Convert RGB string to hex
function rgbToHex(rgbStr) {
  const match = rgbStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return rgbStr;
  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Create or get the color tooltip element
function getColorTooltip() {
  if (!colorTooltip) {
    colorTooltip = document.createElement('div');
    colorTooltip.className = 'color-tooltip';
    document.body.appendChild(colorTooltip);
  }
  return colorTooltip;
}

// Show tooltip for a color swatch
function showColorTooltip(swatch, color) {
  const tooltip = getColorTooltip();
  const hex = rgbToHex(color);
  tooltip.innerHTML = `${hex}<br>${color}`;

  const rect = swatch.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 8}px`;
  tooltip.style.transform = 'translate(-50%, -100%)';
  tooltip.classList.add('visible');
}

// Hide the color tooltip
function hideColorTooltip() {
  const tooltip = getColorTooltip();
  tooltip.classList.remove('visible');
}

// Copy color to clipboard and show feedback
async function copyColorToClipboard(color, event) {
  const hex = rgbToHex(color);
  try {
    await navigator.clipboard.writeText(hex);
    showCopyFeedback(event, `Copied ${hex}`);
  } catch (err) {
    console.error('Failed to copy:', err);
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = hex;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showCopyFeedback(event, `Copied ${hex}`);
  }
}

// Show copy feedback popup
function showCopyFeedback(event, message) {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = message;
  feedback.style.left = `${event.clientX}px`;
  feedback.style.top = `${event.clientY - 30}px`;
  feedback.style.transform = 'translateX(-50%)';
  document.body.appendChild(feedback);

  // Remove after animation
  setTimeout(() => {
    feedback.remove();
  }, 1500);
}

// Show color picker for changing a layer's color
function showColorPicker(layerName, currentColor, swatch) {
  // Create a hidden color input
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = rgbToHex(currentColor);
  picker.style.position = 'absolute';
  picker.style.opacity = '0';
  picker.style.pointerEvents = 'none';
  document.body.appendChild(picker);

  picker.addEventListener('input', (e) => {
    const newColor = e.target.value;
    // Update the swatch background
    swatch.style.background = newColor;
    // Store the color change for this layer
    if (!window.layerColorOverrides) {
      window.layerColorOverrides = {};
    }
    window.layerColorOverrides[layerName] = newColor;
    // Regenerate preview with new color
    generateMapPreview();
  });

  picker.addEventListener('change', () => {
    // Clean up picker
    setTimeout(() => picker.remove(), 100);
  });

  picker.click();
}

// Tab switching
function switchTab(tabName) {
  // If switching away from export tab and crop mode is enabled, disable it
  if (cropModeEnabled) {
    cropModeEnabled = false;
    cropModeLabel.textContent = 'Crop';
    cropModeBtn.style.background = '';
    cropControls.style.display = 'none';
    removeCropRectangle();
    mapPreviewDiv.addEventListener('mousedown', startPan);
  }

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

  // Toggle between map preview and vector debug panel
  const mapPreviewPanel = document.getElementById('mapPreviewPanel');
  const vectorDebugPanel = document.getElementById('vectorDebugPanel');
  if (tabName === 'metadata') {
    mapPreviewPanel.style.display = 'none';
    vectorDebugPanel.style.display = 'flex';
    // Populate vector debug content
    populateVectorDebugPanel();
  } else {
    mapPreviewPanel.style.display = 'flex';
    vectorDebugPanel.style.display = 'none';
  }

  // Force a layout recalculation to prevent layer controls from disappearing
  // This ensures the flex layout properly calculates after tab switch
  if (panel) {
    void panel.offsetHeight; // Trigger reflow
  }
}

// Add click handlers to tab buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    // Use currentTarget to get the button, not any inner child element
    const button = e.currentTarget;
    const tabName = button.getAttribute('data-tab');
    if (tabName) {
      switchTab(tabName);
    }
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

// Recent files management
const recentFilesSection = document.getElementById('recentFilesSection');
const recentFilesList = document.getElementById('recentFilesList');
const clearRecentBtn = document.getElementById('clearRecentBtn');

async function loadRecentFiles() {
  if (!window.electronAPI || !window.electronAPI.getRecentFiles) return;

  try {
    const recentFiles = await window.electronAPI.getRecentFiles();

    if (recentFiles && recentFiles.length > 0) {
      recentFilesSection.style.display = 'block';
      renderRecentFiles(recentFiles);
    } else {
      recentFilesSection.style.display = 'none';
    }
  } catch (error) {
    console.error('Error loading recent files:', error);
  }
}

async function renderRecentFiles(files) {
  recentFilesList.innerHTML = '';

  for (const file of files) {
    const exists = await window.electronAPI.fileExists(file.path);
    const item = document.createElement('div');
    item.className = `recent-file-item${exists ? '' : ' missing'}`;

    // Format date
    const date = new Date(file.lastOpened);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Format path count
    const pathsStr = file.pathCount ? `${file.pathCount.toLocaleString()} paths` : '';

    // Geographic bounds info
    let geoStr = '';
    if (file.geoBounds) {
      const lat = ((file.geoBounds.minLat + file.geoBounds.maxLat) / 2).toFixed(2);
      const lon = ((file.geoBounds.minLon + file.geoBounds.maxLon) / 2).toFixed(2);
      geoStr = `${lat}°, ${lon}°`;
    }

    item.innerHTML = `
      <div class="recent-file-icon">PDF</div>
      <div class="recent-file-info">
        <div class="recent-file-name">${file.title || file.name}${file.isGeoPDF ? '<span class="recent-file-geo">GeoPDF</span>' : ''}</div>
        <div class="recent-file-meta">${[pathsStr, geoStr, dateStr].filter(Boolean).join(' • ')}</div>
      </div>
      <button class="recent-file-remove" title="Remove from list">×</button>
    `;

    // Click to open (if file exists)
    if (exists) {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('recent-file-remove')) {
          openRecentFile(file.path);
        }
      });
    }

    // Remove button
    const removeBtn = item.querySelector('.recent-file-remove');
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.electronAPI.removeRecentFile(file.path);
      loadRecentFiles(); // Refresh list
    });

    recentFilesList.appendChild(item);
  }
}

async function openRecentFile(filePath) {
  // Use unified loading function
  uploadBtn.disabled = true;
  document.body.style.cursor = 'wait';
  await loadPDFFile(filePath);
}

async function trackRecentFile(filePath, result) {
  // Files are now tracked automatically in main process during processing
  // This function is kept for backwards compatibility
  console.log('File tracked in main process:', filePath);
}

// Clear recent files
if (clearRecentBtn) {
  clearRecentBtn.addEventListener('click', async () => {
    await window.electronAPI.clearRecentFiles();
    loadRecentFiles();
  });
}

// Load recent files on startup
loadRecentFiles();

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

    await loadPDFFile(filePath);

  } catch (error) {
    console.error('Error handling upload:', error);
    showStatus(`Error: ${error.message}`, 'error');
    uploadBtn.disabled = false;
    document.body.style.cursor = 'default';
  }
}

// Unified PDF loading function - used by both upload and recent files
async function loadPDFFile(filePath) {
  currentFilePath = filePath;
  const fileName = filePath.split('/').pop();

  showStatusWithProgress(`Processing ${fileName}...`, 'info');

  try {
    // Process PDF in main process (keeps paths there, returns lightweight data)
    console.time('PDF:BackendProcess');
    const result = await window.electronAPI.processPDFLightweight(filePath);
    console.timeEnd('PDF:BackendProcess');

    if (!result.success) {
      showStatus(`Error: ${result.error}`, 'error');
      uploadBtn.disabled = false;
      document.body.style.cursor = 'default';
      return;
    }

    // Store lightweight data (no path arrays - those stay in main process)
    currentPDFData = result.data;

    // Display results using lightweight data
    displayResultsLightweight(result.data);

    // Hide upload placeholder after successful processing
    uploadPlaceholder.classList.add('hidden');

    // Also hide recent files section
    if (recentFilesSection) {
      recentFilesSection.style.display = 'none';
    }

    hideStatus();
    document.body.style.cursor = 'default';

  } catch (processingError) {
    console.error('Error processing PDF:', processingError);
    showStatus(`Error: ${processingError.message}`, 'error');
    uploadBtn.disabled = false;
    document.body.style.cursor = 'default';
  }
}

function displayResults(data) {
  // Show toolbar
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

  // Enable export button now that PDF is loaded
  exportSvgBtn.disabled = false;
}

// Lightweight version for backend processing (no path data in renderer)
function displayResultsLightweight(data) {
  // Show toolbar
  toolbarDiv.style.display = 'flex';

  // Reset cached bounds for new PDF
  cachedBounds = null;

  // Store bounds from backend if available
  if (data.bounds) {
    cachedBounds = {
      minX: data.bounds.left || 0,
      minY: -(data.bounds.top || 0), // Convert to negative Y
      maxX: data.bounds.right || data.bounds.width || 1728,
      maxY: -(data.bounds.bottom || 0),
      width: data.bounds.width || 1728,
      height: data.bounds.height || 2088
    };
  }

  // Update file info in toolbar
  updateFileInfo();

  // Display metadata
  displayMetadata(data.metadata, data.metadata, data);

  // Extract layers from lightweight layerInfo
  extractLayersFromLightweight(data.layerInfo);

  // Display layer controls
  displayLayerControls();

  // Update tab counts
  updateTabCounts();

  // Update map stats
  updateMapStats(`Loaded ${data.pathCount?.toLocaleString() || 0} paths`);

  // For lightweight mode, we don't generate preview in renderer
  // The preview would need to be generated by backend
  // For now, show a placeholder or request preview from backend
  showLightweightPreview();

  // Enable export button now that PDF is loaded
  exportSvgBtn.disabled = false;
}

// Extract layers from lightweight layerInfo array
function extractLayersFromLightweight(layerInfo) {
  allLayers = [];
  enabledLayers.clear();

  if (!layerInfo || layerInfo.length === 0) {
    console.log('No layer info available');
    return;
  }

  // layerInfo is array of { name, baseLayer, color, pathCount, renderType }
  window.layerColorInfo = {};
  window.layerBaseNames = {};
  window.layerPathCounts = {};
  window.layerRenderType = {};

  layerInfo.forEach(layer => {
    allLayers.push(layer.name);
    window.layerBaseNames[layer.name] = layer.baseLayer;
    window.layerColorInfo[layer.name] = [layer.color];
    window.layerPathCounts[layer.name] = layer.pathCount;
    window.layerRenderType[layer.name] = layer.renderType || 'fill';

    // Enable vector layers by default, but NOT overlay layers
    if (!isOverlayLayer(layer.name)) {
      enabledLayers.add(layer.name);
    }
  });

  // Sort layers alphabetically
  allLayers.sort();

  console.log('Extracted layers from backend:', allLayers.length);
}

// Generate preview from backend
async function showLightweightPreview() {

  // Show loading gear in toolbar (no jarring white overlay)
  showLoadingGear();

  try {
    // Request SVG from backend
    // Don't pass bounds - let SVG generator calculate from actual path data
    const layersArray = Array.from(enabledLayers);
    const result = await window.electronAPI.generateSVG({
      enabledLayers: layersArray,
      bounds: null, // Let backend calculate bounds from paths
      options: { whiteBackground: false }
    });

    if (result.success && result.svg) {
      // Parse SVG and modify for preview
      let previewSvg = result.svg;

      // Get the container dimensions
      const containerWidth = mapPreviewDiv.clientWidth || 800;
      const containerHeight = mapPreviewDiv.clientHeight || 600;

      // Extract original dimensions from SVG
      const widthMatch = previewSvg.match(/width="(\d+)pt"/);
      const heightMatch = previewSvg.match(/height="(\d+)pt"/);
      const origWidth = widthMatch ? parseInt(widthMatch[1]) : 1728;
      const origHeight = heightMatch ? parseInt(heightMatch[1]) : 2088;

      // Calculate scale to fit container while maintaining aspect ratio
      const scaleX = containerWidth / origWidth;
      const scaleY = containerHeight / origHeight;
      const scale = Math.min(scaleX, scaleY) * 0.95; // 95% to add some padding

      const displayWidth = Math.round(origWidth * scale);
      const displayHeight = Math.round(origHeight * scale);

      // Replace dimensions with calculated pixel sizes
      previewSvg = previewSvg.replace(/width="[^"]*pt"/, `width="${displayWidth}"`);
      previewSvg = previewSvg.replace(/height="[^"]*pt"/, `height="${displayHeight}"`);

      // Add preserveAspectRatio for proper scaling
      previewSvg = previewSvg.replace(/<svg ([^>]*)>/, '<svg $1 preserveAspectRatio="xMidYMid meet" style="display: block; margin: auto;">');

      mapPreviewDiv.innerHTML = previewSvg;

      // Apply current zoom/pan
      updateZoomDisplay();

      updateMapStats(`${result.stats.pathCount.toLocaleString()} paths in ${result.stats.layerCount} layers`);
    } else {
      // Show frame lines when no layers are selected
      const containerWidth = mapPreviewDiv.clientWidth || 800;
      const containerHeight = mapPreviewDiv.clientHeight || 600;
      const bounds = cachedBounds || { minX: 0, minY: 0, width: 1728, height: 2088 };
      const { minX, minY, width, height } = bounds;

      // Calculate scale to fit
      const scaleX = containerWidth / (width + 40);
      const scaleY = containerHeight / (height + 40);
      const frameScale = Math.min(scaleX, scaleY) * 0.95;

      const displayWidth = Math.round(width * frameScale);
      const displayHeight = Math.round(height * frameScale);
      const inset = 10;

      mapPreviewDiv.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${displayWidth}" height="${displayHeight}"
             viewBox="${minX - 5} ${minY - 5} ${width + 10} ${height + 10}"
             style="display: block; margin: auto;" preserveAspectRatio="xMidYMid meet">
          <!-- Black solid line frame (outer boundary) -->
          <rect x="${minX}" y="${minY}" width="${width}" height="${height}"
                fill="none" stroke="#000000" stroke-width="2"/>
          <!-- Red dotted line frame (inner boundary) -->
          <rect x="${minX + inset}" y="${minY + inset}" width="${width - inset * 2}" height="${height - inset * 2}"
                fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="8,4"/>
        </svg>
      `;
      updateMapStats('No layers selected');
    }
  } catch (error) {
    console.error('Preview generation error:', error);
    mapPreviewDiv.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #dc3545;">
        <div style="font-size: 2em; margin-bottom: 12px;">❌</div>
        <div>Preview generation failed</div>
        <div style="font-size: 0.85em; margin-top: 8px;">${error.message}</div>
      </div>
    `;
  } finally {
    // Always hide the loading gear when done
    hideLoadingGear();
  }
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

    let debugLayerCounts = {};
    let debugNoColor = 0;

    data.contentPaths.paths.forEach(path => {
      // Use 'Unassigned' for paths without layer assignment (prevents missing geometry)
      const layerName = path.layer || 'Unassigned';
      debugLayerCounts[layerName] = (debugLayerCounts[layerName] || 0) + 1;

      // Collect colors for this layer
      if (!layerColors[layerName]) {
        layerColors[layerName] = new Set();
      }

      // Determine the color for this path (prefer stroke, fall back to fill)
      // Note: After conversion by pdf-processor, path has stroke/fill booleans and strokeColor/fillColor RGB arrays
      let colorStr = null;
      if (path.stroke && path.strokeColor) {
        colorStr = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        colorStr = `rgb(${path.fillColor.join(',')})`;
      }

      if (colorStr) {
        layerColors[layerName].add(colorStr);
        // Create sublayer: "LayerName::rgb(r,g,b)"
        layerColorSublayers.add(`${layerName}::${colorStr}`);
      } else {
        debugNoColor++;
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

  // Populate overlay/annotation layers in Overlay tab, organized by groups
  if (overlayLayers.length > 0) {
    // Helper to get overlay group for a layer
    const getOverlayGroup = (layerName) => {
      const baseName = layerName.includes('::') ? layerName.split('::')[0] : layerName;

      // Check each defined group
      for (const [groupName, patterns] of Object.entries(OVERLAY_GROUPS)) {
        if (patterns.some(p => baseName.toLowerCase().includes(p.toLowerCase()))) {
          return groupName;
        }
      }
      return 'Other';
    };

    // Group layers by category
    const groupedLayers = {
      'Map Elements': [],
      'Projection and Grids': [],
      'Structures': [],
      'Other': []
    };

    overlayLayers.forEach(layerName => {
      const group = getOverlayGroup(layerName);
      groupedLayers[group].push(layerName);
    });

    // Create collapsible sections for each group
    const groupOrder = ['Map Elements', 'Projection and Grids', 'Structures', 'Other'];

    groupOrder.forEach(groupName => {
      const layers = groupedLayers[groupName];
      if (layers.length === 0) return;

      // Create group container
      const groupContainer = document.createElement('div');
      groupContainer.className = 'overlay-group';
      groupContainer.style.cssText = 'margin-bottom: 12px;';

      // Create collapsible header
      const header = document.createElement('div');
      header.className = 'collapseable-header';
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #e8ebff; border-radius: 4px; cursor: pointer; user-select: none;';

      const headerLeft = document.createElement('div');
      headerLeft.style.cssText = 'display: flex; align-items: center; gap: 6px;';

      const collapseIcon = document.createElement('span');
      collapseIcon.className = 'collapse-icon';
      collapseIcon.textContent = '▼';
      collapseIcon.style.cssText = 'font-size: 0.7em; transition: transform 0.2s;';

      const groupTitle = document.createElement('span');
      groupTitle.style.cssText = 'font-weight: 600; font-size: 0.85em; color: #333;';
      groupTitle.textContent = groupName;

      const countBadge = document.createElement('span');
      countBadge.style.cssText = 'font-size: 0.75em; color: #666; background: white; padding: 1px 6px; border-radius: 10px;';
      countBadge.textContent = layers.length;

      headerLeft.appendChild(collapseIcon);
      headerLeft.appendChild(groupTitle);
      header.appendChild(headerLeft);
      header.appendChild(countBadge);

      // Create content container
      const content = document.createElement('div');
      content.className = 'collapseable-content';
      content.style.cssText = 'padding-top: 4px;';

      // Add layers to content
      layers.forEach(layerName => {
        const layerItem = createLayerControlItem(layerName);
        content.appendChild(layerItem);
      });

      // Toggle collapse on header click
      header.addEventListener('click', () => {
        const isCollapsed = content.classList.toggle('collapsed');
        collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : '';
      });

      groupContainer.appendChild(header);
      groupContainer.appendChild(content);
      textLayerControlsDiv.appendChild(groupContainer);
    });
  } else {
    textLayerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No overlay layers found</div>';
  }
}

function createLayerControlItem(layerName) {
  const layerItem = document.createElement('div');
  layerItem.className = 'layer-item';
  layerItem.style.cssText = 'display: flex; align-items: center; gap: 8px; position: relative;';

  // Parse layerName to extract base name and color
  const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];

  // Calculate path count and feature statistics for this specific color sublayer
  let pathCount = 0;
  let totalOperations = 0;
  let hasStroke = 0;
  let hasFill = 0;

  // First try to get from backend-provided path counts (lightweight mode)
  if (window.layerPathCounts && window.layerPathCounts[layerName]) {
    pathCount = window.layerPathCounts[layerName];
  } else if (currentPDFData && currentPDFData.contentPaths) {
    // Fall back to calculating from paths if available
    const paths = currentPDFData.contentPaths.paths;
    const matchingPaths = paths.filter(p => {
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
    });

    pathCount = matchingPaths.length;

    // Calculate additional statistics
    matchingPaths.forEach(p => {
      if (p.operations) totalOperations += p.operations.length;
      if (p.stroke) hasStroke++;
      if (p.fill) hasFill++;
    });
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


  checkbox.addEventListener('change', () => {
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
  label.style.cssText = 'flex: 1; min-width: 0; cursor: help;';

  // Build detailed tooltip with statistics
  const avgOps = pathCount > 0 ? (totalOperations / pathCount).toFixed(1) : 0;
  const featureType = hasStroke > hasFill ? 'lines' : hasFill > hasStroke ? 'fills' : 'mixed';
  const tooltipText = `${pathCount} paths • ${totalOperations.toLocaleString()} operations • Avg ${avgOps} ops/path • Type: ${featureType}`;
  label.title = tooltipText;

  const span = document.createElement('span');
  // Display descriptive name based on base layer + color
  const displayName = getDescriptiveLayerName(baseName, colorStr);
  span.textContent = displayName;

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
      swatch.className = 'color-swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.dataset.layerName = layerName;

      // Hover tooltip
      swatch.addEventListener('mouseenter', () => showColorTooltip(swatch, color));
      swatch.addEventListener('mouseleave', () => hideColorTooltip());

      // Single click to copy color
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        copyColorToClipboard(color, e);
      });

      // Double click to open color picker
      swatch.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        showColorPicker(layerName, color, swatch);
      });

      swatchContainer.appendChild(swatch);
    });

    checkboxContainer.appendChild(swatchContainer);
  }

  // Add expand button for layer details
  const expandBtn = document.createElement('span');
  expandBtn.className = 'layer-expand-btn';
  expandBtn.style.cssText = 'display: inline-flex; align-items: center; justify-content: center; margin-left: 4px; flex-shrink: 0; cursor: pointer; width: 14px; height: 14px; border-radius: 2px;';
  expandBtn.title = 'Expand layer details';
  expandBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" style="opacity: 0.5;">
    <line x1="5" y1="2" x2="5" y2="8" stroke="#666" stroke-width="1.5"/>
    <line x1="2" y1="5" x2="8" y2="5" stroke="#666" stroke-width="1.5"/>
  </svg>`;
  expandBtn.dataset.layerName = layerName;
  expandBtn.dataset.expanded = 'false';

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLayerExpand(layerName, expandBtn, layerItem);
  });

  checkboxContainer.appendChild(expandBtn);

  layerItem.appendChild(checkboxContainer);

  return layerItem;
}

async function toggleLayerExpand(layerName, expandBtn, layerItem) {
  const isExpanded = expandBtn.dataset.expanded === 'true';

  if (isExpanded) {
    // Collapse: remove details panel
    const detailsPanel = layerItem.querySelector('.layer-details-panel');
    if (detailsPanel) {
      detailsPanel.remove();
    }
    // Clear any highlights
    clearPathHighlight();
    expandBtn.dataset.expanded = 'false';
    expandBtn.title = 'Expand to see paths';
    // Change to plus icon
    expandBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="5" y1="2" x2="5" y2="8" stroke="#666" stroke-width="1.5"/>
      <line x1="2" y1="5" x2="8" y2="5" stroke="#666" stroke-width="1.5"/>
    </svg>`;
  } else {
    // Expand: create details panel with path list
    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'layer-details-panel';
    detailsPanel.style.cssText = 'margin-top: 6px; margin-left: 48px; padding: 8px; background: #f8f9ff; border-radius: 4px; border: 1px solid #e0e4ff; font-size: 0.75em; max-height: 200px; overflow-y: auto;';

    // Get paths for this layer from backend
    const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];

    detailsPanel.innerHTML = '<div style="color: #666;">Loading paths...</div>';
    layerItem.appendChild(detailsPanel);

    // Request path details from backend
    try {
      const pathDetails = await window.electronAPI.getLayerPaths(layerName);

      if (!pathDetails) {
        detailsPanel.innerHTML = '<div style="color: #999;">No response from backend</div>';
        expandBtn.dataset.expanded = 'true';
        return;
      }

      if (pathDetails.error) {
        detailsPanel.innerHTML = `<div style="color: #dc3545;">Error: ${pathDetails.error}</div>`;
        expandBtn.dataset.expanded = 'true';
        return;
      }

      if (pathDetails.paths && pathDetails.paths.length > 0) {
        let listHtml = `<div style="margin-bottom: 6px; font-weight: 600; color: #667eea;">${pathDetails.paths.length} paths</div>`;
        listHtml += '<div class="path-list" style="display: flex; flex-direction: column; gap: 2px;">';

        // Show paths (limit to first 100 for performance)
        const displayPaths = pathDetails.paths.slice(0, 100);
        displayPaths.forEach((path, idx) => {
          const opCount = path.operationCount || 0;
          const pathType = path.hasStroke ? 'stroke' : 'fill';
          const bounds = path.bounds;
          const sizeInfo = bounds ? `${Math.round(bounds.width)}x${Math.round(bounds.height)}` : '';

          listHtml += `
            <div class="path-item" data-path-index="${path.index}" data-layer="${layerName}"
                 style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; background: white; border-radius: 3px; border: 1px solid #e0e4ff; cursor: pointer;"
                 onmouseenter="this.style.background='#e8ebff'" onmouseleave="this.style.background='white'">
              <span style="color: #333;">Path ${idx + 1}</span>
              <span style="color: #888; font-size: 0.9em;">${opCount} ops ${sizeInfo ? '• ' + sizeInfo : ''}</span>
            </div>
          `;
        });

        if (pathDetails.paths.length > 100) {
          listHtml += `<div style="color: #999; font-style: italic; padding: 4px;">... and ${pathDetails.paths.length - 100} more</div>`;
        }

        listHtml += '</div>';
        detailsPanel.innerHTML = listHtml;

        // Add click handlers for path highlighting
        detailsPanel.querySelectorAll('.path-item').forEach(item => {
          item.addEventListener('click', () => {
            const pathIndex = parseInt(item.dataset.pathIndex);
            highlightPath(layerName, pathIndex);
            // Visual feedback
            detailsPanel.querySelectorAll('.path-item').forEach(p => p.style.borderColor = '#e0e4ff');
            item.style.borderColor = '#667eea';
          });
        });
      } else {
        const msg = pathDetails.message || 'No paths found for this layer';
        detailsPanel.innerHTML = `<div style="color: #999;">${msg}</div>`;
      }
    } catch (error) {
      console.error('Error loading paths:', error);
      detailsPanel.innerHTML = `<div style="color: #dc3545;">Error: ${error.message || 'Unknown error'}</div>`;
    }

    expandBtn.dataset.expanded = 'true';
    expandBtn.title = 'Collapse path list';
    // Change to minus icon
    expandBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="2" y1="5" x2="8" y2="5" stroke="#666" stroke-width="1.5"/>
    </svg>`;
  }
}

// Highlight a specific path on the map preview
function highlightPath(layerName, pathIndex) {
  // Add highlight overlay to the SVG preview
  const svgContainer = mapPreviewDiv.querySelector('svg');
  if (!svgContainer) return;

  // Remove existing highlights
  clearPathHighlight();

  // Request the path geometry from backend and draw highlight
  window.electronAPI.getPathGeometry(layerName, pathIndex).then(geometry => {
    if (!geometry || !geometry.pathData) return;

    // Create highlight group
    const highlightGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    highlightGroup.id = 'path-highlight';
    highlightGroup.setAttribute('class', 'highlight-overlay');

    // Draw the highlighted path with a bright color and animation
    const highlightPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    highlightPath.setAttribute('d', geometry.pathData);
    highlightPath.setAttribute('fill', 'none');
    highlightPath.setAttribute('stroke', '#ff0066');
    highlightPath.setAttribute('stroke-width', '4');
    highlightPath.setAttribute('stroke-linecap', 'round');
    highlightPath.style.animation = 'pulse-highlight 1s ease-in-out infinite';

    // Add a second path for better visibility (white outline)
    const outlinePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    outlinePath.setAttribute('d', geometry.pathData);
    outlinePath.setAttribute('fill', 'none');
    outlinePath.setAttribute('stroke', 'white');
    outlinePath.setAttribute('stroke-width', '6');
    outlinePath.setAttribute('stroke-linecap', 'round');

    highlightGroup.appendChild(outlinePath);
    highlightGroup.appendChild(highlightPath);
    svgContainer.appendChild(highlightGroup);
  }).catch(err => {
    console.error('Error highlighting path:', err);
  });
}

function clearPathHighlight() {
  const existing = document.getElementById('path-highlight');
  if (existing) existing.remove();
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

  // Count paths per enabled color sublayer
  const layerPathCounts = {};
  if (currentPDFData && currentPDFData.contentPaths) {
    const paths = currentPDFData.contentPaths.paths;
    paths.forEach(path => {
      const baseName = path.layer || 'Unassigned';

      // After conversion by pdf-processor, path has stroke/fill booleans and strokeColor/fillColor RGB arrays
      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
      }

      if (pathColor) {
        const sublayerName = `${baseName}::${pathColor}`;
        if (enabledLayers.has(sublayerName)) {
          layerPathCounts[sublayerName] = (layerPathCounts[sublayerName] || 0) + 1;
        }
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
      // Parse sublayer format for descriptive naming
      const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];
      const displayName = getDescriptiveLayerName(baseName, colorStr);

      const pathCount = layerPathCounts[layerName] || 0;
      const colors = window.layerColorInfo?.[layerName] || [];
      const swatchesHTML = colors.slice(0, 3).map(color =>
        `<span style="display: inline-block; width: 10px; height: 10px; background: ${color}; border: 1px solid #ccc; border-radius: 2px; margin-left: 2px;"></span>`
      ).join('');

      html += `
        <div style="padding: 6px 10px; background: #f5f7ff; border-radius: 4px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.85em; color: #333; font-weight: 500; display: flex; align-items: center; gap: 6px;">
            <span>${displayName}</span>
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
      // Parse sublayer format for descriptive naming
      const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];
      const displayName = getDescriptiveLayerName(baseName, colorStr);

      const pathCount = layerPathCounts[layerName] || 0;
      const colors = window.layerColorInfo?.[layerName] || [];
      const swatchesHTML = colors.slice(0, 3).map(color =>
        `<span style="display: inline-block; width: 10px; height: 10px; background: ${color}; border: 1px solid #ccc; border-radius: 2px; margin-left: 2px;"></span>`
      ).join('');

      html += `
        <div style="padding: 6px 10px; background: #f5f7ff; border-radius: 4px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.85em; color: #333; font-weight: 500; display: flex; align-items: center; gap: 6px;">
            <span>${displayName}</span>
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

// Use Canvas for preview rendering (much faster than SVG for thousands of paths)
const USE_CANVAS_PREVIEW = true;

function generateMapPreview() {
  // Check if we're in lightweight mode (backend processing, no local paths)
  if (currentPDFData && !currentPDFData.contentPaths && currentPDFData.layerInfo) {
    // Use backend SVG generation
    showLightweightPreview();
    updateExportLayersList();
    return;
  }

  if (!currentPDFData || !currentPDFData.contentPaths) {
    mapPreviewDiv.innerHTML = '<div style="color: #999;">No map data available</div>';
    return;
  }

  if (USE_CANVAS_PREVIEW) {
    // Use fast Canvas-based rendering for preview
    renderCanvasPreview();
  } else {
    // Fall back to SVG rendering
    const svg = generateSVG(false); // false = no export, just preview
    mapPreviewDiv.innerHTML = svg;
  }

  // SVG now uses 100% width/height for preview, so no need for zoom calculation
  // Just reset zoom to 1.0 on first load
  if (currentZoom === 1.0 && panX === 0 && panY === 0) {
    currentZoom = 1.0;
  }

  // Apply current zoom level
  updateZoomDisplay();

  // Update stats
  updateMapStats();

  // Update the export layers list
  updateExportLayersList();
}

/**
 * Fast Canvas-based preview renderer using Path2D
 * Much more efficient than SVG for thousands of paths
 */
function renderCanvasPreview() {
  console.time('Render:Total');
  console.time('Render:FilterPaths');

  const paths = currentPDFData.contentPaths.paths;

  // Filter paths by enabled color sublayers
  // Note: Paths without a layer assignment are put in "Unassigned" layer
  const filteredPaths = paths.filter(path => {
    // Use 'Unassigned' for paths without layer (previously filtered out - caused missing geometry)
    const layerName = path.layer || 'Unassigned';

    // After conversion by pdf-processor, path has stroke/fill booleans and strokeColor/fillColor RGB arrays
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    if (!pathColor) return false;

    const sublayerName = `${layerName}::${pathColor}`;
    return enabledLayers.has(sublayerName);
  });

  console.timeEnd('Render:FilterPaths');

  console.time('Render:CalcBounds');

  // Use cached bounds if available - calculate BEFORE checking if filteredPaths is empty
  // This ensures consistent sizing even when no layers are selected
  let minX, minY, maxX, maxY, width, height;

  if (cachedBounds) {
    // Reuse cached bounds for consistent sizing regardless of which layers are toggled
    ({ minX, minY, maxX, maxY, width, height } = cachedBounds);
    console.log(`Using cached bounds: ${width.toFixed(0)} x ${height.toFixed(0)}`);
  } else {
    // For 2023/2024 7.5-minute USGS quads, use PDF page dimensions directly
    // Our diagnostic analysis confirmed all layers share the same coordinate system
    // with bounds roughly matching the page dimensions (1728 x 2088 pts)
    // The coordinate system has X from 0 to width, Y from -height to 0

    const pageInfo = currentPDFData.metadata?.pages?.[0];

    if (pageInfo && pageInfo.width && pageInfo.height) {
      // Use PDF page bounds as canonical bounds
      // PDF coordinate system: origin at bottom-left, Y increases upward
      // But path Y coordinates appear to be negative (top-down), so Y ranges from -height to 0
      width = pageInfo.width;
      height = pageInfo.height;
      minX = 0;
      maxX = width;
      minY = -height;
      maxY = 0;

      console.log(`Using PDF page bounds: ${width} x ${height} pts (${(width/72).toFixed(1)}" x ${(height/72).toFixed(1)}")`);
    } else {
      // Fallback: calculate from all paths (unassigned paths are valid geometry)
      console.log('Falling back to path-based bounds calculation');
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

      paths.forEach(path => {
        // Include all paths - unassigned paths are valid geometry that should be rendered
        if (path.operations) {
          path.operations.forEach(op => {
            if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
            if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
            if (op.x1 !== undefined) { minX = Math.min(minX, op.x1); maxX = Math.max(maxX, op.x1); }
            if (op.y1 !== undefined) { minY = Math.min(minY, op.y1); maxY = Math.max(maxY, op.y1); }
            if (op.x2 !== undefined) { minX = Math.min(minX, op.x2); maxX = Math.max(maxX, op.x2); }
            if (op.y2 !== undefined) { minY = Math.min(minY, op.y2); maxY = Math.max(maxY, op.y2); }
          });
        }
      });

      width = maxX - minX;
      height = maxY - minY;
      console.log(`Calculated bounds: X[${minX.toFixed(0)} to ${maxX.toFixed(0)}] Y[${minY.toFixed(0)} to ${maxY.toFixed(0)}] = ${width.toFixed(0)} x ${height.toFixed(0)}`);
    }

    // Cache bounds for consistency across layer toggles
    cachedBounds = { minX, minY, maxX, maxY, width, height };
  }

  const padding = 20;

  // Get container dimensions
  const containerRect = mapPreviewDiv.getBoundingClientRect();
  const containerWidth = containerRect.width || 800;
  const containerHeight = containerRect.height || 600;

  // Account for device pixel ratio for sharp rendering on high-DPI displays
  const dpr = window.devicePixelRatio || 1;

  // Calculate scale to fit content in container
  const scaleX = containerWidth / (width + padding * 2);
  const scaleY = containerHeight / (height + padding * 2);
  const scale = Math.min(scaleX, scaleY);

  console.log(`Container: ${containerWidth}x${containerHeight}, Scale: ${scale.toFixed(6)}, DPR: ${dpr}`);

  // Create canvas element with proper resolution
  const canvas = document.createElement('canvas');
  canvas.width = containerWidth * dpr;
  canvas.height = containerHeight * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const ctx = canvas.getContext('2d', { alpha: false });

  // Scale for high-DPI
  ctx.scale(dpr, dpr);

  // White background
  ctx.fillStyle = bgColorEnabled ? bgColorValue : '#ffffff';
  ctx.fillRect(0, 0, containerWidth, containerHeight);

  // Calculate center of content
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  console.timeEnd('Render:CalcBounds');

  // Handle empty selection - draw frame lines to show map boundaries
  // This maintains consistent canvas size and shows the map area
  if (filteredPaths.length === 0) {
    // Apply transform to draw frame in map coordinates
    ctx.translate(containerWidth / 2, containerHeight / 2);
    ctx.scale(scale, -scale); // Flip Y for PDF coordinate system
    ctx.translate(-centerX, -centerY);

    // Draw black solid line frame (outer boundary)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([]);
    ctx.strokeRect(minX, minY, width, height);

    // Draw red dotted line frame (inner boundary, slightly inset)
    const inset = 10 / scale;
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([8 / scale, 4 / scale]);
    ctx.strokeRect(minX + inset, minY + inset, width - inset * 2, height - inset * 2);

    mapPreviewDiv.innerHTML = '';
    mapPreviewDiv.appendChild(canvas);
    console.timeEnd('Render:Total');
    return;
  }

  console.log(`Transform: center content at (${centerX.toFixed(0)}, ${centerY.toFixed(0)}), scale=${scale.toFixed(6)}`);

  // Transform: move to container center, scale (flip Y), then offset to content center
  ctx.translate(containerWidth / 2, containerHeight / 2);
  ctx.scale(scale, -scale); // Flip Y for PDF coordinate system (Y increases downward in canvas, upward in PDF)
  ctx.translate(-centerX, -centerY);

  console.time('Render:GroupPaths');
  // Group paths by color for batch rendering (reduces context state changes)
  const pathsByColor = {};
  filteredPaths.forEach(path => {
    // Skip white fills
    if (path.fill && path.fillColor) {
      const [r, g, b] = path.fillColor;
      if (r === 255 && g === 255 && b === 255) return;
    }

    let color;
    if (path.stroke && path.strokeColor) {
      color = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      color = `rgb(${path.fillColor.join(',')})`;
    }

    if (!color) return;

    const key = `${color}|${path.stroke ? 's' : 'f'}|${path.lineWidth || 1}`;
    if (!pathsByColor[key]) {
      pathsByColor[key] = {
        color,
        isStroke: path.stroke,
        lineWidth: path.lineWidth || 1,
        paths: []
      };
    }
    pathsByColor[key].paths.push(path);
  });
  console.timeEnd('Render:GroupPaths');

  console.time('Render:DrawPaths');
  // Render paths grouped by color (batch rendering)
  const startTime = performance.now();

  Object.values(pathsByColor).forEach(group => {
    ctx.beginPath();

    group.paths.forEach(path => {
      if (!path.operations) return;

      path.operations.forEach(op => {
        switch (op.type) {
          case 'moveto':
            ctx.moveTo(op.x, op.y);
            break;
          case 'lineto':
            ctx.lineTo(op.x, op.y);
            break;
          case 'curveto':
            ctx.bezierCurveTo(op.x1, op.y1, op.x2, op.y2, op.x3, op.y3);
            break;
          case 'closepath':
            ctx.closePath();
            break;
          case 'rect':
            ctx.rect(op.x, op.y, op.width, op.height);
            break;
        }
      });
    });

    if (group.isStroke) {
      ctx.strokeStyle = group.color;
      ctx.lineWidth = group.lineWidth / scale; // Adjust for scale
      ctx.stroke();
    } else {
      ctx.fillStyle = group.color;
      ctx.fill();
    }
  });

  console.timeEnd('Render:DrawPaths');

  const renderTime = performance.now() - startTime;
  console.log(`Canvas render: ${filteredPaths.length} paths in ${renderTime.toFixed(1)}ms`);

  // Replace preview content
  mapPreviewDiv.innerHTML = '';
  mapPreviewDiv.appendChild(canvas);

  console.timeEnd('Render:Total');
}

function updateMapStats(statusMessage = null) {
  if (!currentPDFData || !currentPDFData.contentPaths) return;

  const paths = currentPDFData.contentPaths.paths;
  const enabledPaths = paths.filter(p => !p.layer || enabledLayers.has(p.layer));

  let statsHTML = '';

  // Show status message if provided (for processing updates)
  if (statusMessage) {
    statsHTML += `
      <div style="font-weight: 600; color: #667eea; margin-bottom: 8px;">
        ${statusMessage}
      </div>
    `;
  }

  // Show last saved file path if available
  if (lastSavedFilePath) {
    statsHTML += `
      <div style="margin-bottom: 8px; padding: 8px; background: #d4edda; border-radius: 4px; border: 1px solid #c3e6cb;">
        <div style="font-weight: 600; color: #155724; font-size: 0.85em;">Saved:</div>
        <div style="color: #155724; font-size: 0.75em; word-break: break-all;">${lastSavedFilePath}</div>
      </div>
    `;
  }

  statsHTML += `
    <div>Total paths: ${paths.length}</div>
    <div>Visible paths: ${enabledPaths.length}</div>
    <div>Layers: ${enabledLayers.size} of ${allLayers.length} enabled</div>
  `;

  // Add crop info if crop mode is enabled
  if (cropModeEnabled && cropRectangle) {
    const rectWidth = parseFloat(cropRectangle.getAttribute('width'));
    const rectHeight = parseFloat(cropRectangle.getAttribute('height'));

    // Convert to mm for display
    const PT_TO_MM = 0.352778;
    const widthMM = (rectWidth * PT_TO_MM).toFixed(1);
    const heightMM = (rectHeight * PT_TO_MM).toFixed(1);

    // Get position
    const svgElement = mapPreviewDiv.querySelector('svg');
    if (svgElement) {
      const viewBox = svgElement.getAttribute('viewBox');
      if (viewBox) {
        const [vbMinX, vbMinY] = viewBox.split(' ').map(parseFloat);
        const xMM = ((cropX - vbMinX) * PT_TO_MM).toFixed(1);
        const yMM = ((cropY - vbMinY) * PT_TO_MM).toFixed(1);

        statsHTML += `
          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd;">
            <div style="font-weight: 600; color: #dc3545;">Crop Active</div>
            <div>Position: ${xMM}mm × ${yMM}mm</div>
            <div>Size: ${widthMM}mm × ${heightMM}mm</div>
          </div>
        `;
      }
    }
  }

  mapStatsDiv.innerHTML = statsHTML;
}

async function handleExportSVG() {
  // If crop was applied, open the file in Finder
  if (cropApplied && lastSavedFilePath) {
    try {
      await window.electronAPI.showInFinder(lastSavedFilePath);
      updateMapStats('Opening file in Finder...');
    } catch (error) {
      console.error('Error opening file in Finder:', error);
      updateMapStats(`Error: Could not open file - ${error.message}`);
    }
    return;
  }

  // No crop applied - generate and save SVG directly
  if (enabledLayers.size === 0) {
    updateMapStats('Error: No layers selected for export');
    return;
  }

  showLoadingGear();
  updateMapStats('Generating SVG...');

  try {
    // Generate SVG from selected layers
    const svgResult = await window.electronAPI.generateSVG({
      enabledLayers: Array.from(enabledLayers),
      bounds: cachedBounds,
      options: { whiteBackground: whiteBackgroundCheck?.checked || false }
    });

    if (!svgResult.success) {
      updateMapStats(`Error: ${svgResult.error}`);
      hideLoadingGear();
      return;
    }

    // Prompt user for save location
    const defaultName = currentFilePath
      ? currentFilePath.split('/').pop().replace('.pdf', '_export.svg')
      : 'map_export.svg';

    const savePath = await window.electronAPI.showSaveDialog({
      title: 'Save SVG',
      defaultPath: defaultName,
      filters: [{ name: 'SVG Files', extensions: ['svg'] }]
    });

    if (!savePath) {
      updateMapStats('Export cancelled');
      hideLoadingGear();
      return;
    }

    // Write the file
    const writeResult = await window.electronAPI.writeFile({
      filePath: savePath,
      content: svgResult.svg
    });

    if (writeResult.success) {
      lastSavedFilePath = savePath;
      updateMapStats(`Exported ${svgResult.stats.pathCount.toLocaleString()} paths to SVG`);

      // Offer to show in Finder
      await window.electronAPI.showInFinder(savePath);
    } else {
      updateMapStats(`Error: Failed to save - ${writeResult.error}`);
    }
  } catch (error) {
    console.error('Export error:', error);
    updateMapStats(`Error: ${error.message}`);
  } finally {
    hideLoadingGear();
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
  // Note: Paths without layer are assigned to 'Unassigned' (prevents missing geometry)
  let filteredPaths = paths.filter(path => {
    const layerName = path.layer || 'Unassigned';

    // After conversion by pdf-processor, path has stroke/fill booleans and strokeColor/fillColor RGB arrays
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    if (!pathColor) return false;

    // Check if the color sublayer is enabled
    const sublayerName = `${layerName}::${pathColor}`;
    return enabledLayers.has(sublayerName);
  });

  if (filteredPaths.length === 0) {
    // Return SVG with frame lines to show map boundaries
    if (cachedBounds) {
      const { minX, minY, width, height } = cachedBounds;
      const padding = 10;
      const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;
      const inset = 10;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="${viewBox}">
        <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="none" stroke="#000000" stroke-width="2"/>
        <rect x="${minX + inset}" y="${minY + inset}" width="${width - inset * 2}" height="${height - inset * 2}" fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="8,4"/>
      </svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
      <rect x="5" y="5" width="390" height="290" fill="none" stroke="#000000" stroke-width="2"/>
      <rect x="15" y="15" width="370" height="270" fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="8,4"/>
    </svg>`;
  }

  // Performance optimization: Limit paths in preview mode for large files
  // Export mode always uses all paths for full fidelity
  const PREVIEW_PATH_LIMIT = 15000;
  let previewLimited = false;

  if (!isExport && filteredPaths.length > PREVIEW_PATH_LIMIT) {
    // Sample paths evenly to maintain visual representation
    const step = filteredPaths.length / PREVIEW_PATH_LIMIT;
    const sampledPaths = [];
    for (let i = 0; i < filteredPaths.length; i += step) {
      sampledPaths.push(filteredPaths[Math.floor(i)]);
    }
    filteredPaths = sampledPaths;
    previewLimited = true;
    console.log(`Preview limited to ${filteredPaths.length} paths (${PREVIEW_PATH_LIMIT} max) for performance`);
  }

  // Calculate bounding box - use cached bounds if available for preview mode
  // IMPORTANT: Always calculate bounds from ALL filtered paths (before sampling)
  // to ensure viewBox is correct even when preview is limited
  let minX, minY, maxX, maxY, width, height;

  // Get all enabled paths for bounds calculation (before any sampling)
  const allFilteredPaths = paths.filter(path => {
    // Use 'Unassigned' for paths without layer (matches extractLayersFromData)
    const layerName = path.layer || 'Unassigned';
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }
    if (!pathColor) return false;
    const sublayerName = `${layerName}::${pathColor}`;
    return enabledLayers.has(sublayerName);
  });

  if (cachedBounds) {
    // Use cached bounds for consistent sizing (calculated from ALL paths on first load)
    ({ minX, minY, maxX, maxY, width, height } = cachedBounds);
  } else if (isExport) {
    // For export, calculate bounds from enabled paths only (user may want to export subset)
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;

    allFilteredPaths.forEach(path => {
      if (path.operations) {
        path.operations.forEach(op => {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
          if (op.x1 !== undefined) { minX = Math.min(minX, op.x1); maxX = Math.max(maxX, op.x1); }
          if (op.y1 !== undefined) { minY = Math.min(minY, op.y1); maxY = Math.max(maxY, op.y1); }
          if (op.x2 !== undefined) { minX = Math.min(minX, op.x2); maxX = Math.max(maxX, op.x2); }
          if (op.y2 !== undefined) { minY = Math.min(minY, op.y2); maxY = Math.max(maxY, op.y2); }
          if (op.x3 !== undefined) { minX = Math.min(minX, op.x3); maxX = Math.max(maxX, op.x3); }
          if (op.y3 !== undefined) { minY = Math.min(minY, op.y3); maxY = Math.max(maxY, op.y3); }
        });
      }
    });

    width = maxX - minX;
    height = maxY - minY;
  } else {
    // First load preview: bounds should already be cached by renderCanvasPreview
    // Fallback calculation from all paths if somehow not cached
    console.warn('SVG generateSVG: cachedBounds not set, calculating from all paths');
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;

    paths.forEach(path => {
      if (path.operations) {
        path.operations.forEach(op => {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        });
      }
    });

    width = maxX - minX;
    height = maxY - minY;
    cachedBounds = { minX, minY, maxX, maxY, width, height };
  }

  const padding = 10;

  // Generate SVG header
  const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

  // For preview mode, use 100% width/height so it fits the container
  // For export mode, use original dimensions
  let widthAttr;
  if (isExport) {
    // Use original dimensions for export
    const dimensions = getPaperDimensions('original', width, height);
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

  // Add temporary background color layer if enabled (preview only, bottom-most layer)
  if (!isExport && bgColorEnabled) {
    svg += `  <rect id="temp-background" x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${bgColorValue}"/>\n`;
  }

  // Add title
  svg += `  <title>GeoPDF Export - ${enabledLayers.size} layers</title>\n`;

  // Add preview mode indicator if limited
  if (previewLimited) {
    svg += `  <!-- Preview mode: showing ${filteredPaths.length} of ${allFilteredPaths.length} paths for performance -->\n`;
  }

  // Group paths by color sublayer
  const pathsByLayer = {};
  filteredPaths.forEach(path => {
    // Use 'Unassigned' for paths without layer (matches extractLayersFromData)
    const layerName = path.layer || 'Unassigned';

    // Determine the color for this path
    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    const sublayerName = `${layerName}::${pathColor}`;
    if (!pathsByLayer[sublayerName]) {
      pathsByLayer[sublayerName] = [];
    }
    pathsByLayer[sublayerName].push(path);
  });

  // Generate path elements grouped by color sublayer with proper z-ordering
  // Strategy: Render vector layers first (bottom), then overlay layers (top)
  // Within each group, render in reverse order so UI list order matches visual stacking

  const vectorLayersToRender = [];
  const overlayLayersToRender = [];

  // Separate layers into vector and overlay groups
  allLayers.slice().reverse().forEach(layer => {
    if (pathsByLayer[layer]) {
      if (isOverlayLayer(layer)) {
        overlayLayersToRender.push(layer);
      } else {
        vectorLayersToRender.push(layer);
      }
    }
  });

  // Add any layers not in allLayers (shouldn't happen, but failsafe)
  Object.keys(pathsByLayer).forEach(layerName => {
    if (!vectorLayersToRender.includes(layerName) && !overlayLayersToRender.includes(layerName)) {
      if (isOverlayLayer(layerName)) {
        overlayLayersToRender.push(layerName);
      } else {
        vectorLayersToRender.push(layerName);
      }
    }
  });

  // Combine: vector layers first (bottom), then overlay layers (top)
  const layersToRender = [...vectorLayersToRender, ...overlayLayersToRender];

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

  svg += '</svg>';
  return svg;
}

async function displayMetadata(metadata, info, data) {
  metadataDiv.innerHTML = '';

  // Create section headers and organize by category
  const createSection = (title, collapsible = false) => {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom: 16px;';

    const heading = document.createElement('h4');
    heading.textContent = title;
    heading.style.cssText = 'font-size: 0.9em; font-weight: 600; color: #667eea; margin: 0 0 8px 0; padding-bottom: 4px; border-bottom: 2px solid #e0e4ff;';
    section.appendChild(heading);

    return section;
  };

  const createItem = (label, value, mono = false) => {
    const div = document.createElement('div');
    div.className = 'metadata-item';
    const style = mono ? 'font-family: monospace; font-size: 0.85em;' : '';
    div.innerHTML = `<strong>${label}:</strong> <span style="${style}">${value}</span>`;
    return div;
  };

  const createCodeBlock = (content) => {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background: #f5f5f5; padding: 8px; border-radius: 4px; font-size: 0.75em; overflow-x: auto; margin: 4px 0;';
    pre.textContent = content;
    return pre;
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

  // === MAP CLASSIFICATION (USGS Format) ===
  if (metadata.usgsFormat) {
    const mapSection = createSection('Map Classification');
    const fmt = metadata.usgsFormat;

    // Scale (e.g., "1:100,000" or "100K")
    const scaleLabels = {
      '250k': '1:250,000 (250K)',
      '100k': '1:100,000 (100K)',
      '24k': '1:24,000 (7.5-minute quad)',
      'unknown': 'Unknown'
    };
    mapSection.appendChild(createItem('Scale', scaleLabels[fmt.scale] || fmt.scale));

    // Year
    if (fmt.year) {
      mapSection.appendChild(createItem('Year', fmt.year.toString()));
    }

    // Generation/Format type
    if (fmt.generation && fmt.generation !== 'unknown') {
      const genLabel = fmt.isTopobuilder ? `${fmt.generation} (Topobuilder)` : fmt.generation;
      mapSection.appendChild(createItem('Format', genLabel));
    }

    // Confidence
    const confidenceLabels = { high: 'High', medium: 'Medium', low: 'Low' };
    mapSection.appendChild(createItem('Detection', confidenceLabels[fmt.confidence] || fmt.confidence));

    metadataDiv.appendChild(mapSection);
  }

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

  // === COORDINATE SYSTEM (from debug info) ===
  try {
    const debugResult = await window.electronAPI.getDebugInfo();
    if (debugResult.success && debugResult.debugInfo) {
      const debug = debugResult.debugInfo;

      // Coordinate System section
      const coordSection = createSection('Coordinate System');
      const ob = debug.overallBounds;

      coordSection.appendChild(createItem('Total Paths', debug.totalPaths.toLocaleString()));
      coordSection.appendChild(createItem('Layers', `${debug.layerCount} (${debug.baseLayerCount} base)`));

      // ViewBox info as a code block
      const viewBoxInfo = `ViewBox: X[${ob.minX} → ${ob.maxX}] Y[${ob.minY} → ${ob.maxY}]\nSize: ${ob.width} × ${ob.height}`;
      coordSection.appendChild(createCodeBlock(viewBoxInfo));

      if (debug.pageDimensions) {
        const pd = debug.pageDimensions;
        const boundsW = parseFloat(ob.width);
        const boundsH = parseFloat(ob.height);
        const scaleX = (boundsW / pd.widthPt).toFixed(2);
        const scaleY = (boundsH / pd.heightPt).toFixed(2);
        coordSection.appendChild(createItem('Bounds/Page Ratio', `X: ${scaleX}x, Y: ${scaleY}x`, true));
      }

      if (debug.neatline) {
        const nl = debug.neatline;
        const neatlineInfo = `L:${nl.left?.toFixed(0)} R:${nl.right?.toFixed(0)} T:${nl.top?.toFixed(0)} B:${nl.bottom?.toFixed(0)}`;
        coordSection.appendChild(createItem('Neatline', neatlineInfo, true));
      }

      metadataDiv.appendChild(coordSection);

      // Base Layers (OCG Groups) section
      if (debug.layersByBase && debug.layersByBase.length > 0) {
        const baseLayerSection = createSection('Base Layers (OCG)');

        const baseLayersDiv = document.createElement('div');
        baseLayersDiv.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;';

        debug.layersByBase.forEach(layer => {
          const layerChip = document.createElement('div');
          layerChip.style.cssText = 'padding: 4px 8px; background: #f8f9ff; border-left: 3px solid #667eea; font-size: 0.8em;';
          layerChip.innerHTML = `<strong>${layer.name}</strong><br><span style="color: #666; font-size: 0.9em;">${layer.sublayerCount} colors, ${layer.totalPaths.toLocaleString()} paths</span>`;
          baseLayersDiv.appendChild(layerChip);
        });

        baseLayerSection.appendChild(baseLayersDiv);
        metadataDiv.appendChild(baseLayerSection);
      }
    }
  } catch (err) {
    console.warn('Could not load debug info for sidebar:', err);
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

  // Vector debug info is now shown in the separate vectorDebugPanel
}

// Populate Vector Debug Panel (right side when Metadata tab active)
async function populateVectorDebugPanel() {
  const content = document.getElementById('vectorDebugContent');
  if (!content) return;

  if (!currentPDFData) {
    content.innerHTML = '<div style="color: #999; font-style: italic;">Load a PDF to see vector debug information</div>';
    return;
  }

  content.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="spinner"></div><div>Loading debug info...</div></div>';

  try {
    const debugResult = await window.electronAPI.getDebugInfo();
    if (!debugResult.success || !debugResult.debugInfo) {
      content.innerHTML = '<div style="color: #dc3545;">Failed to load debug info</div>';
      return;
    }

    const debug = debugResult.debugInfo;
    let html = '';

    // === DETAILED LAYER TABLE ===
    html += '<div>';
    html += '<h4 style="font-size: 0.95em; color: #667eea; border-bottom: 2px solid #e0e4ff; padding-bottom: 4px; margin-bottom: 8px;">Layer Details (by path count)</h4>';

    html += '<div style="max-height: 400px; overflow-y: auto; font-size: 0.75em; font-family: monospace;">';
    html += '<div style="display: grid; grid-template-columns: 2fr 60px 100px 100px 120px; gap: 4px; padding: 6px; background: #667eea; color: white; font-weight: bold; position: sticky; top: 0;">';
    html += '<div>Layer</div><div>Paths</div><div>Top-Left</div><div>Bottom-Right</div><div>Size</div>';
    html += '</div>';

    debug.layers.forEach((layer, idx) => {
      const bgColor = idx % 2 === 0 ? '#fff' : '#f9f9f9';
      const colorMatch = layer.color.match(/rgb\((\d+),(\d+),(\d+)\)/);
      let colorSwatch = '';
      if (colorMatch) {
        colorSwatch = `<span style="display: inline-block; width: 12px; height: 12px; background: ${layer.color}; border: 1px solid #999; margin-right: 4px; vertical-align: middle;"></span>`;
      }

      // Top-left is (minX, minY), Bottom-right is (maxX, maxY)
      const topLeft = `${layer.bounds.minX}, ${layer.bounds.minY}`;
      const bottomRight = `${layer.bounds.maxX}, ${layer.bounds.maxY}`;

      html += `<div style="display: grid; grid-template-columns: 2fr 60px 100px 100px 120px; gap: 4px; padding: 6px; background: ${bgColor}; border-bottom: 1px solid #eee;">
        <div style="overflow: hidden; text-overflow: ellipsis;" title="${layer.name}">${colorSwatch}${layer.baseLayer}</div>
        <div>${layer.pathCount.toLocaleString()}</div>
        <div title="Top-Left (minX, minY)">${topLeft}</div>
        <div title="Bottom-Right (maxX, maxY)">${bottomRight}</div>
        <div>${layer.bounds.width} × ${layer.bounds.height}</div>
      </div>`;
    });

    html += '</div></div>';

    content.innerHTML = html;
  } catch (err) {
    console.error('Error populating vector debug panel:', err);
    content.innerHTML = `<div style="color: #dc3545;">Error: ${err.message}</div>`;
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

  // Apply zoom and pan to either SVG or Canvas
  const svg = mapPreviewDiv.querySelector('svg');
  const canvas = mapPreviewDiv.querySelector('canvas');
  const element = svg || canvas;

  if (element) {
    // Use center as transform origin for intuitive zooming
    element.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
    element.style.transformOrigin = 'center center';
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

// ============================================================================
// CROP MODE FUNCTIONS
// ============================================================================

function toggleCropMode() {
  cropModeEnabled = !cropModeEnabled;

  if (cropModeEnabled) {
    // Enable crop mode
    cropModeLabel.textContent = 'Disable Crop';
    cropModeBtn.style.background = '#dc3545';
    cropControls.style.display = 'block';

    // Create crop rectangle overlay
    createCropRectangle();

    // Disable panning while in crop mode
    mapPreviewDiv.removeEventListener('mousedown', startPan);

    // Update map stats to show crop info
    updateMapStats();
  } else {
    // Disable crop mode
    cropModeLabel.textContent = 'Crop';
    cropModeBtn.style.background = '';
    cropControls.style.display = 'none';

    // Remove crop rectangle overlay
    removeCropRectangle();

    // Re-enable panning
    mapPreviewDiv.addEventListener('mousedown', startPan);

    // Update map stats to hide crop info
    updateMapStats();
  }
}

function createCropRectangle() {
  // Find the SVG element in the map preview
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  // Get viewBox to work in SVG coordinate space
  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // Use the cached bounds to get the actual content dimensions
  // The crop mask uses the same coordinate system, so we can reference it
  const pageBoxes = currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;
  const mediaBoxData = pageBoxes?.mediaBox;

  // If we have crop box data, use those dimensions as reference for sizing
  let referenceWidth, referenceHeight;
  if (cropBoxData) {
    referenceWidth = cropBoxData.width;
    referenceHeight = cropBoxData.height;
  } else {
    // Fallback to viewBox dimensions
    referenceWidth = vbWidth;
    referenceHeight = vbHeight;
  }

  // Calculate crop rectangle size based on the reference dimensions
  // Assume the reference is approximately 1000mm (standard map size)
  const mmToSVGRatio = referenceWidth / 1000;
  const rectWidth = cropWidth * mmToSVGRatio * cropScale;
  const rectHeight = cropHeight * mmToSVGRatio * cropScale;

  // Center the crop rectangle in the viewBox
  cropX = vbMinX + (vbWidth - rectWidth) / 2;
  cropY = vbMinY + (vbHeight - rectHeight) / 2;

  // Create SVG group for crop overlay
  const cropGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  cropGroup.id = 'crop-overlay';
  cropGroup.style.pointerEvents = 'all'; // Ensure it receives mouse events

  // Create the crop rectangle
  cropRectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  cropRectangle.setAttribute('id', 'crop-rectangle');
  cropRectangle.setAttribute('x', cropX);
  cropRectangle.setAttribute('y', cropY);
  cropRectangle.setAttribute('width', rectWidth);
  cropRectangle.setAttribute('height', rectHeight);
  cropRectangle.setAttribute('fill', 'rgba(255, 0, 0, 0.05)'); // Very light red fill for better visibility
  cropRectangle.setAttribute('stroke', '#ff0000');
  cropRectangle.setAttribute('stroke-width', '3');
  cropRectangle.setAttribute('stroke-dasharray', '10,5');
  cropRectangle.style.cursor = 'move';
  cropRectangle.style.pointerEvents = 'all';

  // Add corner handles
  const handleSize = 12;
  const corners = [
    { x: 0, y: 0, cursor: 'nw-resize' },
    { x: 1, y: 0, cursor: 'ne-resize' },
    { x: 0, y: 1, cursor: 'sw-resize' },
    { x: 1, y: 1, cursor: 'se-resize' }
  ];

  corners.forEach((corner, index) => {
    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    handle.setAttribute('width', handleSize);
    handle.setAttribute('height', handleSize);
    handle.setAttribute('fill', '#ff0000');
    handle.setAttribute('stroke', '#ffffff');
    handle.setAttribute('stroke-width', '2');
    handle.style.cursor = corner.cursor;
    handle.style.pointerEvents = 'all';
    handle.dataset.corner = index;
    cropGroup.appendChild(handle);
  });

  cropGroup.appendChild(cropRectangle);

  // Append to SVG (will be last element, on top)
  svgElement.appendChild(cropGroup);

  // Add drag event listeners
  cropRectangle.addEventListener('mousedown', startCropDrag);

  // Update displays
  updatePositionDisplay();
  updateActualSizeDisplay();
}

function removeCropRectangle() {
  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const cropGroup = svgElement.querySelector('#crop-overlay');
  if (cropGroup) {
    cropGroup.remove();
  }
  cropRectangle = null;
}

function startCropDrag(e) {
  e.preventDefault();
  e.stopPropagation();

  isDraggingCrop = true;

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  // Get viewBox for coordinate space
  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // Get SVG bounding box on screen
  const svgRect = svgElement.getBoundingClientRect();

  // Convert mouse position to SVG viewBox coordinates
  const mouseX = e.clientX - svgRect.left;
  const mouseY = e.clientY - svgRect.top;

  // Scale from screen pixels to viewBox coordinates
  const scaleX = vbWidth / svgRect.width;
  const scaleY = vbHeight / svgRect.height;

  const mouseSVGX = vbMinX + (mouseX * scaleX);
  const mouseSVGY = vbMinY + (mouseY * scaleY);

  // Store the offset from the mouse to the rectangle's top-left corner
  cropDragStartX = mouseSVGX - cropX;
  cropDragStartY = mouseSVGY - cropY;

  // Add document-level event listeners
  document.addEventListener('mousemove', handleCropDrag);
  document.addEventListener('mouseup', endCropDrag);
}

function handleCropDrag(e) {
  if (!isDraggingCrop) return;

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement || !cropRectangle) return;

  // Get viewBox for coordinate space
  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // Get SVG bounding box on screen
  const svgRect = svgElement.getBoundingClientRect();

  // Convert mouse position to SVG viewBox coordinates
  const mouseX = e.clientX - svgRect.left;
  const mouseY = e.clientY - svgRect.top;

  // Scale from screen pixels to viewBox coordinates
  const scaleX = vbWidth / svgRect.width;
  const scaleY = vbHeight / svgRect.height;

  const mouseSVGX = vbMinX + (mouseX * scaleX);
  const mouseSVGY = vbMinY + (mouseY * scaleY);

  // Calculate new position
  cropX = mouseSVGX - cropDragStartX;
  cropY = mouseSVGY - cropDragStartY;

  // Constrain to viewBox bounds
  const rectWidth = parseFloat(cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(cropRectangle.getAttribute('height'));
  cropX = Math.max(vbMinX, Math.min(cropX, vbMinX + vbWidth - rectWidth));
  cropY = Math.max(vbMinY, Math.min(cropY, vbMinY + vbHeight - rectHeight));

  // Update rectangle position
  cropRectangle.setAttribute('x', cropX);
  cropRectangle.setAttribute('y', cropY);

  // Update corner handles
  updateCornerHandles();

  // Update position display
  updatePositionDisplay();

  // Update map stats with new crop info
  updateMapStats();
}

function endCropDrag() {
  isDraggingCrop = false;
  document.removeEventListener('mousemove', handleCropDrag);
  document.removeEventListener('mouseup', endCropDrag);
}

function updateCornerHandles() {
  const cropGroup = mapPreviewDiv.querySelector('#crop-overlay');
  if (!cropGroup || !cropRectangle) return;

  const handles = cropGroup.querySelectorAll('rect:not(#crop-rectangle)');
  const rectWidth = parseFloat(cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(cropRectangle.getAttribute('height'));
  const handleSize = 12;

  const positions = [
    { x: cropX - handleSize/2, y: cropY - handleSize/2 },
    { x: cropX + rectWidth - handleSize/2, y: cropY - handleSize/2 },
    { x: cropX - handleSize/2, y: cropY + rectHeight - handleSize/2 },
    { x: cropX + rectWidth - handleSize/2, y: cropY + rectHeight - handleSize/2 }
  ];

  handles.forEach((handle, index) => {
    if (positions[index]) {
      handle.setAttribute('x', positions[index].x);
      handle.setAttribute('y', positions[index].y);
    }
  });
}

function updatePositionDisplay() {
  if (!cropRectangle) {
    cropPositionDisplay.textContent = 'Drag rectangle to position';
    return;
  }

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // Get reference dimensions for mm conversion
  const pageBoxes = currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;

  let referenceWidth;
  if (cropBoxData) {
    referenceWidth = cropBoxData.width;
  } else {
    referenceWidth = vbWidth;
  }

  // Calculate mm to SVG ratio
  const mmToSVGRatio = referenceWidth / 1000;

  // Convert crop position from viewBox coordinates to mm
  const xMM = Math.round((cropX - vbMinX) / mmToSVGRatio);
  const yMM = Math.round((cropY - vbMinY) / mmToSVGRatio);

  cropPositionDisplay.textContent = `X: ${xMM}mm, Y: ${yMM}mm`;
}

function updateActualSizeDisplay() {
  const actualWidth = Math.round(cropWidth * cropScale);
  const actualHeight = Math.round(cropHeight * cropScale);
  cropActualSize.textContent = `${actualWidth} × ${actualHeight} mm`;
}

function updateCropDimensions() {
  cropWidth = parseFloat(cropWidthInput.value) || 300;
  cropHeight = parseFloat(cropHeightInput.value) || 400;

  if (!cropRectangle) return;

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) return;

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // Get reference dimensions
  const pageBoxes = currentPDFData?.metadata?.pageBoxes;
  const cropBoxData = pageBoxes?.cropBox || pageBoxes?.trimBox;

  let referenceWidth;
  if (cropBoxData) {
    referenceWidth = cropBoxData.width;
  } else {
    referenceWidth = vbWidth;
  }

  // Calculate new size in SVG coordinate space
  const mmToSVGRatio = referenceWidth / 1000;
  const rectWidth = cropWidth * mmToSVGRatio * cropScale;
  const rectHeight = cropHeight * mmToSVGRatio * cropScale;

  // Update rectangle size
  cropRectangle.setAttribute('width', rectWidth);
  cropRectangle.setAttribute('height', rectHeight);

  // Update corner handles
  updateCornerHandles();

  // Update displays
  updatePositionDisplay();
  updateActualSizeDisplay();

  // Update map stats with new crop info
  updateMapStats();
}

function updateCropScale() {
  const scalePercent = parseFloat(cropScaleSlider.value);
  cropScale = scalePercent / 100;
  cropScaleValue.textContent = scalePercent;

  // Update crop dimensions with new scale
  updateCropDimensions();
}

async function applyCrop() {
  if (!cropRectangle) {
    updateMapStats('Error: Please enable crop mode first');
    return;
  }

  const svgElement = mapPreviewDiv.querySelector('svg');
  if (!svgElement) {
    updateMapStats('Error: No map preview available');
    return;
  }

  const viewBox = svgElement.getAttribute('viewBox');
  if (!viewBox) return;

  const [vbMinX, vbMinY, vbWidth, vbHeight] = viewBox.split(' ').map(parseFloat);

  // The SVG uses PDF points as the coordinate system
  // We need to pass the crop rectangle coordinates directly in points
  // The crop rectangle (cropX, cropY, width, height) is already in SVG coordinate space (points)

  const rectWidth = parseFloat(cropRectangle.getAttribute('width'));
  const rectHeight = parseFloat(cropRectangle.getAttribute('height'));

  // Convert points to mm for vpype (1 point = 1/72 inch = 0.352778 mm)
  const PT_TO_MM = 0.352778;
  const xMM = (cropX - vbMinX) * PT_TO_MM;
  const yMM = (cropY - vbMinY) * PT_TO_MM;
  const widthMM = rectWidth * PT_TO_MM;
  const heightMM = rectHeight * PT_TO_MM;

  console.log('Crop parameters (SVG points):', {
    cropX,
    cropY,
    rectWidth,
    rectHeight,
    viewBox: { vbMinX, vbMinY, vbWidth, vbHeight }
  });

  console.log('Crop parameters (mm for vpype):', {
    x: xMM.toFixed(2),
    y: yMM.toFixed(2),
    width: widthMM.toFixed(2),
    height: heightMM.toFixed(2)
  });

  // Check if vpype is installed
  updateMapStats('Checking for vpype...');

  const vpypeCheck = await window.electronAPI.checkVpype();
  if (!vpypeCheck.installed) {
    updateMapStats('Error: vpype is not installed. Please install vpype to use crop functionality.');
    console.error('vpype not found:', vpypeCheck.error);
    return;
  }

  console.log('vpype version:', vpypeCheck.version);

  // Generate SVG with current layers (use backend if available)
  updateMapStats('Generating SVG...');

  console.log('Enabled layers before SVG generation:', Array.from(enabledLayers));

  let svgContent;

  // Try backend SVG generation first (lightweight mode)
  if (window.electronAPI && window.electronAPI.generateSVG) {
    try {
      const svgResult = await window.electronAPI.generateSVG({
        enabledLayers: Array.from(enabledLayers),
        bounds: cachedBounds,
        options: { whiteBackground: whiteBackgroundCheck?.checked || false }
      });

      if (svgResult.success) {
        svgContent = svgResult.svg;
        console.log('Generated SVG via backend:', svgResult.stats);
      } else {
        console.error('Backend SVG generation failed:', svgResult.error);
        // Fall back to local generation if we have path data
        if (currentPDFData?.contentPaths?.paths) {
          svgContent = generateSVG(true);
        }
      }
    } catch (err) {
      console.error('Backend SVG error:', err);
      // Fall back to local generation
      if (currentPDFData?.contentPaths?.paths) {
        svgContent = generateSVG(true);
      }
    }
  } else if (currentPDFData?.contentPaths?.paths) {
    // Legacy: local SVG generation
    svgContent = generateSVG(true);
  }

  if (!svgContent) {
    updateMapStats('Error: Failed to generate SVG');
    return;
  }

  console.log('Generated SVG length:', svgContent.length);

  // Run vpype crop
  updateMapStats('Running vpype crop...');

  try {
    const result = await window.electronAPI.cropWithVpype({
      svgContent,
      cropX: xMM,
      cropY: yMM,
      cropWidth: widthMM,
      cropHeight: heightMM,
      paperSize: 'original'
    });

    if (!result.success) {
      updateMapStats(`Error: vpype failed - ${result.error}`);
      console.error('vpype stderr:', result.stderr);
      return;
    }

    console.log('vpype processed layers:', result.layersProcessed);

    // Generate filename from current PDF name and timestamp
    const fileName = currentFilePath ? currentFilePath.split('/').pop().replace('.pdf', '') : 'map';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const croppedFileName = `cropped-${fileName}-${timestamp}.svg`;

    updateMapStats('Saving file...');

    // Request gellyscape directory path from main process
    const gellyScapePath = await window.electronAPI.getGellyScapePath();
    const fullPath = `${gellyScapePath}/${croppedFileName}`;

    // Save the file directly
    const writeResult = await window.electronAPI.saveFile({
      filePath: fullPath,
      content: result.svg
    });

    if (writeResult.success) {
      const layerInfo = result.layersProcessed ? ` (${result.layersProcessed} layers)` : '';

      // Store the file path
      lastSavedFilePath = fullPath;
      cropApplied = true;

      // Enable the download button
      exportSvgBtn.disabled = false;

      // Update the status bar with success message
      updateMapStats(`Crop complete! Saved ${layerInfo}`);

      console.log('Crop saved to:', fullPath);
    } else {
      updateMapStats(`Error: Failed to save - ${writeResult.error}`);
    }
  } catch (error) {
    updateMapStats(`Error: ${error.message}`);
    console.error('Crop error:', error);
  }
}


// ============================================
// Text Extraction Functions
// ============================================

async function handleExtractText() {
  if (!currentFilePath) {
    console.log("No PDF loaded");
    return;
  }

  showLoadingGear();
  
  if (extractTextBtn) {
    extractTextBtn.disabled = true;
    extractTextBtn.textContent = "Extracting...";
  }

  try {
    // Call backend to extract text
    const result = await window.electronAPI.extractText(currentFilePath);

    if (result.success) {
      extractedTextData = result.data;
      displayExtractedText(result.data);
      
      // Enable export buttons
      if (exportTextJsonBtn) exportTextJsonBtn.disabled = false;
      if (exportTextSvgBtn) exportTextSvgBtn.disabled = false;
      
      // Update badge
      if (textCountBadge) {
        textCountBadge.textContent = `(${result.data.textElements?.length || 0})`;
      }
    } else {
      console.error("Text extraction failed:", result.error);
      if (textElementListDiv) {
        textElementListDiv.innerHTML = `<div style="color: #dc3545; font-size: 0.85em;">Error: ${result.error}</div>`;
      }
    }
  } catch (error) {
    console.error("Text extraction error:", error);
    if (textElementListDiv) {
      textElementListDiv.innerHTML = `<div style="color: #dc3545; font-size: 0.85em;">Error: ${error.message}</div>`;
    }
  } finally {
    hideLoadingGear();
    if (extractTextBtn) {
      extractTextBtn.disabled = false;
      extractTextBtn.textContent = "Extract";
    }
  }
}

function displayExtractedText(data) {
  // Display fonts
  if (fontListDiv && data.fonts) {
    if (data.fonts.length > 0) {
      fontListDiv.innerHTML = data.fonts.map(font => `
        <div style="padding: 4px 8px; margin-bottom: 4px; background: white; border-radius: 4px; border: 1px solid #e0e4ff; font-size: 0.8em;">
          <div style="font-weight: 600; color: #333;">${font.name || font.ref}</div>
          <div style="font-size: 0.9em; color: #666;">
            ${font.baseFont ? `Base: ${font.baseFont}` : ""}
            ${font.encoding ? ` • Encoding: ${font.encoding}` : ""}
            ${font.subtype ? ` • Type: ${font.subtype}` : ""}
          </div>
        </div>
      `).join("");
    } else {
      fontListDiv.innerHTML = `<div style="color: #999; font-size: 0.85em; font-style: italic;">No embedded fonts found</div>`;
    }
  }

  // Display text elements
  if (textElementListDiv && data.textElements) {
    if (textElementCountSpan) {
      textElementCountSpan.textContent = `(${data.textElements.length})`;
    }

    if (data.textElements.length > 0) {
      // Group text elements by layer
      const byLayer = {};
      data.textElements.forEach(el => {
        const layer = el.layer || "Unassigned";
        if (!byLayer[layer]) byLayer[layer] = [];
        byLayer[layer].push(el);
      });

      let html = "";
      Object.entries(byLayer).forEach(([layer, elements]) => {
        html += `
          <div style="margin-bottom: 12px;">
            <div style="font-weight: 600; font-size: 0.8em; color: #667eea; margin-bottom: 4px; padding: 4px 8px; background: #f0f2ff; border-radius: 4px;">
              ${layer} <span style="color: #999; font-weight: normal;">(${elements.length})</span>
            </div>
        `;
        
        // Show first 50 elements per layer
        elements.slice(0, 50).forEach(el => {
          const displayText = el.text.length > 40 ? el.text.substring(0, 40) + "..." : el.text;
          const posInfo = `(${el.x?.toFixed(1) || "?"}, ${el.y?.toFixed(1) || "?"})`;
          
          html += `
            <div style="padding: 4px 8px; margin-bottom: 2px; background: white; border-radius: 3px; border: 1px solid #eee; font-size: 0.75em; display: flex; justify-content: space-between; align-items: center;">
              <span style="color: #333; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${el.text}">${displayText}</span>
              <span style="color: #999; font-size: 0.9em; margin-left: 8px; flex-shrink: 0;">${posInfo}</span>
            </div>
          `;
        });

        if (elements.length > 50) {
          html += `<div style="color: #999; font-size: 0.75em; font-style: italic; padding: 4px 8px;">... and ${elements.length - 50} more</div>`;
        }

        html += `</div>`;
      });

      textElementListDiv.innerHTML = html;
    } else {
      textElementListDiv.innerHTML = `<div style="color: #999; font-size: 0.85em; font-style: italic;">No text elements found</div>`;
    }
  }
}

async function handleExportTextJson() {
  if (!extractedTextData) return;

  try {
    const defaultName = currentFilePath
      ? currentFilePath.split("/").pop().replace(".pdf", "_text.json")
      : "text_export.json";

    const savePath = await window.electronAPI.showSaveDialog({
      title: "Save Text Data as JSON",
      defaultPath: defaultName,
      filters: [{ name: "JSON Files", extensions: ["json"] }]
    });

    if (!savePath) return;

    const jsonContent = JSON.stringify(extractedTextData, null, 2);
    const writeResult = await window.electronAPI.writeFile({
      filePath: savePath,
      content: jsonContent
    });

    if (writeResult.success) {
      console.log("Text data exported to:", savePath);
      await window.electronAPI.showInFinder(savePath);
    }
  } catch (error) {
    console.error("Export error:", error);
  }
}

async function handleExportTextSvg() {
  if (!extractedTextData) return;

  // TODO: Implement SVG path export for text
  // This will convert text to SVG paths using font outlines
  console.log("Text to SVG path export - not yet implemented");
  alert("Text to SVG path export is not yet implemented.\nUse JSON export to get text positions for your text rendering service.");
}

