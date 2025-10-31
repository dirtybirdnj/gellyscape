const { PDFDocument, PDFName } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const zlib = require('zlib');
const RasterExtractor = require('./raster-extractor');
const VectorExtractor = require('./vector-extractor');
const PDFContentParser = require('./pdf-content-parser');

class PDFProcessor {
  constructor(buffer) {
    this.buffer = buffer;
    this.pdfDoc = null;
    this.metadata = {};
    this.layers = [];
    this.progressCallback = null;
  }

  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  reportProgress(operation, detail, progress = null) {
    if (this.progressCallback) {
      this.progressCallback({
        operation,
        detail,
        progress
      });
    }
  }

  async process() {
    try {
      this.reportProgress('Loading PDF', 'Reading file structure...');

      // Load PDF with pdf-lib for structure access
      this.pdfDoc = await PDFDocument.load(this.buffer);

      this.reportProgress('Parsing Metadata', 'Analyzing PDF properties...');

      // Parse PDF with pdf-parse for metadata
      const pdfData = await pdfParse(this.buffer);

      // Extract metadata
      await this.extractMetadata(pdfData);

      const pageCount = this.pdfDoc.getPageCount();
      this.reportProgress('Extracting Layers', `Found ${pageCount} page${pageCount !== 1 ? 's' : ''}. Identifying layers...`);

      // Identify and extract layers
      await this.identifyLayers();

      this.reportProgress('Processing Raster Data', 'Extracting raster layers...');

      // Extract raster data
      const rasterExtractor = new RasterExtractor(this.pdfDoc, this.buffer);
      const rasterLayers = await rasterExtractor.extract();

      this.reportProgress('Processing Vector Data', 'Extracting vector annotations...');

      // Extract vector data using annotation extractor
      const vectorExtractor = new VectorExtractor(this.pdfDoc, this.buffer);
      const vectorLayers = await vectorExtractor.extract();

      this.reportProgress('Extracting Content Paths', 'Parsing content streams (this may take a while)...');

      // Extract vector paths from content streams
      const contentPaths = await this.extractContentPaths();

      return {
        metadata: this.metadata,
        rasterLayers,
        vectorLayers,
        contentPaths, // New: paths extracted from content streams
        layerNames: this.layerNames || {}, // Optional Content Groups (layers)
        pageCount: this.pdfDoc.getPageCount(),
        info: pdfData.info
      };
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw error;
    }
  }

  async extractMetadata(pdfData) {
    try {
      // Extract basic PDF metadata
      this.metadata = {
        title: pdfData.info?.Title || 'Unknown',
        creator: pdfData.info?.Creator || 'Unknown',
        producer: pdfData.info?.Producer || 'Unknown',
        creationDate: pdfData.info?.CreationDate || null,
        modificationDate: pdfData.info?.ModDate || null,
        pageCount: pdfData.numpages,
        version: pdfData.info?.PDFFormatVersion || 'Unknown',
        fileSize: this.buffer.length // File size in bytes
      };

      // Extract page dimensions from first page
      const pages = this.pdfDoc.getPages();
      if (pages.length > 0) {
        const firstPage = pages[0];
        const { width, height } = firstPage.getSize();

        // PDF dimensions are in points (1 point = 1/72 inch)
        this.metadata.pageDimensions = {
          widthPt: width,
          heightPt: height,
          widthIn: width / 72,
          heightIn: height / 72,
          widthMm: (width / 72) * 25.4,
          heightMm: (height / 72) * 25.4
        };

        // Check for different page boxes
        const pageDict = firstPage.node.dict;
        const mediaBox = pageDict.get(PDFName.of('MediaBox'));
        const cropBox = pageDict.get(PDFName.of('CropBox'));
        const trimBox = pageDict.get(PDFName.of('TrimBox'));
        const bleedBox = pageDict.get(PDFName.of('BleedBox'));
        const artBox = pageDict.get(PDFName.of('ArtBox'));

        this.metadata.pageBoxes = {
          hasMediaBox: !!mediaBox,
          hasCropBox: !!cropBox,
          hasTrimBox: !!trimBox,
          hasBleedBox: !!bleedBox,
          hasArtBox: !!artBox
        };
      }

      // Look for GeoPDF specific metadata
      await this.extractGeospatialMetadata();

      // Extract Optional Content Groups (layers)
      await this.extractOptionalContent();
    } catch (error) {
      console.error('Error extracting metadata:', error);
      this.metadata = { error: error.message };
    }
  }

