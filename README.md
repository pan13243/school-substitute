# 代课调课系统 · 施秉县双井镇中心小学

## 🚀 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/pan13243/school-substitute.git
cd school-substitute

# 2. 安装依赖
npm install

# 3. 启动（本地）
npm start
# 访问 http://localhost:3000

# 4. 管理员密码
# 默认：admin888（请首次使用后修改 server.js 中的 ADMIN_HASH）
```

## 📋 功能清单

- [x] **登录系统**：教师（姓名选择）/ 管理员（密码验证）
- [x] **请假登记**：教师/管理员提交请假，管理员审批
- [x] **课表查询**：按班级查课表 / 教师查个人课表
- [x] **代课安排**：自动优先级算法生成代课方案
- [x] **Excel 导出**：一键导出代课安排表
- [x] **企业微信通知**：配置 Webhook 自动推送
- [x] **云端同步**：Supabase 数据库，多端访问

## 🏫 代课优先级算法

当某位教师请假时，系统按以下优先级自动安排代课：

| 优先级 | 教师类型 | 说明 |
|--------|----------|------|
| 1 | 同班主科教师 | 语文/数学老师代同班 |
| 2 | 同班英语教师 | 英语老师代同班 |
| 3 | 同班道法/科学教师 |  |
| 4 | 同班副科教师 | 音乐/美术/体育等 |
| 5 | 跨班副科教师 | 按当天课时最少排序 |
| 6 | 行政人员兜底 |  |

**冲突排除规则**：
- 该时段已有课的教师不可用
- 同一教师每天最多代 2 节

## 📁 课表导入

1. 管理员登录后 → 进入「导入课表」页面
2. 上传或粘贴 `parsed_data.json` 文件内容
3. 系统自动识别 21 个班级、65+ 名教师

## ☁️ 部署到云端

### 方案 A：Vercel（推荐，免费）

```bash
npm install -g vercel
vercel --prod
```

设置环境变量：
```
SUPABASE_URL=https://mucdpljnchabygrrdvda.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

### 方案 B：Cloudflare Pages

推送到 GitHub 后，在 Cloudflare Dashboard 连接仓库，Build command 留空，Output directory 填 `/`。

## 🔧 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SUPABASE_URL` | Supabase 项目地址 | 内置地址 |
| `SUPABASE_ANON_KEY` | Supabase 匿名密钥 | 内置密钥 |
| `PORT` | 服务端口 | 3000 |

## 📂 目录结构

```
school-substitute/
├── api/
│   ├── algorithm.js     ← 代课优先级算法
│   ├── leaves.js        ← 请假 API
│   ├── schedule.js      ← 课表 API
│   ├── substitutes.js   ← 代课 API
│   └── supabase-client.js ← 数据库客户端
├── styles/
│   └── main.css         ← 样式
├── app.js               ← 前端逻辑
├── index.html           ← 入口
├── server.js            ← 本地服务器
├── parsed_data.json     ← 已解析课表数据
└── package.json
```
