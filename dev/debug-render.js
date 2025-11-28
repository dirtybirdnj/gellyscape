/**
 * Debug render bounds calculation to match what renderer.js does
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

const testFile = 'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf';

async function main() {
  const buffer = fs.readFileSync(testFile);
  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  const paths = result.contentPaths?.paths || [];
  console.log('Total paths: ' + paths.length);

  // Simulate the renderer filtering
  const enabledLayers = new Set();

  // Build sublayer names like the renderer does
  paths.forEach(path => {
    if (!path.layer) return;

    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = 'rgb(' + path.strokeColor.join(',') + ')';
    } else if (path.fill && path.fillColor) {
      pathColor = 'rgb(' + path.fillColor.join(',') + ')';
    }

    if (pathColor) {
      enabledLayers.add(path.layer + '::' + pathColor);
    }
  });

  console.log('\nFound ' + enabledLayers.size + ' unique sublayers');

  // Filter paths like renderer
  const filteredPaths = paths.filter(path => {
    if (!path.layer) return false;

    let pathColor = null;
    if (path.stroke && path.strokeColor) {
      pathColor = 'rgb(' + path.strokeColor.join(',') + ')';
    } else if (path.fill && path.fillColor) {
      pathColor = 'rgb(' + path.fillColor.join(',') + ')';
    }

    if (!pathColor) return false;

    const sublayerName = path.layer + '::' + pathColor;
    return enabledLayers.has(sublayerName);
  });

  console.log('Filtered paths: ' + filteredPaths.length);

  // Calculate bounds for all filtered paths
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  filteredPaths.forEach(path => {
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
        if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        if (op.x1 !== undefined) { minX = Math.min(minX, op.x1); maxX = Math.max(maxX, op.x1); }
        if (op.y1 !== undefined) { minY = Math.min(minY, op.y1); maxY = Math.max(maxY, op.y1); }
        if (op.x2 !== undefined) { minX = Math.min(minX, op.x2); maxX = Math.max(maxX, op.x2); }
        if (op.y2 !== undefined) { minY = Math.min(minY, op.y2); maxY = Math.max(maxY, op.y2); }
        if (op.x3 !== undefined) { minX = Math.min(minX, op.x3); maxX = Math.max(maxX, op.x3); }
        if (op.y3 !== undefined) { minY = Math.min(minY, op.y3); maxY = Math.max(maxY, op.y3); }
      });
    }
  });

  console.log('\n=== ALL PATHS BOUNDS ===');
  console.log('X: [' + minX.toFixed(2) + ' to ' + maxX.toFixed(2) + ']');
  console.log('Y: [' + minY.toFixed(2) + ' to ' + maxY.toFixed(2) + ']');
  console.log('Size: ' + (maxX - minX).toFixed(0) + ' x ' + (maxY - minY).toFixed(0));

  // Now test the whitelist approach
  const BOUNDS_CORE_LAYERS = [
    'transportation', 'hydrography', 'general hydrography', 'terrain', 'contours',
    'land cover', 'woodland', 'roads', 'trails', 'railroads', 'boundaries',
    'wetlands', 'water'
  ];

  const shouldIncludeInBounds = (layerName) => {
    if (!layerName) return false;
    const baseLayer = layerName.split('::')[0].toLowerCase();
    return BOUNDS_CORE_LAYERS.some(core => baseLayer.includes(core));
  };

  let wlMinX = Infinity, wlMinY = Infinity, wlMaxX = -Infinity, wlMaxY = -Infinity;
  let wlCount = 0;

  filteredPaths.forEach(path => {
    if (!shouldIncludeInBounds(path.layer)) return;
    wlCount++;

    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) { wlMinX = Math.min(wlMinX, op.x); wlMaxX = Math.max(wlMaxX, op.x); }
        if (op.y !== undefined) { wlMinY = Math.min(wlMinY, op.y); wlMaxY = Math.max(wlMaxY, op.y); }
        if (op.x1 !== undefined) { wlMinX = Math.min(wlMinX, op.x1); wlMaxX = Math.max(wlMaxX, op.x1); }
        if (op.y1 !== undefined) { wlMinY = Math.min(wlMinY, op.y1); wlMaxY = Math.max(wlMaxY, op.y1); }
        if (op.x2 !== undefined) { wlMinX = Math.min(wlMinX, op.x2); wlMaxX = Math.max(wlMaxX, op.x2); }
        if (op.y2 !== undefined) { wlMinY = Math.min(wlMinY, op.y2); wlMaxY = Math.max(wlMaxY, op.y2); }
        if (op.x3 !== undefined) { wlMinX = Math.min(wlMinX, op.x3); wlMaxX = Math.max(wlMaxX, op.x3); }
        if (op.y3 !== undefined) { wlMinY = Math.min(wlMinY, op.y3); wlMaxY = Math.max(wlMaxY, op.y3); }
      });
    }
  });

  console.log('\n=== WHITELIST BOUNDS (core layers only) ===');
  console.log('Matched ' + wlCount + ' paths');
  console.log('X: [' + wlMinX.toFixed(2) + ' to ' + wlMaxX.toFixed(2) + ']');
  console.log('Y: [' + wlMinY.toFixed(2) + ' to ' + wlMaxY.toFixed(2) + ']');
  console.log('Size: ' + (wlMaxX - wlMinX).toFixed(0) + ' x ' + (wlMaxY - wlMinY).toFixed(0));

  // What container dimensions might look like
  const containerWidth = 958;  // From screenshot approximately
  const containerHeight = 650;
  const padding = 20;

  const width = wlMaxX - wlMinX;
  const height = wlMaxY - wlMinY;

  const scaleX = containerWidth / (width + padding * 2);
  const scaleY = containerHeight / (height + padding * 2);
  const scale = Math.min(scaleX, scaleY);

  console.log('\n=== SCALE CALCULATION ===');
  console.log('Container: ' + containerWidth + ' x ' + containerHeight);
  console.log('Content size: ' + width.toFixed(0) + ' x ' + height.toFixed(0));
  console.log('Scale X: ' + scaleX.toFixed(6));
  console.log('Scale Y: ' + scaleY.toFixed(6));
  console.log('Final scale: ' + scale.toFixed(6));

  if (scale < 0.01) {
    console.log('\n!!! WARNING: Scale is very small - content may be too large or bounds incorrect');
  }

  // Sample some specific layer bounds
  console.log('\n=== LAYER-SPECIFIC BOUNDS ===');
  const layerBounds = {};
  filteredPaths.forEach(path => {
    const layer = path.layer || '(no layer)';
    if (!layerBounds[layer]) {
      layerBounds[layer] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
    }
    const b = layerBounds[layer];
    b.count++;
    if (path.operations) {
      path.operations.forEach(op => {
        if (op.x !== undefined) { b.minX = Math.min(b.minX, op.x); b.maxX = Math.max(b.maxX, op.x); }
        if (op.y !== undefined) { b.minY = Math.min(b.minY, op.y); b.maxY = Math.max(b.maxY, op.y); }
      });
    }
  });

  Object.entries(layerBounds)
    .filter(([_, b]) => isFinite(b.maxX))
    .forEach(([name, b]) => {
      console.log(name + ': ' + b.count + ' paths');
      console.log('  X[' + b.minX.toFixed(0) + ' to ' + b.maxX.toFixed(0) + '] Y[' + b.minY.toFixed(0) + ' to ' + b.maxY.toFixed(0) + '] = ' + (b.maxX - b.minX).toFixed(0) + ' x ' + (b.maxY - b.minY).toFixed(0));
    });
}

main().catch(console.error);
