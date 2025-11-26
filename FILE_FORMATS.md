# USGS GeoPDF File Formats Specification

This document details the technical specifications for different USGS GeoPDF formats that GellyScape processes.

## Overview

USGS produces topographic maps in GeoPDF format at various scales. The format has evolved over time, with significant changes between 2023/2024 and 2025.

**Key Distinction:**
- **2023/2024 Format** (ArcSOC 10.8.x) - "Legacy" format with inline content streams
- **2025 Format** (ArcSOC 13.3.x / Topobuilder) - "New" format with Form XObjects

---

## Format 1: 7.5-Minute Quads (2023/2024)

**This is the PRIMARY supported format for GellyScape.**

### Identification

| Property | Value |
|----------|-------|
| Scale | 1:24,000 (24K) |
| Page Size | 1728 x 2088 pts (24" x 29") |
| Orientation | Portrait |
| Creator | `Esri ArcSOC 10.8.1.14362` |
| Keywords | None |
| Subject | Simple quad name (e.g., "Essex Junction") |

### Coordinate System

**Critical Finding:** All layers share a unified coordinate system.

```
Coordinate Space:
  X: 0 to ~1728 (page width in points)
  Y: -2088 to 0 (negative, top-down orientation)

Example layer bounds (VT_Essex_Junction):
  Hydrography:   X[17 to 1702]  Y[-2088 to -34]   = 1684 x 2054
  Transportation: X[179 to 1570] Y[-2026 to -189] = 1391 x 1836
  Terrain:       X[17 to 1482]  Y[-2088 to -34]   = 1464 x 2054
  Woodland:      X[23 to 1702]  Y[-2088 to -34]   = 1678 x 2054
```

**Key Insight:** Layer coordinates fit within PDF page bounds. Use page dimensions for canvas sizing.

### Path Transforms

- All paths have **identity transforms** (no transformation matrix applied)
- Coordinates are already in final page space
- No need to apply CTM during rendering

### Layers

| Layer Name | Description | Typical Path Count |
|------------|-------------|-------------------|
| Trails | Hiking trails, paths | 2,000-4,000 |
| Transportation | Major roads | 1,500-2,500 |
| Terrain | Contour lines | 1,000-2,000 |
| Hydrography | Water features | 500-2,500 |
| Woodland | Vegetation areas | 100-400 |
| Railroads | Rail lines | 100-800 |
| Road Features | Road details | 1,500-3,000 |
| Map Elements | Decorative elements | 150-200 |
| Structures | Buildings, landmarks | 20-100 |
| Projection and Grids | Grid lines | 25-30 |
| Geographic Names | Label outlines | 10-20 |
| Airports | Airport symbols | 5-10 |
| International | Border lines (if applicable) | 200-300 |

### Known Issues

1. **"Unassigned" layer paths** - Paths without BDC/EMC layer markers
   - **Can be 15-25% of total paths** (e.g., Jay Peak: 1,576 of 6,298 = 25%)
   - These are valid geometry that exists OUTSIDE of marked content blocks
   - Common content: contour lines, terrain features, water bodies
   - **Solution (implemented):** Assign to "Unassigned" layer instead of filtering out
   - **Previous bug:** Renderer filtered `path.layer = null` causing missing geometry

2. **Multiple content streams with color inheritance** (FIXED)
   - USGS PDFs can have 8+ content streams per page
   - Graphics state (colors) must carry over between streams
   - ~16% of paths (1,000 of 6,298) had colors defined in previous streams
   - **Previous bug:** Each stream started with default black, ignoring inherited colors
   - **Solution:** Pass `endingGraphicsState` from stream N to stream N+1
   - See "Multiple Content Streams & Graphics State Carryover" section below

3. **Layer assignment breakdown (Jay Peak example):**
   - Terrain (contours): 2,009 paths
   - Trails: 1,018 paths
   - Transportation: 648 paths
   - **Unassigned: 1,576 paths** (critical - these are real features!)
   - Hydrography: 350 paths
   - Others: remaining paths

4. **White fills** - Many paths have white fill that should be skipped

### Sample Files

