const XLSX = require('xlsx');
const path = require('path');

const files = [
  'E:\\调课系统\\双井镇中心小学 2026 年春季学期总课表_标准化.xlsx',
  'E:\\调课系统\\2026年春季学期课后服务安排表.xlsx'
];

for (const f of files) {
  console.log('\n═══════ 文件:', path.basename(f), '═══════');
  try {
    const wb = XLSX.readFile(f);
    console.log('Sheet 名:', wb.SheetNames);
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const range = XLSX.utils.decode_range(ws['!ref']);
      console.log(`\n--- Sheet "${name}" (范围 ${ws['!ref']}, ${range.e.r + 1} 行 × ${range.e.c + 1} 列) ---`);
      // 打印前 30 行
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false });
      for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const r = rows[i] || [];
        const truncated = r.slice(0, 25).map(c => String(c||'').padEnd(8).slice(0, 12)).join(' | ');
        console.log(`R${(i+1).toString().padStart(2)}: ${truncated}`);
      }
      if (rows.length > 30) console.log(`... 共 ${rows.length} 行`);
    }
  } catch(e) {
    console.log('错误:', e.message);
  }
}