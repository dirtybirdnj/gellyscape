/**
 * Analyze Jay Peak PDF to find missing contour data
 * Compare what pdf.js sees vs what the app extracts
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

async function analyzeJayPeak() {
  console.log('='.repeat(70));
  console.log('JAY PEAK PDF ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  console.log(`Pages: ${doc.numPages}`);

  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  console.log(`Total operators: ${opList.fnArray.length}`);
  console.log('');

  // Count all operator types
  const opCounts = {};
  for (const op of opList.fnArray) {
    const name = opNames[op] || `unknown_${op}`;
    opCounts[name] = (opCounts[name] || 0) + 1;
  }

  // Key operators
  console.log('KEY OPERATORS:');
  console.log('-'.repeat(40));
  const keyOps = ['constructPath', 'stroke', 'fill', 'eoFill', 'fillStroke', 'endPath',
                  'beginMarkedContentProps', 'endMarkedContent', 'paintXObject'];
  for (const op of keyOps) {
    if (opCounts[op]) {
      console.log(`${op.padEnd(30)} ${opCounts[op]}`);
    }
  }
  console.log('');

  // Track layers and their visible paths
  const layerStats = {};
  let currentLayerIds = [];
  let totalVisible = 0;
  let totalEndPath = 0;

  // Track constructPath terminating operations
  const terminatingOps = {};

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    // Track layer changes
    if (name === 'beginMarkedContentProps') {
      if (args[0] === 'OC' && args[1]) {
        currentLayerIds = args[1].ids || [];
      }
    } else if (name === 'endMarkedContent') {
      // Keep tracking until we find a new layer
    }

    // Analyze constructPath
    if (name === 'constructPath') {
      const terminatingOp = args[0]; // First arg is the terminating operation code
      const opName = opNames[terminatingOp] || `op_${terminatingOp}`;
      terminatingOps[opName] = (terminatingOps[opName] || 0) + 1;

      const layerKey = currentLayerIds.join(',') || 'none';
      if (!layerStats[layerKey]) {
        layerStats[layerKey] = { visible: 0, endPath: 0, total: 0 };
      }
      layerStats[layerKey].total++;

      // Check if this is a visible path or clipping path
      if (terminatingOp === OPS.stroke || terminatingOp === OPS.fill ||
          terminatingOp === OPS.eoFill || terminatingOp === OPS.fillStroke ||
          terminatingOp === OPS.eoFillStroke) {
        layerStats[layerKey].visible++;
        totalVisible++;
      } else if (terminatingOp === OPS.endPath) {
        layerStats[layerKey].endPath++;
        totalEndPath++;
      }
    }
  }

  console.log('CONSTRUCTPATH TERMINATING OPERATIONS:');
  console.log('-'.repeat(40));
  for (const [op, count] of Object.entries(terminatingOps).sort((a, b) => b[1] - a[1])) {
    console.log(`${op.padEnd(20)} ${count}`);
  }
  console.log('');

  console.log('LAYER BREAKDOWN (by OCG ID):');
  console.log('='.repeat(70));
  console.log('OCG ID'.padEnd(20), 'Visible'.padStart(10), 'EndPath'.padStart(10), 'Total'.padStart(10));
  console.log('-'.repeat(70));

  const sortedLayers = Object.entries(layerStats)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [layer, stats] of sortedLayers.slice(0, 20)) {
    console.log(
      layer.slice(0, 19).padEnd(20),
      String(stats.visible).padStart(10),
      String(stats.endPath).padStart(10),
      String(stats.total).padStart(10)
    );
  }

  console.log('-'.repeat(70));
  console.log(
    'TOTAL'.padEnd(20),
    String(totalVisible).padStart(10),
    String(totalEndPath).padStart(10),
    String(totalVisible + totalEndPath).padStart(10)
  );

  console.log('');
  console.log('COMPARISON:');
  console.log('='.repeat(70));
  console.log(`PDF visible paths (stroke/fill):  ${totalVisible}`);
  console.log(`PDF clipping paths (endPath):     ${totalEndPath}`);
  console.log(`App extracted (from screenshot):  4,290 paths`);
  console.log('');

  if (totalVisible > 4290) {
    console.log(`⚠️  MISSING ${totalVisible - 4290} VISIBLE PATHS (${((totalVisible - 4290) / totalVisible * 100).toFixed(1)}%)`);
  } else if (totalVisible < 4290) {
    console.log(`App extracted MORE than PDF visible paths - check for subpath splitting`);
  } else {
    console.log(`✓ Extraction matches PDF visible paths`);
  }

  // Look for specific layer patterns - find Contours
  console.log('');
  console.log('CONTOURS LAYER ANALYSIS:');
  console.log('-'.repeat(40));

  // The app shows 4 Contours layers: 3, 1, 438, 412 paths = 854 total
  const appContoursTotal = 3 + 1 + 438 + 412;
  console.log(`App Contours total: ${appContoursTotal} paths`);

  // Sum up layers that might be contours (looking at the PDF)
  let pdfContoursVisible = 0;
  for (const [layer, stats] of Object.entries(layerStats)) {
    // We need to figure out which OCG IDs map to Contours
    pdfContoursVisible += stats.visible;
  }

  // Let's look at OCG layer names
  console.log('');
  console.log('OCG LAYER NAME MAPPING:');
  console.log('-'.repeat(40));

  // Get OCG info from the document
  const catalog = await doc._pdfInfo;
  console.log('Document info:', JSON.stringify(catalog, null, 2).slice(0, 500));

  // Look at beginMarkedContentProps to understand layer structure
  console.log('');
  console.log('SAMPLE LAYER MARKERS (first 20):');
  console.log('-'.repeat(40));

  let markerCount = 0;
  const seenLayers = new Set();
  for (let i = 0; i < opList.fnArray.length && markerCount < 50; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    if (name === 'beginMarkedContentProps' && args[0] === 'OC') {
      const ids = args[1]?.ids || [];
      const idsStr = ids.join(',');
      if (!seenLayers.has(idsStr)) {
        seenLayers.add(idsStr);
        console.log(`Layer IDs: [${idsStr}]`);
        markerCount++;
      }
    }
  }
}

analyzeJayPeak().catch(console.error);
