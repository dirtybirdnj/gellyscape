/**
 * Deep analysis of Jay Peak PDF to understand color assignment
 * Why are some paths showing as black when they should have colors?
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeColors() {
  console.log('='.repeat(70));
  console.log('JAY PEAK COLOR ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get content streams
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = contents?.array || [contents];
  const resources = pageDict.get(PDFName.of('Resources'));

  // Decompress and get raw content
  const streamRef = contentStreams[0];
  const stream = context.lookup(streamRef);
  let rawData = stream.getContents();
  const filter = stream.dict?.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') {
    rawData = zlib.inflateSync(Buffer.from(rawData));
  }
  const content = rawData.toString('latin1');

  // Parse the content stream manually to understand color patterns
  console.log('Content stream length:', content.length, 'bytes');
  console.log('');

  // Find all color-setting operators
  const colorOps = {
    'g': [],    // Gray fill
    'G': [],    // Gray stroke
    'rg': [],   // RGB fill
    'RG': [],   // RGB stroke
    'k': [],    // CMYK fill
    'K': [],    // CMYK stroke
    'cs': [],   // Color space (fill)
    'CS': [],   // Color space (stroke)
    'sc': [],   // Set color (fill)
    'SC': [],   // Set color (stroke)
    'scn': [],  // Set color (fill, pattern/separation)
    'SCN': [],  // Set color (stroke, pattern/separation)
  };

  // Find BDC/EMC blocks and what colors are set inside vs outside
  const lines = content.split('\n');
  let inLayer = null;
  let currentStrokeColor = null;
  let currentFillColor = null;
  let pathsInLayer = 0;
  let pathsOutsideLayer = 0;
  let colorChangesInLayer = 0;
  let colorChangesOutsideLayer = 0;

  const layerColorStats = {};
  const outsideLayerColors = { stroke: {}, fill: {} };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Track layer entry/exit
    if (line.includes('BDC')) {
      const match = line.match(/\/(\w+)\s+BDC/);
      if (match) {
        inLayer = match[1];
        if (!layerColorStats[inLayer]) {
          layerColorStats[inLayer] = { paths: 0, strokeColors: {}, fillColors: {} };
        }
      }
    } else if (line === 'EMC') {
      inLayer = null;
    }

    // Track color changes
    const rgMatch = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
    const rgStrokeMatch = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
    const grayMatch = line.match(/^([\d.]+)\s+g$/);
    const grayStrokeMatch = line.match(/^([\d.]+)\s+G$/);

    if (rgMatch) {
      currentFillColor = `rgb(${Math.round(rgMatch[1]*255)},${Math.round(rgMatch[2]*255)},${Math.round(rgMatch[3]*255)})`;
      if (inLayer) {
        colorChangesInLayer++;
      } else {
        colorChangesOutsideLayer++;
      }
    }
    if (rgStrokeMatch) {
      currentStrokeColor = `rgb(${Math.round(rgStrokeMatch[1]*255)},${Math.round(rgStrokeMatch[2]*255)},${Math.round(rgStrokeMatch[3]*255)})`;
      if (inLayer) {
        colorChangesInLayer++;
      } else {
        colorChangesOutsideLayer++;
      }
    }
    if (grayMatch) {
      const g = Math.round(parseFloat(grayMatch[1]) * 255);
      currentFillColor = `rgb(${g},${g},${g})`;
      if (inLayer) {
        colorChangesInLayer++;
      } else {
        colorChangesOutsideLayer++;
      }
    }
    if (grayStrokeMatch) {
      const g = Math.round(parseFloat(grayStrokeMatch[1]) * 255);
      currentStrokeColor = `rgb(${g},${g},${g})`;
      if (inLayer) {
        colorChangesInLayer++;
      } else {
        colorChangesOutsideLayer++;
      }
    }

    // Track path operations (stroke/fill)
    if (line === 'S' || line === 's') {  // Stroke
      if (inLayer) {
        pathsInLayer++;
        if (currentStrokeColor) {
          layerColorStats[inLayer].strokeColors[currentStrokeColor] =
            (layerColorStats[inLayer].strokeColors[currentStrokeColor] || 0) + 1;
          layerColorStats[inLayer].paths++;
        }
      } else {
        pathsOutsideLayer++;
        if (currentStrokeColor) {
          outsideLayerColors.stroke[currentStrokeColor] =
            (outsideLayerColors.stroke[currentStrokeColor] || 0) + 1;
        }
      }
    }
    if (line === 'f' || line === 'F' || line === 'f*') {  // Fill
      if (inLayer) {
        pathsInLayer++;
        if (currentFillColor) {
          layerColorStats[inLayer].fillColors[currentFillColor] =
            (layerColorStats[inLayer].fillColors[currentFillColor] || 0) + 1;
          layerColorStats[inLayer].paths++;
        }
      } else {
        pathsOutsideLayer++;
        if (currentFillColor) {
          outsideLayerColors.fill[currentFillColor] =
            (outsideLayerColors.fill[currentFillColor] || 0) + 1;
        }
      }
    }
    if (line === 'B' || line === 'B*' || line === 'b' || line === 'b*') {  // Fill and stroke
      if (inLayer) {
        pathsInLayer++;
        layerColorStats[inLayer].paths++;
      } else {
        pathsOutsideLayer++;
      }
    }
  }

  console.log('=== PATH LOCATION SUMMARY ===');
  console.log(`Paths INSIDE BDC/EMC layers: ${pathsInLayer}`);
  console.log(`Paths OUTSIDE BDC/EMC layers: ${pathsOutsideLayer}`);
  console.log(`Color changes inside layers: ${colorChangesInLayer}`);
  console.log(`Color changes outside layers: ${colorChangesOutsideLayer}`);
  console.log('');

  console.log('=== LAYER COLOR BREAKDOWN ===');
  const sortedLayers = Object.entries(layerColorStats).sort((a, b) => b[1].paths - a[1].paths);
  for (const [layer, stats] of sortedLayers.slice(0, 15)) {
    console.log(`\n${layer}: ${stats.paths} paths`);
    if (Object.keys(stats.strokeColors).length > 0) {
      console.log('  Stroke colors:', Object.entries(stats.strokeColors).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(', '));
    }
    if (Object.keys(stats.fillColors).length > 0) {
      console.log('  Fill colors:', Object.entries(stats.fillColors).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(', '));
    }
  }

  console.log('');
  console.log('=== COLORS USED OUTSIDE LAYERS ===');
  console.log('Stroke colors outside layers:');
  const strokeOutside = Object.entries(outsideLayerColors.stroke).sort((a, b) => b[1] - a[1]);
  for (const [color, count] of strokeOutside.slice(0, 10)) {
    console.log(`  ${color}: ${count} paths`);
  }
  console.log('Fill colors outside layers:');
  const fillOutside = Object.entries(outsideLayerColors.fill).sort((a, b) => b[1] - a[1]);
  for (const [color, count] of fillOutside.slice(0, 10)) {
    console.log(`  ${color}: ${count} paths`);
  }

  // Now let's look at the SEQUENCE - what happens right before/after BDC blocks
  console.log('');
  console.log('=== SEQUENCE ANALYSIS ===');
  console.log('Looking at what colors are active when paths are drawn outside layers...');

  // Find specific examples of paths outside layers
  let examples = [];
  let lastColorSet = null;
  let lastLayerExited = null;
  inLayer = null;

  for (let i = 0; i < lines.length && examples.length < 5; i++) {
    const line = lines[i].trim();

    if (line.includes('BDC')) {
      const match = line.match(/\/(\w+)\s+BDC/);
      if (match) inLayer = match[1];
    } else if (line === 'EMC') {
      lastLayerExited = inLayer;
      inLayer = null;
    }

    // Track color
    const rgStrokeMatch = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
    const grayStrokeMatch = line.match(/^([\d.]+)\s+G$/);
    if (rgStrokeMatch || grayStrokeMatch) {
      lastColorSet = line;
    }

    // Found a path outside a layer
    if (!inLayer && (line === 'S' || line === 's')) {
      examples.push({
        lineNum: i,
        lastLayer: lastLayerExited,
        lastColor: lastColorSet,
        context: lines.slice(Math.max(0, i-10), i+1).join('\n')
      });
    }
  }

  console.log('');
  console.log('Examples of paths drawn OUTSIDE layers:');
  for (const ex of examples) {
    console.log(`\nLine ${ex.lineNum}:`);
    console.log(`  Last layer exited: ${ex.lastLayer}`);
    console.log(`  Last color set: ${ex.lastColor}`);
    console.log('  Context (last 10 lines):');
    console.log(ex.context.split('\n').map(l => '    ' + l).join('\n'));
  }
}

analyzeColors().catch(console.error);
