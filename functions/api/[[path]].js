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

function findSubstitute({ leaveTeacher, className, subject, day, period, teacherSchedule, teacherAssignment, existingSubs = [], absentTeachers = null, occupiedSlots = null }) {
  const slotKey = `${day}_${period}`;
  const candidates = [];
  for (const [t, schedule] of Object.entries(teacherSchedule)) {
    if (t === leaveTeacher) continue;
    if (ADMIN_TEACHERS.includes(t)) continue;
    // 【请假排除】当天已有请假记录的教师不能安排代课
    if (absentTeachers && absentTeachers.has(t)) continue;
    // 【时段占用】该时段有正课或课后服务值班的教师不能安排
    if (schedule[slotKey]) continue;
    if (occupiedSlots && occupiedSlots[slotKey] && occupiedSlots[slotKey].has(t)) continue;
    const daySlots = Object.keys(schedule).filter(k => k.startsWith(day + '_'));
    const weight = priorityWeight(t, subject, className, teacherAssignment);
    if (weight >= 99) continue; // 排除其他班的主科/英语/道法科学老师
    candidates.push({ teacher: t, weight, workload: daySlots.length });
  }
  candidates.sort((a, b) => a.weight - b.weight || a.workload - b.workload);
  return candidates[0]?.teacher || null;
}

