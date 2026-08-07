/**
 * school-substitute 服务器
 * 用法: node server.js
 * 端口: 3000
 */
const express = require('express');
const path    = require('path');
const fs      = require('fs');

// ── 启动时自动加载 parsed_data.json ─────────────────────
const { mem } = require('./api/supabase-client');
try {
  const pd = JSON.parse(fs.readFileSync(path.join(__dirname, 'parsed_data.json'), 'utf8'));
  if (pd && pd.timetable) {
    mem.config = {
      timetable:           pd.timetable,
      teacherAssignment:   pd.teacherAssignment || {},
      afterSchoolService:  pd.afterSchoolService || {},
      classes:             pd.classes || [],
      allTeachers:         pd.allTeachers || [],
      importedAt:          pd.importedAt || new Date().toISOString()
    };
    const total = Object.values(pd.timetable).reduce((s, cm) =>
      s + Object.values(cm).reduce((a, sl) => a + sl.length, 0), 0);
    console.log(`[DATA] 已自动加载课表：${pd.classes?.length||0} 班，${pd.allTeachers?.length||0} 名教师，${total} 课时`);
  }
} catch(e) {
  console.log('[DATA] 未找到 parsed_data.json，将在导入后加载');
}

const app   = express();
const PORT  = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API路由
app.use('/api/schedule',    require('./api/schedule'));
app.use('/api/leaves',      require('./api/leaves'));
app.use('/api/substitutes', require('./api/substitutes'));

// 静态文件
app.use(express.static(path.join(__dirname)));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎓 代课调课系统已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   管理员密码: admin888\n`);
});
