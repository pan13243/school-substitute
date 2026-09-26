/**
 * 代课优先级算法（v188 与 functions/api/[[path]].js 口径统一）
 * 身份只看"被代班级"课表：课时最多的科目决定档位；同班多科按课时数排（平手取档位更高的科目）。
 * 1=语文/数学 2=英语 3=科学/道德与法治 4=其他科目(综合实践/音乐/体育/健康/美术/劳动/地方/…)
 * 5=其他班老师（不看身份，跨班主科不排除）；每天代课节数不限制
 */

export const TIER1_SUBJECTS = ['语文', '数学'];
export const TIER3_SUBJECTS = ['科学', '道德与法治', '道德'];

export function subjectTier(subject) {
  if (TIER1_SUBJECTS.includes(subject)) return 1;
  if (subject === '英语') return 2;
  if (TIER3_SUBJECTS.includes(subject)) return 3;
  return 4;
}

// 从课表统计 {班级: {教师: {科目: 课时数}}}
export function buildClassTeachingCounts(timetable) {
  const counts = {};
  for (const classMap of Object.values(timetable || {})) {
    for (const [cls, periods] of Object.entries(classMap || {})) {
      if (!counts[cls]) counts[cls] = {};
      for (const s of (periods || [])) {
        if (!s || !s.subject) continue;
        const ts = (Array.isArray(s.teachers) && s.teachers.length) ? s.teachers : (s.teacher ? [s.teacher] : []);
        for (const t of ts) {
          if (!t) continue;
          if (!counts[cls][t]) counts[cls][t] = {};
          counts[cls][t][s.subject] = (counts[cls][t][s.subject] || 0) + 1;
        }
      }
    }
  }
  return counts;
}

export function priorityWeight(teacher, className, classCounts) {
  const subjCounts = classCounts?.[className]?.[teacher];
  if (!subjCounts) return 5; // 不在被代班级任教 → 其他班老师，第5档
  const entries = Object.entries(subjCounts);
  entries.sort((a, b) => (b[1] - a[1]) || (subjectTier(a[0]) - subjectTier(b[0])));
  return subjectTier(entries[0][0]);
}

/**
 * 建立教师课表 { teacherName: { "周一_1": { className, subject }, ... } }
 */
export function buildTeacherSchedule(timetable) {
  const teacherSchedule = {};
  const allClasses = new Set();
  for (const [day, classMap] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      allClasses.add(cls);
      for (const slot of periods) {
        if (!slot.teacher) continue;
        const key = `${day}_${slot.period}`;
        if (!teacherSchedule[slot.teacher]) teacherSchedule[slot.teacher] = {};
        teacherSchedule[slot.teacher][key] = { className: cls, subject: slot.subject };
      }
    }
  }
  return { teacherSchedule, allClasses: [...allClasses] };
}

/**
 * 找单个代课教师
 */
export function findSubstitute(leaveTeacher, leaveDate, slot, teacherSchedule,
                               teacherAssignment, existingSubs = {}, tempSchedule = [], classCounts = null) {
  const { className, subject, period } = slot;
  const day = normalizeDay(leaveDate);
  const slotKey = `${day}_${period}`;
  const allTeachers = Object.keys(teacherSchedule);
  const counts = classCounts || buildClassTeachingCountsFromTA(teacherAssignment);
  const candidates = allTeachers
    .filter(t => {
      if (t === leaveTeacher) return false;
      if (t in teacherSchedule && slotKey in teacherSchedule[t]) return false;
      // 已被安排代课/同批临时安排的占用检查（同日同时段）
      const daySubsSameSlot = tempSchedule.filter(
        s => s.teacher === t && s.date === day && String(s.period) === String(period));
      if (daySubsSameSlot.length > 0) return false;
      return true;
    })
    .map(t => ({
      teacher: t,
      weight: priorityWeight(t, className, counts),
      dayLoad: Object.keys(teacherSchedule[t] || {}).filter(k => k.startsWith(day + '_')).length
    }))
    .sort((a, b) => a.weight !== b.weight ? a.weight - b.weight : a.dayLoad - b.dayLoad);
  return candidates[0]?.teacher || null;
}

