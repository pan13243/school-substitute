/**
 * Cloudflare Pages Functions - API 路由
 * 路径: /api/* 都会进这里
 */

// ============ 算法模块（内联，避免 ESM 路径问题）============
const MAIN_SUBJECTS = ['语文', '数学'];
const SECONDARY_EARLY = ['英语'];
const SECONDARY_LATE = ['道德与法治', '道德', '科学'];
const SIDE_SUBJECTS = ['音乐', '美术', '体育', '信息技术', '综合实践', '劳动', '校本课程', '书法'];
const ADMIN_TEACHERS = ['龙燕', '龙光辉', '潘懂平'];

const DAY_MAP = {
  '周一': '星期一', '1': '星期一', '星期一': '星期一',
  '周二': '星期二', '2': '星期二', '星期二': '星期二',
  '周三': '星期三', '3': '星期三', '星期三': '星期三',
  '周四': '星期四', '4': '星期四', '星期四': '星期四',
  '周五': '星期五', '5': '星期五', '星期五': '星期五',
  '周六': '星期六', '6': '星期六', '星期六': '星期六',
  '周日': '星期日', '7': '星期日', '日': '星期日', '星期日': '星期日'
};

function normalizeDay(d) {
  if (!d) return d;
  const s = String(d).trim();
  return DAY_MAP[s] || s;
}

function getWeekdayFromDate(dateStr) {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return weekdays[date.getDay()];
}

function priorityWeight(teacher, subject, className, teacherAssignment) {
  const sameClassMain = teacherAssignment?.[className]?.[subject];
  if (sameClassMain && sameClassMain !== teacher) {
    if (MAIN_SUBJECTS.includes(subject)) return 1;
  }
  if (MAIN_SUBJECTS.includes(subject)) return 2;
  if (SECONDARY_EARLY.includes(subject)) return 3;
  if (SECONDARY_LATE.includes(subject)) return 4;
  if (SIDE_SUBJECTS.includes(subject)) return 6;
  return 7;
}

function buildTeacherSchedule(timetable) {
  const ts = {};
  const allClasses = new Set();
  for (const [day, classMap] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      allClasses.add(cls);
      for (const s of periods) {
        if (!s.teacher) continue;
        if (!ts[s.teacher]) ts[s.teacher] = {};
        const key = `${day}_${s.period}`;
        ts[s.teacher][key] = { className: cls, subject: s.subject, period: s.period, day };
      }
    }
  }
  return { teacherSchedule: ts, allClasses: [...allClasses] };
}

function findSubstitute({ leaveTeacher, className, subject, day, period, teacherSchedule, teacherAssignment, existingSubs = [] }) {
  const slotKey = `${day}_${period}`;
  const candidates = [];
  for (const [t, schedule] of Object.entries(teacherSchedule)) {
    if (t === leaveTeacher) continue;
    if (ADMIN_TEACHERS.includes(t)) continue;
    if (schedule[slotKey]) continue;
    const daySlots = Object.keys(schedule).filter(k => k.startsWith(day + '_'));
    const subCount = existingSubs.filter(s => s.substituteTeacher === t && s.dayOfWeek === day).length;
    if (subCount >= 2) continue;
    const weight = priorityWeight(t, subject, className, teacherAssignment);
    candidates.push({ teacher: t, weight, workload: daySlots.length });
  }
  candidates.sort((a, b) => a.weight - b.weight || a.workload - b.workload);
  return candidates[0]?.teacher || null;
}

