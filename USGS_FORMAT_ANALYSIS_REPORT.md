# USGS GeoPDF Format Analysis Report

**Date:** November 23, 2025
**Analyzed Files:** 5 USGS GeoPDF files (3 new, 2 existing)
**Analysis Script:** `/Users/mgilbert/Code/gellyscape/analyze-usgs-formats.js`

## Executive Summary

This report analyzes the structure and metadata of USGS GeoPDF files across different scales (250k, 100k, 75k/7.5-minute) and creation years (2023, 2024, 2025). Key findings reveal significant differences in layer organization, metadata structure, and creator software versions between formats and years.

---

## Files Analyzed

### New Files (November 2025)
1. **MA_75MinuteTopo1_20251121_062032758784_TM_geo.pdf**
   - Scale: 75k (7.5-minute equivalent - 24K CONUS)
   - Created: November 21, 2025
   - Size: 12.53 MB
   - Creator: Esri ArcSOC 13.3.0.51575

2. **VT_250K_Topo_20251121_054343748075_TM_geo.pdf**
   - Scale: 250k
   - Created: November 21, 2025
   - Size: 21.81 MB
   - Creator: Esri ArcSOC 13.3.0.51575

3. **ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf**
   - Scale: 100k
   - Created: November 21, 2025
   - Size: 24.37 MB
   - Creator: Esri ArcSOC 13.3.0.51575

### Existing Files (2023-2024)
4. **VT_Essex_Junction_20240417_TM_geo.pdf**
   - Scale: 7.5-minute quad (24K)
   - Created: April 17, 2024
   - Size: 43.54 MB
   - Creator: Esri ArcSOC 10.8.1.14362

5. **NY_Niagara_Falls_20230524_TM_geo.pdf**
   - Scale: 7.5-minute quad
   - Created: May 24, 2023
   - Size: 28.13 MB
   - Creator: Esri ArcSOC 10.8.1.14362

---

## Key Findings

### 1. Format Identification Markers

#### Reliable Format Identifiers

**In Metadata `Subject` field:**
- **75k format:** `"24K CONUS Map"` or `"24K CONUS Map"` (same as 7.5-minute)
- **100k format:** `"100K CONUS Map"`
- **250k format:** `"250K Map"`
- **Older 7.5-min:** No subject field (or simple quad name)

**In Metadata `Keywords` field:**
- **2025 PDFs:** All contain `"Topobuilder"`
- **2024/2023 PDFs:** No keywords field

**Creator Software Version:**
- **2025 PDFs:** `Esri ArcSOC 13.3.0.51575` (newer)
- **2024/2023 PDFs:** `Esri ArcSOC 10.8.1.14362` (older)

**Title Patterns:**
- **250k:** Descriptive with state and scale: `"250K Topo, VT, 250000, Quad, 20251121, USGS"`
- **100k/75k:** Filename format: `"ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf"`
- **Older quads:** Simple quad name: `"Essex Junction"`, `"Niagara Falls"`

**Recommended Detection Algorithm:**
```javascript
function detectUSGSFormat(metadata) {
  // Check Subject field first (most reliable)
  if (metadata.Subject) {
    if (metadata.Subject.includes('250K')) return '250k';
    if (metadata.Subject.includes('100K')) return '100k';
    if (metadata.Subject.includes('24K CONUS')) return '75k-or-7.5min';
  }

  // Check for newer vs older format by keywords
  const isNewer = metadata.Keywords === 'Topobuilder' ||
                   metadata.keywords === 'Topobuilder';

  // Check creator version
  const creatorVersion = extractVersion(metadata.Creator); // e.g., "13.3" vs "10.8"
  const is2025Format = creatorVersion >= 13.0;

  // Check title patterns
  if (metadata.Title && metadata.Title.includes('250K Topo')) return '250k';
  if (metadata.Title && metadata.Title.includes('100K_Topo')) return '100k';

  // Default to 7.5-minute if no other markers
  return '7.5-minute';
}
```

---

### 2. Layer Structure Comparison

#### Layer Count by Format

| Format | Layer Count | Notes |
|--------|-------------|-------|
| 75k (2025) | 25 | Similar to 7.5-min but simplified |
| 250k (2025) | 29 | More boundary/admin layers |
| 100k (2025) | 28 | Similar to 250k structure |
| 7.5-min (2024) | 26 | Includes "Woodland" instead of "Land Cover" |
| 7.5-min (2023) | 26 | Similar to 2024 |

#### Layer Naming Patterns

