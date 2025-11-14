#!/usr/bin/env node

/**
 * Test to see if "Road Features" layer has any actual vector paths
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

async function testRoadFeatures() {
  const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';

  console.log('='.repeat(80));
  console.log('ROAD FEATURES LAYER DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log(`\nPDF: ${pdfPath}\n`);

  const buffer = fs.readFileSync(pdfPath);
  const processor = new PDFProcessor(buffer);

  const result = await processor.process();

  console.log('\n--- LAYER NAMES FROM OCG ---');
  if (result.layerNames && Object.keys(result.layerNames).length > 0) {
    Object.keys(result.layerNames).sort().forEach(name => {
      console.log(`  - ${name}`);
    });
  } else {
    console.log('  (none found)');
  }

  console.log('\n--- CONTENT PATHS BY LAYER ---');
  if (result.contentPaths && result.contentPaths.paths) {
    const pathsByLayer = {};

    result.contentPaths.paths.forEach(path => {
      const layer = path.layer || '(no layer)';
      if (!pathsByLayer[layer]) {
        pathsByLayer[layer] = 0;
      }
      pathsByLayer[layer]++;
    });

    const sortedLayers = Object.keys(pathsByLayer).sort();
    sortedLayers.forEach(layer => {
      console.log(`  ${layer}: ${pathsByLayer[layer]} paths`);
    });

    console.log(`\n  Total paths: ${result.contentPaths.paths.length}`);

    // Check specifically for "Road Features"
    console.log('\n--- ROAD FEATURES ANALYSIS ---');
    const roadFeaturesCount = pathsByLayer['Road Features'] || 0;
    const roadNamesCount = pathsByLayer['Road Names and Shields'] || 0;

    console.log(`  "Road Features" paths: ${roadFeaturesCount}`);
    console.log(`  "Road Names and Shields" paths: ${roadNamesCount}`);

    if (roadFeaturesCount === 0) {
      console.log('\n  ⚠️  WARNING: "Road Features" layer has NO vector paths!');
      console.log('  This means road vector data is not being associated with the layer.');
    } else {
      console.log(`\n  ✓ "Road Features" has ${roadFeaturesCount} vector paths`);
    }
  }

  console.log('\n--- TEXT OBJECTS BY LAYER ---');
  if (result.contentPaths && result.contentPaths.textObjectsByLayer) {
    const textLayers = Object.keys(result.contentPaths.textObjectsByLayer).sort();
    textLayers.forEach(layer => {
      const count = result.contentPaths.textObjectsByLayer[layer].length;
      console.log(`  ${layer}: ${count} text objects`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

testRoadFeatures().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
