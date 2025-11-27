/**
 * Analyze ALL content streams in Jay Peak PDF
 * Find where the 6,298 paths are coming from
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeStreams() {
  console.log('='.repeat(70));
  console.log('JAY PEAK CONTENT STREAMS ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get content streams - could be array
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];

  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  console.log(`Number of content streams: ${contentStreams.length}`);
  console.log('');

  let totalPaths = 0;
  let totalPathsWithColor = 0;
  let totalPathsWithoutColor = 0;

  // Analyze each stream
  for (let streamIdx = 0; streamIdx < contentStreams.length; streamIdx++) {
    const streamRef = contentStreams[streamIdx];
    const stream = context.lookup(streamRef);

    if (!stream) {
      console.log(`Stream ${streamIdx}: null`);
      continue;
    }

    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }
    const content = rawData.toString('latin1');

    // Count paths and analyze colors
    const lines = content.split('\n');
    let pathCount = 0;
    let pathsWithStrokeColor = 0;
    let pathsWithFillColor = 0;
    let pathsWithNoColor = 0;
    let currentStrokeColor = null;
    let currentFillColor = null;
    let currentLayer = null;

    const layerStats = {};
    const colorStats = { stroke: {}, fill: {} };

    for (const line of lines) {
      const trimmed = line.trim();

      // Track layer
      if (trimmed.includes('BDC')) {
        const match = trimmed.match(/\/(\w+)\s+BDC/);
        if (match) currentLayer = match[1];
      } else if (trimmed === 'EMC') {
        currentLayer = null;
      }

      // Track colors
      const rgStroke = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
      const rgFill = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
      const grayStroke = trimmed.match(/^([\d.]+)\s+G$/);
      const grayFill = trimmed.match(/^([\d.]+)\s+g$/);

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

      // Track paths
      const isStroke = trimmed === 'S' || trimmed === 's';
      const isFill = trimmed === 'f' || trimmed === 'F' || trimmed === 'f*';
      const isBoth = trimmed === 'B' || trimmed === 'B*' || trimmed === 'b' || trimmed === 'b*';

      if (isStroke || isFill || isBoth) {
        pathCount++;

        const layer = currentLayer || '(no layer)';
        if (!layerStats[layer]) {
          layerStats[layer] = { total: 0, withColor: 0, withoutColor: 0, colors: {} };
        }
        layerStats[layer].total++;

        if (isStroke || isBoth) {
          if (currentStrokeColor) {
            pathsWithStrokeColor++;
            layerStats[layer].withColor++;
            layerStats[layer].colors[currentStrokeColor] = (layerStats[layer].colors[currentStrokeColor] || 0) + 1;
            colorStats.stroke[currentStrokeColor] = (colorStats.stroke[currentStrokeColor] || 0) + 1;
          } else {
            pathsWithNoColor++;
            layerStats[layer].withoutColor++;
          }
        }
        if (isFill || isBoth) {
          if (currentFillColor) {
            pathsWithFillColor++;
            if (!isStroke && !isBoth) {
              layerStats[layer].withColor++;
              layerStats[layer].colors[currentFillColor] = (layerStats[layer].colors[currentFillColor] || 0) + 1;
            }
            colorStats.fill[currentFillColor] = (colorStats.fill[currentFillColor] || 0) + 1;
          } else {
            if (!isStroke && !isBoth) {
              pathsWithNoColor++;
              layerStats[layer].withoutColor++;
            }
          }
        }
      }
    }

    totalPaths += pathCount;
    totalPathsWithColor += pathsWithStrokeColor + pathsWithFillColor;
    totalPathsWithoutColor += pathsWithNoColor;

    console.log(`=== STREAM ${streamIdx} ===`);
    console.log(`Size: ${content.length} bytes`);
    console.log(`Paths: ${pathCount}`);
    console.log(`  With stroke color: ${pathsWithStrokeColor}`);
    console.log(`  With fill color: ${pathsWithFillColor}`);
    console.log(`  Without any color: ${pathsWithNoColor}`);
    console.log('');

    // Show layer breakdown for this stream
    console.log('By layer:');
    const sortedLayers = Object.entries(layerStats).sort((a, b) => b[1].total - a[1].total);
    for (const [layer, stats] of sortedLayers.slice(0, 10)) {
      const colorList = Object.entries(stats.colors).slice(0, 3).map(([c, n]) => `${c}(${n})`).join(', ');
      console.log(`  ${layer}: ${stats.total} paths (${stats.withColor} with color, ${stats.withoutColor} without)`);
      if (colorList) console.log(`    Colors: ${colorList}`);
    }
    console.log('');
  }

  console.log('=== TOTALS ACROSS ALL STREAMS ===');
  console.log(`Total paths: ${totalPaths}`);
  console.log(`Paths with color: ${totalPathsWithColor}`);
  console.log(`Paths without color: ${totalPathsWithoutColor}`);
}

analyzeStreams().catch(console.error);
