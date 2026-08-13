import { readFileSync, writeFileSync } from 'fs';

const path = 'app.js';
let c = readFileSync(path, 'utf8');
let lines = c.split('\n');

function lineOf(needle) {
  const idx = lines.findIndex(l => l.includes(needle));
  if (idx === -1) { console.error('NOT FOUND:', needle); process.exit(1); }
  return idx;
}
function after(needle) { return lineOf(needle) + 1; }
function before(needle) { return lineOf(needle); }

function inject(idx, content) {
  lines.splice(idx, 0, content);
}

// 1. pageTitles: 加 slip 条目（before settings: '通知设置'）
const sSettings = lineOf("settings: '通知设置'");
lines.splice(sSettings, 0, "    slip: '请假条管理',");
console.log('1. pageTitles OK');

// 2. 侧边栏管理员区：加请假条管理按钮（after 导入课表 button）
const sImportBtn = lineOf(`onclick="switchPage('import')">📤 导入课表</button>`);
lines.splice(sImportBtn + 1, 0, `          <button class="nav-btn" data-page="slip" onclick="switchPage('slip')">📄 请假条管理</button>`);
console.log('2. Sidebar nav OK');

// 3. switchPage: 加 slip 分支（before settings）
const sSwitchSettings = lineOf("else if (page === 'settings') renderSettingsPage(area);");
lines.splice(sSwitchSettings, 0, "  else if (page === 'slip')    renderSlipPage(area);");
console.log('3. switchPage OK');

