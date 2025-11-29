/**
 * Test the size of the result object being sent over IPC
 */

const PDFProcessor = require('./src/pdf-processor');
const fs = require('fs');

const testFile = 'samples/ME_100K_Topo_1_20251121_053539805876_TM_geo.pdf';

async function main() {
  console.log('Testing result size for:', testFile);

  const buffer = fs.readFileSync(testFile);
  const processor = new PDFProcessor(buffer);

  console.time('Process');
  const result = await processor.process();
  console.timeEnd('Process');

  // Measure JSON serialization time (what IPC does)
  console.time('JSON.stringify');
  const jsonStr = JSON.stringify(result);
  console.timeEnd('JSON.stringify');

  console.log('\nResult sizes:');
  console.log('  JSON string size:', (jsonStr.length / 1024 / 1024).toFixed(2), 'MB');
  console.log('  Path count:', result.contentPaths?.paths?.length || 0);

  // Count total operations
  let totalOps = 0;
  result.contentPaths?.paths?.forEach(p => {
    totalOps += p.operations?.length || 0;
  });
  console.log('  Total operations:', totalOps);

  // Test parse time
  console.time('JSON.parse');
  const parsed = JSON.parse(jsonStr);
  console.timeEnd('JSON.parse');

  console.log('\nEstimated IPC overhead (stringify + parse):', 'see times above');
}

main().catch(console.error);
