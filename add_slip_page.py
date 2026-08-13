# -*- coding: utf-8 -*-
import re

with open('app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def li(needle):
    for i, l in enumerate(lines):
        if needle in l:
            return i
    print('NOT FOUND:', needle)
    exit(1)

# 1. pageTitles: 加 slip 条目
s = li("settings: '通知设置'")
lines.insert(s, "    slip: '请假条管理',\n")
print('1. pageTitles OK')

# 2. 侧边栏管理员区
s = li("onclick=\"switchPage('import')\">📤 导入课表</button>")
lines.insert(s+1, "          <button class=\"nav-btn\" data-page=\"slip\" onclick=\"switchPage('slip')\">📄 请假条管理</button>\n")
print('2. Sidebar OK')

# 3. switchPage 分支
s = li("else if (page === 'settings') renderSettingsPage(area);")
lines.insert(s, "  else if (page === 'slip')    renderSlipPage(area);\n")
print('3. switchPage OK')

# 4. 在 renderSubPage 末尾 return 之后插入 renderSlipPage 函数
s = li("return json({ success: true });") + 1
injected = r"""
// ══════════════════════════════════════════════════════
//  请假条管理页（管理员）
// ══════════════════════════════════════════════════════
async function renderSlipPage(area) {
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('请假条管理')}
    <h2 class="page-title">📄 请假条管理</h2>
    <p class="text-muted" style="margin:0 0 12px;">事假/病假请假条永久存档，支持查看和打印导出。</p>
    <div id="slip-admin-list"></div>
  </div>`;
  await loadSlipAdminList();
}

async function loadSlipAdminList() {
  const el = $('slip-admin-list');
  if (!el) return;
  el.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:20px;">加载中…</p>';
  try {
    const r = await fetch('/api/leave-slips', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } });
    const j = await r.json();
    if (!j.success) { el.innerHTML = '<p style="color:#DC2626; text-align:center;">加载失败</p>'; return; }
    const slips = (j.data || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (slips.length === 0) { el.innerHTML = '<p class="text-muted" style="text-align:center;">暂无请假条</p>'; return; }
    el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>教师</th><th>假别</th><th>请假时间</th><th>审批状态</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>
          ${slips.map(s => `
          <tr>
            <td>${esc(s.teacherName)}</td>
            <td>${esc(s.reason)}</td>
            <td>${fmtDate(s.startDate)}${s.startDate !== s.endDate ? ' ~ ' + fmtDate(s.endDate) : ''}</td>
            <td><span class="badge badge-${s.status==='approved'?'green':s.status==='pending'?'yellow':'red'}">${s.status==='approved'?'✅ 同意':s.status==='pending'?'⏳ 待批':'❌ 拒绝'}</span></td>
            <td>${new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
            <td><button class="btn btn-sm" onclick="showSlipDetailModal('${s.id}')">📋 查看</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch (err) { el.innerHTML = '<p style="color:#DC2626; text-align:center;">网络错误</p>'; }
}

async function showSlipDetailModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) { toast('未找到该请假条','error'); return; }
  const statusColor = slip.status==='approved'?'#16A34A':slip.status==='pending'?'#D97706':'#DC2626';
  const statusText = slip.status==='approved'?'✅ 同意':slip.status==='pending'?'⏳ 待审批':'❌ 已拒绝';
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px;">📋 请假条详情</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px;">
        <p style="text-align:center; color:${statusColor}; font-weight:600; margin:0 0 16px;">${statusText}</p>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:6px 0; color:#6B7280; width:80px;">教师姓名</td><td style="padding:6px 0; font-weight:500;">${esc(slip.teacherName)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">请假类型</td><td style="padding:6px 0;">${esc(slip.reason)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">开始时间</td><td style="padding:6px 0;">${fmtDate(slip.startDate)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">结束时间</td><td style="padding:6px 0;">${fmtDate(slip.endDate)}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">提交时间</td><td style="padding:6px 0;">${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}</td></tr>
          ${slip.principalName ? '<tr><td style="padding:6px 0; color:#6B7280;">审批校长</td><td style="padding:6px 0;">'+esc(slip.principalName)+'</td></tr>' : ''}
          ${slip.principalSignedAt ? '<tr><td style="padding:6px 0; color:#6B7280;">审批时间</td><td style="padding:6px 0;">'+new Date(slip.principalSignedAt).toLocaleString('zh-CN',{hour12:false})+'</td></tr>' : ''}
        </table>
        ${slip.teacherSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">教师签字：</p><img src="'+slip.teacherSignature+'" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
        ${slip.principalSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">校长签字：</p><img src="'+slip.principalSignature+'" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="showSlipPrintModal('${slipId}')" style="padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">🖨️ 打印请假条</button>
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer;">关闭</button>
      </div>
    </div>`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

function showSlipPrintModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) { toast('未找到该请假条','error'); return; }
  const bg = slip.status==='approved'?'#F0FDF4':slip.status==='pending'?'#FFFBEB':'#FEF2F2';
  const stampEl = slip.status==='approved' ? '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-25deg); font-size:52px; color:rgba(220,38,38,0.12); font-weight:900; pointer-events:none; white-space:nowrap;">已批准</div>' : slip.status==='pending' ? '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-25deg); font-size:52px; color:rgba(217,119,6,0.12); font-weight:900; pointer-events:none; white-space:nowrap;">待审批</div>' : '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-25deg); font-size:52px; color:rgba(220,38,38,0.12); font-weight:900; pointer-events:none; white-space:nowrap;">已拒绝</div>';
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:999999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:600px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3); max-height:90vh; overflow-y:auto;">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px;">🖨️ 请假条预览</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div id="slip-print-area" style="padding:28px; background:${bg}; position:relative;">
        ${stampEl}
        <div style="text-align:center; margin-bottom:16px;">
          <div style="font-size:22px; font-weight:700; letter-spacing:4px;">请假条</div>
          <div style="font-size:13px; color:#6B7280; margin-top:4px;">施秉县双井镇中心小学</div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:14px; background:#fff;">
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6; width:85px;">请假教师</td><td style="border:1px solid #333; padding:8px 10px;">${esc(slip.teacherName)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6;">请假类型</td><td style="border:1px solid #333; padding:8px 10px;">${esc(slip.reason)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6;">开始时间</td><td style="border:1px solid #333; padding:8px 10px;">${fmtDate(slip.startDate)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6;">结束时间</td><td style="border:1px solid #333; padding:8px 10px;">${fmtDate(slip.endDate)}</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6;">请假天数</td><td style="border:1px solid #333; padding:8px 10px;">1天</td></tr>
          <tr><td style="border:1px solid #333; padding:8px 10px; background:#F3F4F6; vertical-align:top;">请假事由</td><td style="border:1px solid #333; padding:8px 10px; height:56px;">${esc(slip.reason)}</td></tr>
        </table>
        <div style="margin-top:16px; display:flex; gap:24px; align-items:flex-end;">
          <div style="text-align:center;">
            ${slip.teacherSignature ? '<img src="'+slip.teacherSignature+'" style="border-bottom:1px solid #333; width:110px; height:52px; object-fit:contain; display:block;"/>' : '<div style="border-bottom:1px solid #333; width:110px; height:52px;"></div>'}
            <div style="font-size:12px; color:#6B7280; margin-top:2px;">教师签字</div>
          </div>
          <div style="flex:1;"></div>
          <div style="text-align:center;">
            ${slip.principalSignature ? '<img src="'+slip.principalSignature+'" style="border-bottom:1px solid #333; width:110px; height:52px; object-fit:contain; display:block;"/>' : '<div style="border-bottom:1px solid #333; width:110px; height:52px;"></div>'}
            <div style="font-size:12px; color:#6B7280; margin-top:2px;">校长签字</div>
          </div>
        </div>
        <div style="margin-top:12px; font-size:11px; color:#9CA3AF; text-align:right;">
          提交时间：${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}
        </div>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:center;">
        <button onclick="printSlipContent()" style="padding:10px 36px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:15px; font-weight:600;">🖨️ 打印</button>
      </div>
    </div>`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

function printSlipContent() {
  const area = document.getElementById('slip-print-area');
  if (!area) return;
  const html = area.innerHTML;
  const w = window.open('', '_blank', 'width=680,height=800');
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>请假条</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"SimSun","宋体",serif;padding:24px;}table{width:100%;border-collapse:collapse;}td{border:1px solid #333;padding:8px 10px;font-size:14px;}img{max-width:110px;}</style></head><body>' + html + '</body></html>');
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}
"""

lines.insert(s, injected + '\n')
print('4. renderSlipPage injected OK')

with open('app.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print('\nAll done!')