  async extractGeospatialMetadata() {
    try {
      // GeoPDF files contain geospatial information in:
      // 1. LGIDict (Layer Geospatial Information Dictionary)
      // 2. VP (Viewport) entries
      // 3. Measure dictionary

      const catalog = this.pdfDoc.catalog;

      // Access the catalog's raw dictionary to look for geospatial info
      const catalogDict = catalog.dict;

      // Look for VP (Viewport) array - contains projection info
      const vpValue = catalogDict.get(PDFName.of('VP'));
      if (vpValue) {
        this.metadata.hasViewport = true;
      }

      // Look for LGIDict - Layer Geospatial Information
      const lgiValue = catalogDict.get(PDFName.of('LGIDict'));
      if (lgiValue) {
        this.metadata.hasLGIDict = true;
        this.metadata.isGeoPDF = true;
      }

      // Check for Measure dictionary in pages
      const pages = this.pdfDoc.getPages();
      if (pages.length > 0) {
        const firstPage = pages[0];
        const pageDict = firstPage.node.dict;

        // Look for Measure key
        const measureValue = pageDict.get(PDFName.of('Measure'));
        if (measureValue) {
          this.metadata.hasMeasure = true;
          this.metadata.isGeoPDF = true;
        }
      }

      // If we found any geospatial markers, mark as GeoPDF
      if (this.metadata.hasViewport || this.metadata.hasLGIDict || this.metadata.hasMeasure) {
        this.metadata.isGeoPDF = true;
      }

    } catch (error) {
      console.error('Error extracting geospatial metadata:', error);
      // Non-fatal, continue processing
    }
  }

