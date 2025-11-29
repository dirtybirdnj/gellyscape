/**
 * Text Extractor for GeoPDF files
 * Extracts text content, positions, and font information from PDF files
 *
 * Supports multiple USGS GeoPDF formats:
 * - 2025 TopoBuilder: Text in Form XObjects, fonts in XObject resources
 * - 2024 USGS: Text in content streams, fonts in page resources
 * - Historical (scanned): Minimal text, mostly rasterized
 */

const fs = require('fs');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } = require('pdf-lib');
const pako = require('pako');

class TextExtractor {
  constructor() {
    this.textElements = [];
    this.fonts = [];
    this.fontDetails = {};
    this.formatInfo = null;
  }

  /**
   * Extract text from a PDF file
   * @param {string} filePath - Path to the PDF file
   * @returns {Object} Object with textElements, fonts, and formatInfo
   */
  async extract(filePath) {
    console.log('[TextExtractor] Starting extraction from:', filePath);

    const fileBuffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(fileBuffer, {
      ignoreEncryption: true,
      updateMetadata: false
    });

    // Detect format first
    this.formatInfo = await this.detectFormat(pdfDoc);
    console.log(`[TextExtractor] Format: ${this.formatInfo.generation}, TopoBuilder: ${this.formatInfo.isTopoBuilder}`);

    const pages = pdfDoc.getPages();

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      await this.extractFromPage(pdfDoc, page, pageIndex);
    }

    console.log(`[TextExtractor] Extracted ${this.textElements.length} text elements`);
    console.log(`[TextExtractor] Found ${this.fonts.length} fonts`);

