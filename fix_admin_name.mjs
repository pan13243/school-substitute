import { readFileSync, writeFileSync } from 'fs';

const path = 'app.js';
let c = readFileSync(path, 'utf8');

const replacements = [
  [`sub: '代课记录',`, `sub: '代课安排',`],
  [`<button class="nav-btn" data-page="sub"     onclick="switchPage('sub')">✅ 代课记录\${subBadge}</button>`, `<button class="nav-btn" data-page="sub"     onclick="switchPage('sub')">✅ 代课安排\${subBadge}</button>`],
  [`<div class="stat-label">代课记录</div>`, `<div class="stat-label">代课安排</div>`],
  [`<span class="action-label">代课记录</span>`, `<span class="action-label">代课安排</span>`],
];

// Line-based replacements for multi-line blocks
const lines = c.split('\n');
const lineReplacements = [
  [2318, `代课记录\``, `代课安排\``],
  [2319, `✅ 代课记录</h2>`, `✅ 代课安排</h2>`],
  [2444, `<h3>暂无代课记录</h3>`, `<h3>暂无代课安排</h3>`],
  [2451, `<h3>代课记录 (\${substituteRecords.length})</h3>`, `<h3>代课安排 (\${substituteRecords.length})</h3>`],
];

let changed = 0;
for (const [old, neu] of replacements) {
  if (c.includes(old)) {
    c = c.replace(old, neu);
    changed++;
    console.log('✓ str:', old.substring(0, 60));
  } else {
    console.log('✗ NOT FOUND str:', old.substring(0, 60));
  }
}

for (const [lineno, old, neu] of lineReplacements) {
  if (lines[lineno - 1] === old) {
    lines[lineno - 1] = neu;
    changed++;
    console.log('✓ line' + lineno + ':', old.substring(0, 60));
  } else {
    console.log('✗ NOT FOUND line' + lineno + ':', old.substring(0, 60));
  }
}

writeFileSync(path, lines.join('\n'), 'utf8');
console.log(`\nDone: ${changed}/7 changed`);