**Layers Common to All Formats:**
- Map Collar
- Map Elements
- Map Frame
- Terrain
- Contours
- Hydrography
- Transportation
- Roads
- Road Shields
- Structures
- Geographic Names
- Projection and Grids

**Format-Specific Layers:**

**250k and 100k Only:**
- Boundaries (top-level)
- Federal Administrated Lands
- Department of Defense / U.S. Fish and Wildlife Service
- Jurisdictional Boundaries
  - County or Equivalent
  - State or Territory
  - International (250k only)

**75k (2025) Unique:**
- Land Cover (instead of Woodland)
- Wetlands
- General Hydrography
- Trails
- Railroads
- Airports
- Recreation
- Public Services
- Emergency Services
- Populated Places
- Natural Features

**7.5-min (2024/2023) Unique:**
- Woodland (instead of Land Cover)
- Road Features (separate from Roads)
- Road Names and Shields (combined)
- Images layer
- Orthoimage layer
- Barcode

**Key Differences:**
1. **2025 formats** use "Land Cover" while **2024/2023** use "Woodland"
2. **250k/100k** have extensive boundary/administrative layers
3. **7.5-minute quads** include orthoimage and barcode layers
4. **Newer formats** separate road features more granularly

---

### 3. Color Palette Analysis

#### Critical Finding: Color Extraction Issue

**2025 PDFs (New Formats):**
- Color extraction returns **0 colors**
- Likely using XObject streams or different encoding
- Content may be in Form XObjects rather than inline

**2024/2023 PDFs (Older Formats):**
- Successfully extracted **45 colors** (Essex Junction) and **31 colors** (Niagara Falls)
- Colors are in inline content streams

#### Color Palette (From 2024 Essex Junction)

**Top 10 Most Used Colors:**

| Color | RGB | Type | Usage Count | Likely Feature |
|-------|-----|------|-------------|----------------|
| #5c8944 | (92, 137, 68) | fill | 743 | Woodland/vegetation |
| #73b2ff | (115, 178, 255) | fill | 657 | Water bodies |
| #e1e1e1 | (225, 225, 225) | stroke | 329 | Contour lines |
| #a8d483 | (168, 212, 131) | fill | 317 | Light vegetation |
| #89ace0 | (137, 172, 224) | stroke | 199 | Water features |
| #aecbf8 | (174, 203, 248) | fill | 185 | Water features |
| #000000 | (0, 0, 0) | fill | 82 | Text/labels |
| #ffffff | (255, 255, 255) | fill | 62 | Background |
| #f0f0f0 | (240, 240, 240) | stroke | 17 | Roads/infrastructure |
| #000000 | (0, 0, 0) | stroke | 14 | Outlines |

#### Recommendations for Color Extraction

**For 2025 Format PDFs:**
1. Check for Form XObject resources (`/XObject` in page resources)
2. Parse XObject content streams separately
3. Look for image data with embedded color information
4. Check for color spaces defined in Resources dictionary
5. May need to extract colors from raster images rather than vector content

**Implementation Strategy:**
```javascript
// Pseudo-code for improved color extraction
async function extractColorsAdvanced(pdfDoc) {
  const colors = new Map();

  // 1. Check inline content streams (current method)
  extractFromContentStreams(pdfDoc, colors);

  // 2. NEW: Check Form XObjects
  extractFromFormXObjects(pdfDoc, colors);

  // 3. NEW: Check image XObjects for dominant colors
  extractFromImageXObjects(pdfDoc, colors);

  // 4. NEW: Check Resources/ColorSpace
  extractFromColorSpaces(pdfDoc, colors);

  return colors;
}
```

---

### 4. Font Analysis

#### Font Availability by Format

| Format | Font Count | Font Extraction |
|--------|------------|-----------------|
| 75k (2025) | 0 | **Failed** |
| 250k (2025) | 0 | **Failed** |
| 100k (2025) | 0 | **Failed** |
| 7.5-min (2024) | 18 | **Success** |
| 7.5-min (2023) | 14 | **Success** |

#### Font Types Used (2024 Essex Junction)

**Primary Fonts:**
1. **Georgia** (Type0, with ToUnicode) - Body text
2. **Arial/Arial-Bold** (TrueType) - Labels
3. **TrebuchetMS/TrebuchetMS-Bold** (TrueType) - Headers
4. **TimesNewRomanPSMT** (TrueType) - Standard text
5. **CharisSIL** (TrueType, Italic/Bold) - Special labels
6. **SegoeUI** (TrueType) - UI elements

