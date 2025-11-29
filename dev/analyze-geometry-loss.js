/**
 * Analyze geometry loss between PDF source and extracted paths
 * This script compares what's in the PDF vs what we're extracting
 */

const fs = require('fs');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFStream } = require('pdf-lib');
const pako = require('pako');

const PDF_PATH = '/Users/mgilbert/Code/gellyscape/samples/VT_Charlotte_20240813_TM_geo.pdf';

// Count path operations in a content stream
function countPathOperations(content) {
  const ops = {
    moveTo: 0,      // m
    lineTo: 0,      // l
    curveTo: 0,     // c, v, y
    closePath: 0,   // h
    rect: 0,        // re
    stroke: 0,      // S, s
    fill: 0,        // f, F, f*, B, B*, b, b*
    clip: 0,        // W, W*
    endPath: 0,     // n
  };

  // Simple regex-based counting
  const mMatches = content.match(/\bm\b/g);
  const lMatches = content.match(/\bl\b/g);
  const cMatches = content.match(/\b[cvy]\b/g);
  const hMatches = content.match(/\bh\b/g);
  const reMatches = content.match(/\bre\b/g);
  const strokeMatches = content.match(/\b[Ss]\b/g);
  const fillMatches = content.match(/\b[fFbB]\*?\b/g);
  const clipMatches = content.match(/\bW\*?\b/g);
  const nMatches = content.match(/\bn\b/g);

  ops.moveTo = mMatches ? mMatches.length : 0;
  ops.lineTo = lMatches ? lMatches.length : 0;
  ops.curveTo = cMatches ? cMatches.length : 0;
  ops.closePath = hMatches ? hMatches.length : 0;
  ops.rect = reMatches ? reMatches.length : 0;
  ops.stroke = strokeMatches ? strokeMatches.length : 0;
  ops.fill = fillMatches ? fillMatches.length : 0;
  ops.clip = clipMatches ? clipMatches.length : 0;
  ops.endPath = nMatches ? nMatches.length : 0;

  return ops;
}

// Get stream content (decompress if needed)
function getStreamContent(stream, context) {
  try {
    const rawContent = stream.getContents();
    return rawContent.toString();
  } catch (e) {
    return '';
  }
}

