/**
 * Test the full pipeline exactly as the app does
 * to verify coordinates at each step
 */

import fs from 'fs';

const { default: PDFProcessor } = await import('./src/pdf-processor.js');
const { default: SVGGenerator } = await import('./src/svg-generator.js');

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function testFullPipeline() {
  console.log('='.repeat(70));
  console.log('FULL PIPELINE TEST - 100K FORMAT');
  console.log('='.repeat(70));

  // Step 1: Load and process PDF (same as main.js)
  console.log('\n--- STEP 1: PDF Processing ---');
  const buffer = fs.readFileSync(PDF_PATH_100K);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  // Step 2: Extract paths (same as main.js line 252)
  console.log('\n--- STEP 2: Extract Paths ---');
  const currentPDFPaths = result.contentPaths?.paths || [];
  console.log('Total paths:', currentPDFPaths.length);

  // Calculate bounds from paths (what the app does)
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const path of currentPDFPaths) {
    for (const op of path.operations || []) {
      if (typeof op.x === 'number') { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
      if (typeof op.y === 'number') { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
      if (typeof op.x1 === 'number') { minX = Math.min(minX, op.x1); maxX = Math.max(maxX, op.x1); }
      if (typeof op.y1 === 'number') { minY = Math.min(minY, op.y1); maxY = Math.max(maxY, op.y1); }
      if (typeof op.x2 === 'number') { minX = Math.min(minX, op.x2); maxX = Math.max(maxX, op.x2); }
      if (typeof op.y2 === 'number') { minY = Math.min(minY, op.y2); maxY = Math.max(maxY, op.y2); }
      if (typeof op.x3 === 'number') { minX = Math.min(minX, op.x3); maxX = Math.max(maxX, op.x3); }
      if (typeof op.y3 === 'number') { minY = Math.min(minY, op.y3); maxY = Math.max(maxY, op.y3); }
    }
  }

  console.log('Calculated path bounds:');
  console.log(`  X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
  console.log(`  Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);

  // Step 3: Create SVGGenerator (same as main.js line 256)
  console.log('\n--- STEP 3: Create SVGGenerator ---');
  const svgGenerator = new SVGGenerator(currentPDFPaths);

  // Set neatline and page dimensions (same as main.js)
  if (result.metadata.neatline) {
    svgGenerator.setNeatline(result.metadata.neatline);
    console.log('Neatline set:', result.metadata.neatline);
  }
  if (result.metadata.pageDimensions) {
    svgGenerator.setPageDimensions(result.metadata.pageDimensions);
    console.log('Page dimensions set:', result.metadata.pageDimensions);
  }

  // Step 4: Get debug info (same as main.js getDebugInfo handler)
  console.log('\n--- STEP 4: getDebugInfo() ---');
  const debugInfo = svgGenerator.getDebugInfo();

  console.log('Overall bounds from getDebugInfo():');
  console.log(`  minX: ${debugInfo.overallBounds.minX}`);
  console.log(`  maxX: ${debugInfo.overallBounds.maxX}`);
  console.log(`  minY: ${debugInfo.overallBounds.minY}`);
  console.log(`  maxY: ${debugInfo.overallBounds.maxY}`);
  console.log(`  width: ${debugInfo.overallBounds.width}`);
  console.log(`  height: ${debugInfo.overallBounds.height}`);

  // Step 5: Verify first few paths
  console.log('\n--- STEP 5: First 5 paths sample ---');
  for (let i = 0; i < Math.min(5, currentPDFPaths.length); i++) {
    const p = currentPDFPaths[i];
    console.log(`\nPath ${i}:`);
    console.log(`  layer: ${p.layer}`);
    console.log(`  ops: ${p.operations?.length || 0}`);
    if (p.operations?.[0]) {
      const op = p.operations[0];
      console.log(`  first op: ${op.type} x=${op.x?.toFixed(2)} y=${op.y?.toFixed(2)}`);
    }
  }

  // Step 6: Compare with expected page dimensions
  console.log('\n--- STEP 6: Analysis ---');
  const pageW = result.metadata.pageDimensions?.widthPt || 3312;
  const pageH = result.metadata.pageDimensions?.heightPt || 2160;
  console.log(`Page dimensions: ${pageW} x ${pageH}`);

  const boundsW = maxX - minX;
  const boundsH = maxY - minY;

  if (boundsW > 10000) {
    console.log('\n❌ PROBLEM: Path bounds (~' + boundsW.toFixed(0) + ') are in BBox space, not page space!');
    console.log('   The coordinate transformation is NOT being applied.');
  } else if (boundsW > 0 && boundsW < 5000) {
    console.log('\n✅ SUCCESS: Path bounds (~' + boundsW.toFixed(0) + ') are in page space.');
    console.log('   The coordinate transformation IS being applied correctly.');
  }

  // Check format detection
  console.log('\n--- Format Detection ---');
  console.log('usgsFormat:', JSON.stringify(result.metadata.usgsFormat, null, 2));
}

testFullPipeline().catch(console.error);
