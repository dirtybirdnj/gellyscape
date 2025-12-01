/**
 * ENC API Processor - Fetches NOAA ENC data via REST API
 *
 * Uses NOAA's ENC Direct to GIS ArcGIS REST services to fetch
 * pre-converted nautical chart data as GeoJSON.
 *
 * API Base: https://encdirect.noaa.gov/arcgis/rest/services/encdirect/
 */

const https = require('https');

// Available scale bands and their layer IDs for key feature types
const SCALE_BANDS = {
  harbour: {
    name: 'enc_harbour',
    scaleRange: '1:5,000 - 1:50,000',
    layers: {
      coastline: 84,      // Harbor.Coastline_line
      depthContour: 104,  // Harbor.Depth_Contour_line
      depthArea: 226,     // DepthsA
      landArea: 231,      // NaturalFeaturesA.Land_Area
      buoys: 6,           // Harbor.Buoy_Lateral_point
      lights: 11,         // Harbor.Light_point
      shoreline: 85,      // Harbor.Shoreline_Construction_line
      bridge: 87,         // Harbor.Bridge_line
    }
  },
  approach: {
    name: 'enc_approach',
    scaleRange: '1:50,000 - 1:150,000',
    layers: {
      coastline: 84,
      depthContour: 104,
      landArea: 231,
    }
  },
  coastal: {
    name: 'enc_coastal',
    scaleRange: '1:150,000 - 1:600,000',
    layers: {
      coastline: 84,
      depthContour: 104,
    }
  }
};

// Layer styling configuration
const LAYER_STYLES = {
  coastline: { strokeColor: [47, 79, 79], strokeWidth: 1.5, fill: false },
  depthContour: { strokeColor: [0, 120, 215], strokeWidth: 0.5, fill: false },
  depthArea: { fillColor: [173, 216, 230], strokeColor: [0, 120, 215], strokeWidth: 0.25, fill: true },
  landArea: { fillColor: [210, 180, 140], strokeColor: [47, 79, 79], strokeWidth: 0.5, fill: true },
  shoreline: { strokeColor: [105, 105, 105], strokeWidth: 1, fill: false },
  bridge: { strokeColor: [128, 128, 128], strokeWidth: 2, fill: false },
  buoys: { fillColor: [255, 215, 0], strokeColor: [0, 0, 0], strokeWidth: 0.5, fill: true },
  lights: { fillColor: [255, 255, 0], strokeColor: [0, 0, 0], strokeWidth: 0.5, fill: true },
};

class ENCAPIProcessor {
  constructor(bounds, options = {}) {
    // bounds: { minLon, minLat, maxLon, maxLat }
    this.bounds = bounds;
    this.scaleBand = options.scaleBand || 'harbour';
    this.layers = options.layers || ['coastline', 'depthContour', 'landArea'];
    this.progressCallback = null;
    this.metadata = {};
  }

  setProgressCallback(callback) {
    this.progressCallback = callback;
  }

  reportProgress(operation, detail, progress = null) {
    if (this.progressCallback) {
      this.progressCallback({ operation, detail, progress });
    }
  }

