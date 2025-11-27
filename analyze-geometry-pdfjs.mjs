/**
 * Analyze geometry using pdf.js operator list
 * This gives us accurate path counts from the PDF
 */

import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = '/Users/mgilbert/Code/gellyscape/samples/VT_Charlotte_20240813_TM_geo.pdf';

// PDF.js operator names
const OPS = pdfjsLib.OPS;

async function analyzeWithPdfJs() {
  console.log('='.repeat(70));
  console.log('GEOMETRY ANALYSIS - Using pdf.js');
  console.log('='.repeat(70));
  console.log('');

  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  console.log(`PDF loaded: ${doc.numPages} page(s)`);

  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  console.log(`Total operators: ${opList.fnArray.length}`);
  console.log('');

  // Count operator types
  const opCounts = {};
  const opNames = {};

  // Build reverse mapping of OPS
  for (const [name, value] of Object.entries(OPS)) {
    opNames[value] = name;
  }

  for (const op of opList.fnArray) {
    const name = opNames[op] || `unknown_${op}`;
    opCounts[name] = (opCounts[name] || 0) + 1;
  }

  // Path-related operators
  const pathOps = [
    'moveTo', 'lineTo', 'curveTo', 'curveTo2', 'curveTo3',
    'closePath', 'rectangle', 'stroke', 'fill', 'eoFill',
    'fillStroke', 'eoFillStroke', 'endPath', 'clip', 'eoClip'
  ];

  // Layer/marked content operators
  const layerOps = ['beginMarkedContent', 'beginMarkedContentProps', 'endMarkedContent'];

  console.log('PATH OPERATORS (from pdf.js)');
  console.log('-'.repeat(50));
  for (const op of pathOps) {
    if (opCounts[op]) {
      console.log(`${op.padEnd(25)} ${opCounts[op]}`);
    }
  }

  console.log('');
  console.log('LAYER/MARKED CONTENT OPERATORS');
  console.log('-'.repeat(50));
  for (const op of layerOps) {
    if (opCounts[op]) {
      console.log(`${op.padEnd(25)} ${opCounts[op]}`);
    }
  }

  // Count actual paths (moveTo that lead to stroke/fill)
  console.log('');
  console.log('DETAILED PATH ANALYSIS');
  console.log('-'.repeat(50));

  let currentLayer = null;
  const layerPaths = {};
  let pathsInProgress = 0;
  let totalCompletedPaths = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const opName = opNames[op];

    // Track marked content (layers)
    if (opName === 'beginMarkedContentProps') {
      // args[0] is tag name, args[1] is properties dict
      if (args[0] === 'OC' && args[1]) {
        currentLayer = args[1].name || 'unnamed';
      }
    } else if (opName === 'endMarkedContent') {
      currentLayer = null;
    }

    // Count moveTo per layer
    if (opName === 'moveTo') {
      const layer = currentLayer || 'none';
      if (!layerPaths[layer]) {
        layerPaths[layer] = { moveTo: 0, stroke: 0, fill: 0, rect: 0 };
      }
      layerPaths[layer].moveTo++;
      pathsInProgress++;
    }

    // Count rectangles per layer
    if (opName === 'rectangle') {
      const layer = currentLayer || 'none';
      if (!layerPaths[layer]) {
        layerPaths[layer] = { moveTo: 0, stroke: 0, fill: 0, rect: 0 };
      }
      layerPaths[layer].rect++;
      pathsInProgress++;
    }

    // Count completed paths (stroke/fill)
    if (opName === 'stroke' || opName === 'fill' || opName === 'eoFill' ||
        opName === 'fillStroke' || opName === 'eoFillStroke') {
      const layer = currentLayer || 'none';
      if (!layerPaths[layer]) {
        layerPaths[layer] = { moveTo: 0, stroke: 0, fill: 0, rect: 0 };
      }
      if (opName === 'stroke') {
        layerPaths[layer].stroke++;
      } else {
        layerPaths[layer].fill++;
      }
      totalCompletedPaths++;
      pathsInProgress = 0;
    }
  }

  console.log('');
  console.log('PATHS BY LAYER');
  console.log('='.repeat(70));
  console.log('');
  console.log('Layer'.padEnd(35), 'moveTo', 'rect', 'stroke', 'fill');
  console.log('-'.repeat(70));

  let totalMoveTo = 0;
  let totalRect = 0;
  let totalStroke = 0;
  let totalFill = 0;

  // Sort by total paths
  const sortedLayers = Object.entries(layerPaths)
    .sort((a, b) => (b[1].moveTo + b[1].rect) - (a[1].moveTo + a[1].rect));

  for (const [layer, stats] of sortedLayers) {
    console.log(
      layer.slice(0, 34).padEnd(35),
      String(stats.moveTo).padStart(6),
      String(stats.rect).padStart(6),
      String(stats.stroke).padStart(6),
      String(stats.fill).padStart(6)
    );
    totalMoveTo += stats.moveTo;
    totalRect += stats.rect;
    totalStroke += stats.stroke;
    totalFill += stats.fill;
  }

  console.log('-'.repeat(70));
  console.log(
    'TOTAL'.padEnd(35),
    String(totalMoveTo).padStart(6),
    String(totalRect).padStart(6),
    String(totalStroke).padStart(6),
    String(totalFill).padStart(6)
  );

  console.log('');
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total moveTo in PDF: ${totalMoveTo}`);
  console.log(`Total rect in PDF: ${totalRect}`);
  console.log(`Total paths started: ${totalMoveTo + totalRect}`);
  console.log(`Total completed (stroke+fill): ${totalStroke + totalFill}`);
  console.log('');
  console.log('App extracted: 4,169 paths');
  console.log('');

  // Check Contours specifically
  const contoursLayer = layerPaths['Contours'];
  if (contoursLayer) {
    console.log('CONTOURS LAYER:');
    console.log(`  PDF: ${contoursLayer.moveTo} moveTo, ${contoursLayer.rect} rect, ${contoursLayer.stroke} stroke, ${contoursLayer.fill} fill`);
    console.log('  App: 806 paths (116 + 5 + 611 + 74)');

    const pdfContourPaths = contoursLayer.stroke + contoursLayer.fill;
    if (pdfContourPaths > 806) {
      console.log(`  ⚠️  MISSING: ${pdfContourPaths - 806} paths (${((pdfContourPaths - 806) / pdfContourPaths * 100).toFixed(1)}%)`);
    } else if (pdfContourPaths < 806) {
      console.log(`  ✓ App has MORE than PDF stroke/fill ops - paths may be split by subpaths`);
    }
  }

  // Sample some moveTo operations to understand scale
  console.log('');
  console.log('SAMPLE COORDINATES (first 10 moveTo)');
  console.log('-'.repeat(50));
  let moveToCount = 0;
  for (let i = 0; i < opList.fnArray.length && moveToCount < 10; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (opNames[op] === 'moveTo') {
      console.log(`moveTo(${args[0]?.toFixed(2)}, ${args[1]?.toFixed(2)})`);
      moveToCount++;
    }
  }
}

analyzeWithPdfJs().catch(console.error);
