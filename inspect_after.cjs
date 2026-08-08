const XLSX = require('xlsx');
const wb = XLSX.readFile('E:\\调课系统\\2026年春季学期课后服务安排表.xlsx');
console.log('Sheet 名:', wb.SheetNames);

// 看 3.3执行 的所有双教师单元格
const ws = wb.Sheets['3.3执行'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
console.log('3.3执行 总行数:', rows.length);

// 找表头
let headerRow = -1;
for (let i = 0; i < Math.min(8, rows.length); i++) {
  const r = rows[i] || [];
  if (r.some(c => /星期/.test(String(c))) && r.some(c => /项目/.test(String(c)))) {
    headerRow = i; break;
  }
}
console.log('表头行:', headerRow);
const header = (rows[headerRow] || []).map(c => String(c||'').trim());
console.log('表头:', header);

// 找含换行的单元格
let multiCount = 0;
const multiSamples = [];
for (let i = headerRow + 1; i < rows.length; i++) {
  const r = rows[i] || [];
  for (let j = 0; j < r.length; j++) {
    const v = String(r[j] || '');
    if (v.includes('\n')) {
      multiCount++;
      if (multiSamples.length < 6) {
        multiSamples.push({
          row: i, col: j, colName: header[j],
          value: v,
          day: r[0], time: r[1], project: r[3]
        });
      }
    }
  }
}
console.log('\n含换行的单元格数:', multiCount);
console.log('样本:');
multiSamples.forEach(s => {
  console.log(`  ${s.day} ${s.time} ${s.project} → ${s.colName}: [${s.value.replace(/\n/g, ' | ')}]`);
});

// 再看 "单周" 和 "双周" sheet
console.log('\n══════ 单周 Sheet ══════');
const wsSingle = wb.Sheets['单周'];
if (wsSingle) {
  const rowsS = XLSX.utils.sheet_to_json(wsSingle, { header: 1, raw: true, blankrows: false });
  console.log('行数:', rowsS.length);
  console.log('前5行:');
  rowsS.slice(0, 5).forEach((r, i) => console.log(`  ${i+1}:`, JSON.stringify(r).slice(0, 200)));
}

console.log('\n══════ 双周 Sheet ══════');
const wsDouble = wb.Sheets['双周'];
if (wsDouble) {
  const rowsD = XLSX.utils.sheet_to_json(wsDouble, { header: 1, raw: true, blankrows: false });
  console.log('行数:', rowsD.length);
  console.log('前5行:');
  rowsD.slice(0, 5).forEach((r, i) => console.log(`  ${i+1}:`, JSON.stringify(r).slice(0, 200)));
}