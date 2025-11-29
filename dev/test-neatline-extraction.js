#!/usr/bin/env node

/**
 * Test script to extract neatline/crop bounds from GeoPDF
 * The neatline defines the actual map boundary (excluding collar/margins)
 */

const fs = require('fs');
const { PDFDocument, PDFName } = require('pdf-lib');

async function extractNeatline(pdfPath) {
  console.log('='.repeat(80));
  console.log('NEATLINE / CROP BOUNDS EXTRACTION TEST');
  console.log('='.repeat(80));
  console.log(`\nPDF: ${pdfPath}\n`);

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);

  const firstPage = pdfDoc.getPage(0);
  const pageDict = firstPage.node.dict;

  // Helper function to parse box array [x, y, width, height]
  function parseBox(boxObj, name) {
    if (!boxObj) {
      console.log(`❌ ${name}: Not found`);
      return null;
    }

    const boxArray = pdfDoc.context.lookup(boxObj);
    if (!boxArray || !boxArray.array) {
      console.log(`❌ ${name}: Invalid format`);
      return null;
    }

    const values = boxArray.array.map(v => {
      const resolved = pdfDoc.context.lookup(v);
      return resolved.numberValue !== undefined ? resolved.numberValue : resolved.value;
    });

    console.log(`✓ ${name}: [${values.join(', ')}]`);
    console.log(`  - Position: (${values[0]}, ${values[1]})`);
    console.log(`  - Size: ${values[2] - values[0]} × ${values[3] - values[1]} pts`);
    console.log(`  - Size: ${((values[2] - values[0]) / 72).toFixed(2)}" × ${((values[3] - values[1]) / 72).toFixed(2)}"`);

    return {
      x: values[0],
      y: values[1],
      width: values[2] - values[0],
      height: values[3] - values[1],
      raw: values
    };
  }

  console.log('--- PDF Page Boxes ---\n');

  const mediaBox = parseBox(pageDict.get(PDFName.of('MediaBox')), 'MediaBox  (full page size)');
  const cropBox = parseBox(pageDict.get(PDFName.of('CropBox')), 'CropBox   (visible area)');
  const bleedBox = parseBox(pageDict.get(PDFName.of('BleedBox')), 'BleedBox  (print bleed)');
  const trimBox = parseBox(pageDict.get(PDFName.of('TrimBox')), 'TrimBox   (final trim)');
  const artBox = parseBox(pageDict.get(PDFName.of('ArtBox')), 'ArtBox    (meaningful content)');

  console.log('\n--- Analysis ---\n');

  // Determine which box to use for neatline
  let neatline = null;
  let neatlineSource = null;

  if (trimBox) {
    neatline = trimBox;
    neatlineSource = 'TrimBox';
    console.log('✓ TrimBox found - using as neatline (most common for GeoPDFs)');
  } else if (artBox) {
    neatline = artBox;
    neatlineSource = 'ArtBox';
    console.log('✓ ArtBox found - using as neatline');
  } else if (cropBox) {
    neatline = cropBox;
    neatlineSource = 'CropBox';
    console.log('⚠️  Using CropBox as fallback neatline');
  } else if (mediaBox) {
    // Calculate a 5% inset from MediaBox as last resort
    const inset = Math.min(mediaBox.width, mediaBox.height) * 0.05;
    neatline = {
      x: mediaBox.x + inset,
      y: mediaBox.y + inset,
      width: mediaBox.width - (inset * 2),
      height: mediaBox.height - (inset * 2)
    };
    neatlineSource = 'MediaBox with 5% inset';
    console.log('⚠️  No TrimBox/ArtBox - using 5% inset from MediaBox (less accurate)');
  }

  if (neatline) {
    console.log(`\n--- Recommended Neatline (from ${neatlineSource}) ---`);
    console.log(`Position: (${neatline.x}, ${neatline.y})`);
    console.log(`Size: ${neatline.width} × ${neatline.height} pts`);
    console.log(`Size: ${(neatline.width / 72).toFixed(2)}" × ${(neatline.height / 72).toFixed(2)}"`);

    if (mediaBox) {
      const topMargin = (neatline.y + neatline.height) - (mediaBox.y + mediaBox.height);
      const bottomMargin = neatline.y - mediaBox.y;
      const leftMargin = neatline.x - mediaBox.x;
      const rightMargin = (neatline.x + neatline.width) - (mediaBox.x + mediaBox.width);

      console.log(`\nMargins from MediaBox:`);
      console.log(`  Top: ${Math.abs(topMargin).toFixed(1)} pts (${(Math.abs(topMargin) / 72).toFixed(2)}")`);
      console.log(`  Bottom: ${bottomMargin.toFixed(1)} pts (${(bottomMargin / 72).toFixed(2)}")`);
      console.log(`  Left: ${leftMargin.toFixed(1)} pts (${(leftMargin / 72).toFixed(2)}")`);
      console.log(`  Right: ${Math.abs(rightMargin).toFixed(1)} pts (${(Math.abs(rightMargin) / 72).toFixed(2)}")`);
    }

    // Output JSON for easy integration
    console.log('\n--- JSON Output ---');
    console.log(JSON.stringify({
      neatline,
      neatlineSource,
      mediaBox,
      cropBox,
      trimBox,
      bleedBox,
      artBox
    }, null, 2));
  }

  console.log('\n' + '='.repeat(80));
}

const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';
extractNeatline(pdfPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