async function analyzeGeometry() {
  console.log('='.repeat(70));
  console.log('GEOMETRY LOSS ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;

  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get all XObjects
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjects = resources?.get(PDFName.of('XObject'));

  console.log('1. PDF STRUCTURE OVERVIEW');
  console.log('-'.repeat(40));

  // Count XObjects and their types
  let formXObjects = [];
  let imageXObjects = 0;

  if (xobjects?.dict) {
    for (const [key, ref] of Object.entries(xobjects.dict)) {
      const xobj = context.lookup(ref);
      if (xobj instanceof PDFStream) {
        const subtype = xobj.dict.get(PDFName.of('Subtype'));
        const subtypeStr = subtype?.toString();
        if (subtypeStr === '/Form') {
          formXObjects.push({ name: key, ref, stream: xobj });
        } else if (subtypeStr === '/Image') {
          imageXObjects++;
        }
      }
    }
  }

  console.log(`Form XObjects (contain vector data): ${formXObjects.length}`);
  console.log(`Image XObjects: ${imageXObjects}`);

  // Get OCG layer info
  const catalog = pdfDoc.catalog;
  const ocProperties = catalog.dict.get(PDFName.of('OCProperties'));
  let ocgLayers = [];

  if (ocProperties) {
    const ocgs = ocProperties.get(PDFName.of('OCGs'));
    if (ocgs?.array) {
      for (const ocgRef of ocgs.array) {
        const ocg = context.lookup(ocgRef);
        if (ocg?.dict) {
          const name = ocg.dict.get(PDFName.of('Name'));
          let nameStr = name?.value || name?.toString() || 'unnamed';
          if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
            nameStr = nameStr.slice(1, -1);
          }
          ocgLayers.push({ name: nameStr, ref: ocgRef });
        }
      }
    }
  }

  console.log(`OCG Layers: ${ocgLayers.length}`);
  console.log('');

  // Analyze each Form XObject
  console.log('2. FORM XOBJECT ANALYSIS');
  console.log('-'.repeat(40));

  let totalPathOps = {
    moveTo: 0, lineTo: 0, curveTo: 0, closePath: 0,
    rect: 0, stroke: 0, fill: 0, clip: 0, endPath: 0
  };

  let xobjectDetails = [];

  for (const formXObj of formXObjects) {
    const content = getStreamContent(formXObj.stream, context);
    const ops = countPathOperations(content);

    // Check for nested XObject calls (Do operator)
    const doMatches = content.match(/\/(\w+)\s+Do\b/g);
    const nestedCalls = doMatches ? doMatches.length : 0;

    // Check which OCG this XObject belongs to
    const ocgRef = formXObj.stream.dict.get(PDFName.of('OC'));
    let ocgName = 'none';
    if (ocgRef) {
      const ocg = context.lookup(ocgRef);
      if (ocg?.dict) {
        const name = ocg.dict.get(PDFName.of('Name'));
        ocgName = name?.value || name?.toString() || 'unnamed';
        if (ocgName.startsWith('(') && ocgName.endsWith(')')) {
          ocgName = ocgName.slice(1, -1);
        }
      }
    }

    xobjectDetails.push({
      name: formXObj.name,
      ocg: ocgName,
      moveTo: ops.moveTo,
      stroke: ops.stroke,
      fill: ops.fill,
      nestedCalls,
      contentLength: content.length
    });

    // Accumulate totals
    for (const key of Object.keys(totalPathOps)) {
      totalPathOps[key] += ops[key];
    }
  }

  // Sort by moveTo count (most paths first)
  xobjectDetails.sort((a, b) => b.moveTo - a.moveTo);

  console.log('Top 20 Form XObjects by path count:');
  console.log('');
  console.log('Name'.padEnd(15), 'OCG Layer'.padEnd(25), 'moveTo', 'stroke', 'fill', 'nested', 'size');
  console.log('-'.repeat(90));

  for (const detail of xobjectDetails.slice(0, 20)) {
    console.log(
      detail.name.padEnd(15),
      detail.ocg.slice(0, 24).padEnd(25),
      String(detail.moveTo).padStart(6),
      String(detail.stroke).padStart(6),
      String(detail.fill).padStart(6),
      String(detail.nestedCalls).padStart(6),
      String(detail.contentLength).padStart(8)
    );
  }

  console.log('');
  console.log('3. LAYER-BY-LAYER GEOMETRY COUNT');
  console.log('-'.repeat(40));

  // Group XObjects by OCG layer
  const layerStats = {};
  for (const detail of xobjectDetails) {
    if (!layerStats[detail.ocg]) {
      layerStats[detail.ocg] = { xobjects: 0, moveTo: 0, stroke: 0, fill: 0 };
    }
    layerStats[detail.ocg].xobjects++;
    layerStats[detail.ocg].moveTo += detail.moveTo;
    layerStats[detail.ocg].stroke += detail.stroke;
    layerStats[detail.ocg].fill += detail.fill;
  }

  // Sort by moveTo count
  const sortedLayers = Object.entries(layerStats)
    .sort((a, b) => b[1].moveTo - a[1].moveTo);

  console.log('');
  console.log('Layer'.padEnd(30), 'XObjs', 'moveTo', 'stroke', 'fill');
  console.log('-'.repeat(70));

  let totalMoveToInPDF = 0;
  for (const [layer, stats] of sortedLayers) {
    console.log(
      layer.slice(0, 29).padEnd(30),
      String(stats.xobjects).padStart(5),
      String(stats.moveTo).padStart(7),
      String(stats.stroke).padStart(7),
      String(stats.fill).padStart(7)
    );
    totalMoveToInPDF += stats.moveTo;
  }

  console.log('-'.repeat(70));
  console.log('TOTAL'.padEnd(30), '', String(totalMoveToInPDF).padStart(7));

  console.log('');
  console.log('4. CONTOURS LAYER DEEP DIVE');
  console.log('-'.repeat(40));

  // Find all XObjects belonging to Contours layer
  const contoursXObjs = xobjectDetails.filter(d => d.ocg.includes('Contour'));
  console.log(`XObjects in Contours layer: ${contoursXObjs.length}`);

  let contoursMoveToTotal = 0;
  for (const detail of contoursXObjs) {
    contoursMoveToTotal += detail.moveTo;
    if (detail.moveTo > 0) {
      console.log(`  ${detail.name}: ${detail.moveTo} paths, ${detail.stroke} strokes, ${detail.fill} fills`);
    }
  }
  console.log(`Total moveTo in Contours: ${contoursMoveToTotal}`);

  console.log('');
  console.log('5. COMPARISON WITH EXTRACTED DATA');
  console.log('-'.repeat(40));
  console.log('');
  console.log('From app output, we extracted:');
  console.log('  Total paths: 4,169');
  console.log('  Contours layers: 116 + 5 + 611 + 74 = 806 paths');
  console.log('');
  console.log('From PDF analysis:');
  console.log(`  Total moveTo ops: ${totalMoveToInPDF}`);
  console.log(`  Contours moveTo: ${contoursMoveToTotal}`);
  console.log('');

  if (contoursMoveToTotal > 806) {
    console.log(`⚠️  GEOMETRY LOSS DETECTED in Contours layer!`);
    console.log(`   Missing: ${contoursMoveToTotal - 806} paths (${((contoursMoveToTotal - 806) / contoursMoveToTotal * 100).toFixed(1)}%)`);
  }

  if (totalMoveToInPDF > 4169) {
    console.log(`⚠️  OVERALL GEOMETRY LOSS!`);
    console.log(`   Missing: ${totalMoveToInPDF - 4169} paths (${((totalMoveToInPDF - 4169) / totalMoveToInPDF * 100).toFixed(1)}%)`);
  }

  console.log('');
  console.log('6. NESTED XOBJECT ANALYSIS');
  console.log('-'.repeat(40));

  // Check for XObjects that call other XObjects (nesting)
  const nestedXObjs = xobjectDetails.filter(d => d.nestedCalls > 0);
  console.log(`XObjects with nested Do calls: ${nestedXObjs.length}`);

  for (const detail of nestedXObjs.slice(0, 10)) {
    console.log(`  ${detail.name}: ${detail.nestedCalls} nested calls, OCG: ${detail.ocg}`);
  }

  // Check main page content stream
  console.log('');
  console.log('7. MAIN PAGE CONTENT');
  console.log('-'.repeat(40));

  const contents = pageDict.get(PDFName.of('Contents'));
  if (contents instanceof PDFStream) {
    const mainContent = getStreamContent(contents, context);
    const doMatches = mainContent.match(/\/(\w+)\s+Do\b/g);
    console.log(`Main page Do calls: ${doMatches ? doMatches.length : 0}`);

    // List unique XObjects called from main page
    if (doMatches) {
      const calledXObjs = new Set(doMatches.map(m => m.match(/\/(\w+)/)[1]));
      console.log(`Unique XObjects called: ${calledXObjs.size}`);
      console.log(`First 10: ${[...calledXObjs].slice(0, 10).join(', ')}`);
    }
  } else if (contents instanceof PDFArray) {
    console.log(`Main page has ${contents.array?.length || 0} content streams`);
  }
}

analyzeGeometry().catch(console.error);
