/**
 * Analyze Chrome performance trace to find bottlenecks
 */

const fs = require('fs');

const traceFile = process.argv[2] || 'Trace-20251125T005350.json';

console.log('Analyzing trace:', traceFile);

const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));

// The trace format can be { traceEvents: [...] } or just [...]
const events = trace.traceEvents || trace;

console.log('Total events:', events.length);

// Aggregate time by category/name
const timeByName = {};
const timeByCategory = {};
let totalDuration = 0;

events.forEach(event => {
  // Only look at complete events (X) or duration events (B/E pairs)
  if (event.ph === 'X' && event.dur) {
    const name = event.name || 'unknown';
    const cat = event.cat || 'unknown';
    const durMs = event.dur / 1000; // Convert microseconds to milliseconds

    timeByName[name] = (timeByName[name] || 0) + durMs;
    timeByCategory[cat] = (timeByCategory[cat] || 0) + durMs;
    totalDuration += durMs;
  }
});

console.log('\n=== TOP 20 TIME BY EVENT NAME ===');
Object.entries(timeByName)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([name, time]) => {
    const pct = (time / totalDuration * 100).toFixed(1);
    console.log(`  ${time.toFixed(1).padStart(10)} ms (${pct.padStart(5)}%) - ${name}`);
  });

console.log('\n=== TIME BY CATEGORY ===');
Object.entries(timeByCategory)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([cat, time]) => {
    const pct = (time / totalDuration * 100).toFixed(1);
    console.log(`  ${time.toFixed(1).padStart(10)} ms (${pct.padStart(5)}%) - ${cat}`);
  });

// Look for specific markers like console.time
const markers = events.filter(e =>
  e.name && (e.name.startsWith('PDF:') || e.name.startsWith('Render:'))
);

if (markers.length > 0) {
  console.log('\n=== CUSTOM TIMING MARKERS ===');
  const markerTimes = {};
  markers.forEach(m => {
    if (m.ph === 'X' && m.dur) {
      markerTimes[m.name] = (markerTimes[m.name] || 0) + m.dur / 1000;
    }
  });

  Object.entries(markerTimes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, time]) => {
      console.log(`  ${time.toFixed(1).padStart(10)} ms - ${name}`);
    });
}

// Find longest individual events
console.log('\n=== LONGEST INDIVIDUAL EVENTS ===');
events
  .filter(e => e.ph === 'X' && e.dur)
  .sort((a, b) => b.dur - a.dur)
  .slice(0, 15)
  .forEach(e => {
    const durMs = e.dur / 1000;
    console.log(`  ${durMs.toFixed(1).padStart(10)} ms - ${e.name} (${e.cat || 'no-cat'})`);
  });

// Look for GC events
const gcEvents = events.filter(e =>
  e.name && (e.name.includes('GC') || e.name.includes('garbage') || e.name === 'MinorGC' || e.name === 'MajorGC')
);

if (gcEvents.length > 0) {
  let gcTotal = 0;
  gcEvents.forEach(e => {
    if (e.dur) gcTotal += e.dur / 1000;
  });
  console.log('\n=== GARBAGE COLLECTION ===');
  console.log(`  Total GC time: ${gcTotal.toFixed(1)} ms across ${gcEvents.length} events`);
}

// Check for RunMicrotasks (Promise overhead)
const microtaskEvents = events.filter(e => e.name === 'RunMicrotasks');
if (microtaskEvents.length > 0) {
  let mtTotal = 0;
  microtaskEvents.forEach(e => {
    if (e.dur) mtTotal += e.dur / 1000;
  });
  console.log('\n=== PROMISE/MICROTASK OVERHEAD ===');
  console.log(`  Total RunMicrotasks: ${mtTotal.toFixed(1)} ms across ${microtaskEvents.length} events`);
}

// Look for rendering events
const renderEvents = events.filter(e =>
  e.name && (e.name.includes('Paint') || e.name.includes('Layout') || e.name.includes('Style') || e.name === 'UpdateLayerTree')
);

if (renderEvents.length > 0) {
  console.log('\n=== RENDERING EVENTS ===');
  const renderTimes = {};
  renderEvents.forEach(e => {
    if (e.dur) {
      renderTimes[e.name] = (renderTimes[e.name] || 0) + e.dur / 1000;
    }
  });

  Object.entries(renderTimes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([name, time]) => {
      console.log(`  ${time.toFixed(1).padStart(10)} ms - ${name}`);
    });
}

console.log('\n=== SUMMARY ===');
console.log(`Total measured time: ${(totalDuration / 1000).toFixed(2)} seconds`);
