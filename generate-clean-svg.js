/**
 * Generate Clean SVG - Paths Only, No Text
 *
 * This script processes GeoPDF files and outputs clean SVG with:
 * - Vector paths organized by color
 * - NO text elements (all text stripped)
 * - Optimized file size
 *
 * Usage: node generate-clean-svg.js <input-pdf> <output-svg>
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument, PDFName } = require('pdf-lib');
const PDFContentParser = require('./src/pdf-content-parser');
const SVGPathConverter = require('./src/svg-path-converter');

async function generateCleanSVG(inputPath, outputPath) {
  console.log('='.repeat(80));
  console.log('CLEAN SVG GENERATOR - PATHS ONLY (NO TEXT)');
  console.log('='.repeat(80));
  console.log();
  console.log(`Input:  ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log();

  // Load PDF
  console.log('Loading PDF...');
  const pdfBuffer = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  console.log(`  PDF has ${pages.length} page(s)`);

  // Extract paths from first page only
  const firstPage = pages[0];
  const { width: pdfWidth, height: pdfHeight } = firstPage.getSize();
  console.log(`  Page dimensions: ${pdfWidth.toFixed(2)} x ${pdfHeight.toFixed(2)} points`);
  console.log();

  // Get content streams
  const pageDict = firstPage.node.dict;
  const contentsKey = PDFName.of('Contents');
  const contents = pageDict.get(contentsKey);

  if (!contents) {
    throw new Error('No content stream found on first page');
  }

  // Handle array of streams
  let streamRefs = [];
  if (contents.constructor.name === 'PDFArray') {
    streamRefs = contents.array;
  } else if (Array.isArray(contents)) {
    streamRefs = contents;
  } else {
    streamRefs = [contents];
  }

  // Extract font resources for text detection (so we can skip it)
  const resourcesKey = PDFName.of('Resources');
  const resources = pageDict.get(resourcesKey);
  let fontDict = null;
  if (resources) {
    const fontKey = PDFName.of('Font');
    fontDict = resources.get(fontKey);
  }

  // Parse paths (ignore text)
  console.log('Extracting vector paths...');
  let allPaths = [];

  for (let i = 0; i < streamRefs.length; i++) {
    try {
      const streamRef = streamRefs[i];
      const stream = pdfDoc.context.lookup(streamRef);
      if (!stream) continue;

      // Get decoded content
      let contentData = null;
      try {
        const { dict } = stream;
        const filterKey = PDFName.of('Filter');
        const filter = dict ? dict.get(filterKey) : null;
        const rawContent = stream.getContents();

        if (filter && filter.toString() === '/FlateDecode') {
          try {
            contentData = zlib.inflateSync(Buffer.from(rawContent));
          } catch (zlibError) {
            contentData = rawContent;
          }
        } else {
          contentData = rawContent;
        }
      } catch (decodeError) {
        if (stream.contents) {
          contentData = stream.contents;
        }
      }

      if (!contentData) continue;

      // Parse content stream - extract paths only
      const parser = new PDFContentParser({
        pdfContext: pdfDoc.context,
        fontDict: fontDict
      });
      const { paths } = parser.parseContentStream(contentData);
      allPaths = allPaths.concat(paths);
    } catch (streamError) {
      // Silent
    }
  }

  // Also check XObjects for additional paths
  if (resources) {
    const xobjectKey = PDFName.of('XObject');
    const xobjects = resources.get(xobjectKey);

    if (xobjects) {
      const xobjectEntries = Array.from(xobjects.entries());

      for (const [name, xobjRef] of xobjectEntries) {
        try {
          const xobj = pdfDoc.context.lookup(xobjRef);
          if (!xobj || !xobj.dict) continue;

          // Check subtype - only process Form XObjects
          const subtypeKey = PDFName.of('Subtype');
          const subtype = xobj.dict.get(subtypeKey);

          if (subtype && subtype.toString() === '/Form') {
            // Get XObject resources
            const xobjResourcesKey = PDFName.of('Resources');
            const xobjResources = xobj.dict.get(xobjResourcesKey);
            let xobjFontDict = fontDict;

            if (xobjResources) {
              const xobjFontKey = PDFName.of('Font');
              const xobjFonts = xobjResources.get(xobjFontKey);
              if (xobjFonts) {
                xobjFontDict = xobjFonts;
              }
            }

            // Get content
            const xobjContent = xobj.getContents();
            let xobjData = null;
            const filterKey = PDFName.of('Filter');
            const filter = xobj.dict.get(filterKey);

            if (filter && filter.toString() === '/FlateDecode') {
              try {
                xobjData = zlib.inflateSync(Buffer.from(xobjContent));
              } catch (zlibError) {
                xobjData = xobjContent;
              }
            } else {
              xobjData = xobjContent;
            }

            // Parse XObject content
            const xobjParser = new PDFContentParser({
              pdfContext: pdfDoc.context,
              fontDict: xobjFontDict
            });
            const { paths: xobjPaths } = xobjParser.parseContentStream(xobjData);
            allPaths = allPaths.concat(xobjPaths);
          }
        } catch (xobjError) {
          // Silent
        }
      }
    }
  }

  console.log(`  Extracted ${allPaths.length} vector paths`);
  console.log();

  // Initialize SVG converter
  console.log('Converting to SVG format...');
  const targetWidth = 1728;
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

  const svgPaths = converter.convertPaths(allPaths);
  console.log(`  Converted ${svgPaths.length} paths to SVG format`);
  console.log();

  // Organize paths by color
  console.log('Organizing paths by color...');
  const pathsByColor = {};
  svgPaths.forEach(svgPath => {
    const fillColor = svgPath.style.fill || 'none';
    if (!pathsByColor[fillColor]) {
      pathsByColor[fillColor] = [];
    }
    pathsByColor[fillColor].push(svgPath);
  });

  const colorGroups = Object.keys(pathsByColor);
  console.log(`  Found ${colorGroups.length} color groups:`);
  colorGroups.forEach(color => {
    console.log(`    ${color}: ${pathsByColor[color].length} paths`);
  });
  console.log();

  // Calculate bounds
  const bounds = converter.calculateBoundsFromSVGPaths(svgPaths);

  // Generate clean SVG (PATHS ONLY, NO TEXT)
  console.log('Generating clean SVG (paths only, no text)...');
  const svgContent = buildCleanSVG(svgPaths, pathsByColor, svgWidth, svgHeight, bounds);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, svgContent);
  console.log(`  Saved to: ${outputPath}`);
  console.log(`  File size: ${(svgContent.length / 1024 / 1024).toFixed(2)} MB`);
  console.log();

  console.log('='.repeat(80));
  console.log('COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Summary:');
  console.log(`  ✓ Extracted ${allPaths.length} vector paths from PDF`);
  console.log(`  ✓ Converted ${svgPaths.length} paths to SVG`);
  console.log(`  ✓ Organized into ${colorGroups.length} color groups`);
  console.log(`  ✓ Generated clean SVG with NO TEXT`);
  console.log();
}

/**
 * Build clean SVG with paths only (no text)
 */
