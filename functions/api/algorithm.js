/**
 * 代课优先级算法 — 浏览器 + Cloudflare Workers 通用（ES Module）
 * 优先级：同班主科(语数英) > 同班道法/科学 > 同班其他副科 > 跨班支援
 */

// 优先级常量
export const MAIN_SUBJECTS   = ['语文', '数学'];           // 1=同班语文  2=同班数学
export const SECONDARY_EARLY  = ['英语'];                   // 3=英语
export const SECONDARY_LATE   = ['道德与法治', '道德', '科学']; // 4=道法 5=科学
export const SIDE_SUBJECTS    = ['音乐', '美术', '体育', '信息技术', '劳动', '健康', '阅读', '书法']; // 6

// 特殊身份教师（不自动安排代课）
export const ADMIN_TEACHERS   = ['龙燕', '龙光辉', '潘懂平'];

// 宽松模式：跨班支援教师
const LOOSE_MODE_TEACHERS = [];

/**
 * 计算代课优先级权重（越小越优先）
 * @param {string} teacher - 代课教师姓名
 * @param {object} slot    - { className, subject }
 * @param {object} teacherAssignment - { [cls]: { [subject]: teacher } }
 * @param {string} leaveTeacher - 请假教师姓名
 */
export function priorityWeight(teacher, slot, teacherAssignment, leaveTeacher) {
  const { className, subject } = slot;

  // 排除请假教师本人
  if (teacher === leaveTeacher) return 999;

  const clsSubjects = teacherAssignment[className] || {};

  // 同班教师
  if (clsSubjects[subject] === teacher) {
    // 该教师本身就是这个班的这门课任课教师
    if (MAIN_SUBJECTS.includes(subject)) return 1;
    if (subject === '数学') return 2;       // 数学已包含在上面，但数学单独权重2
    if (SECONDARY_EARLY.includes(subject)) return 3;
    if (SECONDARY_LATE.includes(subject)) return 5;
    return 6;
  }

  // 该教师在这个班有其他任课
  if (Object.values(clsSubjects).includes(teacher)) {
    return 7; // 跨班支援
  }

  return 9; // 兜底
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
 * @param {string} leaveTeacher - 请假教师
 * @param {string} leaveDate    - 请假日期（"周一"等）
 * @param {object} slot         - { className, subject, period }
 * @param {object} teacherSchedule - buildTeacherSchedule() 的结果
 * @param {object} teacherAssignment - { [cls]: { [subject]: teacher } }
 * @param {object} existingSubs - 已有代课 { teacherName: count }
 * @param {object} tempSchedule - 临时课表（当次生成中已安排的课时）
 */
export function findSubstitute(leaveTeacher, leaveDate, slot, teacherSchedule,
                                teacherAssignment, existingSubs = {}, tempSchedule = []) {
  const { className, subject, period } = slot;
  const slotKey = `${leaveDate}_${period}`;
  const allTeachers = Object.keys(teacherSchedule);

  // 候选教师：当天没有该节课程 && 当天代课数 < 2
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
      weight:  priorityWeight(t, { className, subject }, teacherAssignment, leaveTeacher),
      dayLoad: Object.keys(teacherSchedule[t] || {}).filter(k => k.startsWith(leaveDate)).length
    }))
    .sort((a, b) => a.weight !== b.weight ? a.weight - b.weight : a.dayLoad - b.dayLoad);

  return candidates[0]?.teacher || null;
}

/**
 * 批量生成代课
 * @param {object} timetable  - 课表数据
 * @param {object} teacherAssignment - 任课分配
 * @param {array}  leaves     - 请假列表（status=pending）
 * @param {string} targetDate - 目标日期（如 "2026-08-10"，用于替换 leaveDate 中的"周一"等）
 * @returns {object} { results, summary }
 */
export function generateSubstitutes(timetable, teacherAssignment, leaves, targetDate) {
  const { teacherSchedule } = buildTeacherSchedule(timetable);
  const results = [];
  const existingSubs = {};  // { teacherName: count }
  const tempSchedule = [];  // 当次生成的代课记录

  // 生成日期映射
  const dayMap = getDayMapping(targetDate);

  for (const leave of leaves) {
    if (leave.status !== 'pending') continue;

    // 找到请假教师当天所有课程
    const leaveDay = leave.leaveDate; // "周一" / "周二" 等
    const realDate  = dayMap[leaveDay] || leave.leaveDate;

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
          id:              `sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          leaveId:         leave.id,
          leaveTeacher:    leave.teacherName,
          substituteTeacher: subTeacher,
          className,
          subject,
          leaveDate:       realDate,
          dayOfWeek:       leaveDay,
          period,
          reason:          leave.reason || '系统自动安排',
          status:          'arranged',
          createdAt:       new Date().toISOString()
        };
        results.push(rec);
        existingSubs[subTeacher] = (existingSubs[subTeacher] || 0) + 1;
        tempSchedule.push({ teacher: subTeacher, date: leaveDay, period });
      } else {
        results.push({
          id:              `sub_fail_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          leaveId:         leave.id,
          leaveTeacher:    leave.teacherName,
          substituteTeacher: null,
          className,
          subject,
          leaveDate:       realDate,
          dayOfWeek:       leaveDay,
          period,
          reason:          leave.reason || '系统自动安排',
          status:          'failed',
          failReason:      '未找到合适代课教师',
          createdAt:       new Date().toISOString()
        });
      }
    }
  }

  const summary = {
    total:    results.length,
    arranged: results.filter(r => r.status === 'arranged').length,
    failed:   results.filter(r => r.status === 'failed').length
  };

  return { results, summary };
}

// ── 日期辅助 ─────────────────────────────────────────
function getDayMapping(targetDate) {
  if (!targetDate) return {};
  const d = new Date(targetDate);
  const dow = d.getDay(); // 0=周日
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dow + 6) % 7));
  const days = ['周一','周二','周三','周四','周五','周六','周日'];
  const map = {};
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    const ymd = dd.toISOString().slice(0,10);
    map[days[i]] = ymd;
  }
  return map;
}


