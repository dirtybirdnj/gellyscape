const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

async function findNeatline() {
  const pdfPath = 'samples/VT_Essex_Junction_20240417_TM_geo.pdf';
  const buffer = fs.readFileSync(pdfPath);
  const processor = new PDFProcessor(buffer, { verbose: false });
  const result = await processor.process();

  // contentPaths.paths contains all extracted paths
  const pagePaths = result.contentPaths?.paths || [];
  console.log('Total paths count:', pagePaths.length);

  if (pagePaths && pagePaths.length > 0) {
    // Group by layer
    const byLayer = {};
    for (const path of pagePaths) {
      const layer = path.layer || '(no layer)';
      byLayer[layer] = (byLayer[layer] || 0) + 1;
    }

    console.log('\nPaths by layer:');
    Object.entries(byLayer).sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
      console.log('  ', name + ':', count);
    });

    // Find Map Frame paths
    console.log('\n--- Map Frame layer paths ---');
    const mapFramePaths = pagePaths.filter(p => p.layer === 'Map Frame');
    console.log('Map Frame path count:', mapFramePaths.length);

    for (const path of mapFramePaths.slice(0, 10)) {
      const ops = path.operations || [];
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const op of ops) {
        if (op.x !== undefined) {
          bounds.minX = Math.min(bounds.minX, op.x);
          bounds.maxX = Math.max(bounds.maxX, op.x);
        }
        if (op.y !== undefined) {
          bounds.minY = Math.min(bounds.minY, op.y);
          bounds.maxY = Math.max(bounds.maxY, op.y);
        }
      }
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      console.log('  Path:', ops.length, 'ops, bounds:',
                  bounds.minX.toFixed(1), bounds.minY.toFixed(1), 'to',
                  bounds.maxX.toFixed(1), bounds.maxY.toFixed(1),
                  '| size:', w.toFixed(1), 'x', h.toFixed(1),
                  '| stroke:', path.stroke, '| fill:', path.fill);
    }

    // Also check Projection and Grids
    console.log('\n--- Projection and Grids layer paths ---');
    const gridPaths = pagePaths.filter(p => p.layer === 'Projection and Grids');
    console.log('Projection and Grids path count:', gridPaths.length);

    // Find largest rectangles in any layer (lower threshold)
    console.log('\n--- Largest rectangles (potential neatlines) ---');
    const largeRects = [];
    for (const path of pagePaths) {
      const ops = path.operations || [];
      if (ops.length < 4 || ops.length > 10) continue;

      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const op of ops) {
        if (op.x !== undefined) {
          bounds.minX = Math.min(bounds.minX, op.x);
          bounds.maxX = Math.max(bounds.maxX, op.x);
        }
        if (op.y !== undefined) {
          bounds.minY = Math.min(bounds.minY, op.y);
          bounds.maxY = Math.max(bounds.maxY, op.y);
        }
      }
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;

      // Large rectangle? (lowered threshold)
      if (w > 500 && h > 500) {
        largeRects.push({ path, bounds, w, h });
      }
    }

    largeRects.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    console.log('Found', largeRects.length, 'large rectangles');
    for (const { path, bounds, w, h } of largeRects.slice(0, 10)) {
      console.log('  Layer:', path.layer || '(no layer)');
      console.log('    Bounds:', bounds.minX.toFixed(2), bounds.minY.toFixed(2), 'to',
                  bounds.maxX.toFixed(2), bounds.maxY.toFixed(2));
      console.log('    Size:', w.toFixed(2), 'x', h.toFixed(2), 'pts');
      console.log('    Stroke:', path.stroke, '| Fill:', path.fill);
      if (path.strokeColor) console.log('    StrokeColor:', path.strokeColor);
      console.log('');
    }

    // Show Projection and Grids details
    console.log('\n--- Projection and Grids details ---');
    const gridPathsDetail = pagePaths.filter(p => p.layer === 'Projection and Grids');
    for (const path of gridPathsDetail.slice(0, 15)) {
      const ops = path.operations || [];
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const op of ops) {
        if (op.x !== undefined) {
          bounds.minX = Math.min(bounds.minX, op.x);
          bounds.maxX = Math.max(bounds.maxX, op.x);
        }
        if (op.y !== undefined) {
          bounds.minY = Math.min(bounds.minY, op.y);
          bounds.maxY = Math.max(bounds.maxY, op.y);
        }
      }
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      console.log('  Ops:', ops.length, '| Size:', w.toFixed(0), 'x', h.toFixed(0),
                  '| Bounds:', bounds.minX.toFixed(0), bounds.minY.toFixed(0), 'to',
                  bounds.maxX.toFixed(0), bounds.maxY.toFixed(0),
                  '| Stroke:', path.stroke);
    }

    // Show Map Elements details
    console.log('\n--- Map Elements details (first 10) ---');
    const mapElPaths = pagePaths.filter(p => p.layer === 'Map Elements');
    for (const path of mapElPaths.slice(0, 10)) {
      const ops = path.operations || [];
      const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      for (const op of ops) {
        if (op.x !== undefined) {
          bounds.minX = Math.min(bounds.minX, op.x);
          bounds.maxX = Math.max(bounds.maxX, op.x);
        }
        if (op.y !== undefined) {
          bounds.minY = Math.min(bounds.minY, op.y);
          bounds.maxY = Math.max(bounds.maxY, op.y);
        }
      }
      const w = bounds.maxX - bounds.minX;
      const h = bounds.maxY - bounds.minY;
      console.log('  Ops:', ops.length, '| Size:', w.toFixed(0), 'x', h.toFixed(0),
                  '| Bounds:', bounds.minX.toFixed(0), bounds.minY.toFixed(0), 'to',
                  bounds.maxX.toFixed(0), bounds.maxY.toFixed(0),
                  '| Stroke:', path.stroke, '| Fill:', path.fill);
    }
  }
}

findNeatline().catch(console.error);
