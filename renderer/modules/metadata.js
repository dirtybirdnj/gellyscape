/**
 * Metadata Module
 *
 * Handles metadata display including:
 * - Document information
 * - Map classification
 * - Page dimensions
 * - Coordinate system info
 * - Vector debug panel
 */

import { state } from './state.js';
import { getElements } from './dom-elements.js';
import { formatDate } from './ui-helpers.js';

// ============================================
// Metadata Display
// ============================================

export async function displayMetadata(metadata, info, data) {
  const { metadataDiv } = getElements();
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
  if (data && state.allLayers && state.allLayers.length > 0) {
    const layerSection = createSection('Layer Information');
    layerSection.appendChild(createItem('Total Layers', state.allLayers.length.toString()));

    // Count layer types
    const vectorLayers = state.allLayers.filter(l => !l.startsWith('📝 ')).length;
    const textLayers = state.allLayers.filter(l => l.startsWith('📝 ')).length;

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

      state.allLayers.slice(0, 20).forEach(name => {
        const layerItem = document.createElement('div');
        layerItem.textContent = `• ${name}`;
        layerItem.style.cssText = 'padding: 2px 0;';
        layerNamesList.appendChild(layerItem);
      });

      if (state.allLayers.length > 20) {
        const moreItem = document.createElement('div');
        moreItem.textContent = `... and ${state.allLayers.length - 20} more`;
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

// ============================================
// Vector Debug Panel
// ============================================

/**
 * Populate Vector Debug Panel (right side when Metadata tab active)
 */
export async function populateVectorDebugPanel() {
  const content = document.getElementById('vectorDebugContent');
  if (!content) return;

  if (!state.currentPDFData) {
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