  /**
   * Fetch GeoJSON from a single layer
   */
  async fetchLayer(layerType) {
    const bandConfig = SCALE_BANDS[this.scaleBand];
    if (!bandConfig) {
      throw new Error(`Unknown scale band: ${this.scaleBand}`);
    }

    const layerId = bandConfig.layers[layerType];
    if (layerId === undefined) {
      console.warn(`Layer ${layerType} not available in ${this.scaleBand}`);
      return null;
    }

    const bbox = `${this.bounds.minLon},${this.bounds.minLat},${this.bounds.maxLon},${this.bounds.maxLat}`;
    const url = new URL(`https://encdirect.noaa.gov/arcgis/rest/services/encdirect/${bandConfig.name}/MapServer/${layerId}/query`);

    url.searchParams.set('where', '1=1');
    url.searchParams.set('geometry', bbox);
    url.searchParams.set('geometryType', 'esriGeometryEnvelope');
    url.searchParams.set('inSR', '4326');
    url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('f', 'geojson');

    return new Promise((resolve, reject) => {
      https.get(url.toString(), (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) {
              console.warn(`API error for ${layerType}:`, json.error.message);
              resolve(null);
            } else {
              resolve(json);
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Process fetched data and extract paths
   */
  async process() {
    console.time('ENC:TotalProcess');
    const allPaths = [];
    const layerInfo = [];

    this.reportProgress('Connecting', 'Connecting to NOAA ENC service...');

    // Build metadata
    this.metadata = {
      title: `ENC Chart (${this.bounds.minLat.toFixed(2)}°, ${this.bounds.minLon.toFixed(2)}°)`,
      format: 'NOAA ENC (via API)',
      isENC: true,
      isGeoPDF: false,
      creator: 'NOAA Office of Coast Survey',
      producer: 'GellyScape ENC API Processor',
      scaleBand: this.scaleBand,
      scaleRange: SCALE_BANDS[this.scaleBand]?.scaleRange || 'Unknown',
      geoBounds: {
        minLat: this.bounds.minLat,
        maxLat: this.bounds.maxLat,
        minLon: this.bounds.minLon,
        maxLon: this.bounds.maxLon
      },
      neatline: {
        left: this.bounds.minLon,
        right: this.bounds.maxLon,
        bottom: this.bounds.minLat,
        top: this.bounds.maxLat,
        width: this.bounds.maxLon - this.bounds.minLon,
        height: this.bounds.maxLat - this.bounds.minLat
      },
      projection: 'WGS 84 (EPSG:4326)',
      pageDimensions: this.calculatePageDimensions()
    };

    // Fetch each layer
    for (let i = 0; i < this.layers.length; i++) {
      const layerType = this.layers[i];
      this.reportProgress('Fetching', `Layer ${i + 1}/${this.layers.length}: ${layerType}`, (i / this.layers.length) * 100);

      try {
        const geojson = await this.fetchLayer(layerType);
        if (geojson && geojson.features && geojson.features.length > 0) {
          const style = LAYER_STYLES[layerType] || LAYER_STYLES.coastline;
          const paths = this.geojsonToPaths(geojson, layerType, style);
          allPaths.push(...paths);

          layerInfo.push({
            name: `${layerType}::rgb(${style.strokeColor?.join(',') || style.fillColor?.join(',')})`,
            count: paths.length
          });

          console.log(`  ${layerType}: ${geojson.features.length} features, ${paths.length} paths`);
        }
      } catch (err) {
        console.warn(`Failed to fetch ${layerType}:`, err.message);
      }
    }

    this.reportProgress('Processing', 'Converting to paths...');

    console.timeEnd('ENC:TotalProcess');
    console.log(`Total paths: ${allPaths.length}`);

    return {
      metadata: this.metadata,
      contentPaths: {
        paths: allPaths,
        statistics: {
          total: allPaths.length,
          byLayer: layerInfo.reduce((acc, l) => { acc[l.name] = l.count; return acc; }, {})
        }
      },
      layerInfo,
      pageCount: 1
    };
  }

  /**
   * Calculate page dimensions from bounds
   */
  calculatePageDimensions() {
    const width = this.bounds.maxLon - this.bounds.minLon;
    const height = this.bounds.maxLat - this.bounds.minLat;
    const aspectRatio = height / width;

    // Target ~24" wide
    const widthIn = 24;
    const heightIn = widthIn * aspectRatio;

    return {
      widthPt: widthIn * 72,
      heightPt: heightIn * 72,
      widthIn,
      heightIn,
      widthMm: widthIn * 25.4,
      heightMm: heightIn * 25.4
    };
  }

  /**
   * Convert GeoJSON to path format
   */
  geojsonToPaths(geojson, layerName, style) {
    const paths = [];
    const bounds = this.metadata.neatline;

    for (const feature of geojson.features) {
      const featurePaths = this.geometryToPaths(feature.geometry, layerName, style, bounds);
      paths.push(...featurePaths);
    }

    return paths;
  }

  /**
   * Transform coordinates to SVG space
   */
  transformCoord(lon, lat, bounds) {
    const svgWidth = 2000;
    const aspectRatio = bounds.height / bounds.width;
    const svgHeight = svgWidth * aspectRatio;

    const x = ((lon - bounds.left) / bounds.width) * svgWidth;
    const y = svgHeight - ((lat - bounds.bottom) / bounds.height) * svgHeight;

    return { x, y };
  }

  /**
   * Convert geometry to path operations
   */
  geometryToPaths(geometry, layerName, style, bounds) {
    if (!geometry) return [];
    const paths = [];

    switch (geometry.type) {
      case 'Point':
        paths.push(this.pointToPath(geometry.coordinates, layerName, style, bounds));
        break;

      case 'MultiPoint':
        for (const pt of geometry.coordinates) {
          paths.push(this.pointToPath(pt, layerName, style, bounds));
        }
        break;

      case 'LineString':
        paths.push(this.lineToPath(geometry.coordinates, layerName, style, bounds, false));
        break;

      case 'MultiLineString':
        for (const line of geometry.coordinates) {
          paths.push(this.lineToPath(line, layerName, style, bounds, false));
        }
        break;

      case 'Polygon':
        for (const ring of geometry.coordinates) {
          paths.push(this.lineToPath(ring, layerName, style, bounds, true));
        }
        break;

      case 'MultiPolygon':
        for (const polygon of geometry.coordinates) {
          for (const ring of polygon) {
            paths.push(this.lineToPath(ring, layerName, style, bounds, true));
          }
        }
        break;
    }

    return paths.filter(p => p !== null);
  }

  pointToPath(coords, layerName, style, bounds) {
    const { x, y } = this.transformCoord(coords[0], coords[1], bounds);
    const r = 4;

    return {
      operations: [
        { type: 'moveto', x: x + r, y },
        { type: 'curveto', x1: x + r, y1: y + r * 0.55, x2: x + r * 0.55, y2: y + r, x3: x, y3: y + r },
        { type: 'curveto', x1: x - r * 0.55, y1: y + r, x2: x - r, y2: y + r * 0.55, x3: x - r, y3: y },
        { type: 'curveto', x1: x - r, y1: y - r * 0.55, x2: x - r * 0.55, y2: y - r, x3: x, y3: y - r },
        { type: 'curveto', x1: x + r * 0.55, y1: y - r, x2: x + r, y2: y - r * 0.55, x3: x + r, y3: y },
        { type: 'closepath' }
      ],
      fill: true,
      fillColor: style.fillColor || [128, 128, 128],
      stroke: true,
      strokeColor: style.strokeColor || [0, 0, 0],
      strokeWidth: style.strokeWidth || 0.5,
      layer: layerName,
      page: 0
    };
  }

  lineToPath(coords, layerName, style, bounds, isPolygon) {
    if (!coords || coords.length < 2) return null;

    const operations = [];
    const first = this.transformCoord(coords[0][0], coords[0][1], bounds);
    operations.push({ type: 'moveto', x: first.x, y: first.y });

    for (let i = 1; i < coords.length; i++) {
      const pt = this.transformCoord(coords[i][0], coords[i][1], bounds);
      operations.push({ type: 'lineto', x: pt.x, y: pt.y });
    }

    if (isPolygon) {
      operations.push({ type: 'closepath' });
    }

    return {
      operations,
      fill: isPolygon && style.fill,
      fillColor: style.fillColor || [200, 200, 200],
      stroke: true,
      strokeColor: style.strokeColor || [0, 0, 0],
      strokeWidth: style.strokeWidth || 1,
      layer: layerName,
      page: 0
    };
  }
}

module.exports = ENCAPIProcessor;
