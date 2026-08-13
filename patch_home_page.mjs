import fs from 'fs';

const filePath = './app.js';
let content = fs.readFileSync(filePath, 'utf8');

// 在 renderHomePage 中，在"待处理请假"卡片后面添加"请假历史"卡片
const oldPendingSection = `    \${pendingLeaves.length > 0 && isAdmin ? \`
    <div class="section">
      <h3>? 待处理请假 (\${pendingLeaves.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th></tr></thead>
          <tbody>
            \${pendingLeaves.slice(0,5).map(l => \`
            <tr>
              <td>\${esc(l.teacherName)}</td>
              <td>\${fmtDate(l.leaveDate)}</td>
              <td>\${esc(l.dayOfWeek)}</td>
              <td>第\${l.period}节</td>
              <td>\${esc(l.reason||'—')}</td>
            </tr>\`).join('')}
          </tbody>
        </table>
      </div>
    </div>\` : ''}
  </div>\`;`;

const newPendingSection = `    \${pendingLeaves.length > 0 && isAdmin ? \`
    <div class="section">
      <h3>? 待处理请假 (\${pendingLeaves.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th></tr></thead>
          <tbody>
            \${pendingLeaves.slice(0,5).map(l => \`
            <tr>
              <td>\${esc(l.teacherName)}</td>
              <td>\${fmtDate(l.leaveDate)}</td>
              <td>\${esc(l.dayOfWeek)}</td>
              <td>第\${l.period}节</td>
              <td>\${esc(l.reason||'—')}</td>
            </tr>\`).join('')}
          </tbody>
        </table>
      </div>
    </div>\` : ''}

    \${isAdmin ? \`
    <div class="section">
      <h3>? 请假历史 <span style="font-size:12px;color:#9CA3AF;">（所有已批准记录）</span></h3>
      \${(() => {
        const approvedLeaves = leaveRecords.filter(l => l.status === 'approved');
        if (approvedLeaves.length === 0) return '<p class="text-muted">暂无已批准的请假记录</p>';
        return \`
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>操作</th></tr></thead>
            <tbody>
              \${approvedLeaves.map(l => \`
              <tr class="row-approved">
                <td>\${esc(l.teacherName)}</td>
                <td>\${fmtDate(l.leaveDate)}</td>
                <td>\${esc(l.dayOfWeek)}</td>
                <td>\${l.period ? '第'+l.period+'节' : '—'}</td>
                <td>\${esc(l.reason||'—')}</td>
                <td><button class="btn btn-sm btn-danger" onclick="deleteLeave('\${l.id}')">删除</button></td>
              </tr>\`).join('')}
            </tbody>
          </table>
        </div>\`;
      })()}
    </div>\` : ''}
  </div>\`;`;

content = content.replace(oldPendingSection, newPendingSection);

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ 已修改 app.js：管理员主页添加"请假历史"卡片');
