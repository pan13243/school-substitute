const XLSX = require('./node_modules/xlsx');
const src = 'C:/Users/HUA WEI/Desktop/考勤代课安排.xlsx';
const wb = XLSX.readFile(src);
const ws = wb.Sheets['请假表'];
console.log('Sheet ref:', ws['!ref']);
console.log('Merges count:', (ws['!merges'] || []).length);
const merges = ws['!merges'] || [];
merges.forEach(m => {
  console.log(`  ${m.s.r+1}:${m.s.c+1} -> ${m.e.r+1}:${m.e.c+1}`);
});
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
console.log('Total rows:', data.length);
for (let i = 0; i < 20; i++) {
  const r = data[i];
  if (!r) continue;
  const has = r.some(c => String(c).trim() !== '');
  if (has) {
    console.log('\nRow ' + (i+1) + ':');
    for (let ci = 0; ci < r.length; ci++) {
      if (String(r[ci]).trim() !== '') {
        console.log('  col' + ci + '(' + String.fromCharCode(65+ci) + '):', JSON.stringify(r[ci]));
      }
    }
  }
}
