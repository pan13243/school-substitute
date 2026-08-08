const XLSX = require('xlsx');
const wb = XLSX.readFile('E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx');
console.log('Sheet 名:', wb.SheetNames);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
console.log('总行数:', rows.length);
console.log('\n前 5 行:');
rows.slice(0, 5).forEach((r, i) => {
  console.log(`  Row ${i+1}: `, JSON.stringify(r));
});
console.log('\n后 3 行:');
rows.slice(-3).forEach((r, i) => {
  console.log(`  Row ${rows.length - 2 + i}: `, JSON.stringify(r));
});