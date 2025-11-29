#!/usr/bin/env node

/**
 * Comprehensive USGS GeoPDF Format Analyzer
 * Analyzes PDF structure, metadata, layers, colors, and fonts across different formats
 */

const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('pdf-lib');
const zlib = require('zlib');

// Color tracking
const colorTracker = new Map();

async function analyzePDF(pdfPath) {
  console.log('\n' + '='.repeat(100));
  console.log(`ANALYZING: ${path.basename(pdfPath)}`);
  console.log('='.repeat(100));

  const buffer = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(buffer);
  const catalog = pdfDoc.context.lookup(pdfDoc.catalog.dict);

  const analysis = {
    filename: path.basename(pdfPath),
    filepath: pdfPath,
    fileSize: buffer.length,
    metadata: {},
    layers: [],
    colors: new Map(),
    fonts: new Map(),
    geospatial: {},
    structure: {}
  };

  // Extract basic metadata
  console.log('\n--- METADATA ---');

  // Get info dictionary from trailer
  try {
    // Access the raw PDF structure
    const trailerDict = pdfDoc.context.trailerInfo;

    if (trailerDict && trailerDict.Info) {
      const infoRef = trailerDict.Info;
      const infoDict = pdfDoc.context.lookup(infoRef);

      if (infoDict && infoDict instanceof PDFDict) {
        for (const [key, value] of infoDict.entries()) {
          const keyStr = key.toString().replace(/^\//, '');
          let valueStr = '';

          const resolvedValue = pdfDoc.context.lookup(value);

          // Handle different value types
          if (resolvedValue && typeof resolvedValue.decodeText === 'function') {
            valueStr = resolvedValue.decodeText();
          } else if (resolvedValue && resolvedValue.value !== undefined) {
            valueStr = resolvedValue.value;
            // Handle UTF-16 encoded strings
            if (typeof valueStr === 'string' && valueStr.startsWith('þÿ')) {
              const utf16Data = valueStr.slice(2);
              const utf16Bytes = Buffer.from(utf16Data, 'latin1');
              valueStr = utf16Bytes.swap16().toString('utf16le');
            }
          } else {
            valueStr = value.toString();
          }

          analysis.metadata[keyStr] = valueStr;
          console.log(`  ${keyStr}: ${valueStr}`);
        }
      }
    } else {
      console.log('  No Info dictionary found in trailer');
    }
  } catch (e) {
    console.log('  Error reading metadata:', e.message);
  }

  // Page info
  const pageCount = pdfDoc.getPageCount();
  const firstPage = pdfDoc.getPages()[0];
  const { width, height } = firstPage.getSize();

  analysis.structure.pageCount = pageCount;
  analysis.structure.pageSize = { width, height };

  console.log(`\n--- PAGE STRUCTURE ---`);
  console.log(`  Pages: ${pageCount}`);
  console.log(`  Size: ${width} x ${height} pts (${(width/72).toFixed(2)}" x ${(height/72).toFixed(2)}")`);

  // Extract OCG layers
  console.log('\n--- OPTIONAL CONTENT GROUPS (LAYERS) ---');
  const ocProperties = catalog.get(PDFName.of('OCProperties'));

  if (ocProperties) {
    const ocPropsDict = pdfDoc.context.lookup(ocProperties);
    const ocgs = ocPropsDict.get(PDFName.of('OCGs'));

    if (ocgs) {
      const ocgsArray = pdfDoc.context.lookup(ocgs);
      console.log(`  Total OCGs: ${ocgsArray.size()}\n`);

      for (let i = 0; i < ocgsArray.size(); i++) {
        const ocgRef = ocgsArray.get(i);
        const ocgDict = pdfDoc.context.lookup(ocgRef);

        if (ocgDict instanceof PDFDict) {
          const nameObj = ocgDict.get(PDFName.of('Name'));
          let name = 'Unnamed';

          if (nameObj) {
            const nameValue = pdfDoc.context.lookup(nameObj);
            let rawName = nameValue.value || nameValue.toString();

            // Handle UTF-16 encoding
            if (rawName.startsWith('þÿ')) {
              const utf16Data = rawName.slice(2);
              const utf16Bytes = Buffer.from(utf16Data, 'latin1');
              name = utf16Bytes.swap16().toString('utf16le');
            } else {
              name = rawName;
            }

            if (name.startsWith('(') && name.endsWith(')')) {
              name = name.slice(1, -1);
            }
          }

          // Get intent
          const intentObj = ocgDict.get(PDFName.of('Intent'));
          let intent = [];
          if (intentObj) {
            const intentResolved = pdfDoc.context.lookup(intentObj);
            if (intentResolved instanceof PDFArray) {
              intent = intentResolved.asArray().map(i => i.toString());
            } else {
              intent = [intentResolved.toString()];
            }
          }

          analysis.layers.push({
            index: i,
            name,
            intent,
            ref: ocgRef.toString()
          });

          console.log(`  ${(i + 1).toString().padStart(3, ' ')}. ${name}`);
          if (intent.length > 0) {
            console.log(`       Intent: ${intent.join(', ')}`);
          }
        }
      }
    }
  } else {
    console.log('  No OCProperties found');
  }

  // Extract colors from content streams
  console.log('\n--- COLOR ANALYSIS ---');
  await extractColors(pdfDoc, analysis);

  // Extract font information
  console.log('\n--- FONT ANALYSIS ---');
  await extractFonts(pdfDoc, analysis);

  // Geospatial metadata
  console.log('\n--- GEOSPATIAL METADATA ---');
  await extractGeospatial(pdfDoc, catalog, analysis);

  return analysis;
}

async function extractColors(pdfDoc, analysis) {
  const pages = pdfDoc.getPages();
  const colorMap = new Map();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageDict = page.node.dict;
    const contents = pageDict.get(PDFName.of('Contents'));

    if (!contents) continue;

    let streams = [];
    if (contents.array) {
      streams = contents.array.map(ref => pdfDoc.context.lookup(ref));
    } else {
      streams = [pdfDoc.context.lookup(contents)];
    }

    for (const stream of streams) {
      if (!stream) continue;

      let contentData = stream.getContents();

      // Decompress if needed
      const filter = stream.dict?.get(PDFName.of('Filter'));
      if (filter && filter.toString() === '/FlateDecode') {
        try {
          contentData = zlib.inflateSync(Buffer.from(contentData));
        } catch (e) {
          continue;
        }
      }

      const content = contentData.toString('latin1');

      // Extract RGB colors
      const rgbPattern = /(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(rg|RG)/g;
      let match;
      while ((match = rgbPattern.exec(content)) !== null) {
        const r = parseFloat(match[1]);
        const g = parseFloat(match[2]);
        const b = parseFloat(match[3]);
        const type = match[4] === 'rg' ? 'fill' : 'stroke';

        const hex = rgbToHex(r, g, b);
        const key = `${hex}-${type}`;

        if (!colorMap.has(key)) {
          colorMap.set(key, {
            hex,
            rgb: [r, g, b],
            rgb255: [Math.round(r*255), Math.round(g*255), Math.round(b*255)],
            type,
            count: 0
          });
        }
        colorMap.get(key).count++;
      }

      // Extract CMYK colors
      const cmykPattern = /(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(k|K)/g;
      while ((match = cmykPattern.exec(content)) !== null) {
        const c = parseFloat(match[1]);
        const m = parseFloat(match[2]);
        const y = parseFloat(match[3]);
        const k = parseFloat(match[4]);
        const type = match[5] === 'k' ? 'fill' : 'stroke';

        const hex = cmykToHex(c, m, y, k);
        const key = `${hex}-${type}-cmyk`;

        if (!colorMap.has(key)) {
          colorMap.set(key, {
            hex,
            cmyk: [c, m, y, k],
            type,
            count: 0,
            colorSpace: 'CMYK'
          });
        }
        colorMap.get(key).count++;
      }

      // Extract grayscale colors
      const grayPattern = /(\d+\.?\d*)\s+(g|G)\s/g;
      while ((match = grayPattern.exec(content)) !== null) {
        const gray = parseFloat(match[1]);
        const type = match[2] === 'g' ? 'fill' : 'stroke';

        const hex = grayToHex(gray);
        const key = `${hex}-${type}-gray`;

        if (!colorMap.has(key)) {
          colorMap.set(key, {
            hex,
            gray,
            type,
            count: 0,
            colorSpace: 'Gray'
          });
        }
        colorMap.get(key).count++;
      }
    }
  }

  analysis.colors = colorMap;

  // Sort by usage count
  const sortedColors = Array.from(colorMap.entries())
    .sort((a, b) => b[1].count - a[1].count);

  console.log(`  Total unique colors: ${colorMap.size}`);
  console.log(`  Top 20 most used colors:\n`);

  sortedColors.slice(0, 20).forEach(([key, color], idx) => {
    const colorSpace = color.colorSpace || 'RGB';
    let colorStr = '';

    if (colorSpace === 'CMYK') {
      colorStr = `CMYK(${color.cmyk.map(v => (v*100).toFixed(0) + '%').join(', ')})`;
    } else if (colorSpace === 'Gray') {
      colorStr = `Gray(${(color.gray*100).toFixed(0)}%)`;
    } else {
      colorStr = `RGB(${color.rgb255.join(', ')})`;
    }

    console.log(`    ${(idx+1).toString().padStart(2, ' ')}. ${color.hex} ${colorStr.padEnd(25)} [${color.type.padEnd(6)}] - used ${color.count} times`);
  });
}

async function extractFonts(pdfDoc, analysis) {
  const pages = pdfDoc.getPages();
  const fontMap = new Map();

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageDict = page.node.dict;
    const resources = pageDict.get(PDFName.of('Resources'));

    if (!resources) continue;

    const fontDict = resources.get(PDFName.of('Font'));
    if (!fontDict) continue;

    const fontDictResolved = pdfDoc.context.lookup(fontDict);
    if (!fontDictResolved || !(fontDictResolved instanceof PDFDict)) continue;

    for (const [key, value] of fontDictResolved.entries()) {
      const fontName = key.toString();
      const fontRef = value;
      const font = pdfDoc.context.lookup(fontRef);

      if (!font || !(font instanceof PDFDict)) continue;

      const baseFont = font.get(PDFName.of('BaseFont'));
      const subtype = font.get(PDFName.of('Subtype'));
      const encoding = font.get(PDFName.of('Encoding'));
      const toUnicode = font.get(PDFName.of('ToUnicode'));

      const fontInfo = {
        name: fontName,
        baseFont: baseFont ? baseFont.toString() : 'N/A',
        subtype: subtype ? subtype.toString() : 'N/A',
        encoding: encoding ? encoding.toString() : 'N/A',
        hasToUnicode: !!toUnicode
      };

      const fontKey = `${fontInfo.baseFont}-${fontInfo.subtype}`;
      if (!fontMap.has(fontKey)) {
        fontMap.set(fontKey, fontInfo);
      }
    }
  }

  analysis.fonts = fontMap;

  console.log(`  Total unique fonts: ${fontMap.size}\n`);

  let idx = 1;
  for (const [key, font] of fontMap) {
    console.log(`    ${idx.toString().padStart(2, ' ')}. ${font.baseFont}`);
    console.log(`        Subtype: ${font.subtype}, Encoding: ${font.encoding}`);
    console.log(`        ToUnicode: ${font.hasToUnicode ? 'Yes' : 'No'}`);
    idx++;
  }
}

async function extractGeospatial(pdfDoc, catalog, analysis) {
  const geospatial = {};

  // Check for VP (Viewport)
  const vpValue = catalog.get(PDFName.of('VP'));
  if (vpValue) {
    geospatial.hasViewport = true;
    console.log('  Has Viewport: Yes');
  } else {
    geospatial.hasViewport = false;
    console.log('  Has Viewport: No');
  }

  // Check for LGIDict
  const lgiValue = catalog.get(PDFName.of('LGIDict'));
  if (lgiValue) {
    geospatial.hasLGIDict = true;
    console.log('  Has LGIDict: Yes');
  } else {
    geospatial.hasLGIDict = false;
    console.log('  Has LGIDict: No');
  }

  // Check for Measure in first page
  const firstPage = pdfDoc.getPages()[0];
  const pageDict = firstPage.node.dict;
  const measureValue = pageDict.get(PDFName.of('Measure'));
  if (measureValue) {
    geospatial.hasMeasure = true;
    console.log('  Has Measure: Yes');
  } else {
    geospatial.hasMeasure = false;
    console.log('  Has Measure: No');
  }

  geospatial.isGeoPDF = geospatial.hasViewport || geospatial.hasLGIDict || geospatial.hasMeasure;
  console.log(`  Is GeoPDF: ${geospatial.isGeoPDF ? 'Yes' : 'No'}`);

  analysis.geospatial = geospatial;
}

// Helper functions
function rgbToHex(r, g, b) {
  const rHex = Math.round(r * 255).toString(16).padStart(2, '0');
  const gHex = Math.round(g * 255).toString(16).padStart(2, '0');
  const bHex = Math.round(b * 255).toString(16).padStart(2, '0');
  return `#${rHex}${gHex}${bHex}`;
}

function cmykToHex(c, m, y, k) {
  const r = (1 - c) * (1 - k);
  const g = (1 - m) * (1 - k);
  const b = (1 - y) * (1 - k);
  return rgbToHex(r, g, b);
}

function grayToHex(gray) {
  const val = Math.round(gray * 255);
  const hex = val.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}

// Generate comparison report
function generateComparison(analyses) {
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('COMPARATIVE ANALYSIS');
  console.log('='.repeat(100));

  // Identify scale and year from filenames
  const fileInfo = analyses.map(a => {
    const name = a.filename;
    let scale = 'Unknown';
    let year = 'Unknown';

    if (name.includes('250K')) scale = '250k';
    else if (name.includes('100K')) scale = '100k';
    else if (name.includes('75Minute')) scale = '75k';
    else if (name.includes('7.5')) scale = '7.5min';

    // Extract year from metadata or filename
    if (a.metadata.CreationDate) {
      const match = a.metadata.CreationDate.match(/(\d{4})/);
      if (match) year = match[1];
    }

    // Try to extract from filename timestamp
    const timestampMatch = name.match(/(\d{8})/);
    if (timestampMatch) {
      const dateStr = timestampMatch[1];
      year = '20' + dateStr.substring(0, 2); // Assuming 20xx
    }

    return { ...a, scale, year };
  });

  console.log('\n--- FILE IDENTIFICATION ---');
  fileInfo.forEach((info, idx) => {
    console.log(`\n${idx + 1}. ${info.filename}`);
    console.log(`   Scale: ${info.scale}`);
    console.log(`   Year: ${info.year}`);
    console.log(`   Size: ${(info.fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Pages: ${info.structure.pageCount}`);
    console.log(`   Layers: ${info.layers.length}`);
    console.log(`   Colors: ${info.colors.size}`);
    console.log(`   Fonts: ${info.fonts.size}`);
  });

  // Compare layer naming conventions
  console.log('\n\n--- LAYER NAMING PATTERNS ---');
  fileInfo.forEach(info => {
    console.log(`\n${info.scale} Scale (${info.filename}):`);

    // Group layers by pattern
    const patterns = {};
    info.layers.forEach(layer => {
      // Extract pattern (e.g., "Roads" from "Roads - Primary")
      const baseName = layer.name.split('-')[0].trim();
      if (!patterns[baseName]) {
        patterns[baseName] = [];
      }
      patterns[baseName].push(layer.name);
    });

    const sortedPatterns = Object.entries(patterns).sort((a, b) => b[1].length - a[1].length);
    sortedPatterns.slice(0, 10).forEach(([pattern, layers]) => {
      console.log(`  ${pattern}: ${layers.length} layer${layers.length > 1 ? 's' : ''}`);
      if (layers.length <= 3) {
        layers.forEach(l => console.log(`    - ${l}`));
      }
    });
  });

  // Compare color palettes
  console.log('\n\n--- COLOR PALETTE COMPARISON ---');
  fileInfo.forEach(info => {
    console.log(`\n${info.scale} Scale:`);
    const sortedColors = Array.from(info.colors.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    sortedColors.forEach(([key, color], idx) => {
      console.log(`  ${idx + 1}. ${color.hex} [${color.type}] - ${color.count} uses`);
    });
  });

  // Metadata comparison
  console.log('\n\n--- METADATA COMPARISON ---');
  const metadataKeys = new Set();
  fileInfo.forEach(info => {
    Object.keys(info.metadata).forEach(k => metadataKeys.add(k));
  });

  console.log('\nKey metadata fields:');
  for (const key of metadataKeys) {
    console.log(`\n  ${key}:`);
    fileInfo.forEach(info => {
      const value = info.metadata[key] || 'N/A';
      console.log(`    ${info.scale.padEnd(6)}: ${value}`);
    });
  }
}

// Main execution
async function main() {
  const samplesDir = '/Users/mgilbert/Code/gellyscape/samples';

  // Find all PDF files
  const files = fs.readdirSync(samplesDir)
    .filter(f => f.endsWith('.pdf'))
    .map(f => path.join(samplesDir, f));

  // Get file stats to identify newest
  const fileStats = files.map(f => ({
    path: f,
    name: path.basename(f),
    mtime: fs.statSync(f).mtime
  }));

  fileStats.sort((a, b) => b.mtime - a.mtime);

  console.log('Found PDF files (by modification date):');
  fileStats.forEach((file, idx) => {
    const date = file.mtime.toISOString().split('T')[0];
    console.log(`  ${idx + 1}. ${file.name} (${date})`);
  });

  // Analyze specific files of interest
  const filesToAnalyze = [
    'MA_75MinuteTopo1_20251121_062032758784_TM_geo.pdf',  // 75k
    'VT_250K_Topo_20251121_054343748075_TM_geo.pdf',     // 250k
    'ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf',   // 100k
    // Add some older ones for comparison
    'VT_Essex_Junction_20240417_TM_geo.pdf',  // 2024 7.5min
    'NY_Niagara_Falls_20230524_TM_geo.pdf'    // 2023 7.5min
  ];

  const analyses = [];

  for (const filename of filesToAnalyze) {
    const filepath = path.join(samplesDir, filename);
    if (fs.existsSync(filepath)) {
      try {
        const analysis = await analyzePDF(filepath);
        analyses.push(analysis);
      } catch (e) {
        console.error(`Error analyzing ${filename}:`, e.message);
      }
    }
  }

  // Generate comparison report
  if (analyses.length > 0) {
    generateComparison(analyses);
  }

  // Save results to JSON
  const outputPath = path.join(__dirname, 'usgs-format-analysis.json');
  fs.writeFileSync(outputPath, JSON.stringify(analyses, (key, value) => {
    // Convert Maps to objects for JSON serialization
    if (value instanceof Map) {
      return Object.fromEntries(value);
    }
    return value;
  }, 2));

  console.log(`\n\nAnalysis saved to: ${outputPath}`);
}

main().catch(console.error);
