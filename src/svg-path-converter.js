/**
 * SVG Path Converter
 * Converts PDF paths to SVG path elements with proper coordinate transformation
 * Handles PDF → SVG coordinate space conversion and path syntax
 */

class SVGPathConverter {
  constructor(options = {}) {
    this.options = {
      // PDF page bounds (default letter size in points: 612x792)
      pdfWidth: options.pdfWidth || 612,
      pdfHeight: options.pdfHeight || 792,

      // Target SVG dimensions
      svgWidth: options.svgWidth || 612,
      svgHeight: options.svgHeight || 792,

      // Crop region (optional)
      cropBox: options.cropBox || null, // { x, y, width, height }

      // Precision for coordinates (decimal places)
      precision: options.precision !== undefined ? options.precision : 3,

      // Flip Y axis (PDF is bottom-left origin, SVG is top-left)
      flipY: options.flipY !== undefined ? options.flipY : true,

      // Apply transformation matrix
      applyTransform: options.applyTransform !== undefined ? options.applyTransform : true
    };

    // Calculate scale factors
    this.calculateScaleFactors();
  }

  calculateScaleFactors() {
    // Determine effective PDF dimensions after cropping
    const effectivePdfWidth = this.options.cropBox ? this.options.cropBox.width : this.options.pdfWidth;
    const effectivePdfHeight = this.options.cropBox ? this.options.cropBox.height : this.options.pdfHeight;

    // Calculate scale to fit SVG dimensions
    this.scaleX = this.options.svgWidth / effectivePdfWidth;
    this.scaleY = this.options.svgHeight / effectivePdfHeight;

    // Offset for crop region
    this.offsetX = this.options.cropBox ? this.options.cropBox.x : 0;
    this.offsetY = this.options.cropBox ? this.options.cropBox.y : 0;
  }

  /**
   * Convert a single path to SVG path element
   * @param {Object} path - Path object from PDF parser
   * @returns {Object} SVG path element data
   */
  convertPath(path) {
    if (!path || !path.subpaths || path.subpaths.length === 0) {
      return null;
    }

    // Build SVG path data string
    const pathData = this.buildPathData(path.subpaths, path.transform);

    // Build style object
    const style = this.buildStyle(path.style, path.operation);

    return {
      d: pathData,
      style,
      operation: path.operation,
      originalPath: path
    };
  }

  /**
   * Convert multiple paths to SVG path elements
   * @param {Array} paths - Array of path objects
   * @returns {Array} Array of SVG path elements
   */
  convertPaths(paths) {
    return paths
      .map(path => this.convertPath(path))
      .filter(path => path !== null);
  }

  /**
   * Build SVG path data string from subpaths
   * @param {Array} subpaths - Array of subpath objects
   * @param {Object} transform - Transformation matrix
   * @returns {string} SVG path data string
   */
  buildPathData(subpaths, transform) {
    const parts = [];

    for (const subpath of subpaths) {
      if (!subpath.startPoint) continue;

      // Transform and add moveto for start point
      const start = this.transformPoint(subpath.startPoint, transform);
      parts.push(`M ${this.formatCoord(start.x)} ${this.formatCoord(start.y)}`);

      // Process each segment
      for (const segment of subpath.segments) {
        const segmentData = this.convertSegment(segment, transform);
        if (segmentData) {
          parts.push(segmentData);
        }
      }

      // Close path if needed
      if (subpath.closed) {
        parts.push('Z');
      }
    }

    return parts.join(' ');
  }

  /**
   * Convert a single path segment to SVG syntax
   * @param {Object} segment - Path segment object
   * @param {Object} transform - Transformation matrix
   * @returns {string} SVG path segment string
   */
  convertSegment(segment, transform) {
    switch (segment.type) {
      case 'line':
        return this.convertLine(segment, transform);

      case 'cubic':
        return this.convertCubic(segment, transform);

      case 'quadratic':
        return this.convertQuadratic(segment, transform);

      default:
        console.warn('Unknown segment type:', segment.type);
        return null;
    }
  }

