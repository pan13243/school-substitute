import fs from 'fs';
const p = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\app.js';
let s = fs.readFileSync(p, 'utf8');

const oldFn = `function parseAfterSchoolWorkbook(wb) {
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
}`;

const newFn = `function parseAfterSchoolWorkbook(wb) {
  // 优先用「单周」/「双周」两个独立 Sheet（最准确的数据源）
  const hasSeparateSheets = wb.SheetNames.includes('单周') && wb.SheetNames.includes('双周');
  if (hasSeparateSheets) {
    const single = parseAfterSchoolSheet(wb.Sheets['单周'], '单周');
    const double = parseAfterSchoolSheet(wb.Sheets['双周'], '双周');
    if (single && double) {
      // 在 assignments 上加 \`week\` 标记
      for (const s of single.slots) for (const k in s.assignments) s.assignments[k] = { single: s.assignments[k], week: '单周' };
      for (const s of double.slots) for (const k in s.assignments) s.assignments[k] = { single: s.assignments[k], week: '双周' };
      return {
        source: 'separate-sheets',
        days: single.days,
        slots: [...single.slots, ...double.slots],
        classes: single.classes,
        single, double
      };
    }
  }

  // 否则用 3.3执行 / 无午休 Sheet；同一单元格双教师 → 上一个=单周，下一个=双周
  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const base = parseAfterSchoolSheet(wb.Sheets[mainSheet], mainSheet);
  if (!base) return null;
  // 给 assignments 打 week 标记：双行拆分
  for (const slot of base.slots) {
    const newAssign = {};
    for (const cls in slot.assignments) {
      const v = slot.assignments[cls];
      const lines = String(v).split(/\\r?\\n/).filter(x => x.trim());
      if (lines.length === 1) {
        newAssign[cls] = { single: lines[0], week: '通用' };
      } else if (lines.length === 2) {
        newAssign[cls] = { single: lines[0], double: lines[1], week: '单周/双周' };
      } else {
        // 3+ 行：依次 单周/双周/通用… 循环
        newAssign[cls] = lines.map((t,i) => i === 0 ? { single: t } : i === 1 ? { double: t } : { extra: t });
        newAssign[cls]._lines = lines;
      }
    }
    slot.assignments = newAssign;
  }
  return { source: mainSheet, days: base.days, slots: base.slots, classes: base.classes };
}

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
    if (/[一二三四五六]/.test(header[i]) && /\\d/.test(header[i])) {
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
}`;

if (!s.includes(oldFn.slice(0, 100))) {
  console.log('❌ 未找到原函数');
  process.exit(1);
}
s = s.replace(oldFn, newFn);
fs.writeFileSync(p, s, 'utf8');
console.log('✅ parseAfterSchoolWorkbook 已重写，文件大小:', s.length);