**Special/Symbol Fonts:**
- **Webdings** (Type0) - Symbols
- **ESRIDefaultMarker** - Map markers
- **ESRICaves3** - Terrain symbols
- **ESRIShields** - Road shields
- **ESRIBusiness** - POI icons
- **PLTS3** - Military/tactical symbols
- **Free3of9Extended** (Type1) - Barcodes

**Font Encoding Patterns:**
- **Type0 fonts:** Use custom encoding with ToUnicode CMaps
- **TrueType fonts:** Use WinAnsiEncoding (no ToUnicode)
- **Type1 fonts:** Use WinAnsiEncoding

---

### 5. Geospatial Metadata

**Critical Finding: Modified PDFs Lost Geospatial Data**

All analyzed PDFs show:
- `Has Viewport: No`
- `Has LGIDict: No`
- `Has Measure: No`
- `Is GeoPDF: No`

**Reason:** The `Producer` field shows `"pdf-lib (https://github.com/Hopding/pdf-lib)"` for all files, indicating they were **post-processed** and lost their original geospatial metadata.

**Original USGS GeoPDFs should have:**
- VP (Viewport) array with projection information
- LGIDict (Layer Geospatial Information Dictionary)
- Measure dictionary with coordinate systems

**Recommendation:** Test with pristine USGS downloads to analyze true geospatial metadata.

---

### 6. Page Size Differences

| Format | Width (pts) | Height (pts) | Width (in) | Height (in) | Aspect Ratio |
|--------|-------------|--------------|------------|-------------|--------------|
| 75k | 1728 | 2088 | 24.00" | 29.00" | 0.827 (portrait) |
| 250k | 2383 | 1872 | 33.10" | 26.00" | 1.273 (landscape) |
| 100k | 3312 | 2160 | 46.00" | 30.00" | 1.533 (landscape) |
| 7.5-min (2024) | 1728 | 2088 | 24.00" | 29.00" | 0.827 (portrait) |
| 7.5-min (2023) | 1728 | 2088 | 24.00" | 29.00" | 0.827 (portrait) |

**Patterns:**
- **7.5-minute and 75k quads:** Same size (24" x 29" portrait)
- **100k and 250k:** Larger, landscape orientation
- **Larger scales = larger page sizes**

---

## Recommendations for Gellyscape Implementation

### 1. Format Detection Strategy

```javascript
function detectPDFFormat(metadata, structure) {
  return {
    scale: detectScale(metadata),
    year: extractYear(metadata.CreationDate),
    version: extractArcSOCVersion(metadata.Creator),
    isNewer: metadata.Keywords === 'Topobuilder',
    pageSize: structure.pageSize,
    orientation: structure.pageSize.width > structure.pageSize.height ? 'landscape' : 'portrait'
  };
}
```

### 2. Layer Extraction Approach

**Current Code (pdf-processor.js) is Good For:**
- Extracting OCG layer names
- Mapping /MC references to layer names
- Tracking layer intent

**Improvements Needed:**
1. **Handle 2025 formats:** Different content stream structure
2. **Preserve format-specific layers:** Don't force unified layer names
3. **Track layer hierarchy:** Some layers have parent-child relationships
4. **Extract layer visibility:** Use ON/OFF arrays from D (Default) config

### 3. Color Preservation Strategy

**Don't Enforce Unified Palette - Preserve Original Colors**

Current issues:
- Color extraction fails on 2025 formats
- Need to extract from Form XObjects
- Should preserve exact colors from each format

**Recommended Approach:**
```javascript
class ColorExtractor {
  extractColors(pdfDoc, format) {
    const colors = {
      inline: this.extractFromInlineContent(pdfDoc),
      xobjects: this.extractFromXObjects(pdfDoc),
      images: this.extractFromImages(pdfDoc)
    };

    return {
      allColors: [...colors.inline, ...colors.xobjects, ...colors.images],
      byLayer: this.organizeByLayer(colors),
      statistics: this.generateStats(colors)
    };
  }
}
```

### 4. Data Extraction Priority

**For Each Format, Extract:**
1. **Layer Structure**
   - OCG names and references
   - Layer hierarchy (parent/child)
   - Layer visibility settings
   - Layer intent (/View, /Design)

2. **Color Information**
   - All unique colors used
   - Color usage by layer
   - Color space (RGB, CMYK, Gray)
   - Preserve exact color values

3. **Font Information**
   - Font names and types
   - Encoding schemes
   - ToUnicode CMap availability
   - Text extraction capability

4. **Content Organization**
   - Vector paths by layer
   - Text objects by layer
   - Form XObjects
   - Image XObjects

5. **Metadata Preservation**
   - Format indicators
   - Creation date/version
   - Scale information
   - Geographic extent (if available)

### 5. Handling Format Differences

