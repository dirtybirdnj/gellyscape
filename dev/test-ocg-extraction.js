#!/usr/bin/env node

/**
 * Diagnostic script to examine Optional Content Groups (OCG/layers) in GeoPDFs
 * This will help us understand why some vector layers (like highways) aren't being extracted
 */

const fs = require('fs');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('pdf-lib');

async function examineOCG(pdfPath) {
  console.log('=== OCG Layer Extraction Diagnostic ===\n');
  console.log('PDF:', pdfPath, '\n');

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  const catalog = pdfDoc.context.lookup(pdfDoc.catalog.dict);

  // Look for OCProperties in catalog
  const ocProperties = catalog.get(PDFName.of('OCProperties'));

  if (!ocProperties) {
    console.log('❌ No OCProperties found in PDF catalog');
    return;
  }

  console.log('✓ OCProperties found');

  // Dereference if needed
  const ocPropsDict = pdfDoc.context.lookup(ocProperties);

  // Get OCGs array (all optional content groups)
  const ocgs = ocPropsDict.get(PDFName.of('OCGs'));
  if (!ocgs) {
    console.log('❌ No OCGs array found');
    return;
  }

  const ocgsArray = pdfDoc.context.lookup(ocgs);
  console.log(`✓ Found ${ocgsArray.size()} OCG entries\n`);

  console.log('=== All Optional Content Groups ===\n');

  const layerMap = new Map();

  for (let i = 0; i < ocgsArray.size(); i++) {
    const ocgRef = ocgsArray.get(i);
    const ocgDict = pdfDoc.context.lookup(ocgRef);

    if (!ocgDict || !(ocgDict instanceof PDFDict)) {
      console.log(`  ${i + 1}. [Invalid OCG]`);
      continue;
    }

    // Get the layer name
    const nameObj = ocgDict.get(PDFName.of('Name'));
    const name = nameObj ? pdfDoc.context.lookup(nameObj).decodeText() : 'Unnamed';

    // Get the type (should be 'OCG')
    const typeObj = ocgDict.get(PDFName.of('Type'));
    const type = typeObj ? typeObj.toString() : 'N/A';

    // Get Intent (usually /View or /Design)
    const intentObj = ocgDict.get(PDFName.of('Intent'));
    let intent = 'N/A';
    if (intentObj) {
      const intentResolved = pdfDoc.context.lookup(intentObj);
      if (intentResolved instanceof PDFArray) {
        intent = intentResolved.asArray().map(i => i.toString()).join(', ');
      } else {
        intent = intentResolved.toString();
      }
    }

    // Get Usage dictionary (contains hints about content type)
    const usageObj = ocgDict.get(PDFName.of('Usage'));
    let usageInfo = '';
    if (usageObj) {
      const usageDict = pdfDoc.context.lookup(usageObj);
      if (usageDict instanceof PDFDict) {
        const keys = usageDict.entries().map(([key]) => key.toString());
        usageInfo = ` [Usage: ${keys.join(', ')}]`;
      }
    }

    console.log(`  ${(i + 1).toString().padStart(2, ' ')}. "${name}"`);
    console.log(`      Type: ${type}, Intent: ${intent}${usageInfo}`);
    console.log(`      Ref: ${ocgRef.toString()}`);
    console.log();

    // Store for later analysis
    layerMap.set(name, {
      ref: ocgRef.toString(),
      type,
      intent,
      usage: usageInfo
    });
  }

  // Get D (Default) configuration
  const dConfig = ocPropsDict.get(PDFName.of('D'));
  if (dConfig) {
    console.log('=== Default Configuration (D) ===\n');
    const dDict = pdfDoc.context.lookup(dConfig);

    if (dDict instanceof PDFDict) {
      // Get BaseState
      const baseState = dDict.get(PDFName.of('BaseState'));
      console.log('BaseState:', baseState ? baseState.toString() : 'N/A');

      // Get ON array (layers visible by default)
      const onArray = dDict.get(PDFName.of('ON'));
      if (onArray) {
        const onResolved = pdfDoc.context.lookup(onArray);
        if (onResolved instanceof PDFArray) {
          console.log(`ON (visible by default): ${onResolved.size()} layers`);
        }
      }

      // Get OFF array (layers hidden by default)
      const offArray = dDict.get(PDFName.of('OFF'));
      if (offArray) {
        const offResolved = pdfDoc.context.lookup(offArray);
        if (offResolved instanceof PDFArray) {
          console.log(`OFF (hidden by default): ${offResolved.size()} layers`);
        }
      }

      // Get Order (display order)
      const order = dDict.get(PDFName.of('Order'));
      if (order) {
        const orderResolved = pdfDoc.context.lookup(order);
        console.log(`Order: ${orderResolved instanceof PDFArray ? orderResolved.size() + ' items' : 'N/A'}`);
      }
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total OCG layers found: ${layerMap.size}`);
  console.log('\nLayer names:');
  Array.from(layerMap.keys()).forEach(name => {
    console.log(`  - ${name}`);
  });
}

// Run with sample PDF
const pdfPath = process.argv[2] || './samples/VT_Burlington_20240809_TM_geo.pdf';
examineOCG(pdfPath).catch(console.error);