  /**
   * Convert line segment to SVG
   * @param {Object} segment - Line segment
   * @param {Object} transform - Transformation matrix
   * @returns {string} SVG lineto command
   */
  convertLine(segment, transform) {
    const point = this.transformPoint(segment.point, transform);
    return `L ${this.formatCoord(point.x)} ${this.formatCoord(point.y)}`;
  }

  /**
   * Convert cubic Bezier curve to SVG
   * @param {Object} segment - Cubic segment
   * @param {Object} transform - Transformation matrix
   * @returns {string} SVG curveto command
   */
  convertCubic(segment, transform) {
    const cp1 = this.transformPoint(segment.cp1, transform);
    const cp2 = this.transformPoint(segment.cp2, transform);
    const point = this.transformPoint(segment.point, transform);

    return `C ${this.formatCoord(cp1.x)} ${this.formatCoord(cp1.y)} ` +
           `${this.formatCoord(cp2.x)} ${this.formatCoord(cp2.y)} ` +
           `${this.formatCoord(point.x)} ${this.formatCoord(point.y)}`;
  }

  /**
   * Convert quadratic Bezier curve to SVG
   * @param {Object} segment - Quadratic segment
   * @param {Object} transform - Transformation matrix
   * @returns {string} SVG quadratic curveto command
   */
  convertQuadratic(segment, transform) {
    const cp = this.transformPoint(segment.cp, transform);
    const point = this.transformPoint(segment.point, transform);

    return `Q ${this.formatCoord(cp.x)} ${this.formatCoord(cp.y)} ` +
           `${this.formatCoord(point.x)} ${this.formatCoord(point.y)}`;
  }

  /**
   * Transform a point from PDF to SVG coordinate space
   * @param {Object} point - Point {x, y}
   * @param {Object} transform - PDF transformation matrix (optional)
   * @returns {Object} Transformed point
   */
  transformPoint(point, transform) {
    let x = point.x;
    let y = point.y;

    // Apply PDF transformation matrix if provided and enabled
    if (this.options.applyTransform && transform) {
      const tx = transform.a * x + transform.c * y + transform.e;
      const ty = transform.b * x + transform.d * y + transform.f;
      x = tx;
      y = ty;
    }

    // Apply crop offset
    x -= this.offsetX;
    y -= this.offsetY;

    // Flip Y axis (PDF origin is bottom-left, SVG is top-left)
    if (this.options.flipY) {
      const effectiveHeight = this.options.cropBox ?
        this.options.cropBox.height : this.options.pdfHeight;
      y = effectiveHeight - y;
    }

    // Apply scale
    x *= this.scaleX;
    y *= this.scaleY;

    return { x, y };
  }

  /**
   * Build SVG style object from path style
   * @param {Object} style - Path style object
   * @param {string} operation - Path operation (stroke, fill, fill-stroke)
   * @returns {Object} SVG style attributes
   */
  buildStyle(style, operation) {
    const svgStyle = {};

    // Handle fill
    if (operation === 'fill' || operation === 'fill-stroke') {
      svgStyle.fill = style.fill || '#000000';
      if (style.fillOpacity !== undefined) {
        svgStyle.fillOpacity = style.fillOpacity;
      }
      if (style.fillRule) {
        svgStyle.fillRule = style.fillRule;
      }
    } else {
      svgStyle.fill = 'none';
    }

    // Handle stroke
    if (operation === 'stroke' || operation === 'fill-stroke') {
      svgStyle.stroke = style.stroke || '#000000';

      if (style.strokeWidth !== undefined) {
        // Scale stroke width
        svgStyle.strokeWidth = style.strokeWidth * Math.min(this.scaleX, this.scaleY);
      }

      if (style.strokeLinecap) {
        svgStyle.strokeLinecap = style.strokeLinecap;
      }

      if (style.strokeLinejoin) {
        svgStyle.strokeLinejoin = style.strokeLinejoin;
      }

      if (style.strokeDasharray) {
        svgStyle.strokeDasharray = style.strokeDasharray;
      }
    }

    return svgStyle;
  }

