/**
 * Format-specific configuration for USGS GeoPDF processing
 *
 * Handles differences between:
 * - Scale formats: 250k, 100k, 24k (7.5-minute quads)
 * - Generations: Legacy (2022-2024) vs Topobuilder (2025+)
 *
 * Each scale has different characteristics:
 * - 24k: Most detailed, ~5K-20K paths (legacy), ~56K paths (2025)
 * - 100k: Medium detail, ~12K paths (legacy), ~33K paths (2025)
 * - 250k: Least detail but largest area, ~90K paths (2025)
 */

class FormatConfig {
  constructor(formatInfo) {
    this.formatInfo = formatInfo || {};
    this.scale = formatInfo?.scale || 'unknown';
    this.generation = formatInfo?.generation || 'legacy';
    this.isTopobuilder = formatInfo?.isTopobuilder || false;
  }

  /**
   * Whether to parse Form XObjects for content
   * 2025/Topobuilder format stores content in Form XObjects
   */
  get parseXObjects() {
    return this.isTopobuilder || this.generation === '2025';
  }

  /**
   * Maximum recursion depth for XObject parsing
   */
  get maxXObjectDepth() {
    return this.parseXObjects ? 3 : 1;
  }

  /**
   * Layers to exclude from bounds calculation
   * These layers often extend far beyond the map area
   */
  get boundsExcludeLayers() {
    // Common exclude layers across all formats
    const common = [
      'Map Collar',
      'Map Frame',
      'Projection and Grids',
      'Barcode',
      'Map Elements'
    ];

    // Scale-specific exclusions
    if (this.scale === '250k') {
      return [...common, 'Geographic Names', 'Graticule'];
    }

    if (this.scale === '100k') {
      return [...common, 'Graticule', 'Map Surround'];
    }

    // 24k has the most detailed collars
    return [...common, 'Graticule', 'Map Surround', 'Magnetic Declination'];
  }

  /**
   * Layers that are "overlay" (labels, annotations, not plottable map features)
   * Used for filtering what gets rendered as vector paths
   */
  get overlayLayers() {
    const common = [
      'Labels',
      'Map Collar',
      'Map Frame',
      'Barcode',
      'Geographic Names',
      'Road Names and Shields',
      'Road Shields',
      'Map Elements'
    ];

    if (this.scale === '250k') {
      return [...common, 'Place Names', 'State Names'];
    }

    return common;
  }

  /**
   * Expected coordinate range for sanity checking bounds
   * Based on analysis of sample files
   */
  get expectedBoundsRange() {
    if (this.isTopobuilder || this.generation === '2025') {
      // 2025 format has much larger coordinate ranges due to high-res output
      switch (this.scale) {
        case '250k':
          return { minWidth: 10000, maxWidth: 20000, minHeight: 8000, maxHeight: 16000 };
        case '100k':
          return { minWidth: 30000, maxWidth: 40000, minHeight: 28000, maxHeight: 38000 };
        case '24k':
          return { minWidth: 28000, maxWidth: 38000, minHeight: 30000, maxHeight: 40000 };
        default:
          return { minWidth: 10000, maxWidth: 40000, minHeight: 8000, maxHeight: 40000 };
      }
    }

    // Legacy format has smaller, more consistent bounds
    switch (this.scale) {
      case '250k':
        return { minWidth: 6000, maxWidth: 10000, minHeight: 5000, maxHeight: 8000 };
      case '100k':
        return { minWidth: 1500, maxWidth: 2500, minHeight: 1800, maxHeight: 2500 };
      case '24k':
        return { minWidth: 1500, maxWidth: 3000, minHeight: 1800, maxHeight: 2800 };
      default:
        return { minWidth: 1500, maxWidth: 5000, minHeight: 1500, maxHeight: 4000 };
    }
  }

  /**
   * Expected path count ranges for validation
   * Helps detect extraction problems
   */
  get expectedPathCount() {
    if (this.isTopobuilder || this.generation === '2025') {
      switch (this.scale) {
        case '250k':
          return { min: 50000, max: 150000, typical: 90000 };
        case '100k':
          return { min: 25000, max: 50000, typical: 33000 };
        case '24k':
          return { min: 40000, max: 80000, typical: 56000 };
        default:
          return { min: 25000, max: 150000, typical: 50000 };
      }
    }

    // Legacy format has fewer paths
    switch (this.scale) {
      case '250k':
        return { min: 8000, max: 25000, typical: 15000 };
      case '100k':
        return { min: 8000, max: 20000, typical: 12000 };
      case '24k':
        return { min: 3000, max: 25000, typical: 8000 };
      default:
        return { min: 3000, max: 25000, typical: 10000 };
    }
  }

