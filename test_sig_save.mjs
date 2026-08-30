// 模拟教师个人保存签名
const BASE = 'https://school-substitute.pages.dev';

async function getTeachers() {
  const r = await fetch(BASE + '/api/debug/status');
  const t = await r.text();
  const m = t.match(/allTeachersSample":\[(.*?)\]/);
  if (!m) return null;
  // 取第一个非空教师名
  const names = m[1].split(',').map(s => s.replace(/^"|"$/g,'').trim()).filter(Boolean);
  return names[0];
}

async function test(teacherName) {
  console.log('测试教师:', teacherName);
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // 教师个人:header 带 x-teacher-name,无 admin/principal
  const r = await fetch(BASE + '/api/signatures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-teacher-name': teacherName },
    body: JSON.stringify({ scope: 'teacher', name: teacherName, action: 'add', sigName: '测试签名', dataUrl })
  });
  const j = await r.json();
  console.log('状态码:', r.status);
  console.log('响应:', JSON.stringify(j).slice(0, 200));
  return j;
}

const name = await getTeachers();
if (!name) { console.log('无法获取教师名'); process.exit(1); }
await test(name);