    return {
      textElements: this.textElements,
      fonts: this.fonts,
      fontDetails: this.fontDetails,
      formatInfo: this.formatInfo
    };
  }

  /**
   * Detect the PDF format
   */
  async detectFormat(pdfDoc) {
    const info = pdfDoc.getInfoDict();
    let creator = '';
    let keywords = '';

    if (info) {
      const creatorVal = info.get(PDFName.of('Creator'));
      const keywordsVal = info.get(PDFName.of('Keywords'));
      creator = creatorVal?.toString().replace(/^\(|\)$/g, '') || '';
      keywords = keywordsVal?.toString().replace(/^\(|\)$/g, '') || '';
    }

    const isTopoBuilder = keywords.toLowerCase().includes('topobuilder');
    const versionMatch = creator.match(/ArcSOC\s+([\d.]+)/i);
    const version = versionMatch ? parseFloat(versionMatch[1]) : 0;

    let generation = 'unknown';
    if (version >= 13.0 || isTopoBuilder) {
      generation = '2025';
    } else if (version >= 10.0) {
      generation = '2024';
    } else if (creator.includes('Map2PDF')) {
      generation = 'historical';
    }

    return {
      generation,
      isTopoBuilder,
      creator,
      arcVersion: version
    };
  }

  /**
   * Extract text from a page based on format
   */
  async extractFromPage(pdfDoc, page, pageIndex) {
    const resources = page.node.get(PDFName.of('Resources'));
    if (!resources) return;

    if (this.formatInfo.isTopoBuilder || this.formatInfo.generation === '2025') {
      // 2025 TopoBuilder: Text is in Form XObjects
      await this.extractFromXObjects(pdfDoc, resources, pageIndex);
    } else {
      // 2024 format: Text is in content streams
      await this.extractFromContentStreams(pdfDoc, page, resources, pageIndex);
    }
  }

  /**
   * Extract text from Form XObjects (2025 TopoBuilder format)
   */
  async extractFromXObjects(pdfDoc, resources, pageIndex) {
    const xobjectDict = resources.get(PDFName.of('XObject'));
    if (!xobjectDict) return;

    const entries = xobjectDict instanceof PDFDict ? Array.from(xobjectDict.entries()) : [];

    for (const [xobjRef, xobjObjRef] of entries) {
      const xobjObj = pdfDoc.context.lookup(xobjObjRef);
      if (!xobjObj) continue;

      const subtype = xobjObj.dict?.get(PDFName.of('Subtype'));
      if (subtype?.toString() !== '/Form') continue;

      // Get fonts from XObject resources
      const xobjResources = xobjObj.dict?.get(PDFName.of('Resources'));
      const fontDict = xobjResources?.get(PDFName.of('Font'));

      // Extract fonts
      if (fontDict) {
        await this.extractFonts(pdfDoc, fontDict);
      }

      // Get layer map from Properties
      const layerMap = this.buildLayerMap(pdfDoc, xobjResources);

      // Decode and parse the XObject content
      const content = this.decodeStream(xobjObj);
      if (content) {
        this.parseContentStream(content, fontDict, pdfDoc, layerMap, pageIndex);
      }
    }
  }

  /**
   * Extract text from content streams (2024 format)
   */
  async extractFromContentStreams(pdfDoc, page, resources, pageIndex) {
    // Extract fonts from page resources
    const fontDict = resources.get(PDFName.of('Font'));
    if (fontDict) {
      await this.extractFonts(pdfDoc, fontDict);
    }

    // Get layer map
    const layerMap = this.buildLayerMap(pdfDoc, resources);

    // Get content streams
    const contents = page.node.get(PDFName.of('Contents'));
    if (!contents) return;

    const streams = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const streamRef = contents.get(i);
        const stream = pdfDoc.context.lookup(streamRef);
        if (stream) streams.push(stream);
      }
    } else {
      const stream = pdfDoc.context.lookup(contents);
      if (stream) streams.push(stream);
    }

    // Parse each content stream
    for (const stream of streams) {
      const content = this.decodeStream(stream);
      if (content) {
        this.parseContentStream(content, fontDict, pdfDoc, layerMap, pageIndex);
      }
    }
  }

  /**
   * Extract font information
   */
  async extractFonts(pdfDoc, fontDict) {
    if (!fontDict) return;

    const entries = fontDict instanceof PDFDict ? Array.from(fontDict.entries()) : [];

    for (const [fontRef, fontObjRef] of entries) {
      const fontName = fontRef.toString();

      // Skip if already processed
      if (this.fontDetails[fontName]) continue;

      const fontObj = pdfDoc.context.lookup(fontObjRef);
      if (!(fontObj instanceof PDFDict)) continue;

      const info = { ref: fontName, name: fontName };

      // BaseFont
      const baseFont = fontObj.get(PDFName.of('BaseFont'));
      if (baseFont) {
        info.baseFont = baseFont.toString().replace('/', '');
        info.name = info.baseFont;
      }

      // Subtype
      const subtype = fontObj.get(PDFName.of('Subtype'));
      if (subtype) {
        info.subtype = subtype.toString().replace('/', '');
      }

      // For Type0 fonts, default to 2-byte (4 hex char) encoding
      info.isType0 = info.subtype === 'Type0';
      info.bytesPerChar = info.isType0 ? 2 : 1;

      // Encoding
      const encoding = fontObj.get(PDFName.of('Encoding'));
      if (encoding instanceof PDFName) {
        info.encoding = encoding.toString().replace('/', '');
      }

      // ToUnicode CMap
      const toUnicode = fontObj.get(PDFName.of('ToUnicode'));
      info.hasUnicodeMap = !!toUnicode;

      // Parse ToUnicode CMap if available
      if (toUnicode) {
        const cmapStream = pdfDoc.context.lookup(toUnicode);
        if (cmapStream) {
          const cmapData = this.decodeStream(cmapStream);
          if (cmapData) {
            const cmapResult = this.parseToUnicodeCMap(cmapData);
            info.unicodeMap = cmapResult.map;
            info.bytesPerChar = cmapResult.codespaceBytes;
          }
        }
      }

      // Check for embedded font
      const fontDescriptor = fontObj.get(PDFName.of('FontDescriptor'));
      if (fontDescriptor) {
        const descriptor = pdfDoc.context.lookup(fontDescriptor);
        if (descriptor instanceof PDFDict) {
          const fontFile = descriptor.get(PDFName.of('FontFile')) ||
                          descriptor.get(PDFName.of('FontFile2')) ||
                          descriptor.get(PDFName.of('FontFile3'));
          info.isEmbedded = !!fontFile;
        }
      }

      this.fonts.push(info);
      this.fontDetails[fontName] = info;
    }
  }

  /**
   * Parse ToUnicode CMap to build character mapping
   * Returns { map: {}, codespaceBytes: number }
   */
  parseToUnicodeCMap(cmapData) {
    const result = { map: {}, codespaceBytes: 2 }; // Default to 2-byte for CID fonts

    try {
      // Detect codespace byte width from begincodespacerange
      const codespaceMatch = cmapData.match(/begincodespacerange\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if (codespaceMatch) {
        // Byte width is half the hex string length
        result.codespaceBytes = codespaceMatch[1].length / 2;
      }

      // Parse beginbfchar sections: <src> <dst>
      const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
      let match;
      while ((match = bfcharRegex.exec(cmapData)) !== null) {
        const section = match[1];
        const entries = section.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
        for (const entry of entries) {
          const src = entry[1];
          const dst = entry[2];
          // Convert destination hex to Unicode character
          let char = '';
          for (let i = 0; i < dst.length; i += 4) {
            const codePoint = parseInt(dst.substr(i, 4), 16);
            char += String.fromCodePoint(codePoint);
          }
          result.map[src.toUpperCase()] = char;
        }
      }

      // Parse beginbfrange sections: <start> <end> <dstStart>
      const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
      while ((match = bfrangeRegex.exec(cmapData)) !== null) {
        const section = match[1];
        const entries = section.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
        for (const entry of entries) {
          const start = parseInt(entry[1], 16);
          const end = parseInt(entry[2], 16);
          let dstStart = parseInt(entry[3], 16);

          for (let i = start; i <= end; i++) {
            const srcHex = i.toString(16).toUpperCase().padStart(entry[1].length, '0');
            result.map[srcHex] = String.fromCodePoint(dstStart++);
          }
        }
      }
    } catch (error) {
      console.error('[TextExtractor] Error parsing ToUnicode CMap:', error.message);
    }

    return result;
  }

  /**
   * Build layer map from Properties
   * Properties maps MC IDs to OCMD (Optional Content Membership Dictionary) objects
   * OCMD contains an OCGs array - we use the first OCG's name as the layer
   */
  buildLayerMap(pdfDoc, resources) {
    const layerMap = {};
    if (!resources) return layerMap;

    try {
      const properties = resources.get(PDFName.of('Properties'));
      if (!properties) return layerMap;

      const entries = properties instanceof PDFDict ? Array.from(properties.entries()) : [];
      for (const [mcRef, ocmdRef] of entries) {
        const mcName = mcRef.toString().replace('/', '');
        const ocmdDict = pdfDoc.context.lookup(ocmdRef);
        if (!(ocmdDict instanceof PDFDict)) continue;

        // OCMD has OCGs array or single OCG reference
        const ocgs = ocmdDict.get(PDFName.of('OCGs'));
        let ocgDict = null;

        if (ocgs instanceof PDFArray && ocgs.size() > 0) {
          // Array of OCGs - use the first one (most specific layer)
          ocgDict = pdfDoc.context.lookup(ocgs.get(0));
        } else if (ocgs) {
          // Single OCG reference
          ocgDict = pdfDoc.context.lookup(ocgs);
        }

        if (ocgDict instanceof PDFDict) {
          const name = ocgDict.get(PDFName.of('Name'));
          if (name) {
            let nameStr = name.toString().replace(/^\(|\)$/g, '');
            // Handle UTF-16 encoded names
            if (nameStr.startsWith('þÿ') || nameStr.startsWith('\xFE\xFF')) {
              const utf16Data = nameStr.slice(2);
              const utf16Bytes = Buffer.from(utf16Data, 'latin1');
              nameStr = utf16Bytes.swap16().toString('utf16le');
            }
            layerMap[mcName] = nameStr;
          }
        }
      }
    } catch (error) {
      console.error('[TextExtractor] Error building layer map:', error.message);
    }

    return layerMap;
  }

  /**
   * Decode a PDF stream
   */
  decodeStream(stream) {
    try {
      let data;
      if (stream instanceof PDFRawStream) {
        data = stream.contents;
      } else if (stream.getContents) {
        data = stream.getContents();
      } else {
        return null;
      }

      const filter = stream.dict?.get(PDFName.of('Filter'));
      if (filter?.toString() === '/FlateDecode') {
        try {
          data = pako.inflate(data);
        } catch (e) {
          // May already be decompressed
        }
      }

      return Buffer.from(data).toString('latin1');
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse content stream for text
   */
  parseContentStream(content, fontDict, pdfDoc, layerMap, pageIndex) {
    // State
    let inTextObject = false;
    let currentFont = null;
    let currentFontSize = 12;
    let textMatrix = [1, 0, 0, 1, 0, 0];
    let textLineMatrix = [1, 0, 0, 1, 0, 0];
    let currentLayer = null;
    const markedContentStack = [];

    const tokens = this.tokenize(content);
    const operandStack = [];

    for (const token of tokens) {
      if (this.isOperator(token)) {
        switch (token) {
          case 'BT':
            inTextObject = true;
            textMatrix = [1, 0, 0, 1, 0, 0];
            textLineMatrix = [1, 0, 0, 1, 0, 0];
            break;

          case 'ET':
            inTextObject = false;
            break;

          case 'Tf':
            if (operandStack.length >= 2) {
              currentFont = operandStack[operandStack.length - 2];
              currentFontSize = parseFloat(operandStack[operandStack.length - 1]);
            }
            break;

          case 'Tm':
            if (operandStack.length >= 6) {
              textMatrix = operandStack.slice(-6).map(parseFloat);
              textLineMatrix = [...textMatrix];
            }
            break;

          case 'Td':
          case 'TD':
            if (operandStack.length >= 2) {
              const tx = parseFloat(operandStack[operandStack.length - 2]);
              const ty = parseFloat(operandStack[operandStack.length - 1]);
              textLineMatrix[4] += tx;
              textLineMatrix[5] += ty;
              textMatrix = [...textLineMatrix];
            }
            break;

          case 'T*':
            textLineMatrix[5] -= currentFontSize * 1.2;
            textMatrix = [...textLineMatrix];
            break;

          case 'Tj':
            if (inTextObject && operandStack.length >= 1) {
              const rawText = operandStack[operandStack.length - 1];
              const text = this.decodeText(rawText, currentFont);
              if (text && text.trim()) {
                this.textElements.push({
                  text,
                  x: textMatrix[4],
                  y: textMatrix[5],
                  font: currentFont,
                  fontSize: currentFontSize,
                  layer: currentLayer,
                  page: pageIndex
                });
              }
            }
            break;

          case 'TJ':
            if (inTextObject) {
              // TJ uses an array, join operand stack
              const arrayStr = operandStack.join(' ');
              const textMatches = arrayStr.matchAll(/<([0-9A-Fa-f]+)>|\(([^)]*)\)/g);

              let combinedText = '';
              for (const match of textMatches) {
                if (match[1]) {
                  // Hex string
                  combinedText += this.decodeText(`<${match[1]}>`, currentFont);
                } else if (match[2] !== undefined) {
                  // Literal string
                  combinedText += this.decodeText(`(${match[2]})`, currentFont);
                }
              }

              if (combinedText && combinedText.trim()) {
                this.textElements.push({
                  text: combinedText,
                  x: textMatrix[4],
                  y: textMatrix[5],
                  font: currentFont,
                  fontSize: currentFontSize,
                  layer: currentLayer,
                  page: pageIndex
                });
              }
            }
            break;

          case 'BDC':
            if (operandStack.length >= 2) {
              const tag = operandStack[operandStack.length - 2];
              const props = operandStack[operandStack.length - 1];
              markedContentStack.push({ tag, props });

              if (tag === '/OC' && props) {
                const mcRef = props.replace('/', '');
                if (layerMap[mcRef]) {
                  currentLayer = layerMap[mcRef];
                }
              }
            }
            break;

          case 'BMC':
            if (operandStack.length >= 1) {
              markedContentStack.push({ tag: operandStack[operandStack.length - 1] });
            }
            break;

          case 'EMC':
            markedContentStack.pop();
            // Update current layer
            currentLayer = null;
            for (let i = markedContentStack.length - 1; i >= 0; i--) {
              if (markedContentStack[i].tag === '/OC' && markedContentStack[i].props) {
                const mcRef = markedContentStack[i].props.replace('/', '');
                if (layerMap[mcRef]) {
                  currentLayer = layerMap[mcRef];
                  break;
                }
              }
            }
            break;
        }
        operandStack.length = 0;
      } else {
        operandStack.push(token);
      }
    }
  }

  /**
   * Decode text string using font's ToUnicode map if available
   */
  decodeText(pdfString, fontRef) {
    if (!pdfString) return '';

    const fontInfo = this.fontDetails[fontRef];
    const unicodeMap = fontInfo?.unicodeMap;
    // Hex chars per character: bytesPerChar * 2 (e.g., 2 bytes = 4 hex chars)
    const hexCharsPerChar = (fontInfo?.bytesPerChar || 1) * 2;

    // Hex string
    if (pdfString.startsWith('<') && pdfString.endsWith('>')) {
      const hexContent = pdfString.slice(1, -1).replace(/\s/g, '');
      let result = '';

      if (unicodeMap && Object.keys(unicodeMap).length > 0) {
        // Use ToUnicode mapping with detected byte width
        for (let i = 0; i < hexContent.length; i += hexCharsPerChar) {
          const code = hexContent.substr(i, hexCharsPerChar).toUpperCase();
          if (unicodeMap[code]) {
            result += unicodeMap[code];
          } else {
            // Fallback: try interpreting as direct Unicode code point
            const codePoint = parseInt(code, 16);
            if (codePoint > 0 && codePoint < 0xFFFF) {
              result += String.fromCodePoint(codePoint);
            } else {
              result += '?';
            }
          }
        }
      } else if (fontInfo?.isType0) {
        // Type0 font without ToUnicode map - try direct 2-byte Unicode interpretation
        for (let i = 0; i < hexContent.length; i += 4) {
          const codePoint = parseInt(hexContent.substr(i, 4), 16);
          if (codePoint > 0 && codePoint < 0xFFFF) {
            result += String.fromCodePoint(codePoint);
          }
        }
      } else {
        // Simple font - direct byte to char conversion
        for (let i = 0; i < hexContent.length; i += 2) {
          const byte = parseInt(hexContent.substr(i, 2), 16);
          result += String.fromCharCode(byte);
        }
      }
      return result;
    }

    // Literal string
    if (pdfString.startsWith('(') && pdfString.endsWith(')')) {
      let str = pdfString.slice(1, -1);

      // Decode escape sequences
      str = str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/\\([0-7]{1,3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)));

      return str;
    }

    return pdfString;
  }

  /**
   * Tokenize content stream
   */
  tokenize(content) {
    const tokens = [];
    const regex = /(<[0-9A-Fa-f\s]*>)|([+-]?\d+\.?\d*)|(\[|\])|(\((?:[^()\\]|\\.)*\))|\/([^\s\[\]()<>\/{}%]+)|([a-zA-Z'*"][a-zA-Z0-9'"]*)|\s+/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      const token = match[0].trim();
      if (token) tokens.push(token);
    }

    return tokens;
  }

  /**
   * Check if token is an operator
   */
  isOperator(token) {
    const ops = ['BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'T*', 'Tj', 'TJ', "'", '"',
                 'Tc', 'Tw', 'Tz', 'TL', 'Tr', 'Ts', 'BDC', 'BMC', 'EMC', 'q', 'Q', 'cm', 'Do'];
    return ops.includes(token);
  }
}

module.exports = TextExtractor;
