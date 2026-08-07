/**
 * 代课优先级算法（前端+后端共用）
 * 优先级顺序：
 *   1. 同班主科老师（语文/数学）优先
 *   2. 同班英语老师
 *   3. 同班道法/科学老师
 *   4. 同班其他副科老师
 *   5. 他班副科老师（按课时最少排序）
 *   6. 行政人员兜底
 *
 * 冲突排除：
 *   - 该时间段已有课的教师不可用
 *   - 同一教师一天最多代2节课
 *   - 已有代课记录的教师权重降低
 */

const MAIN_SUBJECTS   = ['语文', '数学'];
const SECONDARY_EARLY = ['英语'];
const SECONDARY_LATE  = ['道德与法治', '道德', '科学'];
const SIDE_SUBJECTS   = ['音乐', '美术', '体育', '健康', '综合', '劳动', '地方', '校本课程', '综合实践', '信息技术'];
const ADMIN_TEACHERS  = ['龙燕', '龙光辉', '潘懂平']; // 行政/领导兜底

// ── 优先级权重 ──────────────────────────────────────────────────────────────
function priorityWeight(teacher, cls, teacherAssignment) {
  const assign = teacherAssignment[cls] || {};
  if (MAIN_SUBJECTS.includes(assign['语文']) && teacher === assign['语文'])    return 1;
  if (MAIN_SUBJECTS.includes(assign['数学']) && teacher === assign['数学'])    return 2;
  if (SECONDARY_EARLY.includes(assign['英语']) && teacher === assign['英语']) return 3;
  if (SECONDARY_LATE.includes(assign['道德与法治']) && teacher === assign['道德与法治']) return 4;
  if (SECONDARY_LATE.includes(assign['科学']) && teacher === assign['科学'])   return 5;
  const subjects = Object.values(assign);
  if (subjects.includes(teacher)) return 6;  // 他班副科
  return 9; // 兜底
}

// ── 构建教师课表（快速冲突查询） ─────────────────────────────────────────────
function buildTeacherSchedule(timetable) {
  // { teacherName: { '星期一_1': [className, subject], ... } }
  const ts = {};
  const allClasses = [];

  for (const [day, classMap] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      if (!allClasses.includes(cls)) allClasses.push(cls);
      for (const slot of periods) {
        const teacher = slot.teacher;
        if (!teacher) continue;
        if (!ts[teacher]) ts[teacher] = {};
        const key = `${day}_${slot.period}`;
        if (!ts[teacher][key]) ts[teacher][key] = [];
        ts[teacher][key].push({ className: cls, subject: slot.subject });
      }
    }
  }
  return { teacherSchedule: ts, allClasses };
}

// ── 找代课教师 ─────────────────────────────────────────────────────────────
/**
 * @param {string} leaveTeacher  - 请假教师
 * @param {string} day           - 星期几
 * @param {number} period        - 第几节
 * @param {string} targetClass   - 代课班级
 * @param {object} timetable     - { '星期一': { '一（1）': [{period,subject,teacher}] } }
 * @param {object} teacherAssignment - { '一（1）': { '语文': '龙燕', '数学': '龙光辉', ... } }
 * @param {object} teacherSchedule - buildTeacherSchedule() 输出
 * @param {object} existingSubs  - 已安排的代课 { teacherName: countOnDay }
 * @param {string[]} allTeachers - 所有教师名单
 * @returns {{ teacher: string, reason: string } | null}
 */
