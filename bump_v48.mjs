import { readFileSync, writeFileSync } from 'fs';
const f = 'index.html';
const c = readFileSync(f, 'utf8');
const n = c.replace(/app\.js\?v=\d+/, m => 'app.js?v=48');
if (n === c) { console.log('no bump'); process.exit(1); }
writeFileSync(f, n);
console.log('bumped to v48');
