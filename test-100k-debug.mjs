/**
 * Debug 100K format processing to trace where transform is applied
 */

import fs from 'fs';

const { default: PDFProcessor } = await import('./src/pdf-processor.js');

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function debugTest() {
  console.log('='.repeat(70));
  console.log('DEBUG 100K PROCESSING');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH_100K);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  const paths = result.contentPaths?.paths || [];
  console.log(`\nTotal paths: ${paths.length}`);

  // Check format detection
  console.log('\n--- FORMAT DETECTION ---');
  console.log('usgsFormat:', result.metadata.usgsFormat);
  console.log('isTopobuilder:', result.metadata.usgsFormat?.isTopobuilder);
  console.log('generation:', result.metadata.usgsFormat?.generation);

  // Check first few paths structure
  console.log('\n--- FIRST 3 PATHS ---');
  for (let i = 0; i < Math.min(3, paths.length); i++) {
    const p = paths[i];
    console.log(`\nPath ${i}:`);
    console.log(`  layer: ${p.layer}`);
    console.log(`  operations count: ${p.operations?.length || 0}`);
    if (p.operations?.[0]) {
      const op = p.operations[0];
      console.log(`  first op: ${op.type} (${op.x?.toFixed(2)}, ${op.y?.toFixed(2)})`);
    }
  }

  // Calculate coordinate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const op of path.operations || []) {
      if (typeof op.x === 'number' && typeof op.y === 'number') {
        minX = Math.min(minX, op.x);
        maxX = Math.max(maxX, op.x);
        minY = Math.min(minY, op.y);
        maxY = Math.max(maxY, op.y);
      }
    }
  }

  console.log('\n--- COORDINATE BOUNDS ---');
  console.log(`X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
  console.log(`Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);

  const pageWidth = result.metadata.pageDimensions?.widthPt || 3312;
  const pageHeight = result.metadata.pageDimensions?.heightPt || 2160;
  console.log(`\nPage dimensions: ${pageWidth} x ${pageHeight}`);

  // Check if bounds are in BBox space or page space
  const inBBoxSpace = (maxX - minX) > 10000;
  const inPageSpace = (maxX - minX) < 5000;

  console.log(`\n--- DIAGNOSIS ---`);
  if (inBBoxSpace) {
    console.log('PROBLEM: Coordinates are in BBox space (~18400x12000)');
    console.log('The CTM transform is NOT being applied during parsing');
  } else if (inPageSpace) {
    console.log('SUCCESS: Coordinates are in page space');
  }
}

debugTest().catch(console.error);
