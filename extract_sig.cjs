const fs = require('fs');
const p = 'D:\\school-substitute\\functions\\api\\[[path]].js';
const s = fs.readFileSync(p, 'utf8');
function show(name) {
  const i = s.indexOf('function ' + name);
  if (i < 0) { console.log('=== ' + name + ' 未找到 ==='); return; }
  // 找到函数体结束（粗略：下一个顶层 function 之前）
  const j = s.indexOf('\nfunction ', i + 10);
  const end = j < 0 ? s.length : j;
  console.log('=== ' + name + ' ===');
  console.log(s.substring(i, end));
  console.log('');
}
show('handleSignaturesGet');
show('handleSignaturesPost');
// 也看一下路由分发里 signatures 的处理
const r = s.indexOf('/api/signatures');
console.log('=== 路由中含 /api/signatures 的行 ===');
const lines = s.split('\n');
lines.forEach((l, idx) => { if (l.includes('signatures')) console.log((idx+1) + ': ' + l.trim()); });
