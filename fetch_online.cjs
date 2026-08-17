const https = require('https');

const urls = [
  { host: 'b5b41afc.school-substitute-test.pages.dev', name: 'preview-b5b41afc' }
];

function fetch(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: host, path, headers: { 'Cache-Control': 'no-cache' } }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => reject(new Error('timeout')));
  });
}

(async () => {
  for (const u of urls) {
    const html = await fetch(u.host, '/');
    const appJsMatch = html.body.match(/app\.js\?v=(\d+)/);
    console.log(`${u.name}: html status ${html.status}, app.js?v=${appJsMatch ? appJsMatch[1] : '?'}`);
    if (appJsMatch) {
      const appJs = await fetch(u.host, '/app.js?v=' + appJsMatch[1] + '&_t=' + Date.now());
      console.log(`  app.js size: ${appJs.body.length}`);
      // 找到 exportSubKaoqin 函数
      const idx = appJs.body.indexOf('async function exportSubKaoqin');
      console.log(`  exportSubKaoqin start at: ${idx}`);
      if (idx > 0) {
        const fn = appJs.body.substring(idx, idx + 4000);
        console.log('  --- function source ---');
        console.log(fn);
        console.log('  --- end ---');
      }
    }
  }
})().catch(e => console.log('ERR:', e.message));