function findSubstitute(leaveTeacher, day, period, targetClass, timetable,
                        teacherAssignment, teacherSchedule, existingSubs, allTeachers) {
  const subKey = `${day}_${period}`;
  const candidates = [];

  for (const teacher of allTeachers) {
    if (teacher === leaveTeacher) continue;

    // 冲突检查1：该时段有课
    const busySlots = teacherSchedule[teacher]?.[subKey] || [];
    if (busySlots.length > 0) continue;

    // 冲突检查2：该天已代课≥2节
    const dayCount = Object.entries(teacherSchedule[teacher] || {})
      .filter(([k]) => k.startsWith(day))
      .reduce((sum, [, slots]) => sum + slots.length, 0);
    const subCount = existingSubs[teacher]?.[day] || 0;
    if (dayCount + subCount >= 2) continue;

    const weight = priorityWeight(teacher, targetClass, teacherAssignment);
    candidates.push({ teacher, weight, busySlots: dayCount });
  }

  if (candidates.length === 0) {
    // 宽松模式：允许同班已有课的老师跨科目代（主科不能代）
    for (const teacher of allTeachers) {
      if (teacher === leaveTeacher) continue;
      const busySlots = teacherSchedule[teacher]?.[subKey] || [];
      if (busySlots.length > 0) continue; // 还是要求本节空课
      const dayCount = Object.entries(teacherSchedule[teacher] || {})
        .filter(([k]) => k.startsWith(day))
        .reduce((sum, [, slots]) => sum + slots.length, 0);
      if (dayCount >= 3) continue; // 最多可带3节
      const weight = 7;
      candidates.push({ teacher, weight, busySlots: dayCount });
    }
  }

  if (candidates.length === 0) return null;

  // 按权重升序（越小越优先），相同权重按当天已有课升序
  candidates.sort((a, b) => a.weight - b.weight || a.busySlots - b.busySlots);

  const chosen = candidates[0];
  let reason = '';
  if (chosen.weight <= 2)      reason = '同班主科教师';
  else if (chosen.weight <= 3)  reason = '同班英语教师';
  else if (chosen.weight <= 5)  reason = '同班道法/科学教师';
  else if (chosen.weight <= 6)  reason = '同班副科教师';
  else if (chosen.weight <= 7)  reason = '跨班支援';
  else                          reason = '紧急调配';

  return { teacher: chosen.teacher, reason };
}

// ── 批量生成代课 ────────────────────────────────────────────────────────────
function generateSubstitutes(leaveRecords, timetable, teacherAssignment, teacherSchedule, allTeachers) {
  const results = [];
  const existingSubs = {}; // { teacherName: { '星期一': count } }

  for (const leave of leaveRecords) {
    const { teacherName, leaveDate, dayOfWeek, period } = leave;

    // 找出该时段受影响的班级+科目
    const daySlots = timetable[dayOfWeek] || {};
    const affected = [];
    for (const [cls, slots] of Object.entries(daySlots)) {
      const match = slots.find(s => s.period === period && s.teacher === teacherName);
      if (match) affected.push({ className: cls, subject: match.subject });
    }

    if (affected.length === 0) {
      results.push({ ...leave, status: 'skip', reason: '该时段无对应课程' });
      continue;
    }

    for (const { className, subject } of affected) {
      const found = findSubstitute(
        teacherName, dayOfWeek, period, className,
        timetable, teacherAssignment, teacherSchedule, existingSubs, allTeachers
      );

      if (found) {
        // 记录该代课
        if (!existingSubs[found.teacher]) existingSubs[found.teacher] = {};
        existingSubs[found.teacher][dayOfWeek] = (existingSubs[found.teacher][dayOfWeek] || 0) + 1;

        // 更新临时教师课表（防止同一教师被重复安排）
        const tmpKey = `${dayOfWeek}_${period}`;
        if (!teacherSchedule[found.teacher]) teacherSchedule[found.teacher] = {};
        if (!teacherSchedule[found.teacher][tmpKey]) teacherSchedule[found.teacher][tmpKey] = [];
        teacherSchedule[found.teacher][tmpKey].push({ className, subject: '代课' });

        results.push({
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          leaveId: leave.id,
          leaveTeacher: teacherName,
          substituteTeacher: found.teacher,
          className,
          subject,
          leaveDate,
          dayOfWeek,
          period,
          reason: found.reason,
          status: 'arranged',
          createdAt: new Date().toISOString(),
        });
      } else {
        results.push({
          id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          leaveId: leave.id,
          leaveTeacher: teacherName,
          substituteTeacher: null,
          className,
          subject,
          leaveDate,
          dayOfWeek,
          period,
          reason: '未找到合适代课教师',
          status: 'failed',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return results;
}

module.exports = {
  MAIN_SUBJECTS, SECONDARY_EARLY, SECONDARY_LATE, SIDE_SUBJECTS, ADMIN_TEACHERS,
  priorityWeight, buildTeacherSchedule, findSubstitute, generateSubstitutes
};
