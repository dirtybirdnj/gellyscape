/**
 * Test script to verify layer name resolution fix for 2025 format
 * Also tests bounds calculation with outlier layer exclusion
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');
const path = require('path');

// Test with multiple format files
const testFiles = [
  'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf', // 100K 2025 format
  'samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf', // Another 100K 2025
  'samples/VT_250K_Topo_20251121_054343748075_TM_geo.pdf',   // 250K 2025 format
  'samples/MA_75MinuteTopo1_20251121_062032758784_TM_geo.pdf', // 24K 2025 format
  'samples/VT_Charlotte_20240813_TM_geo.pdf'   // Legacy format (control)
];

// Layers to exclude from bounds calculation (same as renderer.js)
const BOUNDS_EXCLUDE_LAYERS = [
  'Map Collar', 'Map Frame', 'Projection and Grids', 'Barcode',
  'Map Elements', 'Graticule', 'Map Surround', 'Magnetic Declination',
  'Geographic Names'
];

async function testFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}\n`);
    return;
  }

  const fileName = path.basename(filePath);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${fileName}`);
  console.log('='.repeat(60));

  const buffer = fs.readFileSync(filePath);
  const processor = new PDFProcessor(buffer);

  try {
    const result = await processor.process();
    const paths = result.contentPaths?.paths || [];

    console.log(`\nTotal paths: ${paths.length}`);

    // Count by layer
    const layerCounts = {};
    let unresolvedCount = 0;

    paths.forEach(p => {
      const layer = p.layer || 'Unknown';
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;

      // Check for unresolved MC references
      if (layer.startsWith('/MC')) {
        unresolvedCount++;
      }
    });

    // Show layer breakdown
    const sortedLayers = Object.entries(layerCounts)
      .sort((a, b) => b[1] - a[1]);

    console.log('\nTop 10 layers by path count:');
    sortedLayers.slice(0, 10).forEach(([name, count]) => {
      const marker = name.startsWith('/MC') ? ' ❌ UNRESOLVED' : '';
      console.log(`  ${name}: ${count}${marker}`);
    });

    // Summary
    console.log('\n--- LAYER RESOLUTION ---');
    if (unresolvedCount === 0) {
      console.log('✅ All layer names resolved correctly!');
    } else {
      console.log(`❌ ${unresolvedCount} paths have unresolved /MC references`);
      console.log('   This indicates the layer name mapping is not working');
    }

    // Check for expected layers in 2025 format
    const expectedLayers = ['Contours', 'Hydrography', 'Transportation', 'Roads', 'Land Cover', 'Terrain', 'General Hydrography'];
    const foundExpected = expectedLayers.filter(l => layerCounts[l]);
    console.log(`\nExpected layers found: ${foundExpected.length}/${expectedLayers.length}`);
    console.log(`  ${foundExpected.join(', ') || 'None'}`);

    // Test bounds calculation with outlier exclusion
    console.log('\n--- BOUNDS ANALYSIS ---');

    // Helper function
    const shouldExclude = (layer) => {
      if (!layer) return false;
      const base = layer.split('::')[0];
      return BOUNDS_EXCLUDE_LAYERS.some(p => base.toLowerCase().includes(p.toLowerCase()));
    };

    // Calculate all bounds
    let allMinX = Infinity, allMinY = Infinity, allMaxX = -Infinity, allMaxY = -Infinity;
    let filtMinX = Infinity, filtMinY = Infinity, filtMaxX = -Infinity, filtMaxY = -Infinity;

    paths.forEach(p => {
      if (!p.operations) return;
      p.operations.forEach(op => {
        if (op.x !== undefined) {
          allMinX = Math.min(allMinX, op.x);
          allMaxX = Math.max(allMaxX, op.x);
          if (!shouldExclude(p.layer)) {
            filtMinX = Math.min(filtMinX, op.x);
            filtMaxX = Math.max(filtMaxX, op.x);
          }
        }
        if (op.y !== undefined) {
          allMinY = Math.min(allMinY, op.y);
          allMaxY = Math.max(allMaxY, op.y);
          if (!shouldExclude(p.layer)) {
            filtMinY = Math.min(filtMinY, op.y);
            filtMaxY = Math.max(filtMaxY, op.y);
          }
        }
      });
    });

    const allWidth = allMaxX - allMinX;
    const allHeight = allMaxY - allMinY;
    const filtWidth = filtMaxX - filtMinX;
    const filtHeight = filtMaxY - filtMinY;

    console.log(`All paths bounds:      ${Math.round(allWidth)} x ${Math.round(allHeight)}`);
    console.log(`Filtered bounds:       ${Math.round(filtWidth)} x ${Math.round(filtHeight)}`);

    if (allWidth > filtWidth * 1.5 || allHeight > filtHeight * 1.5) {
      console.log('✅ Outlier filtering reduces bounds significantly!');
      console.log(`   Reduction: ${((1 - filtWidth/allWidth) * 100).toFixed(0)}% width, ${((1 - filtHeight/allHeight) * 100).toFixed(0)}% height`);
    } else {
      console.log('ℹ️  Bounds similar - file may not have significant outliers');
    }

    // Show bounds per layer to identify outliers
    const layerBounds = {};
    paths.forEach(p => {
      const layer = p.layer || 'Unknown';
      if (!layerBounds[layer]) {
        layerBounds[layer] = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      }
      if (p.operations) {
        p.operations.forEach(op => {
          if (op.x !== undefined) {
            layerBounds[layer].minX = Math.min(layerBounds[layer].minX, op.x);
            layerBounds[layer].maxX = Math.max(layerBounds[layer].maxX, op.x);
          }
          if (op.y !== undefined) {
            layerBounds[layer].minY = Math.min(layerBounds[layer].minY, op.y);
            layerBounds[layer].maxY = Math.max(layerBounds[layer].maxY, op.y);
          }
        });
      }
    });

    // Find any outlier layers
    const outlierLayers = Object.entries(layerBounds)
      .map(([name, b]) => ({ name, w: b.maxX - b.minX, h: b.maxY - b.minY }))
      .filter(l => l.w > filtWidth * 1.2 || l.h > filtHeight * 1.2)
      .sort((a, b) => (b.w * b.h) - (a.w * a.h));

    if (outlierLayers.length > 0) {
      console.log('\nOutlier layers (bounds > 120% of filtered):');
      outlierLayers.slice(0, 5).forEach(l => {
        console.log(`  ${l.name}: ${Math.round(l.w)} x ${Math.round(l.h)}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function main() {
  console.log('Layer Name Resolution Test');
  console.log('Testing fix for 2025 USGS Topobuilder format');

  for (const file of testFiles) {
    await testFile(file);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
}

main();
