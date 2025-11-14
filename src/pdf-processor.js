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
  }

  async process() {
    try {
      // Load PDF with pdf-lib for structure access
      this.pdfDoc = await PDFDocument.load(this.buffer);

      // Parse PDF with pdf-parse for metadata
      const pdfData = await pdfParse(this.buffer);

      // Extract metadata
      await this.extractMetadata(pdfData);

      // Identify and extract layers
      await this.identifyLayers();

      // Extract raster data
      const rasterExtractor = new RasterExtractor(this.pdfDoc, this.buffer);
      const rasterLayers = await rasterExtractor.extract();

      // Extract vector data using annotation extractor
      const vectorExtractor = new VectorExtractor(this.pdfDoc, this.buffer);
      const vectorLayers = await vectorExtractor.extract();

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
        pageCount: pdfData.numpages
      };

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

      this.layerNames = {};

      // Extract each OCG
      for (let i = 0; i < ocgs.array.length; i++) {
        const ocgRef = ocgs.array[i];
        const ocg = this.pdfDoc.context.lookup(ocgRef);

        if (!ocg || !ocg.dict) continue;

        // Get the name of this layer
        const name = ocg.dict.get(PDFName.of('Name'));
        let nameStr;

        // Check if it's a PDFString or PDFHexString that needs decoding
        if (name?.decodeText) {
          nameStr = name.decodeText();
        } else {
          nameStr = name?.toString().replace(/[()]/g, '') || `Layer${i}`;

          // Decode UTF-16BE strings (they start with BOM: þÿ or \xFE\xFF)
          if (nameStr.startsWith('\xFE\xFF') || nameStr.startsWith('þÿ')) {
            try {
              // Remove BOM and decode UTF-16BE
              const hexStr = nameStr.slice(2).split('').map(c =>
                c.charCodeAt(0).toString(16).padStart(2, '0')
              ).join('');
              const bytes = Buffer.from(hexStr, 'hex');
              nameStr = bytes.toString('utf16le');
            } catch (e) {
              console.log(`  Warning: Could not decode UTF-16 layer name, using raw: ${nameStr}`);
            }
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

    try {
      const pages = this.pdfDoc.getPages();

      console.log(`\n=== EXTRACTING CONTENT PATHS ===`);
      console.log(`Total pages: ${pages.length}\n`);

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        console.log(`--- Page ${pageIndex + 1}/${pages.length} ---`);

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

            // Parse the content stream
            console.log(`    📝 Parsing with PDFContentParser...`);
            const parser = new PDFContentParser({ layerNames: this.layerNames || {} });
            const {paths, textObjects} = parser.parseContentStream(contentData);

            console.log(`    ✓ Found ${paths.length} paths`);
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

      return {
        paths: allPaths,
        pathsByPage,
        statistics: this.generatePathStatistics(allPaths)
      };

    } catch (error) {
      console.error('Error extracting content paths:', error);
      return {
        paths: [],
        pathsByPage: {},
        statistics: {},
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

    path.subpaths.forEach(subpath => {
      // Add moveto for start point
      if (subpath.startPoint) {
        operations.push({
          type: 'moveto',
          x: subpath.startPoint.x,
          y: subpath.startPoint.y
        });
      }

      // Add segments
      subpath.segments.forEach(segment => {
        if (segment.type === 'line') {
          operations.push({
            type: 'lineto',
            x: segment.point.x,
            y: segment.point.y
          });
        } else if (segment.type === 'cubic') {
          operations.push({
            type: 'curveto',
            x1: segment.cp1.x,
            y1: segment.cp1.y,
            x2: segment.cp2.x,
            y2: segment.cp2.y,
            x3: segment.point.x,
            y3: segment.point.y
          });
        }
      });

      // Add closepath if closed
      if (subpath.closed) {
        operations.push({ type: 'closepath' });
      }
    });

    // Convert colors from hex to RGB arrays
    // Default to brown contour color instead of black for missing stroke colors
    const hexToRgb = (hex, isStroke = false) => {
      if (!hex || !hex.startsWith('#')) {
        // If stroke color is missing, use default brown contour color
        // instead of black, as contour lines should be brown
        return isStroke ? [179, 134, 89] : [0, 0, 0];
      }
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };

    return {
      operations,
      fill: path.operation === 'fill' || path.operation === 'fill-stroke',
      fillColor: path.style.fill ? hexToRgb(path.style.fill, false) : [0, 0, 0],
      stroke: path.operation === 'stroke' || path.operation === 'fill-stroke',
      strokeColor: path.style.stroke ? hexToRgb(path.style.stroke, true) : hexToRgb(null, true),
      strokeWidth: path.style.strokeWidth || 1,
      page: path.page,
      layer: path.layer
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
