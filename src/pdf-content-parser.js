/**
 * PDF Content Stream Parser
 * Parses PDF content streams to extract vector drawing operations
 * Converts low-level PDF operators into structured path data
 */

class PDFContentParser {
  constructor() {
    this.paths = [];
    this.currentPath = null;
    this.graphicsState = new GraphicsState();
    this.stateStack = [];
    this.debugCount = 0; // For debugging
  }

  /**
   * Parse a PDF content stream and extract all vector paths
   * @param {Buffer|Uint8Array} stream - Raw content stream data
   * @returns {Array} Array of path objects with geometry and style
   */
  parseContentStream(stream) {
    try {
      // Convert stream to string
      const content = stream.toString('latin1');

      // Tokenize the content stream
      const tokens = this.tokenize(content);

      // Process tokens and build paths
      this.processTokens(tokens);

      return this.paths;
    } catch (error) {
      console.error('Error parsing content stream:', error);
      return [];
    }
  }

  /**
   * Tokenize PDF content stream into operators and operands
   * @param {string} content - Content stream as string
   * @returns {Array} Array of tokens
   */
  tokenize(content) {
    const tokens = [];

    // Regular expression to match PDF tokens
    // Matches: numbers, operators, names, strings, arrays
    const tokenRegex = /([+-]?\d+\.?\d*)|(\[|\])|(\((?:[^()\\]|\\.)*\))|\/([^\s\[\]()<>\/{}%]+)|([a-zA-Z'"][a-zA-Z0-9'"]*)|\s+/g;

    let match;
    while ((match = tokenRegex.exec(content)) !== null) {
      if (match[0].trim()) {
        tokens.push(match[0].trim());
      }
    }

    return tokens;
  }

  /**
   * Process tokens and execute PDF operators
   * @param {Array} tokens - Array of tokens
   */
  processTokens(tokens) {
    const operandStack = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Check if token is an operator (all lowercase/uppercase letters)
      if (/^[a-zA-Z'*]+$/.test(token)) {
        // Execute operator with operands from stack
        this.executeOperator(token, operandStack);
        // Clear operand stack after operator
        operandStack.length = 0;
      } else {
        // It's an operand, push to stack
        operandStack.push(token);
      }
    }
  }

  /**
   * Execute a PDF operator
   * @param {string} operator - PDF operator
   * @param {Array} operands - Operands for the operator
   */
  executeOperator(operator, operands) {
    switch (operator) {
      // Path construction operators
      case 'm': // moveto
        this.opMoveTo(operands);
        break;
      case 'l': // lineto
        this.opLineTo(operands);
        break;
      case 'c': // curveto (cubic Bezier)
        this.opCurveTo(operands);
        break;
      case 'v': // curveto (current point as first control point)
        this.opCurveToV(operands);
        break;
      case 'y': // curveto (final point as second control point)
        this.opCurveToY(operands);
        break;
      case 'h': // closepath
        this.opClosePath();
        break;
      case 're': // rectangle
        this.opRectangle(operands);
        break;

      // Path painting operators
      case 'S': // stroke
        this.opStroke();
        break;
      case 's': // close and stroke
        this.opClosePath();
        this.opStroke();
        break;
      case 'f': // fill (nonzero winding)
      case 'F': // fill (nonzero winding, legacy)
        this.opFill('nonzero');
        break;
      case 'f*': // fill (even-odd)
        this.opFill('evenodd');
        break;
      case 'B': // fill and stroke (nonzero)
        this.opFillAndStroke('nonzero');
        break;
      case 'B*': // fill and stroke (even-odd)
        this.opFillAndStroke('evenodd');
        break;
      case 'b': // close, fill and stroke (nonzero)
        this.opClosePath();
        this.opFillAndStroke('nonzero');
        break;
      case 'b*': // close, fill and stroke (even-odd)
        this.opClosePath();
        this.opFillAndStroke('evenodd');
        break;
      case 'n': // end path (no painting)
        this.opEndPath();
        break;

      // Graphics state operators
      case 'w': // set line width
        this.opSetLineWidth(operands);
        break;
      case 'J': // set line cap
        this.opSetLineCap(operands);
        break;
      case 'j': // set line join
        this.opSetLineJoin(operands);
        break;
      case 'd': // set dash pattern
        this.opSetDash(operands);
        break;
      case 'q': // save graphics state
        this.opSaveState();
        break;
      case 'Q': // restore graphics state
        this.opRestoreState();
        break;
      case 'cm': // concat matrix (transformation)
        this.opConcatMatrix(operands);
        break;

      // Color operators
      case 'g': // set gray (fill)
        this.opSetGray(operands, 'fill');
        break;
      case 'G': // set gray (stroke)
        this.opSetGray(operands, 'stroke');
        break;
      case 'rg': // set RGB (fill)
        this.opSetRGB(operands, 'fill');
        break;
      case 'RG': // set RGB (stroke)
        this.opSetRGB(operands, 'stroke');
        break;
      case 'k': // set CMYK (fill)
        this.opSetCMYK(operands, 'fill');
        break;
      case 'K': // set CMYK (stroke)
        this.opSetCMYK(operands, 'stroke');
        break;
      case 'sc': // set color (fill)
      case 'SC': // set color (stroke)
      case 'scn': // set color (fill, with pattern)
      case 'SCN': // set color (stroke, with pattern)
        // These require color space context, skip for now
        break;

      // Text operators (we'll ignore these for vector extraction)
      case 'BT': // begin text
      case 'ET': // end text
      case 'Td': case 'TD': case 'Tm': case 'T*': // text positioning
      case 'Tj': case 'TJ': case "'": case '"': // text showing
      case 'Tc': case 'Tw': case 'Tz': case 'TL': case 'Tf': case 'Tr': case 'Ts': // text state
        // Ignore text operators
        break;

      default:
        // Unknown or unsupported operator
        // console.log(`Unknown operator: ${operator}`);
        break;
    }
  }

  // Path construction operators

  opMoveTo(operands) {
    if (operands.length < 2) {
      return;
    }

    const x = parseFloat(operands[0]);
    const y = parseFloat(operands[1]);

    // Start new subpath
    if (!this.currentPath) {
      this.currentPath = this.createPath();
    }

    this.currentPath.subpaths.push({
      segments: [],
      closed: false,
      startPoint: { x, y }
    });

    this.currentPath.currentPoint = { x, y };
  }

  opLineTo(operands) {
    if (operands.length < 2 || !this.currentPath) return;

    const x = parseFloat(operands[0]);
    const y = parseFloat(operands[1]);

    const currentSubpath = this.getCurrentSubpath();
    if (currentSubpath) {
      currentSubpath.segments.push({
        type: 'line',
        point: { x, y }
      });
    }

    this.currentPath.currentPoint = { x, y };
  }

  opCurveTo(operands) {
    if (operands.length < 6 || !this.currentPath) return;

    const x1 = parseFloat(operands[0]);
    const y1 = parseFloat(operands[1]);
    const x2 = parseFloat(operands[2]);
    const y2 = parseFloat(operands[3]);
    const x3 = parseFloat(operands[4]);
    const y3 = parseFloat(operands[5]);

    const currentSubpath = this.getCurrentSubpath();
    if (currentSubpath) {
      currentSubpath.segments.push({
        type: 'cubic',
        cp1: { x: x1, y: y1 },
        cp2: { x: x2, y: y2 },
        point: { x: x3, y: y3 }
      });
    }

    this.currentPath.currentPoint = { x: x3, y: y3 };
  }

  opCurveToV(operands) {
    if (operands.length < 4 || !this.currentPath) return;

    const cp = this.currentPath.currentPoint;
    const x2 = parseFloat(operands[0]);
    const y2 = parseFloat(operands[1]);
    const x3 = parseFloat(operands[2]);
    const y3 = parseFloat(operands[3]);

    const currentSubpath = this.getCurrentSubpath();
    if (currentSubpath) {
      currentSubpath.segments.push({
        type: 'cubic',
        cp1: { x: cp.x, y: cp.y },
        cp2: { x: x2, y: y2 },
        point: { x: x3, y: y3 }
      });
    }

    this.currentPath.currentPoint = { x: x3, y: y3 };
  }

  opCurveToY(operands) {
    if (operands.length < 4 || !this.currentPath) return;

    const x1 = parseFloat(operands[0]);
    const y1 = parseFloat(operands[1]);
    const x3 = parseFloat(operands[2]);
    const y3 = parseFloat(operands[3]);

    const currentSubpath = this.getCurrentSubpath();
    if (currentSubpath) {
      currentSubpath.segments.push({
        type: 'cubic',
        cp1: { x: x1, y: y1 },
        cp2: { x: x3, y: y3 },
        point: { x: x3, y: y3 }
      });
    }

    this.currentPath.currentPoint = { x: x3, y: y3 };
  }

  opClosePath() {
    if (!this.currentPath) return;

    const currentSubpath = this.getCurrentSubpath();
    if (currentSubpath) {
      currentSubpath.closed = true;
    }
  }

  opRectangle(operands) {
    if (operands.length < 4) return;

    const x = parseFloat(operands[0]);
    const y = parseFloat(operands[1]);
    const width = parseFloat(operands[2]);
    const height = parseFloat(operands[3]);

    if (!this.currentPath) {
      this.currentPath = this.createPath();
    }

    // Create rectangle as closed path
    this.currentPath.subpaths.push({
      segments: [
        { type: 'line', point: { x: x + width, y } },
        { type: 'line', point: { x: x + width, y: y + height } },
        { type: 'line', point: { x, y: y + height } }
      ],
      closed: true,
      startPoint: { x, y }
    });

    this.currentPath.currentPoint = { x, y };
  }

  // Path painting operators

  opStroke() {
    if (!this.currentPath) return;

    this.currentPath.operation = 'stroke';
    this.currentPath.style.stroke = this.graphicsState.strokeColor;
    this.currentPath.style.strokeWidth = this.graphicsState.lineWidth;
    this.currentPath.style.strokeLinecap = this.graphicsState.lineCap;
    this.currentPath.style.strokeLinejoin = this.graphicsState.lineJoin;
    this.currentPath.style.strokeDasharray = this.graphicsState.dashArray;

    this.finishPath();
  }

  opFill(fillRule) {
    if (!this.currentPath) return;

    this.currentPath.operation = 'fill';
    this.currentPath.style.fill = this.graphicsState.fillColor;
    this.currentPath.style.fillRule = fillRule;

    this.finishPath();
  }

  opFillAndStroke(fillRule) {
    if (!this.currentPath) return;

    this.currentPath.operation = 'fill-stroke';
    this.currentPath.style.fill = this.graphicsState.fillColor;
    this.currentPath.style.fillRule = fillRule;
    this.currentPath.style.stroke = this.graphicsState.strokeColor;
    this.currentPath.style.strokeWidth = this.graphicsState.lineWidth;
    this.currentPath.style.strokeLinecap = this.graphicsState.lineCap;
    this.currentPath.style.strokeLinejoin = this.graphicsState.lineJoin;

    this.finishPath();
  }

  opEndPath() {
    // End path without painting (discard current path)
    this.currentPath = null;
  }

  // Graphics state operators

  opSetLineWidth(operands) {
    if (operands.length < 1) return;
    this.graphicsState.lineWidth = parseFloat(operands[0]);
  }

  opSetLineCap(operands) {
    if (operands.length < 1) return;
    const cap = parseInt(operands[0]);
    this.graphicsState.lineCap = ['butt', 'round', 'square'][cap] || 'butt';
  }

  opSetLineJoin(operands) {
    if (operands.length < 1) return;
    const join = parseInt(operands[0]);
    this.graphicsState.lineJoin = ['miter', 'round', 'bevel'][join] || 'miter';
  }

  opSetDash(operands) {
    // Dash pattern: [array phase]
    // For now, store as string
    this.graphicsState.dashArray = operands.join(' ');
  }

  opSaveState() {
    this.stateStack.push(this.graphicsState.clone());
  }

  opRestoreState() {
    if (this.stateStack.length > 0) {
      this.graphicsState = this.stateStack.pop();
    }
  }

  opConcatMatrix(operands) {
    if (operands.length < 6) return;

    const matrix = {
      a: parseFloat(operands[0]),
      b: parseFloat(operands[1]),
      c: parseFloat(operands[2]),
      d: parseFloat(operands[3]),
      e: parseFloat(operands[4]),
      f: parseFloat(operands[5])
    };

    this.graphicsState.ctm = this.multiplyMatrices(this.graphicsState.ctm, matrix);
  }

  // Color operators

  opSetGray(operands, target) {
    if (operands.length < 1) return;
    const gray = parseFloat(operands[0]);
    const color = this.grayToHex(gray);

    if (target === 'fill') {
      this.graphicsState.fillColor = color;
    } else {
      this.graphicsState.strokeColor = color;
    }
  }

  opSetRGB(operands, target) {
    if (operands.length < 3) return;
    const r = parseFloat(operands[0]);
    const g = parseFloat(operands[1]);
    const b = parseFloat(operands[2]);
    const color = this.rgbToHex(r, g, b);

    if (target === 'fill') {
      this.graphicsState.fillColor = color;
    } else {
      this.graphicsState.strokeColor = color;
    }
  }

  opSetCMYK(operands, target) {
    if (operands.length < 4) return;
    const c = parseFloat(operands[0]);
    const m = parseFloat(operands[1]);
    const y = parseFloat(operands[2]);
    const k = parseFloat(operands[3]);
    const color = this.cmykToHex(c, m, y, k);

    if (target === 'fill') {
      this.graphicsState.fillColor = color;
    } else {
      this.graphicsState.strokeColor = color;
    }
  }

  // Helper methods

  createPath() {
    return {
      subpaths: [],
      currentPoint: null,
      operation: null,
      style: {},
      transform: this.graphicsState.ctm
    };
  }

  getCurrentSubpath() {
    if (!this.currentPath || this.currentPath.subpaths.length === 0) {
      return null;
    }
    return this.currentPath.subpaths[this.currentPath.subpaths.length - 1];
  }

  finishPath() {
    if (this.currentPath) {
      this.paths.push(this.currentPath);
      this.currentPath = null;
    }
  }

  grayToHex(gray) {
    const val = Math.round(gray * 255);
    const hex = val.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }

  rgbToHex(r, g, b) {
    const rHex = Math.round(r * 255).toString(16).padStart(2, '0');
    const gHex = Math.round(g * 255).toString(16).padStart(2, '0');
    const bHex = Math.round(b * 255).toString(16).padStart(2, '0');
    return `#${rHex}${gHex}${bHex}`;
  }

  cmykToHex(c, m, y, k) {
    // Convert CMYK to RGB
    const r = (1 - c) * (1 - k);
    const g = (1 - m) * (1 - k);
    const b = (1 - y) * (1 - k);
    return this.rgbToHex(r, g, b);
  }

  multiplyMatrices(m1, m2) {
    return {
      a: m1.a * m2.a + m1.b * m2.c,
      b: m1.a * m2.b + m1.b * m2.d,
      c: m1.c * m2.a + m1.d * m2.c,
      d: m1.c * m2.b + m1.d * m2.d,
      e: m1.e * m2.a + m1.f * m2.c + m2.e,
      f: m1.e * m2.b + m1.f * m2.d + m2.f
    };
  }
}

/**
 * Graphics State
 * Tracks current PDF graphics state (colors, line width, transformations, etc.)
 */
class GraphicsState {
  constructor() {
    this.fillColor = '#000000';
    this.strokeColor = '#000000';
    this.lineWidth = 1;
    this.lineCap = 'butt';
    this.lineJoin = 'miter';
    this.dashArray = '';
    this.ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; // Current transformation matrix
  }

  clone() {
    const cloned = new GraphicsState();
    cloned.fillColor = this.fillColor;
    cloned.strokeColor = this.strokeColor;
    cloned.lineWidth = this.lineWidth;
    cloned.lineCap = this.lineCap;
    cloned.lineJoin = this.lineJoin;
    cloned.dashArray = this.dashArray;
    cloned.ctm = { ...this.ctm };
    return cloned;
  }
}

module.exports = PDFContentParser;
