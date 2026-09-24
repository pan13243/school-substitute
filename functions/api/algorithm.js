/**
 * 代课优先级算法 — 浏览器 + Cloudflare Workers 通用（ES Module）
 * 优先级：同班主科(语数英) > 同班道法/科学 > 同班其他副科 > 跨班支援
 */

// 优先级常量
export const MAIN_SUBJECTS   = ['语文', '数学'];           // 1=同班语文  2=同班数学
export const SECONDARY_EARLY  = ['英语'];                   // 3=英语
export const SECONDARY_LATE   = ['道德与法治', '道德', '科学']; // 4=道法 5=科学
export const SIDE_SUBJECTS    = ['音乐', '美术', '体育', '信息技术', '劳动', '健康', '阅读', '书法']; // 6

// ADMIN_TEACHERS 已移除（2026-08-14）：任何老师均可参与代课排序
// export const ADMIN_TEACHERS = ['龙燕', '龙光辉', '潘懂平'];

// 宽松模式：跨班支援教师
const LOOSE_MODE_TEACHERS = [];

/**
 * 计算代课优先级权重（越小越优先）
 * @param {string} teacher - 代课教师姓名
 * @param {object} slot    - { className, subject }
 * @param {object} teacherAssignment - { [cls]: { [subject]: teacher } }
 * @param {string} leaveTeacher - 请假教师姓名
 */
// ── 优先级辅助 ───────────────────────────────────────────────────────
/**
 * 获取代课老师的主科身份 tier（基于 teacherAssignment 中该老师教的所有班级/学科）
 * tier: 1=语数 2=英语 3=科学/道法 4=副科(音乐美术体育等) 5=其他
 */
/**
 * 获取代课老师在 targetClass 所教科目的身份 tier
 * tier: 1=语数 2=英语 3=科学/道法 4=副科 5=其他
 * 同班多科时取课时最多的科目
 */
function teacherIdentityTier(teacher, targetClass, teacherAssignment) {
  if (!teacher || !targetClass || !teacherAssignment) return 5;
  const clsSubs = teacherAssignment[targetClass] || {};
  // 找该老师在该班教的所有科目及课时数
  const subjectCount = {};
  for (const [subj, t] of Object.entries(clsSubs)) {
    if (t === teacher) subjectCount[subj] = (subjectCount[subj] || 0) + 1;
  }
  const entries = Object.entries(subjectCount);
  if (entries.length === 0) return 5; // 该班查不到此老师
  // 课时最多的科目作为身份
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0][0];
  if (['语文','数学'].includes(top)) return 1;
  if (top === '英语') return 2;
  if (['科学','道德与法治','道德'].includes(top)) return 3;
  if (['音乐','美术','体育','信息技术','劳动','健康','阅读','书法','综合实践'].includes(top)) return 4;
  return 5;
}
export function priorityWeight(teacher, slot, teacherAssignment, leaveTeacher) {
  if (teacher === leaveTeacher) return 999;
  const { className } = slot;
  const tier = teacherIdentityTier(teacher, className, teacherAssignment);
  if (tier <= 4) return tier;
  return 6;
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
      // ADMIN_TEACHERS 限制已移除，任何老师均可参与（2026-08-14）
      if (t in teacherSchedule && slotKey in teacherSchedule[t]) return false;
      const daySub = (existingSubs[t] || 0) + tempSchedule.filter(
        s => s.teacher === t && s.date === leaveDate).length;
      // 不再限制节数，只检查 tempSchedule 中该老师是否已代过这节
      const alreadyAssignedThisSlot = tempSchedule.some(s =>
        s.teacher === t && s.date === leaveDate && s.period === period);
      if (alreadyAssignedThisSlot) return false;
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


