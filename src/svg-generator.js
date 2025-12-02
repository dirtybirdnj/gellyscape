/**
 * Backend SVG Generator
 * Generates SVG from extracted PDF paths - runs in main process to avoid blocking renderer
 */

/**
 * Convert RGB array [r, g, b] to lowercase 6-character hex color (#rrggbb)
 * @param {number[]} rgb - Array of [r, g, b] values (0-255)
 * @returns {string} Lowercase hex color string
 */
function rgbToHex(rgb) {
  if (!rgb || rgb.length < 3) return '#000000';
  const [r, g, b] = rgb;
  return '#' + [r, g, b].map(v => {
    const hex = Math.round(Math.max(0, Math.min(255, v))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('').toLowerCase();
}

/**
 * Convert rgb() string to hex format
 * @param {string} rgbStr - "rgb(r,g,b)" format string
 * @returns {string} Lowercase hex color string
 */
function rgbStringToHex(rgbStr) {
  const match = rgbStr.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return rgbStr;
  return rgbToHex([parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]);
}

// Layer categorization - defines which layers are overlays/annotations vs plottable vector data
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
  'Unassigned'
];

// Specific color sublayers that should be treated as overlays (white shields)
// Using hex format for consistency
const OVERLAY_COLOR_SUBLAYERS = {
  'Hydrography': ['#ffffff'],
  'Road Features': ['#ffffff'],
  'Transportation': ['#ffffff'],
  'Terrain': ['#ffffff'],
  'Woodland': ['#ffffff']
};

/**
 * Check if a layer should be categorized as overlay
 * @param {string} layerName - Full layer name (may include ::color suffix)
 * @returns {boolean}
 */
function isOverlayLayer(layerName) {
  const [baseName, colorStr] = layerName.includes('::')
    ? layerName.split('::')
    : [layerName, null];

  // Check if this is an overlay color sublayer (white shields)
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

class SVGGenerator {
  constructor(paths, options = {}) {
    this.paths = paths || [];
    this.options = {
      padding: 10,
      whiteBackground: false,
      ...options
    };
    this.neatline = null; // Will be set if neatline bounds are available
    this.pageDimensions = null; // PDF page dimensions in points
  }

  /**
   * Set neatline bounds for UI visualization
   * @param {Object} neatline - { left, right, top, bottom, width, height }
   */
  setNeatline(neatline) {
    this.neatline = neatline;
  }

  /**
   * Set page dimensions from PDF metadata
   * @param {Object} dims - { widthPt, heightPt } from PDF page
   */
  setPageDimensions(dims) {
    this.pageDimensions = dims;
  }

  /**
   * Generate SVG string from paths
   * @param {Set|Array} enabledLayers - Layer names to include (as sublayer format: "LayerName::rgb(r,g,b)")
   * @param {Object} bounds - Optional pre-calculated bounds { minX, minY, maxX, maxY, width, height }
   * @param {Object} uiOptions - UI overlay options { showNeatline: bool, showDocBorder: bool }
   * @returns {Object} { svg: string, stats: { pathCount, layerCount } }
   */
  generate(enabledLayers, bounds = null, uiOptions = {}) {
    const { showNeatline = true, showDocBorder = true } = uiOptions;
    const enabledSet = enabledLayers instanceof Set ? enabledLayers : new Set(enabledLayers);

    console.log('SVGGenerator.generate called with', enabledSet.size, 'enabled layers');
    console.log('Total paths available:', this.paths.length);

    // Filter paths by enabled layers
    const filteredPaths = this.paths.filter(path => {
      // Use 'Unassigned' for paths without layer (matches renderer behavior)
      const layerName = path.layer || 'Unassigned';

      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = rgbToHex(path.strokeColor);
      } else if (path.fill && path.fillColor) {
        pathColor = rgbToHex(path.fillColor);
      }

      if (!pathColor) return false;

      const sublayerName = `${layerName}::${pathColor}`;
      return enabledSet.has(sublayerName);
    });

    console.log('Filtered paths count:', filteredPaths.length);

    // Log filtered paths bounds for debugging (not used for viewBox)
    const filteredBounds = this.calculateBounds(filteredPaths);
    console.log('Filtered paths bounds (debug only):', JSON.stringify(filteredBounds));

    if (filteredPaths.length === 0) {
      // Debug: show first few enabled layers and first few path layer names
      console.log('No paths matched! First 5 enabled layers:', Array.from(enabledSet).slice(0, 5));
      if (this.paths.length > 0) {
        const samplePath = this.paths[0];
        let sampleColor = null;
        if (samplePath.stroke && samplePath.strokeColor) {
          sampleColor = rgbToHex(samplePath.strokeColor);
        } else if (samplePath.fill && samplePath.fillColor) {
          sampleColor = rgbToHex(samplePath.fillColor);
        }
        console.log('Sample path layer:', samplePath.layer, 'color:', sampleColor);
        console.log('Sample sublayer would be:', `${samplePath.layer}::${sampleColor}`);

        // Return empty SVG with correct dimensions to maintain consistent view
        // Calculate bounds from ALL paths so the view doesn't jump when layers are re-enabled
        const allBounds = bounds || this.calculateBounds(this.paths);
        const padding = this.options.padding;
        const viewBoxX = allBounds.minX - padding;
        const viewBoxY = allBounds.minY - padding;
        const viewBoxWidth = allBounds.width + padding * 2;
        const viewBoxHeight = allBounds.height + padding * 2;

        let svgWidth, svgHeight;
        if (this.pageDimensions && this.pageDimensions.widthPt && this.pageDimensions.heightPt) {
          svgWidth = this.pageDimensions.widthPt;
          svgHeight = this.pageDimensions.heightPt;
        } else {
          svgWidth = allBounds.width;
          svgHeight = allBounds.height;
        }

        const viewBox = `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`;
        const emptySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(svgWidth)}pt" height="${Math.round(svgHeight)}pt" viewBox="${viewBox}">
  <text x="${allBounds.minX + allBounds.width/2}" y="${allBounds.minY + allBounds.height/2}" text-anchor="middle" fill="#999" font-size="${Math.max(allBounds.width, allBounds.height) * 0.02}">No layers selected</text>
</svg>`;

        return {
          svg: emptySvg,
          stats: { pathCount: 0, layerCount: 0 }
        };
      }

      // No paths at all - return minimal placeholder
      return {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><text x="200" y="150" text-anchor="middle" fill="#999">No paths to display</text></svg>',
        stats: { pathCount: 0, layerCount: 0 }
      };
    }

    // Calculate bounds from ALL paths (not just filtered) to maintain consistent view
    // This prevents the "zoom to selection" behavior when selecting small layers
    console.log('Calculating bounds from ALL paths. this.paths count:', this.paths.length);
    const allPathBounds = this.calculateBounds(this.paths);
    console.log('ALL paths bounds:', JSON.stringify(allPathBounds));
    console.log('Provided bounds param:', bounds ? JSON.stringify(bounds) : 'null');
    const pathBounds = bounds || allPathBounds;
    let { minX, minY, maxX, maxY, width, height } = pathBounds;
    console.log('Using bounds:', JSON.stringify({ minX, minY, maxX, maxY, width, height }));

    // Always use calculated path bounds for viewBox - the paths may be in
    // a different coordinate space than page dimensions (especially in GeoPDFs)
    const padding = this.options.padding;
    let viewBoxX = minX - padding;
    let viewBoxY = minY - padding;
    let viewBoxWidth = width + padding * 2;
    let viewBoxHeight = height + padding * 2;

    // Use page dimensions for SVG size (aspect ratio), but scale to fit path bounds
    let svgWidth, svgHeight;
    if (this.pageDimensions && this.pageDimensions.widthPt && this.pageDimensions.heightPt) {
      // Preserve page aspect ratio for SVG dimensions
      svgWidth = this.pageDimensions.widthPt;
      svgHeight = this.pageDimensions.heightPt;
      console.log('SVG size from page dimensions:', svgWidth, 'x', svgHeight);
    } else {
      svgWidth = width;
      svgHeight = height;
    }

    console.log('Using calculated bounds for viewBox:', viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight);
    console.log('Path bounds range: X[', minX, 'to', maxX, '] Y[', minY, 'to', maxY, ']');

    // Calculate stroke width scale factor for visibility
    // When coordinate space is much larger than page dimensions, strokes become invisible
    // Scale strokes to maintain visual weight in the preview
    let strokeScale = 1;
    if (this.pageDimensions && this.pageDimensions.widthPt) {
      // Compare viewBox size to page dimensions
      const viewBoxScale = Math.max(viewBoxWidth / this.pageDimensions.widthPt,
                                     viewBoxHeight / this.pageDimensions.heightPt);
      if (viewBoxScale > 2) {
        // Coordinate space is larger than page - scale up strokes
        strokeScale = viewBoxScale;
        console.log('Stroke scale factor:', strokeScale, '(viewBox is', viewBoxScale.toFixed(1), 'x larger than page)');
      }
    }

    const viewBox = `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`;

    // Build SVG
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(svgWidth)}pt" height="${Math.round(svgHeight)}pt" viewBox="${viewBox}">
`;

    // Add white background if requested
    if (this.options.whiteBackground) {
      svg += `  <rect x="${viewBoxX}" y="${viewBoxY}" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="white"/>\n`;
    }

    // Group paths by layer
    const pathsByLayer = this.groupPathsByLayer(filteredPaths);
    const layerNames = Object.keys(pathsByLayer);

    // Separate layers into vector and overlay categories
    const vectorLayers = layerNames.filter(name => !isOverlayLayer(name));
    const overlayLayers = layerNames.filter(name => isOverlayLayer(name));

    // Add title
    svg += `  <title>GeoPDF Export - ${layerNames.length} layers, ${filteredPaths.length} paths</title>\n`;

    // Helper function to render a layer's paths
    const renderLayerPaths = (layerName, indent = '    ') => {
      let layerSvg = '';
      const layerPaths = pathsByLayer[layerName];
      const safeId = layerName.replace(/[^a-zA-Z0-9]/g, '-');

      layerSvg += `${indent}<g id="layer-${safeId}" data-layer="${this.escapeXml(layerName)}">\n`;

      for (const path of layerPaths) {
        // Skip pure white fills
        if (path.fill && path.fillColor) {
          const [r, g, b] = path.fillColor;
          if (r === 255 && g === 255 && b === 255) continue;
        }

        const pathData = this.buildPathData(path.operations);
        if (!pathData) continue;

        const fill = path.fill ? rgbToHex(path.fillColor) : 'none';
        const stroke = path.stroke ? rgbToHex(path.strokeColor) : 'none';

        // Skip invisible paths (both fill and stroke are none)
        if (fill === 'none' && stroke === 'none') continue;

        // Scale stroke width to maintain visibility in large coordinate spaces
        const baseStrokeWidth = path.lineWidth !== undefined ? path.lineWidth : (path.strokeWidth || 1);
        const strokeWidth = baseStrokeWidth * strokeScale;

        layerSvg += `${indent}  <path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
      }

      layerSvg += `${indent}</g>\n`;
      return layerSvg;
    };

    // Render Vector_Data group (only if there are vector layers)
    if (vectorLayers.length > 0) {
      svg += `  <g id="Vector_Data">\n`;
      for (const layerName of vectorLayers) {
        svg += renderLayerPaths(layerName, '    ');
      }
      svg += `  </g>\n`;
    }

    // Render Overlay group (only if there are overlay layers)
    if (overlayLayers.length > 0) {
      svg += `  <g id="Overlay">\n`;
      for (const layerName of overlayLayers) {
        svg += renderLayerPaths(layerName, '    ');
      }
      svg += `  </g>\n`;
    }

    // Add UI overlay group (not for export)
    svg += `  <!-- UI Overlays - Preview Only, Not Exported -->\n`;
    svg += `  <g id="ui-overlays" data-ui-only="true" class="ui-overlay-group">\n`;

    // Scale UI stroke widths to match the coordinate space
    const uiStrokeWidth = 2 * strokeScale;
    const uiDashArray = `${8 * strokeScale},${4 * strokeScale}`;

    // Add document border (black) - uses path bounds which are in the correct space
    if (showDocBorder) {
      svg += `    <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="none" stroke="black" stroke-width="${uiStrokeWidth}" data-ui-element="document-border"/>\n`;
    }

    // Add neatline indicator (red, dashed)
    if (showNeatline && this.neatline) {
      // The neatline is in PDF page coordinates, but paths may be in a scaled coordinate space
      // We need to transform the neatline to match the path coordinate space
      // If strokeScale > 1, paths are in a larger space - scale up neatline too
      const neatX = this.neatline.left * strokeScale;
      const neatY = -this.neatline.top * strokeScale; // Convert to SVG Y (negative) and scale
      const neatWidth = this.neatline.width * strokeScale;
      const neatHeight = this.neatline.height * strokeScale;

      svg += `    <rect x="${neatX}" y="${neatY}" width="${neatWidth}" height="${neatHeight}" fill="none" stroke="red" stroke-width="${uiStrokeWidth}" stroke-dasharray="${uiDashArray}" data-ui-element="neatline"/>\n`;
    }

    svg += `  </g>\n`;

    svg += '</svg>';

    return {
      svg,
      stats: {
        pathCount: filteredPaths.length,
        layerCount: layerNames.length
      }
    };
  }

  /**
   * Calculate bounds from paths
   */
  calculateBounds(paths) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const path of paths) {
      if (!path.operations) continue;

      for (const op of path.operations) {
        if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
        if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        if (op.x1 !== undefined) { minX = Math.min(minX, op.x1); maxX = Math.max(maxX, op.x1); }
        if (op.y1 !== undefined) { minY = Math.min(minY, op.y1); maxY = Math.max(maxY, op.y1); }
        if (op.x2 !== undefined) { minX = Math.min(minX, op.x2); maxX = Math.max(maxX, op.x2); }
        if (op.y2 !== undefined) { minY = Math.min(minY, op.y2); maxY = Math.max(maxY, op.y2); }
        if (op.x3 !== undefined) { minX = Math.min(minX, op.x3); maxX = Math.max(maxX, op.x3); }
        if (op.y3 !== undefined) { minY = Math.min(minY, op.y3); maxY = Math.max(maxY, op.y3); }
      }
    }

    return {
      minX, minY, maxX, maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Group paths by sublayer name
   */
  groupPathsByLayer(paths) {
    const groups = {};

    for (const path of paths) {
      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = rgbToHex(path.strokeColor);
      } else if (path.fill && path.fillColor) {
        pathColor = rgbToHex(path.fillColor);
      }

      const sublayerName = `${path.layer}::${pathColor}`;
      if (!groups[sublayerName]) {
        groups[sublayerName] = [];
      }
      groups[sublayerName].push(path);
    }

    return groups;
  }

  /**
   * Build SVG path data string from operations
   */
  buildPathData(operations) {
    if (!operations || operations.length === 0) return null;

    const parts = [];
    for (const op of operations) {
      switch (op.type) {
        case 'moveto':
          parts.push(`M ${op.x} ${op.y}`);
          break;
        case 'lineto':
          parts.push(`L ${op.x} ${op.y}`);
          break;
        case 'curveto':
          parts.push(`C ${op.x1} ${op.y1} ${op.x2} ${op.y2} ${op.x3} ${op.y3}`);
          break;
        case 'rect':
          parts.push(`M ${op.x} ${op.y} L ${op.x + op.width} ${op.y} L ${op.x + op.width} ${op.y + op.height} L ${op.x} ${op.y + op.height} Z`);
          break;
        case 'closepath':
          parts.push('Z');
          break;
      }
    }

    return parts.join(' ');
  }

  /**
   * Escape XML special characters
   */
  escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Get available layers from paths (for UI)
   * Returns array of { name, color, pathCount }
   */
  getAvailableLayers() {
    const layerMap = new Map();

    for (const path of this.paths) {
      // Use 'Unassigned' for paths without layer (matches renderer behavior)
      const layerName = path.layer || 'Unassigned';

      let pathColor = null;
      let isStroke = false;
      let isFill = false;

      if (path.stroke && path.strokeColor) {
        pathColor = rgbToHex(path.strokeColor);
        isStroke = true;
      } else if (path.fill && path.fillColor) {
        pathColor = rgbToHex(path.fillColor);
        isFill = true;
      }

      if (!pathColor) continue;

      const sublayerName = `${layerName}::${pathColor}`;
      const existing = layerMap.get(sublayerName);

      if (existing) {
        existing.pathCount++;
        if (isStroke) existing.hasStroke = true;
        if (isFill) existing.hasFill = true;
      } else {
        layerMap.set(sublayerName, {
          name: sublayerName,
          baseLayer: layerName,
          color: pathColor,
          pathCount: 1,
          hasStroke: isStroke,
          hasFill: isFill
        });
      }
    }

    // Compute renderType for each layer
    const layers = Array.from(layerMap.values());
    for (const layer of layers) {
      if (layer.hasStroke && layer.hasFill) {
        layer.renderType = 'mixed';
      } else if (layer.hasStroke) {
        layer.renderType = 'stroke';
      } else {
        layer.renderType = 'fill';
      }
    }

    return layers;
  }

  /**
   * Get detailed debug info about all layers and the coordinate system
   * Used for Metadata tab debugging
   */
  getDebugInfo() {
    // Calculate overall bounds from ALL paths
    const allBounds = this.calculateBounds(this.paths);

    // Calculate bounds per layer
    const layerBounds = {};
    const layersByBase = {};

    for (const path of this.paths) {
      // Use 'Unassigned' for paths without layer (matches renderer behavior)
      const layerName = path.layer || 'Unassigned';

      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = rgbToHex(path.strokeColor);
      } else if (path.fill && path.fillColor) {
        pathColor = rgbToHex(path.fillColor);
      }
      if (!pathColor) continue;

      const sublayerName = `${layerName}::${pathColor}`;

      // Initialize layer bounds if not exists
      if (!layerBounds[sublayerName]) {
        layerBounds[sublayerName] = {
          minX: Infinity, minY: Infinity,
          maxX: -Infinity, maxY: -Infinity,
          pathCount: 0,
          baseLayer: layerName,
          color: pathColor
        };
      }

      // Group by base layer
      if (!layersByBase[layerName]) {
        layersByBase[layerName] = {
          sublayers: [],
          totalPaths: 0
        };
      }

      const lb = layerBounds[sublayerName];
      lb.pathCount++;

      // Update bounds from path operations
      if (path.operations) {
        for (const op of path.operations) {
          if (op.x !== undefined) { lb.minX = Math.min(lb.minX, op.x); lb.maxX = Math.max(lb.maxX, op.x); }
          if (op.y !== undefined) { lb.minY = Math.min(lb.minY, op.y); lb.maxY = Math.max(lb.maxY, op.y); }
          if (op.x1 !== undefined) { lb.minX = Math.min(lb.minX, op.x1); lb.maxX = Math.max(lb.maxX, op.x1); }
          if (op.y1 !== undefined) { lb.minY = Math.min(lb.minY, op.y1); lb.maxY = Math.max(lb.maxY, op.y1); }
          if (op.x2 !== undefined) { lb.minX = Math.min(lb.minX, op.x2); lb.maxX = Math.max(lb.maxX, op.x2); }
          if (op.y2 !== undefined) { lb.minY = Math.min(lb.minY, op.y2); lb.maxY = Math.max(lb.maxY, op.y2); }
          if (op.x3 !== undefined) { lb.minX = Math.min(lb.minX, op.x3); lb.maxX = Math.max(lb.maxX, op.x3); }
          if (op.y3 !== undefined) { lb.minY = Math.min(lb.minY, op.y3); lb.maxY = Math.max(lb.maxY, op.y3); }
        }
      }
    }

    // Finalize layer data
    const layersDetailed = [];
    for (const [name, bounds] of Object.entries(layerBounds)) {
      const width = bounds.maxX - bounds.minX;
      const height = bounds.maxY - bounds.minY;

      // Determine position relative to overall bounds
      const relativePosition = {
        left: ((bounds.minX - allBounds.minX) / allBounds.width * 100).toFixed(1),
        top: ((bounds.minY - allBounds.minY) / allBounds.height * 100).toFixed(1),
        right: ((allBounds.maxX - bounds.maxX) / allBounds.width * 100).toFixed(1),
        bottom: ((allBounds.maxY - bounds.maxY) / allBounds.height * 100).toFixed(1)
      };

      layersDetailed.push({
        name,
        baseLayer: bounds.baseLayer,
        color: bounds.color,
        pathCount: bounds.pathCount,
        bounds: {
          minX: bounds.minX.toFixed(2),
          minY: bounds.minY.toFixed(2),
          maxX: bounds.maxX.toFixed(2),
          maxY: bounds.maxY.toFixed(2),
          width: width.toFixed(2),
          height: height.toFixed(2)
        },
        relativePosition
      });

      // Add to base layer grouping
      if (layersByBase[bounds.baseLayer]) {
        layersByBase[bounds.baseLayer].sublayers.push(name);
        layersByBase[bounds.baseLayer].totalPaths += bounds.pathCount;
      }
    }

    // Sort by path count descending
    layersDetailed.sort((a, b) => b.pathCount - a.pathCount);

    return {
      totalPaths: this.paths.length,
      overallBounds: {
        minX: allBounds.minX.toFixed(2),
        minY: allBounds.minY.toFixed(2),
        maxX: allBounds.maxX.toFixed(2),
        maxY: allBounds.maxY.toFixed(2),
        width: allBounds.width.toFixed(2),
        height: allBounds.height.toFixed(2)
      },
      pageDimensions: this.pageDimensions,
      neatline: this.neatline,
      layerCount: Object.keys(layerBounds).length,
      baseLayerCount: Object.keys(layersByBase).length,
      layersByBase: Object.entries(layersByBase).map(([name, data]) => ({
        name,
        sublayerCount: data.sublayers.length,
        totalPaths: data.totalPaths
      })).sort((a, b) => b.totalPaths - a.totalPaths),
      layers: layersDetailed
    };
  }

  /**
   * Generate flat SVG optimized for pen plotters and downstream tools
   * - No nested groups (paths directly under svg root)
   * - ViewBox starts at 0,0 (coordinates translated)
   * - All paths have explicit fill/stroke attributes
   * - Uses lowercase hex colors (#rrggbb)
   * - No CSS classes or style blocks
   * - Optionally adds data-color attribute for metadata
   *
   * @param {Set|Array} enabledLayers - Layer names to include
   * @param {Object} options - Export options
   * @param {boolean} options.whiteBackground - Add white background rect
   * @param {boolean} options.includeMetadata - Add data-* attributes to paths
   * @returns {Object} { svg: string, stats: { pathCount, layerCount } }
   */
  generateFlat(enabledLayers, options = {}) {
    const { whiteBackground = false, includeMetadata = false } = options;
    const enabledSet = enabledLayers instanceof Set ? enabledLayers : new Set(enabledLayers);

    console.log('SVGGenerator.generateFlat called with', enabledSet.size, 'enabled layers');

    // Filter paths by enabled layers
    const filteredPaths = this.paths.filter(path => {
      const layerName = path.layer || 'Unassigned';

      let pathColor = null;
      if (path.stroke && path.strokeColor) {
        pathColor = rgbToHex(path.strokeColor);
      } else if (path.fill && path.fillColor) {
        pathColor = rgbToHex(path.fillColor);
      }

      if (!pathColor) return false;

      const sublayerName = `${layerName}::${pathColor}`;
      return enabledSet.has(sublayerName);
    });

    console.log('Flat export: filtered paths count:', filteredPaths.length);

    if (filteredPaths.length === 0) {
      return {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"></svg>',
        stats: { pathCount: 0, layerCount: 0 }
      };
    }

    // Calculate bounds for coordinate translation
    const bounds = this.calculateBounds(filteredPaths);
    const width = bounds.width;
    const height = bounds.height;
    const offsetX = bounds.minX;
    const offsetY = bounds.minY;

    // ViewBox at 0,0 origin
    const viewBox = `0 0 ${width} ${height}`;

    // Build SVG with flat structure
    let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="${viewBox}">
`;

    // Add white background if requested
    if (whiteBackground) {
      svg += `  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>\n`;
    }

    // Track unique layers for stats
    const uniqueLayers = new Set();
    let pathCount = 0;

    // Output all paths directly under svg root (no groups)
    for (const path of filteredPaths) {
      // Skip pure white fills
      if (path.fill && path.fillColor) {
        const [r, g, b] = path.fillColor;
        if (r === 255 && g === 255 && b === 255) continue;
      }

      // Build path data with translated coordinates
      const pathData = this.buildPathDataTranslated(path.operations, offsetX, offsetY);
      if (!pathData) continue;

      const fill = path.fill ? rgbToHex(path.fillColor) : 'none';
      const stroke = path.stroke ? rgbToHex(path.strokeColor) : 'none';

      // Skip invisible paths
      if (fill === 'none' && stroke === 'none') continue;

      const strokeWidth = path.lineWidth !== undefined ? path.lineWidth : (path.strokeWidth || 1);

      // Build path element
      let pathEl = `  <path d="${pathData}" fill="${fill}" stroke="${stroke}"`;
      if (stroke !== 'none') {
        pathEl += ` stroke-width="${strokeWidth}"`;
      }

      // Add metadata if requested
      if (includeMetadata) {
        const primaryColor = fill !== 'none' ? fill : stroke;
        const layer = path.layer || 'Unassigned';
        pathEl += ` data-color="${primaryColor}" data-layer="${this.escapeXml(layer)}"`;
      }

      pathEl += '/>\n';
      svg += pathEl;

      pathCount++;
      uniqueLayers.add(`${path.layer}::${fill !== 'none' ? fill : stroke}`);
    }

    svg += '</svg>';

    return {
      svg,
      stats: {
        pathCount,
        layerCount: uniqueLayers.size
      }
    };
  }

  /**
   * Build SVG path data string with coordinate translation
   * Translates all coordinates so viewBox can start at 0,0
   * @param {Array} operations - Path operations
   * @param {number} offsetX - X offset to subtract
   * @param {number} offsetY - Y offset to subtract
   * @returns {string} Path data string
   */
  buildPathDataTranslated(operations, offsetX, offsetY) {
    if (!operations || operations.length === 0) return null;

    const parts = [];
    for (const op of operations) {
      switch (op.type) {
        case 'moveto':
          parts.push(`M ${op.x - offsetX} ${op.y - offsetY}`);
          break;
        case 'lineto':
          parts.push(`L ${op.x - offsetX} ${op.y - offsetY}`);
          break;
        case 'curveto':
          parts.push(`C ${op.x1 - offsetX} ${op.y1 - offsetY} ${op.x2 - offsetX} ${op.y2 - offsetY} ${op.x3 - offsetX} ${op.y3 - offsetY}`);
          break;
        case 'rect':
          const x = op.x - offsetX;
          const y = op.y - offsetY;
          parts.push(`M ${x} ${y} L ${x + op.width} ${y} L ${x + op.width} ${y + op.height} L ${x} ${y + op.height} Z`);
          break;
        case 'closepath':
          parts.push('Z');
          break;
      }
    }

    return parts.join(' ');
  }
}

module.exports = SVGGenerator;
