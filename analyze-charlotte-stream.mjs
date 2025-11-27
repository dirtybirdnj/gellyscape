/**
 * Analyze Charlotte PDF content stream structure
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH = './samples/VT_Charlotte_20240813_TM_geo.pdf';

async function analyzeStream() {
  console.log('='.repeat(70));
  console.log('CHARLOTTE STREAM ANALYSIS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const page = pages[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let streams = [];
  if (Array.isArray(contents)) {
    streams = contents;
  } else if (contents?.array) {
    streams = contents.array;
  } else {
    streams = [contents];
  }

  // Look at first stream in detail
  const streamRef = streams[0];
  const stream = pdfDoc.context.lookup(streamRef);

  let contentData;
  if (stream.getContents) {
    contentData = stream.getContents();
  } else if (stream.contents) {
    contentData = stream.contents;
  }

  const text = new TextDecoder('latin1').decode(contentData);

  // Show first 5000 chars of first stream
  console.log('\n--- FIRST STREAM (first 5000 chars) ---');
  console.log(text.substring(0, 5000));

  // Look for layer markers
  console.log('\n\n--- LAYER MARKERS SEARCH ---');

  // Search for OC, BDC, EMC patterns
  const ocMatches = text.match(/\/OC\s/g);
  const bdcMatches = text.match(/BDC/g);
  const emcMatches = text.match(/EMC/g);
  const mcMatches = text.match(/\/MC\d+\s/g);

  console.log(`/OC patterns: ${ocMatches?.length || 0}`);
  console.log(`BDC patterns: ${bdcMatches?.length || 0}`);
  console.log(`EMC patterns: ${emcMatches?.length || 0}`);
  console.log(`/MC# patterns: ${mcMatches?.length || 0}`);

  // Check for Properties dict references
  const propMatches = text.match(/\/P\d+\s/g);
  console.log(`/P# patterns: ${propMatches?.length || 0}`);

  // Look for specific patterns
  if (mcMatches) {
    console.log('\nSample /MC patterns:', mcMatches.slice(0, 10).join(', '));
  }

  // Look at all 8 streams for layer markers
  console.log('\n--- ALL STREAMS LAYER MARKERS ---');
  for (let i = 0; i < streams.length; i++) {
    const sRef = streams[i];
    const s = pdfDoc.context.lookup(sRef);

    let data;
    try {
      if (s.getContents) {
        data = s.getContents();
      } else if (s.contents) {
        data = s.contents;
      }
    } catch (e) {
      continue;
    }

    if (!data) continue;

    const t = new TextDecoder('latin1').decode(data);

    const oc = (t.match(/\/OC\s/g) || []).length;
    const bdc = (t.match(/BDC/g) || []).length;
    const emc = (t.match(/EMC/g) || []).length;
    const mc = (t.match(/\/MC\d+\s/g) || []).length;
    const p = (t.match(/\/P\d+\s/g) || []).length;

    console.log(`Stream ${i}: OC=${oc}, BDC=${bdc}, EMC=${emc}, MC#=${mc}, P#=${p}`);

    // If this stream has markers, show sample
    if (bdc > 0) {
      const bdcSample = t.match(/.{0,50}BDC.{0,50}/g);
      if (bdcSample) {
        console.log(`  Sample BDC: ${bdcSample[0]}`);
      }
    }
  }

  // Check Properties in Resources
  console.log('\n--- RESOURCE PROPERTIES ---');
  const resources = pageDict.get(PDFName.of('Resources'));
  if (resources) {
    const properties = resources.get(PDFName.of('Properties'));
    if (properties) {
      const propsDict = pdfDoc.context.lookup(properties);
      if (propsDict?.entries) {
        const entries = Array.from(propsDict.entries());
        console.log(`Property count: ${entries.length}`);

        // Show first few
        for (const [key, value] of entries.slice(0, 5)) {
          console.log(`  ${key.toString()}`);
        }
      }
    } else {
      console.log('No Properties in Resources!');
    }
  }
}

analyzeStream().catch(console.error);
