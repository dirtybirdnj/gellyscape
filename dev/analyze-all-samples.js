#!/usr/bin/env node
/**
 * Analyze all PDF samples to understand text formats
 */

const fs = require('fs');
const path = require('path');
const TextExtractor = require('../src/text-extractor');

const samplesDir = './samples';

async function analyzeAll() {
  const files = fs.readdirSync(samplesDir)
    .filter(f => f.endsWith('.pdf'));

  console.log('Analyzing', files.length, 'PDF files...\n');

  const summary = [];

  for (const file of files) {
    const filePath = path.join(samplesDir, file);
    console.log('='.repeat(70));
    console.log('FILE:', file);
    console.log('='.repeat(70));

    try {
      const extractor = new TextExtractor();
      const result = await extractor.extract(filePath);

      const info = {
        file,
        format: result.formatInfo.generation,
        isTopoBuilder: result.formatInfo.isTopoBuilder,
        arcVersion: result.formatInfo.arcVersion,
        fontCount: result.fonts.length,
        textCount: result.textElements.length
      };

      console.log('Format:', info.format, info.isTopoBuilder ? '(TopoBuilder)' : '');
      console.log('ArcSOC:', info.arcVersion || 'N/A');
      console.log('Fonts:', info.fontCount);

      // Show fonts
      result.fonts.slice(0, 5).forEach(f => {
        console.log('  -', f.name, f.subtype, f.hasUnicodeMap ? '(has CMap)' : '');
      });
      if (result.fonts.length > 5) {
        console.log('  ... and', result.fonts.length - 5, 'more');
      }

      console.log('Text elements:', info.textCount);

      // Group by layer
      const byLayer = {};
      result.textElements.forEach(t => {
        const layer = t.layer || 'Unassigned';
        byLayer[layer] = (byLayer[layer] || 0) + 1;
      });

      if (Object.keys(byLayer).length > 0) {
        console.log('By layer:');
        Object.entries(byLayer)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .forEach(([layer, count]) => {
            console.log('  ', layer + ':', count);
          });
      }

      // Try to reconstruct text by grouping nearby characters
      if (result.textElements.length > 0) {
        const reconstructed = reconstructText(result.textElements.slice(0, 1000));
        console.log('Sample reconstructed text:');
        reconstructed.slice(0, 8).forEach(t => {
          console.log('  ', JSON.stringify(t.substring(0, 60)));
        });
      }

      summary.push(info);

    } catch (err) {
      console.log('ERROR:', err.message);
      summary.push({ file, error: err.message });
    }
    console.log();
  }

  // Print summary table
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('\nFormat breakdown:');

  const formatCounts = {};
  summary.forEach(s => {
    const key = s.format + (s.isTopoBuilder ? ' TopoBuilder' : '');
    formatCounts[key] = (formatCounts[key] || 0) + 1;
  });
  Object.entries(formatCounts).forEach(([format, count]) => {
    console.log('  ', format + ':', count, 'files');
  });

  console.log('\nText extraction results:');
  summary
    .filter(s => !s.error)
    .sort((a, b) => b.textCount - a.textCount)
    .forEach(s => {
      console.log('  ', s.file.substring(0, 40).padEnd(42), s.textCount.toString().padStart(8), 'elements');
    });
}

function reconstructText(elements) {
  // Sort by Y (descending) then X (ascending) to read top-to-bottom, left-to-right
  const sorted = [...elements].sort((a, b) => {
    const yDiff = (b.y || 0) - (a.y || 0);
    if (Math.abs(yDiff) > 10) return yDiff;
    return (a.x || 0) - (b.x || 0);
  });

  const lines = [];
  let currentLine = '';
  let lastY = null;
  let lastX = null;

  for (const el of sorted) {
    const x = el.x || 0;
    const y = el.y || 0;

    // New line if Y changed significantly
    if (lastY !== null && Math.abs(y - lastY) > 10) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = el.text;
    } else if (lastX !== null && x - lastX > 20) {
      // Add space if there's a gap
      currentLine += ' ' + el.text;
    } else {
      currentLine += el.text;
    }

    lastX = x;
    lastY = y;
  }

  if (currentLine.trim()) lines.push(currentLine.trim());

  // Filter out single-character lines and weird symbols
  return lines.filter(l => l.length > 2 && !/^[―│í═┬┴┤├]+$/.test(l));
}

analyzeAll().catch(console.error);
