const fs = require('fs');
const s = fs.readFileSync('D:\\school-substitute\\app.js', 'utf8');
const i = s.indexOf('function sigHeaders');
const j = s.indexOf('\nfunction ', i + 10);
console.log('=== 当前 sigHeaders（v91）===');
console.log(s.substring(i, j));
// 顺便看 addToSigLib
const k = s.indexOf('function addToSigLib');
const l = s.indexOf('\nfunction ', k + 10);
console.log('\n=== addToSigLib ===');
console.log(s.substring(k, l));
// index.html 版本
const html = fs.readFileSync('D:\\school-substitute\\index.html', 'utf8');
const m = html.match(/app\.js\?v=(\d+)/);
console.log('\n=== index.html app.js?v=' + (m ? m[1] : '?'));
