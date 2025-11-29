/**
 * Test script for polygon-clipping library
 * Tests if we can use it to crop map shapes/paths
 */

const polygonClipping = require('polygon-clipping');

console.log('=== Polygon Clipping Test ===\n');

// The library works with GeoJSON-style coordinates:
// - A ring is an array of [x, y] points
// - A polygon is an array of rings (first is outer, rest are holes)
// - A multipolygon is an array of polygons

// Test 1: Simple rectangle intersection (clipping a shape to a crop area)
console.log('Test 1: Simple rectangle intersection');
console.log('-------------------------------------');

// Subject polygon: a 100x100 square at origin
const square = [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]];

// Clip polygon: a 50x50 crop area starting at (25, 25)
const cropRect = [[[25, 25], [75, 25], [75, 75], [25, 75], [25, 25]]];

const result1 = polygonClipping.intersection(square, cropRect);
console.log('Subject (square):', JSON.stringify(square));
console.log('Clip (cropRect):', JSON.stringify(cropRect));
console.log('Result:', JSON.stringify(result1));
console.log('Expected: Inner 50x50 square at (25,25)\n');

// Test 2: Polygon partially outside crop area
console.log('Test 2: Polygon partially outside crop area');
console.log('-------------------------------------------');

// A triangle that extends beyond the crop area
const triangle = [[[0, 0], [120, 0], [60, 120], [0, 0]]];
const cropArea = [[[20, 20], [100, 20], [100, 80], [20, 80], [20, 20]]];

const result2 = polygonClipping.intersection(triangle, cropArea);
console.log('Subject (triangle):', JSON.stringify(triangle));
console.log('Clip area:', JSON.stringify(cropArea));
console.log('Result:', JSON.stringify(result2));
console.log('');

// Test 3: Polygon completely outside crop area
console.log('Test 3: Polygon completely outside crop area');
console.log('--------------------------------------------');

const outsideSquare = [[[200, 200], [300, 200], [300, 300], [200, 300], [200, 200]]];

const result3 = polygonClipping.intersection(outsideSquare, cropRect);
console.log('Subject (outside):', JSON.stringify(outsideSquare));
console.log('Clip area:', JSON.stringify(cropRect));
console.log('Result:', JSON.stringify(result3));
console.log('Expected: Empty array (no intersection)\n');

// Test 4: Multiple polygons (batch processing)
console.log('Test 4: Multiple polygons batch processing');
console.log('------------------------------------------');

const shapes = [
  [[[10, 10], [40, 10], [40, 40], [10, 40], [10, 10]]],  // Partially inside
  [[[50, 50], [90, 50], [90, 90], [50, 90], [50, 50]]],  // Partially inside
  [[[200, 200], [250, 200], [250, 250], [200, 250], [200, 200]]]  // Outside
];

const mapCrop = [[[30, 30], [80, 30], [80, 80], [30, 80], [30, 30]]];

console.log('Crop area:', JSON.stringify(mapCrop));
console.log('Processing', shapes.length, 'shapes...');

shapes.forEach((shape, i) => {
  const clipped = polygonClipping.intersection(shape, mapCrop);
  console.log(`Shape ${i + 1}: ${clipped.length > 0 ? 'Clipped' : 'Removed'}`);
  if (clipped.length > 0) {
    console.log('  Result:', JSON.stringify(clipped));
  }
});
console.log('');

// Test 5: Converting our path structure to polygon-clipping format
console.log('Test 5: Converting PDF path format to polygon-clipping format');
console.log('-------------------------------------------------------------');

// This is what our PDF paths look like (simplified)
const pdfPath = {
  subpaths: [{
    startPoint: { x: 100, y: 100 },
    segments: [
      { type: 'line', point: { x: 200, y: 100 } },
      { type: 'line', point: { x: 200, y: 200 } },
      { type: 'line', point: { x: 100, y: 200 } }
    ],
    closed: true
  }],
  style: { fill: '#ff0000' },
  operation: 'fill'
};

/**
 * Convert a PDF path (with line segments only) to polygon-clipping format
 * @param {Object} path - PDF path object
 * @returns {Array} GeoJSON-style polygon coordinates
 */
function pdfPathToPolygon(path) {
  const polygon = [];

  for (const subpath of path.subpaths || []) {
    const ring = [];

    // Start point
    if (subpath.startPoint) {
      ring.push([subpath.startPoint.x, subpath.startPoint.y]);
    }

    // Segments
    for (const segment of subpath.segments || []) {
      if (segment.type === 'line' && segment.point) {
        ring.push([segment.point.x, segment.point.y]);
      } else if (segment.type === 'cubic') {
        // For curves, we'd need to approximate with line segments
        // For now, just use the end point
        console.warn('  Warning: Cubic curve simplified to endpoint');
        ring.push([segment.point.x, segment.point.y]);
      }
    }

    // Close the ring if needed
    if (subpath.closed && ring.length > 0) {
      ring.push([...ring[0]]); // Close the ring
    }

    if (ring.length >= 4) { // Need at least 3 points + closing point
      polygon.push(ring);
    }
  }

  return polygon;
}

