/**
 * Test what transforms are being applied to 100K paths
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';
import PDFContentParser from './src/pdf-content-parser.js';

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function test100KTransforms() {
  console.log('='.repeat(70));
  console.log('TESTING 100K PATH TRANSFORMS');
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

    console.log(`\n--- PARSING FORM XOBJECT: ${name.toString()} ---`);

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

    // Parse with PDFContentParser
    const parser = new PDFContentParser({
      layerMap: mcToLayerMap,
      pdfContext: context,
      fontDict: fontDict,
      resourcesDict: resources
    });

    const { paths } = parser.parseContentStream(xoContent);

    console.log(`Total paths parsed: ${paths.length}`);

    // Analyze first 10 paths
    console.log('\n--- FIRST 10 PATHS ---');
    for (let i = 0; i < Math.min(10, paths.length); i++) {
      const path = paths[i];
      console.log(`\nPath ${i}:`);
      console.log(`  Transform (CTM): a=${path.transform.a}, b=${path.transform.b}, c=${path.transform.c}, d=${path.transform.d}, e=${path.transform.e}, f=${path.transform.f}`);
      console.log(`  Layer: ${path.layer || 'none'}`);
      console.log(`  Operation: ${path.operation}`);

      // Show first subpath's first point
      if (path.subpaths && path.subpaths[0]) {
        const sp = path.subpaths[0];
        console.log(`  Start point (raw): (${sp.startPoint?.x?.toFixed(2)}, ${sp.startPoint?.y?.toFixed(2)})`);

        // Apply transform manually
        if (path.transform && sp.startPoint) {
          const tx = path.transform.a * sp.startPoint.x + path.transform.c * sp.startPoint.y + path.transform.e;
          const ty = path.transform.b * sp.startPoint.x + path.transform.d * sp.startPoint.y + path.transform.f;
          console.log(`  Start point (transformed): (${tx.toFixed(2)}, ${ty.toFixed(2)})`);
          console.log(`  Start point (y-flipped): (${tx.toFixed(2)}, ${(-ty).toFixed(2)})`);
        }
      }
    }

    // Find coordinate range of raw and transformed points
    let rawMinX = Infinity, rawMaxX = -Infinity;
    let rawMinY = Infinity, rawMaxY = -Infinity;
    let txMinX = Infinity, txMaxX = -Infinity;
    let txMinY = Infinity, txMaxY = -Infinity;

    for (const path of paths) {
      for (const sp of path.subpaths || []) {
        const points = [sp.startPoint, ...sp.segments.map(s => s.point)].filter(Boolean);
        for (const pt of points) {
          // Raw
          rawMinX = Math.min(rawMinX, pt.x);
          rawMaxX = Math.max(rawMaxX, pt.x);
          rawMinY = Math.min(rawMinY, pt.y);
          rawMaxY = Math.max(rawMaxY, pt.y);

          // Transformed
          if (path.transform) {
            const tx = path.transform.a * pt.x + path.transform.c * pt.y + path.transform.e;
            const ty = path.transform.b * pt.x + path.transform.d * pt.y + path.transform.f;
            txMinX = Math.min(txMinX, tx);
            txMaxX = Math.max(txMaxX, tx);
            txMinY = Math.min(txMinY, ty);
            txMaxY = Math.max(txMaxY, ty);
          }
        }
      }
    }

    console.log('\n--- COORDINATE RANGES ---');
    console.log('Raw coordinates:');
    console.log(`  X: ${rawMinX.toFixed(2)} to ${rawMaxX.toFixed(2)} (span: ${(rawMaxX - rawMinX).toFixed(2)})`);
    console.log(`  Y: ${rawMinY.toFixed(2)} to ${rawMaxY.toFixed(2)} (span: ${(rawMaxY - rawMinY).toFixed(2)})`);

    console.log('\nTransformed coordinates:');
    console.log(`  X: ${txMinX.toFixed(2)} to ${txMaxX.toFixed(2)} (span: ${(txMaxX - txMinX).toFixed(2)})`);
    console.log(`  Y: ${txMinY.toFixed(2)} to ${txMaxY.toFixed(2)} (span: ${(txMaxY - txMinY).toFixed(2)})`);

    console.log('\nY-flipped (final):');
    console.log(`  X: ${txMinX.toFixed(2)} to ${txMaxX.toFixed(2)}`);
    console.log(`  Y: ${(-txMaxY).toFixed(2)} to ${(-txMinY).toFixed(2)}`);

    console.log('\n--- EXPECTED PAGE BOUNDS ---');
    console.log(`Page: 0 to ${width} (X), 0 to ${height} (Y)`);
  }
}

test100KTransforms().catch(console.error);
