# Sample Files

This directory contains sample GeoPDF files and test data used for development and testing of GellyScape.

## Why are sample files not in the repo?

Large PDF, SVG, and image files are excluded from git tracking to keep the repository size manageable and reduce token load during AI-assisted development sessions. The files remain on your local machine but are not committed to the repository.

## Sample Files

The following types of files can be placed in this directory:

- **GeoPDF files** (`.pdf`) - USGS topographic maps or other georeferenced PDFs
- **SVG exports** (`.svg`) - Output files from the PDF processing
- **Screenshots** (`.png`, `.jpg`) - UI screenshots and test renders
- **Working files** - Intermediate processing outputs

## Getting Sample Files

### USGS Topographic Maps

You can download GeoPDF files from USGS:
- [USGS TopoView](https://ngmdb.usgs.gov/topoview/) - Browse and download USGS topographic maps
- [The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) - Download various map products

### Example Files Used in Development

The primary test file used during development:
- `VT_Burlington_20240809_TM_geo.pdf` - Vermont Burlington topographic map (USGS)

## Usage

Simply place your GeoPDF files in this directory and use the GellyScape application to process them.

**Note:** These files are ignored by git but remain available locally for testing and development.
