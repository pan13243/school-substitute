-- school-substitute 代课调课系统
-- 运行方式：Supabase Dashboard → SQL Editor → Run

-- 1. 课表数据
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  class_name TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  period INTEGER NOT NULL,
  subject TEXT,
  teacher TEXT,
  time_range TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 请假记录（API 字段：id, teacherName, leaveDate, dayOfWeek, reason, status, createdAt, updatedAt）
CREATE TABLE IF NOT EXISTS leaves (
  id TEXT PRIMARY KEY,
  teacher_name TEXT NOT NULL,
  teacher_id TEXT,
  leave_date DATE NOT NULL,
  day_of_week TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 代课安排（API 字段：id, leaveId, leaveTeacher, substituteTeacher, className, subject, leaveDate, dayOfWeek, period, reason, status, createdAt）
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

-- 4. 系统配置（存 timetable JSON、课后服务等）
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 管理员账号（简化：账号=密码）
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE leaves ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

-- 策略：所有人可读课表、代课安排
CREATE POLICY "public_read_schedule"     ON schedule     FOR SELECT USING (true);
CREATE POLICY "public_read_substitutes"  ON substitutes  FOR SELECT USING (true);

-- 策略：管理员写入请假、代课（x-admin-pwd 在 API 层验证，Supabase 侧全开放）
CREATE POLICY "public_all_leaves"        ON leaves       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_substitutes"  ON substitutes  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_schedule"     ON schedule     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all_config"       ON system_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_read_admins"      ON admins       FOR SELECT USING (true);

-- 索引
CREATE INDEX IF NOT EXISTS idx_leaves_date    ON leaves(leave_date);
CREATE INDEX IF NOT EXISTS idx_leaves_teacher ON leaves(teacher_name);
CREATE INDEX IF NOT EXISTS idx_sub_date       ON substitutes(leave_date);

-- 初始化管理员账号（admin / admin888）
INSERT INTO admins (username, password_hash, name) VALUES
  ('admin', 'admin888', '系统管理员')
ON CONFLICT (username) DO NOTHING;

-- 初始化系统配置
INSERT INTO system_config (key, value) VALUES
  ('timetable_v2', '{"imported": false}'),
  ('notify_config', '{"webhook":"","email":""}')
ON CONFLICT (key) DO NOTHING;
