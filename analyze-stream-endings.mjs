/**
 * Check what color state is set at the END of each stream
 * This should carry over to the next stream
 */

import fs from 'fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import zlib from 'zlib';

const PDF_PATH = '/Users/mgilbert/Library/CloudStorage/GoogleDrive-matgilbert@gmail.com/Other computers/My Mac/Art/Clean USGS Maps/VT_Jay_Peak_20240416_TM_geo.pdf';

async function analyzeStreamEndings() {
  console.log('='.repeat(70));
  console.log('STREAM ENDING COLOR STATE ANALYSIS');
  console.log('='.repeat(70));
  console.log('');

  const buffer = fs.readFileSync(PDF_PATH);
  const pdfDoc = await PDFDocument.load(buffer);
  const context = pdfDoc.context;
  const page = pdfDoc.getPages()[0];
  const pageDict = page.node.dict;

  const contents = pageDict.get(PDFName.of('Contents'));
  let contentStreams = [];
  if (contents?.array) {
    contentStreams = contents.array;
  } else if (Array.isArray(contents)) {
    contentStreams = contents;
  } else {
    contentStreams = [contents];
  }

  console.log(`Total content streams: ${contentStreams.length}`);
  console.log('');

  // Track color state across all streams
  let globalStrokeColor = null;
  let globalFillColor = null;

  for (let streamIdx = 0; streamIdx < contentStreams.length; streamIdx++) {
    const streamRef = contentStreams[streamIdx];
    const stream = context.lookup(streamRef);

    if (!stream) continue;

    let rawData = stream.getContents();
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter?.toString() === '/FlateDecode') {
      rawData = zlib.inflateSync(Buffer.from(rawData));
    }
    const content = rawData.toString('latin1');
    const lines = content.split('\n');

    console.log(`\n=== STREAM ${streamIdx} ===`);
    console.log(`Starting stroke color: ${globalStrokeColor || '(none - default black)'}`);
    console.log(`Starting fill color: ${globalFillColor || '(none - default black)'}`);

    // Track color changes in this stream
    let streamStrokeColor = globalStrokeColor;
    let streamFillColor = globalFillColor;
    let firstStrokeColor = null;
    let lastStrokeColor = null;
    let strokeColorChanges = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      const rgStroke = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG$/);
      const rgFill = trimmed.match(/^([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg$/);
      const grayStroke = trimmed.match(/^([\d.]+)\s+G$/);
      const grayFill = trimmed.match(/^([\d.]+)\s+g$/);

      if (rgStroke) {
        streamStrokeColor = `rgb(${Math.round(rgStroke[1]*255)},${Math.round(rgStroke[2]*255)},${Math.round(rgStroke[3]*255)})`;
        strokeColorChanges++;
        if (!firstStrokeColor) firstStrokeColor = streamStrokeColor;
        lastStrokeColor = streamStrokeColor;
      }
      if (rgFill) {
        streamFillColor = `rgb(${Math.round(rgFill[1]*255)},${Math.round(rgFill[2]*255)},${Math.round(rgFill[3]*255)})`;
      }
      if (grayStroke) {
        const g = Math.round(parseFloat(grayStroke[1]) * 255);
        streamStrokeColor = `rgb(${g},${g},${g})`;
        strokeColorChanges++;
        if (!firstStrokeColor) firstStrokeColor = streamStrokeColor;
        lastStrokeColor = streamStrokeColor;
      }
      if (grayFill) {
        const g = Math.round(parseFloat(grayFill[1]) * 255);
        streamFillColor = `rgb(${g},${g},${g})`;
      }
    }

    console.log(`Stroke color changes in stream: ${strokeColorChanges}`);
    console.log(`First stroke color in stream: ${firstStrokeColor || '(none)'}`);
    console.log(`Last stroke color in stream: ${lastStrokeColor || '(none)'}`);
    console.log(`Ending stroke color: ${streamStrokeColor || '(none)'}`);
    console.log(`Ending fill color: ${streamFillColor || '(none)'}`);

    // Show last 20 lines to see what's at the end
    console.log('\nLast 30 lines of stream:');
    const lastLines = lines.slice(-30).filter(l => l.trim());
    console.log(lastLines.map(l => '  ' + l.trim()).join('\n'));

    // Update global state for next stream
    globalStrokeColor = streamStrokeColor;
    globalFillColor = streamFillColor;
  }

  console.log('\n' + '='.repeat(70));
  console.log('CONCLUSION');
  console.log('='.repeat(70));
  console.log(`
The PDF has ${contentStreams.length} content streams that are concatenated.
Color state from previous streams carries over to subsequent streams.
Stream 1 and Stream 2 have paths without color set IN THOSE STREAMS
because the color was set in Stream 0 and should carry over.

OUR BUG: pdf-content-parser.js is parsing each stream INDEPENDENTLY
and not carrying over the color state from previous streams!

FIX: When processing multiple content streams, we need to pass
the ending color state from stream N to the starting state of stream N+1.
`);
}

analyzeStreamEndings().catch(console.error);
