/**
 * Test layer assignment in Jay Peak PDF
 * Check how many paths have layer = null
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function testLayerAssignment() {
  console.log('='.repeat(70));
  console.log('LAYER ASSIGNMENT TEST');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get content streams
  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = contents?.array || [contents];

  // Get resources
  const resources = pageDict.get(PDFName.of('Resources'));
  const fontDict = resources?.get(PDFName.of('Font'));
  const properties = resources?.get(PDFName.of('Properties'));

  // Build layer map (the SAME WAY pdf-processor does)
  // First, get OCG layer names from the catalog
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
          // Handle UTF-16 BOM
          if (nameStr.startsWith('þÿ')) {
            const utf16Data = nameStr.slice(2);
            const utf16Bytes = Buffer.from(utf16Data, 'latin1');
            nameStr = utf16Bytes.swap16().toString('utf16le');
          }
          if (nameStr.startsWith('(') && nameStr.endsWith(')')) {
            nameStr = nameStr.slice(1, -1);
          }
          const ocgId = ocgRef.toString();
          layerNames[ocgId] = nameStr;
        }
      }
    }
  }

  console.log('OCG Layer Names (from catalog):');
  console.log(JSON.stringify(layerNames, null, 2));
  console.log('');

  // Build MC to layer map from Properties
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

  console.log('MC to Layer Map (from Properties):');
  console.log(JSON.stringify(mcToLayerMap, null, 2));
  console.log('');

  // Now parse and check layer assignments
  let totalPaths = 0;
  let pathsWithLayer = 0;
  let pathsWithoutLayer = 0;
  const layerCounts = {};
  const nullLayerSample = [];

  for (let i = 0; i < contentStreams.length; i++) {
    const streamRef = contentStreams[i];
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

    for (const path of result.paths) {
      totalPaths++;
      if (path.layer) {
        pathsWithLayer++;
        layerCounts[path.layer] = (layerCounts[path.layer] || 0) + 1;
      } else {
        pathsWithoutLayer++;
        if (nullLayerSample.length < 5) {
          nullLayerSample.push({
            operation: path.operation,
            subpathCount: path.subpaths?.length || 0,
            hasStroke: !!path.style?.stroke,
            hasFill: !!path.style?.fill
          });
        }
      }
    }
  }

  console.log('='.repeat(70));
  console.log('LAYER ASSIGNMENT RESULTS');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Total paths: ${totalPaths}`);
  console.log(`Paths WITH layer: ${pathsWithLayer} (${(pathsWithLayer/totalPaths*100).toFixed(1)}%)`);
  console.log(`Paths WITHOUT layer: ${pathsWithoutLayer} (${(pathsWithoutLayer/totalPaths*100).toFixed(1)}%)`);
  console.log('');

  console.log('Paths by layer:');
  const sortedLayers = Object.entries(layerCounts).sort((a, b) => b[1] - a[1]);
  for (const [layer, count] of sortedLayers) {
    console.log(`  ${layer}: ${count}`);
  }

  if (nullLayerSample.length > 0) {
    console.log('\nSample of paths without layer:');
    for (const sample of nullLayerSample) {
      console.log(`  ${JSON.stringify(sample)}`);
    }
  }
}

testLayerAssignment().catch(console.error);
