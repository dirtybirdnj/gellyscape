/**
 * Backend SVG Generator
 * Generates SVG from extracted PDF paths - runs in main process to avoid blocking renderer
 */

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
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
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
          sampleColor = `rgb(${samplePath.strokeColor.join(',')})`;
        } else if (samplePath.fill && samplePath.fillColor) {
          sampleColor = `rgb(${samplePath.fillColor.join(',')})`;
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

    // Add title
    svg += `  <title>GeoPDF Export - ${layerNames.length} layers, ${filteredPaths.length} paths</title>\n`;

    // Render each layer group
    for (const layerName of layerNames) {
      const layerPaths = pathsByLayer[layerName];
      const safeId = layerName.replace(/[^a-zA-Z0-9]/g, '-');

      svg += `  <g id="layer-${safeId}" data-layer="${this.escapeXml(layerName)}">\n`;

      for (const path of layerPaths) {
        // Skip pure white fills
        if (path.fill && path.fillColor) {
          const [r, g, b] = path.fillColor;
          if (r === 255 && g === 255 && b === 255) continue;
        }

        const pathData = this.buildPathData(path.operations);
        if (!pathData) continue;

        const fill = path.fill ? `rgb(${path.fillColor.join(',')})` : 'none';
        const stroke = path.stroke ? `rgb(${path.strokeColor.join(',')})` : 'none';
        // Scale stroke width to maintain visibility in large coordinate spaces
        const baseStrokeWidth = path.lineWidth !== undefined ? path.lineWidth : (path.strokeWidth || 1);
        const strokeWidth = baseStrokeWidth * strokeScale;

        svg += `    <path d="${pathData}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>\n`;
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
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
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
      if (path.stroke && path.strokeColor) {
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
      }

      if (!pathColor) continue;

      const sublayerName = `${layerName}::${pathColor}`;
      const existing = layerMap.get(sublayerName);

      if (existing) {
        existing.pathCount++;
      } else {
        layerMap.set(sublayerName, {
          name: sublayerName,
          baseLayer: layerName,
          color: pathColor,
          pathCount: 1
        });
      }
    }

    return Array.from(layerMap.values());
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
        pathColor = `rgb(${path.strokeColor.join(',')})`;
      } else if (path.fill && path.fillColor) {
        pathColor = `rgb(${path.fillColor.join(',')})`;
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
}

module.exports = SVGGenerator;
