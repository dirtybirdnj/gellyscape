/**
 * Analyze VT_Charlotte PDF for data loss issues
 */

import fs from 'fs';

const { default: PDFProcessor } = await import('./src/pdf-processor.js');

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function analyzeCharlotte() {
  console.log('='.repeat(70));
  console.log('VT_CHARLOTTE ANALYSIS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  // Basic info
  console.log('\n--- FORMAT INFO ---');
  console.log('usgsFormat:', JSON.stringify(result.metadata.usgsFormat, null, 2));
  console.log('Page dimensions:', result.metadata.pageDimensions);

  // Path statistics
  const paths = result.contentPaths?.paths || [];
  console.log('\n--- PATH STATISTICS ---');
  console.log('Total paths:', paths.length);

  // Layer breakdown
  const layerCounts = {};
  const layerColors = {};
  let pathsWithStroke = 0;
  let pathsWithFill = 0;
  let pathsWithNoColor = 0;

  for (const path of paths) {
    const layer = path.layer || 'Unassigned';
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;

    // Track colors per layer
    if (!layerColors[layer]) {
      layerColors[layer] = { strokes: new Set(), fills: new Set() };
    }

    if (path.stroke && path.strokeColor) {
      pathsWithStroke++;
      const color = Array.isArray(path.strokeColor)
        ? `rgb(${path.strokeColor.join(',')})`
        : path.strokeColor;
      layerColors[layer].strokes.add(color);
    }

    if (path.fill && path.fillColor) {
      pathsWithFill++;
      const color = Array.isArray(path.fillColor)
        ? `rgb(${path.fillColor.join(',')})`
        : path.fillColor;
      layerColors[layer].fills.add(color);
    }

    if (!path.stroke && !path.fill) {
      pathsWithNoColor++;
    }
  }

  console.log(`Paths with stroke: ${pathsWithStroke}`);
  console.log(`Paths with fill: ${pathsWithFill}`);
  console.log(`Paths with NO color: ${pathsWithNoColor}`);

  console.log('\n--- LAYER BREAKDOWN ---');
  Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([layer, count]) => {
      const colors = layerColors[layer];
      const strokeCount = colors.strokes.size;
      const fillCount = colors.fills.size;
      console.log(`  ${layer}: ${count} paths (${strokeCount} stroke colors, ${fillCount} fill colors)`);
    });

  // Check for unassigned paths
  const unassignedCount = layerCounts['Unassigned'] || 0;
  const unassignedPercent = ((unassignedCount / paths.length) * 100).toFixed(1);
  console.log(`\nUnassigned paths: ${unassignedCount} (${unassignedPercent}%)`);

  // Check coordinate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const op of path.operations || []) {
      if (typeof op.x === 'number') { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
      if (typeof op.y === 'number') { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
    }
  }

  console.log('\n--- COORDINATE BOUNDS ---');
  console.log(`X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
  console.log(`Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);

  // Check for paths with very few operations (possibly incomplete)
  let pathsWith1Op = 0;
  let pathsWith2Op = 0;
  let emptyPaths = 0;

  for (const path of paths) {
    const opCount = path.operations?.length || 0;
    if (opCount === 0) emptyPaths++;
    else if (opCount === 1) pathsWith1Op++;
    else if (opCount === 2) pathsWith2Op++;
  }

  console.log('\n--- PATH COMPLETENESS ---');
  console.log(`Empty paths (0 ops): ${emptyPaths}`);
  console.log(`Paths with 1 op: ${pathsWith1Op}`);
  console.log(`Paths with 2 ops: ${pathsWith2Op}`);

  // Sample some paths from each major layer
  console.log('\n--- SAMPLE PATHS BY LAYER ---');
  const majorLayers = Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  for (const [layer] of majorLayers) {
    const layerPaths = paths.filter(p => (p.layer || 'Unassigned') === layer);
    console.log(`\n${layer} (${layerPaths.length} paths):`);

    // Show first 2 paths
    for (let i = 0; i < Math.min(2, layerPaths.length); i++) {
      const p = layerPaths[i];
      console.log(`  Path ${i}:`);
      console.log(`    ops: ${p.operations?.length || 0}`);
      console.log(`    stroke: ${p.stroke} color: ${JSON.stringify(p.strokeColor)}`);
      console.log(`    fill: ${p.fill} color: ${JSON.stringify(p.fillColor)}`);
      if (p.operations?.[0]) {
        const op = p.operations[0];
        console.log(`    first op: ${op.type} (${op.x?.toFixed(1)}, ${op.y?.toFixed(1)})`);
      }
    }
  }

  // Compare with Jay Peak which we know works
  console.log('\n--- COMPARISON WITH JAY PEAK ---');
  const jayPeakBuffer = fs.readFileSync('./samples/VT_Jay_Peak_20240416_TM_geo.pdf');
  const jayPeakProcessor = new PDFProcessor(jayPeakBuffer);
  const jayPeakResult = await jayPeakProcessor.process();
  const jayPeakPaths = jayPeakResult.contentPaths?.paths || [];

  console.log(`Charlotte: ${paths.length} paths`);
  console.log(`Jay Peak: ${jayPeakPaths.length} paths`);

  const charlotteLayerSet = new Set(Object.keys(layerCounts));
  const jayPeakLayerCounts = {};
  for (const p of jayPeakPaths) {
    const layer = p.layer || 'Unassigned';
    jayPeakLayerCounts[layer] = (jayPeakLayerCounts[layer] || 0) + 1;
  }
  const jayPeakLayerSet = new Set(Object.keys(jayPeakLayerCounts));

  console.log('\nLayers in Charlotte but not Jay Peak:');
  for (const layer of charlotteLayerSet) {
    if (!jayPeakLayerSet.has(layer)) {
      console.log(`  - ${layer}`);
    }
  }

  console.log('\nLayers in Jay Peak but not Charlotte:');
  for (const layer of jayPeakLayerSet) {
    if (!charlotteLayerSet.has(layer)) {
      console.log(`  - ${layer}`);
    }
  }

  // Check for specific layer differences
  console.log('\nLayer count comparison:');
  const allLayers = new Set([...charlotteLayerSet, ...jayPeakLayerSet]);
  for (const layer of allLayers) {
    const charlotteCount = layerCounts[layer] || 0;
    const jayPeakCount = jayPeakLayerCounts[layer] || 0;
    if (charlotteCount !== jayPeakCount) {
      console.log(`  ${layer}: Charlotte=${charlotteCount} vs JayPeak=${jayPeakCount}`);
    }
  }
}

analyzeCharlotte().catch(console.error);
