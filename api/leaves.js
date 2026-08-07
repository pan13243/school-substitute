/**
 * 请假管理 API — Cloudflare Workers 版本
 * GET    /api/leaves          → 列表
 * POST   /api/leaves          → 新增
 * PUT    /api/leaves/:id      → 审批（需管理员）
 * DELETE /api/leaves          → 清空（需管理员）
 */
import { mem, json, err, checkAdmin } from './supabase-client.js';

export async function handleLeavesGet(env) {
  const { leaves } = await loadLeaves(env);
  return json({ success: true, data: leaves });
}

export async function handleLeavesPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch(e) {
    return err('请求格式错误');
  }

  const { teacherName, leaveDate, reason } = body;
  if (!teacherName || !leaveDate)
    return err('teacherName 和 leaveDate 为必填');

  const newLeave = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    teacherName: teacherName.trim(),
    leaveDate:   leaveDate,
    reason:      (reason || '').trim(),
    status:      'pending',
    createdAt:   new Date().toISOString()
  };

  mem.leaves.push(newLeave);
  await saveLeaves(env);

  return json({ success: true, data: newLeave }, 201);
}

export async function handleLeavesPut(request, id, env) {
  if (!checkAdmin(request.headers)) return err('管理员密码错误', 401);

  let body;
  try {
    body = await request.json();
  } catch(e) {
    return err('请求格式错误');
  }

  const { status } = body;
  if (!status || !['pending', 'approved', 'rejected'].includes(status))
    return err('status 必须是 pending / approved / rejected');

  const idx = mem.leaves.findIndex(l => l.id === id);
  if (idx === -1) return err('请假记录不存在', 404);

  mem.leaves[idx] = { ...mem.leaves[idx], status, updatedAt: new Date().toISOString() };
  await saveLeaves(env);

  return json({ success: true, data: mem.leaves[idx] });
}

export async function handleLeavesDelete(env) {
  if (!checkAdmin(request.headers)) return err('管理员密码错误', 401);
  mem.leaves = [];
  await saveLeaves(env);
  return json({ success: true });
}

// ── 持久化 ─────────────────────────────────────────────
async function loadLeaves(env) {
  if (env?.LEAVES_KV) {
    const raw = await env.LEAVES_KV.get('leaves');
    if (raw) mem.leaves = JSON.parse(raw);
  }
  return { leaves: mem.leaves };
}

async function saveLeaves(env) {
  if (env?.LEAVES_KV) {
    await env.LEAVES_KV.put('leaves', JSON.stringify(mem.leaves));
  }
}
