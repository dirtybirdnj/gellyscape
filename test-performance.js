/**
 * Performance test for PDF processing
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');
const path = require('path');

const testFiles = [
  { name: 'Legacy 24K', path: 'samples/VT_Charlotte_20240813_TM_geo.pdf' },
  { name: '2025 100K', path: 'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf' }
];

async function profileFile(testFile) {
  if (!fs.existsSync(testFile.path)) {
    console.log(`File not found: ${testFile.path}\n`);
    return;
  }

  console.log(`\n=== ${testFile.name} ===`);
  console.log(`File: ${path.basename(testFile.path)}`);

  const fileSize = fs.statSync(testFile.path).size / (1024 * 1024);
  console.log(`Size: ${fileSize.toFixed(1)} MB`);

  const buffer = fs.readFileSync(testFile.path);
  const processor = new PDFProcessor(buffer);

  const startTime = Date.now();

  try {
    const result = await processor.process();
    const elapsed = Date.now() - startTime;

    const pathCount = result.contentPaths?.paths?.length || 0;

    console.log(`Time: ${elapsed}ms`);
    console.log(`Paths: ${pathCount}`);
    console.log(`Rate: ${(pathCount / (elapsed / 1000)).toFixed(0)} paths/sec`);

  } catch (error) {
    console.error('Error:', error.message);
  }
}

async function main() {
  console.log('PDF Processing Performance Test');
  console.log('================================');

  for (const file of testFiles) {
    await profileFile(file);
  }
}

main();
