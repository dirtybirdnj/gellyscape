# GeoPDF to SVG Conversion Analysis

## Sample Files Provided

### Input: VT_Burlington_20240809_TM_geo.pdf (40MB)
- GeoPDF file containing map data for Burlington, VT
- Contains both raster imagery and vector layers

### Desired Output: btv-crop-11.5x23.5.svg (1.7MB)
- 3135 lines of SVG
- Dimensions: 828 x 1692 pixels
- Contains multiple organized vector layers with IDs

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

## Required Conversion Process

To convert GeoPDF to this SVG format:

1. **Extract Vector Layers** from PDF
   - Parse Optional Content Groups (OCGs)
   - Extract annotations, paths, and shapes
   - Identify layer types by analyzing properties

2. **Categorize by Layer Type**
   - Vegetation → green
   - Water → water_fill
   - Contours → thin_topo, thick_topo
   - Transportation → various road/rail layers

3. **Transform Coordinates**
   - Convert PDF coordinate space to SVG coordinate space
   - Apply any georeferencing transformations
   - Scale to desired output dimensions (828x1692)

4. **Apply Styling**
   - Map layer types to colors and styles
   - Set appropriate stroke widths and opacities
   - Create both fill and stroke paths where needed

5. **Organize into Groups**
   - Create SVG `<g>` elements with layer IDs
   - Group related paths together
   - Maintain proper layer ordering

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

The current GeoPDF processor needs enhancement to:

1. **Better Vector Extraction**
   - Parse PDF content streams to extract all path operations
   - Identify and extract all vector elements (not just annotations)
   - Preserve path geometry accurately

2. **Layer Classification**
   - Analyze OCG (Optional Content Group) names
   - Map to semantic layer categories
   - Apply appropriate styling rules

3. **SVG Generation**
   - Create proper SVG document structure
   - Generate organized layer groups
   - Apply correct styling attributes
   - Format path data correctly

4. **Coordinate Transformation**
   - Transform from PDF space to SVG pixel space
   - Handle georeferencing if needed
   - Support cropping/bounding box selection
