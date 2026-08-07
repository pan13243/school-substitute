/**
 * /api/schedule — Express Router
 */
import { Router } from 'express';
import { initScheduleData, mem } from '../api/supabase-client.js';
import { buildTeacherAssignment } from '../api/algorithm.js';

const router = Router();

// GET /api/schedule
router.get('/', (req, res) => {
  res.json({
    success:           true,
    data:              mem.config?.timetable           || null,
    teacherAssignment:  mem.config?.teacherAssignment  || null,
    afterSchoolService: mem.config?.afterSchoolService  || null,
    classes:           mem.config?.classes              || [],
    allTeachers:       mem.config?.allTeachers         || []
  });
});

// GET /api/schedule/teachers?teacher=xxx
router.get('/teachers', (req, res) => {
  const teacher = req.query.teacher || '';
  if (!teacher) return res.json({ success: true, data: [] });
  const tt = mem.config?.timetable || {};
  const slots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cls, periods] of Object.entries(classMap)) {
      for (const s of periods) {
        if (s.teacher === teacher) {
          slots.push({ day, className: cls, period: s.period, subject: s.subject, time: s.time });
        }
      }
    }
  }
  res.json({ success: true, data: slots });
});

// POST /api/schedule/import
router.post('/import', (req, res) => {
  if (req.headers['x-admin-pwd'] !== 'admin888' && req.headers['x-admin-password'] !== 'admin888')
    return res.status(401).json({ success: false, error: '管理员密码错误' });

  const { timetable, afterSchoolService } = req.body;
  if (!timetable) return res.status(400).json({ success: false, error: '缺少 timetable 字段' });

  const teacherAssignment = buildTeacherAssignment(timetable);
  const classSet = new Set(), teacherSet = new Set();
  for (const [, cm] of Object.entries(timetable)) {
    for (const [cls, periods] of Object.entries(cm)) { classSet.add(cls); }
    for (const periods of Object.values(cm)) {
      for (const s of periods) { if (s.teacher) teacherSet.add(s.teacher); }
    }
  }
  const classes = [...classSet].sort();
  const allTeachers = [...teacherSet].sort();

  mem.config = { timetable, teacherAssignment, afterSchoolService: afterSchoolService || [], classes, allTeachers };

  const total = Object.values(timetable).reduce((a,b)=>a+Object.values(b).reduce((a2,b2)=>a2+b2.length,0),0);
  res.json({ success: true, message: '课表导入成功', stats: { classes: classes.length, teachers: allTeachers.length, slots: total } });
});

export default router;
