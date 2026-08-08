/**
 * 代课优先级算法
 * 优先级：同班主科(语数英) > 同班道法/科学 > 同班其他副科 > 跨班支援
 */

export const MAIN_SUBJECTS  = ['语文', '数学'];
export const SECONDARY_EARLY = ['英语'];
export const SECONDARY_LATE  = ['道德与法治', '道德', '科学'];
export const SIDE_SUBJECTS   = ['音乐', '美术', '体育', '信息技术', '劳动', '健康', '阅读', '书法'];
export const ADMIN_TEACHERS  = ['龙燕', '龙光辉', '潘懂平'];

/**
 * 计算代课优先级权重（越小越优先）
 */
export function priorityWeight(teacher, slot, teacherAssignment, leaveTeacher) {
  if (teacher === leaveTeacher) return 999;
  const { className, subject } = slot;
  const clsSubjects = teacherAssignment[className] || {};
  if (clsSubjects[subject] === teacher) {
    if (subject === '语文') return 1;
    if (subject === '数学') return 2;
    if (SECONDARY_EARLY.includes(subject)) return 3;
    if (subject === '道德与法治' || subject === '道德') return 4;
    if (subject === '科学') return 5;
    return 6;
  }
  if (Object.values(clsSubjects).includes(teacher)) return 7;
  return 9;
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
                               teacherAssignment, existingSubs = {}, tempSchedule = []) {
  const { className, subject, period } = slot;
  const slotKey = `${leaveDate}_${period}`;
  const allTeachers = Object.keys(teacherSchedule);
  const candidates = allTeachers
    .filter(t => {
      if (t === leaveTeacher) return false;
      if (ADMIN_TEACHERS.includes(t)) return false;
      if (t in teacherSchedule && slotKey in teacherSchedule[t]) return false;
      const daySub = (existingSubs[t] || 0) + tempSchedule.filter(
        s => s.teacher === t && s.date === leaveDate).length;
      if (daySub >= 2) return false;
      return true;
    })
    .map(t => ({
      teacher: t,
      weight: priorityWeight(t, { className, subject }, teacherAssignment, leaveTeacher),
      dayLoad: Object.keys(teacherSchedule[t] || {}).filter(k => k.startsWith(leaveDate)).length
    }))
    .sort((a, b) => a.weight !== b.weight ? a.weight - b.weight : a.dayLoad - b.dayLoad);
  return candidates[0]?.teacher || null;
}

/**
 * 批量生成代课
 */
export function generateSubstitutes(timetable, teacherAssignment, leaves, targetDate) {
  const { teacherSchedule } = buildTeacherSchedule(timetable);
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
        teacherSchedule, teacherAssignment, existingSubs, tempSchedule
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
