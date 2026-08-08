const http = require('http');

function req(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost', port: 3000, path,
      method, headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(b),
        ...extraHeaders
      }
    };
    const r = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error(d)); }
      });
    });
    r.on('error', reject);
    if (b) r.write(b);
    r.end();
  });
}

function get(path)  { return req('GET',    path, null); }
function post(path, body, headers) { return req('POST', path, body, headers); }
function del(path, headers) { return req('DELETE', path, null, headers); }

async function main() {
  // 0. 清空旧数据
  await del('/api/leaves',       { 'x-admin-pwd': 'admin888' });
  await del('/api/substitutes',   { 'x-admin-pwd': 'admin888' });

  // 1. 添加请假（龙燕 星期一第1节）—— 注意用 "星期一"
  const r1 = await post('/api/leaves', {
    teacherName: '龙燕',
    leaveDate: '星期一',
    reason: '紧急调配'
  });
  console.log('请假添加:', r1.success ? '✓ ' + r1.data?.id : '✗ ' + r1.error);

  // 2. 请假列表
  const r2 = await get('/api/leaves');
  console.log('请假列表:', r2.data?.length || 0, '条');

  // 3. 生成代课
  const r3 = await post('/api/substitutes/generate', {}, { 'x-admin-pwd': 'admin888' });
  if (r3.success) {
    console.log('代课生成: ✓');
    console.log('  安排:', r3.summary?.arranged, '条, 失败:', r3.summary?.failed, '条');
    if (r3.results?.[0]) console.log('  示例:', JSON.stringify(r3.results[0]));
  } else {
    console.log('代课生成: ✗', r3.error || r3.message);
  }

  // 4. 代课记录
  const r4 = await get('/api/substitutes');
  console.log('代课记录:', r4.data?.length || 0, '条');
  if (r4.data?.[0]) console.log('  首条:', JSON.stringify(r4.data[0]));
}

main().catch(console.error);
