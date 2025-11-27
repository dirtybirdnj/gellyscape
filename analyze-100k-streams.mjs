/**
 * Analyze 100K map content streams using the same approach as Jay Peak
 * Compare structure to 7.5-minute quads
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

// 100K map sample (from samples directory)
const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

// 7.5-minute quad for comparison (from samples directory)
const PDF_PATH_75K = './samples/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeStreams(pdfPath, label) {
  console.log('\n' + '='.repeat(70));
  console.log(`ANALYZING: ${label}`);
  console.log('='.repeat(70));
  console.log(`File: ${pdfPath.split('/').pop()}`);

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;

  // Get metadata
  const metadata = {
    title: pdfDoc.getTitle(),
    creator: pdfDoc.getCreator(),
    producer: pdfDoc.getProducer(),
    subject: pdfDoc.getSubject()
  };
  console.log('\nMetadata:');
  console.log(`  Title: ${metadata.title}`);
  console.log(`  Creator: ${metadata.creator}`);
  console.log(`  Subject: ${metadata.subject}`);

  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;
  const { width, height } = page.getSize();
  console.log(`\nPage dimensions: ${width} x ${height} pts`);

  // Get content streams
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];
  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  console.log(`\nContent streams: ${contentStreams.length}`);

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjectDict = resources?.get(PDFName.of('XObject'));

  // Count XObjects
  let xobjectCount = 0;
  let formXObjectCount = 0;
  if (xobjectDict) {
    const xobjects = context.lookup(xobjectDict);
    const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];
    xobjectCount = entries.length;

    for (const [name, ref] of entries) {
      const xobject = context.lookup(ref);
      const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
      if (subtype === '/Form') formXObjectCount++;
    }
  }
  console.log(`XObjects: ${xobjectCount} total, ${formXObjectCount} Form XObjects`);

  // Analyze each content stream
  let totalPaths = 0;
  let totalPathsWithColor = 0;
  let totalPathsWithoutColor = 0;
  let totalDoOperators = 0;

  // Track graphics state carryover
  let carryOverStroke = null;
  let carryOverFill = null;

  for (let streamIdx = 0; streamIdx < contentStreams.length; streamIdx++) {
    const streamRef = contentStreams[streamIdx];
    const stream = context.lookup(streamRef);

    if (!stream) continue;

    let rawData;
    try {
      rawData = stream.getContents();
      const filter = stream.dict?.get(PDFName.of('Filter'));
      if (filter?.toString() === '/FlateDecode') {
        rawData = zlib.inflateSync(Buffer.from(rawData));
      }
    } catch (e) {
      console.log(`  Stream ${streamIdx}: Error decompressing`);
      continue;
    }

    const content = rawData.toString('latin1');
    const lines = content.split('\n');

    let pathCount = 0;
    let pathsWithColor = 0;
    let pathsWithoutColor = 0;
    let doCount = 0;
    let currentStroke = carryOverStroke;
    let currentFill = carryOverFill;
    let layerCounts = {};

    for (const line of lines) {
      const trimmed = line.trim();

      // Track colors
      const rgStroke = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
      const rgFill = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
      const grayStroke = trimmed.match(/^([\d.]+)\s+G$/);
      const grayFill = trimmed.match(/^([\d.]+)\s+g$/);

      if (rgStroke) currentStroke = `rgb(${Math.round(rgStroke[1]*255)},${Math.round(rgStroke[2]*255)},${Math.round(rgStroke[3]*255)})`;
      if (rgFill) currentFill = `rgb(${Math.round(rgFill[1]*255)},${Math.round(rgFill[2]*255)},${Math.round(rgFill[3]*255)})`;
      if (grayStroke) { const g = Math.round(parseFloat(grayStroke[1]) * 255); currentStroke = `rgb(${g},${g},${g})`; }
      if (grayFill) { const g = Math.round(parseFloat(grayFill[1]) * 255); currentFill = `rgb(${g},${g},${g})`; }

      // Track layers
      if (trimmed.includes('BDC')) {
        const match = trimmed.match(/\/(\w+)\s+BDC/);
        if (match) {
          const layer = match[1];
          layerCounts[layer] = (layerCounts[layer] || 0);
        }
      }

      // Count paths
      const isStroke = trimmed === 'S' || trimmed === 's';
      const isFill = trimmed === 'f' || trimmed === 'F' || trimmed === 'f*';
      const isBoth = trimmed === 'B' || trimmed === 'B*' || trimmed === 'b' || trimmed === 'b*';

      if (isStroke || isFill || isBoth) {
        pathCount++;
        if ((isStroke || isBoth) && currentStroke) pathsWithColor++;
        else if ((isFill) && currentFill) pathsWithColor++;
        else pathsWithoutColor++;
      }

      // Count Do operators (XObject invocations)
      if (trimmed.match(/^\/\w+\s+Do$/)) {
        doCount++;
      }
    }

    // Update carryover
    carryOverStroke = currentStroke;
    carryOverFill = currentFill;

    totalPaths += pathCount;
    totalPathsWithColor += pathsWithColor;
    totalPathsWithoutColor += pathsWithoutColor;
    totalDoOperators += doCount;

    if (pathCount > 0 || doCount > 0) {
      console.log(`\n  Stream ${streamIdx}: ${pathCount} paths, ${doCount} Do operators`);
      console.log(`    With color: ${pathsWithColor}, Without: ${pathsWithoutColor}`);
      console.log(`    Ending stroke: ${currentStroke || 'none'}`);
    }
  }

  console.log('\n--- TOTALS ---');
  console.log(`Total paths in main streams: ${totalPaths}`);
  console.log(`  With color: ${totalPathsWithColor}`);
  console.log(`  Without color: ${totalPathsWithoutColor}`);
  console.log(`Total Do operators (XObject calls): ${totalDoOperators}`);

  // If there are Form XObjects, analyze them
  if (formXObjectCount > 0) {
    console.log('\n--- FORM XOBJECTS ANALYSIS ---');
    const xobjects = context.lookup(xobjectDict);
    const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];

    let totalXObjectPaths = 0;
    let xobjectSummary = [];

    for (const [name, ref] of entries) {
      const xobject = context.lookup(ref);
      const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
      if (subtype !== '/Form') continue;

      // Get XObject content
      let xoContent = '';
      try {
        let rawData = xobject.getContents();
        const filter = xobject.dict?.get(PDFName.of('Filter'));
        if (filter?.toString() === '/FlateDecode') {
          rawData = zlib.inflateSync(Buffer.from(rawData));
        }
        xoContent = rawData.toString('latin1');
      } catch (e) {
        continue;
      }

      // Get Matrix
      const matrix = xobject.dict?.get(PDFName.of('Matrix'));
      let matrixStr = 'identity';
      if (matrix?.array) {
        const m = matrix.array.map(n => n.value || n.toString());
        matrixStr = `[${m.join(', ')}]`;
      }

      // Get BBox
      const bbox = xobject.dict?.get(PDFName.of('BBox'));
      let bboxStr = 'none';
      if (bbox?.array) {
        const b = bbox.array.map(n => n.value || n.toString());
        bboxStr = `[${b.join(', ')}]`;
      }

      // Count paths
      let pathCount = 0;
      const lines = xoContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === 'S' || trimmed === 's' || trimmed === 'f' || trimmed === 'F' ||
            trimmed === 'f*' || trimmed === 'B' || trimmed === 'B*') {
          pathCount++;
        }
      }

      if (pathCount > 0) {
        totalXObjectPaths += pathCount;
        xobjectSummary.push({
          name: name.toString(),
          paths: pathCount,
          matrix: matrixStr,
          bbox: bboxStr
        });
      }
    }

    console.log(`Total paths in Form XObjects: ${totalXObjectPaths}`);
    console.log('\nTop Form XObjects by path count:');
    xobjectSummary.sort((a, b) => b.paths - a.paths);
    for (const xo of xobjectSummary.slice(0, 10)) {
      console.log(`  ${xo.name}: ${xo.paths} paths`);
      console.log(`    Matrix: ${xo.matrix}`);
      console.log(`    BBox: ${xo.bbox}`);
    }
  }

  // Check for LGIDict (geospatial info)
  const lgiDict = pageDict.get(PDFName.of('LGIDict'));
  if (lgiDict) {
    console.log('\n--- GEOSPATIAL INFO (LGIDict) ---');
    console.log('LGIDict found - has geospatial registration');
  }

  // Check for VP (Viewport)
  const vp = pageDict.get(PDFName.of('VP'));
  if (vp) {
    console.log('\n--- VIEWPORTS ---');
    const vpArray = vp.array || [vp];
    console.log(`Found ${vpArray.length} viewport(s)`);

    for (let i = 0; i < Math.min(vpArray.length, 3); i++) {
      const viewport = context.lookup(vpArray[i]);
      if (viewport?.dict) {
        const name = viewport.dict.get(PDFName.of('Name'))?.toString();
        const bbox = viewport.dict.get(PDFName.of('BBox'));
        let bboxStr = '';
        if (bbox?.array) {
          const b = bbox.array.map(n => n.value || parseFloat(n.toString()));
          bboxStr = `[${b.join(', ')}]`;
        }
        console.log(`  VP ${i}: ${name || 'unnamed'}, BBox: ${bboxStr}`);
      }
    }
  }

  return {
    label,
    pageWidth: width,
    pageHeight: height,
    streamCount: contentStreams.length,
    mainStreamPaths: totalPaths,
    formXObjectCount,
    doOperators: totalDoOperators
  };
}

async function main() {
  // Analyze both formats
  const results75k = await analyzeStreams(PDF_PATH_75K, '7.5-MINUTE QUAD (24K) - Jay Peak');
  const results100k = await analyzeStreams(PDF_PATH_100K, '100K MAP - NY');

  // Comparison
  console.log('\n' + '='.repeat(70));
  console.log('COMPARISON: 7.5-MINUTE vs 100K');
  console.log('='.repeat(70));

  console.log('\n| Property | 7.5-minute (24K) | 100K |');
  console.log('|----------|------------------|------|');
  console.log(`| Page size | ${results75k.pageWidth} x ${results75k.pageHeight} | ${results100k.pageWidth} x ${results100k.pageHeight} |`);
  console.log(`| Content streams | ${results75k.streamCount} | ${results100k.streamCount} |`);
  console.log(`| Paths in main streams | ${results75k.mainStreamPaths} | ${results100k.mainStreamPaths} |`);
  console.log(`| Form XObjects | ${results75k.formXObjectCount} | ${results100k.formXObjectCount} |`);
  console.log(`| Do operators | ${results75k.doOperators} | ${results100k.doOperators} |`);

  console.log('\n--- KEY DIFFERENCES ---');
  if (results100k.formXObjectCount > results75k.formXObjectCount) {
    console.log('- 100K uses more Form XObjects (paths stored in XObjects, not main stream)');
  }
  if (results100k.doOperators > results75k.doOperators) {
    console.log('- 100K has more Do operators (XObject invocations)');
  }
  if (results100k.mainStreamPaths < results75k.mainStreamPaths) {
    console.log('- 100K has fewer paths in main content streams');
    console.log('  → Paths are likely in Form XObjects, need to extract from there');
  }
}

main().catch(console.error);
