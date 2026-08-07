-- school-substitute 代课调课系统
-- 运行方式：Supabase Dashboard → SQL Editor → Run

-- 1. 课表数据
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY DEFAULT gen_random_id(),
  class_name TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL,
  subject TEXT,
  teacher TEXT,
  time_range TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 请假记录
CREATE TABLE IF NOT EXISTS leaves (
  id TEXT PRIMARY KEY,
  teacher_name TEXT NOT NULL,
  teacher_id TEXT,
  leave_date DATE NOT NULL,
  day_of_week TEXT,
  period INTEGER NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 代课安排
CREATE TABLE IF NOT EXISTS substitutes (
  id TEXT PRIMARY KEY,
  leave_id TEXT,
  leave_teacher TEXT NOT NULL,
  substitute_teacher TEXT,
  class_name TEXT NOT NULL,
  subject TEXT,
  leave_date DATE NOT NULL,
  day_of_week TEXT,
  period INTEGER,
  reason TEXT,
  status TEXT DEFAULT 'arranged',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 系统配置（存 timetable JSON 等）
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS（行级安全）
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- 公开读取（所有人可查课表和代课）
CREATE POLICY "public_read_leaves"     ON leaves     FOR SELECT USING (true);
CREATE POLICY "public_read_substitutes" ON substitutes FOR SELECT USING (true);
CREATE POLICY "public_read_schedule"   ON schedule    FOR SELECT USING (true);

-- 插入/更新需管理员（在 API 层通过 x-admin-pwd 头验证）
CREATE POLICY "admin_insert_leaves"     ON leaves     FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_update_leaves"     ON leaves     FOR UPDATE USING (true);
CREATE POLICY "admin_insert_substitutes" ON substitutes FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_insert_schedule"   ON schedule    FOR INSERT WITH CHECK (true);
CREATE POLICY "admin_write_config"      ON system_config FOR ALL USING (true);

-- 索引
CREATE INDEX IF NOT EXISTS idx_leaves_date ON leaves(leave_date);
CREATE INDEX IF NOT EXISTS idx_leaves_teacher ON leaves(teacher_name);
CREATE INDEX IF NOT EXISTS idx_substitutes_date ON substitutes(leave_date);
CREATE INDEX IF NOT EXISTS idx_schedule_class ON schedule(class_name, day_of_week);

-- 测试数据
INSERT INTO system_config (key, value) VALUES
  ('timetable_v2', '{"imported": false}'),
  ('notify_config', '{"webhook":"","email":""}')
ON CONFLICT (key) DO NOTHING;
