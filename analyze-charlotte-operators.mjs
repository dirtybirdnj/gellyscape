/**
 * Detailed operator analysis of Charlotte streams 4, 5, 6
 * These have moveto operations but no stroke/fill endings
 */

import fs from 'fs';
import zlib from 'zlib';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function analyzeOperators() {
  console.log('='.repeat(70));
  console.log('CHARLOTTE OPERATOR ANALYSIS - STREAMS 4, 5, 6');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let streams = contents.array;

  // Analyze streams 4, 5, 6 which have moveto but no stroke
  for (const streamIdx of [4, 5, 6]) {
    const streamRef = streams[streamIdx];
    const stream = pdfDoc.context.lookup(streamRef);

    let rawContent = stream.getContents ? stream.getContents() : stream.contents;
    const decoded = zlib.inflateSync(Buffer.from(rawContent)).toString('latin1');

    console.log(`\n${'='.repeat(50)}`);
    console.log(`STREAM ${streamIdx} ANALYSIS`);
    console.log(`${'='.repeat(50)}`);

    // Show first 2000 chars
    console.log(`\nFirst 2000 chars:`);
    console.log(decoded.substring(0, 2000));

    // Count all operator types
    console.log(`\n--- OPERATOR COUNTS ---`);

    const operators = {
      'm ': 'moveto',
      'l ': 'lineto',
      'c ': 'curveto',
      'v ': 'curveto (v)',
      'y ': 'curveto (y)',
      'h ': 'closepath',
      're ': 'rect',
      'S ': 'stroke',
      's ': 'close+stroke',
      'f ': 'fill',
      'F ': 'fill',
      'f* ': 'fill (evenodd)',
      'B ': 'fill+stroke',
      'B* ': 'fill+stroke (evenodd)',
      'b ': 'close+fill+stroke',
      'b* ': 'close+fill+stroke (evenodd)',
      'n ': 'end path (no fill/stroke)',
      'W ': 'clip',
      'W* ': 'clip (evenodd)',
      'q ': 'save state',
      'Q ': 'restore state',
      'cm ': 'concat matrix'
    };

    for (const [op, name] of Object.entries(operators)) {
      const regex = new RegExp(`\\b${op.trim()}\\b`, 'g');
      const count = (decoded.match(regex) || []).length;
      if (count > 0) {
        console.log(`  ${op.trim()}: ${count} (${name})`);
      }
    }

    // Check for n (end path without fill/stroke)
    const nCount = (decoded.match(/\bn\b/g) || []).length;
    console.log(`\n  n (end path no paint): ${nCount}`);

    // Look for W (clipping path) patterns
    const clipPatterns = decoded.match(/W\s*n/g);
    console.log(`  W n (clip): ${clipPatterns?.length || 0}`);

    // Find a sample of the path structure
    console.log(`\n--- SAMPLE PATH STRUCTURE ---`);
    const pathMatch = decoded.match(/\d[\d\.\-\s]+m[\s\S]{0,500}/);
    if (pathMatch) {
      console.log(pathMatch[0].substring(0, 500));
    }
  }
}

analyzeOperators().catch(console.error);
