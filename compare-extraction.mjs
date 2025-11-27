/**
 * Compare our parser output with pdf.js operator list
 * to identify exactly what paths are being lost
 */

import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

// Build reverse mapping of OPS
const OPS = pdfjsLib.OPS;
const opNames = {};
for (const [name, value] of Object.entries(OPS)) {
  opNames[value] = name;
}

async function analyzeContentStreamStructure() {
  console.log('='.repeat(70));
  console.log('CONTENT STREAM STRUCTURE ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  // Load with pdf-lib to see content stream structure
  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));

  console.log('Content stream type:', contents?.constructor?.name);

  let streamCount = 0;
  let totalBytes = 0;

  if (contents?.array) {
    streamCount = contents.array.length;
    console.log(`Content streams: ${streamCount}`);

    for (let i = 0; i < contents.array.length; i++) {
      const streamRef = contents.array[i];
      const stream = pdfDoc.context.lookup(streamRef);
      if (stream) {
        const rawContents = stream.getContents();
        totalBytes += rawContents.length;
        console.log(`  Stream ${i}: ${rawContents.length} bytes`);
      }
    }
  } else {
    streamCount = 1;
    const stream = pdfDoc.context.lookup(contents);
    if (stream) {
      const rawContents = stream.getContents();
      totalBytes = rawContents.length;
    }
    console.log(`Single content stream: ${totalBytes} bytes`);
  }

  // Check for Form XObjects
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjects = resources?.get(PDFName.of('XObject'));

  let formXObjectCount = 0;
  let formXObjectPaths = 0;

  if (xobjects) {
    const xobjDict = pdfDoc.context.lookup(xobjects);
    if (xobjDict) {
      console.log('\nForm XObjects in resources:');

      const entries = xobjDict.entries ? Array.from(xobjDict.entries()) : [];
      for (const [key, ref] of entries) {
        const xobj = pdfDoc.context.lookup(ref);
        if (xobj?.dict) {
          const subtype = xobj.dict.get(PDFName.of('Subtype'));
          if (subtype?.toString() === '/Form') {
            formXObjectCount++;
            // Get content size
            const rawContent = xobj.getContents ? xobj.getContents() : null;
            const size = rawContent?.length || 0;
            if (formXObjectCount <= 10) {
              console.log(`  ${key}: Form XObject, ${size} bytes`);
            }
          }
        }
      }
      console.log(`Total Form XObjects: ${formXObjectCount}`);
    }
  }

  // Now analyze with pdf.js to get the complete picture
  console.log('\n');
  console.log('='.repeat(70));
  console.log('PDF.JS OPERATOR ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pdfPage = await doc.getPage(1);
  const opList = await pdfPage.getOperatorList();

  console.log(`Total operators: ${opList.fnArray.length}`);

  // Count operator types
  const opCounts = {};
  for (const op of opList.fnArray) {
    const name = opNames[op] || `unknown_${op}`;
    opCounts[name] = (opCounts[name] || 0) + 1;
  }

  // Key things to check
  console.log('\nKey operators:');
  console.log(`  constructPath: ${opCounts['constructPath'] || 0}`);
  console.log(`  paintXObject: ${opCounts['paintXObject'] || 0}`);
  console.log(`  beginMarkedContentProps: ${opCounts['beginMarkedContentProps'] || 0}`);
  console.log(`  save: ${opCounts['save'] || 0}`);
  console.log(`  restore: ${opCounts['restore'] || 0}`);

  // Count visible paths by operation
  let visiblePaths = 0;
  let endPathPaths = 0;

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const name = opNames[op];

    if (name === 'constructPath') {
      const terminatingOp = opList.argsArray[i][0];
      const termName = opNames[terminatingOp];

      if (termName === 'stroke' || termName === 'fill' || termName === 'eoFill' ||
          termName === 'fillStroke' || termName === 'eoFillStroke') {
        visiblePaths++;
      } else if (termName === 'endPath') {
        endPathPaths++;
      }
    }
  }

  console.log('\nPath classification:');
  console.log(`  Visible (stroke/fill): ${visiblePaths}`);
  console.log(`  Invisible (endPath): ${endPathPaths}`);

  // Check if pdf.js handles XObjects differently
  console.log('\n');
  console.log('='.repeat(70));
  console.log('XObject ANALYSIS');
  console.log('='.repeat(70));

  // Count paintXObject calls to see if XObjects are being invoked
  let xobjectInvocations = 0;
  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const name = opNames[op];

    if (name === 'paintXObject') {
      xobjectInvocations++;
    }
  }

  console.log(`paintXObject calls: ${xobjectInvocations}`);
  console.log(`Form XObjects in page resources: ${formXObjectCount}`);

  if (xobjectInvocations === 0 && formXObjectCount > 0) {
    console.log('\n⚠️  WARNING: Form XObjects exist but pdf.js reports no paintXObject calls');
    console.log('   This suggests the 2024 format may NOT use Form XObjects for content.');
    console.log('   Content is likely inline in the page content streams.');
  }

  // Sample some constructPath operations to understand structure
  console.log('\n');
  console.log('='.repeat(70));
  console.log('SAMPLE CONSTRUCTPATH OPERATIONS');
  console.log('='.repeat(70));

  let sampleCount = 0;
  for (let i = 0; i < opList.fnArray.length && sampleCount < 5; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    if (name === 'constructPath') {
      const terminatingOp = args[0];
      const coords = args[1]; // Float32Array
      const minMax = args[2];
      const termName = opNames[terminatingOp];

      console.log(`\n[${sampleCount + 1}] constructPath #${i}:`);
      console.log(`  Terminating op: ${termName} (${terminatingOp})`);
      console.log(`  Coords length: ${coords?.length || 0}`);
      console.log(`  MinMax: [${minMax?.[0]?.toFixed(2)}, ${minMax?.[1]?.toFixed(2)}, ${minMax?.[2]?.toFixed(2)}, ${minMax?.[3]?.toFixed(2)}]`);

      sampleCount++;
    }
  }

  // Now the key question: what's our parser actually extracting?
  console.log('\n');
  console.log('='.repeat(70));
  console.log('DIAGNOSIS: WHY ARE PATHS MISSING?');
  console.log('='.repeat(70));

  console.log(`
PDF.js sees ${visiblePaths} visible paths
App extracts 4,290 paths (from screenshot)
Difference: ${visiblePaths - 4290} paths missing (${((visiblePaths - 4290) / visiblePaths * 100).toFixed(1)}%)

Possible causes:
1. Content stream parsing issues (our parser vs pdf.js)
2. Form XObject handling differences
3. Layer/BDC filtering discarding paths
4. Transform issues causing paths to be filtered out

Let's check the content stream for patterns that might explain the loss...
`);

  // Check for specific patterns in first content stream
  const firstStreamRef = contents?.array?.[0] || contents;
  const firstStream = pdfDoc.context.lookup(firstStreamRef);

  if (firstStream) {
    let rawData = firstStream.getContents();

    // Check for compression
    const filter = firstStream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      const zlib = await import('zlib');
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }

    const content = rawData.toString('latin1');

    // Count raw operators in content stream
    const mCount = (content.match(/\s+m\s/g) || []).length;
    const lCount = (content.match(/\s+l\s/g) || []).length;
    const strokeCount = (content.match(/\bS\b/g) || []).length;
    const fillCount = (content.match(/\bf\b|\bF\b/g) || []).length;

    console.log('First content stream raw operator counts:');
    console.log(`  moveTo (m): ${mCount}`);
    console.log(`  lineTo (l): ${lCount}`);
    console.log(`  stroke (S): ${strokeCount}`);
    console.log(`  fill (f/F): ${fillCount}`);

    // Look for patterns
    const bdcCount = (content.match(/BDC/g) || []).length;
    const emcCount = (content.match(/EMC/g) || []).length;
    const doCount = (content.match(/\sDo\s/g) || []).length;

    console.log(`\n  BDC (begin marked content): ${bdcCount}`);
    console.log(`  EMC (end marked content): ${emcCount}`);
    console.log(`  Do (invoke XObject): ${doCount}`);
  }
}

analyzeContentStreamStructure().catch(console.error);
