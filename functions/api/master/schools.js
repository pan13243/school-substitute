const json = (c, d) => new Response(JSON.stringify(d), {
  status: c,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
});

async function getMeta(env) {
  try {
    const v = await env.SCHOOL_SUB.get('schoolMeta');
    if (!v) return {};
    const p = JSON.parse(v);
    return (p && typeof p === 'object') ? p : {};
  } catch (e) { return {}; }
}

function authAdmin(meta, pwd) {
  const expect = (meta && meta.adminPwd) || 'admin888';
  return pwd === expect;
}

async function readSchools(env) {
  try {
    const v = await env.SCHOOL_SUB.get('__master__schools');
    if (!v) return [];
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  const meta = await getMeta(env);
  const pwd = request.headers.get('x-admin-pwd');
  if (!authAdmin(meta, pwd)) return json(401, { success: false, message: '未授权' });
  const schools = await readSchools(env);
  return json(200, { success: true, schools });
}
