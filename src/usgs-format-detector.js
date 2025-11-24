const { PDFDocument, PDFName } = require('pdf-lib');

/**
 * Detects and identifies USGS GeoPDF format, scale, and version
 * Supports differentiation between:
 * - Scale formats (250k, 100k, 75k/7.5-minute quads)
 * - Years/versions (2023, 2024, 2025)
 * - Creation methods (standard USGS vs Topobuilder)
 */
class USGSFormatDetector {
  constructor(pdfDoc, pdfInfo) {
    this.pdfDoc = pdfDoc;
    this.pdfInfo = pdfInfo || {};
    this.formatInfo = null;
  }

  /**
   * Detect the format of the USGS GeoPDF
   * @returns {Object} Format information
   */
  async detect() {
    if (this.formatInfo) {
      return this.formatInfo;
    }

    const metadata = this.extractMetadata();
    const layers = await this.extractLayerStructure();
    const format = this.identifyFormat(metadata, layers);

    this.formatInfo = {
      ...format,
      metadata,
      layers,
      detectedAt: new Date().toISOString()
    };

    return this.formatInfo;
  }

  /**
   * Extract PDF metadata for format detection
   */
  extractMetadata() {
    const info = this.pdfInfo;

    // Extract key metadata fields
    const subject = info.Subject || '';
    const keywords = info.Keywords || '';
    const creator = info.Creator || '';
    const producer = info.Producer || '';
    const title = info.Title || '';

    // Parse creator version (e.g., "ArcGIS Pro 2.8", "ArcSOC 13.3")
    let creatorVersion = null;
    const versionMatch = creator.match(/(ArcSOC|ArcGIS)\s+([\d.]+)/i);
    if (versionMatch) {
      creatorVersion = {
        software: versionMatch[1],
        version: versionMatch[2]
      };
    }

    // Parse subject for scale information
    let scaleInfo = null;
    if (subject.includes('250K Map')) {
      scaleInfo = { scale: '250k', type: 'topographic', description: '1:250,000 scale topographic map' };
    } else if (subject.includes('100K')) {
      scaleInfo = { scale: '100k', type: 'topographic', description: '1:100,000 scale topographic map' };
    } else if (subject.includes('24K')) {
      scaleInfo = { scale: '24k', type: 'topographic', description: '1:24,000 scale topographic map (7.5-minute quad)' };
    }

    return {
      subject,
      keywords,
      creator,
      producer,
      title,
      creatorVersion,
      scaleInfo,
      creationDate: info.CreationDate,
      modDate: info.ModDate
    };
  }

