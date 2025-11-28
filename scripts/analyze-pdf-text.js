#!/usr/bin/env node
/**
 * PDF Text Analysis Script
 * Analyzes how text is stored in different USGS GeoPDF formats
 * Run with: node scripts/analyze-pdf-text.js <path-to-pdf>
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } = require('pdf-lib');
const pako = require('pako');

async function analyzePDF(filePath) {
  console.log('='.repeat(80));
  console.log('PDF TEXT ANALYSIS');
  console.log('='.repeat(80));
  console.log(`\nFile: ${filePath}\n`);

  const fileBuffer = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(fileBuffer, {
    ignoreEncryption: true,
    updateMetadata: false
  });

  // Get PDF info
  const info = pdfDoc.getInfoDict();
  console.log('--- PDF METADATA ---');
  if (info) {
    ['Title', 'Subject', 'Creator', 'Producer', 'Keywords'].forEach(key => {
      const val = info.get(PDFName.of(key));
      if (val) console.log(`${key}: ${val.toString()}`);
    });
  }

  // Detect format
  const USGSFormatDetector = require('../src/usgs-format-detector');
  const rawInfo = {};
  if (info) {
    ['Title', 'Subject', 'Creator', 'Producer', 'Keywords', 'CreationDate'].forEach(key => {
      const val = info.get(PDFName.of(key));
      if (val) rawInfo[key] = val.toString().replace(/^\(|\)$/g, '');
    });
  }
  const detector = new USGSFormatDetector(pdfDoc, rawInfo);
  const formatInfo = await detector.detect();

  console.log('\n--- FORMAT DETECTION ---');
  console.log(`Scale: ${formatInfo.scale}`);
  console.log(`Generation: ${formatInfo.generation}`);
  console.log(`Year: ${formatInfo.year}`);
  console.log(`Is TopoBuilder: ${formatInfo.isTopobuilder}`);
  console.log(`Layer Count: ${formatInfo.layers.count}`);

  // Get pages
  const pages = pdfDoc.getPages();
  console.log(`\n--- PAGE ANALYSIS ---`);
  console.log(`Page count: ${pages.length}`);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    console.log(`\n=== PAGE ${pageIndex + 1} ===`);

    // Get page resources
    const resources = page.node.get(PDFName.of('Resources'));
    if (!resources) {
      console.log('No resources found on this page');
      continue;
    }

    // Analyze fonts
    console.log('\n--- FONTS ---');
    const fontDict = resources.get(PDFName.of('Font'));
    if (fontDict) {
      const fontEntries = fontDict instanceof PDFDict ? Array.from(fontDict.entries()) : [];
      console.log(`Found ${fontEntries.length} font(s):`);

      for (const [fontRef, fontObjRef] of fontEntries) {
        const fontObj = pdfDoc.context.lookup(fontObjRef);
        if (fontObj instanceof PDFDict) {
          const baseFont = fontObj.get(PDFName.of('BaseFont'));
          const subtype = fontObj.get(PDFName.of('Subtype'));
          const encoding = fontObj.get(PDFName.of('Encoding'));
          const toUnicode = fontObj.get(PDFName.of('ToUnicode'));

          console.log(`  ${fontRef.toString()}:`);
          console.log(`    BaseFont: ${baseFont?.toString() || 'N/A'}`);
          console.log(`    Subtype: ${subtype?.toString() || 'N/A'}`);
          console.log(`    Encoding: ${encoding?.toString() || 'N/A'}`);
          console.log(`    HasToUnicode: ${toUnicode ? 'Yes' : 'No'}`);

          // Check for embedded font data
          const fontDescriptor = fontObj.get(PDFName.of('FontDescriptor'));
          if (fontDescriptor) {
            const descriptor = pdfDoc.context.lookup(fontDescriptor);
            if (descriptor instanceof PDFDict) {
              const fontFile = descriptor.get(PDFName.of('FontFile')) ||
                              descriptor.get(PDFName.of('FontFile2')) ||
                              descriptor.get(PDFName.of('FontFile3'));
              console.log(`    Embedded: ${fontFile ? 'Yes' : 'No'}`);
            }
          }
        }
      }
    } else {
      console.log('No fonts found in page resources');
    }

    // Analyze XObjects (Form XObjects may contain text)
    console.log('\n--- XOBJECTS ---');
    const xobjectDict = resources.get(PDFName.of('XObject'));
    if (xobjectDict) {
      const xobjectEntries = xobjectDict instanceof PDFDict ? Array.from(xobjectDict.entries()) : [];
      console.log(`Found ${xobjectEntries.length} XObject(s):`);

      let formCount = 0;
      let imageCount = 0;

      for (const [xobjRef, xobjObjRef] of xobjectEntries) {
        const xobjObj = pdfDoc.context.lookup(xobjObjRef);
        if (xobjObj) {
          const subtype = xobjObj.dict?.get(PDFName.of('Subtype'));
          if (subtype?.toString() === '/Form') {
            formCount++;
            // Check if this Form XObject has its own resources (including fonts)
            const formResources = xobjObj.dict?.get(PDFName.of('Resources'));
            const formFonts = formResources?.get?.(PDFName.of('Font'));
            if (formFonts) {
              const formFontEntries = formFonts instanceof PDFDict ? Array.from(formFonts.entries()) : [];
              console.log(`  ${xobjRef.toString()} (Form): Has ${formFontEntries.length} font(s)`);
            }
          } else if (subtype?.toString() === '/Image') {
            imageCount++;
          }
        }
      }
      console.log(`  Form XObjects: ${formCount}`);
      console.log(`  Image XObjects: ${imageCount}`);
    } else {
      console.log('No XObjects found');
    }

    // Analyze content streams
    console.log('\n--- CONTENT STREAMS ---');
    const contents = page.node.get(PDFName.of('Contents'));
    if (contents) {
      const streams = [];

      if (contents instanceof PDFArray) {
        for (let i = 0; i < contents.size(); i++) {
          const streamRef = contents.get(i);
          streams.push({ ref: streamRef, index: i });
        }
      } else {
        streams.push({ ref: contents, index: 0 });
      }

      console.log(`Found ${streams.length} content stream(s)`);

      for (const { ref, index } of streams) {
        const stream = pdfDoc.context.lookup(ref);
        if (!stream) continue;

        // Decode stream
        let data;
        try {
          if (stream instanceof PDFRawStream) {
            data = stream.contents;
          } else if (stream.getContents) {
            data = stream.getContents();
          }

          const filter = stream.dict?.get(PDFName.of('Filter'));
          if (filter?.toString() === '/FlateDecode') {
            try {
              data = pako.inflate(data);
            } catch (e) {
              // Already decompressed
            }
          }

          const content = Buffer.from(data).toString('latin1');

          // Count text operators
          const btCount = (content.match(/\bBT\b/g) || []).length;
          const etCount = (content.match(/\bET\b/g) || []).length;
          const tjCount = (content.match(/\bTj\b/g) || []).length;
          const tjArrayCount = (content.match(/\bTJ\b/g) || []).length;
          const tfCount = (content.match(/\bTf\b/g) || []).length;
          const doCount = (content.match(/\bDo\b/g) || []).length;

          console.log(`\n  Stream ${index}:`);
          console.log(`    Size: ${content.length} bytes`);
          console.log(`    BT (begin text): ${btCount}`);
          console.log(`    ET (end text): ${etCount}`);
          console.log(`    Tf (set font): ${tfCount}`);
          console.log(`    Tj (show text): ${tjCount}`);
          console.log(`    TJ (show text array): ${tjArrayCount}`);
          console.log(`    Do (invoke XObject): ${doCount}`);

          // Show sample text operations
          if (btCount > 0 || tjCount > 0 || tjArrayCount > 0) {
            console.log('\n    Sample text operations:');

            // Find text blocks
            const textBlockRegex = /BT[\s\S]*?ET/g;
            const textBlocks = content.match(textBlockRegex) || [];

            // Show first 3 text blocks
            textBlocks.slice(0, 3).forEach((block, i) => {
              console.log(`\n    --- Text Block ${i + 1} (truncated) ---`);
              const truncated = block.length > 500 ? block.substring(0, 500) + '...' : block;
              console.log(`    ${truncated.replace(/\n/g, '\n    ')}`);
            });

            if (textBlocks.length > 3) {
              console.log(`\n    ... and ${textBlocks.length - 3} more text blocks`);
            }
          }

        } catch (error) {
          console.log(`  Stream ${index}: Error decoding - ${error.message}`);
        }
      }
    } else {
      console.log('No content streams found');
    }

    // Check for text in XObjects
    console.log('\n--- TEXT IN FORM XOBJECTS ---');
    if (xobjectDict) {
      const xobjectEntries = xobjectDict instanceof PDFDict ? Array.from(xobjectDict.entries()) : [];

      let textInXObjects = 0;

      for (const [xobjRef, xobjObjRef] of xobjectEntries) {
        const xobjObj = pdfDoc.context.lookup(xobjObjRef);
        if (!xobjObj) continue;

        const subtype = xobjObj.dict?.get(PDFName.of('Subtype'));
        if (subtype?.toString() !== '/Form') continue;

        // Decode XObject stream
        let data;
        try {
          if (xobjObj instanceof PDFRawStream) {
            data = xobjObj.contents;
          } else if (xobjObj.getContents) {
            data = xobjObj.getContents();
          }

          const filter = xobjObj.dict?.get(PDFName.of('Filter'));
          if (filter?.toString() === '/FlateDecode') {
            try {
              data = pako.inflate(data);
            } catch (e) {
              // Already decompressed
            }
          }

          if (!data) continue;

          const content = Buffer.from(data).toString('latin1');
          const btCount = (content.match(/\bBT\b/g) || []).length;

          if (btCount > 0) {
            textInXObjects++;
            const tjCount = (content.match(/\bTj\b/g) || []).length;
            const tjArrayCount = (content.match(/\bTJ\b/g) || []).length;
            console.log(`  ${xobjRef.toString()}: ${btCount} text blocks, ${tjCount} Tj, ${tjArrayCount} TJ`);

            // Show sample
            const textBlockRegex = /BT[\s\S]*?ET/g;
            const textBlocks = content.match(textBlockRegex) || [];
            if (textBlocks.length > 0) {
              const sample = textBlocks[0].substring(0, 300);
              console.log(`    Sample: ${sample.replace(/\n/g, ' ')}...`);
            }
          }
        } catch (error) {
          // Skip errors
        }
      }

      if (textInXObjects === 0) {
        console.log('  No text found in Form XObjects');
      } else {
        console.log(`\n  Total Form XObjects with text: ${textInXObjects}`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`
Format: ${formatInfo.scale} / ${formatInfo.generation}
TopoBuilder: ${formatInfo.isTopobuilder ? 'Yes' : 'No'}

TEXT LOCATION ANALYSIS:
- For 7.5-minute (24k) maps: Text is typically in main content streams
- For 100k maps: Text may be in Form XObjects
- For 2025 TopoBuilder: Text is in Form XObjects, referenced by layer

NEXT STEPS:
1. If text is in main content streams: Parse BT/ET blocks directly
2. If text is in Form XObjects: Need to recursively parse XObjects
3. Check which layers contain text (BDC/EMC markers)
`);
}

// Run if called directly
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/analyze-pdf-text.js <path-to-pdf>');
  console.log('\nLooking for PDF files in ~/Downloads...');

  const downloadsDir = path.join(process.env.HOME, 'Downloads');
  const pdfFiles = fs.readdirSync(downloadsDir)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .slice(0, 5);

  if (pdfFiles.length > 0) {
    console.log('\nFound PDF files:');
    pdfFiles.forEach(f => console.log(`  ${f}`));
    console.log('\nRun with: node scripts/analyze-pdf-text.js ~/Downloads/<filename>.pdf');
  }
} else {
  analyzePDF(args[0]).catch(console.error);
}
