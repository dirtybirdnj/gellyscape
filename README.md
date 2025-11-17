# GellyScape - GeoPDF Layer Extraction Tool

A desktop application built with Electron for extracting and processing raster and vector layers from GeoPDF files.

## Features

- **PDF Upload**: Easy file selection via native dialog
- **Layer Identification**: Automatically identifies raster and vector layers
- **Georeference Detection**: Detects and extracts georeferencing information
- **Raster Extraction**: Extracts embedded images with metadata
- **Vector Extraction**: Extracts vector annotations and paths
- **Export Functionality**: Export layers in various formats
  - Raster: GeoTIFF, PNG, JPEG
  - Vector: GeoJSON, KML, CSV
- **Beautiful UI**: Modern, gradient-based interface with layer previews

## Technologies

- **Electron**: Cross-platform desktop application framework
- **pdf-lib**: PDF manipulation and extraction
- **pdf-parse**: PDF text and structure parsing
- **proj4**: Coordinate system transformations
- **georaster**: Raster data handling
- **geotiff**: GeoTIFF format support

## Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production mode
npm start

# Run tests
npm test              # Run all tests
npm run test:parser   # Test PDF content parser
npm run test:svg      # Test SVG path conversion
```

## Project Structure

```
gellyscape/
├── main.js                      # Electron main process
├── preload.js                   # Secure context bridge
├── src/
│   ├── pdf-processor.js         # Core PDF processing orchestration
│   ├── pdf-content-parser.js    # PDF content stream parser (vector extraction)
│   ├── svg-path-converter.js    # PDF→SVG path conversion & transformation
│   ├── raster-extractor.js      # Raster layer extraction
│   └── vector-extractor.js      # Vector layer extraction (legacy)
├── renderer/
│   ├── index.html               # UI layout and styling
│   └── renderer.js              # UI logic and interactions
├── docs/
│   ├── implementation-plan.md   # Detailed implementation roadmap
│   └── geopdf-to-svg-analysis.md # Analysis of sample files & workflow
├── samples/
│   ├── VT_Burlington_20240809_TM_geo.pdf     # Sample GeoPDF (40MB)
│   ├── btv-crop-11.5x23.5.svg                # Target output (1.7MB, clean)
│   └── VT_Burlington_20240809_TM_geo 2.svg   # Raw SVG export (15MB)
├── test-pdf-parser.js           # Test script for PDF content parser
├── test-svg-conversion.js       # Test script for PDF→SVG conversion
└── SECURITY.md                  # Security policy & vulnerability analysis
```

## How It Works

### 1. PDF Processing & Vector Extraction
The application uses `pdf-lib` to directly extract vector paths from GeoPDF content streams:

**PDF Content Stream Parser** (`src/pdf-content-parser.js`):
- Tokenizes PDF content streams into operators and operands
- Parses all vector drawing operations (moveto, lineto, curveto, closepath, etc.)
- Tracks graphics state (colors, line width, transformations, dash patterns)
- Handles fill, stroke, and fill-stroke operations
- Converts PDF color spaces (Gray/RGB/CMYK) to SVG hex colors
- Maintains state stack for nested transformations

**SVG Path Converter** (`src/svg-path-converter.js`):
- Converts PDF paths to SVG path syntax (M, L, C, Q, Z commands)
- Transforms coordinates from PDF space (bottom-left origin) to SVG space (top-left origin)
- Applies PDF transformation matrices
- Scales paths to target SVG dimensions
- Supports cropping regions
- Converts stroke/fill styles to SVG attributes

This enables **direct PDF→SVG conversion** with no external tools or manual steps required.

### 2. Layer Classification (In Development)
Organizes extracted paths into semantic layers for pen plotting:
- **Color-based classification**: Identifies layers by fill/stroke colors
- **Geometry-based classification**: Distinguishes contours, roads, water features
- **OCG analysis**: Uses PDF Optional Content Groups when available
- **Layer organization**: Groups paths by type (green/vegetation, water, roads, contours)

### 3. SVG Generation (In Development)
Generates organized SVG files optimized for pen plotters:
- **Layer grouping**: Semantic organization (water_fill, thin_topo, thick_topo, etc.)
- **Path optimization**: Simplification, merging, ordering for minimal pen lifts
- **Configurable styling**: Per-layer stroke widths, colors, and effects
- **Proper layer ordering**: Background to foreground rendering

### 4. Raster Extraction
Extracts embedded images from PDF XObjects:
- Identifies image format (JPEG, PNG, TIFF)
- Extracts image data and dimensions
- Preserves georeferencing information from Measure dictionaries
- Converts to base64 for preview and export

### 5. Georeferencing
Detects geospatial metadata:
- **VP (Viewport)**: Projection and bounding box information
- **LGIDict**: Layer Geospatial Information Dictionary
- **Measure**: Geographic and layout coordinate points
- **GPTS/LPTS**: Control points for coordinate transformation

## GeoPDF Standards

GellyScape supports the ISO 32000 (PDF) standard with geospatial extensions:

- **Optional Content Groups (OCGs)**: Layer organization
- **Measure Dictionaries**: Coordinate reference systems
- **Viewport Arrays**: Projection definitions
- **LGI Dictionaries**: Layer geospatial information

## Testing the PDF→SVG Conversion

To validate the PDF content parser and SVG path converter work correctly:

```bash
# Test the PDF content stream parser
npm run test:parser