  /**
   * Extract layer structure from Optional Content Groups
   */
  async extractLayerStructure() {
    try {
      const catalog = this.pdfDoc.catalog;
      const catalogDict = catalog.dict;
      const ocProperties = catalogDict.get(PDFName.of('OCProperties'));

      if (!ocProperties) {
        return { count: 0, names: [], hasLayers: false };
      }

      const ocgs = ocProperties.get(PDFName.of('OCGs'));
      if (!ocgs || !ocgs.array) {
        return { count: 0, names: [], hasLayers: false };
      }

      const layerNames = [];
      for (let i = 0; i < ocgs.array.length; i++) {
        const ocgRef = ocgs.array[i];
        const ocg = this.pdfDoc.context.lookup(ocgRef);

        if (!ocg || !ocg.dict) continue;

        const name = ocg.dict.get(PDFName.of('Name'));
        if (name) {
          let nameStr = name.value || name.toString();

          // Handle UTF-16 encoded names
          if (nameStr.startsWith('þÿ')) {
            const utf16Data = nameStr.slice(2);
            const utf16Bytes = Buffer.from(utf16Data, 'latin1');
            nameStr = utf16Bytes.swap16().toString('utf16le');
          }

          // Clean PDF string delimiters
          if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
            nameStr = nameStr.slice(1, -1);
          }

          layerNames.push(nameStr);
        }
      }

      return {
        count: layerNames.length,
        names: layerNames,
        hasLayers: layerNames.length > 0
      };
    } catch (error) {
      console.error('Error extracting layer structure:', error);
      return { count: 0, names: [], hasLayers: false, error: error.message };
    }
  }

  /**
   * Identify the specific format based on metadata and layers
   */
  identifyFormat(metadata, layers) {
    const format = {
      scale: 'unknown',
      year: null,
      generation: 'unknown',
      isTopobuilder: false,
      isGeoPDF: true,
      confidence: 'low'
    };

    // Detect scale from subject or layer count
    if (metadata.scaleInfo) {
      format.scale = metadata.scaleInfo.scale;
      format.scaleDescription = metadata.scaleInfo.description;
      format.confidence = 'high';
    } else {
      // Fallback: estimate from layer count
      if (layers.count >= 28) {
        format.scale = layers.count === 29 ? '250k' : '100k';
        format.scaleDescription = `Estimated from ${layers.count} layers`;
        format.confidence = 'medium';
      } else if (layers.count >= 24) {
        format.scale = '24k';
        format.scaleDescription = `Estimated from ${layers.count} layers`;
        format.confidence = 'medium';
      }
    }

    // Detect generation from creator version and layer names
    if (metadata.creatorVersion) {
      const version = parseFloat(metadata.creatorVersion.version);

      if (version >= 13.0) {
        format.generation = '2025';
        format.year = 2025;
      } else if (version >= 10.8) {
        format.generation = '2024';
        format.year = 2024;
      } else {
        format.generation = '2023';
        format.year = 2023;
      }
    }

    // Check for Topobuilder (2025+ format)
    if (metadata.keywords && metadata.keywords.toLowerCase().includes('topobuilder')) {
      format.isTopobuilder = true;
      format.generation = '2025';
      format.year = 2025;
    }

    // Detect 2025 format from layer names
    const has2025Layers = layers.names.includes('Land Cover') &&
                          layers.names.includes('Roads') &&
                          layers.names.includes('Road Shields');
    if (has2025Layers) {
      format.generation = '2025';
      format.year = 2025;
      format.isTopobuilder = true;
    }

    // Detect older formats
    const hasOldLayers = layers.names.includes('Woodland') ||
                         layers.names.includes('Road Features');
    if (hasOldLayers) {
      if (!format.year) {
        format.generation = '2024';
        format.year = 2024;
      }
    }

    // Extract year from creation date if not found
    if (!format.year && metadata.creationDate) {
      const yearMatch = metadata.creationDate.match(/20(\d{2})/);
      if (yearMatch) {
        format.year = parseInt(`20${yearMatch[1]}`);
      }
    }

    return format;
  }

  /**
   * Get format-specific color extraction strategy
   */
  getColorExtractionStrategy() {
    if (!this.formatInfo) {
      throw new Error('Must call detect() before getting extraction strategy');
    }

    if (this.formatInfo.isTopobuilder || this.formatInfo.generation === '2025') {
      return {
        method: 'xobject',
        description: '2025 format uses Form XObjects for content, requires XObject traversal',
        supportsInlineStreams: false,
        requiresXObjectParsing: true
      };
    }

    return {
      method: 'inline',
      description: 'Pre-2025 format uses inline content streams',
      supportsInlineStreams: true,
      requiresXObjectParsing: false
    };
  }

  /**
   * Get format-specific layer mapping
   */
  getLayerMapping() {
    if (!this.formatInfo) {
      throw new Error('Must call detect() before getting layer mapping');
    }

    // Return layer categories based on format
    const mapping = {
      hydrography: [],
      transportation: [],
      terrain: [],
      boundaries: [],
      vegetation: [],
      structures: [],
      labels: []
    };

    this.formatInfo.layers.names.forEach(layerName => {
      const lower = layerName.toLowerCase();

      if (lower.includes('hydro') || lower.includes('water')) {
        mapping.hydrography.push(layerName);
      } else if (lower.includes('road') || lower.includes('rail') || lower.includes('trail') || lower.includes('transportation')) {
        mapping.transportation.push(layerName);
      } else if (lower.includes('contour') || lower.includes('terrain') || lower.includes('elevation')) {
        mapping.terrain.push(layerName);
      } else if (lower.includes('boundary') || lower.includes('border')) {
        mapping.boundaries.push(layerName);
      } else if (lower.includes('woodland') || lower.includes('land cover') || lower.includes('vegetation')) {
        mapping.vegetation.push(layerName);
      } else if (lower.includes('structure') || lower.includes('building') || lower.includes('airport')) {
        mapping.structures.push(layerName);
      } else if (lower.includes('collar') || lower.includes('frame') || lower.includes('grid') || lower.includes('projection')) {
        mapping.labels.push(layerName);
      }
    });

    return mapping;
  }

  /**
   * Get a summary report of the detected format
   */
  getSummary() {
    if (!this.formatInfo) {
      return 'Format not detected. Call detect() first.';
    }

    const lines = [
      'USGS GeoPDF Format Detection',
      '============================',
      '',
      `Scale: ${this.formatInfo.scale} (${this.formatInfo.scaleDescription || 'N/A'})`,
      `Generation: ${this.formatInfo.generation}`,
      `Year: ${this.formatInfo.year || 'Unknown'}`,
      `Topobuilder: ${this.formatInfo.isTopobuilder ? 'Yes' : 'No'}`,
      `Detection Confidence: ${this.formatInfo.confidence}`,
      '',
      'Metadata:',
      `  Creator: ${this.formatInfo.metadata.creator}`,
      `  Subject: ${this.formatInfo.metadata.subject}`,
      `  Keywords: ${this.formatInfo.metadata.keywords || 'None'}`,
      '',
      'Layer Structure:',
      `  Total Layers: ${this.formatInfo.layers.count}`,
      `  Layer Names: ${this.formatInfo.layers.names.join(', ') || 'None'}`,
      '',
      'Color Extraction Strategy:',
      `  Method: ${this.getColorExtractionStrategy().method}`,
      `  ${this.getColorExtractionStrategy().description}`
    ];

    return lines.join('\n');
  }
}

module.exports = USGSFormatDetector;
