/**
 * Analyze layer names and bounds from a PDF
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

// Use the NY 100K file from the screenshot
const testFiles = [
  'samples/NY_100K_Topo_1_20251121_055620498852_TM_geo.pdf',
  'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf'
];

async function analyzeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('File not found: ' + filePath + '\n');
    return;
  }

  console.log('\n=== Analyzing: ' + filePath + ' ===\n');

  const buffer = fs.readFileSync(filePath);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  const paths = result.contentPaths?.paths || [];
  console.log('Total paths: ' + paths.length);

  // Count paths by layer
  const layerCounts = {};
  paths.forEach(path => {
    const layer = path.layer || '(no layer)';
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  });

  console.log('\nLayers found:');
  Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([layer, count]) => {
      console.log('  ' + String(count).padStart(6) + ' - ' + layer);
    });

  // Calculate bounds for all paths
  let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
  paths.forEach(path => {
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) { allMinX = Math.min(allMinX, op.x); allMaxX = Math.max(allMaxX, op.x); }
        if (op.y !== undefined) { allMinY = Math.min(allMinY, op.y); allMaxY = Math.max(allMaxY, op.y); }
      });
    }
  });

  console.log('\nAll paths bounds: X[' + allMinX.toFixed(0) + ' to ' + allMaxX.toFixed(0) + '] Y[' + allMinY.toFixed(0) + ' to ' + allMaxY.toFixed(0) + ']');
  console.log('Size: ' + (allMaxX - allMinX).toFixed(0) + ' x ' + (allMaxY - allMinY).toFixed(0));

  // Calculate bounds by layer to find outliers
  console.log('\nBounds by layer:');
  const layerBounds = {};
  paths.forEach(path => {
    const layer = path.layer || '(no layer)';
    if (!layerBounds[layer]) {
      layerBounds[layer] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }
    const b = layerBounds[layer];
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) { b.minX = Math.min(b.minX, op.x); b.maxX = Math.max(b.maxX, op.x); }
        if (op.y !== undefined) { b.minY = Math.min(b.minY, op.y); b.maxY = Math.max(b.maxY, op.y); }
      });
    }
  });

  // Sort by bounding box size (descending)
  const sortedLayers = Object.entries(layerBounds)
    .map(([name, b]) => ({
      name,
      width: b.maxX - b.minX,
      height: b.maxY - b.minY,
      bounds: b
    }))
    .filter(l => isFinite(l.width))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height));

  sortedLayers.slice(0, 15).forEach(layer => {
    console.log('  ' + layer.name);
    console.log('    Bounds: X[' + layer.bounds.minX.toFixed(0) + ' to ' + layer.bounds.maxX.toFixed(0) + '] Y[' + layer.bounds.minY.toFixed(0) + ' to ' + layer.bounds.maxY.toFixed(0) + ']');
    console.log('    Size: ' + layer.width.toFixed(0) + ' x ' + layer.height.toFixed(0));
  });
}

async function main() {
  for (const file of testFiles) {
    await analyzeFile(file);
  }
}

main().catch(console.error);
