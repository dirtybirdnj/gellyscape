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

// DOM elements
const uploadBtn = document.getElementById('uploadBtn');
const uploadSection = document.querySelector('.upload-section');
const statusDiv = document.getElementById('status');
const resultsDiv = document.getElementById('results');
const metadataDiv = document.getElementById('metadata');
const textDataDiv = document.getElementById('textData');
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

  // Reset cached bounds for new PDF
  cachedBounds = null;

  // Display metadata
  displayMetadata(data.metadata, data.info);

  // Display text data (fonts and text elements)
  displayTextData(data);

  // Extract and display layers
  extractLayersFromData(data);

  // Display layer controls
  displayLayerControls();

  // Generate and display map preview
  generateMapPreview();
}

function extractLayersFromData(data) {
  allLayers = [];
  enabledLayers.clear();

  // Extract layer names and colors from contentPaths if available
  if (data.contentPaths && data.contentPaths.paths) {
    const layerNames = new Set();
    const layerColors = {}; // Map of layer name to Set of colors

    data.contentPaths.paths.forEach(path => {
      if (path.layer) {
        layerNames.add(path.layer);

        // Collect colors for this layer
        if (!layerColors[path.layer]) {
          layerColors[path.layer] = new Set();
        }

        // Add fill color if present
        if (path.fill && path.fillColor) {
          const colorStr = `rgb(${path.fillColor.join(',')})`;
          layerColors[path.layer].add(colorStr);
        }

        // Add stroke color if present
        if (path.stroke && path.strokeColor) {
          const colorStr = `rgb(${path.strokeColor.join(',')})`;
          layerColors[path.layer].add(colorStr);
        }
      }
    });

    // Add text layers from textObjectsByLayer
    if (data.contentPaths && data.contentPaths.textObjectsByLayer) {
      Object.keys(data.contentPaths.textObjectsByLayer).forEach(textLayer => {
        // Prefix text layers to distinguish them from path layers
        const textLayerName = `📝 ${textLayer}`;
        layerNames.add(textLayerName);

        // Collect text colors (from fillColor)
        if (!layerColors[textLayerName]) {
          layerColors[textLayerName] = new Set();
        }

        data.contentPaths.textObjectsByLayer[textLayer].forEach(textObj => {
          if (textObj.fillColor && Array.isArray(textObj.fillColor)) {
            const colorStr = `rgb(${textObj.fillColor.join(',')})`;
            layerColors[textLayerName].add(colorStr);
          }
        });
      });
    }

    // If no layer info on paths, try to get from metadata
    if (layerNames.size === 0 && data.layerNames) {
      Object.values(data.layerNames).forEach(name => layerNames.add(name));
    }

    // If still no layers, create a default "All Paths" layer
    if (layerNames.size === 0) {
      layerNames.add('All Paths');
    }

    allLayers = Array.from(layerNames).sort();

    // Store color information in a global object for display
    window.layerColorInfo = {};
    allLayers.forEach(layer => {
      window.layerColorInfo[layer] = Array.from(layerColors[layer] || []);
    });

    // Enable all layers by default
    allLayers.forEach(layer => enabledLayers.add(layer));
  }

  console.log('Extracted layers:', allLayers);
  console.log('Layer colors:', window.layerColorInfo);
}

function displayLayerControls() {
  layerControlsDiv.innerHTML = '';
  textLayerControlsDiv.innerHTML = '';

  if (allLayers.length === 0) {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No layers found</div>';
    return;
  }

  // Separate vector layers from text layers
  const vectorLayers = [];
  const textLayers = [];

  allLayers.forEach(layerName => {
    if (layerName.startsWith('📝 ')) {
      textLayers.push(layerName);
    } else {
      vectorLayers.push(layerName);
    }
  });

  // Populate vector layers
  if (vectorLayers.length === 0) {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No vector layers found</div>';
  } else {
    vectorLayers.forEach(layerName => {
      const layerItem = createLayerControlItem(layerName);
      layerControlsDiv.appendChild(layerItem);
    });
  }

  // Populate text layers
  if (textLayers.length === 0) {
    textLayerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No text layers found</div>';
  } else {
    textLayers.forEach(layerName => {
      const layerItem = createLayerControlItem(layerName);
      textLayerControlsDiv.appendChild(layerItem);
    });
  }
}

function createLayerControlItem(layerName) {
  const layerItem = document.createElement('div');
  layerItem.className = 'layer-item';
  layerItem.style.cssText = 'display: flex; align-items: center; justify-content: space-between;';

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
  label.style.cssText = 'flex: 1; min-width: 0;';

  const span = document.createElement('span');
  span.textContent = layerName;

  label.appendChild(checkbox);
  label.appendChild(span);
  layerItem.appendChild(label);

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

    layerItem.appendChild(swatchContainer);
  }

  return layerItem;
}

function selectAllLayers() {
  // Enable only vector layers (not text layers)
  allLayers.forEach(layer => {
    if (!layer.startsWith('📝 ')) {
      enabledLayers.add(layer);
    }
  });

  // Update checkboxes for vector layers
  allLayers.forEach(layerName => {
    if (!layerName.startsWith('📝 ')) {
      const checkbox = document.getElementById(`layer-${layerName}`);
      if (checkbox) checkbox.checked = true;
    }
  });

  // Regenerate preview
  generateMapPreview();
}

