// 用户在 PC 端 F12 Console 粘贴执行
// 查看 sessionStorage 里存的校长密码状态
console.log('=== sessionStorage 状态 ===');
console.log('role =', JSON.stringify(sessionStorage.getItem('role')));
console.log('principalAuthed =', JSON.stringify(sessionStorage.getItem('principalAuthed')));
console.log('principalPwd =', JSON.stringify(sessionStorage.getItem('principalPwd')));
console.log('teacherName =', JSON.stringify(sessionStorage.getItem('teacherName')));
console.log('');
console.log('=== 测试 API ===');
// 用存的密码测试一次
const pwd = sessionStorage.getItem('principalPwd') || '';
const r = await fetch('/api/leave-slips', { headers: { 'x-principal-pwd': pwd } });
console.log('用 principalPwd =', JSON.stringify(pwd), '请求 leave-slips:');
console.log('HTTP 状态:', r.status);
const j = await r.json();
console.log('返回:', JSON.stringify(j).slice(0, 200));
