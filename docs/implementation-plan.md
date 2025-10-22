# GellyScape Implementation Plan
## Direct GeoPDF → SVG Conversion for Pen Plotting

### Project Goal
Create a fully automated tool that converts USGS GeoPDF topographic maps into clean, organized SVG files optimized for pen plotter rendering. No external tools required.

---

## Architecture Overview

```
GeoPDF Input (40MB)
    ↓
PDF Content Stream Parser
    ↓
Vector Path Extractor
    ↓
Layer Classifier & Organizer
    ↓
Coordinate Transformer
    ↓
SVG Generator (Pen Plotter Optimized)
    ↓
Clean SVG Output (1-2MB)
```

---

## Phase 1: Enhanced PDF Processing

### 1.1 PDF Content Stream Parser (`src/pdf-content-parser.js`)
**Purpose**: Parse PDF content streams to extract ALL vector drawing operations

**Key Operations to Extract**:
- `m` (moveto) - Start new path
- `l` (lineto) - Draw line
- `c` (curveto) - Bezier curves
- `v`, `y` (curve variants)
- `h` (closepath) - Close shape
- `re` (rectangle)
- `S` (stroke) - Draw outline
- `f`, `F`, `f*` (fill) - Fill shape
- `B`, `B*` (fill and stroke)

**Implementation**:
```javascript
class PDFContentParser {
  parseContentStream(stream) {
    // Tokenize PDF operators
    // Build path segments
    // Track graphics state (colors, line width, etc.)
    // Return structured path data
  }
}
```

### 1.2 Vector Path Extractor (`src/vector-path-extractor.js`)
**Purpose**: Convert PDF drawing operations to SVG-compatible paths

**Features**:
- Convert PDF curves to SVG curves
- Handle multiple path segments
- Track fill vs stroke operations
- Preserve path winding rules
- Extract line styles (width, dash patterns)

---

## Phase 2: Layer Classification System

### 2.1 Layer Detector (`src/layer-classifier.js`)
**Purpose**: Identify feature types and assign to semantic categories

**Classification Methods**:

#### A. Optional Content Group (OCG) Analysis
```javascript
// PDF layers have names like:
// "Hydrography" → water_fill, rivers
// "Transportation" → roads, highways
// "Contours" → thin_topo, thick_topo
// "Woodland" → green (vegetation)
```

#### B. Color-Based Classification
```javascript
const LAYER_RULES = {
  green: {
    fillColor: /^#[aA]8[dD]4/ ,  // Light green
    keywords: ['woodland', 'park', 'forest']
  },
  water_fill: {
    fillColor: /^#[0-9a-fA-F]{2}[bB][0-9a-fA-F]/, // Blue tones
    keywords: ['water', 'lake', 'river', 'hydro']
  },
  highways: {
    strokeColor: /^#[aA][fF]4[bB]/, // Red/orange
    strokeWidth: '>= 3',
    keywords: ['highway', 'interstate', 'route']
  },
  thin_topo: {
    strokeColor: '#000000',
    strokeWidth: '< 1',
    keywords: ['contour', 'elevation']
  },
  thick_topo: {
    strokeColor: '#000000',
    strokeWidth: '>= 1',
    keywords: ['contour', 'elevation', 'index']
  }
};
```

#### C. Geometry-Based Classification
```javascript
// Rivers: Long, winding paths
// Roads: Connected linear paths
// Buildings: Closed rectangular paths
// Contours: Closed curved paths at regular intervals
```

### 2.2 Layer Organizer (`src/layer-organizer.js`)
**Purpose**: Group paths into semantic layers for pen plotting

**Layer Structure** (order matters for plotting):
```javascript
const LAYER_ORDER = [
  'green',           // Background vegetation (light green pen)
  'water_fill',      // Water bodies (blue pen)
  'thin_topo',       // Thin contour lines (0.25mm pen)
  'thick_topo',      // Index contours (0.5mm pen)
  'rivers',          // Waterways (blue pen)
  'street',          // Local roads (black 0.3mm)
  'maj_street',      // Major streets (black 0.5mm)
  'connector',       // Connecting roads (black 0.4mm)
  'highway',         // Highways (red/orange pen)
  'trains',          // Railways (black 0.4mm)
  'path_bg',         // Trail backgrounds (light)
  'path_dashes'      // Trail dashes (dark)
];
```

---

## Phase 3: Coordinate Transformation

### 3.1 Coordinate Transformer (`src/coordinate-transformer.js`)
**Purpose**: Convert PDF coordinates to SVG pixel space

**Transformations**:
```javascript
class CoordinateTransformer {
  constructor(pdfBounds, svgBounds, options = {}) {
    this.pdfBounds = pdfBounds;    // PDF coordinate space
    this.svgBounds = svgBounds;    // Target SVG dimensions
    this.crop = options.crop;      // Optional crop region
    this.scale = options.scale;    // Optional scaling factor
  }

  // PDF uses bottom-left origin, SVG uses top-left
  transformPoint(pdfX, pdfY) {
    // 1. Apply crop offset
    // 2. Flip Y axis
    // 3. Scale to target dimensions
    // 4. Return SVG coordinates
  }

  transformPath(pdfPath) {
    // Transform all points in path
    // Preserve curve control points
    // Return SVG path string
  }
}
```

