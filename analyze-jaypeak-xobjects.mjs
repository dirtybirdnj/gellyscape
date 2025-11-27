/**
 * Deep analysis of Jay Peak PDF XObjects to understand where paths come from
 * and why colors might be missing
 */

import fs from 'fs';
import { PDFDocument, PDFName, PDFDict, PDFStream } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeXObjects() {
  console.log('='.repeat(70));
  console.log('JAY PEAK XOBJECT ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjectDict = resources?.get(PDFName.of('XObject'));

  if (!xobjectDict) {
    console.log('No XObject dictionary found');
    return;
  }

  const xobjects = context.lookup(xobjectDict);
  const entries = xobjects.entries ? Array.from(xobjects.entries()) : [];

  console.log(`Found ${entries.length} XObjects`);
  console.log('');

  // Analyze each XObject
  let totalPaths = 0;
  const xobjectStats = [];

  for (const [name, ref] of entries) {
    const xobject = context.lookup(ref);
    if (!xobject) continue;

    const subtype = xobject.dict?.get(PDFName.of('Subtype'))?.toString();
    if (subtype !== '/Form') continue;

    // Get the content stream
    let content = '';
    try {
      let rawData = xobject.getContents();
      const filter = xobject.dict?.get(PDFName.of('Filter'));
      if (filter?.toString() === '/FlateDecode') {
        rawData = zlib.inflateSync(Buffer.from(rawData));
      }
      content = rawData.toString('latin1');
    } catch (e) {
      continue;
    }

    // Count paths and analyze colors
    const lines = content.split('\n');
    let pathCount = 0;
    let strokeCount = 0;
    let fillCount = 0;
    let currentStrokeColor = null;
    let currentFillColor = null;
    const strokeColors = {};
    const fillColors = {};
    let hasExplicitColor = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Track color settings
      const rgStroke = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
      const rgFill = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
      const grayStroke = trimmed.match(/^([\d.]+)\s+G$/);
      const grayFill = trimmed.match(/^([\d.]+)\s+g$/);

      if (rgStroke) {
        hasExplicitColor = true;
        currentStrokeColor = `rgb(${Math.round(rgStroke[1]*255)},${Math.round(rgStroke[2]*255)},${Math.round(rgStroke[3]*255)})`;
      }
      if (rgFill) {
        hasExplicitColor = true;
        currentFillColor = `rgb(${Math.round(rgFill[1]*255)},${Math.round(rgFill[2]*255)},${Math.round(rgFill[3]*255)})`;
      }
      if (grayStroke) {
        hasExplicitColor = true;
        const g = Math.round(parseFloat(grayStroke[1]) * 255);
        currentStrokeColor = `rgb(${g},${g},${g})`;
      }
      if (grayFill) {
        hasExplicitColor = true;
        const g = Math.round(parseFloat(grayFill[1]) * 255);
        currentFillColor = `rgb(${g},${g},${g})`;
      }

      // Count paths
      if (trimmed === 'S' || trimmed === 's') {
        pathCount++;
        strokeCount++;
        if (currentStrokeColor) {
          strokeColors[currentStrokeColor] = (strokeColors[currentStrokeColor] || 0) + 1;
        } else {
          strokeColors['(no color set)'] = (strokeColors['(no color set)'] || 0) + 1;
        }
      }
      if (trimmed === 'f' || trimmed === 'F' || trimmed === 'f*') {
        pathCount++;
        fillCount++;
        if (currentFillColor) {
          fillColors[currentFillColor] = (fillColors[currentFillColor] || 0) + 1;
        } else {
          fillColors['(no color set)'] = (fillColors['(no color set)'] || 0) + 1;
        }
      }
      if (trimmed === 'B' || trimmed === 'B*' || trimmed === 'b' || trimmed === 'b*') {
        pathCount++;
        strokeCount++;
        fillCount++;
      }
    }

    if (pathCount > 0) {
      totalPaths += pathCount;
      xobjectStats.push({
        name: name.toString(),
        pathCount,
        strokeCount,
        fillCount,
        hasExplicitColor,
        strokeColors,
        fillColors,
        contentLength: content.length
      });
    }
  }

  console.log(`Total paths in XObjects: ${totalPaths}`);
  console.log('');

  // Sort by path count
  xobjectStats.sort((a, b) => b.pathCount - a.pathCount);

  console.log('=== TOP XOBJECTS BY PATH COUNT ===');
  for (const stat of xobjectStats.slice(0, 20)) {
    console.log(`\n${stat.name}: ${stat.pathCount} paths (${stat.strokeCount} strokes, ${stat.fillCount} fills)`);
    console.log(`  Has explicit color in XObject: ${stat.hasExplicitColor}`);
    if (Object.keys(stat.strokeColors).length > 0) {
      console.log(`  Stroke colors: ${Object.entries(stat.strokeColors).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(', ')}`);
    }
    if (Object.keys(stat.fillColors).length > 0) {
      console.log(`  Fill colors: ${Object.entries(stat.fillColors).slice(0, 5).map(([c, n]) => `${c}(${n})`).join(', ')}`);
    }
  }

  // Find XObjects with NO explicit color
  const noColorXObjects = xobjectStats.filter(s => !s.hasExplicitColor);
  console.log('');
  console.log('=== XOBJECTS WITH NO EXPLICIT COLOR ===');
  console.log(`Count: ${noColorXObjects.length}`);
  console.log(`Total paths without explicit color: ${noColorXObjects.reduce((sum, s) => sum + s.pathCount, 0)}`);

  // Now analyze HOW these XObjects are invoked from the main content stream
  console.log('');
  console.log('=== XOBJECT INVOCATION ANALYSIS ===');
  console.log('Looking at how XObjects are called and what color state is active...');

  // Get main content stream
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = contents?.array || [contents];
  const streamRef = contentStreams[0];
  const stream = context.lookup(streamRef);
  let rawData = stream.getContents();
  const filter = stream.dict?.get(PDFName.of('Filter'));
  if (filter?.toString() === '/FlateDecode') {
    rawData = zlib.inflateSync(Buffer.from(rawData));
  }
  const mainContent = rawData.toString('latin1');

  // Find Do operators (XObject invocations) and track color state
  const mainLines = mainContent.split('\n');
  let currentLayer = null;
  let currentStrokeColor = null;
  let currentFillColor = null;
  const invocations = [];

  for (let i = 0; i < mainLines.length; i++) {
    const line = mainLines[i].trim();

    // Track layer
    if (line.includes('BDC')) {
      const match = line.match(/\/(\w+)\s+BDC/);
      if (match) currentLayer = match[1];
    } else if (line === 'EMC') {
      currentLayer = null;
    }

    // Track colors
    const rgStroke = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
    const rgFill = line.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
    const grayStroke = line.match(/^([\d.]+)\s+G$/);
    const grayFill = line.match(/^([\d.]+)\s+g$/);

    if (rgStroke) {
      currentStrokeColor = `rgb(${Math.round(rgStroke[1]*255)},${Math.round(rgStroke[2]*255)},${Math.round(rgStroke[3]*255)})`;
    }
    if (rgFill) {
      currentFillColor = `rgb(${Math.round(rgFill[1]*255)},${Math.round(rgFill[2]*255)},${Math.round(rgFill[3]*255)})`;
    }
    if (grayStroke) {
      const g = Math.round(parseFloat(grayStroke[1]) * 255);
      currentStrokeColor = `rgb(${g},${g},${g})`;
    }
    if (grayFill) {
      const g = Math.round(parseFloat(grayFill[1]) * 255);
      currentFillColor = `rgb(${g},${g},${g})`;
    }

    // Track XObject invocations
    const doMatch = line.match(/^\/(\w+)\s+Do$/);
    if (doMatch) {
      invocations.push({
        xobject: doMatch[1],
        layer: currentLayer,
        strokeColor: currentStrokeColor,
        fillColor: currentFillColor
      });
    }
  }

  console.log(`Found ${invocations.length} XObject invocations`);
  console.log('');

  // Group by layer and show color state
  const byLayer = {};
  for (const inv of invocations) {
    const layer = inv.layer || '(no layer)';
    if (!byLayer[layer]) byLayer[layer] = [];
    byLayer[layer].push(inv);
  }

  console.log('XObject invocations by layer:');
  for (const [layer, invs] of Object.entries(byLayer)) {
    console.log(`\n${layer}: ${invs.length} invocations`);
    // Show unique stroke colors used
    const strokeColors = [...new Set(invs.map(i => i.strokeColor))];
    const fillColors = [...new Set(invs.map(i => i.fillColor))];
    console.log(`  Stroke colors active: ${strokeColors.join(', ') || '(none)'}`);
    console.log(`  Fill colors active: ${fillColors.join(', ') || '(none)'}`);
    console.log(`  XObjects called: ${invs.slice(0, 10).map(i => i.xobject).join(', ')}${invs.length > 10 ? '...' : ''}`);
  }
}

analyzeXObjects().catch(console.error);
