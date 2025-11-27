/**
 * Analyze the 100K CTM (cm) operator sequences
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH_100K = './samples/NY_100K_Topo_1_20251121_055620498898_TM_geo.pdf';

async function analyzeCM() {
  console.log('='.repeat(70));
  console.log('ANALYZING 100K CM OPERATORS AND NESTING');
  console.log('='.repeat(70));

  const buffer = fs.readFileSync(PDF_PATH_100K);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  // Get the Form XObject
  const resources = pageDict.get(PDFName.of('Resources'));
  const xobjectDict = resources?.get(PDFName.of('XObject'));
  const xobjects = context.lookup(xobjectDict);
  const entries = xobjects?.entries ? Array.from(xobjects.entries()) : [];

  for (const [name, ref] of entries) {
    const xobject = context.lookup(ref);
    const subtype = xobject?.dict?.get(PDFName.of('Subtype'))?.toString();
    if (subtype !== '/Form') continue;

    // Get XObject content
    let xoContent;
    try {
      let xoRawData = xobject.getContents();
      const xoFilter = xobject.dict?.get(PDFName.of('Filter'));
      if (xoFilter?.toString() === '/FlateDecode') {
        xoRawData = zlib.inflateSync(Buffer.from(xoRawData));
      }
      xoContent = xoRawData.toString('latin1');
    } catch (e) {
      console.log(`Error: ${e.message}`);
      continue;
    }

    console.log(`\n--- XOBJECT: ${name.toString()} ---`);

    // Parse through looking for q/Q/cm patterns
    const lines = xoContent.split('\n');
    let stateDepth = 0;
    let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    let ctmStack = [];

    // Track first 100 operations involving state or cm
    let opCount = 0;
    const maxOps = 150;

    for (const line of lines) {
      if (opCount >= maxOps) break;

      const trimmed = line.trim();

      if (trimmed === 'q') {
        // Save state
        ctmStack.push({ ...ctm });
        stateDepth++;
        opCount++;
        console.log(`[${stateDepth}] q (save) - CTM: [${ctm.a.toFixed(4)}, ${ctm.b.toFixed(4)}, ${ctm.c.toFixed(4)}, ${ctm.d.toFixed(4)}, ${ctm.e.toFixed(2)}, ${ctm.f.toFixed(2)}]`);
      } else if (trimmed === 'Q') {
        // Restore state
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop();
        }
        stateDepth--;
        opCount++;
        console.log(`[${stateDepth}] Q (restore) - CTM: [${ctm.a.toFixed(4)}, ${ctm.b.toFixed(4)}, ${ctm.c.toFixed(4)}, ${ctm.d.toFixed(4)}, ${ctm.e.toFixed(2)}, ${ctm.f.toFixed(2)}]`);
      } else {
        // Check for cm operator
        const cmMatch = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+cm$/);
        if (cmMatch) {
          const m = {
            a: parseFloat(cmMatch[1]),
            b: parseFloat(cmMatch[2]),
            c: parseFloat(cmMatch[3]),
            d: parseFloat(cmMatch[4]),
            e: parseFloat(cmMatch[5]),
            f: parseFloat(cmMatch[6])
          };

          // Multiply: new = ctm * m
          const newCtm = {
            a: ctm.a * m.a + ctm.b * m.c,
            b: ctm.a * m.b + ctm.b * m.d,
            c: ctm.c * m.a + ctm.d * m.c,
            d: ctm.c * m.b + ctm.d * m.d,
            e: ctm.e * m.a + ctm.f * m.c + m.e,
            f: ctm.e * m.b + ctm.f * m.d + m.f
          };
          ctm = newCtm;

          opCount++;
          console.log(`[${stateDepth}] cm [${m.a.toFixed(4)}, ${m.b.toFixed(4)}, ${m.c.toFixed(4)}, ${m.d.toFixed(4)}, ${m.e.toFixed(2)}, ${m.f.toFixed(2)}] => Effective CTM: [${ctm.a.toFixed(4)}, ${ctm.b.toFixed(4)}, ${ctm.c.toFixed(4)}, ${ctm.d.toFixed(4)}, ${ctm.e.toFixed(2)}, ${ctm.f.toFixed(2)}]`);
        }

        // Check for path operators with current CTM
        const pathOp = trimmed.match(/^([\d.-]+)\s+([\d.-]+)\s+(m|l)$/);
        if (pathOp && opCount < maxOps) {
          const x = parseFloat(pathOp[1]);
          const y = parseFloat(pathOp[2]);
          const op = pathOp[3];

          // Transform point
          const tx = ctm.a * x + ctm.c * y + ctm.e;
          const ty = ctm.b * x + ctm.d * y + ctm.f;

          opCount++;
          console.log(`[${stateDepth}] ${op} (${x.toFixed(1)}, ${y.toFixed(1)}) => (${tx.toFixed(2)}, ${ty.toFixed(2)})`);
        }
      }
    }

    console.log(`\n... (showing first ${maxOps} state/cm/path operations)`);
  }
}

analyzeCM().catch(console.error);