- `VT_Essex_Junction_20240417_TM_geo.pdf`
- `NY_Niagara_Falls_20230524_TM_geo.pdf`
- `VT_Charlotte_20240813_TM_geo.pdf`
- `NY_Bolton_Landing_20230524_TM_geo.pdf`
- `VT_Jay_Peak_20240416_TM_geo.pdf` - Good test for unassigned layer issue (25% paths unassigned)

---

## Format 2: 7.5-Minute Quads (2025 / Topobuilder)

**Status: NOT YET FULLY SUPPORTED**

### Identification

| Property | Value |
|----------|-------|
| Scale | 1:24,000 (24K CONUS) |
| Page Size | 1728 x 2088 pts (24" x 29") |
| Orientation | Portrait |
| Creator | `Esri ArcSOC 13.3.0.51575` |
| Keywords | `Topobuilder` |
| Subject | `24K CONUS Map` |

### Key Differences from 2023/2024

1. **Content stored in Form XObjects** - Not inline in page content stream
2. **Requires XObject traversal** - Must recursively parse Form XObjects
3. **Different layer naming** - "Land Cover" instead of "Woodland"
4. **Color extraction fails** - Current method doesn't find colors

### Layers

| 2025 Layer | Equivalent 2023/2024 |
|------------|---------------------|
| Land Cover | Woodland |
| Roads | Road Features |
| Road Shields | Road Names and Shields |
| Wetlands | (new) |
| Trails | Trails |
| Recreation | (new) |

### Sample Files

- `MA_75MinuteTopo1_20251121_062032758784_TM_geo.pdf`

---

## Format 3: 100K Scale Maps (2025)

**Status: SUPPORTED** ✅

### Identification

| Property | Value |
|----------|-------|
| Scale | 1:100,000 (100K) |
| Page Size | 3312 x 2160 pts (46" x 30") |
| Orientation | Landscape |
| Creator | `Esri ArcSOC 13.3.0.51575` |
| Keywords | `Topobuilder` |
| Subject | `100K CONUS Map` |
| Layer Count | 28 |
| Typical Path Count | ~33,000 |

### Processed Output

```
Format Detection: 100k, 2025, Topobuilder
Page: 3312 x 2160 pts
Path Bounds: X[0 to 3312] Y[-2161 to 0] (correct page space!)
Layers: Hydrography, Transportation, Terrain, Land Cover, Map Collar, etc.
```

### Key Structural Differences from 7.5-Minute Format

**Comparison Table (NY 100K vs Jay Peak 7.5-minute):**

| Property | 7.5-minute (24K) | 100K |
|----------|------------------|------|
| Page size | 1728 x 2088 pts | 3312 x 2160 pts |
| Content streams | 8 | 1 |
| **Paths in main streams** | 6,298 | **0** |
| Form XObjects | 0 | **1** |
| Paths in Form XObjects | 0 | **23,581+** |
| Do operators | 211 | 1 |

**Critical Finding:** All paths in 100K maps are stored inside a single Form XObject (`/Fm0`), NOT inline in the page content streams like 7.5-minute quads.

### Coordinate System Architecture

The 100K format uses a sophisticated transformation chain:

```
Page Content Stream:
  q
  /GS0 gs
  /Fm0 Do      <-- Invokes the main Form XObject
  Q

Form XObject /Fm0:
  BBox: [0, 0, 18400, 12000]     <-- Native coordinate space
  Matrix: identity               <-- No transformation on XObject itself

  Internal CTM:
    q
    0.18 0 0 -0.18 0 2160 cm    <-- Scale 0.18x and flip Y
    ...paths in 18400x12000 space...
    Q
```

**Coordinate Space Analysis:**
- BBox defines native space: `18400 x 12000` units
- Scale factor: `0.18` (applied via cm operator)
- Transformed dimensions:
  - 18400 × 0.18 = **3312** (matches page width!)
  - 12000 × 0.18 = **2160** (matches page height!)
- Y-flip: `d = -0.18` combined with `f = 2160` translates origin to top

### CTM Matrix Fix (RESOLVED)

