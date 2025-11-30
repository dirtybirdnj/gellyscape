/**
 * Map Preview Module
 *
 * Handles map rendering and preview including:
 * - Canvas-based preview rendering
 * - SVG generation
 * - Zoom and pan controls
 * - Lightweight backend preview
 */

import { state, USE_CANVAS_PREVIEW, isOverlayLayer } from './state.js';
import { getElements } from './dom-elements.js';
import { showLoadingGear, hideLoadingGear } from './ui-helpers.js';
import { updateMapStats, updateExportLayersList } from './stats.js';

// ============================================
// Main Preview Generation
// ============================================

export function generateMapPreview() {
  // Check if we're in lightweight mode
  if (state.currentPDFData && !state.currentPDFData.contentPaths && state.currentPDFData.layerInfo) {
    showLightweightPreview();
    updateExportLayersList();
    return;
  }

  const { mapPreviewDiv } = getElements();

  if (!state.currentPDFData || !state.currentPDFData.contentPaths) {
    mapPreviewDiv.innerHTML = '<div style="color: #999;">No map data available</div>';
    return;
  }

  if (USE_CANVAS_PREVIEW) {
    renderCanvasPreview();
  } else {
    const svg = generateSVG(false);
    mapPreviewDiv.innerHTML = svg;
  }

  if (state.currentZoom === 1.0 && state.panX === 0 && state.panY === 0) {
    state.currentZoom = 1.0;
  }

  updateZoomDisplay();
  updateMapStats();
  updateExportLayersList();
}

// ============================================
// Lightweight Backend Preview
// ============================================