function generateSubstitutes({ leaves, timetable, teacherAssignment, targetDate }) {
  const { teacherSchedule, allClasses } = buildTeacherSchedule(timetable);
  const results = [];
  const existingSubs = [];
  const dayMap = {};
  const base = new Date(targetDate);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - base.getDay() + i);
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    dayMap[weekdays[i]] = d.toISOString().split('T')[0];
  }

  for (const leave of leaves) {
    if (leave.status !== 'pending' && leave.status !== 'approved') continue;
    const leaveWeekday = normalizeDay(leave.dayOfWeek) || normalizeDay(getWeekdayFromDate(leave.leaveDate));
    if (!leaveWeekday) continue;
    const teacherSlots = teacherSchedule[leave.teacherName];
    if (!teacherSlots) continue;
    for (const [slotKey, slot] of Object.entries(teacherSlots)) {
      if (!slotKey.startsWith(leaveWeekday + '_')) continue;
      const substitute = findSubstitute({
        leaveTeacher: leave.teacherName,
        className: slot.className,
        subject: slot.subject,
        day: leaveWeekday,
        period: slot.period,
        teacherSchedule,
        teacherAssignment,
        existingSubs
      });
      const realDate = dayMap[leaveWeekday] || leave.leaveDate;
      if (substitute) {
        results.push({
          id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          leaveId: leave.id,
          leaveTeacher: leave.teacherName,
          substituteTeacher: substitute,
          className: slot.className,
          subject: slot.subject,
          leaveDate: realDate,
          dayOfWeek: leaveWeekday,
          period: slot.period,
          reason: leave.reason,
          status: 'arranged'
        });
        if (!teacherSchedule[substitute]) teacherSchedule[substitute] = {};
        teacherSchedule[substitute][slotKey] = { ...slot };
        existingSubs.push({ substituteTeacher: substitute, dayOfWeek: leaveWeekday });
      }
    }
  }
  return results;
}

// ============ 数据存储（KV）============
async function getKV(env, key) {
  try {
    return await env.SCHOOL_SUB?.get(key, { type: 'json' });
  } catch { return null; }
}

async function putKV(env, key, value) {
  try {
    await env.SCHOOL_SUB?.put(key, JSON.stringify(value));
  } catch {}
}

// ============ API 处理器 ============
async function handleScheduleGet(env) {
  const cfg = await getKV(env, 'config') || {};
  return json({
    success: true,
    data: cfg.timetable || null,
    teacherAssignment: cfg.teacherAssignment || null,
    afterSchoolService: cfg.afterSchoolService || null,
    classes: cfg.classes || [],
    allTeachers: cfg.allTeachers || []
  });
}

async function handleScheduleImport(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const body = await request.json().catch(() => ({}));
  const { timetable, afterSchoolService } = body;
  if (!timetable) return json({ success: false, error: '缺少 timetable' }, 400);
  
  const classSet = new Set(), teacherSet = new Set();
  const ta = {};
  for (const [day, cm] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(cm)) {
      classSet.add(cls);
      if (!ta[cls]) ta[cls] = {};
      for (const s of periods) {
        if (s.teacher) teacherSet.add(s.teacher);
        if (s.subject && s.teacher) ta[cls][s.subject] = s.teacher;
      }
    }
  }
  const cfg = {
    timetable,
    teacherAssignment: ta,
    afterSchoolService: afterSchoolService || [],
    classes: [...classSet].sort(),
    allTeachers: [...teacherSet].sort()
  };
  await putKV(env, 'config', cfg);
  const total = Object.values(timetable).reduce((a, b) => a + Object.values(b).reduce((a2, b2) => a2 + b2.length, 0), 0);
  return json({ success: true, message: '导入成功', stats: { classes: cfg.classes.length, teachers: cfg.allTeachers.length, slots: total } });
}

async function handleLeavesGet(env) {
  const leaves = await getKV(env, 'leaves') || [];
  return json({ success: true, data: leaves });
}

async function handleLeavesPost(request, env) {
  const body = await request.json().catch(() => ({}));
  const { teacherName, leaveDate, dayOfWeek, period, reason } = body;
  if (!teacherName || !leaveDate) return json({ success: false, error: '缺少教师或日期' }, 400);
  const leaves = await getKV(env, 'leaves') || [];
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const leave = { id, teacherName, leaveDate, dayOfWeek: normalizeDay(dayOfWeek), period, reason: reason || '', status: 'pending', createdAt: new Date().toISOString() };
  leaves.push(leave);
  await putKV(env, 'leaves', leaves);
  return json({ success: true, data: leave });
}

async function handleLeavesPut(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  const body = await request.json().catch(() => ({}));
  const leaves = await getKV(env, 'leaves') || [];
  const idx = leaves.findIndex(l => l.id === id);
  if (idx === -1) return json({ success: false, error: '请假不存在' }, 404);
  if (body.status) leaves[idx].status = body.status;
  if (body.reason) leaves[idx].reason = body.reason;
  leaves[idx].updatedAt = new Date().toISOString();
  await putKV(env, 'leaves', leaves);
  return json({ success: true, data: leaves[idx] });
}

