/**
 * Dump all operator types from the PDF
 */

import fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = '/Users/mgilbert/Code/gellyscape/samples/VT_Charlotte_20240813_TM_geo.pdf';

// Build reverse mapping of OPS
const OPS = pdfjsLib.OPS;
const opNames = {};
for (const [name, value] of Object.entries(OPS)) {
  opNames[value] = name;
}

async function dumpOps() {
  const data = new Uint8Array(fs.readFileSync(PDF_PATH));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const page = await doc.getPage(1);
  const opList = await page.getOperatorList();

  console.log('Total operators:', opList.fnArray.length);
  console.log('');

  // Count all operator types
  const opCounts = {};
  for (const op of opList.fnArray) {
    const name = opNames[op] || `unknown_${op}`;
    opCounts[name] = (opCounts[name] || 0) + 1;
  }

  // Sort by count
  const sorted = Object.entries(opCounts).sort((a, b) => b[1] - a[1]);

  console.log('ALL OPERATORS BY COUNT');
  console.log('='.repeat(50));
  for (const [name, count] of sorted) {
    console.log(`${name.padEnd(35)} ${count}`);
  }

  // Sample first 100 operators with their args
  console.log('');
  console.log('FIRST 200 OPERATORS');
  console.log('='.repeat(50));
  for (let i = 0; i < Math.min(200, opList.fnArray.length); i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op] || `unknown_${op}`;

    let argsStr = '';
    if (args) {
      if (args.length <= 4) {
        argsStr = JSON.stringify(args).slice(0, 60);
      } else {
        argsStr = `[${args.length} args]`;
      }
    }
    console.log(`${i}: ${name} ${argsStr}`);
  }

  // Look for constructPath specifically
  console.log('');
  console.log('CONSTRUCTPATH EXAMPLES (first 5)');
  console.log('='.repeat(50));

  let constructPathCount = 0;
  for (let i = 0; i < opList.fnArray.length && constructPathCount < 5; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];
    const name = opNames[op];

    if (name === 'constructPath') {
      console.log(`\nconstructPath at ${i}:`);
      console.log('  ops array:', args[0]?.slice(0, 20), '...');
      console.log('  args array (first 10):', args[1]?.slice(0, 10), '...');
      console.log('  minMax:', args[2]);
      constructPathCount++;
    }
  }
}

dumpOps().catch(console.error);
