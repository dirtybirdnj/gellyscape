/**
 * Layer Controls Module
 *
 * Handles layer UI including:
 * - Layer control checkboxes
 * - Layer grouping and categorization
 * - Select all/deselect all functionality
 * - Layer expansion and path details
 */

import { state, isOverlayLayer, getDescriptiveLayerName, OVERLAY_GROUPS } from './state.js';
import { getElements } from './dom-elements.js';
import { showColorTooltip, hideColorTooltip, copyColorToClipboard, showColorPicker } from './ui-helpers.js';
import { generateMapPreview } from './map-preview.js';
import { updateStatsIndicator, updateExportLayersList, updateTabCounts } from './stats.js';

/**
 * Convert RGB array to lowercase 6-char hex color
 * @param {number[]} rgb - [r, g, b] array (0-255)
 * @returns {string} Hex color like #rrggbb
 */
function rgbToHex(rgb) {
  if (!rgb || rgb.length < 3) return '#000000';
  const [r, g, b] = rgb;
  return '#' + [r, g, b].map(v => {
    const hex = Math.round(Math.max(0, Math.min(255, v))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toLowerCase();
}

// ============================================
// Layer Extraction
// ============================================

/**
 * Extract layers from lightweight layerInfo array (backend processing mode)
 */
export function extractLayersFromLightweight(layerInfo) {
  state.allLayers = [];
  state.enabledLayers.clear();

  if (!layerInfo || layerInfo.length === 0) {
    console.log('No layer info available');
    return;
  }

  window.layerColorInfo = {};
  window.layerBaseNames = {};
  window.layerPathCounts = {};
  window.layerRenderType = {};

  layerInfo.forEach(layer => {
    state.allLayers.push(layer.name);
    window.layerBaseNames[layer.name] = layer.baseLayer;
    window.layerColorInfo[layer.name] = [layer.color];
    window.layerPathCounts[layer.name] = layer.pathCount;
    window.layerRenderType[layer.name] = layer.renderType || 'fill';

    if (!isOverlayLayer(layer.name)) {
      state.enabledLayers.add(layer.name);
    }
  });

  state.allLayers.sort();
  console.log('Extracted layers from backend:', state.allLayers.length);
}

/**
 * Extract layers from full PDF data (legacy mode)
 */
export function extractLayersFromData(data) {
  state.allLayers = [];
  state.enabledLayers.clear();

  if (data.contentPaths && data.contentPaths.paths) {
    const layerColorSublayers = new Set();
    const layerColors = {};

    data.contentPaths.paths.forEach(path => {
      const layerName = path.layer || 'Unassigned';

      if (!layerColors[layerName]) {
        layerColors[layerName] = new Set();
      }

      let colorStr = null;
      if (path.stroke && path.strokeColor) {
        colorStr = rgbToHex(path.strokeColor);
      } else if (path.fill && path.fillColor) {
        colorStr = rgbToHex(path.fillColor);
      }

      if (colorStr) {
        layerColors[layerName].add(colorStr);
        layerColorSublayers.add(`${layerName}::${colorStr}`);
      }
    });

    // Add text layers
    if (data.contentPaths && data.contentPaths.textObjectsByLayer) {
      Object.keys(data.contentPaths.textObjectsByLayer).forEach(textLayer => {
        const textLayerName = `📝 ${textLayer}`;

        if (!layerColors[textLayerName]) {
          layerColors[textLayerName] = new Set();
        }

        data.contentPaths.textObjectsByLayer[textLayer].forEach(textObj => {
          if (textObj.fillColor && Array.isArray(textObj.fillColor)) {
            const colorStr = rgbToHex(textObj.fillColor);
            layerColors[textLayerName].add(colorStr);
            layerColorSublayers.add(`${textLayerName}::${colorStr}`);
          }
        });
      });
    }

    if (layerColorSublayers.size === 0) {
      layerColorSublayers.add('All Paths::rgb(0,0,0)');
    }

    state.allLayers = Array.from(layerColorSublayers).sort();

    window.layerColorInfo = {};
    window.layerBaseNames = {};
    state.allLayers.forEach(sublayer => {
      const [baseName, colorStr] = sublayer.split('::');
      window.layerBaseNames[sublayer] = baseName;
      window.layerColorInfo[sublayer] = [colorStr];
    });

    state.allLayers.forEach(layer => {
      if (!isOverlayLayer(layer)) {
        state.enabledLayers.add(layer);
      }
    });
  }
}

// ============================================
// Layer Control Display
// ============================================

export function displayLayerControls() {
  const { layerControlsDiv, textLayerControlsDiv } = getElements();

  layerControlsDiv.innerHTML = '';
  textLayerControlsDiv.innerHTML = '';

  if (state.allLayers.length === 0) {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No layers found</div>';
    textLayerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No overlay layers found</div>';
    return;
  }

  const vectorLayers = state.allLayers.filter(l => !isOverlayLayer(l)).sort((a, b) => a.localeCompare(b));
  const overlayLayers = state.allLayers.filter(l => isOverlayLayer(l)).sort((a, b) => {
    const aIsText = a.startsWith('📝 ');
    const bIsText = b.startsWith('📝 ');
    if (aIsText && bIsText) {
      return a.substring(2).localeCompare(b.substring(2));
    }
    if (aIsText) return 1;
    if (bIsText) return -1;
    return a.localeCompare(b);
  });

  // Populate vector layers
  if (vectorLayers.length > 0) {
    vectorLayers.forEach(layerName => {
      const layerItem = createLayerControlItem(layerName);
      layerControlsDiv.appendChild(layerItem);
    });
  } else {
    layerControlsDiv.innerHTML = '<div style="color: #999; font-size: 0.9em;">No plottable layers found</div>';
  }

  // Populate overlay layers with groups
  if (overlayLayers.length > 0) {
    const getOverlayGroup = (layerName) => {
      const baseName = layerName.includes('::') ? layerName.split('::')[0] : layerName;
      for (const [groupName, patterns] of Object.entries(OVERLAY_GROUPS)) {
        if (patterns.some(p => baseName.toLowerCase().includes(p.toLowerCase()))) {
          return groupName;
        }
      }
      return 'Other';
    };

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

    const groupOrder = ['Map Elements', 'Projection and Grids', 'Structures', 'Other'];

    groupOrder.forEach(groupName => {
      const layers = groupedLayers[groupName];
      if (layers.length === 0) return;

      const groupContainer = document.createElement('div');
      groupContainer.className = 'overlay-group';
      groupContainer.style.cssText = 'margin-bottom: 12px;';

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

      const content = document.createElement('div');
      content.className = 'collapseable-content';
      content.style.cssText = 'padding-top: 4px;';

      layers.forEach(layerName => {
        const layerItem = createLayerControlItem(layerName);
        content.appendChild(layerItem);
      });

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

/**
 * Create a layer control item with checkbox, label, and color swatch
 */
export function createLayerControlItem(layerName) {
  const layerItem = document.createElement('div');
  layerItem.className = 'layer-item';
  layerItem.style.cssText = 'display: flex; align-items: center; gap: 8px; position: relative;';

  const [baseName, colorStr] = layerName.includes('::') ? layerName.split('::') : [layerName, null];

  // Calculate path count
  let pathCount = 0;
  if (window.layerPathCounts && window.layerPathCounts[layerName]) {
    pathCount = window.layerPathCounts[layerName];
  } else if (state.currentPDFData && state.currentPDFData.contentPaths) {
    // Fallback: filter paths (only used in legacy mode, not lightweight mode)
    const paths = state.currentPDFData.contentPaths.paths;
    const matchingPaths = paths.filter(p => {
      if (p.layer !== baseName) return false;
      if (!colorStr) return true;

      let pathColor = null;
      if (p.stroke && p.strokeColor) {
        pathColor = rgbToHex(p.strokeColor);
      } else if (p.fill && p.fillColor) {
        pathColor = rgbToHex(p.fillColor);
      }
      return pathColor === colorStr;
    });
    pathCount = matchingPaths.length;
  }

  // Path count badge
  const countBadge = document.createElement('span');
  countBadge.style.cssText = 'font-size: 0.75em; color: #777; font-weight: 600; min-width: 40px; text-align: right; flex-shrink: 0;';
  countBadge.textContent = pathCount > 0 ? pathCount.toLocaleString() : '0';
  layerItem.appendChild(countBadge);

  // Checkbox container
  const checkboxContainer = document.createElement('div');
  checkboxContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; flex: 1; min-width: 0;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
  checkbox.id = `layer-${safeId}`;
  checkbox.checked = state.enabledLayers.has(layerName);

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      state.enabledLayers.add(layerName);
    } else {
      state.enabledLayers.delete(layerName);
    }
    updateTabCounts();
    generateMapPreview();
    updateExportLayersList();
    updateStatsIndicator();
  });

  const label = document.createElement('label');
  label.className = 'checkbox-label';
  label.htmlFor = `layer-${safeId}`;
  label.style.cssText = 'flex: 1; min-width: 0; cursor: help;';

  const span = document.createElement('span');
  const displayName = getDescriptiveLayerName(baseName, colorStr);
  span.textContent = displayName;

  label.appendChild(checkbox);
  label.appendChild(span);
  checkboxContainer.appendChild(label);

  // Color swatches
  const colors = window.layerColorInfo?.[layerName] || [];
  if (colors.length > 0) {
    const swatchContainer = document.createElement('span');
    swatchContainer.style.cssText = 'display: inline-flex; gap: 2px; flex-shrink: 0; margin-left: 6px;';

    colors.slice(0, 3).forEach(color => {
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.style.background = color;
      swatch.dataset.color = color;
      swatch.dataset.layerName = layerName;

      swatch.addEventListener('mouseenter', () => showColorTooltip(swatch, color));
      swatch.addEventListener('mouseleave', () => hideColorTooltip());
      swatch.addEventListener('click', (e) => {
        e.stopPropagation();
        copyColorToClipboard(color, e);
      });
      swatch.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        showColorPicker(layerName, color, swatch, generateMapPreview);
      });

      swatchContainer.appendChild(swatch);
    });

    checkboxContainer.appendChild(swatchContainer);
  }

  // Expand button
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

// ============================================
// Layer Expansion
// ============================================

async function toggleLayerExpand(layerName, expandBtn, layerItem) {
  const isExpanded = expandBtn.dataset.expanded === 'true';

  if (isExpanded) {
    const detailsPanel = layerItem.querySelector('.layer-details-panel');
    if (detailsPanel) {
      detailsPanel.remove();
    }
    clearPathHighlight();
    expandBtn.dataset.expanded = 'false';
    expandBtn.title = 'Expand to see paths';
    expandBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="5" y1="2" x2="5" y2="8" stroke="#666" stroke-width="1.5"/>
      <line x1="2" y1="5" x2="8" y2="5" stroke="#666" stroke-width="1.5"/>
    </svg>`;
  } else {
    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'layer-details-panel';
    detailsPanel.style.cssText = 'margin-top: 6px; margin-left: 48px; padding: 8px; background: #f8f9ff; border-radius: 4px; border: 1px solid #e0e4ff; font-size: 0.75em; max-height: 200px; overflow-y: auto;';

    detailsPanel.innerHTML = '<div style="color: #666;">Loading paths...</div>';
    layerItem.appendChild(detailsPanel);

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

        const displayPaths = pathDetails.paths.slice(0, 100);
        displayPaths.forEach((path, idx) => {
          const opCount = path.operationCount || 0;
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

        detailsPanel.querySelectorAll('.path-item').forEach(item => {
          item.addEventListener('click', () => {
            const pathIndex = parseInt(item.dataset.pathIndex);
            highlightPath(layerName, pathIndex);
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
    expandBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="2" y1="5" x2="8" y2="5" stroke="#666" stroke-width="1.5"/>
    </svg>`;
  }
}

// ============================================
// Path Highlighting
// ============================================

function highlightPath(layerName, pathIndex) {
  const { mapPreviewDiv } = getElements();
  const svgContainer = mapPreviewDiv.querySelector('svg');
  if (!svgContainer) return;

  clearPathHighlight();

  window.electronAPI.getPathGeometry(layerName, pathIndex).then(geometry => {
    if (!geometry || !geometry.pathData) return;

    const highlightGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    highlightGroup.id = 'path-highlight';
    highlightGroup.setAttribute('class', 'highlight-overlay');

    const highlightPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    highlightPath.setAttribute('d', geometry.pathData);
    highlightPath.setAttribute('fill', 'none');
    highlightPath.setAttribute('stroke', '#ff0066');
    highlightPath.setAttribute('stroke-width', '4');
    highlightPath.setAttribute('stroke-linecap', 'round');
    highlightPath.style.animation = 'pulse-highlight 1s ease-in-out infinite';

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

export function clearPathHighlight() {
  const existing = document.getElementById('path-highlight');
  if (existing) existing.remove();
}

// ============================================
// Select All / Deselect All
// ============================================

export function selectAllLayers() {
  const vectorLayers = state.allLayers.filter(l => !isOverlayLayer(l));
  vectorLayers.forEach(layer => {
    state.enabledLayers.add(layer);
  });

  vectorLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = true;
  });

  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
  updateStatsIndicator();
}

export function deselectAllLayers() {
  const vectorLayers = state.allLayers.filter(l => !isOverlayLayer(l));
  vectorLayers.forEach(layer => {
    state.enabledLayers.delete(layer);
  });

  vectorLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = false;
  });

  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
  updateStatsIndicator();
}

export function selectAllTextLayers() {
  const overlayLayers = state.allLayers.filter(l => isOverlayLayer(l));
  overlayLayers.forEach(layer => {
    state.enabledLayers.add(layer);
  });

  overlayLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = true;
  });

  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
  updateStatsIndicator();
}

export function deselectAllTextLayers() {
  const overlayLayers = state.allLayers.filter(l => isOverlayLayer(l));
  overlayLayers.forEach(layer => {
    state.enabledLayers.delete(layer);
  });

  overlayLayers.forEach(layerName => {
    const safeId = layerName.replace(/[^a-zA-Z0-9-_]/g, '-');
    const checkbox = document.getElementById(`layer-${safeId}`);
    if (checkbox) checkbox.checked = false;
  });

  updateTabCounts();
  generateMapPreview();
  updateExportLayersList();
  updateStatsIndicator();
}
