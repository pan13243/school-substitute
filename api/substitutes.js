const express = require('express');
const router  = express.Router();
const { supabase, mem, authAdmin } = require('./supabase-client');
const { generateSubstitutes, buildTeacherSchedule } = require('./algorithm');

// GET /api/substitutes
router.get('/', async (req, res) => {
  if (supabase) {
    const { data, error } = await supabase
      .from('substitutes').select('*').order('created_at', { ascending: false });
    if (error) return res.json({ success: false, error: error.message });
    return res.json({ success: true, data: data || [] });
  }
  return res.json({ success: true, data: mem.substitutes });
});

// POST /api/substitutes/generate  ← 核心：自动生成代课
router.post('/generate', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权，请联系管理员' });

  const cfg = mem.config || {};
  const { timetable, teacherAssignment, allTeachers } = cfg;
  if (!timetable || Object.keys(timetable).length === 0) {
    return res.json({ success: false, error: '请先导入课表' });
  }

  const leaves = supabase
    ? (await supabase.from('leaves').select('*').eq('status', 'pending')).data || []
    : mem.leaves;

  if (leaves.length === 0) {
    return res.json({ success: false, error: '暂无请假记录' });
  }

  const { teacherSchedule } = buildTeacherSchedule(timetable);
  const results = generateSubstitutes(leaves, timetable, teacherAssignment,
                                       teacherSchedule, allTeachers);

  // 保存到内存/数据库
  const arranged = results.filter(r => r.status === 'arranged');
  mem.substitutes.push(...arranged);

  if (supabase && arranged.length > 0) {
    await supabase.from('substitutes').insert(arranged);
  }

  return res.json({ success: true, data: results,
                    summary: { total: results.length, arranged: arranged.length,
                               failed: results.filter(r=>r.status==='failed').length } });
});

// POST /api/substitutes (manual add)
router.post('/', async (req, res) => {
  const { records } = req.body;
  if (!records || !Array.isArray(records)) return res.json({ success: false });
  const now = new Date().toISOString();
  const recs = records.map(r => ({ ...r, id: r.id || (Date.now().toString(36)+Math.random().toString(36).slice(2,7)), createdAt: now }));
  if (supabase) {
    await supabase.from('substitutes').insert(recs);
  } else {
    mem.substitutes.push(...recs);
  }
  return res.json({ success: true, data: recs });
});

// DELETE /api/substitutes (admin)
router.delete('/', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权' });
  mem.substitutes = [];
  if (supabase) await supabase.from('substitutes').delete().neq('id', '');
  return res.json({ success: true });
});

module.exports = router;
