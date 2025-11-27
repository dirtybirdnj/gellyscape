/**
 * Debug what happens after paths are converted by pdf-processor
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

// Simulate the convertPathFormat function from pdf-processor.js
function convertPathFormat(path) {
  const operations = [];

  if (!path.subpaths || path.subpaths.length === 0) {
    return null;
  }

  const transformPoint = (point, transform) => {
    if (!transform) return point;
    let x = transform.a * point.x + transform.c * point.y + transform.e;
    let y = transform.b * point.x + transform.d * point.y + transform.f;
    y = -y;
    return { x, y };
  };

  path.subpaths.forEach(subpath => {
    if (subpath.startPoint) {
      const pt = transformPoint(subpath.startPoint, path.transform);
      operations.push({ type: 'moveto', x: pt.x, y: pt.y });
    }

    subpath.segments.forEach(segment => {
      if (segment.type === 'line') {
        const pt = transformPoint(segment.point, path.transform);
        operations.push({ type: 'lineto', x: pt.x, y: pt.y });
      } else if (segment.type === 'cubic') {
        const cp1 = transformPoint(segment.cp1, path.transform);
        const cp2 = transformPoint(segment.cp2, path.transform);
        const pt = transformPoint(segment.point, path.transform);
        operations.push({
          type: 'curveto',
          x1: cp1.x, y1: cp1.y,
          x2: cp2.x, y2: cp2.y,
          x3: pt.x, y3: pt.y
        });
      }
    });

    if (subpath.closed) {
      operations.push({ type: 'closepath' });
    }
  });

  const hexToRgb = (hex) => {
    if (!hex || !hex.startsWith('#')) return [0, 0, 0];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
  };

  return {
    operations,
    fill: path.operation === 'fill' || path.operation === 'fill-stroke',
    fillColor: path.style.fill ? hexToRgb(path.style.fill) : [0, 0, 0],
    stroke: path.operation === 'stroke' || path.operation === 'fill-stroke',
    strokeColor: path.style.stroke ? hexToRgb(path.style.stroke) : [0, 0, 0],
    strokeWidth: path.style.strokeWidth || 1,
    layer: path.layer
  };
}

async function debugConvertedPaths() {
  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = contents?.array || [contents];
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));
  const properties = resources?.get(PDFName.of('Properties'));

  // Build layer map
  const catalog = pdfDoc.catalog;
  const ocProperties = catalog.dict.get(PDFName.of('OCProperties'));
  const layerNames = {};

  if (ocProperties) {
    const ocgs = ocProperties.get(PDFName.of('OCGs'));
    if (ocgs?.array) {
      for (let i = 0; i < ocgs.array.length; i++) {
        const ocgRef = ocgs.array[i];
        const ocg = context.lookup(ocgRef);
        if (ocg?.dict) {
          const name = ocg.dict.get(PDFName.of('Name'));
          let nameStr = name?.value || name?.toString() || `Layer${i}`;
          if (nameStr.startsWith('þÿ')) {
            const utf16Data = nameStr.slice(2);
            const utf16Bytes = Buffer.from(utf16Data, 'latin1');
            nameStr = utf16Bytes.swap16().toString('utf16le');
          }
          if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
            nameStr = nameStr.slice(1, -1);
          }
          layerNames[ocgRef.toString()] = nameStr;
        }
      }
    }
  }

  const mcToLayerMap = {};
  if (properties) {
    const propDict = context.lookup(properties);
    if (propDict) {
      const entries = propDict.entries ? Array.from(propDict.entries()) : [];
      for (const [key, value] of entries) {
        const mcName = key.toString();
        const ocmdDict = context.lookup(value);
        if (ocmdDict?.dict) {
          const ocgsValue = ocmdDict.dict.get(PDFName.of('OCGs'));
          if (ocgsValue) {
            const ocgRefArray = ocgsValue.array ? ocgsValue.array : [ocgsValue];
            if (ocgRefArray.length > 0) {
              const firstOcgRef = ocgRefArray[0];
              const ocgId = firstOcgRef.toString();
              if (layerNames[ocgId]) {
                mcToLayerMap[mcName] = layerNames[ocgId];
              }
            }
          }
        }
      }
    }
  }

  // Parse and convert
  let rawPaths = [];
  for (const streamRef of contentStreams) {
    const stream = context.lookup(streamRef);
    if (!stream) continue;

    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }

    const parser = new PDFContentParser({
      layerMap: mcToLayerMap,
      pdfContext: context,
      fontDict: fontDict,
      resourcesDict: resources,
      globalLayerNames: layerNames
    });

    const result = parser.parseContentStream(rawData);
    rawPaths.push(...result.paths);
  }

  console.log('='.repeat(70));
  console.log('CONVERTED PATH ANALYSIS');
  console.log('='.repeat(70));
  console.log(`Raw paths from parser: ${rawPaths.length}`);

  // Convert paths (simulating pdf-processor)
  const convertedPaths = [];
  let nullCount = 0;

  for (const path of rawPaths) {
    const converted = convertPathFormat(path);
    if (converted !== null) {
      convertedPaths.push(converted);
    } else {
      nullCount++;
    }
  }

  console.log(`Converted paths (non-null): ${convertedPaths.length}`);
  console.log(`Null conversions (no subpaths): ${nullCount}`);
  console.log('');

  // Analyze converted paths
  const layerCounts = {};
  let withStroke = 0;
  let withFill = 0;
  let noColor = 0;

  for (const path of convertedPaths) {
    const layerName = path.layer || 'Unassigned';
    layerCounts[layerName] = (layerCounts[layerName] || 0) + 1;

    if (path.stroke && path.strokeColor) {
      withStroke++;
    } else if (path.fill && path.fillColor) {
      withFill++;
    } else {
      noColor++;
    }
  }

  console.log('Layer breakdown (converted):');
  const sorted = Object.entries(layerCounts).sort((a, b) => b[1] - a[1]);
  for (const [layer, count] of sorted) {
    console.log(`  ${layer}: ${count}`);
  }

  console.log('');
  console.log(`Paths with stroke: ${withStroke}`);
  console.log(`Paths with fill: ${withFill}`);
  console.log(`Paths with NO color: ${noColor}`);

  // Check sample unassigned paths
  console.log('');
  console.log('Sample Unassigned paths:');
  let count = 0;
  for (const path of convertedPaths) {
    if (!path.layer && count < 3) {
      console.log(JSON.stringify({
        layer: path.layer,
        stroke: path.stroke,
        strokeColor: path.strokeColor,
        fill: path.fill,
        fillColor: path.fillColor,
        operationCount: path.operations?.length
      }, null, 2));
      count++;
    }
  }
}

debugConvertedPaths().catch(console.error);
