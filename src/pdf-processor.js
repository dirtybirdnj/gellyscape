const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
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
      const vpKey = catalogDict.context.obj('/VP');
      if (vpKey) {
        this.metadata.hasViewport = true;
      }

      // Look for LGIDict - Layer Geospatial Information
      const lgiKey = catalogDict.context.obj('/LGIDict');
      if (lgiKey) {
        this.metadata.hasLGIDict = true;
        this.metadata.isGeoPDF = true;
      }

      // Check for Measure dictionary in pages
      const pages = this.pdfDoc.getPages();
      if (pages.length > 0) {
        const firstPage = pages[0];
        const pageDict = firstPage.node.dict;

        // Look for Measure key
        const measureKey = pageDict.context.obj('/Measure');
        if (measureKey) {
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

  async identifyLayers() {
    try {
      // In GeoPDF, layers are typically stored as Optional Content Groups (OCGs)
      const pages = this.pdfDoc.getPages();

      this.layers = [];

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageDict = page.node.dict;

        // Check for Resources -> XObject entries (images and forms)
        const resources = pageDict.get(pageDict.context.obj('/Resources'));

        if (resources) {
          const xObject = resources.get(resources.context.obj('/XObject'));

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

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        console.log(`Extracting paths from page ${pageIndex + 1}/${pages.length}...`);

        const page = pages[pageIndex];
        const pageDict = page.node.dict;

        // Get the page's content stream(s)
        const contents = pageDict.get(pageDict.context.obj('/Contents'));

        if (!contents) {
          console.log(`  No content stream found on page ${pageIndex + 1}`);
          continue;
        }

        // Contents can be a single stream or an array of streams
        const streams = Array.isArray(contents) ? contents : [contents];

        for (const streamRef of streams) {
          try {
            // Look up the actual stream object
            const stream = this.pdfDoc.context.lookup(streamRef);

            if (!stream || !stream.contents) {
              continue;
            }

            // Parse the content stream
            const parser = new PDFContentParser();
            const paths = parser.parseContentStream(stream.contents);

            console.log(`  Found ${paths.length} paths in content stream`);

            // Add page number to each path
            paths.forEach(path => {
              path.page = pageIndex;
            });

            allPaths.push(...paths);
          } catch (streamError) {
            console.error(`  Error parsing content stream:`, streamError.message);
          }
        }
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

  generatePathStatistics(paths) {
    const stats = {
      total: paths.length,
      byOperation: {},
      byColor: {},
      averageSegments: 0
    };

    let totalSegments = 0;

    paths.forEach(path => {
      // Count by operation
      const op = path.operation || 'unknown';
      stats.byOperation[op] = (stats.byOperation[op] || 0) + 1;

      // Count by color
      if (path.style.fill) {
        const color = path.style.fill;
        if (!stats.byColor[color]) {
          stats.byColor[color] = { fill: 0, stroke: 0 };
        }
        stats.byColor[color].fill++;
      }

      if (path.style.stroke) {
        const color = path.style.stroke;
        if (!stats.byColor[color]) {
          stats.byColor[color] = { fill: 0, stroke: 0 };
        }
        stats.byColor[color].stroke++;
      }

      // Count segments
      path.subpaths.forEach(subpath => {
        totalSegments += subpath.segments.length;
      });
    });

    stats.averageSegments = paths.length > 0 ? (totalSegments / paths.length).toFixed(2) : 0;

    return stats;
  }
}

module.exports = PDFProcessor;
