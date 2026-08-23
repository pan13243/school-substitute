// 用户在 PC 端 F12 Console 粘贴执行
// 作用：手动调一次 leave-slips API，看返回什么
const r = await fetch('/api/leave-slips', { headers: { 'x-principal-pwd': sessionStorage.getItem('principalPwd') || '' } });
const j = await r.json();
console.log('=== 诊断信息 ===');
console.log('HTTP 状态:', r.status);
console.log('sessionStorage.principalPwd =', JSON.stringify(sessionStorage.getItem('principalPwd')));
console.log('sessionStorage.principalAuthed =', JSON.stringify(sessionStorage.getItem('principalAuthed')));
console.log('sessionStorage.role =', JSON.stringify(sessionStorage.getItem('role')));
console.log('API 返回 success:', j.success);
console.log('API 返回 data 数量:', (j.data || []).length);
console.log('API 返回 data 前2条:', JSON.stringify((j.data || []).slice(0, 2), null, 2));
if (j.data && j.data[0]) {
  console.log('第一条 status:', j.data[0].status);
  console.log('第一条 leaveTeacher:', j.data[0].leaveTeacher);
  console.log('第一条 leaveDate:', j.data[0].leaveDate);
}
