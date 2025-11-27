/**
 * Analyze 250K USGS map format to compare with 100K
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_PATH_250K = './samples/VT_250K_Topo_20251121_054343748075_TM_geo.pdf';

async function analyze250K() {
  console.log('='.repeat(70));
  console.log('250K FORMAT ANALYSIS');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH_250K);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

  // Basic metadata
  console.log('\n--- PDF METADATA ---');
  console.log('Title:', pdfDoc.getTitle());
  console.log('Creator:', pdfDoc.getCreator());
  console.log('Producer:', pdfDoc.getProducer());
  console.log('Subject:', pdfDoc.getSubject());
  console.log('Keywords:', pdfDoc.getKeywords());

  const pages = pdfDoc.getPages();
  console.log('\n--- PAGE INFO ---');
  console.log('Page count:', pages.length);

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    console.log(`Page ${i + 1}: ${width} x ${height} points (${(width/72).toFixed(1)}" x ${(height/72).toFixed(1)}")`);

    const pageDict = page.node.dict;

    // Check MediaBox, CropBox, etc.
    const mediaBox = pageDict.get(PDFName.of('MediaBox'));
    const cropBox = pageDict.get(PDFName.of('CropBox'));

    if (mediaBox?.array) {
      console.log('MediaBox:', mediaBox.array.map(n => n.value || n.numberValue).join(', '));
    }
    if (cropBox?.array) {
      console.log('CropBox:', cropBox.array.map(n => n.value || n.numberValue).join(', '));
    }

    // Check Resources
    const resources = pageDict.get(PDFName.of('Resources'));
    if (resources) {
      const xobject = resources.get(PDFName.of('XObject'));
      if (xobject) {
        const xobjectDict = pdfDoc.context.lookup(xobject);
        if (xobjectDict?.entries) {
          const entries = Array.from(xobjectDict.entries());
          console.log('\n--- XOBJECTS ---');
          console.log('XObject count:', entries.length);

          for (const [key, ref] of entries.slice(0, 5)) {
            const name = key.toString();
            const obj = pdfDoc.context.lookup(ref);
            if (obj?.dict) {
              const subtype = obj.dict.get(PDFName.of('Subtype'))?.toString();
              const bbox = obj.dict.get(PDFName.of('BBox'));
              const matrix = obj.dict.get(PDFName.of('Matrix'));

              console.log(`\n  ${name}:`);
              console.log(`    Subtype: ${subtype}`);
              if (bbox?.array) {
                const bboxVals = bbox.array.map(n => n.value ?? n.numberValue);
                console.log(`    BBox: [${bboxVals.join(', ')}]`);
              }
              if (matrix?.array) {
                const matrixVals = matrix.array.map(n => n.value ?? n.numberValue);
                console.log(`    Matrix: [${matrixVals.join(', ')}]`);
              }
            }
          }
        }
      }

      // Check OCG/Properties
      const properties = resources.get(PDFName.of('Properties'));
      if (properties) {
        const propsDict = pdfDoc.context.lookup(properties);
        if (propsDict?.entries) {
          const entries = Array.from(propsDict.entries());
          console.log('\n--- OCG PROPERTIES ---');
          console.log('Property count:', entries.length);

          // Get unique layer names
          const layerNames = new Set();
          for (const [key, value] of entries) {
            const ocmdDict = pdfDoc.context.lookup(value);
            if (ocmdDict?.dict) {
              const ocgsValue = ocmdDict.dict.get(PDFName.of('OCGs'));
              if (ocgsValue) {
                const ocgRefArray = ocgsValue.array ? ocgsValue.array : [ocgsValue];
                for (const ocgRef of ocgRefArray) {
                  const ocgDict = pdfDoc.context.lookup(ocgRef);
                  if (ocgDict?.dict) {
                    const name = ocgDict.dict.get(PDFName.of('Name'));
                    if (name) {
                      layerNames.add(name.value || name.toString());
                    }
                  }
                }
              }
            }
          }
          console.log('Layer names:', Array.from(layerNames).join(', '));
        }
      }
    }

    // Parse content stream to find initial CTM
    const contents = pageDict.get(PDFName.of('Contents'));
    if (contents) {
      let streams = [];
      if (Array.isArray(contents)) {
        streams = contents;
      } else if (contents.array) {
        streams = contents.array;
      } else {
        streams = [contents];
      }

      console.log('\n--- CONTENT STREAMS ---');
      console.log('Stream count:', streams.length);

      // Analyze first stream
      if (streams.length > 0) {
        const streamRef = streams[0];
        const stream = pdfDoc.context.lookup(streamRef);
        if (stream) {
          try {
            let contentData;
            if (stream.getContents) {
              contentData = stream.getContents();
            } else if (stream.contents) {
              contentData = stream.contents;
            }

            if (contentData) {
              const text = new TextDecoder('latin1').decode(contentData);

              // Find first few cm (concat matrix) operators
              const cmMatches = text.match(/[\d\.\-\s]+cm/g);
              if (cmMatches) {
                console.log('\nFirst CTM operations:');
                for (const cm of cmMatches.slice(0, 5)) {
                  console.log(`  ${cm.trim()}`);
                }
              }

              // Find Do operators (XObject invocations)
              const doMatches = text.match(/\/\w+\s+Do/g);
              if (doMatches) {
                console.log('\nXObject invocations:');
                for (const d of doMatches.slice(0, 5)) {
                  console.log(`  ${d}`);
                }
              }

              // Count operators
              const lines = text.split('\n').length;
              console.log(`\nFirst stream: ~${lines} lines`);
            }
          } catch (e) {
            console.log('Error reading stream:', e.message);
          }
        }
      }
    }
  }

  // Now process with our processor
  console.log('\n\n--- PROCESSING WITH PDFPROCESSOR ---');
  const { default: PDFProcessor } = await import('./src/pdf-processor.js');

  const processor = new PDFProcessor(buffer);
  const result = await processor.process();

  console.log('\n--- FORMAT DETECTION ---');
  console.log(JSON.stringify(result.metadata.usgsFormat, null, 2));

  console.log('\n--- PATH STATISTICS ---');
  const paths = result.contentPaths?.paths || [];
  console.log('Total paths:', paths.length);

  // Calculate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const path of paths) {
    for (const op of path.operations || []) {
      if (typeof op.x === 'number') { minX = Math.min(minX, op.x); maxX = Math.max(maxX, op.x); }
      if (typeof op.y === 'number') { minY = Math.min(minY, op.y); maxY = Math.max(maxY, op.y); }
    }
  }

  console.log(`Bounds: X[${minX.toFixed(2)} to ${maxX.toFixed(2)}] Y[${minY.toFixed(2)} to ${maxY.toFixed(2)}]`);
  console.log(`Span: ${(maxX - minX).toFixed(2)} x ${(maxY - minY).toFixed(2)}`);

  // Layer breakdown
  const layerCounts = {};
  for (const path of paths) {
    const layer = path.layer || 'Unassigned';
    layerCounts[layer] = (layerCounts[layer] || 0) + 1;
  }

  console.log('\n--- LAYER BREAKDOWN ---');
  Object.entries(layerCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([layer, count]) => {
      console.log(`  ${layer}: ${count}`);
    });
}

analyze250K().catch(console.error);
