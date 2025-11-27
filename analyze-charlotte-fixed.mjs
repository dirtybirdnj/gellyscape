/**
 * Fixed operator analysis with proper regex escaping
 */

import fs from 'fs';
import zlib from 'zlib';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function analyze() {
  console.log('='.repeat(70));
  console.log('CHARLOTTE FIXED OPERATOR COUNTS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let streams = contents.array;

  // Combine all streams
  let allContent = '';
  for (let i = 0; i < streams.length; i++) {
    const streamRef = streams[i];
    const stream = pdfDoc.context.lookup(streamRef);
    let rawContent = stream.getContents ? stream.getContents() : stream.contents;
    const decoded = zlib.inflateSync(Buffer.from(rawContent)).toString('latin1');
    allContent += decoded + '\n';
  }

  console.log(`Total content size: ${allContent.length} chars`);

  // Count operators properly (using word boundaries)
  const operators = [
    ['m', 'moveto'],
    ['l', 'lineto'],
    ['c', 'curveto'],
    ['v', 'curveto (v)'],
    ['y', 'curveto (y)'],
    ['h', 'closepath'],
    ['re', 'rect'],
    ['S', 'stroke'],
    ['s', 'close+stroke'],
    ['f', 'fill'],
    ['F', 'fill (F)'],
    ['f\\*', 'fill (evenodd)'],
    ['B', 'fill+stroke'],
    ['B\\*', 'fill+stroke (evenodd)'],
    ['b', 'close+fill+stroke'],
    ['b\\*', 'close+fill+stroke (evenodd)'],
    ['n', 'end path (no paint)'],
    ['W', 'clip'],
    ['W\\*', 'clip (evenodd)'],
    ['q', 'save state'],
    ['Q', 'restore state'],
    ['cm', 'concat matrix']
  ];

  console.log('\n--- OPERATOR COUNTS (ALL STREAMS) ---');
  let totalPathEnds = 0;
  let noFillStroke = 0;

  for (const [op, name] of operators) {
    // Match operator at word boundary followed by whitespace or end
    const regex = new RegExp(`(?:^|\\s)${op}(?:\\s|$)`, 'gm');
    const matches = allContent.match(regex);
    const count = matches ? matches.length : 0;

    if (count > 0) {
      console.log(`  ${op.replace('\\', '')}: ${count.toLocaleString()} (${name})`);
    }

    // Track path endings
    if (['S', 's', 'f', 'F', 'f\\*', 'B', 'B\\*', 'b', 'b\\*', 'n'].includes(op)) {
      totalPathEnds += count;
      if (op === 'n') {
        noFillStroke = count;
      }
    }
  }

  console.log(`\n--- PATH ENDING ANALYSIS ---`);
  console.log(`Total path endings: ${totalPathEnds.toLocaleString()}`);
  console.log(`Paths with n (no paint): ${noFillStroke.toLocaleString()} (${((noFillStroke/totalPathEnds)*100).toFixed(1)}%)`);
  console.log(`Painted paths: ${(totalPathEnds - noFillStroke).toLocaleString()}`);

  // Compare with our extraction
  console.log(`\n--- COMPARISON ---`);
  const { default: PDFProcessor } = await import('./src/pdf-processor.js');
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();
  const paths = result.contentPaths?.paths || [];

  console.log(`Extracted paths: ${paths.length.toLocaleString()}`);
  console.log(`Expected (painted): ${(totalPathEnds - noFillStroke).toLocaleString()}`);
}

analyze().catch(console.error);
