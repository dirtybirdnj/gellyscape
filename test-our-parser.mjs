/**
 * Test our PDFContentParser against Jay Peak PDF
 * Compare what it extracts vs what we know is in the PDF
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

// Use dynamic import for CommonJS module
const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function testParser() {
  console.log('='.repeat(70));
  console.log('TESTING OUR PARSER ON JAY PEAK PDF');
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

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));
  const properties = resources?.get(PDFName.of('Properties'));

  // Build layer map (similar to what pdf-processor does)
  const layerMap = {};
  // Simplified - not building full layer map for this test

  console.log(`Content streams: ${contentStreams.length}`);

  let totalPaths = 0;
  let totalByOperation = {
    stroke: 0,
    fill: 0,
    'fill-stroke': 0
  };

  // Process each content stream
  for (let i = 0; i < contentStreams.length; i++) {
    const streamRef = contentStreams[i];
    const stream = context.lookup(streamRef);

    if (!stream) continue;

    // Get and decompress content
    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }

    console.log(`\nContent stream ${i}: ${rawData.length} bytes`);

    // Parse with our parser
    const parser = new PDFContentParser({
      layerMap: layerMap,
      pdfContext: context,
      fontDict: fontDict,
      resourcesDict: resources
    });

    const result = parser.parseContentStream(rawData);
    console.log(`  Extracted paths: ${result.paths.length}`);

    // Count by operation type
    for (const path of result.paths) {
      totalPaths++;
      if (path.operation) {
        totalByOperation[path.operation] = (totalByOperation[path.operation] || 0) + 1;
      }
    }
  }

  console.log('\n');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total paths extracted: ${totalPaths}`);
  console.log('By operation:');
  for (const [op, count] of Object.entries(totalByOperation)) {
    console.log(`  ${op}: ${count}`);
  }

  console.log('\n');
  console.log('EXPECTED (from pdf.js analysis):');
  console.log('  Visible paths: 6,298');
  console.log('  - stroke: 6,008');
  console.log('  - fill: 21');
  console.log('  - eoFill: 255');
  console.log('  - fillStroke: 1');
  console.log('  - eoFillStroke: 13');

  console.log('\n');
  console.log('DIFFERENCE:');
  console.log(`  Missing: ${6298 - totalPaths} paths (${((6298 - totalPaths) / 6298 * 100).toFixed(1)}%)`);
}

testParser().catch(console.error);
