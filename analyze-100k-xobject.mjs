/**
 * Deep analysis of the 100K Form XObject structure
 * Investigate why the map displays "too small"
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';
const PDF_PATH_75K = './samples/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeXObject(pdfPath, label) {
  console.log('\n' + '='.repeat(70));
  console.log(`ANALYZING: ${label}`);
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;
  const { width, height } = page.getSize();

  console.log(`\nPage dimensions: ${width} x ${height} pts`);

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjectDict = resources?.get(PDFName.of('XObject'));

  if (!xobjectDict) {
    console.log('No XObject dictionary found');
    return;
  }

  const xobjects = context.lookup(xobjectDict);
  const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];

  console.log(`\nXObjects found: ${entries.length}`);

  // Get main content stream to see how XObjects are invoked
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];
  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  // Parse first content stream to see CTM before Do operator
  const streamRef = contentStreams[0];
  const stream = context.lookup(streamRef);
  let rawData = stream.getContents();
  const filter = stream.dict?.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') {
    rawData = zlib.inflateSync(Buffer.from(rawData));
  }
  const mainContent = rawData.toString('latin1');

  console.log('\n--- MAIN CONTENT STREAM (first 2000 chars) ---');
  console.log(mainContent.substring(0, 2000));

  // Analyze each Form XObject
  for (const [name, ref] of entries) {
    const xobject = context.lookup(ref);
    const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
    if (subtype !== '/Form') continue;

    console.log(`\n--- FORM XOBJECT: ${name.toString()} ---`);

    // Get Matrix
    const matrix = xobject.dict?.get(PDFName.of('Matrix'));
    if (matrix?.array) {
      const m = matrix.array.map(n => {
        if (typeof n.numberValue === 'function') return n.numberValue();
        return n.value !== undefined ? n.value : parseFloat(n.toString());
      });
      console.log(`Matrix: [${m.join(', ')}]`);
      console.log(`  Scale X: ${m[0]}, Scale Y: ${m[3]}`);
      console.log(`  Translate X: ${m[4]}, Translate Y: ${m[5]}`);
    } else {
      console.log('Matrix: identity (not specified)');
    }

    // Get BBox
    const bbox = xobject.dict?.get(PDFName.of('BBox'));
    if (bbox?.array) {
      const b = bbox.array.map(n => {
        if (typeof n.numberValue === 'function') return n.numberValue();
        return n.value !== undefined ? n.value : parseFloat(n.toString());
      });
      console.log(`BBox: [${b.join(', ')}]`);
      console.log(`  Width: ${b[2] - b[0]}, Height: ${b[3] - b[1]}`);
    }

    // Get XObject content
    let xoContent = '';
    try {
      let xoRawData = xobject.getContents();
      const xoFilter = xobject.dict?.get(PDFName.of('Filter'));
      if (xoFilter?.toString() === '/FlateDecode') {
        xoRawData = zlib.inflateSync(Buffer.from(xoRawData));
      }
      xoContent = xoRawData.toString('latin1');
    } catch (e) {
      console.log(`Error reading XObject content: ${e.message}`);
      continue;
    }

    // Analyze coordinate ranges in XObject
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let pathCount = 0;
    let colorOps = 0;

    const lines = xoContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Track coordinates
      const moveMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+m$/);
      const lineMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+l$/);
      const curveMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+c$/);

      if (moveMatch || lineMatch) {
        const x = parseFloat((moveMatch || lineMatch)[1]);
        const y = parseFloat((moveMatch || lineMatch)[2]);
        if (isFinite(x) && isFinite(y)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }

      if (curveMatch) {
        [3, 5].forEach(idx => {
          const x = parseFloat(curveMatch[idx]);
          const y = parseFloat(curveMatch[idx + 1]);
          if (isFinite(x) && isFinite(y)) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        });
      }

      // Count paths
      if (trimmed === 'S' || trimmed === 's' || trimmed === 'f' || trimmed === 'F' ||
          trimmed === 'f*' || trimmed === 'B' || trimmed === 'B*') {
        pathCount++;
      }

      // Count color operators
      if (trimmed.match(/\s+(RG|rg|G|g|K|k)$/)) {
        colorOps++;
      }
    }

    console.log(`\nCoordinate range analysis (from path data):`);
    console.log(`  X: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (range: ${(maxX - minX).toFixed(2)})`);
    console.log(`  Y: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (range: ${(maxY - minY).toFixed(2)})`);
    console.log(`  Total paths: ${pathCount}`);
    console.log(`  Color operators: ${colorOps}`);

    // Show first 50 lines of XObject content
    console.log('\n--- XOBJECT CONTENT (first 100 lines) ---');
    const xoLines = xoContent.split('\n').slice(0, 100);
    for (const line of xoLines) {
      console.log(line);
    }
  }
}

async function main() {
  await analyzeXObject(PDF_PATH_75K, '7.5-MINUTE QUAD - Jay Peak');
  await analyzeXObject(PDF_PATH_100K, '100K MAP - NY');
}

main().catch(console.error);
