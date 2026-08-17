const XLSX = require('./node_modules/xlsx');

const files = [
  { name: '系统导出', path: 'C:/Users/HUA WEI/Desktop/教师考勤统计表_2026-08-17 (7).xlsx' },
  { name: '用户模板', path: 'C:/Users/HUA WEI/Desktop/考勤代课安排.xlsx' }
];

files.forEach(f => {
  console.log('\n========== ' + f.name + ' (' + f.path + ') ==========');
  try {
    const wb = XLSX.readFile(f.path);
    console.log('Sheets:', wb.SheetNames);
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const ref = ws['!ref'];
      const merges = ws['!merges'] || [];
      console.log(`\n--- Sheet: ${name} (ref:${ref}, merges:${merges.length}) ---`);
      merges.forEach(m => {
        console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
      });
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      console.log(`  rows: ${data.length}`);
      const max = Math.min(data.length, 30);
      for (let i = 0; i < max; i++) {
        const r = data[i];
        if (!r) continue;
        const has = r.some(c => String(c).trim() !== '');
        if (has) {
          const cols = [];
          for (let ci = 0; ci < r.length; ci++) {
            if (String(r[ci]).trim() !== '') {
              cols.push(`${String.fromCharCode(65+ci)}${i+1}=${JSON.stringify(r[ci])}`);
            }
          }
          console.log(`  R${i+1}: ${cols.join(' | ')}`);
        }
      }
      if (data.length > 30) console.log(`  ... (${data.length - 30} more rows)`);
    });
  } catch (e) {
    console.log('ERROR:', e.message);
  }
});
