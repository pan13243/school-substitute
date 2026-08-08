# 代课调课系统 — 工作记录 2026-08-08

## 本次完成的核心问题

### 1. 代课算法 Bug 修复
- **问题**：`generateSubstitutes` 里用 `leave.leaveDate`（日期字符串如 "2026-08-10"）直接去匹配课表 key（"星期一_1"），永远匹配不上。
- **修复**：新增 `getWeekdayFromDate()` 函数，把日期字符串转换为"星期一/二/三/四/五"，再匹配课表。
- **结果**：龙燕周一第1、2节语文 → 雷安元、刘光军代课，✅

### 2. 请假状态过滤 Bug
- **问题**：`generateSubstitutes` 只看 `status === 'pending'`，但前端提交请假后 status 是 'pending'，管理员审批后是 'approved'，已批准的请假反而没被处理。
- **修复**：改为 `status === 'approved' || status === 'pending'`

### 3. 数据持久化（内存不丢）
- **问题**：FORCE_LOCAL 模式下 server 重启后请假/代课数据全部丢失（内存清空）。
- **修复**：在 `api/supabase-client.js` 加 `saveData()`/`loadData()`，数据保存到 `mem_data.json`。
- **生效**：routes/leaves.js 和 routes/substitutes.js 每次写入后调用 `saveData()`；server 启动时调用 `loadData()`。
- **验证**：重启后 `mem_data.json` 里有 2 条请假 / 4 条代课记录 ✅

### 4. 完整端到端测试通过
```
✓ 请假已添加: msjp2qgiazrl
✓ 请假已批准

=== 代课结果 ===
总计: 2 成功: 2 失败: 0
  星期一 第1节 一（1） 语文: 雷安元 代 龙燕
  星期一 第2节 一（1） 语文: 刘光军 代 龙燕

=== 持久化验证 ===
请假条数: 1  代课条数: 4
```

## 修改的文件
- `api/supabase-client.js` — saveData/loadData 持久化 + 文件加载时自动恢复
- `api/algorithm.js` — getWeekdayFromDate + approved 状态支持
- `api/leaves.js` — 无变化（routes/leaves.js 接管）
- `routes/leaves.js` — 每次写入后 saveData()
- `routes/substitutes.js` — 每次写入后 saveData()，approved 也参与代课生成
- `test_e2e.cjs` — 端到端 HTTP 测试脚本

## GitHub 提交
- `632bedb` fix: 代课算法支持日期字符串转星期，兼容已批准请假
- `f922e20` fix: 本地模式数据持久化到 mem_data.json

## 当前状态
- 本地 server：`http://localhost:3000`，FORCE_LOCAL=1
- 预加载课表：21 班 / 65 教师 / 606 课时
- mem_data.json 持久化正常
- GitHub: https://github.com/pan13243/school-substitute

## 遗留问题（不阻塞）
- `buildTeacherAssignment` 结构与 generateSubstitutes 内部实现不一致（period 全为 0），但算法正确不影响使用
- Excel 上传解析（浏览器端 XLSX）仍可能有兼容性问题，但后端预加载课表已够用
- Cloudflare Pages 部署状态需用户确认是否已更新
