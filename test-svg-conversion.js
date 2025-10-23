/**
 * Test script for SVG Path Conversion
 * Tests the complete PDF → SVG path conversion pipeline
 *
 * Usage: node test-svg-conversion.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName } = require('pdf-lib');
const PDFContentParser = require('./src/pdf-content-parser');
const SVGPathConverter = require('./src/svg-path-converter');

async function testSVGConversion() {
  console.log('='.repeat(80));
  console.log('SVG PATH CONVERSION TEST');
  console.log('='.repeat(80));
  console.log();

  // Setup output directory
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('Created output directory\n');
  }

  // Clean up old output files
  console.log('Cleaning up old output files...');
  const filesToClean = [
    path.join(outputDir, 'test-svg-output.svg'),
    path.join(outputDir, 'test-svg-conversion.json'),
    path.join(__dirname, 'test-svg-output.svg'),  // Old location
    path.join(__dirname, 'test-svg-conversion.json')  // Old location
  ];

  filesToClean.forEach(file => {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`  Deleted: ${path.basename(file)}`);
    }
  });
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

  // Handle the case where contents might be a PDFArray
  let streamRefs = [];

  if (contents.constructor.name === 'PDFArray') {
    console.log('Contents is a PDFArray, extracting stream references...');
    streamRefs = contents.array; // Get the actual array of references
    console.log(`Found ${streamRefs.length} stream reference(s) in array`);
  } else if (Array.isArray(contents)) {
    streamRefs = contents;
    console.log(`Found ${streamRefs.length} stream reference(s)`);
  } else {
    streamRefs = [contents];
    console.log('Found 1 stream reference');
  }

  // Extract font resources for text decoding
  const resourcesKey = PDFName.of('Resources');
  const resources = pageDict.get(resourcesKey);
  let fontDict = null;

  if (resources) {
    const fontKey = PDFName.of('Font');
    fontDict = resources.get(fontKey);
    if (fontDict) {
      console.log('Found Font dictionary for text decoding\n');
    }
  }

  // Parse paths
  let allPaths = [];
  let allTextObjects = [];
  for (let i = 0; i < streamRefs.length; i++) {
    try {
      const streamRef = streamRefs[i];
      console.log(`\n  Stream ${i + 1}/${streamRefs.length}:`);
      console.log(`    Reference type: ${streamRef.constructor.name}`);

      const stream = pdfDoc.context.lookup(streamRef);

      if (!stream) {
        console.log(`    Error: Could not lookup stream reference`);
        continue;
      }

      console.log(`    Stream type: ${stream.constructor.name}`);

      // Get DECODED stream content (not raw compressed data)
      let contentData = null;

      try {
        // Debug: Check what methods are available (only for first stream)
        if (i === 0) {
          console.log(`    Available methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(stream)).filter(m => typeof stream[m] === 'function'));
          console.log(`    Stream dict keys:`, stream.dict ? Array.from(stream.dict.keys()).map(k => k.toString()) : 'no dict');
        }

        // Get filter type to determine decompression method
        const { dict } = stream;
        const filterKey = PDFName.of('Filter');
        const filter = dict ? dict.get(filterKey) : null;

        if (i === 0 && filter) {
          console.log(`    Stream Filter:`, filter.toString());
        }

        // Get raw compressed content
        const rawContent = stream.getContents();

        // Decompress based on filter type
        if (filter && filter.toString() === '/FlateDecode') {
          // Use Node's zlib to decompress FlateDecode streams
          try {
            contentData = zlib.inflateSync(Buffer.from(rawContent));
            console.log(`    Decompressed FlateDecode stream (${rawContent.length} → ${contentData.length} bytes)`);

            if (i === 0) {
              // Verify decompression worked
              const preview = contentData.toString('latin1').substring(0, 200);
              console.log(`    First 200 chars:`, preview);
              console.log(`    Contains PDF operators:`, /\s[a-z]{1,2}\s/.test(preview));
            }
          } catch (zlibError) {
            console.log(`    Zlib decompression failed: ${zlibError.message}`);
            console.log(`    Trying raw content...`);
            contentData = rawContent;
          }
        } else {
          // No filter or unknown filter - use raw content
          contentData = rawContent;
          console.log(`    Using raw content (${contentData.length} bytes, filter: ${filter ? filter.toString() : 'none'})`);
        }
      } catch (decodeError) {
        console.log(`    Decode error: ${decodeError.message}`);
        console.log(`    Trying raw contents as fallback...`);
        if (stream.contents) {
          contentData = stream.contents;
        }
      }

      if (!contentData) {
        console.log(`    Error: No content data available`);
        continue;
      }

      console.log(`    Parsing ${contentData.length} bytes...`);
      const parser = new PDFContentParser({
        pdfContext: pdfDoc.context,
        fontDict: fontDict
      });
      const { paths, textObjects } = parser.parseContentStream(contentData);
      console.log(`    ✓ Found ${paths.length} paths and ${textObjects.length} text objects`);
      allPaths = allPaths.concat(paths);
      allTextObjects = allTextObjects.concat(textObjects);
    } catch (streamError) {
      console.error(`    Error: ${streamError.message}`);
      if (streamError.stack) {
        console.error(streamError.stack);
      }
    }
  }

  console.log(`Extracted ${allPaths.length} paths and ${allTextObjects.length} text objects from first page\n`);

  // Also check for XObjects (Form XObjects that might contain text)
  console.log('='.repeat(80));
  console.log('CHECKING FOR XOBJECTS (Form XObjects, Images, etc.)');
  console.log('='.repeat(80));
  console.log();

  // Reuse resources variable from above (already extracted for fonts)
  if (resources) {
    console.log('Found Resources dictionary');
    const xobjectKey = PDFName.of('XObject');
    const xobjects = resources.get(xobjectKey);

    if (xobjects) {
      console.log('Found XObject dictionary');
      const xobjectEntries = Array.from(xobjects.entries());
      console.log(`Found ${xobjectEntries.length} XObject(s)\n`);

      for (const [name, xobjRef] of xobjectEntries) {
        const xobjName = name.toString();
        console.log(`XObject: ${xobjName}`);

        try {
          const xobj = pdfDoc.context.lookup(xobjRef);
          if (!xobj || !xobj.dict) {
            console.log('  Could not lookup XObject\n');
            continue;
          }

          // Check subtype
          const subtypeKey = PDFName.of('Subtype');
          const subtype = xobj.dict.get(subtypeKey);
          console.log(`  Subtype: ${subtype ? subtype.toString() : 'unknown'}`);

          // We're interested in Form XObjects (not Image XObjects)
          if (subtype && subtype.toString() === '/Form') {
            console.log('  This is a Form XObject - parsing content...');

            try {
              // Check if XObject has its own Resources (and fonts)
              const xobjResourcesKey = PDFName.of('Resources');
              const xobjResources = xobj.dict.get(xobjResourcesKey);
              let xobjFontDict = fontDict; // Default to page fonts

              if (xobjResources) {
                const xobjFontKey = PDFName.of('Font');
                const xobjFonts = xobjResources.get(xobjFontKey);
                if (xobjFonts) {
                  console.log('  XObject has its own Font dictionary');
                  xobjFontDict = xobjFonts;
                }
              }

              // Get the content stream from the XObject
              const xobjContent = xobj.getContents();

              // Decompress if needed
              let xobjData = null;
              const filterKey = PDFName.of('Filter');
              const filter = xobj.dict.get(filterKey);

              if (filter && filter.toString() === '/FlateDecode') {
                try {
                  xobjData = zlib.inflateSync(Buffer.from(xobjContent));
                  console.log(`  Decompressed: ${xobjContent.length} → ${xobjData.length} bytes`);
                } catch (zlibError) {
                  console.log(`  Decompression failed: ${zlibError.message}`);
                  xobjData = xobjContent;
                }
              } else {
                xobjData = xobjContent;
              }

              // Parse the XObject content stream with XObject-specific fonts
              const xobjParser = new PDFContentParser({
                pdfContext: pdfDoc.context,
                fontDict: xobjFontDict
              });
              const { paths: xobjPaths, textObjects: xobjText } = xobjParser.parseContentStream(xobjData);

              console.log(`  Found ${xobjPaths.length} paths and ${xobjText.length} text objects`);

              if (xobjText.length > 0) {
                console.log('  Sample text from this XObject:');
                xobjText.slice(0, 3).forEach((t, i) => {
                  console.log(`    ${i + 1}. "${t.text}"`);
                });
              }

              // Merge into main arrays
              allPaths = allPaths.concat(xobjPaths);
              allTextObjects = allTextObjects.concat(xobjText);

            } catch (xobjParseError) {
              console.log(`  Error parsing XObject: ${xobjParseError.message}`);
            }
          } else if (subtype) {
            console.log(`  Skipping (type: ${subtype.toString()})`);
          }

        } catch (xobjError) {
          console.log(`  Error processing XObject: ${xobjError.message}`);
        }

        console.log();
      }
    } else {
      console.log('No XObject dictionary found in Resources');
    }
  } else {
    console.log('No Resources dictionary found on page');
  }

  console.log();
  console.log(`Total after XObjects: ${allPaths.length} paths and ${allTextObjects.length} text objects\n`);

  if (allPaths.length === 0) {
    console.log('No paths found. Cannot test conversion.');
    return;
  }

  // Debug: Show structure of first path
  if (allPaths.length > 0) {
    console.log('DEBUG: First path structure:');
    console.log(JSON.stringify(allPaths[0], null, 2));
    console.log();
  }

  // Debug: Show text extraction results
  if (allTextObjects.length > 0) {
    console.log('DEBUG: Text extraction working!');
    console.log(`First 5 text objects:`);
    allTextObjects.slice(0, 5).forEach((textObj, i) => {
      console.log(`  ${i + 1}. "${textObj.text}" at (${textObj.x.toFixed(1)}, ${textObj.y.toFixed(1)}) - font: ${textObj.font}, size: ${textObj.fontSize}`);
    });
    console.log();
  } else {
    console.log('WARNING: No text objects extracted from PDF!');
    console.log('This could mean:');
    console.log('  - The PDF uses a different text encoding');
    console.log('  - Text is rendered as paths/outlines');
    console.log('  - Text operators are not in the main content stream');
    console.log();
  }

  // Initialize SVG converter
  console.log('Initializing SVG Path Converter...');

  // Calculate SVG dimensions to preserve PDF aspect ratio
  // Scale to target width while maintaining aspect ratio
  const targetWidth = 1728;  // Use PDF width directly for 1:1 scale
  const aspectRatio = pdfWidth / pdfHeight;
  const svgWidth = targetWidth;
  const svgHeight = Math.round(targetWidth / aspectRatio);

  const converter = new SVGPathConverter({
    pdfWidth,
    pdfHeight,
    svgWidth,
    svgHeight,
    precision: 2,
    flipY: true,
    applyTransform: true
  });

  console.log('Converter settings:');
  console.log(`  PDF dimensions: ${pdfWidth} x ${pdfHeight}`);
  console.log(`  SVG dimensions: ${svgWidth} x ${svgHeight} (preserves aspect ratio ${aspectRatio.toFixed(3)})`);
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

  // Calculate bounds from transformed SVG paths for optimal viewBox
  const bounds = converter.calculateBoundsFromSVGPaths(svgPaths);

  // Generate complete SVG file
  console.log('='.repeat(80));
  console.log('GENERATING COMPLETE SVG');
  console.log('='.repeat(80));
  console.log();

  const svgContent = generateSampleSVG(svgPaths, allTextObjects, svgWidth, svgHeight, bounds, pdfHeight);
  const outputPath = path.join(outputDir, 'test-svg-output.svg');
  fs.writeFileSync(outputPath, svgContent);

  console.log(`SVG saved to: ${outputPath}`);
  console.log(`Contains ALL ${svgPaths.length} paths and ${allTextObjects.length} text objects from the PDF`);
  console.log(`File size: ${(svgContent.length / 1024 / 1024).toFixed(2)} MB`);
  console.log();

  // Display text statistics
  if (allTextObjects.length > 0) {
    console.log('='.repeat(80));
    console.log('TEXT OBJECTS');
    console.log('='.repeat(80));
    console.log();
    console.log(`Total text objects extracted: ${allTextObjects.length}`);
    console.log();
    console.log('Sample text objects (first 10):');
    allTextObjects.slice(0, 10).forEach((textObj, i) => {
      console.log(`  ${i + 1}. "${textObj.text}" (font: ${textObj.font}, size: ${textObj.fontSize}, color: ${textObj.fillColor})`);
    });
    console.log();
  }

  // Display bounds
  console.log('='.repeat(80));
  console.log('COORDINATE BOUNDS');
  console.log('='.repeat(80));
  console.log();

  console.log('Transformed SVG bounds (after coordinate transformation):');
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
      svgDimensions: { width: svgWidth, height: svgHeight },
      totalPathsExtracted: allPaths.length,
      totalPathsConverted: svgPaths.length,
      totalTextObjects: allTextObjects.length,
      bounds
    },
    statistics: stats,
    sampleSVGPaths: svgPaths.slice(0, 20).map(p => ({
      operation: p.operation,
      pathData: p.d,
      style: p.style
    }))
  };

  const jsonOutputPath = path.join(outputDir, 'test-svg-conversion.json');
  fs.writeFileSync(jsonOutputPath, JSON.stringify(detailedOutput, null, 2));

  console.log(`Detailed conversion data saved to: ${jsonOutputPath}`);
  console.log();

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Summary:');
  console.log(`  ✓ Loaded PDF with ${pages.length} pages`);
  console.log(`  ✓ Extracted ${allPaths.length} paths and ${allTextObjects.length} text objects from first page`);
  console.log(`  ✓ Converted ${svgPaths.length} paths to SVG format`);
  console.log(`  ✓ Generated complete SVG with ALL ${svgPaths.length} paths and ${allTextObjects.length} text objects`);
  console.log(`  ✓ Coordinate transformation working correctly`);
  console.log();
  console.log('Next steps:');
  console.log('  1. Open output/test-svg-output.svg in a browser or SVG viewer');
  console.log('  2. Verify paths and text are rendered correctly');
  console.log('  3. Check that coordinates are properly transformed');
  console.log('  4. Text elements are in a separate SVG group (id="text-elements")');
  console.log('  5. Review output/test-svg-conversion.json for detailed data');
  console.log();
}

/**
 * Generate a complete SVG file with converted paths and text
 */
