/**
 * PDF Content Stream Parser
 * Parses PDF content streams to extract vector drawing operations
 * Converts low-level PDF operators into structured path data
 */

const { PDFName } = require('pdf-lib');

class PDFContentParser {
  constructor(options = {}) {
    this.paths = [];
    this.currentPath = null;
    this.textObjects = [];
    this.graphicsState = new GraphicsState();
    this.stateStack = [];
    this.debugCount = 0; // For debugging

    // Text state
    this.inTextObject = false;
    this.currentFont = null;
    this.currentFontSize = 0;
    this.textMatrix = [1, 0, 0, 1, 0, 0]; // Tm
    this.textLineMatrix = [1, 0, 0, 1, 0, 0]; // Tlm

    // Font resources for decoding text
    this.pdfContext = options.pdfContext;
    this.fontDict = options.fontDict;
    this.fontCMaps = {}; // Cache for parsed ToUnicode CMaps
  }

  /**
   * Parse a PDF content stream and extract all vector paths and text
   * @param {Buffer|Uint8Array} stream - Raw content stream data
   * @returns {Object} Object with paths and textObjects arrays
   */
  parseContentStream(stream) {
    try {
      // Convert stream to string
      const content = stream.toString('latin1');

      // Tokenize the content stream
      const tokens = this.tokenize(content);

      // Process tokens and build paths
      this.processTokens(tokens);

      return {
        paths: this.paths,
        textObjects: this.textObjects
      };
    } catch (error) {
      console.error('Error parsing content stream:', error);
      return { paths: [], textObjects: [] };
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
    // Matches: hex strings, numbers, operators, names, literal strings, arrays
    const tokenRegex = /(<[0-9A-Fa-f\s]*>)|([+-]?\d+\.?\d*)|(\[|\])|(\((?:[^()\\]|\\.)*\))|\/([^\s\[\]()<>\/{}%]+)|([a-zA-Z'"][a-zA-Z0-9'"]*)|\s+/g;

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

      // Text operators
      case 'BT': // begin text
        this.opBeginText();
        break;
      case 'ET': // end text
        this.opEndText();
        break;
      case 'Tf': // set font and size
        this.opSetFont(operands);
        break;
      case 'Tm': // set text matrix
        this.opSetTextMatrix(operands);
        break;
      case 'Td': // move text position
        this.opMoveText(operands);
        break;
      case 'TD': // move text position and set leading
        this.opMoveTextSetLeading(operands);
        break;
      case 'T*': // move to start of next line
        this.opNextLine();
        break;
      case 'Tj': // show text
        this.opShowText(operands);
        break;
      case 'TJ': // show text with positioning
        this.opShowTextPositioned(operands);
        break;
      case "'": // move to next line and show text
        this.opNextLine();
        this.opShowText(operands);
        break;
      case '"': // set word/char spacing, move to next line, show text
        // operands: [aw, ac, string]
        if (operands.length >= 3) {
          this.opNextLine();
          this.opShowText([operands[2]]);
        }
        break;
      // Text state operators (spacing, scaling, etc.) - track but don't need to process
      case 'Tc': case 'Tw': case 'Tz': case 'TL': case 'Tr': case 'Ts':
        // Character spacing, word spacing, horizontal scaling, leading, render mode, rise
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

  // ============================================================================
  // Text Operators
  // ============================================================================

  opBeginText() {
    this.inTextObject = true;
    // Reset text matrices to identity
    this.textMatrix = [1, 0, 0, 1, 0, 0];
    this.textLineMatrix = [1, 0, 0, 1, 0, 0];
  }

  opEndText() {
    this.inTextObject = false;
  }

  opSetFont(operands) {
    // Tf: font name, size
    if (operands.length >= 2) {
      this.currentFont = operands[0]; // Font resource name (e.g., /F1)
      this.currentFontSize = parseFloat(operands[1]);
    }
  }

  opSetTextMatrix(operands) {
    // Tm: a b c d e f (6 numbers defining transformation matrix)
    if (operands.length >= 6) {
      this.textMatrix = operands.map(parseFloat);
      // Text line matrix is also set to the same value
      this.textLineMatrix = [...this.textMatrix];
    }
  }

  opMoveText(operands) {
    // Td: tx ty (translate text position)
    if (operands.length >= 2) {
      const tx = parseFloat(operands[0]);
      const ty = parseFloat(operands[1]);
      // Update text line matrix: Tlm = Tlm * [1 0 0 1 tx ty]
      this.textLineMatrix[4] += tx;
      this.textLineMatrix[5] += ty;
      // Text matrix follows
      this.textMatrix = [...this.textLineMatrix];
    }
  }

  opMoveTextSetLeading(operands) {
    // TD: tx ty (same as Td but also sets leading)
    this.opMoveText(operands);
  }

  opNextLine() {
    // T*: Move to start of next line (uses text leading)
    // For simplicity, just move down
    this.textLineMatrix[5] -= this.currentFontSize * 1.2; // Approximate line spacing
    this.textMatrix = [...this.textLineMatrix];
  }

  opShowText(operands) {
    // Tj: (string) - show a text string
    if (operands.length >= 1 && this.inTextObject) {
      const rawText = operands[0];
      const textString = this.decodeTextString(rawText);

      // Debug: show first few text decodings
      if (this.textObjects.length < 5) {
        console.log(`  [Text Debug] Raw: "${rawText.substring(0, 50)}" -> Decoded: "${textString.substring(0, 50)}" (font: ${this.currentFont})`);
      }

      // Extract position from text matrix (e, f components)
      const x = this.textMatrix[4];
      const y = this.textMatrix[5];

      this.textObjects.push({
        text: textString,
        x: x,
        y: y,
        font: this.currentFont,
        fontSize: this.currentFontSize,
        fillColor: this.graphicsState.fillColor,
        ctm: { ...this.graphicsState.ctm }
      });
    }
  }

  opShowTextPositioned(operands) {
    // TJ: [(string) offset (string) offset ...] - show text with positioning
    if (operands.length >= 1 && this.inTextObject) {
      const array = operands[0];

      // Parse array - could be a string like "[(text)-123(more)]"
      if (typeof array === 'string') {
        // Extract strings from array notation
        const matches = array.matchAll(/\(([^)]*)\)/g);
        for (const match of matches) {
          const textString = this.decodeTextString(`(${match[1]})`);

          const x = this.textMatrix[4];
          const y = this.textMatrix[5];

          this.textObjects.push({
            text: textString,
            x: x,
            y: y,
            font: this.currentFont,
            fontSize: this.currentFontSize,
            fillColor: this.graphicsState.fillColor,
            ctm: { ...this.graphicsState.ctm }
          });
        }
      }
    }
  }

  decodeTextString(pdfString) {
    // Check if this is a hex string (<...>) vs literal string (...)
    const isHexString = pdfString.startsWith('<') && pdfString.endsWith('>');

    if (isHexString) {
      // Hex string: <48656C6C6F> represents bytes
      const hexContent = pdfString.slice(1, -1).replace(/\s/g, '');

      // Debug first few hex strings
      if (this.textObjects.length < 5) {
        console.log(`  [Text Debug] Hex string: ${pdfString} -> bytes: ${hexContent}`);
      }

      // Convert hex pairs to bytes
      let bytes = '';
      for (let i = 0; i < hexContent.length; i += 2) {
        const hexPair = hexContent.substr(i, 2);
        bytes += String.fromCharCode(parseInt(hexPair, 16));
      }
      pdfString = bytes;
    } else if (pdfString.startsWith('(') && pdfString.endsWith(')')) {
      // Literal string: (Hello)
      pdfString = pdfString.slice(1, -1);

      // Decode escape sequences
      pdfString = pdfString
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\b/g, '\b')
        .replace(/\\f/g, '\f')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
    }

    // If we have font resources, try to decode using ToUnicode CMap
    if (this.currentFont && this.fontDict && this.pdfContext) {
      const decodedText = this.decodeWithCMap(pdfString, this.currentFont);
      if (decodedText) {
        return decodedText;
      }
    }

    return pdfString;
  }

  /**
   * Decode text using font's ToUnicode CMap
   */
  decodeWithCMap(text, fontName) {
    try {
      // Get or create CMap for this font
      if (!this.fontCMaps[fontName]) {
        const cmap = this.extractToUnicodeCMap(fontName);
        if (cmap) {
          this.fontCMaps[fontName] = cmap;
        } else {
          this.fontCMaps[fontName] = null; // Mark as unavailable
          return null;
        }
      }

      const cmap = this.fontCMaps[fontName];
      if (!cmap) {
        if (!this.loggedNoCMap) {
          console.log(`  [Text Debug] No CMap available for ${fontName} - using raw text`);
          this.loggedNoCMap = true;
        }
        return null;
      }

      // Convert text bytes to character codes and map to Unicode
      let result = '';
      let debugInfo = [];
      for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);

        // Try 2-byte codes first (common in CID fonts)
        if (i + 1 < text.length) {
          const twoByteCode = (charCode << 8) | text.charCodeAt(i + 1);
          if (cmap[twoByteCode] !== undefined) {
            result += cmap[twoByteCode];
            if (debugInfo.length < 3) {
              debugInfo.push(`0x${twoByteCode.toString(16)} -> "${cmap[twoByteCode]}"`);
            }
            i++; // Skip next byte
            continue;
          }
        }

        // Try single-byte code
        if (cmap[charCode] !== undefined) {
          result += cmap[charCode];
          if (debugInfo.length < 3) {
            debugInfo.push(`0x${charCode.toString(16)} -> "${cmap[charCode]}"`);
          }
        } else {
          // No mapping found, keep original character
          result += text[i];
        }
      }

      // Debug: show first successful decoding
      if (debugInfo.length > 0 && !this.loggedSuccessfulDecode) {
        console.log(`  [Text Debug] CMap decoding working! Examples: ${debugInfo.join(', ')}`);
        this.loggedSuccessfulDecode = true;
      }

      return result || null;
    } catch (error) {
      // If CMap decoding fails, return null to fall back to original string
      console.log(`  [Text Debug] CMap decode error: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract and parse ToUnicode CMap from font
   */
  extractToUnicodeCMap(fontName) {
    try {
      if (!this.fontDict) {
        if (!this.loggedCMapWarning) {
          console.log(`  [CMap] No fontDict available - text won't be decoded`);
          this.loggedCMapWarning = true;
        }
        return null;
      }

      // Remove leading slash from font name
      const cleanFontName = fontName.startsWith('/') ? fontName.substring(1) : fontName;

      // Look up font in font dictionary using PDFName
      const fontKey = PDFName.of(cleanFontName);
      const fontRef = this.fontDict.get(fontKey);
      if (!fontRef) {
        if (!this.loggedMissingFonts) {
          this.loggedMissingFonts = new Set();
        }
        if (!this.loggedMissingFonts.has(cleanFontName)) {
          console.log(`  [CMap] Font "${cleanFontName}" not found in dictionary (tried PDFName.of("${cleanFontName}"))`);
          this.loggedMissingFonts.add(cleanFontName);
        }
        return null;
      }

      const font = this.pdfContext.lookup(fontRef);
      if (!font || !font.dict) {
        console.log(`  [CMap] Could not lookup font "${cleanFontName}"`);
        return null;
      }

      // Inspect font structure in detail
      if (!this.inspectedFonts) {
        this.inspectedFonts = new Set();
      }

      if (!this.inspectedFonts.has(cleanFontName)) {
        console.log(`\n  [Font Info] Inspecting font "${cleanFontName}":`);

        // Get font properties
        const subtype = font.dict.get(PDFName.of('Subtype'));
        const baseFont = font.dict.get(PDFName.of('BaseFont'));
        const encoding = font.dict.get(PDFName.of('Encoding'));
        const toUnicode = font.dict.get(PDFName.of('ToUnicode'));
        const descendantFonts = font.dict.get(PDFName.of('DescendantFonts'));

        console.log(`    Subtype: ${subtype ? subtype.toString() : 'none'}`);
        console.log(`    BaseFont: ${baseFont ? baseFont.toString() : 'none'}`);
        console.log(`    ToUnicode: ${toUnicode ? 'present' : 'MISSING'}`);
        console.log(`    Encoding: ${encoding ? encoding.toString() : 'none'}`);

        // If Type0 (composite font), inspect DescendantFonts
        if (subtype && subtype.toString() === '/Type0' && descendantFonts) {
          console.log(`    Type: Composite (Type0) font`);
          try {
            const descFontsArray = this.pdfContext.lookup(descendantFonts);
            if (descFontsArray && descFontsArray.length > 0) {
              const cidFont = this.pdfContext.lookup(descFontsArray[0]);
              if (cidFont && cidFont.dict) {
                const cidSubtype = cidFont.dict.get(PDFName.of('Subtype'));
                const cidSystemInfo = cidFont.dict.get(PDFName.of('CIDSystemInfo'));
                const cidToGIDMap = cidFont.dict.get(PDFName.of('CIDToGIDMap'));

                console.log(`    CIDFont Subtype: ${cidSubtype ? cidSubtype.toString() : 'none'}`);
                console.log(`    CIDToGIDMap: ${cidToGIDMap ? cidToGIDMap.toString() : 'none'}`);

                if (cidSystemInfo) {
                  const sysInfo = this.pdfContext.lookup(cidSystemInfo);
                  if (sysInfo && sysInfo.dict) {
                    const registry = sysInfo.dict.get(PDFName.of('Registry'));
                    const ordering = sysInfo.dict.get(PDFName.of('Ordering'));
                    console.log(`    Registry: ${registry ? registry.toString() : 'none'}`);
                    console.log(`    Ordering: ${ordering ? ordering.toString() : 'none'}`);
                  }
                }
              }
            }
          } catch (e) {
            console.log(`    Error inspecting DescendantFonts: ${e.message}`);
          }
        }

        // If encoding is present, inspect it
        if (encoding) {
          try {
            const encodingObj = this.pdfContext.lookup(encoding);
            if (encodingObj) {
              if (typeof encodingObj === 'object' && encodingObj.dict) {
                const baseEncoding = encodingObj.dict.get(PDFName.of('BaseEncoding'));
                const differences = encodingObj.dict.get(PDFName.of('Differences'));
                console.log(`    Encoding BaseEncoding: ${baseEncoding ? baseEncoding.toString() : 'none'}`);
                console.log(`    Encoding Differences: ${differences ? 'present' : 'none'}`);
              }
            }
          } catch (e) {
            console.log(`    Error inspecting Encoding: ${e.message}`);
          }
        }

        this.inspectedFonts.add(cleanFontName);
      }

      // Look for ToUnicode entry
      const toUnicodeRef = font.dict.get(PDFName.of('ToUnicode'));
      if (!toUnicodeRef) {
        // Font has no ToUnicode - we've already inspected it above
        return null;
      }

      const toUnicode = this.pdfContext.lookup(toUnicodeRef);
      if (!toUnicode) {
        console.log(`  [CMap] Could not lookup ToUnicode stream for "${cleanFontName}"`);
        return null;
      }

      // Get the CMap stream content
      let cmapData = toUnicode.getContents();

      // Decompress if needed - check for FlateDecode
      if (toUnicode.dict) {
        const filter = toUnicode.dict.get(PDFName.of('Filter'));
        console.log(`  [CMap Debug] Filter: ${filter ? filter.toString() : 'none'}`);

        if (filter) {
          const filterStr = filter.toString();
          if (filterStr === '/FlateDecode' || filterStr === 'FlateDecode') {
            console.log(`  [CMap Debug] Decompressing with FlateDecode...`);
            const zlib = require('zlib');
            try {
              cmapData = zlib.inflateSync(Buffer.from(cmapData));
              console.log(`  [CMap Debug] Decompression successful, size: ${cmapData.length} bytes`);
            } catch (e) {
              console.log(`  [CMap Debug] Decompression failed: ${e.message}`);
            }
          }
        }
      } else {
        // Try auto-detect compression (look for zlib header)
        if (cmapData[0] === 0x78 && (cmapData[1] === 0x9C || cmapData[1] === 0xDA)) {
          console.log(`  [CMap Debug] Auto-detected zlib compression, decompressing...`);
          const zlib = require('zlib');
          try {
            cmapData = zlib.inflateSync(Buffer.from(cmapData));
            console.log(`  [CMap Debug] Decompression successful, size: ${cmapData.length} bytes`);
          } catch (e) {
            console.log(`  [CMap Debug] Decompression failed: ${e.message}`);
          }
        }
      }

      // Parse the CMap
      const cmapString = cmapData.toString('latin1');

      // Debug: show first part of CMap
      console.log(`  [CMap Debug] First 500 chars of "${cleanFontName}" ToUnicode:`);
      console.log(`    ${cmapString.substring(0, 500).replace(/\n/g, '\\n ')}`);

      const mapping = this.parseCMap(cmapString);

      if (mapping) {
        const count = Object.keys(mapping).length;
        console.log(`  [CMap] ✓ Loaded "${cleanFontName}": ${count} character mappings`);
      } else {
        console.log(`  [CMap] ✗ Failed to parse CMap for "${cleanFontName}"`);
      }

      return mapping;

    } catch (error) {
      console.log(`  [CMap] Error for ${fontName}: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse ToUnicode CMap to build character code -> Unicode mapping
   */
  parseCMap(cmapString) {
    const mapping = {};

    try {
      // Parse beginbfchar sections (single character mappings)
      const bfcharRegex = /beginbfchar\s+([\s\S]*?)\s+endbfchar/g;
      let match;

      while ((match = bfcharRegex.exec(cmapString)) !== null) {
        const entries = match[1].trim().split(/\s+/);

        for (let i = 0; i < entries.length; i += 2) {
          if (i + 1 >= entries.length) break;

          const srcCode = this.parseHexString(entries[i]);
          const dstCode = this.parseHexString(entries[i + 1]);

          if (srcCode !== null && dstCode !== null) {
            mapping[srcCode] = String.fromCharCode(dstCode);
          }
        }
      }

      // Parse beginbfrange sections (character ranges)
      const bfrangeRegex = /beginbfrange\s+([\s\S]*?)\s+endbfrange/g;

      while ((match = bfrangeRegex.exec(cmapString)) !== null) {
        const entries = match[1].trim().split(/\s+/);

        for (let i = 0; i < entries.length; i += 3) {
          if (i + 2 >= entries.length) break;

          const srcStart = this.parseHexString(entries[i]);
          const srcEnd = this.parseHexString(entries[i + 1]);
          const dst = this.parseHexString(entries[i + 2]);

          if (srcStart !== null && srcEnd !== null && dst !== null) {
            for (let code = srcStart; code <= srcEnd; code++) {
              mapping[code] = String.fromCharCode(dst + (code - srcStart));
            }
          }
        }
      }

      return Object.keys(mapping).length > 0 ? mapping : null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Parse hex string from CMap (e.g., "<0041>" -> 65)
   */
  parseHexString(hexStr) {
    if (!hexStr) return null;

    // Remove angle brackets
    const hex = hexStr.replace(/[<>]/g, '');
    if (!hex) return null;

    const value = parseInt(hex, 16);
    return isNaN(value) ? null : value;
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
