# GeoPDF to SVG Conversion Analysis

## Sample Files Provided

### Input: VT_Burlington_20240809_TM_geo.pdf (40MB)
- GeoPDF file containing map data for Burlington, VT
- Contains both raster imagery and vector layers
- Created by US Geological Survey (USGS topographic map)

### Intermediate: VT_Burlington_20240809_TM_geo 2.svg (15MB)
- **Raw export from Pixelmator Pro 3.6.14**
- 12,362 lines of SVG
- Dimensions: 7200 x 8700 pixels
- Has SOME organization: green-area, lake-champlain, water-fill, large-rivers, inland-lakes
- Contains thousands of paths (path1...path2348+)
- Includes ALL text labels from the PDF (street names, place names, metadata)
- This is what you START with when exporting from the GeoPDF

### Desired Output: btv-crop-11.5x23.5.svg (1.7MB)
- **Cleaned and organized version**
- 3,135 lines of SVG (75% reduction)
- Dimensions: 828 x 1692 pixels (cropped and scaled down)
- Contains multiple organized vector layers with semantic IDs
- Text labels removed
- **This is what you WANT after processing**

## SVG Structure Analysis

The output SVG has the following layer structure:
```
Layer_1 (root group)
├── green (vegetation/parks with #A8D483 fill, 0.3 opacity)
├── water_fill (water bodies)
├── thin_topo (thin topographic lines)
├── thick_topo (thick topographic lines)
├── rivers (waterways)
├── trains (train routes)
├── train_tracks (railroad infrastructure)
├── track_ticks (railroad markers)
├── path_bg (path backgrounds)
├── path_dashes (dashed paths)
├── street (local streets)
├── maj_street (major streets)
├── connector (connecting roads)
└── highway (highways - #AF4B4C red/orange stroke, 3px width)
```

## Path Characteristics

### Green Layer (Vegetation)
- Fill: #A8D483 (light green)
- Fill-opacity: 0.3
- Stroke: #000000 (black)
- Stroke-width: 0.75

Each feature has TWO paths:
1. First path with fill color
2. Second path with stroke outline (fill-opacity="0")

### Highway Layer
- Stroke: #AF4B4C (red/orange)
- Stroke-width: 3
- Stroke-linecap: round
- No fill (fill-opacity="0")

## Path Data Format

Paths use SVG path commands:
- `M` = MoveTo (start point)
- `L` = LineTo (draw line to point)
- All coordinates in pixel space

Example:
```svg
<path d="M544.257,812.764 L543.745,813.532 L543.233,814.044 ..." />
```

## Actual Workflow

Based on the sample files, here's the actual workflow:

### Step 1: GeoPDF → Raw SVG (External Tool)
**Tool**: Pixelmator Pro, Illustrator, or other PDF → SVG converter
**Input**: VT_Burlington_20240809_TM_geo.pdf (40MB)
**Output**: VT_Burlington_20240809_TM_geo 2.svg (15MB, 7200x8700px)

Characteristics of raw export:
- Very large file size and dimensions
- Some basic layer organization (green-area, water layers)
- Thousands of individual paths
- ALL text labels included
- No semantic organization

### Step 2: SVG Processing & Cleanup (NEEDED IN OUR APP)
**Input**: Raw SVG from external tool
**Output**: Clean, organized SVG

This is what GellyScape needs to do:

1. **Load Raw SVG**
   - Parse SVG structure
   - Identify existing layers and groups
   - Extract all path elements

2. **Filter & Clean**
   - Remove text elements and labels
   - Filter out metadata/annotations
   - Remove map frame, grid lines, scale bars

3. **Reorganize Layers**
   - Merge "green-area" → "green"
   - Organize water layers → "water_fill", "rivers"
   - Identify roads → "street", "maj_street", "highway"
   - Detect other features → "thin_topo", "thick_topo", etc.

4. **Transform & Crop**
   - Apply bounding box crop
   - Scale down from 7200x8700 → 828x1692
   - Update all path coordinates

5. **Apply Styling**
   - Set consistent colors per layer type
   - Apply appropriate stroke widths
   - Add opacity where needed
   - Create dual paths (fill + stroke) for certain features

6. **Export Clean SVG**
   - Organized layer structure
   - Semantic naming
   - Optimized file size

## Key Observations

1. **Dual Path Approach**: Many features use two paths:
   - One for the fill (with opacity)
   - One for the outline (no fill)

2. **Layer Organization**: Semantic layer names make the SVG easily editable and parseable

3. **Coordinate Precision**: Coordinates are precise to 3 decimal places

4. **Styling Patterns**: Consistent color/style conventions:
   - Parks/vegetation: Light green with transparency
   - Water: Blue fills
   - Roads: Varying widths by importance
   - Highways: Thicker red/orange strokes

## Implementation Requirements

Based on the workflow analysis, GellyScape should focus on **SVG processing**, not PDF extraction. Users will export the GeoPDF to SVG using external tools (Pixelmator, Illustrator, Inkscape, etc.), then use GellyScape to clean and organize the output.

### Required Features:

1. **SVG Parser**
   - Load and parse raw SVG files
   - Extract layer structure and paths
   - Identify clipPath regions and groups

2. **Layer Reorganization Engine**
   - Intelligent layer detection and merging
   - Map raw layer names to semantic categories
   - Rule-based classification (e.g., color-based, name-based)

3. **Element Filtering**
   - Remove text elements
   - Filter out unwanted metadata
   - Keep only vector paths and shapes

4. **Coordinate Transformer**
   - Apply bounding box crop
   - Scale/resize to target dimensions
   - Transform all path coordinates
   - Maintain aspect ratio

5. **Style Manager**
   - Layer-based styling rules
   - Color scheme application
   - Stroke width optimization
   - Opacity settings

6. **SVG Exporter**
   - Generate clean SVG structure
   - Organized `<g>` groups with IDs
   - Optimized path data
   - Minimal file size

### Alternative: Direct PDF Processing

If we want to bypass external tools entirely:

1. **Enhanced PDF Vector Extraction**
   - Parse PDF content streams
   - Extract ALL vector operations
   - Convert to SVG paths directly

2. **PDF Layer Detection**
   - Read Optional Content Groups (OCGs)
   - Map to semantic categories
   - Apply styling rules

This would be more complex but provide a single-tool solution.
