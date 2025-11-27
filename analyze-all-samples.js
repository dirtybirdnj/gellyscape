/**
 * Analyze all sample PDFs to understand format differences
 */

const PDFProcessor = require('./src/pdf-processor');
const USGSFormatDetector = require('./src/usgs-format-detector');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, 'samples');

async function analyzeFile(filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FILE: ${fileName}`);
  console.log(`SIZE: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)} MB`);
  console.log('='.repeat(70));

  try {
    const buffer = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(buffer);
    const pdfData = await pdfParse(buffer);

    // Format detection
    const detector = new USGSFormatDetector(pdfDoc, pdfData.info);
    const formatInfo = await detector.detect();

    console.log('\n--- FORMAT INFO ---');
    console.log('Scale:', formatInfo.scale);
    console.log('Year:', formatInfo.year);
    console.log('Generation:', formatInfo.generation);
    console.log('Is Topobuilder:', formatInfo.isTopobuilder);
    console.log('Confidence:', formatInfo.confidence);

    console.log('\n--- METADATA ---');
    console.log('Subject:', formatInfo.metadata.subject?.substring(0, 80) || 'N/A');
    console.log('Creator:', formatInfo.metadata.creator || 'N/A');
    console.log('Keywords:', formatInfo.metadata.keywords?.substring(0, 60) || 'N/A');

    console.log('\n--- LAYERS ---');
    console.log('Layer count:', formatInfo.layers.count);
    console.log('Layer names:', formatInfo.layers.names.slice(0, 10).join(', ') + (formatInfo.layers.count > 10 ? '...' : ''));

    // Process to get paths
    const processor = new PDFProcessor(buffer);
    const result = await processor.process();

    const paths = result.contentPaths?.paths || [];
    console.log('\n--- PATHS ---');
    console.log('Total paths:', paths.length);

    // Count by layer
    const layerCounts = {};
    paths.forEach(p => {
      const layer = p.layer || 'Unknown';
      layerCounts[layer] = (layerCounts[layer] || 0) + 1;
    });

    // Show top layers
    const sortedLayers = Object.entries(layerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    console.log('Top layers by path count:');
    sortedLayers.forEach(([name, count]) => {
      console.log(`  ${name}: ${count}`);
    });

    // Check if layer names are resolved (not /MC references)
    const hasUnresolvedLayers = Object.keys(layerCounts).some(l => l.startsWith('/MC'));
    console.log('Layer names resolved:', !hasUnresolvedLayers ? 'YES' : 'NO (has /MC references)');

    // Calculate bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    paths.forEach(p => {
      if (p.operations) {
        p.operations.forEach(op => {
          if (op.x !== undefined) { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
          if (op.y !== undefined) { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
        });
      }
    });

    console.log('\n--- BOUNDS ---');
    console.log(`X: ${minX.toFixed(0)} to ${maxX.toFixed(0)} (width: ${(maxX - minX).toFixed(0)})`);
    console.log(`Y: ${minY.toFixed(0)} to ${maxY.toFixed(0)} (height: ${(maxY - minY).toFixed(0)})`);

    // Check for outlier layers
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

    // Find layers with unusual bounds
    const mainWidth = maxX - minX;
    const mainHeight = maxY - minY;
    const outlierLayers = Object.entries(layerBounds)
      .filter(([name, b]) => {
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        return w > mainWidth * 1.5 || h > mainHeight * 1.5;
      })
      .map(([name, b]) => ({
        name,
        width: (b.maxX - b.minX).toFixed(0),
        height: (b.maxY - b.minY).toFixed(0)
      }));

    if (outlierLayers.length > 0) {
      console.log('\n--- OUTLIER LAYERS (bounds > 1.5x main) ---');
      outlierLayers.forEach(l => {
        console.log(`  ${l.name}: ${l.width} x ${l.height}`);
      });
    }

    // Content stream structure
    const page = pdfDoc.getPages()[0];
    const pageDict = page.node.dict;
    const contents = pageDict.get(require('pdf-lib').PDFName.of('Contents'));

    console.log('\n--- CONTENT STRUCTURE ---');
    if (contents?.array) {
      console.log('Content streams:', contents.array.length);
    } else {
      console.log('Content streams: 1 (single stream)');
    }

    // Check for XObjects
    const resources = pageDict.get(require('pdf-lib').PDFName.of('Resources'));
    const xobjects = resources?.get(require('pdf-lib').PDFName.of('XObject'));
    if (xobjects) {
      const xobjDict = pdfDoc.context.lookup(xobjects);
      const xobjCount = xobjDict?.entries ? Array.from(xobjDict.entries()).length : 0;
      console.log('XObjects in resources:', xobjCount);

      // Count Form vs Image XObjects
      let formCount = 0, imageCount = 0;
      if (xobjDict?.entries) {
        for (const [key, ref] of xobjDict.entries()) {
          const xobj = pdfDoc.context.lookup(ref);
          const subtype = xobj?.dict?.get(require('pdf-lib').PDFName.of('Subtype'));
          if (subtype?.toString() === '/Form') formCount++;
          else if (subtype?.toString() === '/Image') imageCount++;
        }
      }
      console.log(`  Form XObjects: ${formCount}, Image XObjects: ${imageCount}`);
    }

    return {
      fileName,
      formatInfo,
      pathCount: paths.length,
      hasUnresolvedLayers,
      bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
    };

  } catch (error) {
    console.error('Error analyzing file:', error.message);
    return { fileName, error: error.message };
  }
}

async function main() {
  console.log('USGS GeoPDF Sample Analysis');
  console.log('Analyzing all sample files to understand format differences...\n');

  const files = fs.readdirSync(samplesDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(samplesDir, f));

  const results = [];
  for (const file of files) {
    const result = await analyzeFile(file);
    results.push(result);
  }

  // Summary table
  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('\nFile | Scale | Year | Paths | Layers OK | Bounds');
  console.log('-'.repeat(70));

  results.forEach(r => {
    if (r.error) {
      console.log(`${r.fileName.substring(0, 30)} | ERROR: ${r.error}`);
    } else {
      const bounds = r.bounds ? `${r.bounds.width.toFixed(0)}x${r.bounds.height.toFixed(0)}` : 'N/A';
      console.log(`${r.fileName.substring(0, 30).padEnd(30)} | ${(r.formatInfo?.scale || '?').padEnd(5)} | ${r.formatInfo?.year || '?'} | ${String(r.pathCount).padStart(6)} | ${r.hasUnresolvedLayers ? 'NO ' : 'YES'} | ${bounds}`);
    }
  });
}

main();
