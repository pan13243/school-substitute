/**
 * /api/substitutes — Express Router
 */
import { Router } from 'express';
import { mem, saveData } from '../api/supabase-client.js';
import { buildTeacherAssignment, generateSubstitutes } from '../api/algorithm.js';

const router = Router();

function checkAdmin(req) {
  return req.headers['x-admin-pwd'] === 'admin888' || req.headers['x-admin-password'] === 'admin888';
}

// GET /api/substitutes
router.get('/', (req, res) => {
  res.json({ success: true, data: mem.substitutes || [] });
});

// POST /api/substitutes/generate
router.post('/generate', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ success: false, error: '管理员密码错误' });

  if (!mem.config?.timetable)
    return res.status(400).json({ success: false, error: '课表未导入' });

  const leaves = (mem.leaves || []).filter(l => l.status === 'approved' || l.status === 'pending');
  if (leaves.length === 0)
    return res.json({ success: true, results: [], summary: { total: 0, arranged: 0, failed: 0 }, message: '暂无待处理请假' });

  const { results, summary } = generateSubstitutes(
    mem.config.timetable,
    buildTeacherAssignment(mem.config.timetable),
    leaves,
    req.body.targetDate
  );

  const existingIds = new Set(mem.substitutes.map(s => s.id));
  const newOnes = results.filter(r => !existingIds.has(r.id));
  mem.substitutes.push(...newOnes);
  saveData();

  res.json({ success: true, results: newOnes, summary,
    message: `代课安排完成：成功 ${summary.arranged} 条，失败 ${summary.failed} 条` });
});

// POST /api/substitutes（手动添加）
router.post('/', (req, res) => {
  const { leaveTeacher, substituteTeacher, className, subject, leaveDate, dayOfWeek, period, reason } = req.body;
  if (!leaveTeacher || !className || !subject || !leaveDate)
    return res.status(400).json({ success: false, error: '缺少必填字段' });

  const rec = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    leaveTeacher, substituteTeacher: substituteTeacher || null,
    className, subject, leaveDate, dayOfWeek: dayOfWeek || '',
    period: parseInt(period) || 0, reason: reason || '',
    status: substituteTeacher ? 'arranged' : 'manual',
    createdAt: new Date().toISOString()
  };
  mem.substitutes.push(rec);
  saveData();
  res.status(201).json({ success: true, data: rec });
});

// DELETE /api/substitutes
router.delete('/', (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ success: false, error: '管理员密码错误' });
  mem.substitutes = [];
  saveData();
  res.json({ success: true });
});

export default router;
