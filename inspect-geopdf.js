const fs = require('fs');
const { PDFDocument, PDFName } = require('pdf-lib');

function getValue(obj) {
  if (!obj) return null;
  if (typeof obj.numberValue === 'function') return obj.numberValue();
  if (typeof obj.value === 'function') return obj.value();
  if (obj.numberValue !== undefined) return obj.numberValue;
  if (obj.value !== undefined) return obj.value;
  return obj;
}

function getArrayValues(arr) {
  if (!arr || !arr.array) return null;
  return arr.array.map(getValue);
}

async function inspectGeoPDF() {
  const pdfPath = 'samples/VT_Essex_Junction_20240417_TM_geo.pdf';
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const pageDict = firstPage.node.dict;

  console.log('=== PAGE DIMENSIONS ===');
  const mediaBox = pageDict.get(PDFName.of('MediaBox'));
  const cropBox = pageDict.get(PDFName.of('CropBox'));

  const mb = getArrayValues(mediaBox);
  const cb = getArrayValues(cropBox);
  console.log('MediaBox:', mb, '  => Width:', mb[2]-mb[0], 'Height:', mb[3]-mb[1], 'pts');
  console.log('CropBox:', cb);
  console.log('Page size in inches:', ((mb[2]-mb[0])/72).toFixed(2), 'x', ((mb[3]-mb[1])/72).toFixed(2));

  console.log('\n=== VIEWPORT DETAILS ===');
  const vp = pageDict.get(PDFName.of('VP'));
  if (vp && vp.array) {
    // Focus on 'Map Layers' viewport (index 0)
    const mapViewport = vp.array[0];
    if (mapViewport && mapViewport.dict) {
      const bbox = getArrayValues(mapViewport.dict.get(PDFName.of('BBox')));
      console.log('Map Layers BBox:', bbox, 'pts');
      console.log('  Width:', (bbox[2]-bbox[0]).toFixed(1), 'Height:', (bbox[3]-bbox[1]).toFixed(1), 'pts');

      // Get the Measure dictionary (referenced object)
      const measureRef = mapViewport.dict.get(PDFName.of('Measure'));
      if (measureRef) {
        console.log('\nMeasure reference:', measureRef.toString());

        // Need to dereference the object
        const context = pdfDoc.context;
        const measureDict = context.lookup(measureRef);

        if (measureDict && measureDict.dict) {
          console.log('\nMeasure Dictionary contents:');
          for (const [key, value] of measureDict.dict.entries()) {
            const keyStr = key.toString();
            if (keyStr === '/Bounds' || keyStr === '/GPTS' || keyStr === '/LPTS') {
              const arr = getArrayValues(value);
              if (arr) {
                console.log(' ', keyStr, ':', arr.slice(0, 8), arr.length > 8 ? '...('+arr.length+' total)' : '');
              }
            } else if (keyStr === '/GCS') {
              // Geographic Coordinate System
              const gcsRef = value;
              const gcsDict = context.lookup(gcsRef);
              if (gcsDict && gcsDict.dict) {
                console.log('  /GCS (Geographic Coordinate System):');
                for (const [gKey, gVal] of gcsDict.dict.entries()) {
                  const str = gVal?.toString?.() || '';
                  console.log('    ', gKey.toString(), ':', str.substring(0, 60));
                }
              }
            } else {
              const str = value?.toString?.() || '';
              console.log(' ', keyStr, ':', str.substring(0, 80));
            }
          }
        }
      }
    }

    // Also show other viewports
    console.log('\n=== ALL VIEWPORTS ===');
    for (let i = 0; i < vp.array.length; i++) {
      const viewport = vp.array[i];
      if (viewport && viewport.dict) {
        const name = viewport.dict.get(PDFName.of('Name'));
        const bbox = getArrayValues(viewport.dict.get(PDFName.of('BBox')));
        console.log(`Viewport ${i}: ${name?.toString()} => BBox: [${bbox?.join(', ')}]`);
      }
    }
  }

  // Calculate implied DPI
  console.log('\n=== IMPLIED RESOLUTION ===');
  // USGS 7.5-minute quads at 1:24000 scale
  // Map area is typically about 7.5 x 7.5 minutes of latitude/longitude
  // At ~44° latitude (Vermont), 1 minute of longitude ≈ 1.3 km, 1 minute of latitude ≈ 1.85 km
  // So map covers roughly 10km x 14km ground distance
  // At 1:24000, 1 inch = 24000 inches = 2000 feet = 609.6 meters
  const pageWidthInches = (mb[2]-mb[0])/72;
  const pageHeightInches = (mb[3]-mb[1])/72;
  console.log('Page dimensions:', pageWidthInches.toFixed(2), 'x', pageHeightInches.toFixed(2), 'inches');
  console.log('At 300 DPI, this would be:', Math.round(pageWidthInches * 300), 'x', Math.round(pageHeightInches * 300), 'pixels');
  console.log('At 150 DPI, this would be:', Math.round(pageWidthInches * 150), 'x', Math.round(pageHeightInches * 150), 'pixels');
}

inspectGeoPDF().catch(console.error);
