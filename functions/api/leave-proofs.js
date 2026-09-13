/**
 * v158 病假证明 API（新增文件，纯增量，不动任何现有文件/路由）
 * 路由: /api/leave-proofs
 *   functions/api/leave-proofs.js 是静态路由，比 functions/api/[[path]].js 的 catch-all 更具体，
 *   按 Cloudflare Pages 路由规则（更具体的路由优先）会优先匹配，因此不会与现有 404 兜底冲突。
 *
 *   GET    /api/leave-proofs?leaveId=xxx              列出某条请假的证明材料
 *   GET    /api/leave-proofs?action=download&id=x     下载某个文件
 *   POST   /api/leave-proofs                          上传（multipart/form-data: file, leaveId, uploader）
 *   DELETE /api/leave-proofs?id=x                     删除某个文件
 *
 * 存储:
 *   文件字节 → R2 桶 (env.R2)，key = 'proofs/{id}{ext}'
 *   元数据   → KV (env.SCHOOL_SUB)，key = 'leaveProofs' = { [leaveId]: [record, ...] }
 *
 * 权限: 仅管理员（header x-admin-pwd / x-admin-password == admin888，与现有鉴权一致）
 * 说明: 新增 KV key，不动任何现有 KV；新增路由文件，不动 [[path]].js
 */

const V158_KV_KEY = 'leaveProofs';
const V158_ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf'];
const V158_MAX_MB = 20;
const V158_ADMIN_PWD = 'admin888';

function v158Json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function v158IsAdmin(headers) {
  const p = headers.get('x-admin-password') || headers.get('x-admin-pwd') || '';
  return p === V158_ADMIN_PWD;
}

function v158Ext(name) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  if (i < 0 || i === name.length - 1) return '';
  return name.slice(i).toLowerCase();
}

async function v158GetKV(env, key) {
  try { return await env.SCHOOL_SUB?.get(key, { type: 'json' }); } catch { return null; }
}

async function v158PutKV(env, key, val) {
  try { await env.SCHOOL_SUB?.put(key, JSON.stringify(val)); } catch {}
}

function v158FindRecord(store, id) {
  const keys = Object.keys(store || {});
  for (let i = 0; i < keys.length; i++) {
    const arr = store[keys[i]] || [];
    for (let j = 0; j < arr.length; j++) {
      if (arr[j].id === id) return { rec: arr[j], leaveId: keys[i], idx: j };
    }
  }
  return null;
}

async function v158HandleList(request, env) {
  if (!v158IsAdmin(request.headers)) return v158Json({ success: false, error: '仅管理员可查看' }, 403);
  const url = new URL(request.url);
  const leaveId = url.searchParams.get('leaveId') || '';
  if (!leaveId) return v158Json({ success: false, error: '缺少 leaveId' }, 400);
  const store = await v158GetKV(env, V158_KV_KEY) || {};
  return v158Json({ success: true, data: store[leaveId] || [] });
}

async function v158HandleDownload(request, env) {
  if (!v158IsAdmin(request.headers)) return v158Json({ success: false, error: '仅管理员可下载' }, 403);
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!id) return v158Json({ success: false, error: '缺少 id' }, 400);
  const store = await v158GetKV(env, V158_KV_KEY) || {};
  const found = v158FindRecord(store, id);
  if (!found) return v158Json({ success: false, error: '文件不存在或已删除' }, 404);
  if (!env.R2) return v158Json({ success: false, error: 'R2 桶未绑定' }, 500);
  const obj = await env.R2.get(found.rec.r2Key);
  if (!obj) return v158Json({ success: false, error: 'R2 文件丢失' }, 404);
  const headers = new Headers();
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || found.rec.mime || 'application/octet-stream';
  headers.set('Content-Type', ct);
  const asciiFallback = String(found.rec.fileName || 'proof').replace(/[^\x20-\x7E]/g, '_');
  headers.set('Content-Disposition', 'attachment; filename="' + asciiFallback + '"; filename*=UTF-8\'\'' + encodeURIComponent(found.rec.fileName || 'proof'));
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
}

