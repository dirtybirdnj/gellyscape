/**
 * Debug why contours aren't showing despite paths being extracted
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDFContentParser = (await import('./src/pdf-content-parser.js')).default;

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function debugLayers() {
  console.log('='.repeat(70));
  console.log('DEBUG: WHY ARE CONTOURS MISSING?');
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
          const ocgId = ocgRef.toString();
          layerNames[ocgId] = nameStr;
        }
      }
    }
  }

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

  console.log('MC to Layer Map entries:', Object.keys(mcToLayerMap).length);
  console.log('Sample mappings:');
  const entries = Object.entries(mcToLayerMap).slice(0, 10);
  for (const [mc, layer] of entries) {
    console.log(`  ${mc} -> ${layer}`);
  }
  console.log('');

  // Parse content and track layer assignments
  const layerCounts = {};
  const colorsByLayer = {};
  let totalPaths = 0;

  // Sample paths from different layers
  const samplePaths = {};

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
      const layerName = path.layer || 'Unassigned';
      layerCounts[layerName] = (layerCounts[layerName] || 0) + 1;

      // Track colors
      const colorKey = path.style?.stroke || path.style?.fill || 'none';
      if (!colorsByLayer[layerName]) {
        colorsByLayer[layerName] = new Set();
      }
      colorsByLayer[layerName].add(JSON.stringify(colorKey));

      // Sample a path from each layer
      if (!samplePaths[layerName]) {
        samplePaths[layerName] = {
          operation: path.operation,
          subpathCount: path.subpaths?.length || 0,
          hasStroke: !!path.style?.stroke,
          hasFill: !!path.style?.fill,
          strokeColor: path.style?.stroke,
          fillColor: path.style?.fill,
          lineWidth: path.style?.lineWidth
        };
      }
    }
  }

  console.log('='.repeat(70));
  console.log('LAYER BREAKDOWN');
  console.log('='.repeat(70));
  console.log(`Total paths: ${totalPaths}`);
  console.log('');

  const sortedLayers = Object.entries(layerCounts).sort((a, b) => b[1] - a[1]);
  for (const [layer, count] of sortedLayers) {
    const colors = colorsByLayer[layer] ? colorsByLayer[layer].size : 0;
    console.log(`${layer}: ${count} paths, ${colors} unique colors`);
    if (samplePaths[layer]) {
      console.log(`  Sample: ${JSON.stringify(samplePaths[layer])}`);
    }
  }

  // Check for Terrain specifically - that's where contours should be
  console.log('');
  console.log('='.repeat(70));
  console.log('TERRAIN/CONTOURS ANALYSIS');
  console.log('='.repeat(70));

  const terrainLayers = sortedLayers.filter(([name]) =>
    name.toLowerCase().includes('terrain') ||
    name.toLowerCase().includes('contour')
  );

  if (terrainLayers.length === 0) {
    console.log('WARNING: No layers with "terrain" or "contour" in name found!');
  } else {
    console.log('Terrain-related layers:');
    for (const [layer, count] of terrainLayers) {
      console.log(`  ${layer}: ${count} paths`);
    }
  }

  // Check what's in Unassigned
  if (layerCounts['Unassigned']) {
    console.log('');
    console.log('Unassigned layer has', layerCounts['Unassigned'], 'paths');
    console.log('These might be the missing contours!');
  }
}

debugLayers().catch(console.error);