// 4. renderSlipPage 函数（插在 renderSubPage 末尾之后）
// 先找到 renderSubPage 末尾：return ` 后下一行
const sReturnSub = lineOf("return json({ success: true });") + 1;
lines.splice(sReturnSub, 0, `
// ══════════════════════════════════════════════════════
//  请假条管理页（管理员）
// ══════════════════════════════════════════════════════
async function renderSlipPage(area) {
  area.innerHTML = \`
  <div class="page">
    \${mobileBackBar('请假条管理')}
    <h2 class="page-title">📄 请假条管理</h2>
    <p class="text-muted" style="margin:0 0 12px;">事假/病假请假条永久存档，支持查看和打印导出。</p>
    <div id="slip-admin-list"></div>
  </div>\`;
  await loadSlipAdminList();
}

async function loadSlipAdminList() {
  const el = \$('slip-admin-list');
  if (!el) return;
  el.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:20px;">加载中…</p>';
  try {
    const r = await fetch('/api/leave-slips', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } });
    const j = await r.json();
    if (!j.success) { el.innerHTML = '<p style="color:#DC2626; text-align:center;">加载失败：' + (j.error||'') + '</p>'; return; }
    const slips = j.data || [];
    slips.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (slips.length === 0) {
      el.innerHTML = '<p class="text-muted" style="text-align:center;">暂无请假条</p>';
      return;
    }
    el.innerHTML = \`
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>教师</th><th>假别</th><th>请假时间</th><th>校长审批</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>
          \${slips.map(s => \`
          <tr>
            <td>\${esc(s.teacherName)}</td>
            <td>\${esc(s.reason)}</td>
            <td>\${fmtDate(s.startDate)}\${s.startDate !== s.endDate ? ' ~ ' + fmtDate(s.endDate) : ''}</td>
            <td><span class="badge badge-\${s.status==='approved'?'green':s.status==='pending'?'yellow':'red'}">\${s.status==='approved'?'✅ 同意':s.status==='pending'?'⏳ 待批':'❌ 拒绝'}</span></td>
            <td>\${new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
            <td>
              <button class="btn btn-sm" onclick="showSlipDetailModal('\${s.id}')">📋 查看</button>
            </td>
          </tr>\`).join('')}
        </tbody>
      </table>
    </div>\`;
  } catch (err) {
    el.innerHTML = '<p style="color:#DC2626; text-align:center;">网络错误</p>';
  }
}

// 查看请假条详情 + 打印按钮
async function showSlipDetailModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) { toast('未找到该请假条', 'error'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  const statusColor = slip.status === 'approved' ? '#16A34A' : slip.status === 'pending' ? '#D97706' : '#DC2626';
  const statusText = slip.status === 'approved' ? '✅ 同意' : slip.status === 'pending' ? '⏳ 待审批' : '❌ 已拒绝';
  modal.innerHTML = \`
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px;">📋 请假条详情</h3>
        <button onclick="this.closest('.modal-overlay').remove(); this.closest('.modal-overlay').remove();" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px;">
        <p style="text-align:center; color:\${statusColor}; font-weight:600; margin:0 0 16px;">\${statusText}</p>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:6px 0; color:#6B7280; width:80px;">教师姓名</td><td style="padding:6px 0; font-weight:500;">\${esc(slip.teacherName)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">请假类型</td><td style="padding:6px 0;">\${esc(slip.reason)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">开始时间</td><td style="padding:6px 0;">\${fmtDate(slip.startDate)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">结束时间</td><td style="padding:6px 0;">\${fmtDate(slip.endDate)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">提交时间</td><td style="padding:6px 0;">\${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}</td></tr>
          \${slip.principalName ? '<tr><td style="padding:6px 0; color:#6B7280;">审批校长</td><td style="padding:6px 0;">' + esc(slip.principalName) + '</td></tr>' : ''}
          \${slip.principalSignedAt ? '<tr><td style="padding:6px 0; color:#6B7280;">审批时间</td><td style="padding:6px 0;">' + new Date(slip.principalSignedAt).toLocaleString('zh-CN',{hour12:false}) + '</td></tr>' : ''}
        </table>
        \${slip.teacherSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">教师签字：</p><img src="' + slip.teacherSignature + '" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
        \${slip.principalSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">校长签字：</p><img src="' + slip.principalSignature + '" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
        \${slip.leaveIds && slip.leaveIds.length > 0 ? '<p style="color:#9CA3AF; font-size:12px; margin:12px 0 0;">关联请假记录 ' + slip.leaveIds.length + ' 条</p>' : ''}
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="showSlipPrintModal('\${slipId}')" style="padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">🖨️ 打印请假条</button>
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer;">关闭</button>
      </div>
    </div>
  \`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

// 打印请假条（打印预览弹窗）
function showSlipPrintModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) { toast('未找到该请假条', 'error'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:999999; display:flex; align-items:center; justify-content:center; padding:16px;';
  const bg = slip.status === 'approved' ? '#F0FDF4' : slip.status === 'pending' ? '#FFFBEB' : '#FEF2F2';
  const stamp = slip.status === 'approved' ? '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:48px; color:rgba(220,38,38,0.18); font-weight:900; pointer-events:none;">已批准</div>' : slip.status === 'pending' ? '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:48px; color:rgba(217,119,6,0.18); font-weight:900; pointer-events:none;">待审批</div>' : '';
  modal.innerHTML = \`
    <div style="background:#fff; border-radius:12px; max-width:580px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3); max-height:90vh; overflow-y:auto;">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px;">🖨️ 请假条预览</h3>
        <div style="display:flex; gap:8px;">
          <button onclick="printSlipContent('\${slipId}')" style="padding:6px 14px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:13px;">立即打印</button>
          <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
        </div>
      </div>
      <div id="slip-print-area" style="padding:32px; background:\${bg}; position:relative; min-height:400px;">
        \${stamp}
        <div style="text-align:center; margin-bottom:20px;">
          <div style="font-size:20px; font-weight:700; letter-spacing:4px;">请假条</div>
          <div style="font-size:12px; color:#6B7280; margin-top:4px;">施秉县双井镇中心小学</div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:14px; background:#fff;">
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB; width:80px;">请假教师</td><td style="border:1px solid #333; padding:8px 10px;">\${esc(slip.teacherName)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB;">请假类型</td><td style="border:1px solid #333; padding:8px 10px;">\${esc(slip.reason)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB;">开始时间</td><td style="border:1px solid #333; padding:8px 10px;">\${fmtDate(slip.startDate)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB;">结束时间</td><td style="border:1px solid #333; padding:8px 10px;">\${fmtDate(slip.endDate)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB;">请假天数</td><td style="border:1px solid #333; padding:8px 10px;">1天</td></tr>
          <tr>
            <td style="border:1px solid #333; padding:8px 10px; background:#F9FAFB; vertical-align:top;">请假事由</td>
            <td style="border:1px solid #333; padding:8px 10px; height:60px;">\${esc(slip.reason)}</td>
          </tr>
        </table>
        <div style="margin-top:20px; display:flex; gap:20px; align-items:flex-end; flex-wrap:wrap;">
          \${slip.teacherSignature ? '<div style="text-align:center;"><img src="' + slip.teacherSignature + '" style="border-bottom:1px solid #333; width:120px; height:60px; object-fit:contain;"/><div style="font-size:12px; color:#6B7280; margin-top:2px;">教师签字</div></div>' : '<div style="text-align:center;"><div style="border-bottom:1px solid #333; width:120px; height:60px;"></div><div style="font-size:12px; color:#6B7280; margin-top:2px;">教师签字</div></div>'}
          <div style="flex:1;"></div>
          \${slip.principalSignature ? '<div style="text-align:center;"><img src="' + slip.principalSignature + '" style="border-bottom:1px solid #333; width:120px; height:60px; object-fit:contain;"/><div style="font-size:12px; color:#6B7280; margin-top:2px;">校长签字</div></div>' : '<div style="text-align:center;"><div style="border-bottom:1px solid #333; width:120px; height:60px;"></div><div style="font-size:12px; color:#6B7280; margin-top:2px;">校长签字</div></div>'}
        </div>
        <div style="margin-top:16px; font-size:12px; color:#9CA3AF; text-align:right;">
          提交时间：\${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}
        </div>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:center;">
        <button onclick="printSlipContent('\${slipId}')" style="padding:10px 32px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:15px; font-weight:600;">🖨️ 打印</button>
      </div>
    </div>
  \`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

// 触发浏览器打印（只打请假条区域）
function printSlipContent(slipId) {
  const area = document.getElementById('slip-print-area');
  if (!area) return;
  const printWindow = window.open('', '_blank', 'width=700,height=900');
  printWindow.document.write(\`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>请假条</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:"SimSun","宋体",serif; padding:20px; }
      #area { padding:20px; }
      table { width:100%; border-collapse:collapse; }
      td { border:1px solid #333; padding:8px 10px; font-size:14px; }
      img { max-width:120px; }
      @media print { body { padding:0; } }
    </style>
    </head><body><div id="area">\${area.innerHTML}</div></body></html>
  \`);
  printWindow.document.close();
  printWindow.onload = () => { printWindow.focus(); printWindow.print(); };
}
`);
console.log('4. renderSlipPage + showSlipDetailModal + showSlipPrintModal OK');

writeFileSync(path, lines.join('\n'), 'utf8');
console.log('\nAll done!');