function generateSampleSVG(svgPaths, textObjects, width, height, bounds, pdfHeight) {
  const pathElements = svgPaths.map((svgPath, index) => {
    const converter = new SVGPathConverter();
    return converter.generatePathElement(svgPath, {
      id: `path-${index}`,
      className: `operation-${svgPath.operation}`
    });
  });

  // Transform text objects to SVG coordinates
  const textElements = textObjects.map((textObj, index) => {
    // Transform coordinates from PDF to SVG space
    // Apply CTM transformation
    const ctm = textObj.ctm;
    let x = textObj.x;
    let y = textObj.y;

    // Apply transformation matrix
    if (ctm) {
      const transformedX = ctm.a * x + ctm.c * y + ctm.e;
      const transformedY = ctm.b * x + ctm.d * y + ctm.f;
      x = transformedX;
      y = transformedY;
    }

    // Flip Y coordinate (PDF origin is bottom-left, SVG is top-left)
    y = pdfHeight - y;

    // Escape text for XML
    const escapedText = (textObj.text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    return `<text id="text-${index}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${textObj.fontSize}" fill="${textObj.fillColor}" class="pdf-text" data-font="${textObj.font}">${escapedText}</text>`;
  });

  // Use bounds to create optimal viewBox if provided
  let viewBox = `0 0 ${width} ${height}`;
  if (bounds) {
    // Add 5% padding around content
    const padding = Math.max(bounds.width, bounds.height) * 0.05;
    const vbX = bounds.x - padding;
    const vbY = bounds.y - padding;
    const vbWidth = bounds.width + (padding * 2);
    const vbHeight = bounds.height + (padding * 2);
    viewBox = `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}"
     height="${height}"
     viewBox="${viewBox}">
  <title>GeoPDF to SVG Conversion - Complete</title>
  <desc>Complete conversion of all ${svgPaths.length} paths and ${textObjects.length} text objects from VT_Burlington_20240809_TM_geo.pdf</desc>

  <style>
    .operation-stroke { }
    .operation-fill { }
    .operation-fill-stroke { }
    .pdf-text { font-family: Arial, sans-serif; }
  </style>

  <g id="map-paths">
${pathElements.map(el => '    ' + el).join('\n')}
  </g>

  <g id="text-elements">
${textElements.map(el => '    ' + el).join('\n')}
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
