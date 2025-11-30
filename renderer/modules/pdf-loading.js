/**
 * PDF Loading Module
 *
 * Handles PDF file operations including:
 * - File upload and loading
 * - Recent files management
 * - Displaying results after processing
 */

import { state } from './state.js';
import { getElements } from './dom-elements.js';
import { showStatus, hideStatus, showStatusWithProgress, formatBytes, estimateMemoryUsage } from './ui-helpers.js';
import { updateStatsIndicator, updateTabCounts, updateMapStats } from './stats.js';
import { extractLayersFromLightweight, displayLayerControls } from './layer-controls.js';
import { showLightweightPreview } from './map-preview.js';
import { displayMetadata } from './metadata.js';

// ============================================
// Recent Files
// ============================================

export async function loadRecentFiles() {
  const { recentFilesSection, recentFilesList } = getElements();

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

export async function renderRecentFiles(files) {
  const { recentFilesList } = getElements();
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

export async function openRecentFile(filePath) {
  const { uploadBtn } = getElements();

  // Use unified loading function
  uploadBtn.disabled = true;
  document.body.style.cursor = 'wait';
  await loadPDFFile(filePath);
}

export async function trackRecentFile(filePath, result) {
  // Files are now tracked automatically in main process during processing
  // This function is kept for backwards compatibility
  console.log('File tracked in main process:', filePath);
}

/**
 * Initialize clear recent files button
 */
export function initClearRecentFiles() {
  const { clearRecentBtn } = getElements();

  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', async () => {
      await window.electronAPI.clearRecentFiles();
      loadRecentFiles();
    });
  }
}

// ============================================
// File Upload and Loading
// ============================================

export async function handleUpload() {
  const { uploadBtn } = getElements();

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

/**
 * Unified PDF loading function - used by both upload and recent files
 */
export async function loadPDFFile(filePath) {
  const { uploadBtn, uploadPlaceholder, recentFilesSection, toolbarDiv, exportSvgBtn } = getElements();

  state.currentFilePath = filePath;
  const fileName = filePath.split('/').pop();

  showStatusWithProgress(`Processing ${fileName}...`, 'info');

  // Show stats indicator in processing mode
  updateStatsIndicator({ processing: true, pathCount: 0, memoryKB: 0 });

  try {
    // Process PDF in main process (keeps paths there, returns lightweight data)
    console.time('PDF:BackendProcess');
    const result = await window.electronAPI.processPDFLightweight(filePath);
    console.timeEnd('PDF:BackendProcess');

    if (!result.success) {
      showStatus(`Error: ${result.error}`, 'error');
      uploadBtn.disabled = false;
      document.body.style.cursor = 'default';
      updateStatsIndicator({ processing: false });
      return;
    }

    // Store lightweight data (no path arrays - those stay in main process)
    state.currentPDFData = result.data;

    // Update stats with final values
    state.currentStats.totalPaths = result.data.pathCount || 0;
    state.currentStats.totalLayers = result.data.layerInfo?.length || 0;
    state.currentStats.estimatedMemoryKB = estimateMemoryUsage(
      state.currentStats.totalPaths,
      state.currentStats.totalLayers
    );

    // Display results using lightweight data
    displayResultsLightweight(result.data);

    // Hide upload placeholder after successful processing
    uploadPlaceholder.classList.add('hidden');

    // Also hide recent files section
    if (recentFilesSection) {
      recentFilesSection.style.display = 'none';
    }

    // Update stats indicator with final data
    updateStatsIndicator({ processing: false });

    hideStatus();
    document.body.style.cursor = 'default';

  } catch (processingError) {
    console.error('Error processing PDF:', processingError);
    showStatus(`Error: ${processingError.message}`, 'error');
    uploadBtn.disabled = false;
    document.body.style.cursor = 'default';
    updateStatsIndicator({ processing: false });
  }
}

// ============================================
// Display Results
// ============================================

/**
 * Lightweight version for backend processing (no path data in renderer)
 */
export function displayResultsLightweight(data) {
  const { toolbarDiv, exportSvgBtn } = getElements();

  // Show toolbar
  toolbarDiv.style.display = 'flex';

  // Reset cached bounds for new PDF
  state.cachedBounds = null;

  // Store bounds from backend if available
  if (data.bounds) {
    state.cachedBounds = {
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

/**
 * Update file info display in toolbar
 */
export function updateFileInfo() {
  const { fileInfoDiv, fileNameDiv, fileSizeDiv } = getElements();

  if (!state.currentFilePath || !state.currentPDFData) {
    fileInfoDiv.style.display = 'none';
    return;
  }

  // Extract filename from path
  const fileName = state.currentFilePath.split('/').pop();

  // Get file size from metadata (added during PDF processing)
  const fileSize = state.currentPDFData.metadata?.fileSize;
  const fileSizeText = fileSize ? formatBytes(fileSize) : '';

  fileNameDiv.textContent = fileName;
  fileSizeDiv.textContent = fileSizeText;
  fileInfoDiv.style.display = 'flex';
}