// teacherAssignment({班:{科目:教师}}) 无课时数时的近似兜底（每科计1）
function buildClassTeachingCountsFromTA(teacherAssignment) {
  const counts = {};
  for (const [cls, subs] of Object.entries(teacherAssignment || {})) {
    counts[cls] = {};
    for (const [subj, t] of Object.entries(subs || {})) {
      if (!t) continue;
      if (!counts[cls][t]) counts[cls][t] = {};
      counts[cls][t][subj] = (counts[cls][t][subj] || 0) + 1;
    }
  }
  return counts;
}

/**
 * 批量生成代课
 */
export function generateSubstitutes(timetable, teacherAssignment, leaves, targetDate) {
  const { teacherSchedule } = buildTeacherSchedule(timetable);
  const classCounts = buildClassTeachingCounts(timetable);
  const results = [];
  const existingSubs  = {};
  const tempSchedule  = [];
  const dayMap = getDayMapping(targetDate);

  for (const leave of leaves) {
    if (leave.status !== 'pending' && leave.status !== 'approved') continue;
    // 从日期推算当天是星期几（留候 fillDayOfWeek填填过的优先使用）
    let leaveDay = '';
    if (leave.dayOfWeek) {
      leaveDay = normalizeDay(leave.dayOfWeek);
    }
    // 如果拿不到 dayOfWeek，从日期推
    if (!leaveDay || leaveDay === leave.leaveDate) {
      try {
        const d = new Date(leave.leaveDate);
        if (!isNaN(d)) {
          const days = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
          leaveDay = days[d.getDay()];
        }
      } catch {}
    }
    if (!leaveDay) continue;
    const realDate = leave.leaveDate;
    const dateIso  = leave.leaveDate;

    for (const [slotKey, slotInfo] of Object.entries(teacherSchedule[leave.teacherName] || {})) {
      if (!slotKey.startsWith(leaveDay + '_')) continue;
      const period = parseInt(slotKey.split('_')[1]);
      const { className, subject } = slotInfo;
      const subTeacher = findSubstitute(
        leave.teacherName, leaveDay,
        { className, subject, period },
        teacherSchedule, teacherAssignment, existingSubs, tempSchedule, classCounts
      );
      if (subTeacher) {
        const rec = {
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          leaveId: leave.id, leaveTeacher: leave.teacherName,
          substituteTeacher: subTeacher, className, subject,
          leaveDate: realDate, dayOfWeek: leaveDay, period,
          reason: leave.reason || '系统自动安排', status: 'arranged',
          createdAt: new Date().toISOString()
        };
        results.push(rec);
        existingSubs[subTeacher] = (existingSubs[subTeacher] || 0) + 1;
        tempSchedule.push({ teacher: subTeacher, date: leaveDay, period });
      } else {
        results.push({
          id: `sub_fail_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          leaveId: leave.id, leaveTeacher: leave.teacherName,
          substituteTeacher: null, className, subject,
          leaveDate: realDate, dayOfWeek: leaveDay, period,
          reason: leave.reason || '系统自动安排', status: 'failed',
          failReason: '未找到合适代课教师',
          createdAt: new Date().toISOString()
        });
      }
    }
  }
  return {
    results,
    summary: {
      total: results.length,
      arranged: results.filter(r => r.status === 'arranged').length,
      failed:   results.filter(r => r.status === 'failed').length
    }
  };
}

/**
 * 建立任课分配 { className: { subject: teacher } }
 */
export function buildTeacherAssignment(timetable) {
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

// ── 日期规范化：支持 "周一" / "星期一" / "1" → "星期一" ─────────
const DAY_MAP = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四',
                   '周五':'星期五','周六':'星期六','周日':'星期日',
                   '1':'星期一','2':'星期二','3':'星期三','4':'星期四',
                   '5':'星期五','6':'星期六','0':'星期日','7':'星期日' };

export function normalizeDay(d) { return DAY_MAP[d] || d; }

// ── 日期映射 ────────────────────────────────────────
function getDayMapping(targetDate) {
  if (!targetDate) return {};
  const d = new Date(targetDate);
  const dow = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dow + 6) % 7));
  const days = ['星期一','星期二','星期三','星期四','星期五','星期六','星期日'];
  const map = {};
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    map[days[i]] = dd.toISOString().slice(0, 10);
  }
  return map;
}
