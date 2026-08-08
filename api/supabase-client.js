/**
 * Supabase 客户端 — 本地 Express 版本（CommonJS + npm 包）
 * Cloudflare 用 supabase-client-cf.js
 */
import { createClient } from '@supabase/supabase-js';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Supabase ───────────────────────────────────────────
const FORCE_MEM = process.env.FORCE_LOCAL === '1';
const supabaseUrl = FORCE_MEM ? null : (process.env.SUPABASE_URL  || 'https://mucdpljnchabygrrdvda.supabase.co');
const supabaseKey = FORCE_MEM ? null : (process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2RwbGpuY2hhYnlncnJkdmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MzY0OTMsImV4cCI6MjEwMTUxMjQ5M30.rXPhoaN4OfgDntjllIUkHsuOSZhCuMWZ7yLCUL76CrE');

let supabase = null;
if (supabaseUrl && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[DB] Supabase connected ✓');
  } catch(e) { console.error('[DB] Supabase init failed:', e.message); }
} else {
  console.warn('[DB] FORCE_LOCAL=1 — using in-memory store (data resets on restart)');
}

// ── 内存存储 ───────────────────────────────────────────
export const mem = {
  config:      null,
  leaves:      [],
  substitutes: []
};

// ── 文件持久化（FORCE_LOCAL 模式） ─────────────────
const DATA_FILE = path.join(__dirname, '..', 'mem_data.json');

function saveData() {
  if (process.env.FORCE_LOCAL !== '1') return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      leaves:      mem.leaves,
      substitutes: mem.substitutes
    }, null, 2), 'utf8');
  } catch(e) { console.error('[DATA] 保存失败:', e.message); }
}

function loadData() {
  if (process.env.FORCE_LOCAL !== '1') return;
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (d.leaves)      mem.leaves      = d.leaves;
    if (d.substitutes) mem.substitutes = d.substitutes;
    console.log(`[DATA] 已恢复 ${mem.leaves.length} 条请假 / ${mem.substitutes.length} 条代课记录`);
  } catch(e) { console.error('[DATA] 恢复失败:', e.message); }
}

export { saveData, loadData };

// ── 启动时自动加载课表 ────────────────────────────────
export async function initScheduleData(env) {
  // 动态导入 algorithm（避免循环依赖）
  const { buildTeacherAssignment } = await import('./algorithm.js');

  const dataPath = path.join(__dirname, '..', 'parsed_data.json');
  if (fs.existsSync(dataPath)) {
    try {
      const pd = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (pd?.timetable) {
        mem.config = {
          timetable:           pd.timetable,
          teacherAssignment:    buildTeacherAssignment(pd.timetable),
          afterSchoolService:  pd.afterSchoolService || [],
          classes:             pd.classes  || [],
          allTeachers:         pd.allTeachers || []
        };
        const total = Object.values(pd.timetable).reduce(
          (s,cm) => s + Object.values(cm).reduce((a,sl) => a + sl.length, 0), 0);
        console.log(`[DATA] 已自动加载课表：${pd.classes?.length||0} 班，` +
          `${pd.allTeachers?.length||0} 名教师，${total} 课时`);
      }
    } catch(e) { console.error('[DATA] 加载课表失败:', e.message); }
  } else {
    console.log('[DATA] 未找到 parsed_data.json，将在导入后加载');
  }
  // 恢复请假/代课记录（文件持久化）
  loadData();
}

// ── 管理员密码校验 ────────────────────────────────────
export function checkAdmin(headers) {
  const p = headers?.['x-admin-pwd'] || headers?.['x-admin-password'] || '';
  return p === 'admin888';
}

// ── 统一响应 ─────────────────────────────────────────
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
export function err(msg, status = 400) { return json({ success: false, error: msg }, status); }

