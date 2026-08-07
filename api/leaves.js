const express = require('express');
const router  = express.Router();
const { supabase, mem, authAdmin } = require('./supabase-client');

// GET /api/leaves
router.get('/', async (req, res) => {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('leaves').select('*').order('created_at', { ascending: false });
      if (!error && data) return res.json({ success: true, data });
    } catch(e) { /* fall through to mem */ }
  }
  return res.json({ success: true, data: mem.leaves });
});

// POST /api/leaves
router.post('/', async (req, res) => {
  const { leave } = req.body;
  if (!leave || !leave.teacherName || !leave.leaveDate) {
    return res.json({ success: false, error: '缺少必填字段' });
  }
  const record = {
    id: leave.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    teacherName: leave.teacherName,
    teacherId:   leave.teacherId   || leave.teacherName,
    leaveDate:   leave.leaveDate,
    dayOfWeek:   leave.dayOfWeek   || '',
    period:      parseInt(leave.period) || 0,
    reason:      leave.reason      || '',
    status:      'pending',
    createdAt:   new Date().toISOString(),
  };
  if (supabase) {
    try {
      const { error } = await supabase.from('leaves').insert(record);
      if (!error) return res.json({ success: true, data: record });
    } catch(e) { /* fall through to mem */ }
  }
  mem.leaves.push(record);
  return res.json({ success: true, data: record, _mem: true });
});

// PUT /api/leaves/:id  (admin: approve/reject)
router.put('/:id', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权' });
  const { status } = req.body;
  const { id } = req.params;
  if (supabase) {
    const { error } = await supabase.from('leaves').update({ status }).eq('id', id);
    if (error) return res.json({ success: false, error: error.message });
  } else {
    const idx = mem.leaves.findIndex(l => l.id === id);
    if (idx >= 0) mem.leaves[idx].status = status;
  }
  return res.json({ success: true });
});

// DELETE /api/leaves  (admin only)
router.delete('/', async (req, res) => {
  if (!authAdmin(req.headers)) return res.json({ success: false, error: '未授权' });
  if (supabase) {
    await supabase.from('leaves').delete().neq('id', '');
  }
  mem.leaves = [];
  return res.json({ success: true });
});

module.exports = router;
