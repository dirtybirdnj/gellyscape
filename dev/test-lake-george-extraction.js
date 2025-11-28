#!/usr/bin/env node

/**
 * Test script to extract data from NY 100K Lake George map
 * Demonstrates format detection and data extraction
 */

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const USGSFormatDetector = require('./src/usgs-format-detector');
const PDFProcessor = require('./src/pdf-processor');

async function testLakeGeorgeExtraction() {
  const pdfPath = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

  console.log('=== USGS GeoPDF Analysis: Lake George NY 100K ===\n');
  console.log(`Reading: ${pdfPath}\n`);

  // Read the PDF
  const buffer = fs.readFileSync(pdfPath);

  // Load with both pdf-lib and pdf-parse
  const pdfDoc = await PDFDocument.load(buffer);
  const pdfData = await pdfParse(buffer);

  console.log('Step 1: Format Detection');
  console.log('------------------------');

  // Detect format
  const detector = new USGSFormatDetector(pdfDoc, pdfData.info);
  const formatInfo = await detector.detect();

  console.log(detector.getSummary());
  console.log('\n');

  console.log('Step 2: Layer Categorization');
  console.log('---------------------------');

  const layerMapping = detector.getLayerMapping();
  for (const [category, layers] of Object.entries(layerMapping)) {
    if (layers.length > 0) {
      console.log(`${category}: ${layers.join(', ')}`);
    }
  }
  console.log('\n');

  console.log('Step 3: Extract All Data');
  console.log('-----------------------');

  const processor = new PDFProcessor(buffer);

  // Set up progress reporting
  processor.setProgressCallback((progress) => {
    console.log(`[${progress.operation}] ${progress.detail}`);
  });

  const result = await processor.process();

  console.log('\nExtraction Results:');
  console.log(`  Pages: ${result.pageCount}`);
  console.log(`  Raster Layers: ${result.rasterLayers?.length || 0}`);
  console.log(`  Vector Annotations: ${result.vectorLayers?.length || 0}`);
  console.log(`  Content Paths: ${result.contentPaths?.paths?.length || 0}`);
  console.log(`  Text Objects: ${result.contentPaths?.textObjects?.length || 0}`);

  if (result.contentPaths?.statistics) {
    console.log('\nPath Statistics:');
    console.log(`  Total Paths: ${result.contentPaths.statistics.total}`);
    console.log(`  By Operation:`, result.contentPaths.statistics.byOperation);
    console.log(`  Unique Colors: ${Object.keys(result.contentPaths.statistics.byColor || {}).length}`);
  }

  // Analyze colors
  if (result.contentPaths?.statistics?.byColor) {
    console.log('\nColor Analysis (Top 10):');
    const colorEntries = Object.entries(result.contentPaths.statistics.byColor);
    colorEntries
      .sort((a, b) => (b[1].fill + b[1].stroke) - (a[1].fill + a[1].stroke))
      .slice(0, 10)
      .forEach(([color, usage]) => {
        const total = usage.fill + usage.stroke;
        console.log(`  ${color}: ${total} uses (${usage.fill} fill, ${usage.stroke} stroke)`);
      });
  }

  // Save format info to JSON
  const outputPath = './lake-george-format-info.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    formatInfo,
    extractionSummary: {
      pages: result.pageCount,
      rasterLayers: result.rasterLayers?.length || 0,
      vectorAnnotations: result.vectorLayers?.length || 0,
      contentPaths: result.contentPaths?.paths?.length || 0,
      textObjects: result.contentPaths?.textObjects?.length || 0,
      statistics: result.contentPaths?.statistics
    },
    layerMapping
  }, null, 2));

  console.log(`\nFormat info saved to: ${outputPath}`);

  // Check for Lake George specific features
  console.log('\nStep 4: Searching for Lake George Features');
  console.log('------------------------------------------');

  if (result.contentPaths?.textObjects) {
    const lakeGeorgeText = result.contentPaths.textObjects.filter(obj =>
      obj.text && obj.text.toLowerCase().includes('lake')
    );

    console.log(`Found ${lakeGeorgeText.length} text objects containing "lake"`);

    if (lakeGeorgeText.length > 0) {
      console.log('\nSample lake-related text:');
      lakeGeorgeText.slice(0, 10).forEach(obj => {
        console.log(`  "${obj.text}" (Layer: ${obj.layer || 'unknown'})`);
      });
    }
  }

  // Analyze hydrography layers
  if (layerMapping.hydrography.length > 0) {
    console.log('\nHydrography Layers Found:');
    layerMapping.hydrography.forEach(layer => {
      console.log(`  - ${layer}`);

      // Count paths in this layer
      if (result.contentPaths?.paths) {
        const layerPaths = result.contentPaths.paths.filter(p => p.layer === layer);
        console.log(`    Paths: ${layerPaths.length}`);
      }
    });
  }

  console.log('\n=== Analysis Complete ===\n');
}

// Run the test
testLakeGeorgeExtraction().catch(error => {
  console.error('\nError during extraction:', error);
  console.error(error.stack);
  process.exit(1);
});
