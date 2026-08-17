// 对比：模板 vs 当前代码生成
const XLSX = require('./node_modules/xlsx');

const tpl = XLSX.readFile('E:/课后服务/调课表/2026秋/考勤代课安排.xlsx').Sheets['请假表'];
const gen = XLSX.readFile('C:/Users/HUA WEI/Desktop/test_kaoqin_generated.xlsx').Sheets['教师考勤统计表'];

console.log('=== 模板 merges ===');
(tpl['!merges'] || []).forEach(m => {
  console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
});
console.log('\n=== 生成 merges ===');
(gen['!merges'] || []).forEach(m => {
  console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
});
