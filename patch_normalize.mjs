import fs from 'fs';
const p = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\app.js';
let s = fs.readFileSync(p, 'utf8');

// 在 handleExcelImport 后插入 day 规范化辅助函数
const insert = `// 日期规范化：'周一'/'周二'/... → '星期一'/'星期二'/...
const DAY_NORM = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六','周日':'星期日' };
function normDay(d) { return DAY_NORM[d] || d; }

`;

if (!s.includes('const DAY_NORM')) {
  // 找 handleExcelImport 后插入
  const target = `async function handleExcelImport(file) {`;
  const idx = s.indexOf(target);
  if (idx < 0) { console.log('❌ 找不到插入点'); process.exit(1); }
  s = s.slice(0, idx) + insert + s.slice(idx);
}

// 把 parseTimetableWorkbook 里 day 规范化
s = s.replace(
  "const day     = String(r[iDay] || '').trim();",
  "const day     = normDay(String(r[iDay] || '').trim());"
);
// 把课后服务表 day 也规范化
s = s.replace(
  "if (r[0]) currentDay = String(r[0]).trim();",
  "if (r[0]) currentDay = normDay(String(r[0]).trim());"
);

fs.writeFileSync(p, s, 'utf8');
console.log('✅ 规范化函数已注入，文件大小:', s.length);