function buildCleanSVG(svgPaths, pathsByColor, width, height, bounds) {
  const converter = new SVGPathConverter();

  // Generate viewBox with padding
  let viewBox = `0 0 ${width} ${height}`;
  if (bounds) {
    const padding = Math.max(bounds.width, bounds.height) * 0.05;
    const vbX = bounds.x - padding;
    const vbY = bounds.y - padding;
    const vbWidth = bounds.width + (padding * 2);
    const vbHeight = bounds.height + (padding * 2);
    viewBox = `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbWidth.toFixed(2)} ${vbHeight.toFixed(2)}`;
  }

  // Build color groups
  const colorGroupElements = [];
  const colorGroups = Object.keys(pathsByColor).sort();

  colorGroups.forEach((color, groupIndex) => {
    const paths = pathsByColor[color];
    const groupId = color === 'none' ? 'strokes' : `fill-${color.replace('#', '')}`;

    const pathElements = paths.map((svgPath, index) => {
      return '    ' + converter.generatePathElement(svgPath, {
        id: `${groupId}-${index}`,
        className: `color-${color.replace('#', '')}`
      });
    }).join('\n');

    colorGroupElements.push(
      `  <g id="${groupId}" data-color="${color}">\n${pathElements}\n  </g>`
    );
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="${viewBox}">
  <title>GeoPDF Vector Paths - Clean Export</title>
  <desc>Extracted ${svgPaths.length} vector paths organized by color. No text elements.</desc>

  <style>
    /* Paths organized by color groups */
    [id^="fill-"] { }
    #strokes { }
  </style>

${colorGroupElements.join('\n')}
</svg>`;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node generate-clean-svg.js <input-pdf> <output-svg>');
    console.error('');
    console.error('Example:');
    console.error('  node generate-clean-svg.js samples/VT_Burlington_20240809_TM_geo.pdf output/clean-map.svg');
    process.exit(1);
  }

  const inputPath = args[0];
  const outputPath = args[1];

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  generateCleanSVG(inputPath, outputPath)
    .then(() => {
      console.log('Success!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { generateCleanSVG };
