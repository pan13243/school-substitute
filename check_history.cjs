const { execSync } = require('child_process');
const fs = require('fs');

const commits = ['b48865b', '2adebef', 'a1417d9', '14904de', 'f1e5f9c', '02a9127', '69cd984'];
commits.forEach(sha => {
  try {
    const content = execSync(`git show ${sha}:app.js`, { cwd: 'C:\\Users\\HUA WEI\\Downloads\\school-substitute' }).toString('utf8');
    // 找到 exportSubKaoqin 的核心表头行
    const lines = content.split('\n');
    let inFn = false;
    let fnLines = [];
    lines.forEach((line, i) => {
      if (line.includes('async function exportSubKaoqin') || line.includes('function exportSubKaoqin')) inFn = true;
      if (inFn && line.includes("rows[3][") || inFn && line.includes("rows[4][") || inFn && line.includes("rows[5][") || inFn && line.includes("rows[6][")) {
        fnLines.push(`L${i+1}: ${line.trim()}`);
      }
      if (inFn && line.includes("writeFile(wb,")) { inFn = false; }
    });
    console.log(`\n=== ${sha} ===`);
    fnLines.slice(0, 20).forEach(l => console.log('  ' + l));
  } catch (e) {
    console.log(`\n=== ${sha} === ERROR: ${e.message}`);
  }
});
