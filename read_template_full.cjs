const XLSX = require('./node_modules/xlsx');

// 用户提供的两个文件
const files = [
  'C:/Users/HUA WEI/Desktop/考勤代课安排.xlsx',  // 用户发的模板（看起来只有表头）
  'E:/课后服务/调课表/2026秋/考勤代课安排.xlsx'  // E盘那个文件
];

files.forEach(src => {
  console.log('\n========== ' + src + ' ==========');
  try {
    const wb = XLSX.readFile(src);
    console.log('Sheets:', wb.SheetNames);
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const ref = ws['!ref'];
      const merges = ws['!merges'] || [];
      console.log(`\n--- Sheet: ${name} (ref:${ref}, rows total in range, merges:${merges.length}) ---`);
      console.log('Merges:');
      merges.forEach(m => {
        console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
      });
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      console.log(`rows: ${data.length}`);
      // 打印前20行
      for (let i = 0; i < Math.min(data.length, 20); i++) {
        const r = data[i];
        if (!r) continue;
        const has = r.some(c => String(c).trim() !== '');
        if (has) {
          const cols = [];
          for (let ci = 0; ci < r.length; ci++) {
            if (String(r[ci]).trim() !== '') {
              cols.push(`${String.fromCharCode(65+ci)}=${JSON.stringify(r[ci])}`);
            }
          }
          console.log(`  Row${i+1}: ${cols.join(' | ')}`);
        }
      }
    });
  } catch (e) {
    console.log('ERROR:', e.message);
  }
});
