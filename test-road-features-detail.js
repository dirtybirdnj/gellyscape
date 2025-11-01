#!/usr/bin/env node

/**
 * Detailed analysis of Road Features layer
 * Check what types of paths are in this layer and their properties
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

async function analyzeRoadFeatures() {
  const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';

  console.log('='.repeat(80));
  console.log('ROAD FEATURES LAYER DETAILED ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nPDF: ${pdfPath}\n`);

  const buffer = fs.readFileSync(pdfPath);
  const processor = new PDFProcessor(buffer);

  const result = await processor.process();

  if (!result.contentPaths || !result.contentPaths.paths) {
    console.log('❌ No paths found');
    return;
  }

  // Filter for Road Features layer
  const roadPaths = result.contentPaths.paths.filter(p => p.layer === 'Road Features');

  console.log(`\n--- Road Features Layer Stats ---`);
  console.log(`Total paths: ${roadPaths.length}`);

  if (roadPaths.length === 0) {
    console.log('❌ No paths found in Road Features layer');
    return;
  }

  // Analyze stroke colors
  const strokeColors = {};
  const fillColors = {};
  const strokeWidths = {};

  roadPaths.forEach(path => {
    // Stroke colors
    const strokeKey = path.strokeColor || 'none';
    strokeColors[strokeKey] = (strokeColors[strokeKey] || 0) + 1;

    // Fill colors
    const fillKey = path.fillColor || 'none';
    fillColors[fillKey] = (fillColors[fillKey] || 0) + 1;

    // Stroke widths
    const widthKey = path.lineWidth !== undefined ? path.lineWidth.toString() : 'undefined';
    strokeWidths[widthKey] = (strokeWidths[widthKey] || 0) + 1;
  });

  console.log(`\n--- Stroke Colors Distribution ---`);
  Object.keys(strokeColors).sort((a, b) => strokeColors[b] - strokeColors[a]).forEach(color => {
    console.log(`  ${color}: ${strokeColors[color]} paths`);
  });

  console.log(`\n--- Fill Colors Distribution ---`);
  Object.keys(fillColors).sort((a, b) => fillColors[b] - fillColors[a]).forEach(color => {
    console.log(`  ${color}: ${fillColors[color]} paths`);
  });

  console.log(`\n--- Stroke Widths Distribution ---`);
  Object.keys(strokeWidths).sort((a, b) => strokeWidths[b] - strokeWidths[a]).forEach(width => {
    console.log(`  ${width}: ${strokeWidths[width]} paths`);
  });

  // Sample a few paths
  console.log(`\n--- Sample Paths (first 10) ---`);
  roadPaths.slice(0, 10).forEach((path, idx) => {
    console.log(`\n  Path ${idx + 1}:`);
    console.log(`    Layer: ${path.layer}`);
    console.log(`    Stroke: ${path.strokeColor || 'none'}`);
    console.log(`    Fill: ${path.fillColor || 'none'}`);
    console.log(`    Line Width: ${path.lineWidth !== undefined ? path.lineWidth : 'undefined'}`);
    console.log(`    Operations: ${path.operations ? path.operations.length : 0}`);
    if (path.operations && path.operations.length > 0) {
      console.log(`    First op: ${path.operations[0].op}`);
      if (path.operations[0].args) {
        console.log(`    First args: [${path.operations[0].args.slice(0, 4).join(', ')}${path.operations[0].args.length > 4 ? '...' : ''}]`);
      }
    }
  });

  // Check for text in Road Features or related layers
  console.log(`\n--- Text Objects in Road-related Layers ---`);
  if (result.contentPaths.textObjectsByLayer) {
    const roadTextLayers = Object.keys(result.contentPaths.textObjectsByLayer).filter(layer =>
      layer.toLowerCase().includes('road') ||
      layer.toLowerCase().includes('highway') ||
      layer.toLowerCase().includes('street')
    );

    roadTextLayers.forEach(layer => {
      const textObjs = result.contentPaths.textObjectsByLayer[layer];
      console.log(`\n  ${layer}: ${textObjs.length} text objects`);

      // Sample some text
      const sampleTexts = textObjs.slice(0, 20).map(t => t.text).filter(t => t && t.trim());
      if (sampleTexts.length > 0) {
        console.log(`  Sample text: "${sampleTexts.slice(0, 10).join('", "')}"`);
      }
    });
  }

  console.log('\n' + '='.repeat(80));
}

analyzeRoadFeatures().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