async function handleLeavesDelete(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  await putKV(env, 'leaves', []);
  return json({ success: true });
}

async function handleSubstitutesGet(env) {
  const subs = await getKV(env, 'substitutes') || [];
  return json({ success: true, data: subs });
}

async function handleSubstitutesGenerate(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const body = await request.json().catch(() => ({}));
  const targetDate = body.targetDate || new Date().toISOString().split('T')[0];
  
  const cfg = await getKV(env, 'config') || {};
  const leaves = await getKV(env, 'leaves') || [];
  const pendingLeaves = leaves.filter(l => l.status === 'pending' || l.status === 'approved');
  
  if (!cfg.timetable) {
    return json({ success: false, error: '尚未导入课表，请先导入总课表' }, 400);
  }
  if (pendingLeaves.length === 0) {
    return json({ success: false, error: '暂无待处理请假（没有pending或approved状态的请假记录）' }, 400);
  }
  
  const results = generateSubstitutes({
    leaves: pendingLeaves,
    timetable: cfg.timetable,
    teacherAssignment: cfg.teacherAssignment,
    targetDate
  });
  
  await putKV(env, 'substitutes', results);
  return json({ success: true, results, summary: { total: results.length, arranged: results.length, failed: 0 } });
}

async function handleSubstitutesDelete(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  await putKV(env, 'substitutes', []);
  return json({ success: true });
}

async function handleSubstitutesSave(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const body = await request.json().catch(() => ({}));
  const { data } = body;
  if (!Array.isArray(data)) return json({ success: false, error: '数据格式错误' }, 400);
  await putKV(env, 'substitutes', data);
  return json({ success: true, message: '保存成功', count: data.length });
}

// ============ 工具函数 ============
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-pwd, x-admin-password'
    }
  });
}

function authAdmin(headers) {
  const p = headers.get('x-admin-password') || headers.get('x-admin-pwd') || '';
  return p === 'admin888';
}

// ============ 入口 ============
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  
  // CORS 预检
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-admin-pwd, x-admin-password'
      }
    });
  }
  
  // 路由分发
  if (path === '/api/schedule' || path === '/api/schedule/') {
    if (method === 'GET') return handleScheduleGet(env);
    if (method === 'POST') return handleScheduleImport(request, env);
  }
  
  if (path === '/api/leaves' || path.startsWith('/api/leaves/')) {
    if (method === 'GET') return handleLeavesGet(env);
    if (method === 'POST') return handleLeavesPost(request, env);
    if (method === 'PUT' && path !== '/api/leaves') return handleLeavesPut(request, env);
    if (method === 'DELETE') return handleLeavesDelete(request, env);
  }
  
  if (path === '/api/substitutes') {
    if (method === 'GET') return handleSubstitutesGet(env);
    if (method === 'DELETE') return handleSubstitutesDelete(request, env);
  }
  
  if (path === '/api/substitutes/generate') {
    if (method === 'POST') return handleSubstitutesGenerate(request, env);
  }
  
  if (path === '/api/substitutes/save') {
    if (method === 'POST') return handleSubstitutesSave(request, env);
  }
  
  // 调试接口：查看数据状态
  if (path === '/api/debug/status') {
    const cfg = await getKV(env, 'config') || {};
    const leaves = await getKV(env, 'leaves') || [];
    const substitutes = await getKV(env, 'substitutes') || [];
    return json({
      success: true,
      hasTimetable: !!cfg.timetable,
      timetableKeys: cfg.timetable ? Object.keys(cfg.timetable) : [],
      timetableSample: cfg.timetable ? Object.entries(cfg.timetable).slice(0,2).map(([k,v]) => ({day: k, classes: Object.keys(v).slice(0,2)})) : null,
      leavesCount: leaves.length,
      leavesStatus: leaves.reduce((acc, l) => { acc[l.status] = (acc[l.status]||0)+1; return acc; }, {}),
      substitutesCount: substitutes.length
    });
  }
  
  return json({ success: false, error: 'API 路由未找到: ' + path }, 404);
}
