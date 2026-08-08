const XLSX = require('xlsx');
const wb = XLSX.readFile('E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
const days = new Set();
const classes = new Set();
for (let i = 1; i < rows.length; i++) {
  days.add(rows[i][1]);
  classes.add(rows[i][3]);
}
console.log('星期样本:', [...days]);
console.log('班级样本:', [...classes]);