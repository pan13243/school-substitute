const XLSX = require('xlsx');
const f = 'E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx';
const wb = XLSX.readFile(f);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
console.log('总行数:', rows.length);
console.log('表头:', rows[0]);
// 统计
const stats = { teachers: new Set(), days: new Set(), periods: new Set(), classes: new Set(), subjects: new Set() };
for (let i = 1; i < rows.length; i++) {
  const r = rows[i] || [];
  if (r.length >= 5) {
    stats.teachers.add(r[0]);
    stats.days.add(r[1]);
    stats.periods.add(r[2]);
    stats.classes.add(r[3]);
    stats.subjects.add(r[4]);
  }
}
console.log('教师数:', stats.teachers.size, '星期:', [...stats.days].join(','), '节次:', [...stats.periods].join(','));
console.log('班级:', stats.classes.size, [...stats.classes].slice(0, 5).join(','), '...');
console.log('科目:', stats.subjects.size, [...stats.subjects].join(','));
// 看最后 3 行
console.log('\n最后 3 行:');
for (let i = rows.length - 3; i < rows.length; i++) console.log(`R${i+1}:`, rows[i]);
console.log('\n第 30-35 行 (验证下午):');
for (let i = 30; i < 35; i++) console.log(`R${i+1}:`, rows[i]);
// 看节次类型
const periodSet = [...stats.periods].sort();
console.log('\n节次种类:', periodSet.join(' | '));