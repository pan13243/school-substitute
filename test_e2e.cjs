const XLSX = require('xlsx');
const http = require('http');

// ── 复制前端 parseTimetableWorkbook ──
const DAY_NORM = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六','周日':'星期日' };
function normDay(d) { return DAY_NORM[d] || d; }

function parseTimetableWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
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
  const timetable = {};
  const classes = new Set();
  const teachers = new Set();
  const teacherAssignment = {};
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const teacher = String(r[iTeacher] || '').trim();
    const day     = normDay(String(r[iDay] || '').trim());
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
  return { timetable, teacherAssignment, classes: [...classes], allTeachers: [...teachers] };
}

function parseAfterSchoolWorkbook(wb) {
  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const ws = wb.Sheets[mainSheet];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
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
  const slots = [];
  let currentDay = '';
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r[0]) currentDay = normDay(String(r[0]).trim());
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

// ── API helper ──
function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const r = http.request({
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(b), ...headers }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); } });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

async function main() {
  console.log('═══ 端到端测试：Excel → 解析 → 导入 → 请假 → 代课 ═══\n');

  // 1. 解析两份 Excel
  console.log('1️⃣  解析总课表...');
  const wb1 = XLSX.readFile('E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx');
  const scheduleData = parseTimetableWorkbook(wb1);
  console.log('   班级:', scheduleData.classes.length, '教师:', scheduleData.allTeachers.length);
  console.log('   验证一（1）星期一第1节:', JSON.stringify(scheduleData.timetable['星期一']?.['一（1）']?.[0]));

  console.log('\n2️⃣  解析课后服务表...');
  const wb2 = XLSX.readFile('E:\\调课系统\\2026年春季学期课后服务安排表.xlsx');
  const afterSchool = parseAfterSchoolWorkbook(wb2);
  console.log('   主Sheet:', afterSchool.sheet, ' 天数:', afterSchool.days.length, '时段:', afterSchool.slots.length);

  // 3. 合并导入
  console.log('\n3️⃣  合并后导入到系统...');
  const merged = {
    ...scheduleData,
    afterSchoolService: afterSchool
  };
  const r1 = await req('POST', '/api/schedule/import', merged, { 'x-admin-pwd':'admin888' });
  console.log('   导入结果:', r1.success ? '✓ ' + r1.message : '✗ ' + r1.error);

  // 4. 清空旧请假和代课
  await req('DELETE', '/api/leaves', null, { 'x-admin-pwd':'admin888' });
  await req('DELETE', '/api/substitutes', null, { 'x-admin-pwd':'admin888' });

  // 5. 请假登记
  console.log('\n4️⃣  请假登记：龙燕 星期一...');
  const r2 = await req('POST', '/api/leaves', {
    teacherName: '龙燕', leaveDate: '星期一', reason: '测试 Excel 导入'
  });
  console.log('   请假添加:', r2.success ? '✓' : '✗', r2.data?.id || r2.error);

  // 6. 生成代课
  console.log('\n5️⃣  生成代课...');
  const r3 = await req('POST', '/api/substitutes/generate', {}, { 'x-admin-pwd':'admin888' });
  if (r3.success) {
    console.log('   安排:', r3.summary?.arranged, '条, 失败:', r3.summary?.failed, '条');
    if (r3.results?.[0]) {
      const r = r3.results[0];
      console.log('   示例:', r.leaveTeacher, '请假 →', r.substituteTeacher, '代课');
      console.log('         ', r.className, r.subject, r.dayOfWeek, '第'+r.period+'节');
    }
  } else {
    console.log('   ✗ 失败:', r3.error);
  }

  // 7. 验证数据
  console.log('\n6️⃣  验证课表数据...');
  const r4 = await req('GET', '/api/schedule');
  console.log('   班级:', r4.data?.classes?.length, '教师:', r4.data?.allTeachers?.length);
  console.log('   一（1）星期一第1节:', JSON.stringify(r4.data?.timetable?.['星期一']?.['一（1）']?.[0]));

  console.log('\n✅ 全部测试完成！');
}

main().catch(console.error);