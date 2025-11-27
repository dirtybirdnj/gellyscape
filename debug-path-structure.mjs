/**
 * Debug the actual path structure to see what fields exist
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function debugPaths() {
  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = contents?.array || [contents];
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));

  // Build layer map
  const catalog = pdfDoc.catalog;
  const ocProperties = catalog.dict.get(PDFName.of('OCProperties'));
  const layerNames = {};
  const properties = resources?.get(PDFName.of('Properties'));

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

  // Parse first stream
  const streamRef = contentStreams[0];
  const stream = context.lookup(streamRef);
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

  console.log('=== PATH STRUCTURE ANALYSIS ===');
  console.log('');

  // Show first few paths with different characteristics
  let shown = { withLayer: 0, withoutLayer: 0, withStroke: 0, withFill: 0 };

  for (const path of result.paths) {
    if (shown.withLayer < 2 && path.layer) {
      console.log(`Path WITH layer (${path.layer}):`);
      console.log(JSON.stringify(path, null, 2).substring(0, 1000));
      console.log('');
      shown.withLayer++;
    }

    if (shown.withoutLayer < 2 && !path.layer) {
      console.log('Path WITHOUT layer:');
      console.log(JSON.stringify(path, null, 2).substring(0, 1000));
      console.log('');
      shown.withoutLayer++;
    }

    if (shown.withLayer >= 2 && shown.withoutLayer >= 2) break;
  }

  // Check field names
  console.log('=== FIELD CHECK ===');
  const samplePath = result.paths[0];
  console.log('Top-level fields:', Object.keys(samplePath));
  if (samplePath.style) {
    console.log('Style fields:', Object.keys(samplePath.style));
  }

  // Check what renderer expects vs what we have
  console.log('');
  console.log('=== RENDERER EXPECTATION VS REALITY ===');
  console.log('Renderer checks: path.stroke, path.strokeColor, path.fill, path.fillColor');
  console.log('');
  console.log('Sample path has:');
  console.log('  path.stroke:', samplePath.stroke);
  console.log('  path.strokeColor:', samplePath.strokeColor);
  console.log('  path.fill:', samplePath.fill);
  console.log('  path.fillColor:', samplePath.fillColor);
  console.log('');
  console.log('  path.style:', samplePath.style);
}

debugPaths().catch(console.error);
