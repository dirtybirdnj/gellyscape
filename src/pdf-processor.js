const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const RasterExtractor = require('./raster-extractor');
const VectorExtractor = require('./vector-extractor');

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

      // Extract vector data
      const vectorExtractor = new VectorExtractor(this.pdfDoc, this.buffer);
      const vectorLayers = await vectorExtractor.extract();

      return {
        metadata: this.metadata,
        rasterLayers,
        vectorLayers,
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
}

module.exports = PDFProcessor;