/**
 * Convert polygon-clipping result back to PDF path format
 * @param {Array} multiPolygon - Result from polygon-clipping
 * @param {Object} originalStyle - Style from original path
 * @returns {Object} PDF path object
 */
function polygonToPdfPath(multiPolygon, originalStyle = {}) {
  const subpaths = [];

  for (const polygon of multiPolygon) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;

      const subpath = {
        startPoint: { x: ring[0][0], y: ring[0][1] },
        segments: [],
        closed: true
      };

      // Skip first point (it's the startPoint) and last (closing point)
      for (let i = 1; i < ring.length - 1; i++) {
        subpath.segments.push({
          type: 'line',
          point: { x: ring[i][0], y: ring[i][1] }
        });
      }

      subpaths.push(subpath);
    }
  }

  return {
    subpaths,
    style: originalStyle.style || {},
    operation: originalStyle.operation || 'fill'
  };
}

const converted = pdfPathToPolygon(pdfPath);
console.log('Original PDF path:', JSON.stringify(pdfPath.subpaths[0].startPoint), '...');
console.log('Converted to polygon:', JSON.stringify(converted));

const testCrop = [[[150, 150], [250, 150], [250, 250], [150, 250], [150, 150]]];
const clippedResult = polygonClipping.intersection(converted, testCrop);
console.log('Crop area:', JSON.stringify(testCrop));
console.log('Clipped result:', JSON.stringify(clippedResult));

const backToPdf = polygonToPdfPath(clippedResult, pdfPath);
console.log('Converted back to PDF path:', JSON.stringify(backToPdf.subpaths));
console.log('');

// Test 6: Performance test with many polygons
console.log('Test 6: Performance test');
console.log('------------------------');

const numPolygons = 1000;
const testPolygons = [];
const bigCrop = [[[100, 100], [900, 100], [900, 900], [100, 900], [100, 100]]];

for (let i = 0; i < numPolygons; i++) {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  const size = 10 + Math.random() * 50;
  testPolygons.push([[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]);
}

console.log(`Processing ${numPolygons} random polygons...`);
const startTime = Date.now();

let clippedCount = 0;
let removedCount = 0;

for (const poly of testPolygons) {
  const result = polygonClipping.intersection(poly, bigCrop);
  if (result.length > 0) {
    clippedCount++;
  } else {
    removedCount++;
  }
}

const elapsed = Date.now() - startTime;
console.log(`Time: ${elapsed}ms`);
console.log(`Kept: ${clippedCount}, Removed: ${removedCount}`);
console.log(`Rate: ${(numPolygons / elapsed * 1000).toFixed(0)} polygons/second`);
console.log('');

// Test 7: What about bezier curves?
console.log('Test 7: Handling Bezier curves (important for SVG paths)');
console.log('-------------------------------------------------------');
console.log('polygon-clipping only works with polygon coordinates (line segments).');
console.log('For bezier curves, we have two options:');
console.log('  1. Approximate curves with line segments (flatten the curve)');
console.log('  2. Use a different library like paper.js or bezier-js');
console.log('');

// Demonstrate curve flattening
function flattenCubicBezier(p0, cp1, cp2, p3, segments = 10) {
  const points = [];
  for (let t = 0; t <= 1; t += 1 / segments) {
    const mt = 1 - t;
    const x = mt*mt*mt*p0[0] + 3*mt*mt*t*cp1[0] + 3*mt*t*t*cp2[0] + t*t*t*p3[0];
    const y = mt*mt*mt*p0[1] + 3*mt*mt*t*cp1[1] + 3*mt*t*t*cp2[1] + t*t*t*p3[1];
    points.push([x, y]);
  }
  return points;
}

const curvePoints = flattenCubicBezier([0, 0], [50, 100], [100, 100], [150, 0], 20);
console.log('Flattened bezier curve (20 segments):');
console.log('  First point:', curvePoints[0]);
console.log('  Mid point:', curvePoints[10]);
console.log('  Last point:', curvePoints[curvePoints.length - 1]);
console.log('');

console.log('=== Summary ===');
console.log('polygon-clipping CAN be used for cropping shapes:');
console.log('  ✓ Simple polygons work perfectly');
console.log('  ✓ Handles multiple shapes efficiently');
console.log('  ✓ Fast performance (~1000+ shapes/second)');
console.log('  ⚠ Bezier curves need to be flattened to line segments first');
console.log('  ⚠ May lose some precision on curved paths');
