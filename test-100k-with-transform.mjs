/**
 * Test 100K format processing with transformCoordsDuringParsing enabled
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';
import PDFContentParser from './src/pdf-content-parser.js';

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function test100KWithTransform() {
  console.log('='.repeat(70));
  console.log('TESTING 100K WITH transformCoordsDuringParsing=true');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH_100K);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;
  const { width, height } = page.getSize();

  console.log(`\nPage dimensions: ${width} x ${height} pts`);

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjectDict = resources?.get(PDFName.of('XObject'));
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

  // Get the Form XObject Fm0
  const xobjects = context.lookup(xobjectDict);
  const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];

  for (const [name, ref] of entries) {
    const xobject = context.lookup(ref);
    const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
    if (subtype !== '/Form') continue;

    console.log(`\n--- PARSING FORM XOBJECT: ${name.toString()} with transform enabled ---`);

    // Get XObject content
    let xoContent;
    try {
      let xoRawData = xobject.getContents();
      const xoFilter = xobject.dict?.get(PDFName.of('Filter'));
      if (xoFilter?.toString() === '/FlateDecode') {
        xoRawData = zlib.inflateSync(Buffer.from(xoRawData));
      }
      xoContent = xoRawData;
    } catch (e) {
      console.log(`Error reading XObject content: ${e.message}`);
      continue;
    }

    // Parse with PDFContentParser - WITH transformCoordsDuringParsing enabled
    const parser = new PDFContentParser({
      layerMap: mcToLayerMap,
      pdfContext: context,
      fontDict: fontDict,
      resourcesDict: resources,
      transformCoordsDuringParsing: true  // KEY: Enable coordinate transform during parsing
    });

    const { paths } = parser.parseContentStream(xoContent);

    console.log(`Total paths parsed: ${paths.length}`);

    // Analyze first 10 paths
    console.log('\n--- FIRST 10 PATHS (coordinates should be in page space now) ---');
    for (let i = 0; i < Math.min(10, paths.length); i++) {
      const path = paths[i];
      console.log(`\nPath ${i}:`);
      console.log(`  Transform: a=${path.transform.a}, d=${path.transform.d} (should be identity)`);
      console.log(`  Layer: ${path.layer || 'none'}`);
      console.log(`  Operation: ${path.operation}`);

      // Show first subpath's first point - these should now be in page space
      if (path.subpaths && path.subpaths[0]) {
        const sp = path.subpaths[0];
        console.log(`  Start point: (${sp.startPoint?.x?.toFixed(2)}, ${sp.startPoint?.y?.toFixed(2)})`);
      }
    }

    // Find coordinate range of paths - should fit within page bounds now
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const path of paths) {
      for (const sp of path.subpaths || []) {
        const points = [sp.startPoint, ...sp.segments.map(s => s.point)].filter(Boolean);
        for (const pt of points) {
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minY = Math.min(minY, pt.y);
          maxY = Math.max(maxY, pt.y);
        }
      }
    }

    console.log('\n--- COORDINATE RANGES (should fit page bounds) ---');
    console.log(`X range: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
    console.log(`Y range: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);
    console.log(`\nPage bounds: 0 to ${width} (X), 0 to ${height} (Y)`);

    // Check if coordinates fit within expected bounds
    const xFits = minX >= -50 && maxX <= width + 50;
    const yFits = minY >= -height - 50 && maxY <= height + 50;

    console.log(`\n--- FIT CHECK ---`);
    console.log(`X fits within page bounds: ${xFits ? 'YES' : 'NO'}`);
    console.log(`Y fits within page bounds (considering negative coords): ${yFits ? 'YES' : 'NO'}`);

    if (xFits && yFits) {
      console.log('\n*** SUCCESS: Coordinates are in page space! ***');
    } else {
      console.log('\n*** PROBLEM: Coordinates exceed page bounds ***');
    }
  }
}

test100KWithTransform().catch(console.error);
