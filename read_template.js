const XLSX = require('./node_modules/xlsx');
const src = 'C:/Users/HUA WEI/Desktop/考勤代课安排.xlsx';
const wb = XLSX.readFile(src);
const ws = wb.Sheets['请假表'];
const ref = ws['!ref'];
console.log('Sheet ref:', ref);

// Show merges
console.log('\nMerges:', JSON.stringify(ws['!merges']));

// Print rows 1-20 with column detail
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
for (let i = 0; i < 20; i++) {
  const r = data[i];
  if (!r) continue;
  const has = r.some(c => String(c).trim() !== '');
  if (has) {
    console.log('\nRow ' + (i+1) + ':');
    for (let ci = 0; ci < r.length; ci++) {
      if (String(r[ci]).trim() !== '') {
        console.log('  [' + ci + '] (' + String.fromCharCode(65+ci) + '): ' + JSON.stringify(r[ci]));
      }
    }
  }
}