  /**
   * Feature layers that should be included for map plotting
   * Excludes text, labels, and collar elements
   */
  get plottableLayers() {
    // These are the core cartographic features across all formats
    const core = [
      'Contours',
      'Hydrography',
      'Transportation',
      'Roads',
      'Trails',
      'Railroads',
      'Structures',
      'Boundaries',
      'Land Cover',
      'Woodland'
    ];

    if (this.scale === '250k') {
      // 250k has additional generalized features
      return [...core, 'State Boundaries', 'Water Bodies', 'Major Roads'];
    }

    if (this.scale === '100k') {
      return [...core, 'Road Features', 'Building Point Features', 'Water Features'];
    }

    // 24k has the most detailed features
    return [...core,
      'Road Features',
      'Building Point Features',
      'Water Features',
      'Airport Runways',
      'Spot Elevations'
    ];
  }

  /**
   * Color mappings for known layer types
   * Different scales may have different default colors
   */
  get layerColors() {
    // Standard USGS colors across all scales
    return {
      'Contours': '#d88b5a',           // Brown
      'Hydrography': '#0078d7',         // Blue
      'Transportation': '#000000',      // Black
      'Roads': '#e31a1c',               // Red (major roads)
      'Trails': '#666666',              // Gray
      'Railroads': '#000000',           // Black
      'Structures': '#000000',          // Black
      'Boundaries': '#ff00ff',          // Magenta
      'Land Cover': '#c5e8c5',          // Light green
      'Woodland': '#c5e8c5',            // Light green
      'Map Collar': '#000000',          // Black
      'Labels': '#000000'               // Black
    };
  }

  /**
   * Get processing strategy for this format
   */
  getProcessingStrategy() {
    return {
      // Content extraction
      parseXObjects: this.parseXObjects,
      maxXObjectDepth: this.maxXObjectDepth,

      // Bounds calculation
      excludeLayersFromBounds: this.boundsExcludeLayers,
      expectedBounds: this.expectedBoundsRange,
      usePercentileBounds: this.isTopobuilder, // Fall back to percentile for 2025 format
      percentile: 95, // Exclude top 5% outliers

      // Path filtering
      overlayLayers: this.overlayLayers,
      plottableLayers: this.plottableLayers,

      // Performance tuning
      expectedPaths: this.expectedPathCount,
      batchSize: this.scale === '250k' ? 5000 : 2000, // Larger batches for 250k

      // Layer handling
      layerColors: this.layerColors,

      // Format info
      scale: this.scale,
      generation: this.generation,
      isTopobuilder: this.isTopobuilder
    };
  }

  /**
   * Validate extraction results against expected ranges
   */
  validateResults(results) {
    const issues = [];
    const expectedPaths = this.expectedPathCount;

    if (results.pathCount < expectedPaths.min) {
      issues.push({
        type: 'warning',
        message: `Path count (${results.pathCount}) below expected minimum (${expectedPaths.min}) for ${this.scale} ${this.generation} format`
      });
    }

    if (results.pathCount > expectedPaths.max) {
      issues.push({
        type: 'warning',
        message: `Path count (${results.pathCount}) above expected maximum (${expectedPaths.max}) for ${this.scale} ${this.generation} format`
      });
    }

    const expectedBounds = this.expectedBoundsRange;
    if (results.bounds) {
      const { width, height } = results.bounds;

      if (width > expectedBounds.maxWidth * 1.5 || height > expectedBounds.maxHeight * 1.5) {
        issues.push({
          type: 'warning',
          message: `Bounds (${width}x${height}) significantly exceed expected range, may include map collar`
        });
      }
    }

    // Check for unresolved layer names (MC references)
    if (results.unresolvedLayers && results.unresolvedLayers.length > 0) {
      issues.push({
        type: 'error',
        message: `${results.unresolvedLayers.length} layers have unresolved /MC references`
      });
    }

    return {
      valid: issues.filter(i => i.type === 'error').length === 0,
      issues
    };
  }

  /**
   * Get display-friendly summary of this configuration
   */
  getSummary() {
    return {
      scale: this.scale,
      generation: this.generation,
      isTopobuilder: this.isTopobuilder,
      parseXObjects: this.parseXObjects,
      excludedLayers: this.boundsExcludeLayers.length,
      expectedPaths: this.expectedPathCount.typical
    };
  }
}

/**
 * Create a FormatConfig from detected format info
 */
function createFormatConfig(formatInfo) {
  return new FormatConfig(formatInfo);
}

/**
 * Get default config for unknown formats
 */
function getDefaultConfig() {
  return new FormatConfig({
    scale: '24k',
    generation: 'legacy',
    isTopobuilder: false
  });
}

module.exports = {
  FormatConfig,
  createFormatConfig,
  getDefaultConfig
};
