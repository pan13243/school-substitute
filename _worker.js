/**
 * Cloudflare Pages Functions 入口
 * 路由：/api/* → API handlers
 *       /*   → 静态文件
 */
import { handleScheduleGet }       from '/api/schedule.js';
import { handleScheduleImport }    from '/api/schedule.js';
import { handleLeavesGet,
         handleLeavesPost,
         handleLeavesPut,
         handleLeavesDelete }      from '/api/leaves.js';
import { handleSubstitutesGet,
         handleSubstitutesGenerate,
         handleSubstitutesDelete } from '/api/substitutes.js';

export async function onRequest({ request, next, env }) {
  const url  = new URL(request.url);
  const path = url.pathname;

  // ── API 路由 ──────────────────────────────────────
  if (path.startsWith('/api/')) {
    const method = request.method;

    // /api/schedule
    if (path === '/api/schedule' || path === '/api/schedule/') {
      if (method === 'GET')  return handleScheduleGet(env);
      if (method === 'POST') return handleScheduleImport(request, env);
    }

    // /api/schedule/teachers
    if (path === '/api/schedule/teachers') {
      if (method === 'GET') return handleTeachersGet(request, env);
    }

    // /api/leaves
    if (path === '/api/leaves' || path.startsWith('/api/leaves/')) {
      const id = path.split('/').pop();
      if (method === 'GET')    return handleLeavesGet(env);
      if (method === 'POST')  return handleLeavesPost(request, env);
      if (method === 'PUT' && id) return handleLeavesPut(request, id, env);
      if (method === 'DELETE') return handleLeavesDelete(env);
    }

    // /api/substitutes
    if (path === '/api/substitutes') {
      if (method === 'GET')    return handleSubstitutesGet(env);
      if (method === 'POST')  return handleSubstitutesGenerate(request, env);
    }
    if (method === 'DELETE' && path === '/api/substitutes') {
      return handleSubstitutesDelete(env);
    }

    return json({ success: false, error: 'API路由未找到' }, 404);
  }

  // ── 静态文件（index.html, app.js, styles/*, parsed_data.json 等）───
  return next(request);
}

// ── 教师课表查询 ──────────────────────────────────────
async function handleTeachersGet(request, env) {
  const url   = new URL(request.url);
  const teacher = url.searchParams.get('teacher') || '';
  const cfg   = env.SCHEDULE_DATA ? JSON.parse(env.SCHEDULE_DATA) : { timetable: {} };
  const tt    = cfg.timetable || {};

  if (!teacher) return json({ success: true, data: null });

  const slots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      for (const slot of periods) {
        if (slot.teacher === teacher) {
          slots.push({ day, className: cls, period: slot.period,
                       subject: slot.subject, time: slot.time });
        }
      }
    }
  }
  return json({ success: true, data: slots });
}

// ── 解析 teacherAssignment ──────────────────────────────
function buildTeacherAssignment(timetable) {
  const ta = {};
  for (const [, classMap] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      if (!ta[cls]) ta[cls] = {};
      for (const s of periods) {
        if (s.subject && s.teacher) ta[cls][s.subject] = s.teacher;
      }
    }
  }
  return ta;
}

// ── 工具函数 ─────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8',
               'Access-Control-Allow-Origin': '*',
               'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
               'Access-Control-Allow-Headers': 'Content-Type, x-admin-pwd' }
  });
}

function authAdmin(headers) {
  const p = headers.get('x-admin-password') || headers.get('x-admin-pwd') || '';
  return p === 'admin888';
}
