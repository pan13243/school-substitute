/**
 * /api/leaves — Express Router
 */
import { Router } from 'express';
import { mem, saveData } from '../api/supabase-client.js';

const router = Router();

function checkAdmin(req) {
  return req.headers['x-admin-pwd'] === 'admin888' || req.headers['x-admin-password'] === 'admin888';
}

// GET /api/leaves
router.get('/', (req, res) => {
  res.json({ success: true, data: mem.leaves || [] });
});

// POST /api/leaves
router.post('/', (req, res) => {
  const { teacherName, leaveDate, reason } = req.body;
  if (!teacherName || !leaveDate)
    return res.status(400).json({ success: false, error: 'teacherName 和 leaveDate 为必填' });

  const rec = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    teacherName: teacherName.trim(),
    leaveDate,
    reason: (reason || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  mem.leaves.push(rec);
  saveData();
  res.status(201).json({ success: true, data: rec });
});

// PUT /api/leaves/:id
router.put('/:id', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ success: false, error: '管理员密码错误' });
  const { status } = req.body;
  if (!status || !['pending','approved','rejected'].includes(status))
    return res.status(400).json({ success: false, error: 'status 无效' });
  const idx = mem.leaves.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '记录不存在' });
  mem.leaves[idx] = { ...mem.leaves[idx], status, updatedAt: new Date().toISOString() };
  saveData();
  res.json({ success: true, data: mem.leaves[idx] });
});

// DELETE /api/leaves
router.delete('/', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ success: false, error: '管理员密码错误' });
  mem.leaves = [];
  saveData();
  res.json({ success: true });
});

export default router;
