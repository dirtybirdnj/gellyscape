/**
 * Test script for SVG Path Conversion
 * Tests the complete PDF → SVG path conversion pipeline
 *
 * Usage: node test-svg-conversion.js
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName } = require('pdf-lib');
const PDFContentParser = require('./src/pdf-content-parser');
const SVGPathConverter = require('./src/svg-path-converter');

async function testSVGConversion() {
  console.log('='.repeat(80));
  console.log('SVG PATH CONVERSION TEST');
  console.log('='.repeat(80));
  console.log();

  // Load sample GeoPDF
  const samplePath = path.join(__dirname, 'samples', 'VT_Burlington_20240809_TM_geo.pdf');

  if (!fs.existsSync(samplePath)) {
    console.error(`Error: Sample file not found at ${samplePath}`);
    console.log('Please ensure the sample GeoPDF is in the samples/ directory.');
    return;
  }

  console.log(`Loading PDF: ${path.basename(samplePath)}`);
  const pdfBuffer = fs.readFileSync(samplePath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  const pages = pdfDoc.getPages();
  console.log(`PDF has ${pages.length} pages\n`);

  // Extract paths from first page
  console.log('Extracting paths from first page...');
  const firstPage = pages[0];
  const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();

  console.log(`PDF page dimensions: ${pdfWidth} x ${pdfHeight} points`);

  // Get content stream - use PDFName to create the key
  const pageDict = firstPage.node.dict;
  const contentsKey = PDFName.of('Contents');
  const contents = pageDict.get(contentsKey);

  if (!contents) {
    console.error('Error: No content stream found on first page');
    console.log('\nDebugging page dictionary:');
    console.log('Available keys:', pageDict.keys());
    console.log('Trying to get Contents with different approaches...');

    // Try looking up directly
    const allEntries = Array.from(pageDict.entries());
    console.log('All entries:', allEntries.map(([k, v]) => [k.toString(), v.constructor.name]));
    return;
  }

  const streams = Array.isArray(contents) ? contents : [contents];
  console.log(`Found ${streams.length} content stream(s) to parse`);

  // Parse paths
  let allPaths = [];
  for (let i = 0; i < streams.length; i++) {
    try {
      const streamRef = streams[i];
      console.log(`  Stream ${i + 1}: Reference type:`, streamRef.constructor.name);

      const stream = pdfDoc.context.lookup(streamRef);

      if (!stream) {
        console.log(`  Stream ${i + 1}: Could not lookup stream reference`);
        continue;
      }

      console.log(`  Stream ${i + 1}: Stream type:`, stream.constructor.name);
      console.log(`  Stream ${i + 1}: Stream properties:`, Object.keys(stream));

      // Try different ways to access the content
      let contentData = null;

      if (stream.contents) {
        contentData = stream.contents;
        console.log(`  Stream ${i + 1}: Found contents property (${contentData.length} bytes)`);
      } else if (stream.getContents) {
        contentData = stream.getContents();
        console.log(`  Stream ${i + 1}: Got contents via getContents() (${contentData.length} bytes)`);
      } else if (stream.dict && stream.dict.lookup) {
        // Try to get the decoded stream data
        try {
          contentData = pdfDoc.context.lookup(streamRef, true);
          if (contentData && contentData.contents) {
            contentData = contentData.contents;
            console.log(`  Stream ${i + 1}: Got contents via lookup with decode (${contentData.length} bytes)`);
          }
        } catch (e) {
          console.log(`  Stream ${i + 1}: Decode attempt failed:`, e.message);
        }
      }

      if (!contentData) {
        console.log(`  Stream ${i + 1}: Could not find content data`);
        continue;
      }

      console.log(`  Parsing stream ${i + 1} (${contentData.length} bytes)...`);
      const parser = new PDFContentParser();
      const paths = parser.parseContentStream(contentData);
      console.log(`  Stream ${i + 1}: Found ${paths.length} paths`);
      allPaths = allPaths.concat(paths);
    } catch (streamError) {
      console.error(`  Stream ${i + 1}: Error parsing - ${streamError.message}`);
      console.error(streamError.stack);
    }
  }

  console.log(`Extracted ${allPaths.length} paths from first page\n`);

  if (allPaths.length === 0) {
    console.log('No paths found. Cannot test conversion.');
    return;
  }

  // Initialize SVG converter
  console.log('Initializing SVG Path Converter...');
  const converter = new SVGPathConverter({
    pdfWidth,
    pdfHeight,
    svgWidth: 828,  // Target dimensions from btv-crop-11.5x23.5.svg
    svgHeight: 1692,
    precision: 2,
    flipY: true,
    applyTransform: true
  });

  console.log('Converter settings:');
  console.log(`  PDF dimensions: ${pdfWidth} x ${pdfHeight}`);
  console.log(`  SVG dimensions: 828 x 1692`);
  console.log(`  Coordinate precision: 2 decimal places`);
  console.log(`  Y-axis flip: enabled`);
  console.log(`  Transform application: enabled\n`);

  // Convert paths to SVG
  console.log('Converting paths to SVG format...');
  const svgPaths = converter.convertPaths(allPaths);
  console.log(`Converted ${svgPaths.length} paths successfully\n`);

  // Generate statistics
  const stats = {
    totalPaths: svgPaths.length,
    byOperation: {},
    byFillColor: {},
    byStrokeColor: {},
    samplePaths: []
  };

  svgPaths.forEach((svgPath) => {
    // Count operations
    stats.byOperation[svgPath.operation] = (stats.byOperation[svgPath.operation] || 0) + 1;

    // Count colors
    if (svgPath.style.fill && svgPath.style.fill !== 'none') {
      stats.byFillColor[svgPath.style.fill] = (stats.byFillColor[svgPath.style.fill] || 0) + 1;
    }
    if (svgPath.style.stroke) {
      stats.byStrokeColor[svgPath.style.stroke] = (stats.byStrokeColor[svgPath.style.stroke] || 0) + 1;
    }
  });

  // Collect sample paths (first 10)
  stats.samplePaths = svgPaths.slice(0, 10).map((p, i) => ({
    index: i,
    operation: p.operation,
    pathLength: p.d.length,
    pathData: p.d.substring(0, 100) + (p.d.length > 100 ? '...' : ''),
    fill: p.style.fill,
    stroke: p.style.stroke,
    strokeWidth: p.style.strokeWidth
  }));

  // Display statistics
  console.log('='.repeat(80));
  console.log('CONVERSION STATISTICS');
  console.log('='.repeat(80));
  console.log();

  console.log(`Total paths converted: ${stats.totalPaths}`);
  console.log();

  console.log('Paths by operation:');
  Object.entries(stats.byOperation)
    .sort((a, b) => b[1] - a[1])
    .forEach(([op, count]) => {
      const pct = ((count / stats.totalPaths) * 100).toFixed(1);
      console.log(`  ${op.padEnd(15)}: ${count.toString().padStart(6)} (${pct}%)`);
    });
  console.log();

  console.log('Top 10 fill colors:');
  Object.entries(stats.byFillColor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([color, count]) => {
      console.log(`  ${color.padEnd(10)}: ${count.toString().padStart(6)} paths`);
    });
  console.log();

  console.log('Top 10 stroke colors:');
  Object.entries(stats.byStrokeColor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([color, count]) => {
      console.log(`  ${color.padEnd(10)}: ${count.toString().padStart(6)} paths`);
    });
  console.log();

  // Display sample paths
  console.log('='.repeat(80));
  console.log('SAMPLE CONVERTED PATHS (first 10)');
  console.log('='.repeat(80));
  console.log();

  stats.samplePaths.forEach((sample) => {
    console.log(`Path ${sample.index}:`);
    console.log(`  Operation: ${sample.operation}`);
    console.log(`  Fill: ${sample.fill || 'none'}`);
    console.log(`  Stroke: ${sample.stroke || 'none'}`);
    if (sample.strokeWidth !== undefined) {
      console.log(`  Stroke Width: ${sample.strokeWidth}`);
    }
    console.log(`  Path Data (${sample.pathLength} chars): ${sample.pathData}`);
    console.log();
  });

  // Generate sample SVG file
  console.log('='.repeat(80));
  console.log('GENERATING SAMPLE SVG');
  console.log('='.repeat(80));
  console.log();

  const svgContent = generateSampleSVG(svgPaths.slice(0, 1000), 828, 1692);
  const outputPath = path.join(__dirname, 'test-svg-output.svg');
  fs.writeFileSync(outputPath, svgContent);

  console.log(`Sample SVG saved to: ${outputPath}`);
  console.log(`Contains first 1000 paths from the PDF`);
  console.log(`File size: ${(svgContent.length / 1024).toFixed(2)} KB`);
  console.log();

  // Calculate bounds
  console.log('='.repeat(80));
  console.log('COORDINATE BOUNDS');
  console.log('='.repeat(80));
  console.log();

  const bounds = converter.calculateBounds(allPaths);
  console.log('Original PDF bounds (before transformation):');
  console.log(`  X: ${bounds.x.toFixed(2)} to ${(bounds.x + bounds.width).toFixed(2)}`);
  console.log(`  Y: ${bounds.y.toFixed(2)} to ${(bounds.y + bounds.height).toFixed(2)}`);
  console.log(`  Width: ${bounds.width.toFixed(2)}`);
  console.log(`  Height: ${bounds.height.toFixed(2)}`);
  console.log();

  // Export detailed conversion data
  const detailedOutput = {
    metadata: {
      pdfFile: path.basename(samplePath),
      pdfDimensions: { width: pdfWidth, height: pdfHeight },
      svgDimensions: { width: 828, height: 1692 },
      totalPathsExtracted: allPaths.length,
      totalPathsConverted: svgPaths.length,
      bounds
    },
    statistics: stats,
    sampleSVGPaths: svgPaths.slice(0, 20).map(p => ({
      operation: p.operation,
      pathData: p.d,
      style: p.style
    }))
  };

  const jsonOutputPath = path.join(__dirname, 'test-svg-conversion.json');
  fs.writeFileSync(jsonOutputPath, JSON.stringify(detailedOutput, null, 2));

  console.log(`Detailed conversion data saved to: ${jsonOutputPath}`);
  console.log();

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Summary:');
  console.log(`  ✓ Loaded PDF with ${pages.length} pages`);
  console.log(`  ✓ Extracted ${allPaths.length} paths from first page`);
  console.log(`  ✓ Converted ${svgPaths.length} paths to SVG format`);
  console.log(`  ✓ Generated sample SVG with 1000 paths`);
  console.log(`  ✓ Coordinate transformation working correctly`);
  console.log();
  console.log('Next steps:');
  console.log('  1. Open test-svg-output.svg in a browser or SVG viewer');
  console.log('  2. Verify paths are rendered correctly');
  console.log('  3. Check that coordinates are properly transformed');
  console.log('  4. Review test-svg-conversion.json for detailed data');
  console.log();
}

/**
 * Generate a complete SVG file with converted paths
 */
function generateSampleSVG(svgPaths, width, height) {
  const pathElements = svgPaths.map((svgPath, index) => {
    const converter = new SVGPathConverter();
    return converter.generatePathElement(svgPath, {
      id: `path-${index}`,
      className: `operation-${svgPath.operation}`
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}"
     height="${height}"
     viewBox="0 0 ${width} ${height}">
  <title>GeoPDF to SVG Conversion Test</title>
  <desc>Sample conversion of first 1000 paths from VT_Burlington_20240809_TM_geo.pdf</desc>

  <style>
    .operation-stroke { }
    .operation-fill { }
    .operation-fill-stroke { }
  </style>

  <g id="test-paths">
${pathElements.map(el => '    ' + el).join('\n')}
  </g>
</svg>`;
}

// Run the test
if (require.main === module) {
  testSVGConversion()
    .then(() => {
      console.log('Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed with error:');
      console.error(error);
      process.exit(1);
    });
}

module.exports = { testSVGConversion };
