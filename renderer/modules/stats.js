/**
 * Stats Module
 *
 * Handles statistics display and updates including:
 * - Stats indicator in toolbar
 * - Tab count badges
 * - Export layers list
 * - Map stats display
 */

import { state, isOverlayLayer, getDescriptiveLayerName } from './state.js';
import { getElements } from './dom-elements.js';
import { formatMemorySize, estimateMemoryUsage } from './ui-helpers.js';

// ============================================
// Stats Indicator
// ============================================

export function updateStatsIndicator(options = {}) {
  const { processing = false, pathCount = null, memoryKB = null } = options;
  const { statsIndicator, statsPathCount, statsLayerCount, statsMemory } = getElements();

  if (!state.currentPDFData && !processing) {
    statsIndicator.style.display = 'none';
    return;
  }

  statsIndicator.style.display = 'flex';

  if (processing) {
    statsIndicator.classList.add('processing');
  } else {
    statsIndicator.classList.remove('processing');
  }

  const paths = pathCount !== null ? pathCount : state.currentStats.totalPaths;
  statsPathCount.textContent = paths.toLocaleString();

  const enabledCount = state.enabledLayers.size;
  const totalCount = state.allLayers.length;
  statsLayerCount.textContent = `${enabledCount}/${totalCount}`;
  state.currentStats.enabledLayers = enabledCount;
  state.currentStats.totalLayers = totalCount;

  const memory = memoryKB !== null ? memoryKB : state.currentStats.estimatedMemoryKB;
  statsMemory.textContent = formatMemorySize(memory);

  const memoryItem = statsMemory.parentElement;
  memoryItem.classList.remove('warning', 'critical');
  if (memory > 100000) {
    memoryItem.classList.add('critical');
  } else if (memory > 50000) {
    memoryItem.classList.add('warning');
  }

  const pathItem = statsPathCount.parentElement;
  pathItem.classList.remove('warning', 'critical');
  if (paths > 50000) {
    pathItem.classList.add('critical');
  } else if (paths > 20000) {
    pathItem.classList.add('warning');
  }
}

// ============================================
// Tab Count Badges
// ============================================

export function updateTabCounts() {
  const { vectorCountBadge, overlayCountBadge } = getElements();

  const vectorLayers = state.allLayers.filter(l => !isOverlayLayer(l));
  const enabledVectorCount = vectorLayers.filter(l => state.enabledLayers.has(l)).length;

  const overlayLayers = state.allLayers.filter(l => isOverlayLayer(l));
  const enabledOverlayCount = overlayLayers.filter(l => state.enabledLayers.has(l)).length;

  if (vectorCountBadge) {
    vectorCountBadge.textContent = `(${enabledVectorCount})`;
  }
  if (overlayCountBadge) {
    overlayCountBadge.textContent = `(${enabledOverlayCount})`;
  }
}

// ============================================
// Export Layers List
// ============================================

export function updateExportLayersList() {
  const { exportLayersListDiv } = getElements();
  if (!exportLayersListDiv) return;

  if (state.enabledLayers.size === 0) {
    exportLayersListDiv.innerHTML = '<div style="color: #999; font-size: 0.9em; font-style: italic;">No layers enabled</div>';
    return;
  }

  const layerPathCounts = {};
  if (state.currentPDFData && state.currentPDFData.contentPaths) {
    const paths = state.currentPDFData.contentPaths.paths;
    paths.forEach(path => {
      const baseName = path.layer || 'Unassigned';

      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
      }

      if (pathColor) {
        const sublayerName = `${baseName}::${pathColor}`;
        if (state.enabledLayers.has(sublayerName)) {
          layerPathCounts[sublayerName] = (layerPathCounts[sublayerName] || 0) + 1;
        }
      }
    });
  }

  const sortedEnabledLayers = Array.from(state.enabledLayers).sort();
  const vectorLayers = sortedEnabledLayers.filter(l => !isOverlayLayer(l));
  const overlayLayers = sortedEnabledLayers.filter(l => isOverlayLayer(l));

  let html = '';

  if (vectorLayers.length > 0) {
    html += '<div style="margin-bottom: 16px;"><h5 style="font-size: 0.8em; font-weight: 600; color: #667eea; margin-bottom: 8px; text-transform: uppercase;">Vector Layers</h5>';
    vectorLayers.forEach(layerName => {
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

// ============================================
// Map Stats Display
// ============================================

export function updateMapStats(statusMessage = null) {
  const { mapStatsDiv } = getElements();

  if (!state.currentPDFData || !state.currentPDFData.contentPaths) {
    // For lightweight mode, show simpler stats
    if (statusMessage) {
      mapStatsDiv.innerHTML = `<div style="font-weight: 600; color: #667eea;">${statusMessage}</div>`;
    }
    return;
  }

  const paths = state.currentPDFData.contentPaths.paths;
  const enabledPaths = paths.filter(p => !p.layer || state.enabledLayers.has(p.layer));

  let statsHTML = '';

  if (statusMessage) {
    statsHTML += `
      <div style="font-weight: 600; color: #667eea; margin-bottom: 8px;">
        ${statusMessage}
      </div>
    `;
  }

  if (state.lastSavedFilePath) {
    statsHTML += `
      <div style="margin-bottom: 8px; padding: 8px; background: #d4edda; border-radius: 4px; border: 1px solid #c3e6cb;">
        <div style="font-weight: 600; color: #155724; font-size: 0.85em;">Saved:</div>
        <div style="color: #155724; font-size: 0.75em; word-break: break-all;">${state.lastSavedFilePath}</div>
      </div>
    `;
  }

  statsHTML += `
    <div>Total paths: ${paths.length}</div>
    <div>Visible paths: ${enabledPaths.length}</div>
    <div>Layers: ${state.enabledLayers.size} of ${state.allLayers.length} enabled</div>
  `;

  if (state.cropModeEnabled && state.cropRectangle) {
    const rectWidth = parseFloat(state.cropRectangle.getAttribute('width'));
    const rectHeight = parseFloat(state.cropRectangle.getAttribute('height'));

    const PT_TO_MM = 0.352778;
    const widthMM = (rectWidth * PT_TO_MM).toFixed(1);
    const heightMM = (rectHeight * PT_TO_MM).toFixed(1);

    const { mapPreviewDiv } = getElements();
    const svgElement = mapPreviewDiv.querySelector('svg');
    if (svgElement) {
      const viewBox = svgElement.getAttribute('viewBox');
      if (viewBox) {
        const [vbMinX, vbMinY] = viewBox.split(' ').map(parseFloat);
        const xMM = ((state.cropX - vbMinX) * PT_TO_MM).toFixed(1);
        const yMM = ((state.cropY - vbMinY) * PT_TO_MM).toFixed(1);

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
