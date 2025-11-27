/**
 * Deep dive into why ~1000 paths have no color set
 * Look at the exact PDF content around these paths
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeColorlessPaths() {
  console.log('='.repeat(70));
  console.log('ANALYZING COLORLESS PATHS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];
  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  // Focus on streams 1 and 2 where colorless paths are
  const streamsToAnalyze = [1, 2];

  for (const streamIdx of streamsToAnalyze) {
    const streamRef = contentStreams[streamIdx];
    const stream = context.lookup(streamRef);

    if (!stream) continue;

    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }
    const content = rawData.toString('latin1');

    console.log(`\n${'='.repeat(70)}`);
    console.log(`STREAM ${streamIdx} ANALYSIS`);
    console.log('='.repeat(70));

    const lines = content.split('\n');
    let currentStrokeColor = null;
    let currentFillColor = null;
    let currentLayer = null;
    let lastColorOp = null;
    let lastColorOpLine = -1;
    let colorlessExamples = [];

    // Track graphics state stack
    let graphicsStateStack = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Graphics state save/restore
      if (line === 'q') {
        graphicsStateStack.push({
          strokeColor: currentStrokeColor,
          fillColor: currentFillColor
        });
      } else if (line === 'Q') {
        const saved = graphicsStateStack.pop();
        if (saved) {
          currentStrokeColor = saved.strokeColor;
          currentFillColor = saved.fillColor;
        }
      }

      // Track layer
      if (line.includes('BDC')) {
        const match = line.match(/\/(\w+)\s+BDC/);
        if (match) currentLayer = match[1];
      } else if (line === 'EMC') {
        currentLayer = null;
      }

      // Track colors
      const rgStroke = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
      const rgFill = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
      const grayStroke = line.match(/^([\d.]+)\s+G$/);
      const grayFill = line.match(/^([\d.]+)\s+g$/);

      if (rgStroke) {
        currentStrokeColor = `rgb(${Math.round(rgStroke[1]*255)},${Math.round(rgStroke[2]*255)},${Math.round(rgStroke[3]*255)})`;
        lastColorOp = line;
        lastColorOpLine = i;
      }
      if (rgFill) {
        currentFillColor = `rgb(${Math.round(rgFill[1]*255)},${Math.round(rgFill[2]*255)},${Math.round(rgFill[3]*255)})`;
        lastColorOp = line;
        lastColorOpLine = i;
      }
      if (grayStroke) {
        const g = Math.round(parseFloat(grayStroke[1]) * 255);
        currentStrokeColor = `rgb(${g},${g},${g})`;
        lastColorOp = line;
        lastColorOpLine = i;
      }
      if (grayFill) {
        const g = Math.round(parseFloat(grayFill[1]) * 255);
        currentFillColor = `rgb(${g},${g},${g})`;
        lastColorOp = line;
        lastColorOpLine = i;
      }

      // Found a stroke without color
      if ((line === 'S' || line === 's') && !currentStrokeColor) {
        if (colorlessExamples.length < 5) {
          colorlessExamples.push({
            lineNum: i,
            layer: currentLayer,
            lastColorOp,
            lastColorOpLine,
            graphicsStackDepth: graphicsStateStack.length,
            context: lines.slice(Math.max(0, i - 20), i + 1).join('\n')
          });
        }
      }

      // Found a fill without color
      if ((line === 'f' || line === 'F' || line === 'f*') && !currentFillColor) {
        if (colorlessExamples.length < 5) {
          colorlessExamples.push({
            lineNum: i,
            layer: currentLayer,
            lastColorOp,
            lastColorOpLine,
            graphicsStackDepth: graphicsStateStack.length,
            context: lines.slice(Math.max(0, i - 20), i + 1).join('\n')
          });
        }
      }
    }

    console.log(`\nFound ${colorlessExamples.length} colorless path examples`);

    for (let j = 0; j < colorlessExamples.length; j++) {
      const ex = colorlessExamples[j];
      console.log(`\n--- Example ${j + 1} at line ${ex.lineNum} ---`);
      console.log(`Layer: ${ex.layer || '(none)'}`);
      console.log(`Last color op: ${ex.lastColorOp || '(none)'} at line ${ex.lastColorOpLine}`);
      console.log(`Graphics state stack depth: ${ex.graphicsStackDepth}`);
      console.log('Context (20 lines before):');
      console.log(ex.context.split('\n').map(l => '  ' + l).join('\n'));
    }

    // Also look at what's special about this stream
    console.log(`\n--- Stream ${streamIdx} Summary ---`);

    // Count certain patterns
    let qCount = 0;
    let QCount = 0;
    let doCount = 0;
    let doNames = {};

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'q') qCount++;
      if (trimmed === 'Q') QCount++;
      const doMatch = trimmed.match(/^\/(\w+)\s+Do$/);
      if (doMatch) {
        doCount++;
        doNames[doMatch[1]] = (doNames[doMatch[1]] || 0) + 1;
      }
    }

    console.log(`Graphics state saves (q): ${qCount}`);
    console.log(`Graphics state restores (Q): ${QCount}`);
    console.log(`XObject invocations (Do): ${doCount}`);
    if (doCount > 0) {
      console.log(`XObjects called: ${Object.entries(doNames).slice(0, 10).map(([n, c]) => `${n}(${c})`).join(', ')}`);
    }
  }

  // Now let's check if the problem is in how pdf-content-parser.js handles graphics state
  console.log('\n' + '='.repeat(70));
  console.log('KEY INSIGHT: Check if colors are being INHERITED from parent state');
  console.log('='.repeat(70));

  // Look at beginning of stream 1 to see initial state
  const stream1Ref = contentStreams[1];
  const stream1 = context.lookup(stream1Ref);
  let rawData1 = stream1.getContents();
  const filter1 = stream1.dict?.get(PDFName.of('Filter'));
  if (filter1?.toString() === '/FlateDecode') {
    rawData1 = zlib.inflateSync(Buffer.from(rawData1));
  }
  const content1 = rawData1.toString('latin1');

  console.log('\nFirst 50 lines of Stream 1:');
  console.log(content1.split('\n').slice(0, 50).join('\n'));
}

analyzeColorlessPaths().catch(console.error);