function deselectAllLayers() {
  // Disable only vector layers (not text layers)
  allLayers.forEach(layer => {
    if (!layer.startsWith('📝 ')) {
      enabledLayers.delete(layer);
    }
  });

  // Update checkboxes for vector layers
  allLayers.forEach(layerName => {
    if (!layerName.startsWith('📝 ')) {
      const checkbox = document.getElementById(`layer-${layerName}`);
      if (checkbox) checkbox.checked = false;
    }
  });

  // Regenerate preview
  generateMapPreview();
}

function selectAllTextLayers() {
  // Enable only text layers
  allLayers.forEach(layer => {
    if (layer.startsWith('📝 ')) {
      enabledLayers.add(layer);
    }
  });

  // Update checkboxes for text layers
  allLayers.forEach(layerName => {
    if (layerName.startsWith('📝 ')) {
      const checkbox = document.getElementById(`layer-${layerName}`);
      if (checkbox) checkbox.checked = true;
    }
  });

  // Regenerate preview
  generateMapPreview();
}

function deselectAllTextLayers() {
  // Disable only text layers
  allLayers.forEach(layer => {
    if (layer.startsWith('📝 ')) {
      enabledLayers.delete(layer);
    }
  });

  // Update checkboxes for text layers
  allLayers.forEach(layerName => {
    if (layerName.startsWith('📝 ')) {
      const checkbox = document.getElementById(`layer-${layerName}`);
      if (checkbox) checkbox.checked = false;
    }
  });

  // Regenerate preview
  generateMapPreview();
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

  // Filter paths by enabled layers
  const filteredPaths = paths.filter(path => {
    // If layers exist, only include paths from enabled layers
    if (allLayers.length > 0 && path.layer) {
      return enabledLayers.has(path.layer);
    }
    // If no layers or path has no layer, only include if all layers are enabled
    return allLayers.length === 0 || enabledLayers.size === allLayers.length;
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
      const strokeWidth = path.strokeWidth || 1;

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
    // Single-line format: label: value
    div.innerHTML = `<strong>${item.label}:</strong> ${item.value}`;
    metadataDiv.appendChild(div);
  });
}

function displayTextData(data) {
  textDataDiv.innerHTML = '';

  console.log('[Text Data] Processing data:', {
    hasContentPaths: !!data.contentPaths,
    hasTextObjects: !!(data.contentPaths && data.contentPaths.textObjects),
    textObjectsCount: data.contentPaths?.textObjects?.length || 0,
    hasFonts: !!data.fonts,
    hasTextContent: !!data.textContent
  });

  // Extract fonts from PDF data
  const fonts = new Set();
  const textElements = [];

  // Check if we have font information in the data
  if (data.fonts && Array.isArray(data.fonts)) {
    data.fonts.forEach(font => fonts.add(font));
  }

  // Check if we have text objects from content paths
  if (data.contentPaths && data.contentPaths.textObjects && Array.isArray(data.contentPaths.textObjects)) {
    console.log('[Text Data] Found', data.contentPaths.textObjects.length, 'text objects');
    // Extract unique text strings from text objects
    data.contentPaths.textObjects.forEach(textObj => {
      if (textObj.text && textObj.text.trim()) {
        textElements.push(textObj.text.trim());
      }
      // Also collect font names
      if (textObj.font) {
        fonts.add(textObj.font);
      }
    });
  }

  // Check if we have text content in the data (legacy)
  if (data.textContent && Array.isArray(data.textContent)) {
    textElements.push(...data.textContent);
  }

  console.log('[Text Data] Collected:', { fontsCount: fonts.size, textElementsCount: textElements.length });

  // Display fonts section
  if (fonts.size > 0) {
    const fontsTitle = document.createElement('div');
    fontsTitle.style.cssText = 'font-weight: 600; color: #555; margin-bottom: 4px; font-size: 0.75em; padding: 3px 0;';
    fontsTitle.textContent = `Fonts (${fonts.size})`;
    textDataDiv.appendChild(fontsTitle);

    Array.from(fonts).sort().forEach(font => {
      const fontDiv = document.createElement('div');
      fontDiv.className = 'font-item';
      fontDiv.textContent = font;
      textDataDiv.appendChild(fontDiv);
    });
  }

  // Display text elements section
  if (textElements.length > 0) {
    const textTitle = document.createElement('div');
    textTitle.style.cssText = 'font-weight: 600; color: #555; margin: 8px 0 4px 0; font-size: 0.75em; padding: 3px 0;';
    textTitle.textContent = `Text Elements (${textElements.length})`;
    textDataDiv.appendChild(textTitle);

    // Show first 50 text elements
    textElements.slice(0, 50).forEach(text => {
      const textDiv = document.createElement('div');
      textDiv.className = 'text-item';
      // Truncate long text
      const displayText = text.length > 80 ? text.substring(0, 80) + '...' : text;
      textDiv.textContent = displayText;
      textDataDiv.appendChild(textDiv);
    });

    if (textElements.length > 50) {
      const moreDiv = document.createElement('div');
      moreDiv.style.cssText = 'color: #999; font-size: 0.7em; padding: 3px 6px; font-style: italic;';
      moreDiv.textContent = `+ ${textElements.length - 50} more...`;
      textDataDiv.appendChild(moreDiv);
    }
  }

  // If no text data available, show message
  if (fonts.size === 0 && textElements.length === 0) {
    textDataDiv.innerHTML = '<div style="color: #999; font-size: 0.75em; padding: 6px; font-style: italic;">No text data found</div>';
  }
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
