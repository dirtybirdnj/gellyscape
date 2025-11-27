/**
 * Analyze Charlotte PDF with decoded streams
 */

import fs from 'fs';
import zlib from 'zlib';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function analyzeDecoded() {
  console.log('='.repeat(70));
  console.log('CHARLOTTE DECODED STREAM ANALYSIS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let streams = [];
  if (Array.isArray(contents)) {
    streams = contents;
  } else if (contents?.array) {
    streams = contents.array;
  } else {
    streams = [contents];
  }

  console.log(`\n--- DECODED STREAMS (${streams.length} total) ---`);

  let totalBDC = 0;
  let totalEMC = 0;
  let totalPaths = 0;

  for (let i = 0; i < streams.length; i++) {
    const streamRef = streams[i];
    const stream = pdfDoc.context.lookup(streamRef);

    if (!stream) continue;

    let rawContent;
    try {
      rawContent = stream.getContents ? stream.getContents() : stream.contents;
    } catch (e) {
      console.log(`Stream ${i}: Error getting content - ${e.message}`);
      continue;
    }

    if (!rawContent) continue;

    // Check if stream is compressed
    const filter = stream.dict?.get(PDFName.of('Filter'));
    let decodedText;

    if (filter && filter.toString() === '/FlateDecode') {
      try {
        const decoded = zlib.inflateSync(Buffer.from(rawContent));
        decodedText = decoded.toString('latin1');
      } catch (e) {
        console.log(`Stream ${i}: Decompression failed - ${e.message}`);
        continue;
      }
    } else {
      decodedText = Buffer.from(rawContent).toString('latin1');
    }

    // Now count operators in DECODED content
    const bdcCount = (decodedText.match(/\/\w+\s+BDC/g) || []).length +
                     (decodedText.match(/\/\w+\s+<<[^>]*>>\s+BDC/g) || []).length;
    const emcCount = (decodedText.match(/\sEMC\s/g) || []).length +
                     (decodedText.match(/\sEMC$/gm) || []).length;

    // Count path starts (moveto)
    const movetoCount = (decodedText.match(/[\d\.\-\s]+m\b/g) || []).length;
    const rectCount = (decodedText.match(/[\d\.\-\s]+re\b/g) || []).length;

    // Count path ends
    const strokeCount = (decodedText.match(/\bS\b/g) || []).length;
    const fillCount = (decodedText.match(/\bf\b/g) || []).length +
                      (decodedText.match(/\bF\b/g) || []).length;
    const bothCount = (decodedText.match(/\bB\b/g) || []).length;

    totalBDC += bdcCount;
    totalEMC += emcCount;
    totalPaths += movetoCount + rectCount;

    console.log(`\nStream ${i}:`);
    console.log(`  Size: ${decodedText.length} chars (decoded)`);
    console.log(`  BDC markers: ${bdcCount}`);
    console.log(`  EMC markers: ${emcCount}`);
    console.log(`  moveto (m): ${movetoCount}`);
    console.log(`  rect (re): ${rectCount}`);
    console.log(`  stroke (S): ${strokeCount}`);
    console.log(`  fill (f/F): ${fillCount}`);
    console.log(`  both (B): ${bothCount}`);

    // Show sample of first 500 chars
    if (i === 0) {
      console.log(`\n  Sample (first 500 chars):`);
      console.log(`    ${decodedText.substring(0, 500).replace(/\n/g, '\\n').substring(0, 500)}...`);
    }

    // Find sample BDC patterns
    const bdcSamples = decodedText.match(/\/\w+\s+(BDC|<<[^>]*>>\s+BDC)/g);
    if (bdcSamples && bdcSamples.length > 0) {
      console.log(`\n  Sample BDC patterns:`);
      bdcSamples.slice(0, 5).forEach(s => console.log(`    ${s.trim()}`));
    }
  }

  console.log(`\n--- TOTALS (DECODED) ---`);
  console.log(`Total BDC markers: ${totalBDC}`);
  console.log(`Total EMC markers: ${totalEMC}`);
  console.log(`Total path starts: ${totalPaths}`);

  // Compare with extraction
  console.log(`\n--- EXTRACTION COMPARISON ---`);
  const { default: PDFProcessor } = await import('./src/pdf-processor.js');
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();
  const paths = result.contentPaths?.paths || [];

  console.log(`Extracted paths: ${paths.length}`);
  console.log(`Raw path starts: ${totalPaths}`);

  // Layer assignment check
  const layerCounts = {};
  for (const path of paths) {
    const layer = path.layer || 'Unassigned';
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  }

  console.log(`\nLayer breakdown:`);
  Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([layer, count]) => {
      console.log(`  ${layer}: ${count}`);
    });
}

analyzeDecoded().catch(console.error);
