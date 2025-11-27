const { PDFDocument, PDFName } = require('pdf-lib');
const zlib = require('zlib');
const RasterExtractor = require('./raster-extractor');
const VectorExtractor = require('./vector-extractor');
const PDFContentParser = require('./pdf-content-parser');
const USGSFormatDetector = require('./usgs-format-detector');

// Note: pdf-parse removed - it caused "No PDFJS.workerSrc" errors in Electron renderer
// All metadata is now extracted from pdf-lib which works in both main and renderer processes

// Set to true for verbose debug logging (impacts performance on large files)
const DEBUG_LOGGING = false;

class PDFProcessor {
  constructor(buffer) {
    this.buffer = buffer;
    this.pdfDoc = null;
    this.metadata = {};
    this.layers = [];
    this.progressCallback = null;
  }

  debug(...args) {
    if (DEBUG_LOGGING) {
      console.log(...args);
    }
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
      // Performance markers for flame chart profiling
      console.time('PDF:TotalProcess');
      console.time('PDF:LoadDocument');

      this.reportProgress('Loading PDF', 'Reading file structure...');

      // Load PDF with pdf-lib for structure access
      this.pdfDoc = await PDFDocument.load(this.buffer);
      console.timeEnd('PDF:LoadDocument');

      console.time('PDF:ExtractMetadata');
      this.reportProgress('Parsing Metadata', 'Analyzing PDF properties...');

      // Extract metadata using pdf-lib (removed pdf-parse to fix Electron renderer compatibility)
      await this.extractMetadata();
      console.timeEnd('PDF:ExtractMetadata');

      const pageCount = this.pdfDoc.getPageCount();
      this.reportProgress('Extracting Layers', `Found ${pageCount} page${pageCount !== 1 ? 's' : ''}. Identifying layers...`);

      console.time('PDF:IdentifyLayers');
      // Identify and extract layers
      await this.identifyLayers();
      console.timeEnd('PDF:IdentifyLayers');

      this.reportProgress('Processing Raster Data', 'Extracting raster layers...');

      console.time('PDF:ExtractRaster');
      // Extract raster data
      const rasterExtractor = new RasterExtractor(this.pdfDoc, this.buffer);
      const rasterLayers = await rasterExtractor.extract();
      console.timeEnd('PDF:ExtractRaster');

      this.reportProgress('Processing Vector Data', 'Extracting vector annotations...');

      console.time('PDF:ExtractVector');
      // Extract vector data using annotation extractor
      const vectorExtractor = new VectorExtractor(this.pdfDoc, this.buffer);
      const vectorLayers = await vectorExtractor.extract();
      console.timeEnd('PDF:ExtractVector');

      this.reportProgress('Extracting Content Paths', 'Parsing content streams (this may take a while)...');

      console.time('PDF:ExtractContentPaths');
      // Extract vector paths from content streams (sync to avoid Promise overhead)
      const contentPaths = this.extractContentPaths();
      console.timeEnd('PDF:ExtractContentPaths');

      console.timeEnd('PDF:TotalProcess');

      return {
        metadata: this.metadata,
        rasterLayers,
        vectorLayers,
        contentPaths, // New: paths extracted from content streams
        layerNames: this.layerNames || {}, // Optional Content Groups (layers)
        pageCount: this.pdfDoc.getPageCount(),
        info: this.metadata // Use extracted metadata instead of pdfData.info
      };
    } catch (error) {
      console.error('Error processing PDF:', error);
      console.timeEnd('PDF:TotalProcess');
      throw error;
    }
  }

  async extractMetadata() {
    try {
      // Extract metadata from pdf-lib
      const pdfLibInfo = {
        Title: this.pdfDoc.getTitle(),
        Creator: this.pdfDoc.getCreator(),
        Producer: this.pdfDoc.getProducer(),
        CreationDate: this.pdfDoc.getCreationDate(),
        ModDate: this.pdfDoc.getModificationDate(),
        Author: this.pdfDoc.getAuthor(),
        Subject: this.pdfDoc.getSubject(),
        Keywords: this.pdfDoc.getKeywords()
      };

      // Detect USGS format
      const formatDetector = new USGSFormatDetector(this.pdfDoc, pdfLibInfo);
      const formatInfo = await formatDetector.detect();

      // Extract basic PDF metadata
      this.metadata = {
        title: pdfLibInfo.Title || 'Unknown',
        creator: pdfLibInfo.Creator || 'Unknown',
        producer: pdfLibInfo.Producer || 'Unknown',
        creationDate: pdfLibInfo.CreationDate || null,
        modificationDate: pdfLibInfo.ModDate || null,
        pageCount: this.pdfDoc.getPageCount(),
        version: 'Unknown', // pdf-lib doesn't expose PDF version directly
        fileSize: this.buffer.length, // File size in bytes
        // USGS format information
        usgsFormat: formatInfo
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

        // Extract actual box coordinates
        const extractBox = (box) => {
          if (!box) return null;
          try {
            const coords = box.asArray().map(n => n.asNumber());
            return {
              x: coords[0],
              y: coords[1],
              width: coords[2] - coords[0],
              height: coords[3] - coords[1]
            };
          } catch (e) {
            return null;
          }
        };

        this.metadata.pageBoxes = {
          hasMediaBox: !!mediaBox,
          hasCropBox: !!cropBox,
          hasTrimBox: !!trimBox,
          hasBleedBox: !!bleedBox,
          hasArtBox: !!artBox,
          mediaBox: extractBox(mediaBox),
          cropBox: extractBox(cropBox),
          trimBox: extractBox(trimBox),
          bleedBox: extractBox(bleedBox),
          artBox: extractBox(artBox)
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
      const catalogDict = catalog.dict;
      const context = this.pdfDoc.context;

      // Helper to extract number from PDF object
      const getNumber = (obj) => {
        if (!obj) return null;
        if (typeof obj.numberValue === 'function') return obj.numberValue();
        if (obj.numberValue !== undefined) return obj.numberValue;
        if (typeof obj.value === 'function') return obj.value();
        if (obj.value !== undefined) return obj.value;
        return null;
      };

      // Helper to extract array of numbers
      const getNumberArray = (arr) => {
        if (!arr || !arr.array) return null;
        return arr.array.map(getNumber).filter(n => n !== null);
      };

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

      // Check for Measure dictionary and Viewport in pages
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

        // Extract Viewport (VP) array from page - contains neatline bounds
        const pageVP = pageDict.get(PDFName.of('VP'));
        if (pageVP && pageVP.array) {
          this.metadata.viewports = [];

          for (let i = 0; i < pageVP.array.length; i++) {
            const vpRef = pageVP.array[i];
            const viewport = context.lookup(vpRef);

            if (viewport && viewport.dict) {
              const vpData = {};

              // Get viewport name
              const nameObj = viewport.dict.get(PDFName.of('Name'));
              if (nameObj) {
                // Decode UTF-16BE string if needed
                let nameStr = nameObj.toString();
                if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
                  nameStr = nameStr.slice(1, -1);
                  // Remove BOM and decode
                  nameStr = nameStr.replace(/þÿ\s*/g, '').replace(/\s+/g, ' ').trim();
                }
                vpData.name = nameStr;
              }

              // Get BBox (neatline bounds in PDF coordinates)
              const bboxObj = viewport.dict.get(PDFName.of('BBox'));
              if (bboxObj) {
                const bbox = getNumberArray(bboxObj);
                if (bbox && bbox.length === 4) {
                  vpData.bbox = {
                    left: bbox[0],
                    bottom: Math.min(bbox[1], bbox[3]),
                    right: bbox[2],
                    top: Math.max(bbox[1], bbox[3]),
                    width: Math.abs(bbox[2] - bbox[0]),
                    height: Math.abs(bbox[3] - bbox[1])
                  };
                }
              }

              // Get Measure dictionary for geographic coordinates
              const measureRef = viewport.dict.get(PDFName.of('Measure'));
              if (measureRef) {
                const measureDict = context.lookup(measureRef);
                if (measureDict && measureDict.dict) {
                  // GPTS = Geographic Points (lat/lon corners)
                  const gptsObj = measureDict.dict.get(PDFName.of('GPTS'));
                  if (gptsObj) {
                    const gpts = getNumberArray(gptsObj);
                    if (gpts && gpts.length >= 8) {
                      // GPTS contains pairs of (lat, lon) for each corner
                      vpData.geoCorners = {
                        bottomLeft: { lat: gpts[0], lon: gpts[1] },
                        topLeft: { lat: gpts[2], lon: gpts[3] },
                        topRight: { lat: gpts[4], lon: gpts[5] },
                        bottomRight: { lat: gpts[6], lon: gpts[7] }
                      };

                      // Calculate geographic bounds
                      const lats = [gpts[0], gpts[2], gpts[4], gpts[6]];
                      const lons = [gpts[1], gpts[3], gpts[5], gpts[7]];
                      vpData.geoBounds = {
                        minLat: Math.min(...lats),
                        maxLat: Math.max(...lats),
                        minLon: Math.min(...lons),
                        maxLon: Math.max(...lons)
                      };
                    }
                  }

                  // Get coordinate system info (GCS)
                  const gcsRef = measureDict.dict.get(PDFName.of('GCS'));
                  if (gcsRef) {
                    const gcsDict = context.lookup(gcsRef);
                    if (gcsDict && gcsDict.dict) {
                      const wktObj = gcsDict.dict.get(PDFName.of('WKT'));
                      if (wktObj) {
                        let wkt = wktObj.toString();
                        if (wkt.startsWith('(') && wkt.endsWith(')')) {
                          wkt = wkt.slice(1, -1);
                        }
                        vpData.projection = wkt.substring(0, 200); // Truncate for readability
                      }
                    }
                  }
                }
              }

              this.metadata.viewports.push(vpData);

              // Set primary neatline from "Map Layers" viewport (usually first)
              if (vpData.name && vpData.name.includes('Map') && vpData.bbox && !this.metadata.neatline) {
                this.metadata.neatline = vpData.bbox;
                this.metadata.geoBounds = vpData.geoBounds;
                this.metadata.projection = vpData.projection;
              }
            }
          }

          // Fallback: use first viewport with bbox as neatline
          if (!this.metadata.neatline && this.metadata.viewports.length > 0) {
            const firstVP = this.metadata.viewports[0];
            if (firstVP.bbox) {
              this.metadata.neatline = firstVP.bbox;
              this.metadata.geoBounds = firstVP.geoBounds;
              this.metadata.projection = firstVP.projection;
            }
          }
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
      this.debug('\n=== EXTRACTING OPTIONAL CONTENT (LAYERS) ===');

      const catalog = this.pdfDoc.catalog;
      const catalogDict = catalog.dict;

      // Get OCProperties (Optional Content Properties)
      const ocProperties = catalogDict.get(PDFName.of('OCProperties'));

      if (!ocProperties) {
        this.debug('No OCProperties found - PDF has no layer information');
        this.layerNames = {};
        return;
      }

      this.debug('✓ Found OCProperties');

      // Get OCGs (Optional Content Groups) array
      const ocgs = ocProperties.get(PDFName.of('OCGs'));

      if (!ocgs || !ocgs.array) {
        this.debug('No OCGs array found');
        this.layerNames = {};
        return;
      }

      this.debug(`✓ Found ${ocgs.array.length} Optional Content Groups`);

      // OPTION 3: Explore OCProperties structure for Order, Usage, etc.
      this.debug('\n=== EXPLORING OCProperties STRUCTURE (Option 3) ===');

      // Check for D (Default viewing) dictionary
      const dDict = ocProperties.get(PDFName.of('D'));
      if (dDict) {
        this.debug('✓ Found D (Default viewing) dictionary');

        // Check for Order array
        const order = dDict.get(PDFName.of('Order'));
        if (order && order.array) {
          this.debug(`  Order array length: ${order.array.length}`);
          this.debug('  First 5 order entries:', order.array.slice(0, 5).map(o => o?.toString()));
        }

        // Check for ON array (initially visible layers)
        const onArray = dDict.get(PDFName.of('ON'));
        if (onArray && onArray.array) {
          this.debug(`  ON array length: ${onArray.array.length}`);
        }

        // Check for OFF array
        const offArray = dDict.get(PDFName.of('OFF'));
        if (offArray && offArray.array) {
          this.debug(`  OFF array length: ${offArray.array.length}`);
        }

        // Check for Intent
        const intent = dDict.get(PDFName.of('Intent'));
        if (intent) {
          this.debug(`  Intent: ${intent.toString()}`);
        }

        // Check for BaseState
        const baseState = dDict.get(PDFName.of('BaseState'));
        if (baseState) {
          this.debug(`  BaseState: ${baseState.toString()}`);
        }
      }

      // Check for Configs array
      const configs = ocProperties.get(PDFName.of('Configs'));
      if (configs) {
        this.debug('✓ Found Configs array');
      }

      // OPTION 4: Check pdf-lib catalog methods
      this.debug('\n=== CHECKING PDF-LIB CATALOG METHODS (Option 4) ===');
      this.debug('Catalog object keys:', Object.keys(catalog));
      this.debug('Catalog dict keys:', catalog.dict ? Object.keys(catalog.dict) : 'N/A');
      this.debug('Available methods on catalog:', Object.getOwnPropertyNames(Object.getPrototypeOf(catalog)));

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

        this.debug(`  Layer ${i + 1}: ${nameStr} (${ocgId})`);
      }

      this.debug(`\nTotal layers extracted: ${Object.keys(this.layerNames).length}`);

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

  /**
   * Extract content paths from PDF - optimized for performance
   * PERFORMANCE NOTE: This method is synchronous internally to avoid Promise overhead.
   * The trace analysis showed 14.7s spent in RunMicrotasks due to excessive async/await.
   */
  extractContentPaths() {
    const allPaths = [];
    const allTextObjects = [];
    const allFontDetails = {}; // Collect fontDetails from all pages

    try {
      const pages = this.pdfDoc.getPages();

      this.debug(`\n=== EXTRACTING CONTENT PATHS ===`);
      this.debug(`Total pages: ${pages.length}\n`);

      // Process all pages synchronously to avoid Promise overhead
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        this.debug(`--- Page ${pageIndex + 1}/${pages.length} ---`);

        // Report progress (this is still sync - just a callback)
        this.reportProgress(
          'Processing Page Content',
          `Page ${pageIndex + 1} of ${pages.length}`,
          { current: pageIndex + 1, total: pages.length }
        );

        const page = pages[pageIndex];
        const pageDict = page.node.dict;

        // Get the page's content stream(s)
        const contents = pageDict.get(PDFName.of('Contents'));

        if (!contents) {
          this.debug(`❌ No content stream found\n`);
          continue;
        }

        // Contents can be a single stream or an array of streams
        let streams = [];
        if (Array.isArray(contents)) {
          streams = contents;
        } else if (contents.array) {
          streams = contents.array;
        } else {
          streams = [contents];
        }

        // Pre-compute page resources once (avoid repeated lookups)
        const resources = pageDict.get(PDFName.of('Resources'));
        const properties = resources?.get(PDFName.of('Properties'));
        const fontDict = resources?.get(PDFName.of('Font'));

        // Build layer map once per page
        const mcToLayerMap = this.buildLayerMapSync(properties);

        // Track graphics state across content streams within a page
        // PDF content streams are logically concatenated, so colors set in stream N carry to stream N+1
        let carryOverGraphicsState = null;

        // Process each stream synchronously
        for (let streamIndex = 0; streamIndex < streams.length; streamIndex++) {
          const streamRef = streams[streamIndex];

          try {
            // Look up the actual stream object
            const stream = this.pdfDoc.context.lookup(streamRef);

            if (!stream) {
              continue;
            }

            // Get and decompress content synchronously
            const contentData = this.getStreamContentSync(stream);
            if (!contentData) {
              continue;
            }

            // Determine if we need to transform coordinates during parsing
            // 100K and 2025/Topobuilder formats use Form XObjects with complex CTM chains
            // that require pre-transforming coordinates to page space
            const needsCoordTransform = this.metadata?.usgsFormat?.isTopobuilder ||
                                        this.metadata?.usgsFormat?.generation === '2025' ||
                                        this.metadata?.usgsFormat?.scale === '100k';

            // Parse the content stream (this is already sync)
            // Pass the graphics state from the previous stream so colors carry over
            const parser = new PDFContentParser({
              layerMap: mcToLayerMap,
              pdfContext: this.pdfDoc.context,
              fontDict: fontDict,
              resourcesDict: resources,
              globalLayerNames: this.layerNames,
              initialGraphicsState: carryOverGraphicsState,
              transformCoordsDuringParsing: needsCoordTransform
            });
            const {paths, textObjects, fontDetails, endingGraphicsState} = parser.parseContentStream(contentData);

            // Save the ending graphics state for the next stream
            if (endingGraphicsState) {
              carryOverGraphicsState = endingGraphicsState;
            }

            this.debug(`    ✓ Found ${paths.length} paths and ${textObjects.length} text objects`);

            // Convert and collect paths - batch the conversion
            const convertedPaths = this.batchConvertPaths(paths, pageIndex);
            allPaths.push(...convertedPaths);

            // Batch add page numbers to text objects
            for (let i = 0; i < textObjects.length; i++) {
              textObjects[i].page = pageIndex;
            }
            allTextObjects.push(...textObjects);

            // Merge fontDetails
            if (fontDetails) {
              Object.assign(allFontDetails, fontDetails);
            }
          } catch (streamError) {
            console.error(`    ❌ Error:`, streamError.message);
          }
        }
      }

      this.debug(`\nTotal paths extracted: ${allPaths.length}`);

      // Group paths by page (single pass)
      const pathsByPage = {};
      for (let i = 0; i < allPaths.length; i++) {
        const path = allPaths[i];
        const page = path.page;
        if (!pathsByPage[page]) {
          pathsByPage[page] = [];
        }
        pathsByPage[page].push(path);
      }

      // Group text objects by layer (single pass)
      const textObjectsByLayer = {};
      for (let i = 0; i < allTextObjects.length; i++) {
        const textObj = allTextObjects[i];
        const layerName = textObj.layer || 'Text (No Layer)';
        if (!textObjectsByLayer[layerName]) {
          textObjectsByLayer[layerName] = [];
        }
        textObjectsByLayer[layerName].push(textObj);
      }

      this.reportProgress(
        'Finalizing',
        `Extracted ${allPaths.length} paths and ${allTextObjects.length} text objects`
      );

      return {
        paths: allPaths,
        pathsByPage,
        statistics: this.generatePathStatistics(allPaths),
        textObjects: allTextObjects,
        textObjectsByLayer,
        fontDetails: allFontDetails
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

  /**
   * Build layer mapping synchronously from Properties dictionary
   */
  buildLayerMapSync(properties) {
    const mcToLayerMap = {};

    if (!properties) {
      return mcToLayerMap;
    }

    const propDict = this.pdfDoc.context.lookup(properties);
    if (!propDict) {
      return mcToLayerMap;
    }

    const entries = propDict.entries ? Array.from(propDict.entries()) : [];

    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      const mcName = key.toString();

      const ocmdDict = this.pdfDoc.context.lookup(value);
      if (ocmdDict && ocmdDict.dict) {
        const ocgsValue = ocmdDict.dict.get(PDFName.of('OCGs'));

        if (ocgsValue) {
          const ocgRefArray = ocgsValue.array ? ocgsValue.array : [ocgsValue];

          if (ocgRefArray.length > 0) {
            const firstOcgRef = ocgRefArray[0];
            const ocgId = firstOcgRef.toString();

            if (this.layerNames[ocgId]) {
              mcToLayerMap[mcName] = this.layerNames[ocgId];
            }
          }
        }
      }
    }

    return mcToLayerMap;
  }

  /**
   * Get stream content synchronously with decompression
   */
  getStreamContentSync(stream) {
    try {
      const rawContent = stream.getContents ? stream.getContents() : stream.contents;

      if (!rawContent) {
        return null;
      }

      // Check if stream is compressed
      const filter = stream.dict?.get(PDFName.of('Filter'));

      if (filter && filter.toString() === '/FlateDecode') {
        try {
          return zlib.inflateSync(Buffer.from(rawContent));
        } catch (zlibError) {
          console.error(`Decompression failed:`, zlibError.message);
          return null;
        }
      } else {
        return Buffer.from(rawContent);
      }
    } catch (error) {
      console.error(`Error getting stream contents:`, error.message);
      return null;
    }
  }

  /**
   * Batch convert paths to renderer format (optimized to avoid per-path function calls)
   */
  batchConvertPaths(paths, pageIndex) {
    const result = [];

    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      path.page = pageIndex;
      const converted = this.convertPathFormat(path);
      if (converted !== null) {
        result.push(converted);
      }
    }

    return result;
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
