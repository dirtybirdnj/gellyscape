const data = require('./output/test-svg-conversion.json');

console.log('Total text objects:', data.textObjects.length);

// Find text that's not just symbols
const meaningful = data.textObjects.filter(t => {
  if (!t.text || t.text.length === 0) return false;
  // Filter out pure symbol text
  if (t.text.match(/^[―│\s]+$/)) return false;
  return true;
});

console.log('\nMeaningful text objects:', meaningful.length);

console.log('\nSample of first 30 meaningful text objects:');
meaningful.slice(0, 30).forEach((t, i) => {
  const preview = t.text.length > 50 ? t.text.substring(0, 50) + '...' : t.text;
  console.log(`${i+1}. "${preview}" (font: ${t.font})`);
});

// Group by font
const byFont = {};
meaningful.forEach(t => {
  if (!byFont[t.font]) byFont[t.font] = [];
  byFont[t.font].push(t.text);
});

console.log('\n\nText objects by font:');
Object.keys(byFont).forEach(font => {
  console.log(`\n${font}: ${byFont[font].length} objects`);
  console.log('  Sample:', byFont[font].slice(0, 5).join(', '));
});
