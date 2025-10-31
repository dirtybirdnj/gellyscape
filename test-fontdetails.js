#!/usr/bin/env node

/**
 * Quick test to verify fontDetails is being properly extracted and passed through
 */

const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const PDFContentParser = require('./src/pdf-content-parser');

async function testFontDetails() {
  console.log('=== Testing fontDetails extraction ===\n');

  // Use the sample PDF
  const pdfPath = './samples/VT_Burlington_20240809_TM_geo.pdf';

  if (!fs.existsSync(pdfPath)) {
    console.error('Sample PDF not found:', pdfPath);
    return;
  }

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  const pages = pdfDoc.getPages();
  const page = pages[0];

  console.log('Testing with first page...\n');

  // Get page resources
  const pageDict = page.node.dict;
  const { PDFName } = require('pdf-lib');
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));

  // Get content stream(s)
  const contents = pageDict.get(PDFName.of('Contents'));
  if (!contents) {
    console.error('No content stream found');
    return;
  }

  // Get all streams
  let streams = [];
  if (contents.array) {
    streams = contents.array.map(ref => pdfDoc.context.lookup(ref));
    console.log(`Found ${streams.length} content streams\n`);
  } else {
    streams = [pdfDoc.context.lookup(contents)];
    console.log(`Found 1 content stream\n`);
  }

  // Aggregate results from all streams
  const allPaths = [];
  const allTextObjects = [];
  const allFontDetails = {};

  for (let i = 0; i < streams.length; i++) {
    const stream = streams[i];
    if (!stream) continue;

    let contentData = stream.getContents();

    // Check if stream is compressed
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter && filter.toString() === '/FlateDecode') {
      const zlib = require('zlib');
      contentData = zlib.inflateSync(Buffer.from(contentData));
    }

    // Parse with PDFContentParser
    const parser = new PDFContentParser({
      pdfContext: pdfDoc.context,
      fontDict: fontDict
    });

    const result = parser.parseContentStream(contentData);

    allPaths.push(...result.paths);
    allTextObjects.push(...result.textObjects);
    if (result.fontDetails) {
      Object.assign(allFontDetails, result.fontDetails);
    }

    console.log(`Stream ${i + 1}: ${result.paths.length} paths, ${result.textObjects.length} text objects, ${Object.keys(result.fontDetails || {}).length} fonts`);
  }

  console.log();

  console.log('Total Results:');
  console.log('  Paths:', allPaths.length);
  console.log('  Text objects:', allTextObjects.length);
  console.log('  Font details:', Object.keys(allFontDetails).length);
  console.log();

  // Check what fonts are referenced in text objects
  if (allTextObjects.length > 0) {
    const textFonts = new Set();
    let fontsWithValues = 0;
    allTextObjects.forEach(obj => {
      if (obj.font) {
        textFonts.add(obj.font);
        fontsWithValues++;
      }
    });
    console.log(`Text objects with font: ${fontsWithValues}/${allTextObjects.length}`);
    console.log('Fonts referenced in text objects:', Array.from(textFonts));

    // Show a sample text object with font
    const sampleWithFont = allTextObjects.find(obj => obj.font);
    if (sampleWithFont) {
      console.log('\nSample text object with font:', JSON.stringify(sampleWithFont, null, 2));
    }
    console.log();
  }

  if (allFontDetails && Object.keys(allFontDetails).length > 0) {
    console.log('✓ fontDetails extracted successfully!\n');
    console.log('Font mappings:');
    const entries = Object.entries(allFontDetails);
    entries.slice(0, 10).forEach(([ref, name]) => {
      console.log(`  ${ref} -> ${name}`);
    });

    if (entries.length > 10) {
      console.log(`  ... and ${entries.length - 10} more`);
    }
    console.log();
    console.log('✓ SUCCESS: fontDetails is being extracted from parseContentStream()');
  } else {
    console.log('✗ FAILED: No fontDetails found');
  }
}

testFontDetails().catch(console.error);