The "too small" display bug was caused by incorrect CTM matrix multiplication order.

**The Bug:**
- PDF spec requires `CTM' = matrix × CTM` (pre-multiplication)
- Code was using `CTM' = CTM × matrix` (post-multiplication)
- Per-symbol translations (~11203) were not being scaled by the 0.18 factor
- Result: coordinates in ~33K range instead of ~3K page space

**The Fix (pdf-content-parser.js:649):**
```javascript
// Before (wrong):
this.graphicsState.ctm = this.multiplyMatrices(this.graphicsState.ctm, matrix);

// After (correct per PDF spec):
this.graphicsState.ctm = this.multiplyMatrices(matrix, this.graphicsState.ctm);
```

### Architecture Notes

1. **Form XObjects** - 100K files reference nested XObjects:
   - `/Fm0` (main), `/Fm1`, `/Fm2`, `/Fm3`, `/Fm4` (layer-specific content)
   - `/Im0`, `/Im1` (raster images)
   - Each may have its own Matrix and BBox

2. **Heavy CTM Usage** - Over 23,000 `cm` (concat matrix) operators per file
   - Correct q/Q (save/restore) stack handling implemented
   - `transformCoordsDuringParsing` flag enables CTM application at parse time

### Additional Layers (vs 7.5-minute)

- Federal Administrated Lands
- Department of Defense
- U.S. Fish and Wildlife Service
- Jurisdictional Boundaries
  - County or Equivalent
  - State or Territory

### Sample Files

- `ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf`
- `NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf`

---

## Format 4: 250K Scale Maps (2025)

**Status: SUPPORTED** ✅

### Identification

| Property | Value |
|----------|-------|
| Scale | 1:250,000 (250K) |
| Page Size | 2383 x 1872 pts (33" x 26") |
| Orientation | Landscape |
| Creator | `Esri ArcSOC 13.3.0.51575` |
| Keywords | `Topobuilder` |
| Subject | `250K Map` |
| Title | Descriptive (e.g., `250K Topo, VT, 250000, Quad, 20251121, USGS`) |
| Layer Count | 29 |
| Typical Path Count | ~90,000 |

### Processed Output

```
Format Detection: 250k, 2025, Topobuilder
Page: 2383 x 1872 pts
Path Bounds: X[0 to 2383] Y[-1872 to 0] (correct page space!)
```

### Structure Comparison: 100K vs 250K

Both formats use identical architecture - the Topobuilder 2025 format:

| Property | 100K | 250K |
|----------|------|------|
| Page Size | 3312 x 2160 pts | 2383 x 1872 pts |
| Form XObject | `/Fm0` | `/Fm0` |
| Content Streams | 1 | 1 |
| Path Count | ~33,000 | ~90,000 |
| Creator | ArcSOC 13.3.x | ArcSOC 13.3.x |
| CTM Pattern | Same scaling transform | Same scaling transform |

### Layer Breakdown (VT 250K example)

| Layer | Path Count |
|-------|------------|
| Transportation | 58,554 |
| Hydrography | 20,244 |
| Terrain | 6,818 |
| Land Cover | 2,777 |
| Jurisdictional Boundaries | 852 |
| Geographic Names | 398 |
| Boundaries | 278 |
| Structures | 34 |

### Additional Layers (vs 100K)

- International boundaries (more likely to appear at this scale)

### Sample Files

- `VT_250K_Topo_20251121_054343748075_TM_geo.pdf`

---

## Technical Implementation Notes

### Multiple Content Streams & Graphics State Carryover

**Critical Discovery:** USGS GeoPDF files often have **multiple content streams** per page that are logically concatenated.

**Example (Jay Peak 7.5-minute quad):**
```
Page 1 has 8 content streams:
  Stream 0: 760 paths   - Sets stroke color #b38659 (tan/brown)
  Stream 1: 882 paths   - NO color operators! Inherits from Stream 0
  Stream 2: 3,389 paths - Sets some colors, inherits others
  Stream 3-7: Additional paths with mixed color handling
```

