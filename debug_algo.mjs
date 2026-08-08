import { generateSubstitutes, buildTeacherAssignment, buildTeacherSchedule } from './api/algorithm.js';
import { mem, initScheduleData } from './api/supabase-client.js';

// 先初始化数据
await initScheduleData();

console.log('课表 keys:', Object.keys(mem.config?.timetable || {}));
console.log('总课时:', Object.values(mem.config?.timetable || {}).reduce((s, d) => s + Object.values(d).reduce((ss, p) => ss + p.length, 0), 0));

const ta = buildTeacherAssignment(mem.config.timetable);
console.log('classes:', Object.keys(ta).length);

const sch = buildTeacherSchedule(mem.config.timetable);
console.log('教师数:', Object.keys(sch.teacherSchedule).length);
console.log('龙燕的课 keys:', Object.keys(sch.teacherSchedule['龙燕'] || {}));

const leaves = [
  {id:'l1', teacherName:'龙燕', leaveDate:'2026-08-10', dayOfWeek:'星期一', status:'approved', reason:'测试'}
];
const result = generateSubstitutes(mem.config.timetable, ta, leaves, '2026-08-10');
console.log('结果:', JSON.stringify(result, null, 2));