/**
 * State Management Module
 *
 * Centralized state and configuration constants for GellyScape.
 * Contains all application state variables and layer classification constants.
 */

// ============================================
// Application State
// ============================================

export const state = {
  // PDF data
  currentPDFData: null,
  currentFilePath: null,

  // Layer state
  enabledLayers: new Set(),
  allLayers: [],

  // View state
  currentZoom: 1.0,
  panX: 0,
  panY: 0,
  isPanning: false,
  startPanX: 0,
  startPanY: 0,
  cachedBounds: null,

  // Crop mode state
  cropModeEnabled: false,
  cropRectangle: null,
  cropX: 0,
  cropY: 0,
  cropWidth: 300,
  cropHeight: 400,
  cropScale: 1.0,
  isDraggingCrop: false,
  cropDragStartX: 0,
  cropDragStartY: 0,
  cropApplied: false,
  lastSavedFilePath: null,

  // Background color state
  bgColorEnabled: false,
  bgColorValue: '#ffffff',

  // Text extraction state
  extractedTextData: null,

  // Stats tracking
  currentStats: {
    totalPaths: 0,
    enabledLayers: 0,
    totalLayers: 0,
    estimatedMemoryKB: 0
  },

  // Color tooltip element
  colorTooltip: null,

  // Progress listener cleanup
  progressUnsubscribe: null
};

// ============================================
// Layer Classification Constants
// ============================================

/**
 * Layer categorization - defines which layers are plottable vector data vs overlays/annotations
 * Plottable layers: Physical map features suitable for pen plotting
 * Overlay layers: Text, labels, shields, grids, and other annotation elements
 */
export const OVERLAY_LAYER_PATTERNS = [
  'Boundaries',
  'County or Equivalent',
  'Geographic Names',
  'Map Elements',
  'Projection and Grids',
  'Road Names and Shields',
  'Structures',
  'Airports',
  'Barcode',
  'Department of Defense',
  'Federal Administrated Lands',
  'Images',
  'Text Shields',
  'Unassigned'
];

/**
 * Specific color sublayers that should be treated as overlays
 * Format: { baseLayer: [colors] } - white and light gray shields
 */
export const OVERLAY_COLOR_SUBLAYERS = {
  'Contours': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Hydrography': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Road Features': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Transportation': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Terrain': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Trails': ['rgb(255,255,255)', 'rgb(240,240,240)'],
  'Woodland': ['rgb(255,255,255)', 'rgb(240,240,240)']
};

/**
 * Overlay group categories for organizing the sidebar
 */
export const OVERLAY_GROUPS = {
  'Map Elements': ['Map Elements', 'Map Collar', 'Map Frame', 'Barcode', 'Images'],
  'Projection and Grids': ['Projection and Grids', 'Graticule'],
  'Structures': ['Structures', 'Airports']
};

/**
 * Layers to exclude from bounds calculation
 * These layers often contain coordinates that extend far beyond the actual map area
 */
export const BOUNDS_EXCLUDE_LAYERS = [
  'Map Collar',
  'Map Frame',
  'Projection and Grids',
  'Barcode',
  'Map Elements',
  'Graticule',
  'Map Surround',
  'Magnetic Declination',
  'Geographic Names',
  'Emergency Services',
  'Structures'
];

/**
 * Smart layer naming - infer feature types from colors
 * Maps base layer names + color patterns to descriptive names
 */
export const LAYER_COLOR_DESCRIPTORS = {
  'Contours': {
    'rgb(153,102,51)': 'Contours (Index - Light)',
    'rgb(102,51,0)': 'Contours (Index - Medium)',
    'rgb(51,25,0)': 'Contours (Index - Dark)',
    'rgb(153,76,0)': 'Contours (Intermediate)',
    'rgb(139,90,43)': 'Contours (Supplemental)'
  },
  'Hydrography': {
    'rgb(0,0,0)': 'Hydrography (Outlines)',
    'rgb(151,219,242)': 'Hydrography (Lakes - Light)',
    'rgb(190,232,255)': 'Hydrography (Lakes - Pale)',
    'rgb(0,92,230)': 'Hydrography (Rivers - Blue)',
    'rgb(0,112,255)': 'Hydrography (Streams)',
    'rgb(0,77,168)': 'Hydrography (Water Bodies)',
    'rgb(153,204,255)': 'Hydrography (Wetlands)',
    'rgb(204,235,197)': 'Hydrography (Marshes)'
  },
  'Transportation': {
    'rgb(0,0,0)': 'Roads (Primary - Black)',
    'rgb(255,0,0)': 'Roads (Highways - Red)',
    'rgb(209,110,0)': 'Roads (Secondary - Orange)',
    'rgb(204,204,204)': 'Roads (Local - Gray)',
    'rgb(156,156,156)': 'Roads (Minor - Light Gray)',
    'rgb(255,211,127)': 'Roads (Unimproved - Tan)'
  },
  'Road Features': {
    'rgb(0,0,0)': 'Roads (Primary)',
    'rgb(255,0,0)': 'Roads (Highways)',
    'rgb(209,110,0)': 'Roads (Secondary)',
    'rgb(204,204,204)': 'Roads (Local)',
    'rgb(156,156,156)': 'Roads (Minor)'
  },
  'Trails': {
    'rgb(0,0,0)': 'Trails (Primary)',
    'rgb(255,0,0)': 'Trails (Marked)',
    'rgb(139,69,19)': 'Trails (Unpaved)',
    'rgb(204,102,0)': 'Trails (Secondary)'
  },
  'Woodland': {
    'rgb(228,246,210)': 'Woodland (Forest - Light)',
    'rgb(209,255,189)': 'Woodland (Forest - Pale)',
    'rgb(180,215,155)': 'Woodland (Forest - Medium)',
    'rgb(137,205,102)': 'Woodland (Dense Forest)'
  }
};

// ============================================
// Helper Functions
// ============================================

/**
 * Get descriptive layer name based on base name and color
 */
export function getDescriptiveLayerName(baseName, colorStr) {
  if (LAYER_COLOR_DESCRIPTORS[baseName] && LAYER_COLOR_DESCRIPTORS[baseName][colorStr]) {
    return LAYER_COLOR_DESCRIPTORS[baseName][colorStr];
  }
  return baseName;
}

/**
 * Check if a layer should be categorized as overlay
 */
export function isOverlayLayer(layerName) {
  const [baseName, colorStr] = layerName.includes('::')
    ? layerName.split('::')
    : [layerName, null];

  // Text layers (with emoji prefix) are always overlays
  if (baseName.startsWith('📝 ')) {
    return true;
  }

  // Check if this specific color sublayer should be an overlay
  if (colorStr && OVERLAY_COLOR_SUBLAYERS[baseName]) {
    if (OVERLAY_COLOR_SUBLAYERS[baseName].includes(colorStr)) {
      return true;
    }
  }

  // Check if layer name matches any overlay patterns
  return OVERLAY_LAYER_PATTERNS.some(pattern =>
    baseName.toLowerCase().includes(pattern.toLowerCase())
  );
}

// ============================================
// Rendering Configuration
// ============================================

export const USE_CANVAS_PREVIEW = true;
export const PREVIEW_PATH_LIMIT = 15000;
