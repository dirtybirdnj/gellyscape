# Layer Alignment Fix - Key Technical Findings

## Problem
Map layers from USGS GeoPDF files were misaligned - scattered across the preview instead of properly overlapping. This was particularly evident with 2025 Topobuilder format maps.

## Root Cause
**Form XObjects were not inheriting the parent's Current Transformation Matrix (CTM)**

The 2025 Topobuilder format (and potentially other formats) uses Form XObjects to organize content. When parsing these nested structures, the child content was being parsed without the parent's transformation context, causing coordinates to be in the wrong space.

## Solution
Modified `src/pdf-content-parser.js` to properly inherit and compose transformation matrices:

### 1. Accept Initial CTM in Constructor
```javascript
// In constructor options:
if (options.initialCTM) {
  this.graphicsState.ctm = { ...options.initialCTM };
}
```

### 2. Extract Form XObject Matrix
When invoking a Form XObject (`Do` operator), extract its `/Matrix` entry:
```javascript
let formMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; // identity
const matrixArray = xobj.dict.get(PDFName.of('Matrix'));
if (matrixArray && matrixArray.array) {
  // Parse the 6-element transformation matrix
  formMatrix = { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] };
}
```

### 3. Compose Effective CTM
Multiply parent CTM by Form XObject matrix:
```javascript
const effectiveCTM = this.multiplyMatrices(this.graphicsState.ctm, formMatrix);
```

### 4. Pass to Child Parser
```javascript
const formParser = new PDFContentParser({
  ...options,
  initialCTM: effectiveCTM  // Child inherits composed transform
});
```

## Additional Fixes Applied

### Stroke Width Scaling
Large coordinate spaces (e.g., georeferenced coordinates) made strokes invisible:
```javascript
// In svg-generator.js
const viewBoxScale = Math.max(viewBoxWidth / pageDimensions.widthPt,
                              viewBoxHeight / pageDimensions.heightPt);
if (viewBoxScale > 2) {
  strokeScale = viewBoxScale;
}
```

### Color-Based Sublayers
OCG layers are split by stroke/fill color for finer control. This creates sublayers like:
- `Contours::rgb(145,88,40)` - dark brown contours
- `Contours::rgb(179,134,89)` - light brown contours
- `Contours::rgb(240,240,240)` - near-white (masks/backgrounds)

## Format Detection
The `USGSFormatDetector` class identifies:
- **Scale**: 250K, 100K, 24K (7.5-minute quad)
- **Year**: 2023, 2024, 2025
- **Generation**: Standard vs Topobuilder
- **Extraction Strategy**: Inline streams vs XObject traversal

### Detection Signals
| Format | Indicators |
|--------|-----------|
| 2025 Topobuilder | ArcSOC 13.x+, "Land Cover" layer, "Road Shields" layer |
| 2024 | ArcSOC 10.8+, "Woodland" layer, "Road Features" layer |
| 250K | Subject contains "250K Map", ~29 OCG layers |
| 100K | Subject contains "100K", ~30+ OCG layers |
| 24K | Subject contains "24K", ~24-28 OCG layers |

## Applying to Other Maps
When processing other USGS formats:

1. **Check if CTM inheritance is needed** - If layers misalign, the format likely uses Form XObjects
2. **Verify stroke visibility** - If paths exist but aren't visible, check stroke scaling
3. **Note color patterns** - Different formats use different color schemes for the same features
4. **Check for near-white layers** - `rgb(240,240,240)` layers are often masks, not visible content

## Files Modified
- `src/pdf-content-parser.js` - CTM inheritance for Form XObjects
- `src/svg-generator.js` - Stroke width scaling
- `src/usgs-format-detector.js` - Format identification
- `renderer/renderer.js` - UI improvements (metadata display)
