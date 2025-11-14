#!/usr/bin/env node

/**
 * Layer Extraction Comparison Test
 * Compares current pdf-lib approach with PDF.js for layer extraction
 */

const fs = require('fs');
const { PDFDocument, PDFName } = require('pdf-lib');
const pdfjsLib = require('pdfjs-dist');

const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';

console.log('='.repeat(80));
console.log('LAYER EXTRACTION COMPARISON TEST');
console.log('='.repeat(80));
console.log(`\nPDF: ${pdfPath}\n`);

async function testCurrentApproach() {
  console.log('\n' + '='.repeat(80));
  console.log('CURRENT APPROACH (pdf-lib)');
  console.log('='.repeat(80));

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);

  const catalog = pdfDoc.catalog;
  const catalogDict = catalog.dict;

  const ocProperties = catalogDict.get(PDFName.of('OCProperties'));

  if (!ocProperties) {
    console.log('❌ No OCProperties found');
    return {};
  }

  console.log('✓ Found OCProperties');

  const ocgs = ocProperties.get(PDFName.of('OCGs'));
  if (!ocgs || !ocgs.array) {
    console.log('❌ No OCGs array found');
    return {};
  }

  console.log(`✓ Found ${ocgs.array.length} Optional Content Groups\n`);

  const layers = {};

  for (let i = 0; i < ocgs.array.length; i++) {
    const ocgRef = ocgs.array[i];
    const ocgDict = pdfDoc.context.lookup(ocgRef);

    if (!ocgDict) continue;

    const nameObj = ocgDict.get(PDFName.of('Name'));
    const name = nameObj ? pdfDoc.context.lookup(nameObj).decodeText() : `Layer${i}`;

    // Get Intent
    const intentObj = ocgDict.get(PDFName.of('Intent'));
    let intent = null;
    if (intentObj) {
      const resolved = pdfDoc.context.lookup(intentObj);
      if (resolved && resolved.array) {
        intent = resolved.array.map(i => i.toString());
      } else if (resolved) {
        intent = [resolved.toString()];
      }
    }

    // Get Usage dictionary
    const usageObj = ocgDict.get(PDFName.of('Usage'));
    let usage = null;
    if (usageObj) {
      const usageDict = pdfDoc.context.lookup(usageObj);
      if (usageDict && usageDict.dict) {
        usage = Object.keys(usageDict.dict).map(k => k.toString());
      }
    }

    layers[name] = {
      ref: ocgRef.toString(),
      intent,
      usage,
      index: i
    };

    console.log(`  ${(i + 1).toString().padStart(2, ' ')}. "${name}"`);
    if (intent) console.log(`      Intent: ${intent.join(', ')}`);
    if (usage) console.log(`      Usage: ${usage.join(', ')}`);
    console.log(`      Ref: ${ocgRef.toString()}`);
  }

  return layers;
}

async function testPDFJS() {
  console.log('\n' + '='.repeat(80));
  console.log('PDF.JS APPROACH');
  console.log('='.repeat(80));

  const data = new Uint8Array(fs.readFileSync(pdfPath));

  const loadingTask = pdfjsLib.getDocument({
    data: data,
    verbosity: 0
  });

  const pdf = await loadingTask.promise;

  console.log(`Document has ${pdf.numPages} pages\n`);

  // Get the first page
  const page = await pdf.getPage(1);

  // Get operator list to see marked content
  const operatorList = await page.getOperatorList();

  console.log(`Total operations on page 1: ${operatorList.fnArray.length}`);

  // Map operation codes to names
  const opNames = pdfjsLib.OPS;
  const opNameMap = Object.keys(opNames).reduce((map, key) => {
    map[opNames[key]] = key;
    return map;
  }, {});

  // Count marked content operations
  let markedContentCount = 0;
  let markedContentSections = [];

  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const op = operatorList.fnArray[i];
    const opName = opNameMap[op];
    const args = operatorList.argsArray[i];

    if (opName === 'beginMarkedContent' || opName === 'beginMarkedContentProps') {
      markedContentCount++;
      markedContentSections.push({
        type: opName,
        args: args,
        index: i
      });
    }
  }

  console.log(`\nMarked content operations: ${markedContentCount}`);
  console.log(`\nFirst 20 marked content sections:`);

  markedContentSections.slice(0, 20).forEach((section, idx) => {
    console.log(`  ${(idx + 1).toString().padStart(2, ' ')}. ${section.type}`, section.args);
  });

  // Try to access optional content config
  console.log('\n--- Attempting to access Optional Content Config ---');

  try {
    // Access internal structures (these are not official API)
    const catalog = pdf._transport?._catalogCapabilities?.catalog;

    if (catalog) {
      console.log('✓ Got catalog from PDF.js');
      console.log('Catalog keys:', Object.keys(catalog));
    } else {
      console.log('⚠️  Could not access catalog from PDF.js internal structure');
    }
  } catch (err) {
    console.log('❌ Error accessing PDF.js internals:', err.message);
  }

  return {
    pageCount: pdf.numPages,
    markedContentCount,
    markedContentSections: markedContentSections.slice(0, 50)
  };
}

async function compareApproaches() {
  const pdfLibLayers = await testCurrentApproach();
  const pdfjsData = await testPDFJS();

  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(80));

  console.log('\n✓ pdf-lib approach:');
  console.log(`  - Extracted ${Object.keys(pdfLibLayers).length} layer names from OCG`);
  console.log(`  - Can access layer Intent and Usage metadata`);
  console.log(`  - Layer names: ${Object.keys(pdfLibLayers).slice(0, 10).join(', ')}${Object.keys(pdfLibLayers).length > 10 ? '...' : ''}`);

  console.log('\n✓ PDF.js approach:');
  console.log(`  - Found ${pdfjsData.markedContentCount} marked content sections`);
  console.log(`  - Can track BDC/EMC operations for layer association`);
  console.log(`  - Provides operator-level details for content stream parsing`);

  console.log('\n📊 Analysis:');
  console.log(`  - pdf-lib is better for: Getting layer NAMES from OCG`);
  console.log(`  - PDF.js is better for: Associating CONTENT with layers via marked content`);
  console.log(`  - Current issue: We have layer names but paths aren\'t properly associated`);
  console.log(`  - Solution: Use BOTH - pdf-lib for names, improve content stream parsing to track BDC/EMC`);
}

compareApproaches().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
