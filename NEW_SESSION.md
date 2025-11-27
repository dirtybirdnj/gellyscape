# GellyScape Session Context - November 25, 2025

## Current State

### Problem: Map Bounds/Alignment - FIXED (needs testing)

The previous session identified that maps were displaying fragmented/misaligned. After diagnostic analysis, the root cause was found and a fix was applied.

### Root Cause (for 2023/2024 7.5-minute quads)

**Key Finding:** All layers share a unified coordinate system!

```
Diagnostic results (VT_Essex_Junction_20240417):
  Total paths: 12,676
  Paths with identity transform: 12,676
  Paths with non-identity transform: 0

Layer bounds (all layers share same coordinate space):
  Hydrography:    X[17 to 1702]  Y[-2088 to -34]   = 1684 x 2054
  Transportation: X[179 to 1570] Y[-2026 to -189] = 1391 x 1836
  Terrain:        X[17 to 1482]  Y[-2088 to -34]   = 1464 x 2054
  Woodland:       X[23 to 1702]  Y[-2088 to -34]   = 1678 x 2054

PDF Page: 1728 x 2088 pts (24" x 29")
```

The issue was:
1. "(no layer)" paths contained outlier coordinates (e.g., negative X for barcodes)
2. Previous bounds calculation included these outliers, skewing the entire canvas

### Fix Applied

Modified `renderer/renderer.js` bounds calculation (around line 982-1030) to:
1. Use PDF page dimensions directly as canonical bounds
2. Skip "(no layer)" paths in fallback calculation

```javascript
// For 2023/2024 7.5-minute USGS quads, use PDF page dimensions directly
const pageInfo = currentPDFData.metadata?.pages?.[0];

if (pageInfo && pageInfo.width && pageInfo.height) {
  width = pageInfo.width;   // 1728
  height = pageInfo.height; // 2088
  minX = 0;
  maxX = width;
  minY = -height;  // -2088
  maxY = 0;
}
```

---

## Format Priority

**CRITICAL:** Focus on 2023/2024 7.5-minute quads FIRST before adapting for other formats.

| Format | Status | Priority |
|--------|--------|----------|
| 7.5-min 2023/2024 | Fix applied, needs testing | **PRIMARY** |
| 7.5-min 2025 Topobuilder | Partial XObject support | Later |
| 100K/250K 2025 | Not supported | Later |

---

## Files Modified This Session

### `renderer/renderer.js`
- Bounds calculation now uses PDF page dimensions
- Skips "(no layer)" paths in fallback calculation
- Look for: `"Using PDF page bounds:"` in console output

### `diagnose-bounds.js` (NEW)
- Diagnostic script for analyzing 2023/2024 format
- Run with: `node diagnose-bounds.js`
- Confirms all layers share unified coordinate system

### `FILE_FORMATS.md` (NEW)
- Comprehensive documentation of all USGS GeoPDF formats
- Contains identification markers, layer lists, coordinate systems
- Format detection algorithm included

---

## Testing Checklist

After restarting workstation:

1. **Start app in dev mode:**
   ```bash
   npm run dev
   ```

2. **Load a 2023/2024 7.5-minute quad:**
   - `samples/VT_Essex_Junction_20240417_TM_geo.pdf`
   - `samples/NY_Niagara_Falls_20230524_TM_geo.pdf`

3. **Check console for:**
   - `"Using PDF page bounds: 1728 x 2088 pts"` - confirms fix is active
   - Map should display with all layers properly aligned

4. **Visual verification:**
   - Layers should overlay correctly (not scattered)
   - Toggle layers on/off - they should align
   - Zoom should work properly

---

## Key Technical Details

### Coordinate System (2023/2024 format)
- X: 0 to 1728 (page width in points)
- Y: -2088 to 0 (negative, top-down orientation)
- All layers share this coordinate system
- No transformation matrices needed (all identity)

### Format Detection
```javascript
// 2023/2024 format markers:
Creator: "Esri ArcSOC 10.8.x"
Keywords: (none or not "Topobuilder")
Page size: 1728 x 2088 pts

// 2025 format markers:
Creator: "Esri ArcSOC 13.3.x"
Keywords: "Topobuilder"
Subject: "24K CONUS Map" or "100K CONUS Map" etc.
```

### Path Structure
```javascript
{
  layer: "Hydrography",        // OCG layer name
  operations: [                // Drawing operations
    { type: "moveto", x: 100, y: -500 },
    { type: "lineto", x: 150, y: -520 }
  ],
  fill: true,
  fillColor: [115, 178, 255],  // RGB 0-255
  stroke: false,
  transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }  // Always identity for 2023/2024
}
```

---

## File Structure

```
gellyscape/
├── main.js                    # Electron main process
├── preload.js                 # IPC bridge
├── renderer/
│   ├── index.html            # UI
│   └── renderer.js           # Main logic, PDF processing, Canvas rendering
├── src/
│   ├── pdf-processor.js      # PDF parsing, metadata extraction
│   ├── pdf-content-parser.js # Content stream parsing, path extraction
│   └── usgs-format-detector.js # USGS format detection
├── samples/                   # Test PDF files
├── diagnose-bounds.js        # Diagnostic script
├── FILE_FORMATS.md           # Format specifications
└── NEW_SESSION.md            # This file
```

---

## Commands Reference

```bash
# Development mode (DevTools + logging)
npm run dev

# Normal start
npm start

# Run bounds diagnostic
node diagnose-bounds.js
```

---

## Next Steps

1. **Verify the bounds fix works** for 2023/2024 format
2. **Test layer toggling** - bounds should remain stable
3. **Test zoom functionality** - should scale properly
4. **Test crop/export** - vpype integration should work with aligned layers

After 2023/2024 format is confirmed working:
- Adapt for 2025 Topobuilder format
- Handle different coordinate systems in 100K/250K maps

---

## Sample Files

Located in `samples/` directory:

**2023/2024 Format (PRIMARY - test these first):**
- `VT_Essex_Junction_20240417_TM_geo.pdf`
- `NY_Niagara_Falls_20230524_TM_geo.pdf`
- `VT_Charlotte_20240813_TM_geo.pdf`
- `NY_Bolton_Landing_20230524_TM_geo.pdf`

**2025 Format (later):**
- `MA_75MinuteTopo1_20251121_*.pdf`
- `ME_100K_Topo_1_20251121_*.pdf`
