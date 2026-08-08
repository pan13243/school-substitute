/**
 * 完整端到端测试 — 走 HTTP 接口，验证持久化
 */
const http = require('http');

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3000');
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, headers: { 'Content-Type': 'application/json', ...headers }
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function main() {
  const adminHdr = { 'x-admin-pwd': 'admin888' };

  // 1. 清空请假
  await req('DELETE', '/api/leaves', null, adminHdr);
  console.log('✓ 已清空请假');

  // 2. 添加请假
  const leave = { teacherName: '龙燕', leaveDate: '2026-08-10', dayOfWeek: '星期一', reason: '测试' };
  const lr = await req('POST', '/api/leaves', leave);
  console.log('✓ 请假已添加:', lr.data.data?.id);

  // 3. 批准请假
  const lid = lr.data.data?.id;
  await req('PUT', `/api/leaves/${lid}`, { status: 'approved' }, adminHdr);
  console.log('✓ 请假已批准');

  // 4. 生成代课
  const gr = await req('POST', '/api/substitutes/generate', { targetDate: '2026-08-10' }, adminHdr);
  console.log('\n=== 代课结果 ===');
  console.log('总计:', gr.data.summary?.total, '成功:', gr.data.summary?.arranged, '失败:', gr.data.summary?.failed);
  gr.data.results?.forEach(r => {
    console.log(`  ${r.dayOfWeek} 第${r.period}节 ${r.className} ${r.subject}: ${r.substituteTeacher} 代 ${r.leaveTeacher}`);
  });

  // 5. 验证持久化（检查 mem_data.json）
  const fs = require('fs');
  const dataFile = 'mem_data.json';
  if (fs.existsSync(dataFile)) {
    const d = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    console.log('\n=== 持久化验证 ===');
    console.log('请假条数:', d.leaves?.length, '代课条数:', d.substitutes?.length);
  }
}

main().catch(console.error);
