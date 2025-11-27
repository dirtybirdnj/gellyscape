# Plan: Format-Aware PDF Processing Pipeline

## Problem Statement

Currently, we apply the same processing logic to all USGS GeoPDF files, but different formats have fundamentally different structures.

## Sample File Analysis (10 files tested)

### Summary Table

| File | Scale | Year | Paths | Layers OK | Bounds | Content Structure |
|------|-------|------|-------|-----------|--------|-------------------|
| AK_Anchorage (2023) | 100k | 2024 | 12,186 | ✅ YES | 1711x2088 | 8 streams, 0 Form XObj |
| MA_75Min (2025) | 24k | 2025 | 56,042 | ❌ NO | 31111x34239 | 1 stream, 1 Form XObj |
| ME_100K (2025) | 100k | 2025 | 32,958 | ❌ NO | 34617x32644 | 1 stream, 1 Form XObj |
| NY_100K (2025) | 100k | 2025 | 33,508 | ❌ NO | 33870x33654 | 1 stream, 1 Form XObj |
| NY_Bolton (2023) | 24k | 2024 | 5,385 | ✅ YES | 1698x2460 | 8 streams, 0 Form XObj |
| NY_Niagara (2023) | 24k | 2024 | 6,838 | ✅ YES | 1707x2076 | 8 streams, 0 Form XObj |
| TX_Austin (2022) | 24k | 2024 | 20,220 | ✅ YES | 1728x2259 | 8 streams, 0 Form XObj |
| VT_250K (2025) | 250k | 2025 | 90,026 | ❌ NO | 14272x12108 | 1 stream, 1 Form XObj |
| VT_Charlotte (2024) | 24k | 2024 | 4,169 | ✅ YES | 1697x2088 | 8 streams, 0 Form XObj |
| VT_Essex (2024) | 24k | 2024 | 9,212 | ✅ YES | 2877x2088 | 8 streams, 0 Form XObj |

### Key Observations

**Two Distinct Formats:**

1. **Legacy Format (2022-2024, ArcSOC 10.8.x)**
   - Creator: `Esri ArcSOC 10.8.1.14362`
   - Content: 8 inline content streams
   - XObjects: Images only (0 Form XObjects)
   - Layer names: ✅ Properly resolved
   - Bounds: ~1700x2100 (reasonable)
   - Path count: 4K-20K

2. **Topobuilder Format (2025, ArcSOC 13.3.x)**
   - Creator: `Esri ArcSOC 13.3.0.51575`
   - Keywords: `Topobuilder`
   - Content: 1 content stream + 1 Form XObject
   - Layer names: ❌ Shows /MC references
   - Bounds: 14K-35K (way too large - includes map collar)
   - Path count: 33K-90K

### Format Detection Signals

| Signal | Legacy | Topobuilder |
|--------|--------|-------------|
| Creator version | 10.8.x | 13.3.x |
| Keywords | (empty) | "Topobuilder" |
| Content streams | 8 | 1 |
| Form XObjects | 0 | 1 |
| Subject | (empty) | "24K CONUS Map", "100K CONUS Map", "250K Map" |

### The Problems

1. **Layer Name Resolution**: Topobuilder format stores paths in Form XObjects, but the MC→Layer mapping isn't being passed through correctly.

2. **Bounds Explosion**: Topobuilder bounds include map collar/projection grid coordinates that extend far beyond the actual map area.

3. **Path Count**: Topobuilder extracts 3-10x more paths, causing rendering slowdown.

### Current Issues
1. **Layer names broken** - 2025 format shows `/MC0`, `/MC1` instead of real names
2. **Bounds include outliers** - Map Collar/Projection layers have huge coordinates
3. **Performance** - 33K+ paths renders slowly
4. **One-size-fits-all** - Same code path for very different structures

## Proposed Solution: Format-Aware Pipeline

### Architecture Overview

```
PDF Input
    │
    ▼
┌─────────────────────────────────┐
│   1. FORMAT DETECTION           │
│   (USGSFormatDetector)          │
│   - Identify scale, year, type  │
│   - Determine content structure │
│   - Choose extraction strategy  │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│   2. STRATEGY SELECTION         │
│   - Get format-specific config  │
│   - Select appropriate parsers  │
│   - Set bounds filtering rules  │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│   3. CONTENT EXTRACTION         │
│   (Format-specific)             │
│   - Legacy: Inline streams      │
│   - 2025: XObject traversal     │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│   4. POST-PROCESSING            │
│   - Bounds calculation          │
│   - Outlier filtering           │
│   - Layer name resolution       │
└─────────────────────────────────┘
    │
    ▼
Normalized Output
```

### Key Design Principles

1. **Detect Once, Configure Accordingly** - Format detection happens early, then drives all subsequent processing
2. **Format Configs, Not Conditionals** - Use configuration objects rather than scattered if/else statements
3. **Pluggable Extractors** - Each format has its own extractor that produces normalized output
4. **Shared Post-Processing** - Common bounds calculation, filtering, normalization

## Implementation Plan

### Phase 1: Format Configuration System

Create a `FormatConfig` class that encapsulates all format-specific settings:

```javascript
// src/format-config.js
class FormatConfig {
  constructor(formatInfo) {
    this.formatInfo = formatInfo;
  }

  // Whether to parse Form XObjects
  get parseXObjects() {
    return this.formatInfo.generation === '2025';
  }

  // Layers to exclude from bounds calculation
  get boundsExcludeLayers() {
    if (this.formatInfo.generation === '2025') {
      return ['Map Collar', 'Map Frame', 'Projection and Grids', 'Barcode'];
    }
    return ['Map Collar', 'Projection and Grids', 'Barcode'];
  }

  // Layers that are "overlay" (not plottable map features)
  get overlayLayers() {
    return ['Labels', 'Map Collar', 'Map Frame', 'Barcode',
            'Geographic Names', 'Road Names and Shields', 'Road Shields'];
  }

  // Maximum expected coordinate range (for outlier detection)
  get expectedBoundsRange() {
    switch (this.formatInfo.scale) {
      case '250k': return { width: 8000, height: 10000 };
      case '100k': return { width: 5000, height: 7000 };
      case '24k':  return { width: 2000, height: 2500 };
      default:     return { width: 3000, height: 4000 };
    }
  }

  // XObject recursion depth
  get maxXObjectDepth() {
    return this.formatInfo.generation === '2025' ? 3 : 1;
  }
}
```

### Phase 2: Fix Layer Name Resolution

The core bug: When parsing Form XObjects in 2025 format, the layer map from parent context isn't being correctly applied.

**Root Cause**: The Form XObjects have their own Properties dictionary with `/MC` references, but these map to the same OCG layer references as the parent. We need to:

1. Build a **global** MC → Layer Name map from the page-level Properties
2. Pass this map to XObject parsing
3. Resolve MC references using this global map, not XObject-local map

```javascript
// In pdf-processor.js extractContentPaths()

// Build GLOBAL layer map from page Properties (before parsing any content)
const globalLayerMap = this.buildGlobalLayerMap(pageResources);

// Pass to parser
const parser = new PDFContentParser({
  layerMap: globalLayerMap,  // Use global map
  pdfContext: this.pdfDoc.context,
  // ...
});
```

### Phase 3: Smart Bounds Calculation

Instead of calculating bounds from ALL paths, use format-aware filtering:

```javascript
// In renderer.js generateSVG()

function calculateSmartBounds(paths, formatConfig) {
  // Step 1: Filter out overlay layers
  const mapPaths = paths.filter(p =>
    !formatConfig.boundsExcludeLayers.includes(p.layer)
  );

  // Step 2: Calculate bounds from filtered paths
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  mapPaths.forEach(path => {
    // ... standard bounds calculation
  });

  // Step 3: Sanity check - if bounds are way too large, use percentile
  const width = maxX - minX;
  const height = maxY - minY;
  const expected = formatConfig.expectedBoundsRange;

  if (width > expected.width * 3 || height > expected.height * 3) {
    // Fall back to percentile-based bounds (ignore extreme outliers)
    return calculatePercentileBounds(mapPaths, 95);
  }

  return { minX, minY, maxX, maxY, width, height };
}
```

### Phase 4: Integrate Into Processing Pipeline

Modify `pdf-processor.js` to use the format-aware approach:

```javascript
async process() {
  // 1. Load PDF
  this.pdfDoc = await PDFDocument.load(this.buffer);
  const pdfData = await pdfParse(this.buffer);

  // 2. DETECT FORMAT FIRST
  const detector = new USGSFormatDetector(this.pdfDoc, pdfData.info);
  const formatInfo = await detector.detect();
  const formatConfig = new FormatConfig(formatInfo);

  // 3. Extract with format-specific settings
  const contentPaths = await this.extractContentPaths(formatConfig);

  // 4. Post-process with format awareness
  const processedPaths = this.postProcessPaths(contentPaths, formatConfig);

  return {
    metadata: this.metadata,
    formatInfo,           // Include format info for UI
    formatConfig,         // Include config for renderer
    contentPaths: processedPaths,
    // ...
  };
}
```

### Phase 5: UI Updates

Pass format info to renderer so it can make smart decisions:

```javascript
// In renderer.js
function displayResults(data) {
  // Store format config for later use
  currentFormatConfig = data.formatConfig;

  // Show format info in UI
  if (data.formatInfo) {
    showFormatBadge(data.formatInfo);
  }

  // Use format-aware bounds calculation
  cachedBounds = calculateSmartBounds(
    data.contentPaths.paths,
    currentFormatConfig
  );
}
```

## File Changes Summary

| File | Changes |
|------|---------|
| `src/format-config.js` | **NEW** - Format configuration class |
| `src/usgs-format-detector.js` | Minor updates to detection logic |
| `src/pdf-processor.js` | Integrate format detection, pass config to parser |
| `src/pdf-content-parser.js` | Fix layer map handling for XObjects |
| `renderer/renderer.js` | Smart bounds, format-aware display |

## Testing Plan

1. **Legacy format** (VT_Charlotte_20240813): Should work as before, proper layer names
2. **2025 100K format** (ME_100K): Should have proper layer names, reasonable zoom
3. **2025 250K format** (VT_250K): Should have proper layer names, reasonable zoom
4. **Performance**: All files should load in <30 seconds

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking working formats | Test with all sample files before/after |
| Over-engineering | Keep format configs simple, add complexity only when needed |
| Unknown formats | Default to legacy behavior for unrecognized formats |

## Implementation Order

1. ✅ Create `format-config.js` with basic structure
2. ✅ Fix layer name resolution in XObject parsing (the core bug)
3. ✅ Implement smart bounds calculation
4. ✅ Integrate format detection into main pipeline
5. ✅ Test with all sample files
6. ✅ Clean up debug logging (already done)
