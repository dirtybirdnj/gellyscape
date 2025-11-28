/**
 * Analyze transformations being applied to paths
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

const testFile = 'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf';

async function main() {
  if (!fs.existsSync(testFile)) {
    console.log('File not found');
    return;
  }

  console.log('Analyzing transforms in: ' + testFile + '\n');

  const buffer = fs.readFileSync(testFile);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  const paths = result.contentPaths?.paths || [];

  // Check a few sample paths from different layers
  const layers = ['Terrain', 'Transportation', 'General Hydrography', 'Structures'];

  layers.forEach(layerName => {
    const layerPaths = paths.filter(p => p.layer === layerName).slice(0, 3);

    console.log('\n=== ' + layerName + ' ===');
    console.log('Total paths: ' + paths.filter(p => p.layer === layerName).length);

    layerPaths.forEach((path, i) => {
      console.log('\nPath ' + (i + 1) + ':');
      console.log('  Operations: ' + (path.operations?.length || 0));
      if (path.operations && path.operations.length > 0) {
        const firstOp = path.operations[0];
        const lastOp = path.operations[path.operations.length - 1];
        console.log('  First op: ' + JSON.stringify(firstOp));
        console.log('  Last op: ' + JSON.stringify(lastOp));

        // Check coordinate ranges
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        path.operations.forEach(op => {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        });
        console.log('  Range: X[' + minX.toFixed(1) + ' to ' + maxX.toFixed(1) + '] Y[' + minY.toFixed(1) + ' to ' + maxY.toFixed(1) + ']');
      }
      console.log('  Fill: ' + path.fill + ', Stroke: ' + path.stroke);
      console.log('  fillColor: ' + JSON.stringify(path.fillColor));
      console.log('  strokeColor: ' + JSON.stringify(path.strokeColor));
    });
  });

  // Also check "(no layer)" paths
  const noLayerPaths = paths.filter(p => !p.layer).slice(0, 3);
  console.log('\n=== (no layer) ===');
  console.log('Total paths: ' + paths.filter(p => !p.layer).length);
  noLayerPaths.forEach((path, i) => {
    console.log('\nPath ' + (i + 1) + ':');
    console.log('  Operations: ' + (path.operations?.length || 0));
    if (path.operations && path.operations.length > 0) {
      const firstOp = path.operations[0];
      console.log('  First op: ' + JSON.stringify(firstOp));

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      path.operations.forEach(op => {
        if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
        if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
      });
      console.log('  Range: X[' + minX.toFixed(1) + ' to ' + maxX.toFixed(1) + '] Y[' + minY.toFixed(1) + ' to ' + maxY.toFixed(1) + ']');
    }
  });
}

main().catch(console.error);
