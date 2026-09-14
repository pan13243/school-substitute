/**
 * v159 代课记录单条更新 API（新增文件，纯增量）
 * 路由: /api/substitute-update
 *   POST /api/substitute-update  body: { id, substituteTeacher }
 * 存储: KV 'substitutes' (env.SCHOOL_SUB) — 数组
 * 权限: 仅管理员（x-admin-pwd / x-admin-password == admin888）
 *
 * 比 [[path]].js 的 catch-all 更具体，优先匹配，无需改旧文件
 */

function v159Json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-admin-pwd, x-admin-password'
      }
    });
  }
  if (request.method !== 'POST') return v159Json({ success: false, error: '仅支持 POST' }, 405);
  const pwd = request.headers.get('x-admin-pwd') || request.headers.get('x-admin-password') || '';
  if (pwd !== 'admin888') return v159Json({ success: false, error: '仅管理员可修改' }, 403);
  if (!env.SCHOOL_SUB) return v159Json({ success: false, error: 'KV 未绑定' }, 500);
  let body;
  try { body = await request.json(); }
  catch (e) { return v159Json({ success: false, error: 'JSON 解析失败: ' + (e.message || e) }, 400); }
  const id = (body.id || '').toString().trim();
  const newTeacher = (body.substituteTeacher || '').toString().trim();
  if (!id) return v159Json({ success: false, error: '缺少 id' }, 400);
  if (!newTeacher) return v159Json({ success: false, error: '代课教师不能为空' }, 400);
  let subs;
  try { subs = await env.SCHOOL_SUB.get('substitutes', { type: 'json' }) || []; }
  catch (e) { return v159Json({ success: false, error: '读取 KV 失败: ' + (e.message || e) }, 500); }
  if (!Array.isArray(subs)) subs = [];
  const idx = subs.findIndex(function (s) { return s && s.id === id; });
  if (idx < 0) return v159Json({ success: false, error: '代课记录不存在' }, 404);
  const old = subs[idx].substituteTeacher || '';
  subs[idx].substituteTeacher = newTeacher;
  subs[idx].updatedAt = new Date().toISOString();
  subs[idx].updatedBy = '管理员';
  try { await env.SCHOOL_SUB.put('substitutes', JSON.stringify(subs)); }
  catch (e) { return v159Json({ success: false, error: '写 KV 失败: ' + (e.message || e) }, 500); }
  return v159Json({ success: true, data: subs[idx], oldTeacher: old });
}