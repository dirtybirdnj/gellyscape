#!/usr/bin/env node

/**
 * Test script for PDF Content Stream Parser
 * Tests parsing of GeoPDF file and displays statistics
 */

const fs = require('fs');
const path = require('path');
const PDFProcessor = require('./src/pdf-processor');

async function testParser() {
  console.log('='.repeat(80));
  console.log('PDF Content Stream Parser - Test Script');
  console.log('='.repeat(80));
  console.log();

  // Find the sample PDF
  const samplePath = path.join(__dirname, 'samples', 'VT_Burlington_20240809_TM_geo.pdf');

  if (!fs.existsSync(samplePath)) {
    console.error('❌ Sample PDF not found at:', samplePath);
    console.error('Please ensure the GeoPDF file is in the samples/ directory');
    process.exit(1);
  }

  console.log('📄 Loading GeoPDF:', path.basename(samplePath));
  console.log('   File size:', (fs.statSync(samplePath).size / 1024 / 1024).toFixed(2), 'MB');
  console.log();

  try {
    // Read the PDF file
    const buffer = fs.readFileSync(samplePath);

    // Process the PDF
    console.log('⚙️  Processing PDF...');
    console.log();

    const processor = new PDFProcessor(buffer);
    const result = await processor.process();

    console.log();
    console.log('='.repeat(80));
    console.log('RESULTS');
    console.log('='.repeat(80));
    console.log();

    // Display metadata
    console.log('📋 Metadata:');
    console.log('   Title:', result.metadata.title);
    console.log('   Creator:', result.metadata.creator);
    console.log('   Pages:', result.metadata.pageCount);
    console.log('   Is GeoPDF:', result.metadata.isGeoPDF ? 'Yes ✓' : 'No');
    console.log();

    // Display content paths statistics
    console.log('🎨 Content Paths:');
    console.log('   Total paths extracted:', result.contentPaths.statistics.total);
    console.log('   Average segments per path:', result.contentPaths.statistics.averageSegments);
    console.log();

    // Display paths by operation
    console.log('   Paths by operation:');
    Object.entries(result.contentPaths.statistics.byOperation).forEach(([op, count]) => {
      const percentage = ((count / result.contentPaths.statistics.total) * 100).toFixed(1);
      console.log(`     ${op.padEnd(15)} ${count.toString().padStart(6)} (${percentage}%)`);
    });
    console.log();

    // Display top colors
    console.log('   Top colors used:');
    const colorEntries = Object.entries(result.contentPaths.statistics.byColor)
      .sort((a, b) => (b[1].fill + b[1].stroke) - (a[1].fill + a[1].stroke))
      .slice(0, 10);

    colorEntries.forEach(([color, counts]) => {
      const total = counts.fill + counts.stroke;
      console.log(`     ${color.padEnd(10)} - Fill: ${counts.fill.toString().padStart(5)}, Stroke: ${counts.stroke.toString().padStart(5)} (Total: ${total})`);
    });
    console.log();

    // Display paths by page
    console.log('   Paths per page:');
    Object.entries(result.contentPaths.pathsByPage).forEach(([page, paths]) => {
      console.log(`     Page ${(parseInt(page) + 1).toString().padStart(2)}: ${paths.length.toString().padStart(6)} paths`);
    });
    console.log();

    // Display sample paths
    console.log('📐 Sample Paths (first 3):');
    result.contentPaths.paths.slice(0, 3).forEach((path, index) => {
      console.log(`   Path ${index + 1}:`);
      console.log(`     Operation: ${path.operation}`);
      console.log(`     Subpaths: ${path.subpaths.length}`);
      console.log(`     Style:`, JSON.stringify(path.style, null, 2).replace(/\n/g, '\n       '));

      if (path.subpaths.length > 0) {
        const firstSubpath = path.subpaths[0];
        console.log(`     First subpath:`);
        console.log(`       Start: (${firstSubpath.startPoint.x.toFixed(2)}, ${firstSubpath.startPoint.y.toFixed(2)})`);
        console.log(`       Segments: ${firstSubpath.segments.length}`);
        console.log(`       Closed: ${firstSubpath.closed}`);

        if (firstSubpath.segments.length > 0) {
          const firstSeg = firstSubpath.segments[0];
          console.log(`       First segment type: ${firstSeg.type}`);
        }
      }
      console.log();
    });

    // Save detailed output to file
    const outputPath = path.join(__dirname, 'test-output.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      metadata: result.metadata,
      statistics: result.contentPaths.statistics,
      samplePaths: result.contentPaths.paths.slice(0, 10)
    }, null, 2));

    console.log('💾 Detailed output saved to:', path.basename(outputPath));
    console.log();

    console.log('='.repeat(80));
    console.log('✅ Test completed successfully!');
    console.log('='.repeat(80));

  } catch (error) {
    console.error();
    console.error('❌ Error during processing:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testParser().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
