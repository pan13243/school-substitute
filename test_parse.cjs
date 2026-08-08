// 直接测试解析逻辑
const XLSX = require('xlsx');

// 复制 app.js 中的 parseTimetableWorkbook 函数
function parseTimetableWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!rows.length) return null;
  let headerRow = 0;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const r = rows[i] || [];
    if (r.some(c => /教师/.test(String(c))) && r.some(c => /班级|星期|节次|课程/.test(String(c)))) {
      headerRow = i; break;
    }
  }
  const header = (rows[headerRow] || []).map(c => String(c||'').trim());
  const findCol = re => { for (let i=0; i<header.length; i++) if (re.test(header[i])) return i; return -1; };
  const iTeacher = findCol(/^教师姓名|^姓名/);
  const iDay     = findCol(/星期/);
  const iPeriod  = findCol(/节次|第.*节/);
  const iClass   = findCol(/班级/);
  const iSubject = findCol(/课程|科目/);
  if (iDay<0 || iClass<0 || iPeriod<0 || iSubject<0) return null;

  const timetable = {};
  const classes = new Set();
  const teachers = new Set();
  const teacherAssignment = {};
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const teacher = String(r[iTeacher] || '').trim();
    const day     = String(r[iDay] || '').trim();
    const period  = parseInt(String(r[iPeriod] || '').replace(/[^\d]/g,'')) || 0;
    const cls     = String(r[iClass] || '').trim();
    const subject = String(r[iSubject] || '').trim();
    if (!day || !cls || !period || !subject) continue;
    classes.add(cls);
    if (teacher) teachers.add(teacher);
    if (!timetable[day]) timetable[day] = {};
    if (!timetable[day][cls]) timetable[day][cls] = [];
    timetable[day][cls].push({ period, subject, teacher });
    if (teacher) {
      if (!teacherAssignment[cls]) teacherAssignment[cls] = {};
      teacherAssignment[cls][subject] = teacher;
    }
  }
  return {
    timetable, teacherAssignment,
    classes: [...classes], allTeachers: [...teachers],
    summary: {
      classes: classes.size, teachers: teachers.size,
      totalSlots: Object.values(timetable).reduce(
        (s,d) => s + Object.values(d).reduce((ss,p) => ss+p.length, 0), 0)
    }
  };
}

// 测试 1：总课表
console.log('══════ 测试 1：总课表标准化文件 ══════');
const f1 = 'E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx';
const wb1 = XLSX.readFile(f1);
const data1 = parseTimetableWorkbook(wb1);
console.log('班级数:', data1.classes.length, '(期望 21)');
console.log('教师数:', data1.allTeachers.length, '(期望 65)');
console.log('总节次:', data1.summary.totalSlots);
console.log('一（1）语文:', data1.teacherAssignment['一（1）']?.['语文']);
console.log('一（1）星期一第1节:', JSON.stringify(data1.timetable['星期一']?.['一（1）']?.[0]));

// 测试 2：课后服务表
console.log('\n══════ 测试 2：课后服务安排表 ══════');
function parseAfterSchoolWorkbook(wb) {
  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const ws = wb.Sheets[mainSheet];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!rows.length) return null;
  let headerRow = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const r = rows[i] || [];
    if (r.some(c => /星期/.test(String(c))) && r.some(c => /项目/.test(String(c)))) {
      headerRow = i; break;
    }
  }
  if (headerRow < 0) headerRow = 2;
  const header = (rows[headerRow] || []).map(c => String(c||'').trim());
  const classCols = [];
  for (let i = 0; i < header.length; i++) {
    if (/[一二三四五六]/.test(header[i]) && /\d/.test(header[i])) {
      classCols.push({ idx: i, name: header[i] });
    }
  }
  if (!classCols.length) return null;
  const slots = [];
  let currentDay = '';
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r[0]) currentDay = String(r[0]).trim();
    const timeRange = String(r[1] || '').trim();
    const project   = String(r[3] || '').trim();
    if (!timeRange && !project) continue;
    const slot = { day: currentDay, time: timeRange, project, assignments: {} };
    for (const c of classCols) {
      const v = String(r[c.idx] || '').trim();
      if (v) slot.assignments[c.name] = v;
    }
    slots.push(slot);
  }
  const days = [...new Set(slots.map(s => s.day).filter(Boolean))];
  return { sheet: mainSheet, days, slots, classes: classCols.map(c=>c.name) };
}

const f2 = 'E:\\调课系统\\2026年春季学期课后服务安排表.xlsx';
const wb2 = XLSX.readFile(f2);
console.log('Sheet 名:', wb2.SheetNames);
const data2 = parseAfterSchoolWorkbook(wb2);
if (data2) {
  console.log('主Sheet:', data2.sheet);
  console.log('天数:', data2.days, '时段数:', data2.slots.length);
  console.log('班级数:', data2.classes.length);
  console.log('首个时段:', JSON.stringify(data2.slots[0]));
} else {
  console.log('❌ 解析失败');
}