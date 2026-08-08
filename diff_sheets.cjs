const XLSX = require('xlsx');
const wb = XLSX.readFile('E:\\调课系统\\2026年春季学期课后服务安排表.xlsx');
const ws1 = wb.Sheets['单周'];
const ws2 = wb.Sheets['双周'];
const r1 = XLSX.utils.sheet_to_json(ws1, { header: 1, raw: true, blankrows: false });
const r2 = XLSX.utils.sheet_to_json(ws2, { header: 1, raw: true, blankrows: false });

// 找晚自习 行（4-23 不固定），按 project 找
function findRow(rows, day, project) {
  let currentDay = '';
  for (const r of rows) {
    if (r[0]) currentDay = String(r[0]);
    const time = String(r[1] || '');
    const p = String(r[3] || '');
    if (currentDay === day && p.includes(project)) return r;
  }
  return null;
}

console.log('—— 查找晚自习 ——');
const s1 = findRow(r1, '周一', '晚自习');
const s2 = findRow(r2, '周一', '晚自习');
console.log('单周晚自习 周一:', JSON.stringify(s1));
console.log('双周晚自习 周一:', JSON.stringify(s2));

// 提取每个 sheet 的 "周一" 整行对比
console.log('\n—— 周一所有时段对比（按 r[0]==周一） ——');
const sMon1 = r1.filter(r => r[0] === '周一');
const sMon2 = r2.filter(r => r[0] === '周一');
console.log('单周行数:', sMon1.length, '双周行数:', sMon2.length);
console.log('单周项目:', sMon1.map(r => r[3]));
console.log('双周项目:', sMon2.map(r => r[3]));

// 对比每个时段 三（2）列（索引应能找到）
function getCol(rows, header, className) {
  const hr = rows.findIndex((r, i) => r.some(c => /星期/.test(String(c))) && r.some(c => /项目/.test(String(c))));
  if (hr < 0) return -1;
  return header[hr].findIndex(c => String(c).trim() === className);
}
const header1 = r1.find((r, i) => r.some(c => /星期/.test(String(c))) && r.some(c => /项目/.test(String(c))));
const idx32 = header1.findIndex(c => String(c).trim() === '三（2）');
console.log('三（2） 列索引:', idx32);

console.log('\n—— 三（2） 单周 vs 双周对比 ——');
sMon1.forEach((r1row, i) => {
  const r2row = sMon2[i];
  console.log(`  ${r1row[1]} ${r1row[3]}:`);
  console.log(`    单周: ${r1row[idx32]}`);
  console.log(`    双周: ${r2row[idx32]}`);
});