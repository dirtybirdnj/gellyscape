# vpype Experimentation & Workflow Documentation

This document catalogs vpype command patterns and workflows used for processing GeoPDF-derived SVG files for pen plotting.

## Table of Contents
- [Core Workflows](#core-workflows)
- [Crop Operations](#crop-operations)
- [Grid & Test Pattern Generation](#grid--test-pattern-generation)
- [Optimization Operations](#optimization-operations)
- [Layer Management](#layer-management)
- [Attribute Preservation](#attribute-preservation)

---

## Core Workflows

### Basic Crop & Layout Workflow
The most common pattern: read SVG, crop to desired area, layout on target paper size, write output.

```bash
# Pattern: Read → Crop → Layout → Write
vpype read --attr fill --attr stroke --attr stroke-width INPUT.svg \
  crop X Y WIDTH HEIGHT \
  layout TARGET_SIZE \
  write OUTPUT.svg
```

**Examples:**
```bash
# Colchester Point - crop and center on 40x64" paper
vpype -v read --attr fill --attr stroke --attr stroke-color --attr stroke-opacity --attr stroke-linejoin \
  colchester-point.svg \
  crop 360mm 195mm 1200mm 2000mm \
  layout -m 1in -h center -v center 40x64in \
  write colpt5.svg

# North Hero - crop and layout on 55x75"
vpype read --attr fill --attr stroke-width north-hero-clean-v2.svg \
  crop 20cm 8cm 1390mm 1918mm \
  layout 55x75in \
  write nhc-trim-v5.svg

# Port Henry - crop with millimeter precision
vpype read --attr fill --attr stroke --attr stroke-width --attr fill-opacity \
  phenry-raw-2.svg \
  crop 271.4mm 189.5mm 130.3cm 180.2cm \
  write --restore-attribs porthenry-2019-vpype2.svg
```

---

## Crop Operations

### Crop with Specific Layers
For multi-layer SVGs where only certain layers need cropping.

```bash
# Pattern: Read → Select Layers → Crop → Layout → Write
vpype read INPUT.svg \
  forlayer crop X Y WIDTH HEIGHT layout SIZE write "output_%_lid%.svg" end
```

**Examples:**
```bash
# JC-NYC - crop specific layers (4-13)
vpype read --attr fill --attr stroke --attr stroke-width --attr stroke-linejoin \
  --attr stroke-linecap --attr fill-rule \
  --layer 4 --layer 5 --layer 6 --layer 7 --layer 8 --layer 9 \
  --layer 10 --layer 11 --layer 12 --layer 13 \
  JC-NYC-clean.svg \
  crop 500mm 199mm 1089mm 1760mm \
  layout 57x75in \
  write jc-nyc-crop-3.svg

# Crop waterway fills (layers 0-3)
vpype read --attr fill --attr stroke --attr stroke-width \
  --layer 0 --layer 1 --layer 2 --layer 3 \
  JC-NYC-clean.svg \
  crop 500mm 199mm 1089mm 1760mm \
  layout 57x75in \
  write --restore-attribs jc-nyc-crop-fills.svg
```

### Per-Layer Crop with forlayer
Apply crop to each layer individually and export separately.

```bash
# Split cropped layers into individual files
vpype read JC-NYC-clean.svg \
  forlayer \
    crop 500mm 199mm 1089mm 1760mm \
    layout 57x75in \
    write --restore-attribs "./jc-nyc-waterway/jc-nyc-crop-fills%_lid%.svg" \
  end
```

---

## Grid & Test Pattern Generation

### Pen Test Grids
Generate uniform grids of rectangles for pen calibration and testing.

```bash
# Pattern: penwidth → grid → rect → write
vpype penwidth WIDTH grid -o OFFSET SIZE ROWS COLS rect X Y WIDTH HEIGHT end write OUTPUT.svg
```

**Gelly Roll 0.60mm Test Patterns:**
```bash
# 1mm spacing, 12cm square, 200 rectangles
vpype penwidth 0.60mm grid -o 1mm 12cm 200 1 rect 0 0 0.25mm 12cm end write gelly-060-pad-100.svg

# 2mm spacing
vpype penwidth 0.60mm grid -o 2mm 12cm 200 1 rect 0 0 0.25mm 12cm end write gelly-060-pad-200.svg

# 1.5mm spacing
vpype penwidth 0.60mm grid -o 1.5mm 12cm 200 1 rect 0 0 0.25mm 12cm end write gelly-060-pad-150.svg

# 4mm spacing with 1mm wide marks
vpype penwidth 0.60mm grid -o 4mm 12cm 200 1 rect 0 0 0 1mm 12cm end write gelly-100-pad-400.svg
```

**Slici 0.25mm Test Patterns:**
```bash
# Progression from 0.5mm to 1mm spacing
vpype penwidth 0.25mm grid -o 0.5mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-050.svg
vpype penwidth 0.25mm grid -o 0.6mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-060.svg
vpype penwidth 0.25mm grid -o 0.7mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-070.svg
vpype penwidth 0.25mm grid -o 0.8mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-080.svg
vpype penwidth 0.25mm grid -o 0.85mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-085.svg
vpype penwidth 0.25mm grid -o 0.9mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-090.svg
vpype penwidth 0.25mm grid -o 1mm 5cm 200 1 rect 0 0 0.25mm 5cm end write slicci-025-pad-100.svg

# High-density test (2000 rectangles, 0.6mm spacing)
vpype penwidth 0.25mm grid -o 0.6mm 5cm 2000 1 rect 0 0 0.25mm 5cm end write 025-pad-060.svg
```

**Line Grid Tests:**
```bash
# Vertical lines instead of rectangles
vpype penwidth 0.25mm grid -o 0.5mm 5cm 200 1 line 0 0 0 1065 end layout a4 write lines050.svg
```

**Large Format Tests:**
```bash
# 200cm grid with 3mm spacing
vpype grid -o 3mm 200cm 1200 1 rect 0 0 0.25mm 200cm end write 025-pad-300.svg

# 400cm grid rotated 3 degrees on A0
vpype grid -o 4mm 400cm 1000 1 rect 0 0 0.25mm 400cm end rotate 3 layout a0 write 025-pad-400.svg
```

---

## Optimization Operations

### Path Optimization Workflow
Standard optimization sequence for pen plotting efficiency.

```bash
# Pattern: Read → Split → Sort → Simplify → Merge → Sort → Merge → Write
vpype -vv read --attr stroke --attr stroke-width INPUT.svg \
  forlayer \
    splitall \
    linesort \
    linesimplify \
    linemerge \
  end \
  write OUTPUT.svg
```

**Examples:**
```bash
# Burlington with crop
vpype -vv read --attr stroke --attr stroke-width btv-linefill.svg \
  forlayer \
    splitall \
    linesort \
    linesimplify \
    linemerge \
  end \
  crop 70mm 45mm 31.3cm 43.4cm \
  write btv-linefill-opt.svg

# Jay Peak optimization attempts
vpype -vv read --attr stroke --attr stroke-width --attr stroke-linejoin \
  vt-jaypeak-20240416-raw.svg \
  forlayer linesort linemerge -t end \
  write vt-jaypeak-vpype.svg

# With extended attributes preserved
vpype -vv read --attr fill --attr stroke --attr stroke-width --attr stroke-linejoin \
  --attr font-family --attr font-size --attr kerning \
  vt-jaypeak-20240416-raw.svg \
  forlayer \
    splitall \
    linesort \
    linemerge \
    linesort \
    linemerge \
  end \
  write --restore-attribs vt-jaypeak-vpype.svg
```

---

## Layer Management

### Layer Selection & Export
Extract specific layers or delete unwanted ones.

```bash
# Export single layer
vpype read --layer 2 JC-NYC-clean.svg \
  layout 57x75in \
  write --restore-attribs ./jc-nyc-waterway/big-fill.svg

# Delete multiple layers (keep only 0-3)
vpype -vv read vt-jaypeak-20240416-raw.svg \
  ldelete 4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35 \
  write jaypeak-vpype.svg

# Export each layer to separate file
vpype read INPUT.svg \
  forlayer write "output_%_name or _lid%.svg" end
```

### Layer Property Inspection
```bash
# List all properties available on layers
vpype -vv read --attr fill --attr stroke --attr stroke-width --attr stroke-linejoin \
  --attr font-family --attr font-size --attr kerning \
  vt-jaypeak-20240416-raw.svg \
  forlayer proplist end
```

---

## Attribute Preservation

### Common Attribute Patterns

**Stroke Attributes:**
```bash
--attr stroke --attr stroke-width --attr stroke-color --attr stroke-opacity \
--attr stroke-linejoin --attr stroke-linecap
```

**Fill Attributes:**
```bash
--attr fill --attr fill-opacity --attr fill-rule
```

**Text Attributes:**
```bash
--attr font-family --attr font-size --attr kerning
```

**Complete Set (for maximum preservation):**
```bash
vpype read --attr fill --attr stroke --attr stroke-width --attr stroke-linejoin \
  --attr stroke-linecap --attr fill-rule --attr stroke-color --attr stroke-opacity \
  --attr fill-opacity --attr font-family --attr font-size --attr kerning \
  INPUT.svg \
  ... \
  write --restore-attribs OUTPUT.svg
```

---

## XML Preprocessing (xmlstarlet)

Sometimes SVG cleanup is needed before vpype processing.

```bash
# Remove all text elements and their parent groups
xmlstarlet ed -N svg="http://www.w3.org/2000/svg" \
  -d '//svg:g[svg:text]' \
  input.svg > output.svg

# Remove clipping paths and clip-path attributes
xmlstarlet ed -N svg="http://www.w3.org/2000/svg" \
  -d '//svg:clipPath' \
  -d '//@clip-path' \
  vt-jaypeak-20240416-raw.svg > vt-jaypeak-20240416-raw-noclip.svg

# Keep only path elements (nuclear option)
xmlstarlet ed -N svg="http://www.w3.org/2000/svg" \
  -d '//svg:*[not(self::svg:path)]' \
  vt-jaypeak-20240416-raw.svg > vt-jaypeak-20240416-raw-paths.svg
```

---

## Common Patterns Reference

### Verbosity Flags
- `-v`: Verbose output
- `-vv`: Very verbose (debug level)

### Layout Options
- `layout SIZE`: Fit to page size (e.g., `a4`, `letter`, `40x64in`)
- `layout -m MARGIN SIZE`: Add margins
- `layout -h center -v center SIZE`: Center horizontally and vertically

### Crop Coordinates
Format: `crop X Y WIDTH HEIGHT`
- Units: `mm`, `cm`, `in` (defaults to pixels)
- Origin: Bottom-left corner (SVG coordinates)

### Grid Parameters
Format: `grid -o OFFSET SIZE ROWS COLS`
- `-o OFFSET`: Spacing between elements
- `SIZE`: Total grid dimension
- `ROWS COLS`: Number of repetitions

---

## Tips & Gotchas

1. **Attribute Preservation**: Always use `--restore-attribs` when writing if you used `--attr` when reading
2. **Layer Numbering**: vpype uses 0-based layer indexing
3. **Coordinate System**: vpype uses bottom-left origin (standard SVG)
4. **Units**: Explicitly specify units to avoid confusion (`mm`, `cm`, `in`)
5. **Optimization Order**: `splitall → linesort → linesimplify → linemerge` is the canonical sequence
6. **forlayer**: Useful for per-layer operations but can be slow on many layers

---

## Integration with GellyScape

The GellyScape application should:
1. Export clean SVG with proper layer organization
2. Allow interactive crop area selection
3. Generate vpype commands based on user selections
4. Execute vpype in subprocess for final processing
5. Support batch operations on multiple layer combinations

### Recommended Export Command Template
```bash
vpype read --attr fill --attr stroke --attr stroke-width --attr stroke-linejoin \
  --attr stroke-linecap --attr fill-rule \
  <EXPORTED_SVG> \
  crop <X>mm <Y>mm <WIDTH>mm <HEIGHT>mm \
  layout -m 1in -h center -v center <TARGET_SIZE> \
  write --restore-attribs <OUTPUT_SVG>
```
