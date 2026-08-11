/**
 * 代课记录 API — Cloudflare Workers 版本
 * GET    /api/substitutes          → 列表
 * POST   /api/substitutes/generate → 生成代课（需管理员）
 * POST   /api/substitutes          → 手动新增
 * DELETE /api/substitutes          → 清空（需管理员）
 */
import { mem, json, err, checkAdmin } from './supabase-client.js';
import { buildTeacherAssignment, buildTeacherSchedule,
         findSubstitute, generateSubstitutes } from './algorithm.js';

// GET /api/substitutes
export async function handleSubstitutesGet(env) {
  return json({ success: true, data: mem.substitutes });
}

// POST /api/substitutes/generate
export async function handleSubstitutesGenerate(request, env) {
  if (!checkAdmin(request.headers)) return err('管理员密码错误', 401);

  let body = {};
  try { body = await request.json(); } catch(e) {}

  if (!mem.config?.timetable)
    return err('课表未导入，请先导入课表数据');

  const leaves = (mem.leaves || []).filter(l => l.status === 'pending');
  if (leaves.length === 0)
    return json({ success: true, results: [], summary: { total: 0, arranged: 0, failed: 0 }, message: '暂无待处理的请假记录' });

  const timetable        = mem.config.timetable;
  const teacherAssignment = buildTeacherAssignment(timetable);

  const { results, summary } = generateSubstitutes(
    timetable, teacherAssignment, leaves, body.targetDate
  );

  // 追加到代课记录（去重）
  const existingIds = new Set(mem.substitutes.map(s => s.id));
  const newOnes     = results.filter(r => !existingIds.has(r.id));
  mem.substitutes.push(...newOnes);

  await saveSubs(env);

  return json({ success: true, results: newOnes, summary, message: `代课记录已生成：成功 ${summary.arranged} 条，失败 ${summary.failed} 条` });
}

// POST /api/substitutes 手动添加
export async function handleSubstitutesPost(request, env) {
  let body = {};
  try { body = await request.json(); } catch(e) {}
  const { leaveTeacher, substituteTeacher, className, subject, leaveDate, dayOfWeek, period, reason } = body;
  if (!leaveTeacher || !className || !subject || !leaveDate)
    return err('缺少必填字段');

  const rec = {
    id:               `sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    leaveTeacher:    leaveTeacher,
    substituteTeacher: substituteTeacher || null,
    className,
    subject,
    leaveDate,
    dayOfWeek:       dayOfWeek || '',
    period:          parseInt(period) || 0,
    reason:          reason || '',
    status:          substituteTeacher ? 'arranged' : 'manual',
    createdAt:       new Date().toISOString()
  };
  mem.substitutes.push(rec);
  await saveSubs(env);
  return json({ success: true, data: rec }, 201);
}

// DELETE /api/substitutes
export async function handleSubstitutesDelete(request, env) {
  if (!checkAdmin(request.headers)) return err('管理员密码错误', 401);
  mem.substitutes = [];
  await saveSubs(env);
  return json({ success: true });
}

// ── 持久化 ────────────────────────────────────────────
async function saveSubs(env) {
  if (env?.SUBS_KV) {
    await env.SUBS_KV.put('subs', JSON.stringify(mem.substitutes));
  }
}
