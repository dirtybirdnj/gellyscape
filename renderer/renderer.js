/**
 * GellyScape Renderer - Main Entry Point
 *
 * This is the main entry point for the renderer process.
 * It imports and initializes all modules, sets up event listeners,
 * and coordinates the application's user interface.
 */

// ============================================
// Module Imports
// ============================================

import { state } from './modules/state.js';
import { getElements, resetElements } from './modules/dom-elements.js';
import {
  showStatus,
  hideStatus,
  showStatusWithProgress,
  showLoadingGear,
  hideLoadingGear,
  estimateMemoryUsage
} from './modules/ui-helpers.js';
import {
  updateStatsIndicator,
  updateTabCounts,
  updateMapStats
} from './modules/stats.js';
import {
  displayLayerControls,
  selectAllLayers,
  deselectAllLayers,
  selectAllTextLayers,
  deselectAllTextLayers
} from './modules/layer-controls.js';
import {
  generateMapPreview,
  showLightweightPreview,
  adjustZoom,
  resetZoom,
  updateZoomDisplay,
  startPan,
  doPan,
  endPan,
  handleWheel
} from './modules/map-preview.js';
import {
  toggleCropMode,
  updateCropDimensions,
  updateCropScale,
  applyCrop,
  removeCropRectangle
} from './modules/crop-mode.js';
import {
  handleExportSVG,
  handleExtractText,
  handleExportTextJson,
  handleExportTextSvg
} from './modules/export.js';
import {
  loadRecentFiles,
  handleUpload,
  initClearRecentFiles
} from './modules/pdf-loading.js';
import { initializeTabs } from './modules/tabs.js';

// ============================================
// Make Functions Available Globally
// ============================================

// These functions need to be on window for use by other modules
window.startPan = startPan;

// ============================================
// Event Listener Setup
// ============================================

function setupEventListeners() {
  const elements = getElements();

  // Upload and export buttons
  elements.uploadBtn.addEventListener('click', handleUpload);
  elements.exportSvgBtn.addEventListener('click', handleExportSVG);

  // Zoom controls
  elements.zoomInBtn.addEventListener('click', () => adjustZoom(0.1));
  elements.zoomOutBtn.addEventListener('click', () => adjustZoom(-0.1));
  elements.zoomResetBtn.addEventListener('click', resetZoom);

  // Layer selection buttons
  elements.selectAllLayersBtn.addEventListener('click', selectAllLayers);
  elements.deselectAllLayersBtn.addEventListener('click', deselectAllLayers);
  elements.selectAllTextLayersBtn.addEventListener('click', selectAllTextLayers);
  elements.deselectAllTextLayersBtn.addEventListener('click', deselectAllTextLayers);

  // Text extraction event listeners
  if (elements.extractTextBtn) {
    elements.extractTextBtn.addEventListener('click', handleExtractText);
  }
  if (elements.exportTextJsonBtn) {
    elements.exportTextJsonBtn.addEventListener('click', handleExportTextJson);
  }
  if (elements.exportTextSvgBtn) {
    elements.exportTextSvgBtn.addEventListener('click', handleExportTextSvg);
  }

  // Crop mode event listeners
  elements.cropModeBtn.addEventListener('click', toggleCropMode);
  elements.cropWidthInput.addEventListener('input', updateCropDimensions);
  elements.cropHeightInput.addEventListener('input', updateCropDimensions);
  elements.cropScaleSlider.addEventListener('input', updateCropScale);
  elements.applyCropBtn.addEventListener('click', applyCrop);

  // Background color event listeners
  elements.bgColorCheck.addEventListener('change', () => {
    state.bgColorEnabled = elements.bgColorCheck.checked;
    elements.bgColorPicker.disabled = !state.bgColorEnabled;
    generateMapPreview();
  });
  elements.bgColorPicker.addEventListener('input', () => {
    state.bgColorValue = elements.bgColorPicker.value;
    generateMapPreview();
  });

  // Panning event listeners
  elements.mapPreviewDiv.addEventListener('mousedown', startPan);
  elements.mapPreviewDiv.addEventListener('mousemove', doPan);
  elements.mapPreviewDiv.addEventListener('mouseup', endPan);
  elements.mapPreviewDiv.addEventListener('mouseleave', endPan);

  // Zoom with mouse wheel
  elements.mapPreviewDiv.addEventListener('wheel', handleWheel);
}

// ============================================
// PDF Progress Listener
// ============================================

function setupProgressListener() {
  if (window.electronAPI && window.electronAPI.onPDFProgress) {
    window.electronAPI.onPDFProgress((progress) => {
      console.log('[Progress]', progress.operation, '-', progress.detail);

      // Update the status display with the current operation
      const statusMessage = `${progress.operation}: ${progress.detail}`;
      showStatusWithProgress(statusMessage, 'info');

      // Update stats indicator with progress data if available
      if (progress.stats) {
        updateStatsIndicator({
          processing: true,
          pathCount: progress.stats.pathCount || 0,
          memoryKB: progress.stats.memoryKB || estimateMemoryUsage(progress.stats.pathCount || 0, progress.stats.layerCount || 0)
        });
      }
    });
  }
}

// ============================================
// Initialization
// ============================================

function initialize() {
  // Set up all event listeners
  setupEventListeners();

  // Initialize tabs
  initializeTabs();

  // Initialize clear recent files button
  initClearRecentFiles();

  // Set up PDF progress listener
  setupProgressListener();

  // Load recent files on startup
  loadRecentFiles();

  console.log('GellyScape renderer initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
