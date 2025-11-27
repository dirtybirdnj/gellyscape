/**
 * Analyze geometry loss - Version 2
 * Handles 2024 format where content is in page content streams with inline BDC/EMC markers
 */

const fs = require('fs');
const { PDFDocument, PDFName, PDFArray, PDFStream } = require('pdf-lib');

const PDF_PATH = '/Users/mgilbert/Code/gellyscape/samples/VT_Charlotte_20240813_TM_geo.pdf';

// Parse content stream to count paths per OCG layer
function analyzeContentStream(content) {
  const layerStats = {};
  let currentLayer = 'none';
  let layerStack = [];

  // Track graphics state for path operations
  let pathOps = {
    moveTo: 0,
    lineTo: 0,
    curveTo: 0,
    rect: 0,
    stroke: 0,
    fill: 0,
    completedPaths: 0
  };

  // Split into tokens (simple tokenizer)
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // BDC - Begin marked content (layer start)
    if (trimmed.includes('BDC')) {
      const match = trimmed.match(/\/OC\s+\/(\w+)\s+BDC/);
      if (match) {
        layerStack.push(currentLayer);
        currentLayer = match[1];
        if (!layerStats[currentLayer]) {
          layerStats[currentLayer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
        }
      }
    }

    // EMC - End marked content (layer end)
    if (trimmed === 'EMC') {
      if (layerStack.length > 0) {
        currentLayer = layerStack.pop();
      } else {
        currentLayer = 'none';
      }
    }

    // Count moveTo operations (m)
    const mMatches = trimmed.match(/[\d.\-]+\s+[\d.\-]+\s+m\b/g);
    if (mMatches) {
      if (!layerStats[currentLayer]) {
        layerStats[currentLayer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
      }
      layerStats[currentLayer].moveTo += mMatches.length;
    }

    // Count lineTo operations (l)
    const lMatches = trimmed.match(/[\d.\-]+\s+[\d.\-]+\s+l\b/g);
    if (lMatches) {
      if (!layerStats[currentLayer]) {
        layerStats[currentLayer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
      }
      layerStats[currentLayer].lines += lMatches.length;
    }

    // Count stroke operations (S, s)
    if (trimmed === 'S' || trimmed === 's' || trimmed.endsWith(' S') || trimmed.endsWith(' s')) {
      if (!layerStats[currentLayer]) {
        layerStats[currentLayer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
      }
      layerStats[currentLayer].stroke++;
      layerStats[currentLayer].paths++;
    }

    // Count fill operations (f, F, b, B, f*, B*)
    if (/^[fFbB]\*?$/.test(trimmed) || / [fFbB]\*?$/.test(trimmed)) {
      if (!layerStats[currentLayer]) {
        layerStats[currentLayer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
      }
      layerStats[currentLayer].fill++;
      layerStats[currentLayer].paths++;
    }
  }

  return layerStats;
}

// Get stream content (decompress if needed)
function getStreamContent(stream) {
  try {
    const rawContent = stream.getContents();
    return rawContent.toString();
  } catch (e) {
    console.error('Error getting stream content:', e.message);
    return '';
  }
}

async function analyzeGeometry() {
  console.log('='.repeat(70));
  console.log('GEOMETRY LOSS ANALYSIS - V2 (Content Streams)');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;

  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get OCG layer names
  const catalog = pdfDoc.catalog;
  const ocProperties = catalog.dict.get(PDFName.of('OCProperties'));
  const ocgNames = {};

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
          // Try to get the internal reference name
          ocgNames[ocgRef.toString()] = nameStr;
        }
      }
    }
  }

  console.log('OCG Layer Names:', Object.values(ocgNames).join(', '));
  console.log('');

  // Get content streams
  const contents = pageDict.get(PDFName.of('Contents'));
  let allLayerStats = {};

  if (contents instanceof PDFArray) {
    console.log(`Page has ${contents.array.length} content streams`);
    console.log('');

    for (let i = 0; i < contents.array.length; i++) {
      const streamRef = contents.array[i];
      const stream = context.lookup(streamRef);

      if (stream instanceof PDFStream) {
        const content = getStreamContent(stream);
        console.log(`Content stream ${i + 1}: ${content.length} bytes`);

        const stats = analyzeContentStream(content);

        // Merge stats
        for (const [layer, layerStat] of Object.entries(stats)) {
          if (!allLayerStats[layer]) {
            allLayerStats[layer] = { moveTo: 0, stroke: 0, fill: 0, paths: 0, lines: 0 };
          }
          allLayerStats[layer].moveTo += layerStat.moveTo;
          allLayerStats[layer].stroke += layerStat.stroke;
          allLayerStats[layer].fill += layerStat.fill;
          allLayerStats[layer].paths += layerStat.paths;
          allLayerStats[layer].lines += layerStat.lines;
        }
      }
    }
  } else if (contents instanceof PDFStream) {
    const content = getStreamContent(contents);
    console.log(`Single content stream: ${content.length} bytes`);
    allLayerStats = analyzeContentStream(content);
  }

  console.log('');
  console.log('LAYER-BY-LAYER PATH COUNT (from PDF)');
  console.log('='.repeat(70));
  console.log('');
  console.log('Layer'.padEnd(35), 'moveTo', 'lines', 'stroke', 'fill', 'paths');
  console.log('-'.repeat(70));

  let totalMoveTo = 0;
  let totalPaths = 0;

  // Sort by paths count
  const sortedLayers = Object.entries(allLayerStats)
    .sort((a, b) => b[1].paths - a[1].paths);

  for (const [layer, stats] of sortedLayers) {
    console.log(
      layer.slice(0, 34).padEnd(35),
      String(stats.moveTo).padStart(6),
      String(stats.lines).padStart(6),
      String(stats.stroke).padStart(6),
      String(stats.fill).padStart(6),
      String(stats.paths).padStart(6)
    );
    totalMoveTo += stats.moveTo;
    totalPaths += stats.paths;
  }

  console.log('-'.repeat(70));
  console.log(
    'TOTAL'.padEnd(35),
    String(totalMoveTo).padStart(6),
    ''.padStart(6),
    ''.padStart(6),
    ''.padStart(6),
    String(totalPaths).padStart(6)
  );

  console.log('');
  console.log('COMPARISON WITH APP OUTPUT');
  console.log('='.repeat(70));
  console.log('');
  console.log('App extracted: 4,169 total paths');
  console.log(`PDF contains:  ${totalPaths} stroke/fill operations, ${totalMoveTo} moveTo ops`);
  console.log('');

  // Look at Contours specifically
  const contoursStats = allLayerStats['Mc3'] || allLayerStats['Contours'] || {};
  console.log('CONTOURS LAYER:');
  console.log(`  PDF: ${contoursStats.paths || 0} paths, ${contoursStats.moveTo || 0} moveTo`);
  console.log('  App: 116 + 5 + 611 + 74 = 806 paths');

  if ((contoursStats.paths || 0) > 806) {
    console.log(`  ⚠️  MISSING: ${(contoursStats.paths || 0) - 806} paths!`);
  }

  // Sample some content to understand structure
  console.log('');
  console.log('SAMPLE CONTENT FROM FIRST STREAM');
  console.log('='.repeat(70));

  if (contents instanceof PDFArray && contents.array.length > 0) {
    const firstStream = context.lookup(contents.array[0]);
    if (firstStream instanceof PDFStream) {
      const content = getStreamContent(firstStream);
      // Show first 2000 chars
      console.log(content.slice(0, 2000));
      console.log('...');
    }
  }
}

analyzeGeometry().catch(console.error);
