/**
 * Analyze constructPath operations - this is where pdf.js bundles path operations
 */

import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = '/Users/mgilbert/Code/gellyscape/samples/VT_Charlotte_20240813_TM_geo.pdf';

// Build reverse mapping of OPS
const OPS = pdfjsLib.OPS;
const opNames = {};
for (const [name, value] of Object.entries(OPS)) {
  opNames[value] = name;
}

async function analyzeConstructPath() {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  console.log('='.repeat(70));
  console.log('CONSTRUCTPATH ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  // Track current layer from beginMarkedContentProps
  let currentLayerIds = [];
  let currentLayerName = 'none';

  // Layer stats
  const layerPathCounts = {};
  const layerOpCounts = {};

  // Path operation subtypes in constructPath
  // From pdf.js source: [moveTo, lineTo, curveTo, curveTo2, curveTo3, closePath, rectangle]
  const pathOpNames = ['moveTo', 'lineTo', 'curveTo', 'curveTo2', 'curveTo3', 'closePath', 'rectangle'];

  let totalPaths = 0;
  let totalMoveOps = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    // Track layer changes
    if (name === 'beginMarkedContentProps') {
      if (args[0] === 'OC' && args[1]) {
        // Extract layer IDs
        currentLayerIds = args[1].ids || [];
      }
    } else if (name === 'endMarkedContent') {
      // Pop layer
    }

    // Analyze constructPath
    if (name === 'constructPath') {
      const opsArray = args[0]; // Array of operation types
      const argsArray = args[1]; // Array of arguments
      const minMax = args[2]; // Bounding box

      totalPaths++;

      // Count operations in this path
      let pathMoveCount = 0;
      let pathLineCount = 0;
      for (const pathOp of opsArray) {
        if (pathOp === OPS.moveTo) pathMoveCount++;
        if (pathOp === OPS.lineTo) pathLineCount++;
      }

      totalMoveOps += pathMoveCount;

      // Track per layer
      const layerKey = currentLayerIds.join(',') || 'none';
      if (!layerPathCounts[layerKey]) {
        layerPathCounts[layerKey] = 0;
        layerOpCounts[layerKey] = { moveTo: 0, lineTo: 0, total: 0 };
      }
      layerPathCounts[layerKey]++;
      layerOpCounts[layerKey].moveTo += pathMoveCount;
      layerOpCounts[layerKey].lineTo += pathLineCount;
      layerOpCounts[layerKey].total += opsArray.length;
    }
  }

  console.log('SUMMARY');
  console.log('-'.repeat(50));
  console.log(`Total constructPath calls: ${totalPaths}`);
  console.log(`Total moveTo operations inside: ${totalMoveOps}`);
  console.log('');

  console.log('PATHS BY LAYER (by OCG reference IDs)');
  console.log('='.repeat(70));
  console.log('');
  console.log('Layer IDs'.padEnd(40), 'Paths', 'moveTo', 'lineTo');
  console.log('-'.repeat(70));

  // Sort by path count
  const sorted = Object.entries(layerPathCounts)
    .sort((a, b) => b[1] - a[1]);

  let displayedPaths = 0;
  for (const [layerKey, count] of sorted.slice(0, 30)) {
    const ops = layerOpCounts[layerKey];
    console.log(
      layerKey.slice(0, 39).padEnd(40),
      String(count).padStart(6),
      String(ops.moveTo).padStart(6),
      String(ops.lineTo).padStart(6)
    );
    displayedPaths += count;
  }

  console.log('-'.repeat(70));
  console.log(`Showing ${displayedPaths} of ${totalPaths} paths`);

  // Show sample constructPath with actual operations
  console.log('');
  console.log('SAMPLE CONSTRUCTPATH (first 5 with content)');
  console.log('='.repeat(70));

  let sampleCount = 0;
  for (let i = 0; i < opList.fnArray.length && sampleCount < 5; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    if (name === 'constructPath') {
      const opsArray = args[0];
      const argsArray = args[1];
      const minMax = args[2];

      if (opsArray.length > 0) {
        console.log(`\n[${sampleCount + 1}] Index ${i}:`);
        console.log(`  Operations (${opsArray.length}):`, opsArray.slice(0, 10).map(o => opNames[o]).join(', '), '...');
        console.log(`  Args (first 6):`, argsArray.slice(0, 6));
        console.log(`  MinMax:`, minMax);
        sampleCount++;
      }
    }
  }

  // What's the relationship between our extracted paths and constructPath?
  console.log('');
  console.log('COMPARISON WITH APP OUTPUT');
  console.log('='.repeat(70));
  console.log('');
  console.log(`PDF constructPath calls: ${totalPaths}`);
  console.log(`PDF total moveTo ops:    ${totalMoveOps}`);
  console.log(`App extracted paths:     4,169`);
  console.log('');

  if (totalPaths > 4169) {
    console.log(`⚠️  APP IS MISSING ${totalPaths - 4169} PATHS (${((totalPaths - 4169) / totalPaths * 100).toFixed(1)}%)`);
  }

  // Look at which layers contribute most
  console.log('');
  console.log('LAYER CONTRIBUTION (top 10 by path count)');
  console.log('-'.repeat(50));

  for (const [layerKey, count] of sorted.slice(0, 10)) {
    const pct = (count / totalPaths * 100).toFixed(1);
    console.log(`${layerKey.slice(0, 25).padEnd(26)} ${String(count).padStart(6)} paths (${pct}%)`);
  }
}

analyzeConstructPath().catch(console.error);
