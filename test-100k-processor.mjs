/**
 * Test 100K format processing through PDFProcessor
 * This tests the complete flow including format detection and coordinate transformation
 */

import fs from 'fs';

// Use dynamic import for CJS module
const { default: PDFProcessor } = await import('./src/pdf-processor.js');

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';
const PDF_PATH_75MIN = './samples/VT_Jay_Peak_20240416_TM_geo.pdf';

async function testProcessor(filePath, label) {
  console.log('='.repeat(70));
  console.log(`TESTING: ${label}`);
  console.log(`File: ${filePath}`);
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(filePath);
  const processor = new PDFProcessor(buffer);

  // Process the PDF
  const result = await processor.process();

  // Show format detection results
  console.log('\n--- FORMAT DETECTION ---');
  console.log(`Scale: ${result.metadata.usgsFormat?.scale || 'unknown'}`);
  console.log(`Generation: ${result.metadata.usgsFormat?.generation || 'unknown'}`);
  console.log(`Is Topobuilder: ${result.metadata.usgsFormat?.isTopobuilder || false}`);
  console.log(`Page dimensions: ${result.metadata.pageDimensions?.widthPt} x ${result.metadata.pageDimensions?.heightPt} pts`);

  // Show path extraction results
  const paths = result.contentPaths?.paths || [];
  console.log(`\n--- PATH EXTRACTION ---`);
  console.log(`Total paths: ${paths.length}`);

  if (paths.length === 0) {
    console.log('No paths extracted!');
    return;
  }

  // Analyze coordinate ranges
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let identityTransformCount = 0;
  let nonIdentityTransformCount = 0;

  for (const path of paths) {
    // Check transform
    const t = path.transform;
    if (t && t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0) {
      identityTransformCount++;
    } else {
      nonIdentityTransformCount++;
    }

    // Analyze coordinates
    for (const sp of path.subpaths || []) {
      const points = [sp.startPoint, ...sp.segments.map(s => s.point)].filter(Boolean);
      for (const pt of points) {
        minX = Math.min(minX, pt.x);
        maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y);
        maxY = Math.max(maxY, pt.y);
      }
    }
  }

  console.log(`\n--- TRANSFORM ANALYSIS ---`);
  console.log(`Paths with identity transform: ${identityTransformCount}`);
  console.log(`Paths with non-identity transform: ${nonIdentityTransformCount}`);

  console.log(`\n--- COORDINATE RANGES ---`);
  console.log(`X range: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
  console.log(`Y range: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);

  const pageWidth = result.metadata.pageDimensions?.widthPt || 3312;
  const pageHeight = result.metadata.pageDimensions?.heightPt || 2160;
  console.log(`\nPage bounds: 0 to ${pageWidth} (X), 0 to ${pageHeight} (Y)`);

  // Check if coordinates fit (allowing for some margin and negative Y)
  const xFits = maxX <= pageWidth * 1.1 && minX >= -pageWidth * 0.1;
  const yFits = maxY <= pageHeight * 1.1 && minY >= -pageHeight * 1.1;

  console.log(`\n--- FIT CHECK ---`);
  console.log(`X fits within reasonable bounds: ${xFits ? 'YES' : 'NO'}`);
  console.log(`Y fits within reasonable bounds: ${yFits ? 'YES' : 'NO'}`);

  // Show first few paths
  console.log(`\n--- FIRST 5 PATHS ---`);
  for (let i = 0; i < Math.min(5, paths.length); i++) {
    const path = paths[i];
    const firstPoint = path.subpaths?.[0]?.startPoint;
    console.log(`Path ${i}: layer=${path.layer || 'none'}, op=${path.operation}, start=(${firstPoint?.x?.toFixed(1)}, ${firstPoint?.y?.toFixed(1)})`);
  }
}

async function main() {
  // Test 100K format first
  await testProcessor(PDF_PATH_100K, '100K Map (2025 Topobuilder format)');

  console.log('\n\n');

  // Test 7.5-minute for comparison
  await testProcessor(PDF_PATH_75MIN, '7.5-minute Map (2024 legacy format)');
}

main().catch(console.error);
