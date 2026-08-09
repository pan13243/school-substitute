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

// 判断教师是否在某班任课（任意科目）
function teacherInClass(teacher, className, teacherAssignment) {
  const clsSubjects = teacherAssignment?.[className] || {};
  return Object.values(clsSubjects).some(t => t === teacher);
}

// 获取教师在某班任教的主科（优先级：语文/数学 > 英语 > 科学/道法）
function getTeacherMainSubject(teacher, className, teacherAssignment) {
  const clsSubjects = teacherAssignment?.[className] || {};
  const subjects = [];
  for (const [subj, t] of Object.entries(clsSubjects)) {
    if (t === teacher) subjects.push(subj);
  }
  // 按优先级返回最高级的主科
  if (subjects.some(s => MAIN_SUBJECTS.includes(s))) return subjects.find(s => MAIN_SUBJECTS.includes(s));
  if (subjects.some(s => SECONDARY_EARLY.includes(s))) return subjects.find(s => SECONDARY_EARLY.includes(s));
  if (subjects.some(s => SECONDARY_LATE.includes(s))) return subjects.find(s => SECONDARY_LATE.includes(s));
  return subjects[0] || null;
}

// 获取教师任教的最高优先级科目（跨所有班级），用于判断是否为副科老师
function getTeacherTopSubject(teacher, teacherAssignment) {
  const allSubjects = [];
  for (const cls in teacherAssignment) {
    const clsSubjects = teacherAssignment[cls] || {};
    for (const [subj, t] of Object.entries(clsSubjects)) {
      if (t === teacher) allSubjects.push(subj);
    }
  }
  if (allSubjects.some(s => MAIN_SUBJECTS.includes(s))) return allSubjects.find(s => MAIN_SUBJECTS.includes(s));
  if (allSubjects.some(s => SECONDARY_EARLY.includes(s))) return allSubjects.find(s => SECONDARY_EARLY.includes(s));
  if (allSubjects.some(s => SECONDARY_LATE.includes(s))) return allSubjects.find(s => SECONDARY_LATE.includes(s));
  return allSubjects[0] || null;
}

function priorityWeight(teacher, subject, className, teacherAssignment) {
  const isSameClass = teacherInClass(teacher, className, teacherAssignment);

  if (isSameClass) {
    // 1级：同班主科互换（语文↔数学）
    if (MAIN_SUBJECTS.includes(subject)) {
      const partner = MAIN_SUBJECTS.find(s => s !== subject); // 语文→数学, 数学→语文
      if (teacherAssignment?.[className]?.[partner] === teacher) return 1;
    }
    // 2级：同班英语老师
    const tMain = getTeacherMainSubject(teacher, className, teacherAssignment);
    if (tMain && SECONDARY_EARLY.includes(tMain)) return 2;
    // 3级：同班道法/科学老师
    if (tMain && SECONDARY_LATE.includes(tMain)) return 3;
    // 4级：同班其他副科老师
    return 4;
  }

  // 5级：其他班的副科老师（主科/英语/道法/科学不跨班代课）
  const topSubj = getTeacherTopSubject(teacher, teacherAssignment);
  if (topSubj && SIDE_SUBJECTS.includes(topSubj)) return 5;
  // 其他班的主科/英语/道法科学老师不参与跨班代课
  return 99;
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
    if (weight >= 99) continue; // 排除其他班的主科/英语/道法科学老师
    candidates.push({ teacher: t, weight, workload: daySlots.length });
  }
  candidates.sort((a, b) => a.weight - b.weight || a.workload - b.workload);
  return candidates[0]?.teacher || null;
}