**The PDF Specification Requirement:**
- Content streams are treated as one continuous instruction stream
- Graphics state (colors, line width, CTM, etc.) carries over from stream N to stream N+1
- A path in Stream 1 that doesn't set a color uses the last color set in Stream 0

**Implementation Solution:**
```javascript
// Track graphics state across streams
let carryOverGraphicsState = null;

for (const stream of contentStreams) {
  const parser = new PDFContentParser({
    initialGraphicsState: carryOverGraphicsState  // Pass previous state
  });

  const { paths, endingGraphicsState } = parser.parseContentStream(stream);

  // Save ending state for next stream
  carryOverGraphicsState = endingGraphicsState;
}
```

**What gets carried over:**
- `strokeColor` - Current stroke color (RG/G operators)
- `fillColor` - Current fill color (rg/g operators)
- `lineWidth` - Line width (w operator)
- `lineCap`, `lineJoin` - Line styles
- `dashArray` - Dash pattern

**Bug History:**
- **Previous behavior:** Each stream started with default black (#000000)
- **Result:** ~1,000 paths (16%) rendered black instead of their correct colors
- **Fix:** Pass `endingGraphicsState` from stream N as `initialGraphicsState` for stream N+1

### Bounds Calculation Strategy

**For 2023/2024 7.5-minute quads:**
```javascript
// Use PDF page dimensions directly
width = pageInfo.width;   // 1728
height = pageInfo.height; // 2088
minX = 0;
maxX = width;
minY = -height;  // -2088
maxY = 0;
```

**For 2025 formats (TODO):**
- Need to extract and apply Form XObject Matrix entries
- May need to use LGIDict for geospatial bounds
- Consider using neatline/Map Frame layer as reference

### Color Extraction

**2023/2024:** Colors in inline content streams - extraction works
**2025:** Colors in Form XObjects - requires XObject traversal

### Path Structure

Each extracted path contains:
```javascript
{
  layer: "Hydrography",        // OCG layer name
  operations: [                // Drawing operations
    { type: "moveto", x: 100, y: -500 },
    { type: "lineto", x: 150, y: -520 },
    { type: "curveto", x1: 160, y1: -530, x2: 170, y2: -540, x: 180, y: -550 }
  ],
  fill: true,
  fillColor: [115, 178, 255],  // RGB 0-255
  stroke: false,
  strokeColor: null,
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }  // Usually identity for 2023/2024
}
```

---

## Format Detection Algorithm

```javascript
function detectUSGSFormat(metadata) {
  // Check for 2025 Topobuilder format
  if (metadata.Keywords === 'Topobuilder' ||
      metadata.Creator?.includes('13.3')) {

    if (metadata.Subject?.includes('250K')) return '250k-2025';
    if (metadata.Subject?.includes('100K')) return '100k-2025';
    if (metadata.Subject?.includes('24K CONUS')) return '7.5min-2025';
    return '2025-unknown';
  }

  // Legacy 2023/2024 format
  if (metadata.Creator?.includes('10.8')) {
    return '7.5min-legacy';  // PRIMARY SUPPORTED FORMAT
  }

  return 'unknown';
}
```

---

## Recommendations for Processing

### Priority 1: 7.5-Minute Legacy (2023/2024)
- **Status:** SUPPORTED
- Use PDF page bounds for sizing
- Skip "(no layer)" paths in bounds calculation
- All layers share coordinate system

### Priority 2: 7.5-Minute Topobuilder (2025)
- **Status:** Partial support via XObject parsing
- Need to test color extraction
- Layer names differ from legacy

### Priority 3: 100K/250K (2025)
- **Status:** SUPPORTED ✅
- Same Topobuilder architecture as 24K 2025 format
- CTM matrix pre-multiplication fix enables correct coordinate transforms
- `transformCoordsDuringParsing` flag applied for 2025 formats

---

## References

- USGS US Topo Map Downloads: https://www.usgs.gov/programs/national-geospatial-program/us-topo-maps
- PDF Reference Manual (Adobe): https://www.adobe.com/devnet/pdf/pdf_reference.html
- GeoPDF Technical Notes: https://www.loc.gov/preservation/digital/formats/fdd/fdd000312.shtml
