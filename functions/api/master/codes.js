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

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

async function readCodes(env) {
  try {
    const v = await env.SCHOOL_SUB.get('__master__codes');
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
  const codes = await readCodes(env);
  return json(200, { success: true, codes });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const meta = await getMeta(env);
  const pwd = request.headers.get('x-admin-pwd');
  if (!authAdmin(meta, pwd)) return json(401, { success: false, message: '未授权' });
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 20);
  const codes = await readCodes(env);
  const newCodes = [];
  for (let i = 0; i < count; i++) {
    const rec = { code: genCode(8), createdAt: new Date().toISOString(), used: false, usedBy: null, usedAt: null };
    codes.push(rec);
    newCodes.push(rec);
  }
  await env.SCHOOL_SUB.put('__master__codes', JSON.stringify(codes));
  return json(200, { success: true, codes: newCodes, total: codes.length });
}
