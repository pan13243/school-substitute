// 测试：PC端校长登录后，手动 fetch /api/leave-slips，看是否401
const r = await fetch('/api/leave-slips', { headers: { 'x-principal-pwd': sessionStorage.getItem('principalPwd') || '' } });
const j = await r.json();
console.log('status:', r.status, 'records:', j.data ? j.data.length : 'no data', 'first:', j.data && j.data[0]);