  /**
   * Format coordinate to specified precision
   * @param {number} coord - Coordinate value
   * @returns {string} Formatted coordinate
   */
  formatCoord(coord) {
    return coord.toFixed(this.options.precision);
  }

  /**
   * Escape special XML characters in attribute values
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeXML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Convert style object to SVG attribute string
   * @param {Object} style - Style object
   * @returns {string} SVG attributes string
   */
  styleToAttributes(style) {
    const attrs = [];

    if (style.fill !== undefined && style.fill !== null) {
      attrs.push(`fill="${this.escapeXML(style.fill)}"`);
    }
    if (style.fillOpacity !== undefined && style.fillOpacity !== null) {
      attrs.push(`fill-opacity="${this.escapeXML(style.fillOpacity)}"`);
    }
    if (style.fillRule !== undefined && style.fillRule !== null) {
      attrs.push(`fill-rule="${this.escapeXML(style.fillRule)}"`);
    }
    if (style.stroke !== undefined && style.stroke !== null) {
      attrs.push(`stroke="${this.escapeXML(style.stroke)}"`);
    }
    if (style.strokeWidth !== undefined && style.strokeWidth !== null) {
      attrs.push(`stroke-width="${this.escapeXML(style.strokeWidth)}"`);
    }
    if (style.strokeLinecap !== undefined && style.strokeLinecap !== null) {
      attrs.push(`stroke-linecap="${this.escapeXML(style.strokeLinecap)}"`);
    }
    if (style.strokeLinejoin !== undefined && style.strokeLinejoin !== null) {
      attrs.push(`stroke-linejoin="${this.escapeXML(style.strokeLinejoin)}"`);
    }
    if (style.strokeDasharray !== undefined && style.strokeDasharray !== null) {
      attrs.push(`stroke-dasharray="${this.escapeXML(style.strokeDasharray)}"`);
    }

    return attrs.join(' ');
  }

  /**
   * Generate complete SVG path element string
   * @param {Object} svgPath - SVG path object from convertPath()
   * @param {Object} options - Additional options
   * @returns {string} SVG path element string
   */
  generatePathElement(svgPath, options = {}) {
    const id = options.id ? ` id="${this.escapeXML(options.id)}"` : '';
    const className = options.className ? ` class="${this.escapeXML(options.className)}"` : '';
    const attributes = this.styleToAttributes(svgPath.style);
    const pathData = this.escapeXML(svgPath.d);

    // Ensure proper spacing between attributes
    const attrStr = attributes ? ` ${attributes}` : '';

    return `<path${id}${className} d="${pathData}"${attrStr}/>`;
  }

  /**
   * Update converter options (useful for changing dimensions/crop)
   * @param {Object} newOptions - New options to merge
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    this.calculateScaleFactors();
  }

  /**
   * Get current bounds (useful for auto-detecting content area)
   * @param {Array} paths - Array of path objects
   * @returns {Object} Bounding box {x, y, width, height}
   */
  calculateBounds(paths) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const path of paths) {
      for (const subpath of path.subpaths || []) {
        // Check start point
        if (subpath.startPoint) {
          const p = subpath.startPoint;
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }

        // Check segment points
        for (const segment of subpath.segments || []) {
          if (segment.point) {
            const p = segment.point;
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }

          // Check control points for curves
          if (segment.cp) {
            minX = Math.min(minX, segment.cp.x);
            minY = Math.min(minY, segment.cp.y);
            maxX = Math.max(maxX, segment.cp.x);
            maxY = Math.max(maxY, segment.cp.y);
          }
          if (segment.cp1) {
            minX = Math.min(minX, segment.cp1.x);
            minY = Math.min(minY, segment.cp1.y);
            maxX = Math.max(maxX, segment.cp1.x);
            maxY = Math.max(maxY, segment.cp1.y);
          }
          if (segment.cp2) {
            minX = Math.min(minX, segment.cp2.x);
            minY = Math.min(minY, segment.cp2.y);
            maxX = Math.max(maxX, segment.cp2.x);
            maxY = Math.max(maxY, segment.cp2.y);
          }
        }
      }
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }
}

module.exports = SVGPathConverter;
