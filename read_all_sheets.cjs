const XLSX = require('./node_modules/xlsx');
const src = 'C:/Users/HUA WEI/Desktop/考勤代课安排.xlsx';
const wb = XLSX.readFile(src);
console.log('Sheets:', wb.SheetNames);

wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const ref = ws['!ref'];
  const merges = ws['!merges'] || [];
  console.log(`\n=== Sheet: ${name} (ref:${ref}, rows:${data.length}, merges:${merges.length}) ===`);
  data.slice(0, 30).forEach((r, i) => {
    const has = r.some(c => String(c).trim() !== '');
    if (has) {
      const cols = [];
      r.forEach((c, ci) => { if (String(c).trim() !== '') cols.push(`${ci}(${String.fromCharCode(65+ci)})=${JSON.stringify(c)}`); });
      console.log(`  Row${i+1}: ${cols.join(' | ')}`);
    }
  });
});