async function v158HandleUpload(request, env) {
  if (!v158IsAdmin(request.headers)) return v158Json({ success: false, error: '仅管理员可上传' }, 403);
  if (!env.R2) return v158Json({ success: false, error: 'R2 桶未绑定,请联系管理员' }, 500);
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) return v158Json({ success: false, error: '需要 multipart/form-data' }, 400);
  let form;
  try { form = await request.formData(); }
  catch (e) { return v158Json({ success: false, error: '解析表单失败: ' + (e.message || e) }, 400); }
  const file = form.get('file');
  const leaveId = (form.get('leaveId') || '').toString().trim();
  const uploader = (form.get('uploader') || '管理员').toString().trim() || '管理员';
  if (!leaveId) return v158Json({ success: false, error: '缺少 leaveId' }, 400);
  if (!file || typeof file === 'string') return v158Json({ success: false, error: '请选择文件' }, 400);
  const fileName = String(file.name || '未命名');
  const ext = v158Ext(fileName);
  if (V158_ALLOWED_EXTS.indexOf(ext) < 0) {
    return v158Json({ success: false, error: '文件类型不允许: ' + (ext || '(无后缀)') + '。允许: ' + V158_ALLOWED_EXTS.join('/') }, 400);
  }
  const size = file.size || 0;
  if (size > V158_MAX_MB * 1024 * 1024) {
    return v158Json({ success: false, error: '文件超过 ' + V158_MAX_MB + 'MB 上限(当前 ' + (size / 1024 / 1024).toFixed(2) + 'MB)' }, 400);
  }
  const id = 'lp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const r2Key = 'proofs/' + id + ext;
  let buf;
  try { buf = await file.arrayBuffer(); }
  catch (e) { return v158Json({ success: false, error: '读取文件失败: ' + (e.message || e) }, 400); }
  try {
    await env.R2.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  } catch (e) {
    return v158Json({ success: false, error: 'R2 上传失败: ' + (e.message || e) }, 500);
  }
  const record = { id, leaveId, fileName, ext, size, mime: file.type || '', r2Key, uploader, uploadedAt: Date.now() };
  const store = await v158GetKV(env, V158_KV_KEY) || {};
  store[leaveId] = store[leaveId] || [];
  store[leaveId].push(record);
  await v158PutKV(env, V158_KV_KEY, store);
  return v158Json({ success: true, data: record });
}

async function v158HandleDelete(request, env) {
  if (!v158IsAdmin(request.headers)) return v158Json({ success: false, error: '仅管理员可删除' }, 403);
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!id) return v158Json({ success: false, error: '缺少 id' }, 400);
  const store = await v158GetKV(env, V158_KV_KEY) || {};
  const found = v158FindRecord(store, id);
  if (!found) return v158Json({ success: false, error: '文件不存在' }, 404);
  try { await env.R2.delete(found.rec.r2Key); } catch (e) { console.error('v158 R2 证明删除失败:', e); }
  store[found.leaveId].splice(found.idx, 1);
  if (!store[found.leaveId].length) delete store[found.leaveId];
  await v158PutKV(env, V158_KV_KEY, store);
  return v158Json({ success: true });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-admin-pwd, x-admin-password'
      }
    });
  }
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  try {
    if (method === 'GET' && action === 'download') return await v158HandleDownload(request, env);
    if (method === 'GET') return await v158HandleList(request, env);
    if (method === 'POST') return await v158HandleUpload(request, env);
    if (method === 'DELETE') return await v158HandleDelete(request, env);
  } catch (e) {
    return v158Json({ success: false, error: '服务器错误: ' + (e && e.message ? e.message : e) }, 500);
  }
  return v158Json({ success: false, error: '方法不允许' }, 405);
}