**Create Format-Specific Processors:**

```javascript
class USGS_FormatHandler {
  constructor(format) {
    this.format = format; // '75k', '100k', '250k', '7.5min-old', '7.5min-new'
  }

  getExpectedLayers() {
    switch(this.format) {
      case '250k':
        return LAYERS_250K;
      case '100k':
        return LAYERS_100K;
      case '75k':
        return LAYERS_75K;
      default:
        return LAYERS_7_5MIN;
    }
  }

  extractContent(pdfDoc) {
    if (this.isNewerFormat()) {
      return this.extractFromXObjects(pdfDoc);
    } else {
      return this.extractFromInlineContent(pdfDoc);
    }
  }

  isNewerFormat() {
    return this.format.includes('2025') ||
           this.metadata.Keywords === 'Topobuilder';
  }
}
```

---

## Summary of Format Differences

### 2025 Formats vs 2024/2023 Formats

| Aspect | 2025 (ArcSOC 13.3) | 2024/2023 (ArcSOC 10.8) |
|--------|-------------------|------------------------|
| **Keywords** | "Topobuilder" | None |
| **Subject** | Scale specific | None or quad name |
| **Title** | Filename or descriptive | Quad name only |
| **Layer Names** | "Land Cover" | "Woodland" |
| **Content Storage** | XObjects (likely) | Inline streams |
| **Color Extraction** | Fails with current method | Works |
| **Font Extraction** | Fails with current method | Works |
| **File Size** | Smaller (12-24 MB) | Larger (28-44 MB) |

### 250k vs 100k vs 75k Scales

| Aspect | 250k | 100k | 75k |
|--------|------|------|-----|
| **Page Size** | 33" x 26" | 46" x 30" | 24" x 29" |
| **Orientation** | Landscape | Landscape | Portrait |
| **Layer Count** | 29 | 28 | 25 |
| **Boundary Layers** | Extensive | Extensive | Minimal |
| **Admin Layers** | Yes | Yes | No |
| **Detail Level** | Low | Medium | High |
| **File Size** | 21.8 MB | 24.4 MB | 12.5 MB |

---

## Next Steps for Development

### Immediate Tasks
1. ✅ **Completed:** Identify format differences
2. ✅ **Completed:** Document layer naming patterns
3. ✅ **Completed:** Analyze metadata structure

### Required Improvements
1. **Fix color extraction for 2025 formats**
   - Implement Form XObject parsing
   - Extract colors from image data
   - Test with all three new PDFs

2. **Fix font extraction for 2025 formats**
   - Debug font dictionary access
   - Verify font resource paths
   - Test ToUnicode CMap extraction

3. **Preserve format-specific features**
   - Don't force unified layer naming
   - Maintain original color palettes
   - Track format metadata

4. **Test with pristine USGS downloads**
   - Get unmodified PDFs
   - Verify geospatial metadata exists
   - Extract coordinate system information

### Testing Strategy
1. Create unit tests for each format
2. Verify layer extraction accuracy
3. Validate color preservation
4. Test text extraction quality
5. Measure performance with large files

---

## Appendix: File Locations

**Analysis Script:**
- `/Users/mgilbert/Code/gellyscape/analyze-usgs-formats.js`

**Sample PDFs:**
- `/Users/mgilbert/Code/gellyscape/samples/MA_75MinuteTopo1_20251121_062032758784_TM_geo.pdf`
- `/Users/mgilbert/Code/gellyscape/samples/VT_250K_Topo_20251121_054343748075_TM_geo.pdf`
- `/Users/mgilbert/Code/gellyscape/samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf`
- `/Users/mgilbert/Code/gellyscape/samples/VT_Essex_Junction_20240417_TM_geo.pdf`
- `/Users/mgilbert/Code/gellyscape/samples/NY_Niagara_Falls_20230524_TM_geo.pdf`

**Analysis Output:**
- `/Users/mgilbert/Code/gellyscape/usgs-format-analysis.json`

**Existing Test Files:**
- `/Users/mgilbert/Code/gellyscape/test-ocg-extraction.js`
- `/Users/mgilbert/Code/gellyscape/test-layer-extraction-comparison.js`
- `/Users/mgilbert/Code/gellyscape/test-fontdetails.js`

**Source Code:**
- `/Users/mgilbert/Code/gellyscape/src/pdf-processor.js`
- `/Users/mgilbert/Code/gellyscape/src/pdf-content-parser.js`
- `/Users/mgilbert/Code/gellyscape/src/vector-extractor.js`
- `/Users/mgilbert/Code/gellyscape/src/raster-extractor.js`
