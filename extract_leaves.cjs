const fs = require('fs');
const p = 'D:\\school-substitute\\functions\\api\\[[path]].js';
const s = fs.readFileSync(p, 'utf8');
function show(name, ctx) {
  const i = s.indexOf('function ' + name);
  if (i < 0) { console.log('=== ' + name + ' 未找到 ==='); return; }
  const j = s.indexOf('\nfunction ', i + 10);
  const end = j < 0 ? s.length : j;
  console.log('=== ' + name + (ctx ? ' (' + ctx + ')' : '') + ' ===');
  console.log(s.substring(i, end));
  console.log('');
}
show('handleLeaveSlipsGet');
show('loadLeavesStore');
// getKV / putKV
const g = s.indexOf('async function getKV');
if (g < 0) { const g2 = s.indexOf('function getKV'); }
show('getKV');
show('putKV');
// 路由里的 leave-slips
const lines = s.split('\n');
lines.forEach((l, idx) => { if (l.includes("'leave-slips'") || l.includes('"/api/leave-slips"') || l.includes('leave-slips')) console.log('ROUTE ' + (idx+1) + ': ' + l.trim()); });
