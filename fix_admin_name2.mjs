import { readFileSync, writeFileSync } from 'fs';
const c = readFileSync('app.js', 'utf8');
const lines = c.split('\n');
// L2318 mobileBackBar arg
lines[2317] = lines[2317].replace('代课记录', '代课安排');
// L2319 page title
lines[2318] = lines[2318].replace('代课记录', '代课安排');
// L2444 empty state
lines[2443] = lines[2443].replace('暂无代课记录', '暂无代课安排');
// L2451 count header
lines[2450] = lines[2450].replace('代课记录', '代课安排');
writeFileSync('app.js', lines.join('\n'), 'utf8');
console.log('Done');
// verify
const c2 = readFileSync('app.js', 'utf8');
const lines2 = c2.split('\n');
[2317,2318,2443,2450].forEach(l => console.log('L'+(l+1)+':', lines2[l]));
