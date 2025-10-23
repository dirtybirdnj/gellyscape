const fs = require('fs');
const path = require('path');

// Read the JSON metadata
const jsonPath = path.join(__dirname, 'output', 'test-svg-conversion.json');
const svgPath = path.join(__dirname, 'output', 'test-svg-output.svg');

if (!fs.existsSync(jsonPath)) {
  console.error('Error: output/test-svg-conversion.json not found');
  console.error('Run "node test-svg-conversion.js" first to generate the output');
  process.exit(1);
}

if (!fs.existsSync(svgPath)) {
  console.error('Error: output/test-svg-output.svg not found');
  console.error('Run "node test-svg-conversion.js" first to generate the output');
  process.exit(1);
}

const data = require(jsonPath);
const svgContent = fs.readFileSync(svgPath, 'utf8');

console.log('Total text objects:', data.metadata.totalTextObjects);

// Extract text from SVG
const textRegex = /<text[^>]*data-font="([^"]*)"[^>]*>([^<]*)<\/text>/g;
const textObjects = [];
let match;

while ((match = textRegex.exec(svgContent)) !== null) {
  textObjects.push({
    font: match[1],
    text: match[2]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  });
}

console.log('Extracted from SVG:', textObjects.length, 'text elements');

// Find text that's not just symbols
const meaningful = textObjects.filter(t => {
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
textObjects.forEach(t => {
  if (!byFont[t.font]) byFont[t.font] = [];
  byFont[t.font].push(t.text);
});

console.log('\n\nText objects by font:');
Object.keys(byFont).sort().forEach(font => {
  const unique = [...new Set(byFont[font])].filter(t => t.trim().length > 0);
  console.log(`\n${font}: ${byFont[font].length} total, ${unique.length} unique`);
  console.log('  Sample:', unique.slice(0, 10).join(', '));
});
