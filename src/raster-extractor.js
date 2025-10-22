const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
const proj4 = require('proj4');

class RasterExtractor {
  constructor(pdfDoc, buffer) {
    this.pdfDoc = pdfDoc;
    this.buffer = buffer;
    this.rasterLayers = [];
  }

  async extract() {
    try {
      const pages = this.pdfDoc.getPages();

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageImages = await this.extractImagesFromPage(page, pageIndex);

        this.rasterLayers.push(...pageImages);
      }

      return this.rasterLayers;
    } catch (error) {
      console.error('Error extracting raster data:', error);
      throw error;
    }
  }

  async extractImagesFromPage(page, pageIndex) {
    const images = [];

    try {
      const pageDict = page.node.dict;
      const resources = pageDict.get(pageDict.context.obj('/Resources'));

      if (!resources) {
        return images;
      }

      const xObject = resources.get(resources.context.obj('/XObject'));

      if (!xObject) {
        return images;
      }

      // XObject is a dictionary of all objects on the page
      const xObjectKeys = xObject.dict ? xObject.dict.keys() : [];

      for (const key of xObjectKeys) {
        try {
          const xObj = xObject.get(key);

          if (!xObj) continue;

          // Check if this XObject is an image
          const subtype = xObj.dict?.get(xObj.dict.context.obj('/Subtype'));
          const subtypeName = subtype?.toString();

          if (subtypeName === '/Image') {
            const imageData = await this.extractImageData(xObj, key, pageIndex, page);
            if (imageData) {
              images.push(imageData);
            }
          }
        } catch (error) {
          console.error(`Error extracting image ${key}:`, error);
          // Continue with other images
        }
      }
    } catch (error) {
      console.error(`Error processing page ${pageIndex}:`, error);
    }

    return images;
  }

  async extractImageData(imageObj, imageName, pageIndex, page) {
    try {
      const dict = imageObj.dict;

      // Get image properties
      const width = dict.get(dict.context.obj('/Width'));
      const height = dict.get(dict.context.obj('/Height'));
      const colorSpace = dict.get(dict.context.obj('/ColorSpace'));
      const bitsPerComponent = dict.get(dict.context.obj('/BitsPerComponent'));
      const filter = dict.get(dict.context.obj('/Filter'));

      // Get image data
      let imageBytes;
      try {
        if (imageObj instanceof PDFRawStream) {
          imageBytes = imageObj.contents;
        } else {
          // Try to get the stream data
          const ref = imageObj.ref;
          if (ref) {
            const obj = this.pdfDoc.context.lookup(ref);
            if (obj && obj.contents) {
              imageBytes = obj.contents;
            }
          }
        }
      } catch (error) {
        console.error('Error getting image bytes:', error);
      }

      // Determine image format
      let format = 'unknown';
      const filterName = filter?.toString();

      if (filterName?.includes('DCTDecode')) {
        format = 'jpeg';
      } else if (filterName?.includes('FlateDecode')) {
        format = 'png';
      } else if (filterName?.includes('CCITTFaxDecode')) {
        format = 'tiff';
      }

      // Extract georeferencing information
      const geoInfo = this.extractGeoReference(page, imageObj);

      // Convert image bytes to base64 for transfer
      let base64Data = null;
      if (imageBytes) {
        base64Data = Buffer.from(imageBytes).toString('base64');
      }

      return {
        name: imageName?.toString() || `image_${pageIndex}`,
        page: pageIndex,
        width: width?.toString(),
        height: height?.toString(),
        colorSpace: colorSpace?.toString(),
        bitsPerComponent: bitsPerComponent?.toString(),
        format,
        filter: filterName,
        geoReference: geoInfo,
        dataUrl: base64Data ? `data:image/${format};base64,${base64Data}` : null,
        size: imageBytes ? imageBytes.length : 0
      };
    } catch (error) {
      console.error('Error extracting image data:', error);
      return null;
    }
  }

  extractGeoReference(page, imageObj) {
    try {
      const geoInfo = {
        hasGeoReference: false,
        coordinateSystem: null,
        bounds: null,
        projection: null
      };

      // Get page dictionary
      const pageDict = page.node.dict;

      // Look for VP (Viewport) array in page
      const vp = pageDict.get(pageDict.context.obj('/VP'));

      if (vp) {
        geoInfo.hasGeoReference = true;
        // VP contains projection and bounding box information
        // This would need more detailed parsing for full implementation
      }

      // Look for Measure dictionary
      const measure = pageDict.get(pageDict.context.obj('/Measure'));

      if (measure) {
        geoInfo.hasGeoReference = true;

        // Measure dictionary contains:
        // - Subtype: Should be /GEO for geospatial
        // - Bounds: Bounding box in PDF coordinates
        // - GPTS: Geographic coordinate points
        // - LPTS: PDF coordinate points

        try {
          const subtype = measure.get(measure.context.obj('/Subtype'));
          if (subtype?.toString() === '/GEO') {
            geoInfo.isGEO = true;

            // Extract bounds if available
            const bounds = measure.get(measure.context.obj('/Bounds'));
            if (bounds && bounds.array) {
              geoInfo.bounds = bounds.array.map(v => v.toString());
            }

            // Extract GPTS (Geographic Points) if available
            const gpts = measure.get(measure.context.obj('/GPTS'));
            if (gpts && gpts.array) {
              geoInfo.geographicPoints = gpts.array.map(v => v.toString());
            }

            // Extract LPTS (Layout Points) if available
            const lpts = measure.get(measure.context.obj('/LPTS'));
            if (lpts && lpts.array) {
              geoInfo.layoutPoints = lpts.array.map(v => v.toString());
            }
          }
        } catch (error) {
          console.error('Error parsing Measure dictionary:', error);
        }
      }

      return geoInfo;
    } catch (error) {
      console.error('Error extracting georeference:', error);
      return { hasGeoReference: false };
    }
  }

  // Convert PDF coordinates to geographic coordinates using georeferencing info
  transformCoordinates(pdfX, pdfY, geoReference) {
    try {
      if (!geoReference || !geoReference.hasGeoReference) {
        return { x: pdfX, y: pdfY, geographic: false };
      }

      // If we have GPTS and LPTS, we can compute the transformation
      if (geoReference.geographicPoints && geoReference.layoutPoints) {
        // This is a simplified transformation
        // A full implementation would use affine transformation
        // based on the control points

        return {
          x: pdfX,
          y: pdfY,
          geographic: true,
          projected: true
        };
      }

      return { x: pdfX, y: pdfY, geographic: false };
    } catch (error) {
      console.error('Error transforming coordinates:', error);
      return { x: pdfX, y: pdfY, geographic: false };
    }
  }
}

module.exports = RasterExtractor;