# Test the complete PDF→SVG conversion pipeline
npm run test:svg

# Run both tests
npm test
```

The SVG conversion test will:
- Load the sample GeoPDF from `samples/`
- Extract all vector paths from the first page
- Convert paths to SVG format with coordinate transformation
- Generate a sample SVG file (`test-svg-output.svg`) with the first 1000 paths
- Output detailed statistics about colors, operations, and path types
- Save full conversion data to `test-svg-conversion.json`

**Validating the output:**
1. Open `test-svg-output.svg` in a browser or SVG viewer
2. Verify paths render correctly with proper coordinates
3. Check that the Y-axis transformation is working (PDF bottom-left → SVG top-left)
4. Review the console output for conversion statistics

## Sample GeoPDF Files

### USGS Topographic Map Repository
Access the complete USGS US Topo map collection:
- **Public S3 Bucket**: [https://prd-tnm.s3.amazonaws.com/index.html?prefix=StagedProducts/Maps/USTopo/PDF/](https://prd-tnm.s3.amazonaws.com/index.html?prefix=StagedProducts/Maps/USTopo/PDF/)
- Contains all US topographic maps in GeoPDF format
- Organized by state and quadrangle name
- Current and historical editions available
- Free public access for testing and use

### USGS Layer Metadata & Standards
For detailed layer specifications and metadata:
- **ArcGIS REST Service**: [https://index.nationalmap.gov/arcgis/rest/services/USTopoAvailability/MapServer](https://index.nationalmap.gov/arcgis/rest/services/USTopoAvailability/MapServer)
- **Layer Definitions**: [https://index.nationalmap.gov/arcgis/rest/services/USTopoAvailability/MapServer/layers](https://index.nationalmap.gov/arcgis/rest/services/USTopoAvailability/MapServer/layers)
- Provides standardized layer naming conventions and structure
- Useful for understanding GeoPDF layer organization

### Example Test Files
The repository includes sample files:
- `samples/VT_Burlington_20240809_TM_geo.pdf` - Vermont, Burlington quadrangle (40MB)
- `samples/TX_Austin_East_20220811_TM_geo.pdf` - Texas, Austin East quadrangle

## Usage

1. **Launch** the application
2. **Click** "Choose PDF File" to select a GeoPDF
3. **View** extracted metadata and layers
4. **Preview** raster images directly in the interface
5. **Export** individual layers in your preferred format

## Export Formats

### Raster Layers
- **GeoTIFF** (.tif, .tiff) - Preserves georeferencing
- **PNG** (.png) - Lossless compression
- **JPEG** (.jpg, .jpeg) - Lossy compression

### Vector Layers
- **GeoJSON** (.geojson, .json) - Standard GIS format
- **KML** (.kml) - Google Earth compatible
- **CSV** (.csv) - Tabular coordinate data

## Development Notes

### GeoPDF Structure
GeoPDF files contain:
- Standard PDF content plus geospatial extensions
- Coordinate Reference System (CRS) information in metadata
- Layer information in Optional Content Groups
- Georeferencing in Measure dictionaries

### Key PDF Objects
- **/Resources/XObject**: Contains images and forms
- **/Annots**: Vector annotations
- **/Contents**: Drawing operations
- **/Measure**: Georeferencing information
- **/VP**: Viewport/projection data

## Security

GellyScape follows Electron security best practices with context isolation and secure IPC communication. The reported npm audit vulnerabilities are in Electron's build-time dependencies (webpack, terser-webpack-plugin) and pose minimal runtime risk.

For detailed security information, see [SECURITY.md](SECURITY.md).

## Troubleshooting

### npm audit warnings
You may see warnings about vulnerabilities in `braces`, `micromatch`, `webpack`, and `terser-webpack-plugin`. These are build-time dependencies from Electron and do not affect runtime security. See [SECURITY.md](SECURITY.md) for details.

### Dependencies Won't Install
If you encounter network issues during `npm install`, try:
```bash
# Clear npm cache
npm cache clean --force

# Retry installation
npm install

# Or install with verbose logging
npm install --verbose
```

### PDF Won't Process
- Ensure the PDF is a valid GeoPDF file
- Check that the file isn't corrupted
- Try a different GeoPDF sample

### Layers Not Extracting
- Some PDFs may not contain standard layer structures
- Vector extraction requires parseable annotations or content streams
- Raster extraction requires embedded images in XObjects

## Future Enhancements

- [ ] Full content stream parser for complete vector extraction
- [ ] Advanced coordinate transformation using proj4
- [ ] Batch processing of multiple PDFs
- [ ] Layer merging and compositing
- [ ] Direct GeoTIFF generation with embedded CRS
- [ ] Support for additional export formats (Shapefile, DXF)
- [ ] Preview map display with Leaflet or Mapbox

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

ISC

## Acknowledgments

Built with the excellent libraries:
- [pdf-lib](https://pdf-lib.js.org/) - PDF manipulation
- [Electron](https://www.electronjs.org/) - Desktop framework
- [proj4js](http://proj4js.org/) - Coordinate transformations