  async extractOptionalContent() {
    try {
      console.log('\n=== EXTRACTING OPTIONAL CONTENT (LAYERS) ===');

      const catalog = this.pdfDoc.catalog;
      const catalogDict = catalog.dict;

      // Get OCProperties (Optional Content Properties)
      const ocProperties = catalogDict.get(PDFName.of('OCProperties'));

      if (!ocProperties) {
        console.log('No OCProperties found - PDF has no layer information');
        this.layerNames = {};
        return;
      }

      console.log('✓ Found OCProperties');

      // Get OCGs (Optional Content Groups) array
      const ocgs = ocProperties.get(PDFName.of('OCGs'));

      if (!ocgs || !ocgs.array) {
        console.log('No OCGs array found');
        this.layerNames = {};
        return;
      }

      console.log(`✓ Found ${ocgs.array.length} Optional Content Groups`);

      // OPTION 3: Explore OCProperties structure for Order, Usage, etc.
      console.log('\n=== EXPLORING OCProperties STRUCTURE (Option 3) ===');

      // Check for D (Default viewing) dictionary
      const dDict = ocProperties.get(PDFName.of('D'));
      if (dDict) {
        console.log('✓ Found D (Default viewing) dictionary');

        // Check for Order array
        const order = dDict.get(PDFName.of('Order'));
        if (order && order.array) {
          console.log(`  Order array length: ${order.array.length}`);
          console.log('  First 5 order entries:', order.array.slice(0, 5).map(o => o?.toString()));
        }

        // Check for ON array (initially visible layers)
        const onArray = dDict.get(PDFName.of('ON'));
        if (onArray && onArray.array) {
          console.log(`  ON array length: ${onArray.array.length}`);
        }

        // Check for OFF array
        const offArray = dDict.get(PDFName.of('OFF'));
        if (offArray && offArray.array) {
          console.log(`  OFF array length: ${offArray.array.length}`);
        }

        // Check for Intent
        const intent = dDict.get(PDFName.of('Intent'));
        if (intent) {
          console.log(`  Intent: ${intent.toString()}`);
        }

        // Check for BaseState
        const baseState = dDict.get(PDFName.of('BaseState'));
        if (baseState) {
          console.log(`  BaseState: ${baseState.toString()}`);
        }
      }

      // Check for Configs array
      const configs = ocProperties.get(PDFName.of('Configs'));
      if (configs) {
        console.log('✓ Found Configs array');
      }

      // OPTION 4: Check pdf-lib catalog methods
      console.log('\n=== CHECKING PDF-LIB CATALOG METHODS (Option 4) ===');
      console.log('Catalog object keys:', Object.keys(catalog));
      console.log('Catalog dict keys:', catalog.dict ? Object.keys(catalog.dict) : 'N/A');
      console.log('Available methods on catalog:', Object.getOwnPropertyNames(Object.getPrototypeOf(catalog)));

      this.layerNames = {};

      // Extract each OCG
      for (let i = 0; i < ocgs.array.length; i++) {
        const ocgRef = ocgs.array[i];
        const ocg = this.pdfDoc.context.lookup(ocgRef);

        if (!ocg || !ocg.dict) continue;

        // Get the name of this layer
        const name = ocg.dict.get(PDFName.of('Name'));
        let nameStr = `Layer${i}`;

        if (name) {
          // Get the raw value - pdf-lib returns PDFString objects with .value as a JavaScript string
          let rawValue = name.value || name.toString();

          // Check for UTF-16 BOM (þÿ characters at the start)
          if (rawValue.startsWith('þÿ')) {
            // UTF-16 Big Endian - skip the BOM characters and decode the rest
            // The string contains UTF-16 BE data: þÿ + pairs of bytes like \x00L\x00a\x00b...
            const utf16Data = rawValue.slice(2); // Skip þÿ BOM

            // Convert string to buffer (using latin1 to preserve byte values)
            // Then swap bytes from big-endian to little-endian and decode
            const utf16Bytes = Buffer.from(utf16Data, 'latin1');
            nameStr = utf16Bytes.swap16().toString('utf16le');
          } else {
            // Regular ASCII/latin1 string
            nameStr = rawValue;
          }

          // Clean up any PDF string delimiters if present
          if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
            nameStr = nameStr.slice(1, -1);
          }
        }

        // Store mapping from OCG reference to name
        const ocgId = ocgRef.toString();
        this.layerNames[ocgId] = nameStr;

        console.log(`  Layer ${i + 1}: ${nameStr} (${ocgId})`);
      }

      console.log(`\nTotal layers extracted: ${Object.keys(this.layerNames).length}`);

    } catch (error) {
      console.error('Error extracting optional content:', error);
      this.layerNames = {};
    }
  }

  async identifyLayers() {
    try {
      // In GeoPDF, layers are typically stored as Optional Content Groups (OCGs)
      const pages = this.pdfDoc.getPages();

      this.layers = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageDict = page.node.dict;

        // Check for Resources -> XObject entries (images and forms)
        const resources = pageDict.get(PDFName.of('Resources'));

        if (resources) {
          const xObject = resources.get(PDFName.of('XObject'));

          if (xObject) {
            // XObjects can be images (raster) or forms (vector)
            this.layers.push({
              page: i,
              type: 'mixed',
              hasResources: true
            });
          }
        }
      }
    } catch (error) {
      console.error('Error identifying layers:', error);
      // Non-fatal, continue processing
    }
  }

  async extractContentPaths() {
    const allPaths = [];
    const allTextObjects = [];
    const allFontDetails = {}; // Collect fontDetails from all pages

    try {
      const pages = this.pdfDoc.getPages();

      console.log(`\n=== EXTRACTING CONTENT PATHS ===`);
      console.log(`Total pages: ${pages.length}\n`);

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        console.log(`--- Page ${pageIndex + 1}/${pages.length} ---`);

        this.reportProgress(
          'Processing Page Content',
          `Page ${pageIndex + 1} of ${pages.length}`,
          { current: pageIndex + 1, total: pages.length }
        );

        const page = pages[pageIndex];
        const pageDict = page.node.dict;

        // Get the page's content stream(s)
        const contents = pageDict.get(PDFName.of('Contents'));
        console.log(`Contents type: ${contents?.constructor?.name || 'null'}`);

        if (!contents) {
          console.log(`❌ No content stream found\n`);
          continue;
        }

        // Contents can be a single stream or an array of streams
        let streams = [];
        if (Array.isArray(contents)) {
          streams = contents;
          console.log(`✓ Array of ${streams.length} streams`);
        } else if (contents.array) {
          streams = contents.array;
          console.log(`✓ PDFArray with ${streams.length} streams`);
        } else {
          streams = [contents];
          console.log(`✓ Single stream`);
        }

        for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
          const streamRef = streams[streamIndex];
          console.log(`  Stream ${streamIndex + 1}/${streams.length}:`);

          try {
            // Look up the actual stream object
            const stream = this.pdfDoc.context.lookup(streamRef);
            console.log(`    Type: ${stream?.constructor?.name || 'null'}`);

            if (!stream) {
              console.log(`    ⚠️ Stream not found`);
              continue;
            }

            // Get raw stream contents
            let contentData = null;
            try {
              const rawContent = stream.getContents ? stream.getContents() : stream.contents;

              if (!rawContent) {
                console.log(`    ⚠️ No contents available`);
                continue;
              }

              console.log(`    Raw buffer size: ${rawContent.length} bytes`);

              // Check if stream is compressed
              const filter = stream.dict?.get(PDFName.of('Filter'));
              console.log(`    Filter: ${filter?.toString() || 'none'}`);

              if (filter && filter.toString() === '/FlateDecode') {
                try {
                  contentData = zlib.inflateSync(Buffer.from(rawContent));
                  console.log(`    ✓ Decompressed: ${rawContent.length} → ${contentData.length} bytes`);
                } catch (zlibError) {
                  console.error(`    ❌ Decompression failed:`, zlibError.message);
                  continue;
                }
              } else {
                contentData = Buffer.from(rawContent);
                console.log(`    No compression, using raw data`);
              }
            } catch (contentError) {
              console.error(`    ❌ Error getting contents:`, contentError.message);
              continue;
            }

            const preview = contentData.slice(0, 100).toString('utf-8').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
            console.log(`    Preview: ${preview.substring(0, 80)}...`);

            // Get page resources for marked content mapping
            const resources = pageDict.get(PDFName.of('Resources'));
            console.log(`    Resources found: ${!!resources}`);
            const properties = resources?.get(PDFName.of('Properties'));
            console.log(`    Properties found: ${!!properties}`);

            // Get font dictionary for font name extraction
            const fontDict = resources?.get(PDFName.of('Font'));
            console.log(`    Font dictionary found: ${!!fontDict}`);

            // Build mapping from /MC references to layer names
            const mcToLayerMap = {};
            if (properties) {
              const propDict = this.pdfDoc.context.lookup(properties);
              console.log(`    PropDict type: ${propDict?.constructor?.name}`);

              if (propDict) {
                // pdf-lib PDFDict uses Map internally, iterate with entries()
                const entries = propDict.entries ? Array.from(propDict.entries()) : [];
                console.log(`    Property entries count: ${entries.length}`);

                // Debug: Show what we have in layerNames
                const layerNameKeys = Object.keys(this.layerNames).slice(0, 3);
                console.log(`    Available layer IDs (first 3): ${layerNameKeys.join(', ')}`);

                console.log('\n    === DEEP DIVE INTO PROPERTIES DICTIONARY ===');

                for (const [key, value] of entries) {
                  const mcName = key.toString(); // e.g., "/MC0"
                  const ocgRef = value;

                  // Debug: Show first few entries in detail
                  if (entries.indexOf([key, value]) < 3) {
                    console.log(`\n      Property entry: ${mcName}`);
                    console.log(`        Value type: ${ocgRef?.constructor?.name}`);
                    console.log(`        Value toString: ${ocgRef?.toString()}`);

                    // Try to dereference this object to see what's inside
                    const derefObj = this.pdfDoc.context.lookup(ocgRef);
                    if (derefObj) {
                      console.log(`        Dereferenced type: ${derefObj?.constructor?.name}`);

                      // If it's a dict, show what keys it has
                      if (derefObj.dict) {
                        const dictKeys = [];
                        for (const [k, v] of derefObj.dict.entries()) {
                          dictKeys.push(k.toString());
                        }
                        console.log(`        Dict keys: ${dictKeys.join(', ')}`);

                        // Check for OCG key
                        const ocgKey = derefObj.dict.get(PDFName.of('OCG'));
                        if (ocgKey) {
                          console.log(`        ✓ Has OCG key: ${ocgKey.toString()}`);
                        }

                        // Check for Type key
                        const typeKey = derefObj.dict.get(PDFName.of('Type'));
                        if (typeKey) {
                          console.log(`        Type: ${typeKey.toString()}`);
                        }
                      }
                    }
                  }

                  // OPTION 1 IMPLEMENTATION: Dereference the OCMD and get the OCG reference
                  const ocmdDict = this.pdfDoc.context.lookup(ocgRef);
                  if (ocmdDict && ocmdDict.dict) {
                    // Get the /OCGs key - this contains the actual OCG reference(s)
                    const ocgsValue = ocmdDict.dict.get(PDFName.of('OCGs'));

                    if (ocgsValue) {
                      // OCGs can be either a single reference or an array of references
                      let ocgRefArray = [];

                      if (ocgsValue.array) {
                        // It's an array
                        ocgRefArray = ocgsValue.array;
                      } else {
                        // It's a single reference
                        ocgRefArray = [ocgsValue];
                      }

                      // Try to map using the first OCG reference
                      if (ocgRefArray.length > 0) {
                        const firstOcgRef = ocgRefArray[0];
                        const ocgId = firstOcgRef.toString();

                        if (this.layerNames[ocgId]) {
                          mcToLayerMap[mcName] = this.layerNames[ocgId];
                          // Only log the first few to avoid spam
                          if (Object.keys(mcToLayerMap).length <= 5) {
                            console.log(`      ✓ ${mcName} -> ${this.layerNames[ocgId]}`);
                          }
                        }
                      }
                    }
                  }
                }
              }
            } else {
              console.log(`    ⚠️ No Properties dictionary found in Resources`);
            }

            console.log(`    Layer map has ${Object.keys(mcToLayerMap).length} entries`);
            if (Object.keys(mcToLayerMap).length > 0 && Object.keys(mcToLayerMap).length <= 5) {
              console.log(`    Sample mapping:`, mcToLayerMap);
            }

            // Parse the content stream
            console.log(`    📝 Parsing with PDFContentParser...`);
            const parser = new PDFContentParser({
              layerMap: mcToLayerMap,
              pdfContext: this.pdfDoc.context,
              fontDict: fontDict
            });
            const {paths, textObjects, fontDetails} = parser.parseContentStream(contentData);

            console.log(`    ✓ Found ${paths.length} paths and ${textObjects.length} text objects`);
            if (paths.length > 0) {
              const firstPath = paths[0];
              const subpathCount = firstPath.subpaths?.length || 0;
              const segmentCount = firstPath.subpaths?.[0]?.segments?.length || 0;
              console.log(`    First path: ${subpathCount} subpaths, first subpath has ${segmentCount} segments, operation: ${firstPath.operation}`);
            }

            // Convert paths to renderer format
            const convertedPaths = paths
              .map(path => {
                path.page = pageIndex;
                return this.convertPathFormat(path);
              })
              .filter(path => path !== null); // Remove paths with no subpaths

            allPaths.push(...convertedPaths);

            // Add page number to text objects and collect them
            textObjects.forEach(textObj => {
              textObj.page = pageIndex;
            });
            allTextObjects.push(...textObjects);

            // Merge fontDetails from this stream into allFontDetails
            if (fontDetails) {
              Object.assign(allFontDetails, fontDetails);
            }
          } catch (streamError) {
            console.error(`    ❌ Error:`, streamError.message);
            console.error(streamError.stack);
          }
        }
        console.log();
      }

      console.log(`\nTotal paths extracted: ${allPaths.length}`);

      // Group paths by page for easier access
      const pathsByPage = {};
      allPaths.forEach(path => {
        if (!pathsByPage[path.page]) {
          pathsByPage[path.page] = [];
        }
        pathsByPage[path.page].push(path);
      });

      console.log(`\nTotal text objects extracted: ${allTextObjects.length}`);

      // Group text objects by layer
      const textObjectsByLayer = {};
      allTextObjects.forEach(textObj => {
        const layerName = textObj.layer || 'Text (No Layer)';
        if (!textObjectsByLayer[layerName]) {
          textObjectsByLayer[layerName] = [];
        }
        textObjectsByLayer[layerName].push(textObj);
      });

      const textLayerNames = Object.keys(textObjectsByLayer);
      console.log(`Text organized into ${textLayerNames.length} layers:`, textLayerNames);

      this.reportProgress(
        'Finalizing',
        `Extracted ${allPaths.length} paths and ${allTextObjects.length} text objects`
      );

      return {
        paths: allPaths,
        pathsByPage,
        statistics: this.generatePathStatistics(allPaths),
        textObjects: allTextObjects,
        textObjectsByLayer, // Add grouped text objects
        fontDetails: allFontDetails // Add merged font details
      };

    } catch (error) {
      console.error('Error extracting content paths:', error);
      return {
        paths: [],
        pathsByPage: {},
        statistics: {},
        textObjects: [],
        textObjectsByLayer: {},
        fontDetails: {},
        error: error.message
      };
    }
  }

  convertPathFormat(path) {
    // Convert from parser's subpaths format to renderer's operations format
    const operations = [];

    if (!path.subpaths || path.subpaths.length === 0) {
      return null;
    }

    // Helper to apply transformation matrix to a point
    const transformPoint = (point, transform) => {
      if (!transform) return point;

      // Apply transformation matrix
      let x = transform.a * point.x + transform.c * point.y + transform.e;
      let y = transform.b * point.x + transform.d * point.y + transform.f;

      // Flip Y axis (PDF origin is bottom-left, SVG is top-left)
      // Negate Y to flip vertically
      y = -y;

      return { x, y };
    };

    path.subpaths.forEach(subpath => {
      // Add moveto for start point
      if (subpath.startPoint) {
        const pt = transformPoint(subpath.startPoint, path.transform);
        operations.push({
          type: 'moveto',
          x: pt.x,
          y: pt.y
        });
      }

      // Add segments
      subpath.segments.forEach(segment => {
        if (segment.type === 'line') {
          const pt = transformPoint(segment.point, path.transform);
          operations.push({
            type: 'lineto',
            x: pt.x,
            y: pt.y
          });
        } else if (segment.type === 'cubic') {
          const cp1 = transformPoint(segment.cp1, path.transform);
          const cp2 = transformPoint(segment.cp2, path.transform);
          const pt = transformPoint(segment.point, path.transform);
          operations.push({
            type: 'curveto',
            x1: cp1.x,
            y1: cp1.y,
            x2: cp2.x,
            y2: cp2.y,
            x3: pt.x,
            y3: pt.y
          });
        }
      });

      // Add closepath if closed
      if (subpath.closed) {
        operations.push({ type: 'closepath' });
      }
    });

    // Convert colors from hex to RGB arrays
    const hexToRgb = (hex) => {
      if (!hex || !hex.startsWith('#')) return [0, 0, 0];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };

    return {
      operations,
      fill: path.operation === 'fill' || path.operation === 'fill-stroke',
      fillColor: path.style.fill ? hexToRgb(path.style.fill) : [0, 0, 0],
      stroke: path.operation === 'stroke' || path.operation === 'fill-stroke',
      strokeColor: path.style.stroke ? hexToRgb(path.style.stroke) : [0, 0, 0],
      strokeWidth: path.style.strokeWidth || 1,
      page: path.page,
      layer: path.layer // Include the layer name
    };
  }

  generatePathStatistics(paths) {
    const stats = {
      total: paths.length,
      byOperation: {},
      byColor: {},
      averageOperations: 0
    };

    let totalOperations = 0;

    paths.forEach(path => {
      // Count by operation type (fill, stroke, fill-stroke)
      let op = 'unknown';
      if (path.fill && path.stroke) {
        op = 'fill-stroke';
      } else if (path.fill) {
        op = 'fill';
      } else if (path.stroke) {
        op = 'stroke';
      }
      stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;

      // Count by color
      if (path.fill && path.fillColor) {
        const color = `rgb(${path.fillColor.join(',')})`;
        if (!stats.byColor[color]) {
          stats.byColor[color] = { fill: 0, stroke: 0 };
        }
        stats.byColor[color].fill++;
      }

      if (path.stroke && path.strokeColor) {
        const color = `rgb(${path.strokeColor.join(',')})`;
        if (!stats.byColor[color]) {
          stats.byColor[color] = { fill: 0, stroke: 0 };
        }
        stats.byColor[color].stroke++;
      }

      // Count operations
      if (path.operations) {
        totalOperations += path.operations.length;
      }
    });

    stats.averageOperations = paths.length > 0 ? (totalOperations / paths.length).toFixed(2) : 0;

    return stats;
  }
}

module.exports = PDFProcessor;
