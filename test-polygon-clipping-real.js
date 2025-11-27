/**
 * Test polygon-clipping with real PDF path data
 * Extracts paths from a sample PDF and tests cropping them
 */

const PDFProcessor = require('./src/pdf-processor');
const polygonClipping = require('polygon-clipping');
const path = require('path');
const fs = require('fs');

// Use a smaller 7.5 minute topo map
const testPdfPath = path.join(__dirname, 'samples/VT_Charlotte_20240813_TM_geo.pdf');

async function main() {
  console.log('=== Real PDF Path Cropping Test ===\n');
  console.log('Loading PDF:', testPdfPath);

  // Read the PDF file
  const buffer = fs.readFileSync(testPdfPath);
  const processor = new PDFProcessor(buffer);

  try {
    // Extract paths from PDF
    console.log('Extracting paths from PDF...');
    const result = await processor.process();

    console.log('\nExtraction results:');

    // The contentPaths has a flat 'paths' array
    const paths = result.contentPaths?.paths || [];
    console.log('  Total paths:', paths.length);

    // Debug: show first path structure
    if (paths.length > 0) {
      console.log('\n  First path structure:');
      console.log('    Keys:', Object.keys(paths[0]));
      console.log('    Has subpaths?', !!paths[0].subpaths);
      console.log('    Has operations?', !!paths[0].operations);
      if (paths[0].subpaths) {
        console.log('    Subpaths count:', paths[0].subpaths.length);
        if (paths[0].subpaths[0]) {
          console.log('    First subpath keys:', Object.keys(paths[0].subpaths[0]));
          console.log('    First subpath segments:', paths[0].subpaths[0].segments?.length);
        }
      }
      if (paths[0].operations) {
        console.log('    Operations count:', paths[0].operations.length);
        console.log('    First 3 operations:', paths[0].operations.slice(0, 3));
      }
    }

    // Analyze path types - handle both formats
    let totalPaths = paths.length;
    let lineOnlyPaths = 0;
    let curvedPaths = 0;
    let pathStats = { line: 0, cubic: 0, quadratic: 0, lineto: 0, moveto: 0, curveto: 0 };

    for (const path of paths) {
      let hasCurves = false;

      // Check for subpaths format
      if (path.subpaths) {
        for (const subpath of path.subpaths) {
          for (const segment of subpath.segments || []) {
            pathStats[segment.type] = (pathStats[segment.type] || 0) + 1;
            if (segment.type === 'cubic' || segment.type === 'quadratic' || segment.type === 'curveto') {
              hasCurves = true;
            }
          }
        }
      }
      // Check for operations format
      else if (path.operations) {
        for (const op of path.operations) {
          pathStats[op.type] = (pathStats[op.type] || 0) + 1;
          if (op.type === 'curveto') {
            hasCurves = true;
          }
        }
      }

      if (hasCurves) {
        curvedPaths++;
      } else {
        lineOnlyPaths++;
      }
    }

    console.log('\nPath analysis:');
    console.log('  Total paths:', totalPaths);
    console.log('  Line-only paths:', lineOnlyPaths, `(${(lineOnlyPaths/totalPaths*100).toFixed(1)}%)`);
    console.log('  Paths with curves:', curvedPaths, `(${(curvedPaths/totalPaths*100).toFixed(1)}%)`);
    console.log('  Segment types:', pathStats);

    // Test cropping with polygon-clipping
    console.log('\n--- Testing polygon-clipping crop ---');

    // Get page dimensions from metadata
    const pageWidth = result.metadata?.pageWidth || 612;
    const pageHeight = result.metadata?.pageHeight || 792;
    console.log('Page dimensions:', pageWidth, 'x', pageHeight);

    // First, let's find the actual bounds of the paths
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const path of paths.slice(0, 500)) {
      if (path.operations) {
        for (const op of path.operations) {
          if (op.x !== undefined && op.y !== undefined) {
            minX = Math.min(minX, op.x);
            minY = Math.min(minY, op.y);
            maxX = Math.max(maxX, op.x);
            maxY = Math.max(maxY, op.y);
          }
        }
      }
    }
    console.log('Path bounds (from first 500 paths):');
    console.log('  X:', minX.toFixed(2), 'to', maxX.toFixed(2));
    console.log('  Y:', minY.toFixed(2), 'to', maxY.toFixed(2));

    // Define a crop region based on actual path bounds (center 50%)
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const cropMargin = 0.25;
    const cropX = minX + boundsWidth * cropMargin;
    const cropY = minY + boundsHeight * cropMargin;
    const cropW = boundsWidth * (1 - 2 * cropMargin);
    const cropH = boundsHeight * (1 - 2 * cropMargin);

    const cropPolygon = [[[cropX, cropY], [cropX + cropW, cropY],
                          [cropX + cropW, cropY + cropH], [cropX, cropY + cropH], [cropX, cropY]]];

    console.log('Crop region:', { x: cropX, y: cropY, width: cropW, height: cropH });

    // Convert and crop paths
    let processed = 0;
    let kept = 0;
    let removed = 0;
    let errors = 0;
    let curveWarnings = 0;

    /**
     * Convert a PDF path to polygon format
     * Handles both 'subpaths' and 'operations' formats
     * Flattens bezier curves to line segments
     */
    function pdfPathToPolygon(pdfPath) {
      const polygon = [];

      // Handle operations format (moveto/lineto/curveto)
      if (pdfPath.operations && pdfPath.operations.length > 0) {
        let currentRing = [];
        let currentPoint = null;

        for (const op of pdfPath.operations) {
          if (op.type === 'moveto') {
            // Start a new ring if we have a previous one
            if (currentRing.length >= 3) {
              currentRing.push([...currentRing[0]]); // Close the ring
              polygon.push(currentRing);
            }
            currentRing = [[op.x, op.y]];
            currentPoint = [op.x, op.y];
          } else if (op.type === 'lineto') {
            currentRing.push([op.x, op.y]);
            currentPoint = [op.x, op.y];
          } else if (op.type === 'curveto' && currentPoint) {
            // Flatten bezier curve
            const points = flattenCubicBezier(
              currentPoint,
              [op.cp1x, op.cp1y],
              [op.cp2x, op.cp2y],
              [op.x, op.y],
              8
            );
            // Skip first point (it's the current point) and add the rest
            for (let i = 1; i < points.length; i++) {
              currentRing.push(points[i]);
            }
            currentPoint = [op.x, op.y];
          }
        }

        // Don't forget the last ring
        if (currentRing.length >= 3) {
          currentRing.push([...currentRing[0]]); // Close the ring
          polygon.push(currentRing);
        }

        return polygon;
      }

      // Handle subpaths format (original format)
      for (const subpath of pdfPath.subpaths || []) {
        const ring = [];
        let currentPoint = null;

        // Start point
        if (subpath.startPoint) {
          ring.push([subpath.startPoint.x, subpath.startPoint.y]);
          currentPoint = [subpath.startPoint.x, subpath.startPoint.y];
        }

        // Segments
        for (const segment of subpath.segments || []) {
          if (segment.type === 'line' && segment.point) {
            ring.push([segment.point.x, segment.point.y]);
            currentPoint = [segment.point.x, segment.point.y];
          } else if (segment.type === 'cubic') {
            // Flatten bezier curve
            const points = flattenCubicBezier(
              currentPoint,
              [segment.cp1.x, segment.cp1.y],
              [segment.cp2.x, segment.cp2.y],
              [segment.point.x, segment.point.y],
              8 // segments per curve
            );
            // Skip first point (it's the current point) and add the rest
            for (let i = 1; i < points.length; i++) {
              ring.push(points[i]);
            }
            currentPoint = [segment.point.x, segment.point.y];
          } else if (segment.type === 'quadratic') {
            // Convert quadratic to line segments
            ring.push([segment.point.x, segment.point.y]);
            currentPoint = [segment.point.x, segment.point.y];
          }
        }

        // Close the ring
        if (ring.length > 0) {
          ring.push([...ring[0]]);
        }

        if (ring.length >= 4) {
          polygon.push(ring);
        }
      }

      return polygon;
    }

    function flattenCubicBezier(p0, cp1, cp2, p3, segments = 8) {
      const points = [p0];
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const mt = 1 - t;
        const x = mt*mt*mt*p0[0] + 3*mt*mt*t*cp1[0] + 3*mt*t*t*cp2[0] + t*t*t*p3[0];
        const y = mt*mt*mt*p0[1] + 3*mt*mt*t*cp1[1] + 3*mt*t*t*cp2[1] + t*t*t*p3[1];
        points.push([x, y]);
      }
      return points;
    }

    const startTime = Date.now();

    // Process all paths
    const testPaths = paths;
    console.log(`\nProcessing ${testPaths.length} paths...`);

    // Group by layer for reporting
    const layerStats = {};

    // Track fill vs stroke operations
    let fillPaths = { total: 0, kept: 0, removed: 0, errors: 0 };
    let strokePaths = { total: 0, kept: 0, removed: 0, errors: 0 };

    for (const pdfPath of testPaths) {
      processed++;
      const layerName = pdfPath.layer || 'Unknown';
      const isFill = pdfPath.fill === true;
      const isStroke = pdfPath.stroke === true && !pdfPath.fill;
      const tracker = isFill ? fillPaths : strokePaths;

      tracker.total++;

      if (!layerStats[layerName]) {
        layerStats[layerName] = { kept: 0, removed: 0, errors: 0, fillKept: 0, strokeKept: 0 };
      }

      try {
        const polygon = pdfPathToPolygon(pdfPath);

        if (polygon.length === 0) {
          removed++;
          tracker.removed++;
          layerStats[layerName].removed++;
          continue;
        }

        const clipped = polygonClipping.intersection(polygon, cropPolygon);

        if (clipped.length > 0) {
          kept++;
          tracker.kept++;
          layerStats[layerName].kept++;
          if (isFill) layerStats[layerName].fillKept++;
          else layerStats[layerName].strokeKept++;
        } else {
          removed++;
          tracker.removed++;
          layerStats[layerName].removed++;
        }
      } catch (err) {
        errors++;
        tracker.errors++;
        layerStats[layerName].errors++;
        if (errors <= 3) {
          console.log(`  Error processing path (${isFill ? 'fill' : 'stroke'}): ${err.message}`);
        }
      }
    }

    // Report by layer
    console.log('\nResults by layer:');
    for (const [layerName, stats] of Object.entries(layerStats)) {
      console.log(`  ${layerName}: Kept ${stats.kept}, Removed ${stats.removed}, Errors ${stats.errors}`);
    }

    const elapsed = Date.now() - startTime;

    console.log('\n--- Results ---');
    console.log('Processed:', processed);
    console.log('Kept:', kept);
    console.log('Removed:', removed);
    console.log('Errors:', errors);
    console.log('Time:', elapsed, 'ms');
    console.log('Rate:', (processed / elapsed * 1000).toFixed(0), 'paths/second');

    console.log('\n--- Fill vs Stroke breakdown ---');
    console.log('Fill paths:', fillPaths);
    console.log('Stroke paths:', strokePaths);

    // Show example of a clipped path
    console.log('\n--- Example clipped path ---');
    for (const pdfPath of testPaths.slice(0, 100)) {
      const polygon = pdfPathToPolygon(pdfPath);
      if (polygon.length > 0) {
        try {
          const clipped = polygonClipping.intersection(polygon, cropPolygon);
          if (clipped.length > 0 && clipped[0][0].length > 3) {
            console.log('Layer:', pdfPath.layer);
            console.log('Original polygon points:', polygon[0].length);
            console.log('Clipped polygon points:', clipped[0][0].length);
            console.log('First few points of original:', polygon[0].slice(0, 3));
            console.log('First few points of clipped:', clipped[0][0].slice(0, 3));
            break;
          }
        } catch (e) {
          // Skip errored paths
        }
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

main();