function generateSubstitutes({ leaves, timetable, teacherAssignment, afterSchoolService, targetDate }) {
  const { teacherSchedule, allClasses } = buildTeacherSchedule(timetable);
  const results = [];
  const existingSubs = [];

  // 【修复】请假去重：同一教师同一日期同一节次只处理一次（避免重复请假生成多条代课）
  const seenLeaves = new Set();
  const uniqueLeaves = [];
  for (const leave of leaves) {
    if (leave.status !== 'pending' && leave.status !== 'approved') continue;
    const dedupeKey = `${leave.teacherName}|${leave.leaveDate}|${leave.period}`;
    if (seenLeaves.has(dedupeKey)) continue;
    seenLeaves.add(dedupeKey);
    uniqueLeaves.push(leave);
  }

  for (const leave of uniqueLeaves) {
    const leaveWeekday = normalizeDay(leave.dayOfWeek) || normalizeDay(getWeekdayFromDate(leave.leaveDate));
    if (!leaveWeekday) continue;
    
    // 计算该请假的实际日期（基于 leaveDate 所在周）
    const leaveDateStr = leave.leaveDate || targetDate;
    const leaveBase = new Date(leaveDateStr);
    const dayMap = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(leaveBase);
      d.setDate(leaveBase.getDate() - leaveBase.getDay() + i);
      const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      dayMap[weekdays[i]] = d.toISOString().split('T')[0];
    }
    
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

    // 【新增】处理课后服务时段（7-11节：课后服务1/2/3 + 晚自习 + 午休）
    if (afterSchoolService?.slots) {
      const daySlots = afterSchoolService.slots.filter(s => normalizeDay(s.day) === leaveWeekday);
      for (const slot of daySlots) {
        // 只处理 7-11 节的课后服务
        if (!slot.period || slot.period < 7 || slot.period > 11) continue;
        // 查找该时段该教师负责的班级
        const myAsn = slot.assignments?.[leave.teacherName] || 
                      Object.entries(slot.assignments || {}).find(([k, v]) => 
                        (v.teacher === leave.teacherName || v.singleWeek === leave.teacherName || v.doubleWeek === leave.teacherName)
                      )?.[1];
        if (!myAsn) continue;
        const className = Object.keys(slot.assignments || {}).find(k => {
          const v = slot.assignments[k];
          return v.teacher === leave.teacherName || v.singleWeek === leave.teacherName || v.doubleWeek === leave.teacherName;
        });
        if (!className) continue;
        
        const subject = slot.project || (slot.period === 7 ? '课后服务1' : slot.period === 8 ? '课后服务2' : slot.period === 9 ? '课后服务3' : slot.period === 10 ? '晚自习' : '午休');
        const substitute = findSubstitute({
          leaveTeacher: leave.teacherName,
          className,
          subject,
          day: leaveWeekday,
          period: slot.period,
          teacherSchedule,
          teacherAssignment,
          existingSubs
        });
        const realDate = dayMap[leaveWeekday] || leave.leaveDate;
        if (substitute) {
          results.push({
            id: 'sub_aft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            leaveId: leave.id,
            leaveTeacher: leave.teacherName,
            substituteTeacher: substitute,
            className,
            subject,
            leaveDate: realDate,
            dayOfWeek: leaveWeekday,
            period: slot.period,
            reason: leave.reason || '课后服务自动安排',
            status: 'arranged',
            createdAt: new Date().toISOString()
          });
          existingSubs.push({ substituteTeacher: substitute, dayOfWeek: leaveWeekday });
        }
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
  const { timetable, afterSchoolService, classes, allTeachers } = body;
  
  // 获取现有配置（用于合并）
  const existing = await getKV(env, 'config') || {};
  
  const classSet = new Set(existing.classes || []);
  const teacherSet = new Set(existing.allTeachers || []);
  const ta = existing.teacherAssignment || {};
  
  // 处理总课表（注意：单元格可能含双教师，用 \n 或空格分隔）
  if (timetable) {
    for (const [day, cm] of Object.entries(timetable)) {
      for (const [cls, periods] of Object.entries(cm)) {
        classSet.add(cls);
        if (!ta[cls]) ta[cls] = {};
        for (const s of periods) {
          // 拆分双教师（按换行或中英文逗号分隔）
          const teachers = String(s.teacher || '').split(/[\n,，;；\s]+/).map(t => t.trim()).filter(t => t);
          teachers.forEach(t => teacherSet.add(t));
          // teacherAssignment 只存第一个教师（同班同科的主教师）
          if (s.subject && teachers.length > 0) ta[cls][s.subject] = teachers[0];
        }
      }
    }
  }
  
  // 处理课后服务表中的教师
  if (afterSchoolService?.slots) {
    for (const slot of afterSchoolService.slots) {
      for (const cls in (slot.assignments || {})) {
        classSet.add(cls);
        const asn = slot.assignments[cls];
        if (asn.teacher) teacherSet.add(asn.teacher);
        if (asn.singleWeek) teacherSet.add(asn.singleWeek);
        if (asn.doubleWeek) teacherSet.add(asn.doubleWeek);
      }
    }
  }
  
  // 传入的 classes/allTeachers 也加入
  if (classes) classes.forEach(c => classSet.add(c));
  if (allTeachers) allTeachers.forEach(t => teacherSet.add(t));
  
  const cfg = {
    timetable: timetable || existing.timetable || {},
    teacherAssignment: ta,
    afterSchoolService: afterSchoolService || existing.afterSchoolService || {},
    classes: [...classSet].sort(),
    allTeachers: [...teacherSet].sort()
  };
  await putKV(env, 'config', cfg);
  
  const total = Object.values(cfg.timetable).reduce((a, b) => a + Object.values(b).reduce((a2, b2) => a2 + b2.length, 0), 0);
  return json({ success: true, message: '导入成功', stats: { classes: cfg.classes.length, teachers: cfg.allTeachers.length, slots: total } });
}

async function handleScheduleDelete(env) {
  if (!env.SCHOOL_SUB) return json({ success: false, error: 'KV 未配置' }, 500);
  await env.SCHOOL_SUB.delete('config');
  return json({ success: true, message: '课表数据已清空' });
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
    afterSchoolService: cfg.afterSchoolService,
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

// 删除单条代课记录
async function handleSubstituteDeleteOne(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) return json({ success: false, error: '缺少 id' }, 400);
  const subs = await getKV(env, 'substitutes') || [];
  const idx = subs.findIndex(s => s.id === id);
  if (idx === -1) return json({ success: false, error: '记录不存在' }, 404);
  subs.splice(idx, 1);
  await putKV(env, 'substitutes', subs);
  return json({ success: true, message: '删除成功', remaining: subs.length });
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
    if (method === 'DELETE') return handleScheduleDelete(env);
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
  
  if (path === '/api/substitutes/delete-one') {
    if (method === 'POST') return handleSubstituteDeleteOne(request, env);
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
