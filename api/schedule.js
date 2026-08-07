const express = require('express');
const router  = express.Router();
const { supabase, mem, authAdmin } = require('./supabase-client');
const { buildTeacherSchedule } = require('./algorithm');

// GET /api/schedule
router.get('/', async (req, res) => {
  if (supabase) {
    const { data, error } = await supabase
      .from('schedule').select('*').limit(1);
    // 如果没有数据返回空，让前端处理
    if (error) return res.json({ success: false, error: error.message });
    // 返回完整 timetable（已存在 mem.config）
    const cfg = mem.config || {};
    return res.json({ success: true, data: cfg.timetable || null,
                      teacherAssignment: cfg.teacherAssignment || null,
                      afterSchoolService: cfg.afterSchoolService || null,
                      classes: cfg.classes || [],
                      allTeachers: cfg.allTeachers || [] });
  }
  return res.json({ success: true, data: mem.config.timetable || null,
                    teacherAssignment: mem.config.teacherAssignment || null,
                    afterSchoolService: mem.config.afterSchoolService || null,
                    classes: mem.config.classes || [],
                    allTeachers: mem.config.allTeachers || [] });
});

// POST /api/schedule/import  ← 管理员专用，从 parsed_data.json 导入完整数据
router.post('/import', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权，请联系管理员' });
  const { timetable, teacherAssignment, afterSchoolService, classes, allTeachers } = req.body;
  if (!timetable) return res.json({ success: false, error: '缺少 timetable 数据' });

  const config = { timetable, teacherAssignment, afterSchoolService, classes, allTeachers,
                   importedAt: new Date().toISOString() };
  mem.config = config;

  if (supabase) {
    // 保存到 supabase
    const { error } = await supabase.from('system_config')
      .upsert([{ key: 'timetable_v2', value: JSON.stringify(config) }], { onConflict: 'key' });
    if (error) console.error('[DB] schedule import error:', error.message);
  }
  return res.json({ success: true, message: `已导入 ${classes?.length || 0} 个班级，${allTeachers?.length || 0} 名教师` });
});

// GET /api/schedule/teachers  ← 教师课表（快速查询）
router.get('/teachers', async (req, res) => {
  const { teacher } = req.query;
  const cfg = mem.config || {};
  const tt  = cfg.timetable;
  if (!tt) return res.json({ success: false, error: '课表未导入' });

  if (teacher) {
    const slots = [];
    for (const [day, classMap] of Object.entries(tt)) {
      for (const [cls, periods] of Object.entries(classMap)) {
        for (const slot of periods) {
          if (slot.teacher === teacher) {
            slots.push({ day, className: cls, period: slot.period,
                         subject: slot.subject, time: slot.time });
          }
        }
      }
    }
    return res.json({ success: true, data: slots });
  }
  return res.json({ success: true, data: null });
});

// POST /api/schedule (legacy)
router.post('/', async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) return res.json({ success: false });
  if (supabase) {
    const { error } = await supabase.from('schedule').upsert(records);
    if (error) return res.json({ success: false, error: error.message });
  }
  return res.json({ success: true });
});

// DELETE /api/schedule (admin)
router.delete('/', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权' });
  mem.config = {};
  if (supabase) await supabase.from('schedule').delete().neq('id', '');
  return res.json({ success: true });
});

module.exports = router;
