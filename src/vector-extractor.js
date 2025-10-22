const { PDFDocument, PDFName } = require('pdf-lib');
const proj4 = require('proj4');

class VectorExtractor {
  constructor(pdfDoc, buffer) {
    this.pdfDoc = pdfDoc;
    this.buffer = buffer;
    this.vectorLayers = [];
  }

  async extract() {
    try {
      const pages = this.pdfDoc.getPages();

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const pageVectors = await this.extractVectorsFromPage(page, pageIndex);

        this.vectorLayers.push(...pageVectors);
      }

      return this.vectorLayers;
    } catch (error) {
      console.error('Error extracting vector data:', error);
      throw error;
    }
  }

  async extractVectorsFromPage(page, pageIndex) {
    const vectors = [];

    try {
      // Extract annotations (which can contain vector data)
      const annotations = await this.extractAnnotations(page, pageIndex);
      vectors.push(...annotations);

      // Extract content streams (contain drawing operations)
      const contentVectors = await this.extractContentStreams(page, pageIndex);
      vectors.push(...contentVectors);

      // Extract form XObjects (can contain vector graphics)
      const formVectors = await this.extractFormXObjects(page, pageIndex);
      vectors.push(...formVectors);

    } catch (error) {
      console.error(`Error extracting vectors from page ${pageIndex}:`, error);
    }

    return vectors;
  }

  async extractAnnotations(page, pageIndex) {
    const annotations = [];

    try {
      const pageDict = page.node.dict;
      const annotsRef = pageDict.get(pageDict.context.obj('/Annots'));

      if (!annotsRef) {
        return annotations;
      }

      // Annotations can be various types: Text, Line, Square, Circle, Polygon, etc.
      const annots = annotsRef.array || [];

      for (let i = 0; i < annots.length; i++) {
        try {
          const annotRef = annots[i];
          const annot = this.pdfDoc.context.lookup(annotRef);

          if (!annot || !annot.dict) continue;

          const subtype = annot.dict.get(annot.dict.context.obj('/Subtype'));
          const subtypeName = subtype?.toString();

          // Get annotation rectangle
          const rect = annot.dict.get(annot.dict.context.obj('/Rect'));
          const rectArray = rect?.array || [];

          // Get annotation contents/title
          const contents = annot.dict.get(annot.dict.context.obj('/Contents'));
          const title = annot.dict.get(annot.dict.context.obj('/T'));

          const annotData = {
            type: 'annotation',
            subtype: subtypeName,
            page: pageIndex,
            rect: rectArray.map(v => parseFloat(v.toString())),
            contents: contents?.toString(),
            title: title?.toString(),
            geometry: null
          };

          // Extract geometry based on subtype
          if (subtypeName === '/Line') {
            annotData.geometry = this.extractLineGeometry(annot);
          } else if (subtypeName === '/Polygon' || subtypeName === '/PolyLine') {
            annotData.geometry = this.extractPolygonGeometry(annot);
          } else if (subtypeName === '/Square' || subtypeName === '/Circle') {
            annotData.geometry = this.extractShapeGeometry(annot, subtypeName);
          }

          annotations.push(annotData);
        } catch (error) {
          console.error(`Error processing annotation ${i}:`, error);
        }
      }
    } catch (error) {
      console.error('Error extracting annotations:', error);
    }

    return annotations;
  }

  extractLineGeometry(annot) {
    try {
      const dict = annot.dict;
      const l = dict.get(dict.context.obj('/L'));

      if (l && l.array && l.array.length === 4) {
        return {
          type: 'LineString',
          coordinates: [
            [parseFloat(l.array[0].toString()), parseFloat(l.array[1].toString())],
            [parseFloat(l.array[2].toString()), parseFloat(l.array[3].toString())]
          ]
        };
      }
    } catch (error) {
      console.error('Error extracting line geometry:', error);
    }

    return null;
  }

  extractPolygonGeometry(annot) {
    try {
      const dict = annot.dict;
      const vertices = dict.get(dict.context.obj('/Vertices'));

      if (vertices && vertices.array) {
        const coords = [];
        for (let i = 0; i < vertices.array.length; i += 2) {
          if (i + 1 < vertices.array.length) {
            coords.push([
              parseFloat(vertices.array[i].toString()),
              parseFloat(vertices.array[i + 1].toString())
            ]);
          }
        }

        return {
          type: 'Polygon',
          coordinates: [coords]
        };
      }
    } catch (error) {
      console.error('Error extracting polygon geometry:', error);
    }

    return null;
  }

  extractShapeGeometry(annot, subtype) {
    try {
      const dict = annot.dict;
      const rect = dict.get(dict.context.obj('/Rect'));

      if (rect && rect.array && rect.array.length === 4) {
        const x1 = parseFloat(rect.array[0].toString());
        const y1 = parseFloat(rect.array[1].toString());
        const x2 = parseFloat(rect.array[2].toString());
        const y2 = parseFloat(rect.array[3].toString());

        if (subtype === '/Square') {
          return {
            type: 'Polygon',
            coordinates: [[
              [x1, y1],
              [x2, y1],
              [x2, y2],
              [x1, y2],
              [x1, y1]
            ]]
          };
        } else if (subtype === '/Circle') {
          // Approximate circle with polygon
          const centerX = (x1 + x2) / 2;
          const centerY = (y1 + y2) / 2;
          const radiusX = Math.abs(x2 - x1) / 2;
          const radiusY = Math.abs(y2 - y1) / 2;

          const points = [];
          const numPoints = 32;

          for (let i = 0; i <= numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            points.push([
              centerX + radiusX * Math.cos(angle),
              centerY + radiusY * Math.sin(angle)
            ]);
          }

          return {
            type: 'Polygon',
            coordinates: [points]
          };
        }
      }
    } catch (error) {
      console.error('Error extracting shape geometry:', error);
    }

    return null;
  }

  async extractContentStreams(page, pageIndex) {
    const vectors = [];

    try {
      // Content streams contain the actual drawing commands
      // This is where vector paths are defined using PDF operators
      // like: m (moveto), l (lineto), c (curveto), h (closepath), etc.

      const pageDict = page.node.dict;
      const contents = pageDict.get(pageDict.context.obj('/Contents'));

      if (contents) {
        // Parse content stream would require a full PDF content parser
        // For now, we note that content exists
        vectors.push({
          type: 'contentStream',
          page: pageIndex,
          hasContent: true,
          note: 'Content stream parsing requires advanced PDF operator parsing'
        });
      }
    } catch (error) {
      console.error('Error extracting content streams:', error);
    }

    return vectors;
  }

  async extractFormXObjects(page, pageIndex) {
    const forms = [];

    try {
      const pageDict = page.node.dict;
      const resources = pageDict.get(pageDict.context.obj('/Resources'));

      if (!resources) {
        return forms;
      }

      const xObject = resources.get(resources.context.obj('/XObject'));

      if (!xObject) {
        return forms;
      }

      const xObjectKeys = xObject.dict ? xObject.dict.keys() : [];

      for (const key of xObjectKeys) {
        try {
          const xObj = xObject.get(key);

          if (!xObj) continue;

          const subtype = xObj.dict?.get(xObj.dict.context.obj('/Subtype'));
          const subtypeName = subtype?.toString();

          // Form XObjects contain reusable content (can be vector graphics)
          if (subtypeName === '/Form') {
            forms.push({
              type: 'form',
              name: key.toString(),
              page: pageIndex,
              note: 'Form XObject - may contain vector graphics'
            });
          }
        } catch (error) {
          console.error(`Error processing form XObject ${key}:`, error);
        }
      }
    } catch (error) {
      console.error('Error extracting form XObjects:', error);
    }

    return forms;
  }

  // Convert extracted vectors to GeoJSON format
  toGeoJSON(vectors) {
    const features = [];

    for (const vector of vectors) {
      if (vector.geometry) {
        const feature = {
          type: 'Feature',
          geometry: vector.geometry,
          properties: {
            type: vector.type,
            subtype: vector.subtype,
            page: vector.page,
            title: vector.title,
            contents: vector.contents
          }
        };

        features.push(feature);
      }
    }

    return {
      type: 'FeatureCollection',
      features
    };
  }

  // Convert to KML format
  toKML(vectors) {
    let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
    kml += '  <Document>\n';
    kml += '    <name>Extracted Vectors</name>\n';

    for (const vector of vectors) {
      if (vector.geometry) {
        kml += '    <Placemark>\n';

        if (vector.title) {
          kml += `      <name>${this.escapeXML(vector.title)}</name>\n`;
        }

        if (vector.contents) {
          kml += `      <description>${this.escapeXML(vector.contents)}</description>\n`;
        }

        // Add geometry (simplified - would need full implementation)
        kml += '      <!-- Geometry would be converted here -->\n';

        kml += '    </Placemark>\n';
      }
    }

    kml += '  </Document>\n';
    kml += '</kml>';

    return kml;
  }

  escapeXML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = VectorExtractor;
