/**
 * DOM Elements Module
 *
 * Centralized access to DOM elements used throughout the application.
 * Provides lazy initialization to ensure elements are available when accessed.
 */

// ============================================
// DOM Element References
// ============================================

let elements = null;

/**
 * Initialize and return all DOM element references
 * Uses lazy initialization to ensure DOM is ready
 */
export function getElements() {
  if (elements) return elements;

  elements = {
    // Main controls
    uploadBtn: document.getElementById('uploadBtn'),
    uploadPlaceholder: document.getElementById('uploadPlaceholder'),
    statusDiv: document.getElementById('status'),
    resultsDiv: document.getElementById('results'),
    toolbarDiv: document.getElementById('toolbar'),

    // Metadata
    metadataDiv: document.getElementById('metadata'),

    // Layer controls
    layerControlsDiv: document.getElementById('layerControls'),
    textLayerControlsDiv: document.getElementById('textLayerControls'),
    selectAllLayersBtn: document.getElementById('selectAllLayersBtn'),
    deselectAllLayersBtn: document.getElementById('deselectAllLayersBtn'),
    selectAllTextLayersBtn: document.getElementById('selectAllTextLayersBtn'),
    deselectAllTextLayersBtn: document.getElementById('deselectAllTextLayersBtn'),
    layerDetailsSection: document.getElementById('layerDetailsSection'),
    layerDetailsDiv: document.getElementById('layerDetails'),

    // Map preview
    mapPreviewDiv: document.getElementById('mapPreview'),
    mapStatsDiv: document.getElementById('mapStats'),

    // Zoom controls
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomResetBtn: document.getElementById('zoomResetBtn'),
    zoomLevelSpan: document.getElementById('zoomLevel'),

    // Export controls
    exportSvgBtn: document.getElementById('exportSvgBtn'),
    whiteBackgroundCheck: document.getElementById('whiteBackgroundCheck'),
    exportStatusDiv: document.getElementById('exportStatus'),
    exportLayersListDiv: document.getElementById('exportLayersList'),

    // File info
    fileInfoDiv: document.getElementById('fileInfo'),
    fileNameDiv: document.getElementById('fileName'),
    fileSizeDiv: document.getElementById('fileSize'),

    // Tab badges
    vectorCountBadge: document.getElementById('vectorCountBadge'),
    overlayCountBadge: document.getElementById('overlayCountBadge'),
    textCountBadge: document.getElementById('textCountBadge'),

    // Text extraction
    extractTextBtn: document.getElementById('extractTextBtn'),
    fontListDiv: document.getElementById('fontList'),
    textElementListDiv: document.getElementById('textElementList'),
    textElementCountSpan: document.getElementById('textElementCount'),
    exportTextJsonBtn: document.getElementById('exportTextJsonBtn'),
    exportTextSvgBtn: document.getElementById('exportTextSvgBtn'),

    // Stats indicator
    statsIndicator: document.getElementById('statsIndicator'),
    statsPathCount: document.getElementById('statsPathCount'),
    statsLayerCount: document.getElementById('statsLayerCount'),
    statsMemory: document.getElementById('statsMemory'),

    // Crop mode
    cropModeBtn: document.getElementById('cropModeBtn'),
    cropModeLabel: document.getElementById('cropModeLabel'),
    cropControls: document.getElementById('cropControls'),
    cropWidthInput: document.getElementById('cropWidthInput'),
    cropHeightInput: document.getElementById('cropHeightInput'),
    cropScaleSlider: document.getElementById('cropScaleSlider'),
    cropScaleValue: document.getElementById('cropScaleValue'),
    cropPositionDisplay: document.getElementById('cropPositionDisplay'),
    cropActualSize: document.getElementById('cropActualSize'),
    applyCropBtn: document.getElementById('applyCropBtn'),

    // Background color
    bgColorCheck: document.getElementById('bgColorCheck'),
    bgColorPicker: document.getElementById('bgColorPicker'),

    // Loading indicator
    loadingGear: document.getElementById('loadingGear'),

    // Recent files
    recentFilesSection: document.getElementById('recentFilesSection'),
    recentFilesList: document.getElementById('recentFilesList'),
    clearRecentBtn: document.getElementById('clearRecentBtn'),

    // Vector debug panel
    vectorDebugPanel: document.getElementById('vectorDebugPanel'),
    vectorDebugContent: document.getElementById('vectorDebugContent'),
    mapPreviewPanel: document.getElementById('mapPreviewPanel')
  };

  return elements;
}

/**
 * Reset element cache (useful for testing or dynamic DOM changes)
 */
export function resetElements() {
  elements = null;
}
