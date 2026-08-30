const fs = require('fs');
const s = fs.readFileSync('D:\\school-substitute\\app.js', 'utf8');
const lines = s.split('\n');
const kws = ['teacherSignature', 'principalSignature', 'slip.teacher', 'slip.principal', 'signature'];
lines.forEach((l, i) => {
  if (kws.some(k => l.includes(k))) {
    console.log((i+1) + ': ' + l.trim());
  }
});
console.log('\n--- 校长页相关函数名 ---');
['renderPrincipalPageBody','_renderPrincipalPageBody','showSlipDetailModal','printSlipContent','loadAndRenderPrincipalPage','showSlipPrintModal'].forEach(n => {
  const idx = s.indexOf('function ' + n);
  console.log(n + ': ' + (idx >= 0 ? '存在(L' + (s.substring(0,idx).split('\n').length) + ')' : '未找到'));
});
