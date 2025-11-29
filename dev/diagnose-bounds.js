/**
 * Diagnostic script to analyze path coordinates and transforms
 * for 2023/2024 7.5-minute USGS quads (original format)
 */

const fs = require('fs');
const nodePath = require('path');
const PDFProcessor = require('./src/pdf-processor');

const SAMPLE_FILES = [
  'samples/VT_Essex_Junction_20240417_TM_geo.pdf',
  'samples/NY_Niagara_Falls_20230524_TM_geo.pdf',
];

async function analyzePDF(filePath) {
  console.log('\n' + '='.repeat(80));
  console.log('Analyzing: ' + nodePath.basename(filePath));
  console.log('='.repeat(80));

  const fileBuffer = fs.readFileSync(filePath);
  const processor = new PDFProcessor(fileBuffer);

  processor.setProgressCallback(() => {}); // Suppress progress output

  const result = await processor.process();
  const paths = (result.contentPaths && result.contentPaths.paths) || [];

  console.log('\nTotal paths extracted: ' + paths.length);

  // Analyze transforms stored on paths
  const transforms = new Map();
  let pathsWithIdentityTransform = 0;
  let pathsWithTransform = 0;

  paths.forEach(p => {
    if (p.transform) {
      const t = p.transform;
      const key = '[' + t.a.toFixed(2) + ', ' + t.b.toFixed(2) + ', ' + t.c.toFixed(2) + ', ' + t.d.toFixed(2) + ', ' + t.e.toFixed(2) + ', ' + t.f.toFixed(2) + ']';

      if (t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0) {
        pathsWithIdentityTransform++;
      } else {
        pathsWithTransform++;
        transforms.set(key, (transforms.get(key) || 0) + 1);
      }
    }
  });

  console.log('\nTransform analysis:');
  console.log('  Paths with identity transform: ' + pathsWithIdentityTransform);
  console.log('  Paths with non-identity transform: ' + pathsWithTransform);

  if (transforms.size > 0) {
    console.log('\n  Unique transforms found (top 10):');
    const sorted = [...transforms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    sorted.forEach(([t, count]) => {
      console.log('    ' + t + ': ' + count + ' paths');
    });
  }

  // Analyze bounds per layer
  const layerBounds = {};

  paths.forEach(p => {
    const layer = p.layer || '(no layer)';
    if (!layerBounds[layer]) {
      layerBounds[layer] = {
        minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
        count: 0,
        transforms: new Set()
      };
    }
    const b = layerBounds[layer];
    b.count++;

    // Track transforms per layer
    if (p.transform) {
      const t = p.transform;
      if (!(t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0)) {
        b.transforms.add('[' + t.a.toFixed(2) + ',' + t.d.toFixed(2) + ',' + t.e.toFixed(0) + ',' + t.f.toFixed(0) + ']');
      }
    }

    // Get raw coordinate bounds
    if (p.operations) {
      p.operations.forEach(op => {
        if (op.x !== undefined) { b.minX = Math.min(b.minX, op.x); b.maxX = Math.max(b.maxX, op.x); }
        if (op.y !== undefined) { b.minY = Math.min(b.minY, op.y); b.maxY = Math.max(b.maxY, op.y); }
        if (op.x1 !== undefined) { b.minX = Math.min(b.minX, op.x1); b.maxX = Math.max(b.maxX, op.x1); }
        if (op.y1 !== undefined) { b.minY = Math.min(b.minY, op.y1); b.maxY = Math.max(b.maxY, op.y1); }
        if (op.x2 !== undefined) { b.minX = Math.min(b.minX, op.x2); b.maxX = Math.max(b.maxX, op.x2); }
        if (op.y2 !== undefined) { b.minY = Math.min(b.minY, op.y2); b.maxY = Math.max(b.maxY, op.y2); }
      });
    }
  });

  console.log('\nLayer bounds (raw coordinates):');
  const layerList = Object.entries(layerBounds)
    .filter(([_, b]) => isFinite(b.maxX))
    .sort((a, b) => b[1].count - a[1].count);

  layerList.forEach(([name, b]) => {
    const w = (b.maxX - b.minX).toFixed(0);
    const h = (b.maxY - b.minY).toFixed(0);
    const transformInfo = b.transforms.size > 0 ? ' [has ' + b.transforms.size + ' unique transforms]' : '';
    console.log('  ' + name + ':');
    console.log('    ' + b.count + ' paths, bounds: X[' + b.minX.toFixed(0) + ' to ' + b.maxX.toFixed(0) + '] Y[' + b.minY.toFixed(0) + ' to ' + b.maxY.toFixed(0) + ']');
    console.log('    size: ' + w + ' x ' + h + transformInfo);
  });

  // Check if applying transforms would help
  console.log('\n\nBounds AFTER applying stored transforms:');

  const transformedLayerBounds = {};

  paths.forEach(p => {
    const layer = p.layer || '(no layer)';
    if (!transformedLayerBounds[layer]) {
      transformedLayerBounds[layer] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, count: 0 };
    }
    const b = transformedLayerBounds[layer];
    b.count++;

    const t = p.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

    if (p.operations) {
      p.operations.forEach(op => {
        // Apply transform: x' = a*x + c*y + e, y' = b*x + d*y + f
        const applyTransform = (x, y) => {
          return {
            x: t.a * x + t.c * y + t.e,
            y: t.b * x + t.d * y + t.f
          };
        };

        if (op.x !== undefined && op.y !== undefined) {
          const pt = applyTransform(op.x, op.y);
          b.minX = Math.min(b.minX, pt.x); b.maxX = Math.max(b.maxX, pt.x);
          b.minY = Math.min(b.minY, pt.y); b.maxY = Math.max(b.maxY, pt.y);
        }
        if (op.x1 !== undefined && op.y1 !== undefined) {
          const pt = applyTransform(op.x1, op.y1);
          b.minX = Math.min(b.minX, pt.x); b.maxX = Math.max(b.maxX, pt.x);
          b.minY = Math.min(b.minY, pt.y); b.maxY = Math.max(b.maxY, pt.y);
        }
        if (op.x2 !== undefined && op.y2 !== undefined) {
          const pt = applyTransform(op.x2, op.y2);
          b.minX = Math.min(b.minX, pt.x); b.maxX = Math.max(b.maxX, pt.x);
          b.minY = Math.min(b.minY, pt.y); b.maxY = Math.max(b.maxY, pt.y);
        }
      });
    }
  });

  const transformedList = Object.entries(transformedLayerBounds)
    .filter(([_, b]) => isFinite(b.maxX))
    .sort((a, b) => b[1].count - a[1].count);

  transformedList.forEach(([name, b]) => {
    const w = (b.maxX - b.minX).toFixed(0);
    const h = (b.maxY - b.minY).toFixed(0);
    console.log('  ' + name + ': X[' + b.minX.toFixed(0) + ' to ' + b.maxX.toFixed(0) + '] Y[' + b.minY.toFixed(0) + ' to ' + b.maxY.toFixed(0) + '] = ' + w + ' x ' + h);
  });

  // Check page bounds from metadata
  if (result.metadata && result.metadata.pages && result.metadata.pages.length > 0) {
    const page = result.metadata.pages[0];
    console.log('\nPDF Page bounds (from metadata):');
    console.log('  MediaBox: ' + JSON.stringify(page.mediaBox));
    console.log('  CropBox: ' + JSON.stringify(page.cropBox));
    console.log('  Size: ' + page.width + ' x ' + page.height + ' pts');
  }

  // Analyze "(no layer)" paths in detail
  const noLayerPaths = paths.filter(p => !p.layer);
  if (noLayerPaths.length > 0) {
    console.log('\n\nAnalysis of "(no layer)" paths:');
    console.log('  Total: ' + noLayerPaths.length);

    // Check which have very negative X (the outliers)
    const outlierPaths = noLayerPaths.filter(p => {
      let minX = Infinity;
      if (p.operations) {
        p.operations.forEach(op => {
          if (op.x !== undefined) minX = Math.min(minX, op.x);
        });
      }
      return minX < 0;
    });
    console.log('  With X < 0: ' + outlierPaths.length);

    // Sample a few outlier paths
    if (outlierPaths.length > 0) {
      console.log('\n  Sample outlier paths (first 3):');
      outlierPaths.slice(0, 3).forEach((p, i) => {
        console.log('    Path ' + i + ':');
        console.log('      Operations: ' + (p.operations ? p.operations.length : 0));
        console.log('      Fill: ' + (p.fill ? 'yes' : 'no') + ', Stroke: ' + (p.stroke ? 'yes' : 'no'));
        if (p.fillColor) console.log('      FillColor: rgb(' + p.fillColor.join(',') + ')');
        if (p.strokeColor) console.log('      StrokeColor: rgb(' + p.strokeColor.join(',') + ')');
        if (p.operations && p.operations.length > 0) {
          console.log('      First ops: ' + JSON.stringify(p.operations.slice(0, 3)));
        }
      });
    }
  }

  return { paths, layerBounds: layerList, transformedBounds: transformedList };
}

async function main() {
  for (const file of SAMPLE_FILES) {
    const fullPath = nodePath.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      await analyzePDF(fullPath);
    } else {
      console.log('File not found: ' + file);
    }
  }
}

main().catch(console.error);
