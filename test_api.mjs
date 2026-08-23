// 测试用默认密码 principal888 调 leave-slips
const r1 = await fetch('https://school-substitute.pages.dev/api/principal-pwd', { headers: { 'x-principal-pwd': 'principal888' } });
const j1 = await r1.json();
console.log('principal-pwd with principal888: status =', r1.status);
console.log('  response =', JSON.stringify(j1).slice(0, 200));

// 看一下 leave-slips 在不带密码时返回什么
const r2 = await fetch('https://school-substitute.pages.dev/api/leave-slips', { headers: { 'x-principal-pwd': 'principal888' } });
const j2 = await r2.json();
console.log('\nleave-slips with principal888: status =', r2.status);
console.log('  response =', JSON.stringify(j2).slice(0, 300));
