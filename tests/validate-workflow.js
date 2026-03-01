#!/usr/bin/env node
// Static validation for security-news-workflow.json
// Run: node tests/validate-workflow.js

const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '..', 'security-news-workflow.json');
let wf;
try {
  wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
} catch (e) {
  console.error(`❌ Failed to parse workflow JSON: ${e.message}`);
  process.exit(1);
}

let errors = 0;
let warnings = 0;

function check(condition, msg) {
  if (!condition) { console.error(`  ❌ FAIL: ${msg}`); errors++; }
  else console.log(`  ✅ ${msg}`);
}

function warn(condition, msg) {
  if (!condition) { console.warn(`  ⚠️  WARN: ${msg}`); warnings++; }
}

// ===== 1. Basic Structure =====
console.log('\n=== Structure ===');
check(Array.isArray(wf.nodes), 'nodes is an array');
check(typeof wf.connections === 'object', 'connections is an object');
check(wf.nodes.length >= 69, `Node count: ${wf.nodes.length} (expected >= 69)`);

// ===== 2. No Duplicate Node Names =====
console.log('\n=== Uniqueness ===');
const names = wf.nodes.map(n => n.name);
const nameSet = new Set(names);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check(dupes.length === 0, `No duplicate node names${dupes.length ? ': ' + dupes.join(', ') : ''}`);

// ===== 3. Connection Integrity =====
console.log('\n=== Connections ===');
const conns = wf.connections || {};
let connCount = 0;
for (const [src, srcConns] of Object.entries(conns)) {
  check(nameSet.has(src), `Source exists: "${src}"`);
  for (const portList of (srcConns.main || [])) {
    for (const c of portList) {
      check(nameSet.has(c.node), `Target exists: "${c.node}" (from "${src}")`);
      connCount++;
    }
  }
}
console.log(`  Total connections: ${connCount}`);

// ===== 4. Critical Nodes =====
console.log('\n=== Critical Nodes ===');
const critical = [
  'Telegram Trigger', 'Parse Command', 'Is Help?', 'Send Help',
  'Is CVE Lookup?', 'Is AI?', 'Send AI Thinking', 'Call AI',
  'Is Audio Response?', 'Edit AI Response', 'Prepare TTS',
  'Fetch TTS Audio', 'Prepare Audio Send', 'Has Audio?',
  'Send Voice Reply', 'Edit After Audio',
  'Send Processing', 'Route to Fetchers', 'Tag Category',
  'Condense Digest', 'Generate AI Briefing',
  'Cron Daily',
];
for (const name of critical) {
  check(nameSet.has(name), `"${name}"`);
}

// ===== 5. $node[] Reference Integrity =====
console.log('\n=== Node References ===');
const nodeRefPattern = /\$node\['([^']+)'\]/g;
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || node.parameters?.functionCode || '';
  let match;
  while ((match = nodeRefPattern.exec(code)) !== null) {
    check(nameSet.has(match[1]), `$node['${match[1]}'] valid (in "${node.name}")`);
  }
}

// ===== 6. $() Reference Integrity =====
const dollarRefPattern = /\$\('([^']+)'\)/g;
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || node.parameters?.functionCode || '';
  let match;
  while ((match = dollarRefPattern.exec(code)) !== null) {
    check(nameSet.has(match[1]), `$('${match[1]}') valid (in "${node.name}")`);
  }
}

// ===== 7. Code Node Patterns =====
console.log('\n=== Code Patterns ===');
for (const node of wf.nodes) {
  if (node.type === 'n8n-nodes-base.code') {
    const code = node.parameters?.jsCode || '';
    warn(!code.includes('this.helpers.request('), `"${node.name}": uses this.helpers.request (broken in n8n 2.10.x) — use httpRequest`);
  }
}

// ===== 8. Call AI Media Analysis Blocks =====
console.log('\n=== Media Analysis ===');
for (const node of wf.nodes) {
  if (node.name === 'Call AI') {
    const code = node.parameters?.jsCode || '';
    check(code.includes('// ===== VOICE TRANSCRIPTION ====='), 'Voice transcription block present');
    check(code.includes('// ===== PHOTO ANALYSIS ====='), 'Photo analysis block present');
    check(code.includes('// ===== VIDEO ANALYSIS ====='), 'Video analysis block present');
    check(code.includes('inline_data'), 'Photo uses inline_data');
    check(code.includes('file_data'), 'Video uses file_data');
    check(code.includes('X-Goog-Upload-Protocol'), 'File API upload header present');
    check(code.includes('Video too large'), 'File size guard present');
    check(code.includes('_maxPolls'), 'Polling limit present');
    check(code.includes("'Image Analysis'"), 'Photo response header present');
    check(code.includes("'Video Analysis'"), 'Video response header present');
  }
}

// ===== 9. Env Var Audit =====
console.log('\n=== Environment Variables ===');
const envPattern = /\$env\.(\w+)/g;
const envVars = new Set();
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || node.parameters?.functionCode || '';
  let match;
  while ((match = envPattern.exec(code)) !== null) {
    envVars.add(match[1]);
  }
}
console.log(`  Referenced: ${[...envVars].sort().join(', ')}`);

// ===== Summary =====
console.log('\n' + '='.repeat(50));
if (errors === 0) {
  console.log(`✅ ALL CHECKS PASSED (${warnings} warnings)`);
} else {
  console.log(`❌ ${errors} CHECKS FAILED (${warnings} warnings)`);
}
process.exit(errors > 0 ? 1 : 0);
