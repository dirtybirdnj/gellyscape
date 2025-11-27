/**
 * Deep analysis of XObject references in Jay Peak PDF
 * Find where the Form XObjects are stored and why they're not being found
 */

import fs from 'fs';
import { PDFDocument, PDFName, PDFDict, PDFStream, PDFRef } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeXObjects() {
  console.log('='.repeat(70));
  console.log('XOBJECT DEEP ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get Resources
  const resourcesRef = pageDict.get(PDFName.of('Resources'));
  console.log('Resources ref:', resourcesRef?.toString());

  const resources = context.lookup(resourcesRef);
  console.log('Resources type:', resources?.constructor?.name);

  if (resources?.dict) {
    console.log('\nResources dictionary keys:');
    for (const [key, value] of resources.dict.entries()) {
      console.log(`  ${key}: ${value?.constructor?.name || typeof value}`);
    }
  }

  // Try to get XObject dictionary more thoroughly
  const xobjectRef = resources?.get(PDFName.of('XObject'));
  console.log('\nXObject ref:', xobjectRef?.toString());

  if (xobjectRef) {
    const xobjectDict = context.lookup(xobjectRef);
    console.log('XObject dict type:', xobjectDict?.constructor?.name);

    if (xobjectDict?.dict) {
      const entries = Array.from(xobjectDict.dict.entries());
      console.log(`XObject dict has ${entries.length} entries:`);
      for (const [key, value] of entries.slice(0, 10)) {
        console.log(`  ${key}: ${value?.toString()}`);
      }
      if (entries.length > 10) {
        console.log(`  ... and ${entries.length - 10} more`);
      }
    } else if (xobjectDict?.entries) {
      const entries = Array.from(xobjectDict.entries());
      console.log(`XObject has ${entries.length} entries (using .entries()):`);
      for (const [key, value] of entries.slice(0, 10)) {
        console.log(`  ${key}: ${value?.toString()}`);
      }
    }
  }

  // Look at the raw content stream to see what XObjects are being invoked
  console.log('\n');
  console.log('='.repeat(70));
  console.log('XOBJECT INVOCATIONS IN CONTENT');
  console.log('='.repeat(70));

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];

  if (contents?.array) {
    contentStreams = contents.array;
  } else {
    contentStreams = [contents];
  }

  const xobjectNames = new Set();

  for (let i = 0; i < contentStreams.length; i++) {
    const streamRef = contentStreams[i];
    const stream = context.lookup(streamRef);

    if (stream) {
      let rawData = stream.getContents();

      // Check for compression
      const filter = stream.dict?.get(PDFName.of('Filter'));
      if (filter?.toString() === '/FlateDecode') {
        rawData = zlib.inflateSync(Buffer.from(rawData));
      }

      const content = rawData.toString('latin1');

      // Find all Do operations
      const doMatches = content.matchAll(/\/([\w]+)\s+Do\b/g);
      for (const match of doMatches) {
        xobjectNames.add(match[1]);
      }
    }
  }

  console.log(`\nUnique XObject names invoked: ${xobjectNames.size}`);
  const namesList = Array.from(xobjectNames).sort();
  console.log('Names:', namesList.slice(0, 20).join(', '));
  if (namesList.length > 20) {
    console.log(`... and ${namesList.length - 20} more`);
  }

  // Now check if these XObjects exist in the XObject dictionary
  console.log('\n');
  console.log('='.repeat(70));
  console.log('XOBJECT RESOLUTION CHECK');
  console.log('='.repeat(70));

  let foundCount = 0;
  let missingCount = 0;
  const missingNames = [];

  for (const name of namesList) {
    const xobjRef = resources?.get(PDFName.of('XObject'))?.get?.(PDFName.of(name));

    if (!xobjRef) {
      // Try looking it up via context.lookup
      const xobjectDict = context.lookup(resources?.get(PDFName.of('XObject')));
      const ref = xobjectDict?.get?.(PDFName.of(name)) || xobjectDict?.dict?.get?.(PDFName.of(name));

      if (ref) {
        foundCount++;
      } else {
        missingCount++;
        missingNames.push(name);
      }
    } else {
      foundCount++;
    }
  }

  console.log(`Found: ${foundCount}`);
  console.log(`Missing: ${missingCount}`);
  if (missingNames.length > 0) {
    console.log('Missing names:', missingNames.slice(0, 10).join(', '));
  }

  // Let's try a different approach - iterate the XObject dictionary directly
  console.log('\n');
  console.log('='.repeat(70));
  console.log('DIRECT XOBJECT DICTIONARY ITERATION');
  console.log('='.repeat(70));

  const xobjDictRef = resources?.get(PDFName.of('XObject'));
  if (xobjDictRef) {
    const xobjDict = context.lookup(xobjDictRef);

    // Try different iteration methods
    if (xobjDict?.dict) {
      console.log('Using .dict iteration:');
      let count = 0;
      for (const [key, value] of xobjDict.dict.entries()) {
        count++;
        if (count <= 5) {
          const keyStr = key.toString();
          const resolved = context.lookup(value);
          console.log(`  ${keyStr}: ${resolved?.constructor?.name}`);

          // Check if it's a Form or Image
          if (resolved?.dict) {
            const subtype = resolved.dict.get(PDFName.of('Subtype'));
            console.log(`    Subtype: ${subtype?.toString()}`);
          }
        }
      }
      console.log(`Total XObjects: ${count}`);
    }

    // Try using entries() method directly on the PDFDict
    if (xobjDict?.entries) {
      console.log('\nUsing .entries() method:');
      const entries = Array.from(xobjDict.entries());
      console.log(`Entries count: ${entries.length}`);
    }
  }

  // Check if XObjects might be stored at a different level
  console.log('\n');
  console.log('='.repeat(70));
  console.log('CHECKING ALTERNATIVE STORAGE LOCATIONS');
  console.log('='.repeat(70));

  // Check if there are Form XObjects stored directly in the content streams
  // (some PDFs embed XObjects inline)

  for (let i = 0; i < Math.min(contentStreams.length, 2); i++) {
    const streamRef = contentStreams[i];
    const stream = context.lookup(streamRef);

    if (stream?.dict) {
      console.log(`\nContent stream ${i} dict:`);
      for (const [key, value] of stream.dict.entries()) {
        console.log(`  ${key}: ${value?.constructor?.name || value?.toString()?.slice(0, 50)}`);
      }

      // Check if the stream has its own Resources
      const streamResources = stream.dict.get(PDFName.of('Resources'));
      if (streamResources) {
        console.log(`  Stream ${i} has its own Resources!`);
        const resolved = context.lookup(streamResources);
        if (resolved?.get) {
          const xobjs = resolved.get(PDFName.of('XObject'));
          if (xobjs) {
            console.log(`  XObject in stream resources:`, xobjs?.toString()?.slice(0, 100));
          }
        }
      }
    }
  }
}

analyzeXObjects().catch(console.error);