export async function showLightweightPreview() {
  const { mapPreviewDiv } = getElements();

  showLoadingGear();

  try {
    const layersArray = Array.from(state.enabledLayers);
    const result = await window.electronAPI.generateSVG({
      enabledLayers: layersArray,
      bounds: null,
      options: { whiteBackground: false }
    });

    if (result.success && result.svg) {
      let previewSvg = result.svg;

      const containerWidth = mapPreviewDiv.clientWidth || 800;
      const containerHeight = mapPreviewDiv.clientHeight || 600;

      const widthMatch = previewSvg.match(/width="(\d+)pt"/);
      const heightMatch = previewSvg.match(/height="(\d+)pt"/);
      const origWidth = widthMatch ? parseInt(widthMatch[1]) : 1728;
      const origHeight = heightMatch ? parseInt(heightMatch[1]) : 2088;

      const scaleX = containerWidth / origWidth;
      const scaleY = containerHeight / origHeight;
      const scale = Math.min(scaleX, scaleY) * 0.95;

      const displayWidth = Math.round(origWidth * scale);
      const displayHeight = Math.round(origHeight * scale);

      previewSvg = previewSvg.replace(/width="[^"]*pt"/, `width="${displayWidth}"`);
      previewSvg = previewSvg.replace(/height="[^"]*pt"/, `height="${displayHeight}"`);
      previewSvg = previewSvg.replace(/<svg ([^>]*)>/, '<svg $1 preserveAspectRatio="xMidYMid meet" style="display: block; margin: auto;">');

      mapPreviewDiv.innerHTML = previewSvg;

      updateZoomDisplay();
      updateMapStats(`${result.stats.pathCount.toLocaleString()} paths in ${result.stats.layerCount} layers`);
    } else {
      showEmptyPreview();
    }
  } catch (error) {
    console.error('Preview generation error:', error);
    mapPreviewDiv.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #dc3545;">
        <div style="font-size: 2em; margin-bottom: 12px;">Error</div>
        <div>Preview generation failed</div>
        <div style="font-size: 0.85em; margin-top: 8px;">${error.message}</div>
      </div>
    `;
  } finally {
    hideLoadingGear();
  }
}

function showEmptyPreview() {
  const { mapPreviewDiv } = getElements();
  const containerWidth = mapPreviewDiv.clientWidth || 800;
  const containerHeight = mapPreviewDiv.clientHeight || 600;
  const bounds = state.cachedBounds || { minX: 0, minY: 0, width: 1728, height: 2088 };
  const { minX, minY, width, height } = bounds;

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
      <rect x="${minX}" y="${minY}" width="${width}" height="${height}"
            fill="none" stroke="#000000" stroke-width="2"/>
      <rect x="${minX + inset}" y="${minY + inset}" width="${width - inset * 2}" height="${height - inset * 2}"
            fill="none" stroke="#ff0000" stroke-width="1.5" stroke-dasharray="8,4"/>
    </svg>
  `;
  updateMapStats('No layers selected');
}

// ============================================
// Canvas Preview Rendering
// ============================================

export function renderCanvasPreview() {
  const { mapPreviewDiv } = getElements();

  console.time('Render:Total');
  console.time('Render:FilterPaths');

  const paths = state.currentPDFData.contentPaths.paths;

  const filteredPaths = paths.filter(path => {
    const layerName = path.layer || 'Unassigned';

    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    if (!pathColor) return false;

    const sublayerName = `${layerName}::${pathColor}`;
    return state.enabledLayers.has(sublayerName);
  });

  console.timeEnd('Render:FilterPaths');
  console.time('Render:CalcBounds');

  let minX, minY, maxX, maxY, width, height;

  if (state.cachedBounds) {
    ({ minX, minY, maxX, maxY, width, height } = state.cachedBounds);
  } else {
    const pageInfo = state.currentPDFData.metadata?.pages?.[0];

    if (pageInfo && pageInfo.width && pageInfo.height) {
      width = pageInfo.width;
      height = pageInfo.height;
      minX = 0;
      maxX = width;
      minY = -height;
      maxY = 0;
    } else {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

      paths.forEach(path => {
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
    }

    state.cachedBounds = { minX, minY, maxX, maxY, width, height };
  }

  const padding = 20;
  const containerRect = mapPreviewDiv.getBoundingClientRect();
  const containerWidth = containerRect.width || 800;
  const containerHeight = containerRect.height || 600;
  const dpr = window.devicePixelRatio || 1;

  const scaleX = containerWidth / (width + padding * 2);
  const scaleY = containerHeight / (height + padding * 2);
  const scale = Math.min(scaleX, scaleY);

  const canvas = document.createElement('canvas');
  canvas.width = containerWidth * dpr;
  canvas.height = containerHeight * dpr;
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(dpr, dpr);

  ctx.fillStyle = state.bgColorEnabled ? state.bgColorValue : '#ffffff';
  ctx.fillRect(0, 0, containerWidth, containerHeight);

  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  console.timeEnd('Render:CalcBounds');

  if (filteredPaths.length === 0) {
    ctx.translate(containerWidth / 2, containerHeight / 2);
    ctx.scale(scale, -scale);
    ctx.translate(-centerX, -centerY);

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([]);
    ctx.strokeRect(minX, minY, width, height);

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

  ctx.translate(containerWidth / 2, containerHeight / 2);
  ctx.scale(scale, -scale);
  ctx.translate(-centerX, -centerY);

  console.time('Render:GroupPaths');
  const pathsByColor = {};
  filteredPaths.forEach(path => {
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
      ctx.lineWidth = group.lineWidth / scale;
      ctx.stroke();
    } else {
      ctx.fillStyle = group.color;
      ctx.fill();
    }
  });

  console.timeEnd('Render:DrawPaths');

  const renderTime = performance.now() - startTime;
  console.log(`Canvas render: ${filteredPaths.length} paths in ${renderTime.toFixed(1)}ms`);

  mapPreviewDiv.innerHTML = '';
  mapPreviewDiv.appendChild(canvas);

  console.timeEnd('Render:Total');
}

// ============================================
// SVG Generation
// ============================================

export function generateSVG(isExport) {
  const paths = state.currentPDFData.contentPaths.paths;

  let filteredPaths = paths.filter(path => {
    const layerName = path.layer || 'Unassigned';

    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = `rgb(${path.strokeColor.join(',')})`;
    } else if (path.fill && path.fillColor) {
      pathColor = `rgb(${path.fillColor.join(',')})`;
    }

    if (!pathColor) return false;

    const sublayerName = `${layerName}::${pathColor}`;
    return state.enabledLayers.has(sublayerName);
  });

  if (filteredPaths.length === 0) {
    if (state.cachedBounds) {
      const { minX, minY, width, height } = state.cachedBounds;
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

  let minX, minY, maxX, maxY, width, height;

  if (state.cachedBounds) {
    ({ minX, minY, maxX, maxY, width, height } = state.cachedBounds);
  } else {
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;

    filteredPaths.forEach(path => {
      if (path.operations) {
        path.operations.forEach(op => {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        });
      }
    });

    width = maxX - minX;
    height = maxY - minY;
    state.cachedBounds = { minX, minY, maxX, maxY, width, height };
  }

  const padding = 10;
  const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

  let widthAttr = isExport
    ? `width="${Math.round(width)}pt" height="${Math.round(height)}pt"`
    : 'width="100%" height="100%"';

  const { whiteBackgroundCheck } = getElements();

  let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" ${widthAttr} viewBox="${viewBox}">
`;

  if (isExport && whiteBackgroundCheck?.checked) {
    svg += `  <rect x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="white"/>\n`;
  }

  if (!isExport && state.bgColorEnabled) {
    svg += `  <rect id="temp-background" x="${minX - padding}" y="${minY - padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${state.bgColorValue}"/>\n`;
  }

  svg += `  <title>GeoPDF Export - ${state.enabledLayers.size} layers</title>\n`;

  const pathsByLayer = {};
  filteredPaths.forEach(path => {
    const layerName = path.layer || 'Unassigned';

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

  const vectorLayersToRender = [];
  const overlayLayersToRender = [];

  state.allLayers.slice().reverse().forEach(layer => {
    if (pathsByLayer[layer]) {
      if (isOverlayLayer(layer)) {
        overlayLayersToRender.push(layer);
      } else {
        vectorLayersToRender.push(layer);
      }
    }
  });

  const layersToRender = [...vectorLayersToRender, ...overlayLayersToRender];

  layersToRender.forEach(layerName => {
    svg += `  <g id="layer-${layerName.replace(/[^a-zA-Z0-9]/g, '-')}" data-layer="${layerName}">\n`;

    pathsByLayer[layerName].forEach(path => {
      if (path.fill && path.fillColor) {
        const [r, g, b] = path.fillColor;
        if (r === 255 && g === 255 && b === 255) {
          return;
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
      const strokeWidth = path.lineWidth !== undefined ? path.lineWidth : (path.strokeWidth || 1);

      svg += `    <path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
    });

    svg += `  </g>\n`;
  });

  svg += '</svg>';
  return svg;
}

