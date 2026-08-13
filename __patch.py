import os
p = r'functions\api\[[path]].js'
with open(p, 'r', encoding='utf-8') as f:
    s = f.read()

old = """async function handlePrincipalPwdPut(request, env) {
  if (!await authPrincipal(request.headers, env)) return json({ success: false, error: '密码错误' }, 401);
  const body = await request.json().catch(() => ({}));
  const { newPassword } = body;
  if (!newPassword || newPassword.length < 4) return json({ success: false, error: '新密码至少4位' }, 400);
  await putKV(env, 'principalPwd', newPassword);
  return json({ success: true, message: '密码已更新' });
}"""

new = """async function handlePrincipalPwdPut(request, env) {
  // 管理员或校长都可以重置密码
  const isAdminReq = authAdmin(request.headers);
  const isPrincipalReq = await authPrincipal(request.headers, env);
  if (!isAdminReq && !isPrincipalReq) return json({ success: false, error: '权限不足' }, 401);
  const body = await request.json().catch(() => ({}));
  const { newPassword } = body;
  if (!newPassword || newPassword.length < 4) return json({ success: false, error: '新密码至少4位' }, 400);
  await putKV(env, 'principalPwd', newPassword);
  return json({ success: true, message: '密码已更新' });
}"""

if old not in s:
    print('old not found')
    exit(1)
s = s.replace(old, new, 1)
with open(p, 'w', encoding='utf-8') as f:
    f.write(s)
print('patched OK')
