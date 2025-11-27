/**
 * Deep analysis of VT_Charlotte PDF to find potential data loss
 * Compare raw PDF content with extracted paths
 */

import fs from 'fs';
import { PDFDocument, PDFName, PDFArray } from 'pdf-lib';

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function deepAnalysis() {
  console.log('='.repeat(70));
  console.log('DEEP CHARLOTTE ANALYSIS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pageDict = page.node.dict;

  // Count content streams
  const contents = pageDict.get(PDFName.of('Contents'));
  let streams = [];
  if (Array.isArray(contents)) {
    streams = contents;
  } else if (contents?.array) {
    streams = contents.array;
  } else {
    streams = [contents];
  }

  console.log(`\n--- CONTENT STREAMS ---`);
  console.log(`Stream count: ${streams.length}`);

  // Analyze each stream
  let totalPathOps = 0;
  let totalCmOps = 0;
  let totalBDCOps = 0;
  let totalEMCOps = 0;

  const pathOperators = ['m', 'l', 'c', 'v', 'y', 'h', 're', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'];
  const pathStartOps = ['m', 're'];
  const pathEndOps = ['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n'];

  for (let i = 0; i < streams.length; i++) {
    const streamRef = streams[i];
    const stream = pdfDoc.context.lookup(streamRef);

    if (!stream) continue;

    let contentData;
    try {
      if (stream.getContents) {
        contentData = stream.getContents();
      } else if (stream.contents) {
        contentData = stream.contents;
      }
    } catch (e) {
      console.log(`  Stream ${i}: Error reading - ${e.message}`);
      continue;
    }

    if (!contentData) continue;

    const text = new TextDecoder('latin1').decode(contentData);

    // Count operators
    const cmCount = (text.match(/\s+cm\s/g) || []).length;
    const bdcCount = (text.match(/\/\w+\s+BDC/g) || []).length + (text.match(/\/\w+\s+<<[^>]*>>\s+BDC/g) || []).length;
    const emcCount = (text.match(/\sEMC\s/g) || []).length;

    // Count path starts
    const moveToCount = (text.match(/[\d\.\-\s]+m\s/g) || []).length;
    const rectCount = (text.match(/[\d\.\-\s]+re\s/g) || []).length;

    // Count path ends
    let pathEndCount = 0;
    for (const op of pathEndOps) {
      const regex = new RegExp(`\\s${op}\\s`, 'g');
      pathEndCount += (text.match(regex) || []).length;
    }

    console.log(`\n  Stream ${i}:`);
    console.log(`    Size: ${text.length} chars`);
    console.log(`    moveto (m): ${moveToCount}`);
    console.log(`    rect (re): ${rectCount}`);
    console.log(`    path ends: ${pathEndCount}`);
    console.log(`    BDC markers: ${bdcCount}`);
    console.log(`    EMC markers: ${emcCount}`);
    console.log(`    cm (transforms): ${cmCount}`);

    totalPathOps += moveToCount + rectCount;
    totalCmOps += cmCount;
    totalBDCOps += bdcCount;
    totalEMCOps += emcCount;
  }

  console.log(`\n--- TOTALS FROM RAW PDF ---`);
  console.log(`Total path starts (m + re): ${totalPathOps}`);
  console.log(`Total BDC markers: ${totalBDCOps}`);
  console.log(`Total EMC markers: ${totalEMCOps}`);
  console.log(`Total cm transforms: ${totalCmOps}`);

  // Now compare with our extraction
  console.log(`\n--- COMPARISON WITH EXTRACTION ---`);
  const { default: PDFProcessor } = await import('./src/pdf-processor.js');

  const processor = new PDFProcessor(buffer);
  const result = await processor.process();
  const paths = result.contentPaths?.paths || [];

  console.log(`Extracted paths: ${paths.length}`);
  console.log(`Raw path starts: ${totalPathOps}`);

  if (paths.length < totalPathOps) {
    console.log(`\n⚠️  POTENTIAL DATA LOSS: ${totalPathOps - paths.length} paths may be missing`);
  } else if (paths.length > totalPathOps) {
    console.log(`\nNote: More extracted paths than raw path starts (subpaths counted separately?)`);
  } else {
    console.log(`\n✓ Path counts match!`);
  }

  // Check for XObjects
  console.log(`\n--- XOBJECTS CHECK ---`);
  const resources = pageDict.get(PDFName.of('Resources'));
  if (resources) {
    const xobject = resources.get(PDFName.of('XObject'));
    if (xobject) {
      const xobjectDict = pdfDoc.context.lookup(xobject);
      if (xobjectDict?.entries) {
        const entries = Array.from(xobjectDict.entries());
        console.log(`XObject count: ${entries.length}`);

        // Check for Form XObjects vs Images
        let formCount = 0;
        let imageCount = 0;

        for (const [key, ref] of entries) {
          const name = key.toString();
          const obj = pdfDoc.context.lookup(ref);
          if (obj?.dict) {
            const subtype = obj.dict.get(PDFName.of('Subtype'))?.toString();
            if (subtype === '/Form') {
              formCount++;

              // Check if this form has content
              let formContent;
              try {
                if (obj.getContents) {
                  formContent = obj.getContents();
                } else if (obj.contents) {
                  formContent = obj.contents;
                }
              } catch (e) {}

              if (formContent) {
                const formText = new TextDecoder('latin1').decode(formContent);
                const formMoveCount = (formText.match(/[\d\.\-\s]+m\s/g) || []).length;
                if (formMoveCount > 0) {
                  console.log(`  ${name}: Form XObject with ${formMoveCount} moveto ops`);
                }
              }
            } else if (subtype === '/Image') {
              imageCount++;
            }
          }
        }

        console.log(`Form XObjects: ${formCount}`);
        console.log(`Image XObjects: ${imageCount}`);
      }
    }
  }

  // Check layer assignment
  console.log(`\n--- LAYER ASSIGNMENT ANALYSIS ---`);
  const layerCounts = {};
  for (const path of paths) {
    const layer = path.layer || 'Unassigned';
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  }

  // Look for mismatches
  console.log(`Expected layers (from OCG): ${result.metadata.usgsFormat?.layers?.names?.length || 0}`);
  console.log(`Actual layers with paths: ${Object.keys(layerCounts).length}`);

  // Missing layers
  const ocgLayers = result.metadata.usgsFormat?.layers?.names || [];
  const pathLayers = Object.keys(layerCounts);

  console.log(`\nOCG layers without paths:`);
  for (const layer of ocgLayers) {
    if (!pathLayers.includes(layer)) {
      console.log(`  - ${layer}`);
    }
  }
}

deepAnalysis().catch(console.error);
