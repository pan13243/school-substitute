const XLSX = require('xlsx');
const wb = XLSX.readFile('E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
console.log('rows.length:', rows.length);

let headerRow = 0;
for (let i = 0; i < Math.min(3, rows.length); i++) {
  const r = rows[i] || [];
  if (r.some(c => /教师/.test(String(c))) && r.some(c => /班级|星期|节次|课程/.test(String(c)))) {
    headerRow = i; break;
  }
}
console.log('headerRow:', headerRow);
const header = (rows[headerRow] || []).map(c => String(c||'').trim());
console.log('header:', header);

const findCol = re => { for (let i=0; i<header.length; i++) if (re.test(header[i])) return i; return -1; };
const iTeacher = findCol(/^教师姓名|^姓名/);
const iDay     = findCol(/星期/);
const iPeriod  = findCol(/节次|第.*节/);
const iClass   = findCol(/班级/);
const iSubject = findCol(/课程|科目/);
console.log('列索引:', { iTeacher, iDay, iPeriod, iClass, iSubject });

if (iDay<0 || iClass<0 || iPeriod<0 || iSubject<0) {
  console.log('❌ 列识别失败');
  process.exit(1);
}

const timetable = {};
const classes = new Set();
const teachers = new Set();
let count = 0;
for (let i = headerRow + 1; i < rows.length; i++) {
  const r = rows[i] || [];
  const teacher = String(r[iTeacher] || '').trim();
  const day     = String(r[iDay] || '').trim();
  const period  = parseInt(String(r[iPeriod] || '').replace(/[^\d]/g,'')) || 0;
  const cls     = String(r[iClass] || '').trim();
  const subject = String(r[iSubject] || '').trim();
  if (!day || !cls || !period || !subject) continue;
  count++;
  classes.add(cls);
  if (teacher) teachers.add(teacher);
  if (!timetable[day]) timetable[day] = {};
  if (!timetable[day][cls]) timetable[day][cls] = [];
  timetable[day][cls].push({ period, subject, teacher });
}
console.log('有效数据行:', count);
console.log('班级:', classes.size, '教师:', teachers.size);