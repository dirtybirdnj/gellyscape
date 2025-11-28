#!/usr/bin/env node
/**
 * Test script to verify backend SVG generation works correctly
 */

const fs = require('fs').promises;
const PDFProcessor = require('./src/pdf-processor');
const SVGGenerator = require('./src/svg-generator');

async function main() {
  const testFile = process.argv[2] || '/Users/mgilbert/gellyscape/Lake George NY_20250108.pdf';

  console.log('Testing backend SVG generation with:', testFile);

  try {
    // Check if file exists
    await fs.access(testFile);

    // Load and process PDF
    console.log('\n1. Loading PDF...');
    const fileBuffer = await fs.readFile(testFile);

    console.log('2. Processing PDF...');
    const processor = new PDFProcessor(fileBuffer);
    const result = await processor.process();

    const paths = result.contentPaths?.paths || [];
    console.log('3. Extracted paths:', paths.length);

    // Create SVG generator
    console.log('\n4. Creating SVG generator...');
    const svgGenerator = new SVGGenerator(paths);

    // Get available layers
    const layerInfo = svgGenerator.getAvailableLayers();
    console.log('5. Available layers:', layerInfo.length);

    console.log('\nFirst 10 layers:');
    layerInfo.slice(0, 10).forEach(layer => {
      console.log(`   - ${layer.name} (${layer.pathCount} paths)`);
    });

    // Get enabled layers (exclude overlays)
    const enabledLayers = layerInfo
      .filter(l => !l.baseLayer.toLowerCase().includes('overlay'))
      .map(l => l.name);

    console.log('\n6. Enabled layers (non-overlay):', enabledLayers.length);

    // Generate SVG
    console.log('\n7. Generating SVG...');
    const svgResult = svgGenerator.generate(enabledLayers, null, { showNeatline: false, showDocBorder: false });

    console.log('8. SVG generation result:');
    console.log('   - Path count:', svgResult.stats.pathCount);
    console.log('   - Layer count:', svgResult.stats.layerCount);
    console.log('   - SVG length:', svgResult.svg.length, 'chars');

    // Check if SVG has content
    if (svgResult.stats.pathCount === 0) {
      console.log('\n!!! WARNING: No paths in generated SVG !!!');
      console.log('First 5 enabled layers:', enabledLayers.slice(0, 5));

      if (paths.length > 0) {
        const sample = paths[0];
        let color = null;
        if (sample.stroke && sample.strokeColor) {
          color = `rgb(${sample.strokeColor.join(',')})`;
        } else if (sample.fill && sample.fillColor) {
          color = `rgb(${sample.fillColor.join(',')})`;
        }
        console.log('Sample path layer:', sample.layer);
        console.log('Sample path color:', color);
        console.log('Expected sublayer:', `${sample.layer}::${color}`);
      }
    } else {
      console.log('\n SUCCESS! SVG generated with', svgResult.stats.pathCount, 'paths');

      // Save SVG for inspection
      const outPath = '/Users/mgilbert/gellyscape/test-backend-output.svg';
      await fs.writeFile(outPath, svgResult.svg);
      console.log('SVG saved to:', outPath);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
