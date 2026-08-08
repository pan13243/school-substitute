import { buildTeacherAssignment, buildTeacherSchedule } from './api/algorithm.js';
import fs from 'fs';
const pd = JSON.parse(fs.readFileSync('parsed_data.json','utf8'));
const ta = buildTeacherAssignment(pd.timetable);
const { teacherSchedule } = buildTeacherSchedule(pd.timetable);
console.log('龙燕全课表keys:', Object.keys(teacherSchedule['龙燕']||{}));
console.log('龙燕周一课:', JSON.stringify(Object.entries(teacherSchedule['龙燕']||{}).filter(([k])=>k.startsWith('星期一')), null, 2));
console.log('一班语文任课:', ta['一（1）']?.['语文']);
console.log('一班数学任课:', ta['一（1）']?.['数学']);
