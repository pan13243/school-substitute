// 复制新解析逻辑测试
const XLSX = require('xlsx');

const DAY_NORM = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六','周日':'星期日' };
function normDay(d) { return DAY_NORM[d] || d; }

function parseAfterSchoolSheet(ws, sheetName) {
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
    if (r[0]) currentDay = normDay(String(r[0]).trim());
    const timeRange = String(r[1] || '').trim();
    const project   = String(r[3] || '').trim();
    if (!timeRange && !project) continue;
    const slot = { day: currentDay, time: timeRange, project, sheet: sheetName, assignments: {} };
    for (const c of classCols) {
      const v = String(r[c.idx] || '').trim();
      if (v) slot.assignments[c.name] = v;
    }
    slots.push(slot);
  }
  const days = [...new Set(slots.map(s => s.day).filter(Boolean))];
  return { sheet: sheetName, days, slots, classes: classCols.map(c=>c.name) };
}

function parseAfterSchoolWorkbook(wb) {
  const hasSeparateSheets = wb.SheetNames.includes('单周') && wb.SheetNames.includes('双周');
  if (hasSeparateSheets) {
    const single = parseAfterSchoolSheet(wb.Sheets['单周'], '单周');
    const double = parseAfterSchoolSheet(wb.Sheets['双周'], '双周');
    if (single && double) {
      for (const slot of single.slots) for (const k in slot.assignments) slot.assignments[k] = { single: slot.assignments[k], week: '单周' };
      for (const slot of double.slots) for (const k in slot.assignments) slot.assignments[k] = { single: slot.assignments[k], week: '双周' };
      return {
        source: 'separate-sheets',
        days: single.days,
        slots: [...single.slots, ...double.slots],
        classes: single.classes
      };
    }
  }

  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const base = parseAfterSchoolSheet(wb.Sheets[mainSheet], mainSheet);
  if (!base) return null;
  for (const slot of base.slots) {
    const newAssign = {};
    for (const cls in slot.assignments) {
      const v = slot.assignments[cls];
      const lines = String(v).split(/\r?\n/).filter(x => x.trim());
      if (lines.length === 1) {
        newAssign[cls] = { single: lines[0], week: '通用' };
      } else if (lines.length === 2) {
        newAssign[cls] = { single: lines[0], double: lines[1], week: '单周/双周' };
      } else {
        newAssign[cls] = lines.map((t, i) => i === 0 ? { single: t } : i === 1 ? { double: t } : { extra: t });
      }
    }
    slot.assignments = newAssign;
  }
  return { source: mainSheet, days: base.days, slots: base.slots, classes: base.classes };
}

// ── 测试 ──
const wb = XLSX.readFile('E:\\调课系统\\2026年春季学期课后服务安排表.xlsx');
const data = parseAfterSchoolWorkbook(wb);
console.log('来源:', data.source);
console.log('天数:', data.days);
console.log('总时段数:', data.slots.length);
console.log('班级数:', data.classes.length);

// 检查双教师处理
let singleCount = 0, doubleCount = 0, bothCount = 0;
for (const slot of data.slots) {
  for (const cls in slot.assignments) {
    const a = slot.assignments[cls];
    if (typeof a === 'object' && a.single && a.double) {
      bothCount++;
      if (bothCount <= 5) {
        console.log(`  ${slot.day} ${slot.time} ${slot.project} ${cls}:`);
        console.log(`    单周: ${a.single}, 双周: ${a.double}`);
      }
    } else if (typeof a === 'object' && a.single) {
      singleCount++;
    }
  }
}
console.log(`\n统计: 仅单周/双周通用=${singleCount}, 双周轮替=${bothCount}`);

// 验证：三（2）晚自习 应该被分成 单周=文凯 / 双周=熊欢
const target = data.slots.find(s => s.day === '星期一' && s.project === '晚自习');
if (target) {
  console.log('\n周一晚自习 三（2）:', JSON.stringify(target.assignments['三（2）']));
}
const target4 = data.slots.find(s => s.day === '星期一' && /课后服务/.test(s.project));
if (target4) {
  console.log('周一课后服务2 四（2）:', JSON.stringify(target4.assignments['四（2）']));
}