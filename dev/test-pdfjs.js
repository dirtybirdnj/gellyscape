#!/usr/bin/env node

/**
 * Test script to explore PDF.js capabilities for extracting GeoPDF metadata
 * Compares with our current pdf-lib implementation
 */

const fs = require('fs');
const pdfjsLib = require('pdfjs-dist');

async function explorePDFWithPDFJS(pdfPath) {
  console.log('=== PDF.js GeoPDF Explorer ===\n');

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF not found:', pdfPath);
    return;
  }

  const data = new Uint8Array(fs.readFileSync(pdfPath));

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({
    data: data,
    verbosity: 0 // Reduce console noise
  });

  const pdf = await loadingTask.promise;

  console.log('Document Info:');
  console.log('  Pages:', pdf.numPages);

  // Get document metadata
  const metadata = await pdf.getMetadata();
  console.log('\nMetadata:');
  console.log('  Title:', metadata.info.Title || 'N/A');
  console.log('  Creator:', metadata.info.Creator || 'N/A');
  console.log('  Producer:', metadata.info.Producer || 'N/A');
  console.log('  Created:', metadata.info.CreationDate || 'N/A');

  // Get the first page
  const page = await pdf.getPage(1);
  console.log('\n=== Page 1 Analysis ===\n');

  // Get page annotations
  const annotations = await page.getAnnotations();
  console.log('Annotations:', annotations.length);

  // Get text content
  const textContent = await page.getTextContent();
  console.log('Text Items:', textContent.items.length);

  if (textContent.items.length > 0) {
    console.log('\nFirst 10 text items:');
    textContent.items.slice(0, 10).forEach((item, i) => {
      console.log(`  ${i + 1}. "${item.str}" (font: ${item.fontName}, size: ${item.height?.toFixed(2)})`);
    });

    // Analyze font usage
    const fontUsage = {};
    textContent.items.forEach(item => {
      if (item.fontName) {
        fontUsage[item.fontName] = (fontUsage[item.fontName] || 0) + 1;
      }
    });
    console.log('\nFont Usage Summary:');
    Object.entries(fontUsage).forEach(([font, count]) => {
      console.log(`  ${font}: ${count} items`);
    });
  }

  // Get operator list (lower level page operations)
  const operatorList = await page.getOperatorList();
  console.log('\nOperator List:');
  console.log('  Total operations:', operatorList.fnArray.length);

  // Count operation types
  const opCounts = {};
  const opNames = pdfjsLib.OPS;
  const opNameMap = Object.keys(opNames).reduce((map, key) => {
    map[opNames[key]] = key;
    return map;
  }, {});

  operatorList.fnArray.forEach(op => {
    const opName = opNameMap[op] || `Unknown(${op})`;
    opCounts[opName] = (opCounts[opName] || 0) + 1;
  });

  // Show top 15 operation types
  const sortedOps = Object.entries(opCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.log('\nTop Operation Types:');
  sortedOps.forEach(([op, count]) => {
    console.log(`  ${op}: ${count}`);
  });

  // Look for marked content (BDC/EMC - used for layers)
  const markedContentOps = ['beginMarkedContent', 'beginMarkedContentProps', 'endMarkedContent'];
  const markedContentCount = markedContentOps.reduce((sum, op) => sum + (opCounts[op] || 0), 0);
  console.log('\nMarked Content Operations (layers):', markedContentCount);

  // Access internal page structure for Optional Content Groups
  try {
    const pageDict = page._pageDict;
    console.log('\n=== Optional Content Groups (OCG) ===');

    // Try to access catalog
    const pdfManager = pdf.pdfManager || pdf._pdfManager;
    if (pdfManager) {
      console.log('PDF Manager available - could explore OCG structure');
    }

    // Get catalog from internal structure
    const catalog = pdf.catalog || pdf._catalog;
    if (catalog) {
      console.log('Catalog available');

      // Try to access OCProperties
      if (catalog.optionalContentConfig) {
        console.log('Optional Content Config found!');
        const ocConfig = catalog.optionalContentConfig;
        console.log('  Groups:', ocConfig.getOrder ? 'Order available' : 'No order');
      }
    }
  } catch (err) {
    console.log('Could not access internal OCG structure:', err.message);
  }

  // Extract font information at a deeper level
  console.log('\n=== Font Analysis ===');
  const fonts = page.commonObjs?.fontCache || page.objs?._objs;
  if (fonts) {
    console.log('Font objects available in page');
  }

  console.log('\n=== Summary ===');
  console.log('PDF.js can provide:');
  console.log('  ✓ Text extraction with font names');
  console.log('  ✓ Character positioning');
  console.log('  ✓ Low-level page operations');
  console.log('  ✓ Operation sequence (for path reconstruction)');
  console.log('  ' + (markedContentCount > 0 ? '✓' : '✗') + ' Marked content for layer separation');

  console.log('\nNext steps:');
  console.log('  - Use operatorList to reconstruct vector paths');
  console.log('  - Map marked content sections to layer names');
  console.log('  - Extract font encoding from font objects');
}

// Run with sample PDF
const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';
explorePDFWithPDFJS(pdfPath).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