function generateSubstitutes({ leaves, timetable, teacherAssignment, afterSchoolService, calendar, targetDate }) {
  const { teacherSchedule, allClasses } = buildTeacherSchedule(timetable);
  const results = [];
  const existingSubs = [];

  // 【请假排除】收集当天所有已请假教师（任何 pending/approved 状态）
  const absentByDate = new Map();
  for (const leave of leaves) {
    if (leave.status !== 'pending' && leave.status !== 'approved') continue;
    const d = leave.leaveDate || targetDate;
    if (!absentByDate.has(d)) absentByDate.set(d, new Set());
    absentByDate.get(d).add(leave.teacherName);
  }
  // 【占用表】课后服务值班占用：{ '星期一_8': Set(教师) }，按请假日期所在单/双周判断轮值
  const occupiedCache = new Map();
  function buildOccupiedSlots(dateStr) {
    if (occupiedCache.has(dateStr)) return occupiedCache.get(dateStr);
    const occ = {};
    if (afterSchoolService?.slots) {
      const calDay = calendar?.dayMap?.[dateStr];
      const parity = calDay ? calDay.parity : null;
      for (const slot of afterSchoolService.slots) {
        if (!slot.period || slot.period < 7 || slot.period > 11) continue;
        const d = normalizeDay(slot.day);
        if (!d) continue;
        const key = `${d}_${slot.period}`;
        for (const asn of Object.values(slot.assignments || {})) {
          const ts = [];
          if (asn && typeof asn === 'object') {
            if (asn.singleWeek && asn.doubleWeek) {
              // 轮换制：结合校历判断当天谁值班；无校历则都占用（保守）
              if (parity === 'single') ts.push(asn.singleWeek);
              else if (parity === 'double') ts.push(asn.doubleWeek);
              else ts.push(asn.singleWeek, asn.doubleWeek);
            } else if (asn.teacher) ts.push(asn.teacher);
            else if (asn.singleWeek) ts.push(asn.singleWeek);
            else if (asn.doubleWeek) ts.push(asn.doubleWeek);
          } else if (typeof asn === 'string' && asn && asn !== '[object Object]') {
            ts.push(asn);
          }
          for (const t of ts) {
            if (!t || t === '[object Object]') continue;
            if (!occ[key]) occ[key] = new Set();
            occ[key].add(t);
          }
        }
      }
    }
    occupiedCache.set(dateStr, occ);
    return occ;
  }

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
    
    // 【去重】记录该请假已生成的代课，避免同一节次重复
    const generatedSlots = new Set();
    
    const teacherSlots = teacherSchedule[leave.teacherName] || {};
    for (const [slotKey, slot] of Object.entries(teacherSlots)) {
      if (!slotKey.startsWith(leaveWeekday + '_')) continue;
      // 检查该 slot 是否已生成过代课
      const slotDedupeKey = `${leave.id}_${slot.period}_${slot.className}`;
      if (generatedSlots.has(slotDedupeKey)) continue;
      generatedSlots.add(slotDedupeKey);
      const substitute = findSubstitute({
        leaveTeacher: leave.teacherName,
        className: slot.className,
        subject: slot.subject,
        day: leaveWeekday,
        period: slot.period,
        teacherSchedule,
        teacherAssignment,
        existingSubs,
        absentTeachers: absentByDate.get(leave.leaveDate || targetDate) || null,
        occupiedSlots: buildOccupiedSlots(leave.leaveDate || targetDate)
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
        // 【单双周判断】先确认请假教师当天是否轮值该时段
        // 校历 dayMap 给出该日期的单/双周；若教师是轮换制（singleWeek+doubleWeek），
        // 只在对应周上课；当天不是他/她轮值则跳过
        const calDay = calendar?.dayMap?.[leaveDateStr];
        const parity = calDay ? calDay.parity : null;

        // 查找该时段该教师负责的班级
        const classEntries = Object.entries(slot.assignments || {}).filter(([k, v]) =>
          v.teacher === leave.teacherName || v.singleWeek === leave.teacherName || v.doubleWeek === leave.teacherName
        );
        if (classEntries.length === 0) continue;
        // 过滤轮换制：有 singleWeek+doubleWeek 且校历能判断周次时，只保留轮值周
        const activeEntries = classEntries.filter(([k, v]) => {
          if (v.singleWeek && v.doubleWeek && parity) {
            return (parity === 'single' && v.singleWeek === leave.teacherName) ||
                   (parity === 'double' && v.doubleWeek === leave.teacherName);
          }
          return true; // 通用教师或无校历 → 视为每天轮值
        });
        if (activeEntries.length === 0) continue; // 当天不是该教师轮值
        const [className] = activeEntries[0];
        const myAsn = activeEntries[0][1];
        // 课后服务也去重
        const aftDedupeKey = `${leave.id}_${slot.period}_${className}`;
        if (generatedSlots.has(aftDedupeKey)) continue;
        generatedSlots.add(aftDedupeKey);
        
        const subject = slot.project || (slot.period === 7 ? '课后服务1' : slot.period === 8 ? '课后服务2' : slot.period === 9 ? '课后服务3' : slot.period === 10 ? '晚自习' : '午休');
        const substitute = findSubstitute({
          leaveTeacher: leave.teacherName,
          className,
          subject,
          day: leaveWeekday,
          period: slot.period,
          teacherSchedule,
          teacherAssignment,
          existingSubs,
          absentTeachers: absentByDate.get(leave.leaveDate || targetDate) || null,
          occupiedSlots: buildOccupiedSlots(leave.leaveDate || targetDate)
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
    calendar: cfg.calendar || null,
    clubActivities: cfg.clubActivities || [],
    classes: cfg.classes || [],
    allTeachers: cfg.allTeachers || []
  });
}

async function handleScheduleImport(request, env) {
  if (!authAdmin(request.headers)) return json({ success: false, error: '管理员密码错误' }, 401);
  const body = await request.json().catch(() => ({}));

  // 用「字段是否存在于请求体」判断，区分「未提供」与「空值」
  const hasTimetable = body.timetable !== undefined;
  const hasAfter     = body.afterSchoolService !== undefined;
  const hasCalendar  = body.calendar !== undefined;
  const hasClub      = body.clubActivities !== undefined;

  const existing = await getKV(env, 'config') || {};

  const timetable          = hasTimetable ? body.timetable : (existing.timetable || {});
  const afterSchoolService = hasAfter     ? body.afterSchoolService : (existing.afterSchoolService || {});
  const calendar           = hasCalendar  ? body.calendar : (existing.calendar || null);
  const clubActivities     = hasClub      ? body.clubActivities : (existing.clubActivities || []);

  // 重建 teacherAssignment / classes / allTeachers
  // 规则：若本次提供了总课表，则完全依据新总课表重新计算（实现「重新导入=整份刷新」，
  //      离职教师/调整班级会被自动清除）；否则沿用已有配置，再叠加本次提供的其他数据。
  const ta = {};
  const classSet = new Set();
  const teacherSet = new Set();

  if (hasTimetable && timetable && Object.keys(timetable).length) {
    // 从【新的】总课表重新计算（不携带旧数据，确保数据自动更新）
    for (const [, cm] of Object.entries(timetable)) {
      for (const [cls, periods] of Object.entries(cm)) {
        if (!cls) continue;
        classSet.add(cls);
        if (!ta[cls]) ta[cls] = {};
        for (const s of (periods || [])) {
          // 拆分双教师（按换行或中英文逗号/分号/空格分隔）
          const teachers = String(s.teacher || '').split(/[\n,，;；\s]+/).map(t => t.trim()).filter(t => t);
          teachers.forEach(t => teacherSet.add(t));
          // teacherAssignment 只存第一个教师（同班同科的主教师）
          if (s.subject && teachers.length) ta[cls][s.subject] = teachers[0];
        }
      }
    }
  } else {
    // 本次未提供总课表：从【已有总课表全文】重建教师/班级（含双教师），
    // 再叠加本次课后服务教师。注意：不直接继承 existing.allTeachers，
    // 否则旧的课后服务教师（已不在新表中）无法被自动清除。
    if (existing.timetable && Object.keys(existing.timetable).length) {
      for (const [, cm] of Object.entries(existing.timetable)) {
        for (const [cls, periods] of Object.entries(cm)) {
          if (!cls) continue;
          classSet.add(cls);
          if (!ta[cls]) ta[cls] = {};
          for (const s of (periods || [])) {
            const teachers = String(s.teacher || '').split(/[\n,，;；\s]+/).map(t => t.trim()).filter(t => t);
            teachers.forEach(t => teacherSet.add(t));
            if (s.subject && teachers.length) ta[cls][s.subject] = teachers[0];
          }
        }
      }
    } else {
      for (const [c, subs] of Object.entries(existing.teacherAssignment || {})) {
        if (!c) continue;
        classSet.add(c);
        ta[c] = { ...subs };
        for (const t of Object.values(subs)) if (t) teacherSet.add(t);
      }
      (existing.classes || []).forEach(c => classSet.add(c));
    }
  }

  // 叠加课后服务表中的教师 / 班级
  for (const slot of (afterSchoolService?.slots || [])) {
    for (const cls in (slot.assignments || {})) {
      classSet.add(cls);
      const asn = slot.assignments[cls];
      if (!asn || typeof asn !== 'object') {
        if (asn) teacherSet.add(String(asn));
        continue;
      }
      if (asn.teacher) teacherSet.add(asn.teacher);
      if (asn.singleWeek) teacherSet.add(asn.singleWeek);
      if (asn.doubleWeek) teacherSet.add(asn.doubleWeek);
    }
  }

  // 允许请求体直接携带 classes / allTeachers 作为补充
  if (Array.isArray(body.classes)) body.classes.forEach(c => classSet.add(c));
  if (Array.isArray(body.allTeachers)) body.allTeachers.forEach(t => teacherSet.add(t));

  const cfg = {
    timetable,
    teacherAssignment: ta,
    afterSchoolService,
    calendar,
    clubActivities,
    classes: [...classSet].sort(),
    allTeachers: [...teacherSet].sort()
  };
  await putKV(env, 'config', cfg);

  const total = Object.values(cfg.timetable).reduce((a, b) => a + Object.values(b).reduce((a2, b2) => a2 + (b2?.length || 0), 0), 0);
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
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  // /api/leaves/{id} 按 ID 删除单条；/api/leaves 清空全部
  if (pathParts.length >= 3) {
    const id = decodeURIComponent(pathParts[pathParts.length - 1]);
    const leaves = await getKV(env, 'leaves') || [];
    const idx = leaves.findIndex(l => l.id === id);
    if (idx === -1) return json({ success: false, error: '请假记录不存在' }, 404);
    leaves.splice(idx, 1);
    await putKV(env, 'leaves', leaves);
    return json({ success: true, message: '删除成功', remaining: leaves.length });
  }
  // 无 ID：清空全部（保留原有行为）
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
    calendar: cfg.calendar,
    targetDate
  });
  
  // 【调试】记录生成详情
  console.log('[generateSubstitutes] pendingLeaves:', pendingLeaves.length, 'results:', results.length);
  for (const r of results.slice(0, 10)) {
    console.log('  -', r.leaveTeacher, r.leaveDate, '第'+r.period+'节', '→', r.substituteTeacher);
  }
  if (results.length > 10) console.log('  ... and', results.length - 10, 'more');
  
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

// ============ 教师隐私密码管理 ============
const TEACHER_PWD_KV_KEY = 'teacher_privacy_passwords';

// 获取教师隐私密码
async function handleTeacherPwdGet(request, env) {
  const url = new URL(request.url);
  const teacherName = url.searchParams.get('teacher');
  
  const passwords = await getKV(env, TEACHER_PWD_KV_KEY) || {};
  
  // 如果指定了教师名，返回该教师的密码（需要验证身份）
  if (teacherName) {
    // 教师可以查看自己的密码，管理员可以查看所有
    const isAdmin = authAdmin(request.headers);
    const currentTeacher = request.headers.get('x-teacher-name');
    
    if (!isAdmin && currentTeacher !== teacherName) {
      return json({ success: false, error: '无权查看' }, 403);
    }
    
    return json({ 
      success: true, 
      hasPassword: !!passwords[teacherName],
      teacherName 
    });
  }
  
  // 管理员可以获取所有设置了密码的教师列表
  if (!authAdmin(request.headers)) {
    return json({ success: false, error: '管理员密码错误' }, 401);
  }
  
  const teachersWithPwd = Object.entries(passwords)
    .filter(([_, pwd]) => pwd)
    .map(([name, _]) => name);
  
  return json({ 
    success: true, 
    teachersWithPassword: teachersWithPwd,
    count: teachersWithPwd.length 
  });
}

// 设置/更新教师隐私密码
async function handleTeacherPwdPost(request, env) {
  const body = await request.json().catch(() => ({}));
  const { teacherName, password, oldPassword } = body;
  
  if (!teacherName) {
    return json({ success: false, error: '缺少教师姓名' }, 400);
  }
  
  const passwords = await getKV(env, TEACHER_PWD_KV_KEY) || {};
  
  // 如果已设置密码，需要验证原密码（或管理员权限）
  if (passwords[teacherName] && passwords[teacherName] !== oldPassword) {
    if (!authAdmin(request.headers)) {
      return json({ success: false, error: '原密码错误' }, 403);
    }
  }
  
  // 更新密码（空字符串表示删除）
  if (password === '' || password === null || password === undefined) {
    delete passwords[teacherName];
  } else {
    passwords[teacherName] = password;
  }
  
  await putKV(env, TEACHER_PWD_KV_KEY, passwords);
  
  return json({ 
    success: true, 
    message: password ? '密码已设置' : '密码已取消',
    hasPassword: !!passwords[teacherName]
  });
}

// 管理员重置教师隐私密码
async function handleTeacherPwdReset(request, env) {
  if (!authAdmin(request.headers)) {
    return json({ success: false, error: '管理员密码错误' }, 401);
  }
  
  const body = await request.json().catch(() => ({}));
  const { teacherName } = body;
  
  if (!teacherName) {
    return json({ success: false, error: '缺少教师姓名' }, 400);
  }
  
  const passwords = await getKV(env, TEACHER_PWD_KV_KEY) || {};
  delete passwords[teacherName];
  await putKV(env, TEACHER_PWD_KV_KEY, passwords);
  
  return json({ 
    success: true, 
    message: `已重置 ${teacherName} 的隐私密码`,
    teacherName 
  });
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
  
  // 教师隐私密码管理
  if (path === '/api/teacher/pwd') {
    if (method === 'GET') return handleTeacherPwdGet(request, env);
    if (method === 'POST') return handleTeacherPwdPost(request, env);
    if (method === 'DELETE') return handleTeacherPwdReset(request, env);
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
