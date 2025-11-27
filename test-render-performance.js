/**
 * Test SVG generation performance
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

const testFile = 'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf';

async function main() {
  console.log('SVG Render Performance Test');
  console.log('===========================');

  const buffer = fs.readFileSync(testFile);
  const processor = new PDFProcessor(buffer);

  console.log('\n1. Processing PDF...');
  let start = Date.now();
  const result = await processor.process();
  console.log(`   PDF processing: ${Date.now() - start}ms`);

  const paths = result.contentPaths?.paths || [];
  console.log(`   Total paths: ${paths.length}`);

  // Simulate bounds calculation (like renderer does)
  console.log('\n2. Calculating bounds...');
  start = Date.now();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  paths.forEach(path => {
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) {
          minX = Math.min(minX, op.x);
          maxX = Math.max(maxX, op.x);
        }
        if (op.y !== undefined) {
          minY = Math.min(minY, op.y);
          maxY = Math.max(maxY, op.y);
        }
      });
    }
  });

  console.log(`   Bounds calculation: ${Date.now() - start}ms`);
  console.log(`   Bounds: ${Math.round(maxX - minX)} x ${Math.round(maxY - minY)}`);

  // Simulate SVG path generation
  console.log('\n3. Generating SVG paths...');
  start = Date.now();

  let svgPaths = '';
  let pathCount = 0;

  paths.forEach(path => {
    if (!path.operations || path.operations.length === 0) return;

    let d = '';
    path.operations.forEach(op => {
      switch (op.type) {
        case 'moveto':
          d += `M${op.x.toFixed(2)},${op.y.toFixed(2)}`;
          break;
        case 'lineto':
          d += `L${op.x.toFixed(2)},${op.y.toFixed(2)}`;
          break;
        case 'curveto':
          d += `C${op.x1.toFixed(2)},${op.y1.toFixed(2)},${op.x2.toFixed(2)},${op.y2.toFixed(2)},${op.x3.toFixed(2)},${op.y3.toFixed(2)}`;
          break;
        case 'closepath':
          d += 'Z';
          break;
      }
    });

    if (d) {
      svgPaths += `<path d="${d}"/>\n`;
      pathCount++;
    }
  });

  console.log(`   SVG generation: ${Date.now() - start}ms`);
  console.log(`   Generated ${pathCount} SVG paths`);
  console.log(`   SVG size: ${(svgPaths.length / 1024).toFixed(0)} KB`);

  // Count total operations
  let totalOps = 0;
  paths.forEach(p => {
    totalOps += p.operations?.length || 0;
  });
  console.log(`   Total operations: ${totalOps}`);
}

main();
