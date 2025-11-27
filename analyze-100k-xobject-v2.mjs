/**
 * Deep analysis of 100K Form XObject - v2 with better BBox extraction
 */

import fs from 'fs';
import { PDFDocument, PDFName, PDFArray, PDFNumber } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function analyze100K() {
  console.log('='.repeat(70));
  console.log('100K MAP COORDINATE ANALYSIS');
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
  const xobjects = context.lookup(xobjectDict);
  const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];

  // Find Fm0
  for (const [name, ref] of entries) {
    const xobject = context.lookup(ref);
    const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
    if (subtype !== '/Form') continue;

    console.log(`\n--- FORM XOBJECT: ${name.toString()} ---`);

    // Better BBox extraction
    const bboxRaw = xobject.dict?.get(PDFName.of('BBox'));
    console.log('\nBBox raw type:', bboxRaw?.constructor?.name);

    if (bboxRaw) {
      // Try to get the actual array
      const bboxArray = context.lookup(bboxRaw);
      console.log('BBox resolved type:', bboxArray?.constructor?.name);

      if (bboxArray?.array) {
        const values = bboxArray.array.map((item, idx) => {
          const resolved = context.lookup(item);
          if (resolved?.numberValue) return resolved.numberValue;
          if (resolved?.value !== undefined) return resolved.value;
          if (typeof item.numberValue === 'function') return item.numberValue();
          console.log(`  BBox[${idx}] type:`, item?.constructor?.name, 'value:', item?.toString?.());
          return parseFloat(item?.toString?.() || '0');
        });
        console.log('BBox values:', values);
        console.log(`  Width: ${values[2] - values[0]}, Height: ${values[3] - values[1]}`);
      }
    }

    // Matrix
    const matrixRaw = xobject.dict?.get(PDFName.of('Matrix'));
    if (matrixRaw) {
      const matrixArray = context.lookup(matrixRaw);
      if (matrixArray?.array) {
        const values = matrixArray.array.map(item => {
          const resolved = context.lookup(item);
          if (resolved?.numberValue) return resolved.numberValue;
          if (typeof item.numberValue === 'function') return item.numberValue();
          return parseFloat(item?.toString?.() || '0');
        });
        console.log('\nMatrix:', values);
      }
    } else {
      console.log('\nMatrix: identity (not specified)');
    }

    // Get content and analyze
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

    // Look for CTM operations (cm) inside the XObject
    console.log('\n--- CTM OPERATIONS IN XOBJECT ---');
    const lines = xoContent.split('\n');
    let ctmCount = 0;
    let firstCTMs = [];

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let pathCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Look for cm (concat matrix) operations
      const cmMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm$/);
      if (cmMatch) {
        ctmCount++;
        if (firstCTMs.length < 5) {
          firstCTMs.push([
            parseFloat(cmMatch[1]),
            parseFloat(cmMatch[2]),
            parseFloat(cmMatch[3]),
            parseFloat(cmMatch[4]),
            parseFloat(cmMatch[5]),
            parseFloat(cmMatch[6])
          ]);
        }
      }

      // Track coordinates
      const moveMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+m$/);
      const lineMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+l$/);

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

      if (trimmed === 'S' || trimmed === 's' || trimmed === 'f' || trimmed === 'F' ||
          trimmed === 'f*' || trimmed === 'B' || trimmed === 'B*') {
        pathCount++;
      }
    }

    console.log(`CTM (cm) operations found: ${ctmCount}`);
    if (firstCTMs.length > 0) {
      console.log('First few CTMs:');
      for (const ctm of firstCTMs) {
        console.log(`  [${ctm.join(', ')}]`);
        console.log(`    Scale: (${ctm[0]}, ${ctm[3]}), Translate: (${ctm[4]}, ${ctm[5]})`);
      }
    }

    console.log('\n--- COORDINATE RANGES ---');
    console.log(`X range: ${minX.toFixed(2)} to ${maxX.toFixed(2)} (span: ${(maxX - minX).toFixed(2)})`);
    console.log(`Y range: ${minY.toFixed(2)} to ${maxY.toFixed(2)} (span: ${(maxY - minY).toFixed(2)})`);
    console.log(`Total paths: ${pathCount}`);

    // Calculate what scale factor would be needed
    const xScale = width / (maxX - minX);
    const yScale = height / (maxY - minY);
    console.log('\n--- SCALE FACTOR NEEDED TO FIT PAGE ---');
    console.log(`To fit X in page width (${width}): scale by ${xScale.toFixed(6)}`);
    console.log(`To fit Y in page height (${height}): scale by ${yScale.toFixed(6)}`);

    // Show first 30 lines
    console.log('\n--- FIRST 50 LINES OF XOBJECT CONTENT ---');
    for (let i = 0; i < Math.min(50, lines.length); i++) {
      console.log(lines[i]);
    }

    // Check for nested XObject references
    console.log('\n--- NESTED DO OPERATORS ---');
    let doOps = lines.filter(l => l.trim().match(/^\/\w+\s+Do$/));
    console.log(`Nested Do operators: ${doOps.length}`);
    if (doOps.length > 0) {
      console.log('First 10:', doOps.slice(0, 10).map(d => d.trim()));
    }

    // Check XObject's own Resources for nested XObjects
    const xoResources = xobject.dict?.get(PDFName.of('Resources'));
    if (xoResources) {
      const xoRes = context.lookup(xoResources);
      const nestedXObj = xoRes?.get(PDFName.of('XObject'));
      if (nestedXObj) {
        const nestedXObjDict = context.lookup(nestedXObj);
        const nestedEntries = nestedXObjDict?.entries ? Array.from(nestedXObjDict.entries()) : [];
        console.log(`\nNested XObjects in Fm0's Resources: ${nestedEntries.length}`);

        for (const [nName, nRef] of nestedEntries.slice(0, 5)) {
          const nested = context.lookup(nRef);
          const nSubtype = nested?.dict?.get(PDFName.of('Subtype'))?.toString();
          const nMatrix = nested?.dict?.get(PDFName.of('Matrix'));
          console.log(`  ${nName.toString()}: ${nSubtype}`);
          if (nMatrix) {
            const matrixArray = context.lookup(nMatrix);
            if (matrixArray?.array) {
              const values = matrixArray.array.map(item => {
                if (typeof item.numberValue === 'function') return item.numberValue();
                return parseFloat(item?.toString?.() || '0');
              });
              console.log(`    Matrix: [${values.join(', ')}]`);
            }
          }
        }
      }
    }
  }
}

analyze100K().catch(console.error);
