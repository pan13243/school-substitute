/**
 * school-substitute 服务器（ES Module）
 * 用法: node server.js
 * 端口: 3000
 */
import express from 'express';
import path    from 'path';
import { fileURLToPath } from 'url';
import { initScheduleData } from './api/supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 启动时自动加载 parsed_data.json
await initScheduleData(process.env);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API路由（使用 routes/ 下的 Express Router）
app.use('/api/schedule',    (await import('./routes/schedule.js')).default);
app.use('/api/leaves',      (await import('./routes/leaves.js')).default);
app.use('/api/substitutes', (await import('./routes/substitutes.js')).default);

// 静态文件
app.use(express.static(__dirname));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🎓 代课调课系统已启动`);
  console.log(`   本地访问: http://localhost:${PORT}`);
  console.log(`   管理员密码: admin888\n`);
});
