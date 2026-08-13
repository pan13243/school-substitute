import fs from 'fs';
import path from 'path';

const filePath = './app.js';
let content = fs.readFileSync(filePath, 'utf8');

// 1. 修改 renderLeavePage 函数，添加 pendingLeaveRecords 变量
const oldFuncStart = `function renderLeavePage(area) {
  const td = scheduleData || {};
  const teas = td.allTeachers || [];

  area.innerHTML = \``;

const newFuncStart = `function renderLeavePage(area) {
  const td = scheduleData || {};
  const teas = td.allTeachers || [];
  // 请假登记页只显示待审批记录（pending/rejected）
  const pendingLeaveRecords = leaveRecords.filter(l => l.status !== 'approved');

  area.innerHTML = \``;

content = content.replace(oldFuncStart, newFuncStart);

// 2. 修改请假记录显示部分
const oldLeaveRecords = `    <div class="card">
      <div class="card-header">
        <h3>📋 请假记录 (\${leaveRecords.length})</h3>
        \${isAdmin ? \`<button class="btn btn-sm btn-danger" onclick="clearAllLeaves()">清空</button>\` : ''}
      </div>
      \${leaveRecords.length > 0 ? \`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            \${leaveRecords.map(l => \`
            <tr class="\${l.status==='approved'?'row-approved':''}">
              <td>\${esc(l.teacherName)}</td>
              <td>\${fmtDate(l.leaveDate)}</td>
              <td>\${esc(l.dayOfWeek)}</td>
              <td>\${l.period ? '第'+l.period+'节' : '—'}</td>
              <td>\${esc(l.reason||'—')}</td>
              <td><span class="badge badge-\${l.status==='approved'?'green':l.status==='rejected'?'red':'yellow'}">\${l.status||'待审核'}</span></td>
              <td>
                \${isAdmin ? \`<button class="btn btn-sm btn-success" onclick="approveLeave('\${l.id}')">批准</button>\` : ''}
                \${(isAdmin || l.status!=='approved') ? \`<button class="btn btn-sm btn-danger"  onclick="deleteLeave('\${l.id}')">删除</button>\` : ''}
              </td>
            </tr>\`).join('')}
          </tbody>
        </table>
      </div>\` : '<p class="text-muted">暂无请假记录</p>'}
    </div>`;

const newLeaveRecords = `    <div class="card">
      <div class="card-header">
        <h3>📋 待审批请假 (\${pendingLeaveRecords.length})</h3>
      </div>
      \${pendingLeaveRecords.length > 0 ? \`
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>操作</th></tr></thead>
          <tbody>
            \${pendingLeaveRecords.map(l => \`
            <tr>
              <td>\${esc(l.teacherName)}</td>
              <td>\${fmtDate(l.leaveDate)}</td>
              <td>\${esc(l.dayOfWeek)}</td>
              <td>\${l.period ? '第'+l.period+'节' : '—'}</td>
              <td>\${esc(l.reason||'—')}</td>
              <td>
                \${isAdmin ? \`<button class="btn btn-sm btn-success" onclick="approveLeave('\${l.id}')">批准</button>\` : ''}
                <button class="btn btn-sm btn-danger" onclick="deleteLeave('\${l.id}')">删除</button>
              </td>
            </tr>\`).join('')}
          </tbody>
        </table>
      </div>\` : '<p class="text-muted">暂无待审批请假</p>'}
    </div>`;

content = content.replace(oldLeaveRecords, newLeaveRecords);

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ 已修改 app.js：请假登记页只显示待审批记录');
