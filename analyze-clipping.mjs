/**
 * Analyze clipping operations in Jay Peak PDF
 * Check what comes after W/W* operators
 */

import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

// Build reverse mapping of OPS
const OPS = pdfjsLib.OPS;
const opNames = {};
for (const [name, value] of Object.entries(OPS)) {
  opNames[value] = name;
}

async function analyzeClipping() {
  console.log('='.repeat(70));
  console.log('CLIPPING OPERATION ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  // Track sequences: what comes after clip operations?
  const clipSequences = {};
  let clipCount = 0;

  // Track path construction -> terminating operation sequences
  const pathTerminationStats = {
    'stroke': 0,
    'fill': 0,
    'eoFill': 0,
    'fillStroke': 0,
    'eoFillStroke': 0,
    'endPath': 0,
    'clip_then_stroke': 0,
    'clip_then_fill': 0,
    'clip_then_endPath': 0,
    'other': 0
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const name = opNames[op];

    // Look at constructPath operations and their terminating op
    if (name === 'constructPath') {
      const terminatingOp = opList.argsArray[i][0];
      const termName = opNames[terminatingOp] || `op_${terminatingOp}`;

      if (pathTerminationStats[termName] !== undefined) {
        pathTerminationStats[termName]++;
      } else {
        pathTerminationStats['other']++;
      }
    }

    // Track clip operations specifically
    if (name === 'clip' || name === 'eoClip') {
      clipCount++;

      // Look at next few operations
      const nextOps = [];
      for (let j = i + 1; j < Math.min(i + 5, opList.fnArray.length); j++) {
        nextOps.push(opNames[opList.fnArray[j]]);
      }
      const key = nextOps.slice(0, 3).join(' -> ');
      clipSequences[key] = (clipSequences[key] || 0) + 1;
    }
  }

  console.log('PATH TERMINATION OPERATIONS:');
  console.log('-'.repeat(40));
  for (const [op, count] of Object.entries(pathTerminationStats).sort((a, b) => b[1] - a[1])) {
    if (count > 0) {
      console.log(`${op.padEnd(25)} ${count}`);
    }
  }

  console.log('');
  console.log('CLIP OPERATION SEQUENCES:');
  console.log('-'.repeat(40));
  console.log(`Total clip operations: ${clipCount}`);
  console.log('');
  console.log('What comes after clip:');
  for (const [seq, count] of Object.entries(clipSequences).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${seq}: ${count}`);
  }

  // Now let's look at where paths are being lost
  // Compare Layer-by-layer: pdf.js constructPath vs our parser
  console.log('');
  console.log('='.repeat(70));
  console.log('LAYER ANALYSIS - WHERE ARE PATHS BEING LOST?');
  console.log('='.repeat(70));

  // Check if the issue is with specific layer IDs
  const layerPathStats = {};
  let currentLayerIds = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    if (name === 'beginMarkedContentProps') {
      if (args[0] === 'OC' && args[1]) {
        currentLayerIds = args[1].ids || [];
      }
    }

    if (name === 'constructPath') {
      const terminatingOp = args[0];
      const layerKey = currentLayerIds.join(',') || 'none';

      if (!layerPathStats[layerKey]) {
        layerPathStats[layerKey] = {
          stroke: 0, fill: 0, eoFill: 0, fillStroke: 0, eoFillStroke: 0, endPath: 0
        };
      }

      const termName = opNames[terminatingOp];
      if (layerPathStats[layerKey][termName] !== undefined) {
        layerPathStats[layerKey][termName]++;
      }
    }
  }

  console.log('');
  console.log('VISIBLE vs ENDPATH by Layer:');
  console.log('-'.repeat(70));
  console.log('Layer'.padEnd(25), 'Stroke'.padStart(8), 'Fill'.padStart(8), 'eoFill'.padStart(8), 'endPath'.padStart(10), 'VISIBLE'.padStart(10));
  console.log('-'.repeat(70));

  let totalVisible = 0;
  let totalEndPath = 0;

  for (const [layer, stats] of Object.entries(layerPathStats).sort((a, b) => {
    const aVisible = a[1].stroke + a[1].fill + a[1].eoFill + a[1].fillStroke + a[1].eoFillStroke;
    const bVisible = b[1].stroke + b[1].fill + b[1].eoFill + b[1].fillStroke + b[1].eoFillStroke;
    return bVisible - aVisible;
  }).slice(0, 15)) {
    const visible = stats.stroke + stats.fill + stats.eoFill + stats.fillStroke + stats.eoFillStroke;
    totalVisible += visible;
    totalEndPath += stats.endPath;
    console.log(
      layer.slice(0, 24).padEnd(25),
      String(stats.stroke).padStart(8),
      String(stats.fill).padStart(8),
      String(stats.eoFill).padStart(8),
      String(stats.endPath).padStart(10),
      String(visible).padStart(10)
    );
  }

  console.log('-'.repeat(70));
  console.log('TOTAL'.padEnd(25), '', '', '', String(totalEndPath).padStart(10), String(totalVisible).padStart(10));

  // App shows: Total 6,298 paths in Coordinate System
  // App shows: Trails 2,252 + 137 + 26 + 36 = 2,451
  // App shows: Contours 3 + 1 + 438 + 412 = 854
  console.log('');
  console.log('APP COMPARISON:');
  console.log('-'.repeat(40));
  console.log('App total paths: 4,290');
  console.log(`PDF visible paths: ${totalVisible}`);
  console.log(`Difference: ${totalVisible - 4290} missing`);
}

analyzeClipping().catch(console.error);
