/**
 * Test that color state is properly carried over between content streams
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function testColorCarryover() {
  console.log('='.repeat(70));
  console.log('TESTING COLOR STATE CARRYOVER BETWEEN STREAMS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];
  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  console.log(`Total content streams: ${contentStreams.length}`);

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));
  const properties = resources?.get(PDFName.of('Properties'));

  // Build layer map
  const mcToLayerMap = {};
  if (properties) {
    const propDict = context.lookup(properties);
    if (propDict) {
      const entries = propDict.entries ? Array.from(propDict.entries()) : [];
      for (const [key, value] of entries) {
        mcToLayerMap[key.toString()] = key.toString();
      }
    }
  }

  // Track graphics state carryover like pdf-processor does
  let carryOverGraphicsState = null;
  let totalPaths = 0;
  let pathsWithColor = 0;
  let pathsWithoutColor = 0;

  for (let streamIdx = 0; streamIdx < contentStreams.length; streamIdx++) {
    const streamRef = contentStreams[streamIdx];
    const stream = context.lookup(streamRef);

    if (!stream) continue;

    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }

    // Parse with carryover state
    const parser = new PDFContentParser({
      layerMap: mcToLayerMap,
      pdfContext: context,
      fontDict: fontDict,
      resourcesDict: resources,
      globalLayerNames: {},
      initialGraphicsState: carryOverGraphicsState
    });

    const { paths, endingGraphicsState } = parser.parseContentStream(rawData);

    // Count paths with/without color
    let streamWithColor = 0;
    let streamWithoutColor = 0;
    for (const path of paths) {
      if (path.style && (path.style.stroke || path.style.fill)) {
        // Check if color is not default black
        const hasRealStroke = path.style.stroke && path.style.stroke !== '#000000';
        const hasRealFill = path.style.fill && path.style.fill !== '#000000';
        if (hasRealStroke || hasRealFill) {
          streamWithColor++;
        } else {
          // Black is also a valid color, just check if it's set
          if (path.style.stroke || path.style.fill) {
            streamWithColor++;
          } else {
            streamWithoutColor++;
          }
        }
      } else {
        streamWithoutColor++;
      }
    }

    totalPaths += paths.length;
    pathsWithColor += streamWithColor;
    pathsWithoutColor += streamWithoutColor;

    console.log(`\nStream ${streamIdx}:`);
    console.log(`  Paths: ${paths.length}`);
    console.log(`  Starting state: stroke=${carryOverGraphicsState?.strokeColor || 'default'}, fill=${carryOverGraphicsState?.fillColor || 'default'}`);
    console.log(`  Ending state: stroke=${endingGraphicsState?.strokeColor}, fill=${endingGraphicsState?.fillColor}`);
    console.log(`  With color: ${streamWithColor}, Without: ${streamWithoutColor}`);

    // Update carryover for next stream
    if (endingGraphicsState) {
      carryOverGraphicsState = endingGraphicsState;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total paths: ${totalPaths}`);
  console.log(`Paths with color: ${pathsWithColor}`);
  console.log(`Paths without color: ${pathsWithoutColor}`);
  console.log(`\nExpected: All paths should have color (stroke or fill set)`);
  console.log(`Previously: ~1000 paths had no color because state wasn't carried over`);
}

testColorCarryover().catch(console.error);