// ============================================
// Zoom and Pan Controls
// ============================================

export function adjustZoom(delta) {
  state.currentZoom = Math.max(0.1, Math.min(5.0, state.currentZoom + delta));
  updateZoomDisplay();
}

export function resetZoom() {
  state.currentZoom = 1.0;
  state.panX = 0;
  state.panY = 0;
  updateZoomDisplay();
}

export function updateZoomDisplay() {
  const { zoomLevelSpan, mapPreviewDiv } = getElements();

  zoomLevelSpan.textContent = `${Math.round(state.currentZoom * 100)}%`;

  const svg = mapPreviewDiv.querySelector('svg');
  const canvas = mapPreviewDiv.querySelector('canvas');
  const element = svg || canvas;

  if (element) {
    element.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.currentZoom})`;
    element.style.transformOrigin = 'center center';
  }
}

export function startPan(e) {
  state.isPanning = true;
  state.startPanX = e.clientX - state.panX;
  state.startPanY = e.clientY - state.panY;
  const { mapPreviewDiv } = getElements();
  mapPreviewDiv.classList.add('panning');
}

export function doPan(e) {
  if (!state.isPanning) return;

  state.panX = e.clientX - state.startPanX;
  state.panY = e.clientY - state.startPanY;
  updateZoomDisplay();
}

export function endPan() {
  state.isPanning = false;
  const { mapPreviewDiv } = getElements();
  mapPreviewDiv.classList.remove('panning');
}

export function handleWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  adjustZoom(delta);
}

// Make startPan available globally for tab switching
window.startPan = startPan;