### 3.2 Bounding Box Manager
**Features**:
- Auto-detect content bounds
- User-defined crop regions
- Aspect ratio preservation
- Margin/padding options

---

## Phase 4: SVG Generation

### 4.1 SVG Generator (`src/svg-generator.js`)
**Purpose**: Create clean, organized SVG optimized for pen plotting

**Features**:

#### Document Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg"
     width="828" height="1692" viewBox="0, 0, 828, 1692">
  <g id="Layer_1">
    <g id="green">
      <!-- Vegetation paths -->
    </g>
    <g id="water_fill">
      <!-- Water body paths -->
    </g>
    <!-- More layers... -->
  </g>
</svg>
```

#### Path Optimization for Pen Plotting
```javascript
class PenPlotterOptimizer {
  // Simplify paths (remove redundant points)
  simplifyPath(path, tolerance = 0.5)

  // Merge adjacent paths (reduce pen lifts)
  mergePaths(paths)

  // Sort paths for minimal pen travel
  optimizePlotOrder(paths)

  // Remove tiny paths (below minimum pen size)
  filterSmallPaths(paths, minSize)
}
```

#### Style Application
```javascript
const PEN_STYLES = {
  green: {
    fill: '#a8d483',
    'fill-opacity': 0.3,
    stroke: '#000000',
    'stroke-width': 0.75,
    pen: 'light-green-pen'
  },
  highways: {
    fill: 'none',
    stroke: '#AF4B4C',
    'stroke-width': 3,
    'stroke-linecap': 'round',
    pen: 'red-pen'
  },
  // ... more styles
};
```

---

## Phase 5: UI & Workflow

### 5.1 Updated UI Flow
```
1. Upload GeoPDF
   ↓
2. Processing...
   - Extract vectors
   - Classify layers
   - Show preview
   ↓
3. Layer Configuration
   - Toggle layers on/off
   - Adjust colors/widths
   - Reorder for plotting
   ↓
4. Crop & Transform
   - Select region
   - Set output dimensions
   - Preview result
   ↓
5. Export Options
   - Export SVG (all layers)
   - Export by layer (separate files)
   - Export pen plotter config
```

### 5.2 Pen Plotter Features
**Metadata Export**:
```json
{
  "layers": [
    {
      "id": "green",
      "pen": "Sakura Pigma 01 - Light Green",
      "order": 1,
      "file": "map_01_green.svg"
    },
    {
      "id": "water_fill",
      "pen": "Sakura Pigma 05 - Blue",
      "order": 2,
      "file": "map_02_water.svg"
    }
  ],
  "totalPlotTime": "~45 minutes",
  "penChanges": 6
}
```

---

## Implementation Order

### Week 1: Core PDF Processing
- [ ] Implement PDF content stream parser
- [ ] Build vector path extractor
- [ ] Test with sample GeoPDF

### Week 2: Layer Classification
- [ ] Implement OCG analysis
- [ ] Build color-based classifier
- [ ] Create layer organizer

### Week 3: Transformation & SVG
- [ ] Implement coordinate transformer
- [ ] Build SVG generator
- [ ] Add pen plotter optimizations

### Week 4: UI & Testing
- [ ] Update UI for new workflow
- [ ] Add layer configuration interface
- [ ] Test end-to-end with real maps

---

## Technical Challenges & Solutions

### Challenge 1: PDF Content Stream Complexity
**Problem**: PDF operators are low-level and complex
**Solution**:
- Use existing pdf-lib access to streams
- Build incremental parser (operator by operator)
- Test with simple PDFs first, then USGS maps

### Challenge 2: Layer Classification Accuracy
**Problem**: No perfect way to identify layer types
**Solution**:
- Combine multiple heuristics (OCG names + colors + geometry)
- Allow user override/correction
- Learn from user corrections

### Challenge 3: Path Optimization
**Problem**: Too many small paths slow down plotting
**Solution**:
- Implement Douglas-Peucker algorithm for simplification
- Merge collinear segments
- Filter sub-pixel details

### Challenge 4: Performance with Large Files
**Problem**: 40MB PDFs with thousands of paths
**Solution**:
- Stream processing (don't load all in memory)
- Web Workers for heavy processing
- Progressive rendering in UI

---

## Success Criteria

✅ **Automated**: GeoPDF in → Clean SVG out (no manual steps)
✅ **Organized**: Layers properly classified and named
✅ **Optimized**: Suitable for pen plotting (simplified, ordered)
✅ **Fast**: Process USGS map in < 30 seconds
✅ **Accurate**: 95%+ layer classification accuracy
✅ **Flexible**: User can adjust settings and classifications

---

## Next Steps

1. **Start with PDF Content Parser** - This is the foundation
2. **Test on simple PDFs** - Validate approach before USGS complexity
3. **Build incrementally** - Get each phase working before moving forward
4. **Iterate based on results** - Adjust classifiers based on real data

Ready to begin implementation? I'll start with the PDF content stream parser.
