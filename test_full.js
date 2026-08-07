const http = require('http');

function apiPost(path, body, headers={}) {
  return new Promise((resolve) => {
    const b = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.write(b); req.end();
  });
}

async function main() {
  // 1. 添加请假
  const leave = await apiPost('/api/leaves', {
    leave: { teacherName: '龙燕', leaveDate: '2026-08-10', dayOfWeek: '星期一', period: 1, reason: '出差培训' }
  }, { 'x-admin-pwd': 'admin888' });
  console.log('请假添加:', leave.success ? '✓' : '✗', leave.data?.id || leave.error);

  // 2. 获取请假列表
  http.get('http://localhost:3000/api/leaves', r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => {
      const j = JSON.parse(d);
      console.log('请假列表条数:', j.data?.length || 0);
    });
  });

  // 3. 生成代课
  const gen = await apiPost('/api/substitutes/generate', {}, { 'x-admin-pwd': 'admin888' });
  console.log('代课生成:', gen.success ? '✓' : '✗');
  if (gen.success) {
    console.log('  安排:', gen.summary?.arranged, '条, 失败:', gen.summary?.failed, '条');
    if (gen.data?.[0]) console.log('  示例:', JSON.stringify(gen.data[0]));
  } else {
    console.log('  错误:', gen.error);
  }

  // 4. 获取代课记录
  http.get('http://localhost:3000/api/substitutes', r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => {
      const j = JSON.parse(d);
      console.log('代课记录:', j.data?.length || 0, '条');
      if (j.data?.[0]) console.log('  首条:', JSON.stringify(j.data[0]));
    });
  });
}

main().catch(console.error);
