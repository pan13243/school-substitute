/**
 * school-substitute 服务器
 * 用法: node server.js
 * 端口: 3000
 */
const express = require('express');
const path    = require('path');

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
