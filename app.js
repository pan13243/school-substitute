/**
 * school-substitute 代课调课系统 - 前端
 * 角色：管理员（需密码）/ 教师
 * 数据：课表、请假、代课安排
 */

// ══════════════════════════════════════════════════════
//  全局状态
// ══════════════════════════════════════════════════════
let isAdmin   = false;
let adminPwd   = '';
let currentPage = 'login';
let scheduleData = null;   // { timetable, teacherAssignment, allTeachers, classes }
let leaveRecords = [];
let slipRecords = []; // 请假条（校长签字审批）
let isSubmittingLeave = false;  // 提交请假全局锁
// 需校长审批的假别（事假/病假 → 请假条+校长手写签字）
const PRINCIPAL_REVIEW_TYPES = ['事假', '病假'];
const PRINCIPAL_PWD = 'principal888'; // 校长审批密码（与后端一致）
let substituteRecords = [];

// ══════════════════════════════════════════════════════
//  工具函数
// ══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s; return d.innerHTML; };

function toast(msg, type='info') {
  const colors = { success:'#10B981', error:'#EF4444', info:'#6366F1', warning:'#F59E0B' };
  const old = $('toast'); if(old) old.remove();
  const t = document.createElement('div'); t.id='toast';
  Object.assign(t.style, { position:'fixed', top:'20px', right:'20px', padding:'10px 20px',
    background: colors[type]||colors.info, color:'#fff', borderRadius:'6px', fontSize:'14px',
    zIndex:99999, boxShadow:'0 4px 12px rgba(0,0,0,.2)', maxWidth:'320px' });
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3200);
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function now() {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
}

function p2(n) { return String(n).padStart(2,'0'); }
function wday(d) { return ['周日','周一','周二','周三','周四','周五','周六'][new Date(d).getDay()]; }
function wdayCn(d) { return wday(d).replace('周',''); }
// 转换为完整形式'星期一'以匹配系统数据
function wdayFull(d) { const map = {'周日':'星期日','周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六'}; return map[wday(d)] || wday(d); }

// 从时间段获取节次（用于课后服务）
const AFTER_SCHOOL_PERIOD_MAP = {
  '13:00': 11, '13：00': 11,
  '14:40': 7, '14：40': 7,  // 周五课后服务
  '15:40': 7, '15：40': 7,
  '16:25': 8, '16：25': 8,
  '17:10': 9, '17：10': 9,
  '19:30': 10, '19：30': 10
};
function getPeriod(timeRange) {
  if (!timeRange) return 0;
  const m = String(timeRange).match(/(\d{1,2})[:：]\d{2}/);
  if (m) {
    const key = m[0];
    return AFTER_SCHOOL_PERIOD_MAP[key] || 0;
  }
  return 0;
}

// 手机端返回栏（每个页面顶部显示）
function mobileBackBar(title) {
  if (currentPage === 'home' || currentPage === 'login') return '';
  return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid #E5E7EB;">
    <button onclick="switchPage('home')" style="background:#EFF6FF; border:none; border-radius:6px; color:#3B82F6; font-size:13px; font-weight:500; cursor:pointer; padding:6px 12px; display:flex; align-items:center; gap:4px;">← 返回首页</button>
    <span style="font-size:15px; font-weight:600; color:#374151;">${title}</span>
  </div>`;
}

// 教师隐私密码管理（后端存储）
// 缓存密码状态
let teacherPwdCache = {};

// 获取教师隐私密码状态
async function getTeacherPrivacyPwdStatus(teacherName) {
  try {
    const r = await fetch(`/api/teacher/pwd?teacher=${encodeURIComponent(teacherName)}`);
    const data = await r.json();
    if (data.success) {
      teacherPwdCache[teacherName] = data.hasPassword;
      return data.hasPassword;
    }
  } catch (e) {}
  return teacherPwdCache[teacherName] || false;
}

// 检查教师是否设置了隐私密码
async function hasTeacherPrivacyPwd(teacherName) {
  return await getTeacherPrivacyPwdStatus(teacherName);
}

// 验证教师隐私密码（通过后端验证）
async function verifyTeacherPrivacyPwd(teacherName, inputPwd) {
  try {
    const r = await fetch('/api/teacher/pwd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherName, password: inputPwd })
    });
    const data = await r.json();
    return data.success;
  } catch (e) {
    return false;
  }
}

// 设置教师隐私密码
async function setTeacherPrivacyPwd(teacherName, newPwd, oldPwd = '') {
  try {
    const r = await fetch('/api/teacher/pwd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacherName, password: newPwd, oldPassword: oldPwd })
    });
    const data = await r.json();
    if (data.success) {
      teacherPwdCache[teacherName] = data.hasPassword;
    }
    return data;
  } catch (e) {
    return { success: false, error: '网络错误' };
  }
}

// 管理员重置教师隐私密码
async function resetTeacherPrivacyPwd(teacherName) {
  try {
    const r = await fetch('/api/teacher/pwd', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
      body: JSON.stringify({ teacherName })
    });
    return await r.json();
  } catch (e) {
    return { success: false, error: '网络错误' };
  }
}

// 获取所有设置了隐私密码的教师（管理员用）
async function getTeachersWithPrivacyPwd() {
  try {
    const r = await fetch('/api/teacher/pwd', {
      headers: { 'x-admin-pwd': adminPwd }
    });
    return await r.json();
  } catch (e) {
    return { success: false, teachersWithPassword: [] };
  }
}

// 显示隐私密码验证弹窗
async function showPrivacyVerifyModal(teacherName, onSuccess, title) {
  // 检查是否设置了密码
  const hasPwd = await hasTeacherPrivacyPwd(teacherName);
  if (!hasPwd) {
    onSuccess();
    return;
  }
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:360px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:20px; border-bottom:1px solid #E5E7EB;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">🔒 隐私验证</h3>
        <p style="margin:8px 0 0; color:#6B7280; font-size:13px;">查看${title}需要验证密码</p>
      </div>
      <div style="padding:20px;">
        <input type="password" id="privacy-pwd-input" class="form-input" placeholder="请输入您的隐私密码" 
               style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;"
               onkeydown="if(event.key==='Enter')document.getElementById('privacy-verify-btn').click()">
        <p style="margin:8px 0 0; color:#9CA3AF; font-size:12px;">忘记密码请联系管理员重置</p>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#F3F4F6; color:#374151; border:none; border-radius:6px; cursor:pointer;">取消</button>
        <button id="privacy-verify-btn" style="padding:8px 16px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer;">确认</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
  
  // 聚焦输入框
  setTimeout(() => $('privacy-pwd-input')?.focus(), 100);
  
  // 绑定确认按钮
  $('privacy-verify-btn').onclick = async () => {
    const inputPwd = $('privacy-pwd-input').value.trim();
    const verified = await verifyTeacherPrivacyPwd(teacherName, inputPwd);
    if (verified) {
      modal.remove();
      onSuccess();
    } else {
      toast('密码错误', 'error');
    }
  };
}

// 显示设置隐私密码弹窗
async function showSetPrivacyPwdModal() {
  const currentTeacher = sessionStorage.getItem('teacherName');
  if (!currentTeacher) return;
  
  const hasPwd = await hasTeacherPrivacyPwd(currentTeacher);
  
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:360px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:20px; border-bottom:1px solid #E5E7EB;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">🔐 隐私密码设置</h3>
        <p style="margin:8px 0 0; color:#6B7280; font-size:13px;">${hasPwd ? '修改或取消隐私密码' : '设置隐私密码后，查看请假记录和代课记录需要验证'}</p>
      </div>
      <div style="padding:20px;">
        ${hasPwd ? `<div style="margin-bottom:12px;"><input type="password" id="privacy-old-pwd" class="form-input" placeholder="原密码（不修改请留空）" style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;"></div>` : ''}
        <div style="margin-bottom:12px;"><input type="password" id="privacy-new-pwd" class="form-input" placeholder="新密码（留空则取消密码）" style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;"></div>
        <input type="password" id="privacy-confirm-pwd" class="form-input" placeholder="确认新密码" style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;">
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#F3F4F6; color:#374151; border:none; border-radius:6px; cursor:pointer;">取消</button>
        <button id="privacy-save-btn" style="padding:8px 16px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer;">保存</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
  
  // 绑定保存按钮
  $('privacy-save-btn').onclick = async () => {
    const oldPwd = $('privacy-old-pwd')?.value.trim() || '';
    const newPwd = $('privacy-new-pwd').value.trim();
    const confirmPwd = $('privacy-confirm-pwd').value.trim();
    
    // 验证新密码
    if (newPwd && newPwd !== confirmPwd) {
      toast('两次输入的新密码不一致', 'error');
      return;
    }
    
    // 保存密码
    const result = await setTeacherPrivacyPwd(currentTeacher, newPwd, oldPwd);
    if (result.success) {
      modal.remove();
      toast(result.message, 'success');
    } else {
      toast(result.error || '保存失败', 'error');
    }
  };
}

// 教师端：显示自己的请假记录（只读弹窗）
async function showMyLeaves() {
  const currentTeacher = sessionStorage.getItem('teacherName');
  if (!currentTeacher) return;
  
  await showPrivacyVerifyModal(currentTeacher, () => {
    const myLeaves = leaveRecords.filter(l => l.teacherName === currentTeacher);
    
    const content = myLeaves.length === 0 ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无请假记录</p>' :
      `<table class="data-table"><thead><tr><th>日期</th><th>星期</th><th>节次</th><th>假别</th><th>原因</th><th>状态</th></tr></thead><tbody>` +
      myLeaves.map(l => {
        const st = l.status==='approved' ? '✅已批准' : (l.status==='pending_principal' ? '⏳待校长签字' : (l.status==='rejected' ? '❌已拒绝' : '⏳待审批'));
        return `<tr><td>${fmtDate(l.leaveDate)}</td><td>${esc(l.dayOfWeek)}</td><td>${l.period ? '第'+l.period+'节' : '全天'}</td><td>${esc(l.leaveType||'—')}</td><td>${esc(l.reason||'—')}</td><td>${st}</td></tr>`;
      }).join('') +
      `</tbody></table>`;
    
    showModal('我的请假记录', content);
  }, '请假记录');
}

// 教师端：显示自己的代课记录（只读弹窗）
async function showMySubstitutes() {
  const currentTeacher = sessionStorage.getItem('teacherName');
  if (!currentTeacher) return;
  
  await showPrivacyVerifyModal(currentTeacher, () => {
    // 我请假的由别人代课，或我帮别人代课
    const mySubstitutes = substituteRecords.filter(s => 
      s.leaveTeacher === currentTeacher || s.substituteTeacher === currentTeacher
    );
    
    const content = mySubstitutes.length === 0 ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无代课记录</p>' :
      `<table class="data-table"><thead><tr><th>类型</th><th>日期</th><th>班级</th><th>科目</th><th>节次</th><th>对方教师</th></tr></thead><tbody>` +
      mySubstitutes.map(s => {
        const isMyLeave = s.leaveTeacher === currentTeacher;
        const type = isMyLeave ? '<span style="color:#F59E0B;">被代课</span>' : '<span style="color:#10B981;">代他人</span>';
        const otherTeacher = isMyLeave ? s.substituteTeacher : s.leaveTeacher;
        return `<tr><td>${type}</td><td>${fmtDate(s.leaveDate)}</td><td>${esc(s.className)}</td><td>${esc(s.subject||'—')}</td><td>第${s.period}节</td><td>${esc(otherTeacher||'—')}</td></tr>`;
      }).join('') +
      `</tbody></table>`;
    
    showModal('我的代课记录', content);
  }, '代课记录');
}

// 通用弹窗
function showModal(title, content) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:500px; width:100%; max-height:80vh; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">${title}</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px; overflow-y:auto; max-height:60vh;">${content}</div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer;">关闭</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

// ══════════════════════════════════════════════════════
//  请假条 + 手写签字板（Canvas）
// ══════════════════════════════════════════════════════

// 初始化一个手写签字板，返回 { getDataUrl, clear, isEmpty }
function initSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  // 高分辨率适配：按 CSS 尺寸设置实际像素，保证签字清晰
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1F2937';
  
  let drawing = false;
  let hasInk = false;
  let lastX = 0, lastY = 0;
  
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  
  function start(e) {
    e.preventDefault();
    const p = getPos(e);
    drawing = true;
    hasInk = true;
    lastX = p.x; lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x; lastY = p.y;
  }
  function stop() { drawing = false; }
  
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', stop);
  
  return {
    getDataUrl: () => hasInk ? canvas.toDataURL('image/png') : '',
    clear: () => {
      ctx.setTransform(1, 0, 0, 1, 1, 1);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      hasInk = false;
    },
    isEmpty: () => !hasInk
  };
}

// 教师提交请假条弹窗（事假/病假）
function showLeaveSlipModal({ leaveIds, teacherName, reason, startDate, endDate }) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:88vh; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">📄 请假条（事假/病假需校长审批）</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px; overflow-y:auto; max-height:70vh;">
        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group" style="grid-column:1/-1">
            <label>教师姓名</label>
            <input type="text" id="slip-teacher" value="${esc(teacherName)}" readonly class="form-input" style="background:#F3F4F6;">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>请假事由 *</label>
            <input type="text" id="slip-reason" value="${esc(reason||'')}" class="form-input" placeholder="请填写请假事由">
          </div>
          <div class="form-group">
            <label>开始日期 *</label>
            <input type="date" id="slip-start" value="${esc(startDate||'')}" class="form-input">
          </div>
          <div class="form-group">
            <label>结束日期 *</label>
            <input type="date" id="slip-end" value="${esc(endDate||'')}" class="form-input">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>本人签字 *（请用鼠标/手指在框内签名）</label>
            <div style="border:2px dashed #CBD5E1; border-radius:8px; overflow:hidden; background:#FAFAFA;">
              <canvas id="slip-canvas" style="width:100%; height:140px; display:block; touch-action:none; cursor:crosshair;"></canvas>
            </div>
            <button type="button" id="slip-clear" class="btn btn-sm" style="margin-top:8px;">✖ 清空重签</button>
          </div>
        </div>
        <p id="slip-msg" style="color:#DC2626; font-size:13px; min-height:18px; margin:8px 0 0;"></p>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer; margin-right:8px;">暂不提交</button>
        <button id="slip-submit" style="padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">✍️ 提交请假条</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
  
  const canvas = modal.querySelector('#slip-canvas');
  const pad = initSignaturePad(canvas);
  modal.querySelector('#slip-clear').onclick = () => pad.clear();
  
  modal.querySelector('#slip-submit').onclick = async () => {
    const reasonV = modal.querySelector('#slip-reason').value.trim();
    const startV = modal.querySelector('#slip-start').value;
    const endV = modal.querySelector('#slip-end').value;
    const sig = pad.getDataUrl();
    if (!reasonV) { modal.querySelector('#slip-msg').textContent = '请填写请假事由'; return; }
    if (!startV || !endV) { modal.querySelector('#slip-msg').textContent = '请选择开始和结束日期'; return; }
    if (pad.isEmpty()) { modal.querySelector('#slip-msg').textContent = '请先签名'; return; }
    const btn = modal.querySelector('#slip-submit');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await fetch('/api/leave-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaveIds, teacherName, reason: reasonV, startDate: startV, endDate: endV, signature: sig })
      });
      const j = await r.json();
      if (j.success) {
        modal.remove();
        toast('✅ 请假条已提交，等待校长审批', 'success');
      } else {
        modal.querySelector('#slip-msg').textContent = j.error || '提交失败';
        btn.disabled = false; btn.textContent = '✍️ 提交请假条';
      }
    } catch (err) {
      modal.querySelector('#slip-msg').textContent = '网络错误：' + (err.message || err);
      btn.disabled = false; btn.textContent = '✍️ 提交请假条';
    }
  };
}

function showAllTeachers() {
  const teas = scheduleData?.allTeachers || [];
  if (!teas.length) {
    toast('暂无教师数据', 'error');
    return;
  }
  const list = teas.map(t => `<span style="display:inline-block; padding:8px 16px; margin:4px; background:#F3F4F6; border-radius:20px; font-size:14px;">${t}</span>`).join('');
  showModal('👩‍🏫 教师名单 (' + teas.length + '人)', `<div style="line-height:2;">${list}</div>`);
}
// ══════════════════════════════════════════════════════

// 常用汉字拼音首字母映射
const PINYIN_FIRST_LETTERS = {
  '潘': 'P', '懂': 'D', '平': 'P', '龙': 'L', '燕': 'Y', '吴': 'W', '寿': 'S', '成': 'C',
  '建': 'J', '华': 'H', '罗': 'L', '顺': 'S', '芝': 'Z', '田': 'T', '如': 'R', '香': 'X',
  '张': 'Z', '书': 'S', '梅': 'M', '陈': 'C', '发': 'F', '国': 'G', '熊': 'X', '欢': 'H',
  '明': 'M', '盘': 'P', '春': 'C', '足': 'Z', '廖': 'L', '志': 'Z', '强': 'Q', '百': 'B',
  '达': 'D', '震': 'Z', '江': 'J', '玲': 'L', '佳': 'J', '腾': 'T', '姚': 'Y', '本': 'B',
  '军': 'J', '菊': 'J', '金': 'J', '祥': 'X', '帆': 'F', '向': 'X', '桃': 'T',
  '光': 'G', '辉': 'H', '邰': 'T', '昌': 'C', '礼': 'L', '何': 'H', '昭': 'Z', '能': 'N',
  '再': 'Z', '君': 'J', '俊': 'J', '文': 'W', '凯': 'K', '青': 'Q',
  '力': 'L', '芳': 'F', '杨': 'Y', '美': 'M', '孙': 'S', '焕': 'H', '英': 'Y',
  '王': 'W', '秀': 'X', '显': 'X', '贵': 'G', '妃': 'F', '管': 'G', '舒': 'S',
  '烨': 'Y', '宋': 'S', '宁': 'N', '子': 'Z', '珍': 'Z', '胜': 'S', '伦': 'L', '琴': 'Q',
  '杰': 'J', '晓': 'X', '肖': 'X', '小': 'X', '开': 'K', '忠': 'Z', '荣': 'R',
  '刘': 'L', '雷': 'L', '安': 'A', '元': 'Y', '唐': 'T',
  '欣': 'X', '时': 'S', '伟': 'W', '屈': 'Q', '俐': 'L', '伶': 'L', '泽': 'Z', '彦': 'Y',
  '胡': 'H', '跃': 'Y', '景': 'J', '方': 'F', '贤': 'X',
  '凌': 'L', '云': 'Y', '洪': 'H', '斌': 'B', '咏': 'Y', '范': 'F', '琳': 'L',
  '毅': 'Y', '帮': 'B', '鹏': 'P'
};

// 获取姓名的拼音首字母
function getPinyinInitials(name) {
  if (!name) return '';
  return name.split('').map(c => PINYIN_FIRST_LETTERS[c] || c).join('');
}

// 教师搜索数据缓存
let teacherSearchData = [];

// 初始化教师搜索
function initTeacherSearch(teachers) {
  teacherSearchData = teachers.map(t => ({
    name: t,
    pinyin: getPinyinInitials(t),
    pinyinLower: getPinyinInitials(t).toLowerCase()
  }));
  
  const input = $('teacher-search-input');
  const dropdown = $('teacher-search-dropdown');
  if (!input || !dropdown) return;
  
  // 输入事件
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query) {
      dropdown.style.display = 'none';
      return;
    }
    
    // 匹配：姓名包含 或 拼音首字母包含
    const matches = teacherSearchData.filter(t => 
      t.name.includes(query) || 
      t.pinyinLower.includes(query)
    ).slice(0, 10);
    
    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="search-no-result">无匹配结果</div>';
    } else {
      dropdown.innerHTML = matches.map(t => 
        `<div class="search-item" data-name="${esc(t.name)}" onclick="selectTeacher('${esc(t.name)}')">
          <span class="search-name">${esc(t.name)}</span>
          <span class="search-pinyin">${esc(t.pinyin)}</span>
        </div>`
      ).join('');
    }
    dropdown.style.display = 'block';
  });
  
  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.teacher-search-box')) {
      dropdown.style.display = 'none';
    }
  });
  
  // 键盘导航
  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-item');
    const active = dropdown.querySelector('.search-item.active');
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!active) {
        items[0]?.classList.add('active');
      } else {
        active.classList.remove('active');
        const next = active.nextElementSibling;
        if (next) next.classList.add('active');
        else items[0]?.classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!active) {
        items[items.length - 1]?.classList.add('active');
      } else {
        active.classList.remove('active');
        const prev = active.previousElementSibling;
        if (prev) prev.classList.add('active');
        else items[items.length - 1]?.classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active) {
        selectTeacher(active.dataset.name);
      } else if (items.length === 1) {
        selectTeacher(items[0].dataset.name);
      }
    }
  });
}

// 选择教师
function selectTeacher(name) {
  const input = $('teacher-search-input');
  const hidden = $('login-teacher-select');
  const dropdown = $('teacher-search-dropdown');
  
  if (input) input.value = name;
  if (hidden) hidden.value = name;
  if (dropdown) dropdown.style.display = 'none';
  
  // 自动登录
  handleTeacherLogin(name);
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${p2(dt.getMonth()+1)}-${p2(dt.getDate())}`;
}

// ══════════════════════════════════════════════════════
//  API 调用
// ══════════════════════════════════════════════════════
const API = {
  async getSchedule() {
    try {
      const r = await fetch('/api/schedule');
      return await r.json();
    } catch { return { success: false }; }
  },
  async importSchedule(payload) {
    const r = await fetch('/api/schedule', {
      method:'POST', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd},
      body: JSON.stringify(payload)
    });
    return await r.json();
  },
  async clearSchedule() {
    const r = await fetch('/api/schedule', {
      method:'DELETE', headers:{'x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async getLeaves() {
    try {
      const r = await fetch('/api/leaves');
      return await r.json();
    } catch { return { success:false, data:[] }; }
  },
  async addLeave(leave) {
    const r = await fetch('/api/leaves', {
      method:'POST', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd},
      body: JSON.stringify(leave)
    });
    return await r.json();
  },
  async deleteLeave(id) {
    const r = await fetch(`/api/leaves/${id}`, {
      method:'DELETE', headers:{'x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async clearLeaves() {
    const r = await fetch('/api/leaves', {
      method:'DELETE', headers:{'x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async getSubstitutes() {
    try {
      const r = await fetch('/api/substitutes');
      return await r.json();
    } catch { return { success:false, data:[] }; }
  },
  async getLeaveSlips() {
    try {
      // 教师端带姓名可看自己的请假条；管理员/校长看全部（校长页单独校验密码）
      const headers = {};
      const myName = sessionStorage.getItem('teacherName') || '';
      if (myName && !isAdmin) headers['x-teacher-name'] = myName;
      const r = await fetch('/api/leave-slips', { headers });
      return await r.json();
    } catch { return { success:false, data:[] }; }
  },
  async generateSubstitutes() {
    const r = await fetch('/api/substitutes/generate', {
      method:'POST', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async clearSubstitutes() {
    const r = await fetch('/api/substitutes', {
      method:'DELETE', headers:{'x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async saveSubstitutes(data) {
    const r = await fetch('/api/substitutes/save', {
      method:'POST', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd},
      body: JSON.stringify({ data })
    });
    return await r.json();
  },
};

// ══════════════════════════════════════════════════════
//  登录页
// ══════════════════════════════════════════════════════
function renderLogin() {
  return `
  <div class="login-bg">
    <div class="login-card">
      <div class="login-icon">🏫</div>
      <h1>代课调课系统</h1>
      <p class="login-subtitle">施秉县双井镇中心小学</p>
      <div class="login-tabs">
        <button class="tab-btn active" onclick="setLoginMode('teacher')">教师入口</button>
        <button class="tab-btn" onclick="setLoginMode('admin')">管理员入口</button>
      </div>
      <div id="login-form-area">
        <div id="teacher-login">
          <p class="login-hint">请选择您的姓名（支持拼音首字母搜索）</p>
          <div class="teacher-search-box">
            <input type="text" id="teacher-search-input" class="form-input" placeholder="输入拼音首字母或姓名搜索..." autocomplete="off">
            <div id="teacher-search-dropdown" class="search-dropdown" style="display:none;"></div>
          </div>
          <input type="hidden" id="login-teacher-select" value="">
        </div>
        <div id="admin-login" style="display:none">
          <p class="login-hint">请输入管理员密码</p>
          <input type="password" id="login-pwd" class="form-input" placeholder="输入管理员密码"
                 onkeydown="if(event.key==='Enter')handleAdminLogin()">
          <button class="btn btn-primary btn-block" onclick="handleAdminLogin()">登录</button>
        </div>
      </div>
    </div>
  </div>`;
}

let loginMode = 'teacher';

function setLoginMode(mode) {
  loginMode = mode;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  $('teacher-login').style.display = mode === 'teacher' ? 'block' : 'none';
  $('admin-login').style.display  = mode === 'admin'  ? 'block' : 'none';
  if (mode === 'teacher') loadTeacherList();
}

function handleTeacherLogin(teacherName) {
  if (!teacherName) return;
  isAdmin = false;
  sessionStorage.setItem('role','teacher');
  sessionStorage.setItem('teacherName', teacherName);
  currentPage = 'home';
  initApp();
}

function handleAdminLogin() {
  const pwd = $('login-pwd').value.trim();
  if (!pwd) return toast('请输入密码','warning');
  // 验证管理员密码
  if (pwd !== 'admin888') {
    return toast('密码错误，请重新输入','error');
  }
  adminPwd = pwd;
  isAdmin = true;
  sessionStorage.setItem('role','admin');
  sessionStorage.setItem('adminPwd', pwd);
  currentPage = 'home';
  toast('管理员登录成功','success');
  initApp();
}

async function loadTeacherList() {
  // 优先从 localStorage 缓存加载教师列表
  let teachers = [];
  const cached = localStorage.getItem('teachers_cache');
  if (cached) {
    teachers = JSON.parse(cached);
  } else {
    const { data } = await API.getSchedule();
    if (data && data.allTeachers) {
      teachers = data.allTeachers;
      localStorage.setItem('teachers_cache', JSON.stringify(teachers));
    } else {
      // 从parsed_data.json直接加载
      try {
        const r = await fetch('parsed_data.json');
        const pd = await r.json();
        if (pd.allTeachers) {
          teachers = pd.allTeachers;
          localStorage.setItem('teachers_cache', JSON.stringify(teachers));
        }
      } catch {}
    }
  }
  
  // 初始化拼音搜索
  if (teachers.length > 0) {
    initTeacherSearch(teachers);
  }
}

// ══════════════════════════════════════════════════════
//  主界面布局
// ══════════════════════════════════════════════════════
function renderAppShell() {
  const role = isAdmin ? 'admin' : 'teacher';
  const roleLabel = isAdmin ? '🔐 管理员' : '👤 教师';
  // 计算待处理请假数量（已批准但未安排代课的）
  const pendingSubs = leaveRecords.filter(l => l.status === 'approved').length;
  const subBadge = (isAdmin && pendingSubs > 0) ? `<span class="nav-badge">${pendingSubs}</span>` : '';
  // 待校长审批的请假条数量
  const pendingSlips = (slipRecords || []).filter(s => s.status === 'pending').length;
  const principalBadge = pendingSlips > 0 ? `<span class="nav-badge" style="background:#F59E0B;">${pendingSlips}</span>` : '';
  // 手机端页面标题映射
  const pageTitles = {
    home: '系统概览',
    tt: '课表查询',
    leave: '请假登记',
    sub: '代课记录',
    principal: '校长审批',
    import: '导入课表',
    settings: '通知设置'
  };
  const currentTitle = pageTitles[currentPage] || '代课调课系统';
  const showBackBtn = currentPage !== 'home';
  return `
  <div class="app-shell">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <span class="topbar-icon">🏫</span>
        <span class="topbar-title">施秉县双井镇中心小学</span>
        <span class="topbar-sub">代课调课系统</span>
      </div>
      <div class="topbar-right">
        <span class="role-badge ${role}">${roleLabel}</span>
        ${isAdmin ? `<span class="admin-hint">管理密码已验证</span>` : ''}
        <button class="btn btn-sm" onclick="handleLogout()">退出</button>
      </div>
    </header>

    <!-- 手机端顶部导航栏 (内联样式确保生效) -->
    <div class="mobile-header" style="display:none; align-items:center; justify-content:space-between; padding:12px 16px; background:#fff; border-bottom:1px solid #E5E7EB; position:sticky; top:0; z-index:100;">
      ${showBackBtn ? `<button onclick="switchPage('home')" style="background:none; border:none; color:#3B82F6; font-size:14px; font-weight:500; cursor:pointer; padding:4px 8px;">← 返回</button>` : '<span></span>'}
      <span style="font-size:16px; font-weight:600; color:#111827; flex:1; text-align:center;">${currentTitle}</span>
      <span style="width:60px;"></span>
    </div>

    <div class="app-body">
      <!-- 侧边栏 -->
      <nav class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-section-title">📋 功能菜单</div>
          <button class="nav-btn" data-page="home"    onclick="switchPage('home')">🏠 首页</button>
          <button class="nav-btn" data-page="tt"      onclick="switchPage('tt')">📅 课表查询</button>
          <button class="nav-btn" data-page="leave"   onclick="switchPage('leave')">🏖️ 请假登记</button>
          <button class="nav-btn" data-page="sub"     onclick="switchPage('sub')">✅ 代课记录${subBadge}</button>
          <button class="nav-btn" data-page="principal" onclick="switchPage('principal')">✍️ 校长审批${principalBadge}</button>
          ${isAdmin ? `
          <div class="sidebar-section-title" style="margin-top:16px">⚙️ 管理员</div>
          <button class="nav-btn" data-page="import"  onclick="switchPage('import')">📤 导入课表</button>
          <button class="nav-btn" data-page="settings" onclick="switchPage('settings')">🔔 通知设置</button>
          ` : ''}
        </div>
      </nav>

      <!-- 内容区 -->
      <main class="content" id="main-content"></main>
    </div>
  </div>`;
}

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-page="${page}"]`);
  if (btn) btn.classList.add('active');
  const area = $('main-content');
  if (!area) return;
  if      (page === 'home')    renderHomePage(area);
  else if (page === 'tt')      renderTimetablePage(area);
  else if (page === 'leave')   renderLeavePage(area);
  else if (page === 'sub')     renderSubPage(area);
  else if (page === 'principal') renderPrincipalPage(area);
  else if (page === 'import')  renderImportPage(area);
  else if (page === 'settings') renderSettingsPage(area);
}

function handleLogout() {
  sessionStorage.removeItem('role');
  sessionStorage.removeItem('adminPwd');
  location.reload();
}

// ══════════════════════════════════════════════════════
//  首页
// ══════════════════════════════════════════════════════
function renderHomePage(area) {
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const cls = td.classes  || [];
  const teas = td.allTeachers || [];
  const pendingLeaves = leaveRecords.filter(l => isAdmin ? (l.status === 'pending') : (l.status !== 'approved'));
  const hasData = cls.length > 0;
  
  // 获取当前教师姓名（教师端）
  const currentTeacher = sessionStorage.getItem('teacherName') || '';
  
  // 教师端：只显示自己的请假和代课
  const myLeaves = currentTeacher ? leaveRecords.filter(l => l.teacherName === currentTeacher) : [];
  const mySubstitutes = currentTeacher ? substituteRecords.filter(s => s.leaveTeacher === currentTeacher || s.substituteTeacher === currentTeacher) : [];

  // 教师端显示欢迎语，管理员端显示系统概览
  const pageTitle = (!isAdmin && currentTeacher) 
    ? `👋 欢迎，${esc(currentTeacher)}老师` 
    : '📊 系统概览';
  
  area.innerHTML = `
  <div class="page">
    <h2 class="page-title">${pageTitle}</h2>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon">🏫</div>
        <div class="stat-num">${cls.length}</div>
        <div class="stat-label">班级</div>
      </div>
      <div class="stat-card" onclick="showAllTeachers()" style="cursor:pointer;">
        <div class="stat-icon">👩‍🏫</div>
        <div class="stat-num">${teas.length}</div>
        <div class="stat-label">教师</div>
      </div>
      ${isAdmin ? `
      <div class="stat-card">
        <div class="stat-icon">📚</div>
        <div class="stat-num">${cls.length * 30}</div>
        <div class="stat-label">周总课时</div>
      </div>` : ''}
      <div class="stat-card ${pendingLeaves.length > 0 && isAdmin ? 'stat-alert' : ''}" onclick="${isAdmin ? '' : 'showMyLeaves()'}" style="${isAdmin ? '' : 'cursor:pointer;'}">
        <div class="stat-icon">🏖️</div>
        <div class="stat-num">${isAdmin ? leaveRecords.length : myLeaves.length}</div>
        <div class="stat-label">请假记录</div>
      </div>
      <div class="stat-card" onclick="${isAdmin ? '' : 'showMySubstitutes()'}" style="${isAdmin ? '' : 'cursor:pointer;'}">
        <div class="stat-icon">✅</div>
        <div class="stat-num">${isAdmin ? substituteRecords.length : mySubstitutes.length}</div>
        <div class="stat-label">代课记录</div>
      </div>
    </div>

    ${!hasData && isAdmin ? `
    <div class="alert alert-warn">
      ⚠️ 课表未导入，请先<span onclick="switchPage('import')" class="link">导入课表</span>
    </div>` : ''}

    ${hasData ? `
    <div class="quick-actions">
      <button class="action-card" onclick="switchPage('leave')">
        <span class="action-icon">🏖️</span>
        <span class="action-label">请假登记</span>
      </button>
      ${isAdmin ? `
      <button class="action-card" onclick="switchPage('sub')">
        <span class="action-icon">✅</span>
        <span class="action-label">代课记录</span>
      </button>
      <button class="action-card" onclick="switchPage('import')">
        <span class="action-icon">📤</span>
        <span class="action-label">导入课表</span>
      </button>` : ''}
      <button class="action-card" onclick="switchPage('tt')">
        <span class="action-icon">📅</span>
        <span class="action-label">课表查询</span>
      </button>
      ${!isAdmin ? `
      <button class="action-card" onclick="showSetPrivacyPwdModal()">
        <span class="action-icon">🔐</span>
        <span class="action-label">隐私设置</span>
      </button>` : ''}
    </div>` : ''}

    ${pendingLeaves.length > 0 && isAdmin ? `
    <div class="section">
      <h3>⏳ 待处理请假 (${pendingLeaves.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th></tr></thead>
          <tbody>
            ${pendingLeaves.slice(0,5).map(l => `
            <tr>
              <td>${esc(l.teacherName)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${esc(l.dayOfWeek)}</td>
              <td>第${l.period}节</td>
              <td>${esc(l.reason||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    ${isAdmin ? `
    <div class="section">
      <h3>📋 请假历史 <span style="font-size:12px;color:#9CA3AF;">（所有已批准记录）</span></h3>
      ${(() => {
        const approvedLeaves = leaveRecords.filter(l => l.status === 'approved');
        if (approvedLeaves.length === 0) return '<p class="text-muted">暂无已批准的请假记录</p>';
        return `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>操作</th></tr></thead>
            <tbody>
              ${approvedLeaves.map(l => `
              <tr class="row-approved">
                <td>${esc(l.teacherName)}</td>
                <td>${fmtDate(l.leaveDate)}</td>
                <td>${esc(l.dayOfWeek)}</td>
                <td>${l.period ? '第'+l.period+'节' : '—'}</td>
                <td>${esc(l.reason||'—')}</td>
                <td><button class="btn btn-sm btn-danger" onclick="deleteLeave('${l.id}')">删除</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      })()}
    </div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════════════════
//  课表查询页
// ══════════════════════════════════════════════════════
function renderTimetablePage(area) {
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const cls = td.classes  || [];
  const myName = sessionStorage.getItem('teacherName') || '';

  // 切换视图：班级/教师
  const mySlots = [];
  if (myName && tt.星期一) {
    for (const [day, classMap] of Object.entries(tt)) {
      for (const [cn, slots] of Object.entries(classMap)) {
        for (const s of slots) {
          if (s.teacher === myName) mySlots.push({ day, className: cn, ...s });
        }
      }
    }
  }

  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('课表查询')}
    <h2 class="page-title">📅 课表查询</h2>

    <div class="view-toggle">
      <button class="tab-btn active" onclick="setTTView('class',this)">按班级查看</button>
      <button class="tab-btn" onclick="setTTView('my',this)" ${!myName?'disabled':''}>我的课表</button>
    </div>

    <div id="tt-class-view">
      <div class="form-row">
        <label>选择班级：</label>
        <select id="tt-class-sel" class="form-select" onchange="renderTTClass()">
          <option value="">— 选择班级 —</option>
          ${cls.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="tt-class-content"></div>
    </div>

    ${myName ? `
    <div id="tt-my-view" style="display:none">
      <h3>👤 ${esc(myName)} 老师的课表</h3>
      <div id="tt-my-content"></div>
    </div>` : ''}
  </div>`;
}

let ttView = 'class';

function setTTView(v, btn) {
  ttView = v;
  document.querySelectorAll('.view-toggle .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('tt-class-view').style.display  = v === 'class' ? 'block' : 'none';
  $('tt-my-view').style.display     = v === 'my'    ? 'block' : 'none';
  if (v === 'my') renderTTMy();
  else renderTTClass();
}

function renderTTClass() {
  const sel = $('tt-class-sel');
  const cn  = sel.value;
  const td  = scheduleData || {};
  const tt  = td.timetable || {};
  const afterschool = td.afterSchoolService || {};
  const area = $('tt-class-content');
  if (!cn) { area.innerHTML = '<p class="text-muted">请选择班级</p>'; return; }

  const days = ['星期一','星期二','星期三','星期四','星期五'];
  // 普通时间映射（周一~周四）
  const timeMap = {
    1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00',
    5:'14:00-14:40', 6:'14:50-15:30',
    7:'课后服务1', 8:'课后服务2', 9:'课后服务3',
    10:'晚自习', 11:'午休'
  };
  // 星期五特殊时间映射（下午不同）
  const fridayTimeMap = {
    1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00',
    5:'13:00-13:40', 6:'13:50-14:30',
    7:'14:40-15:20', 8:'15:25-16:50'
  };
  // 获取某天的节次时间
  const getTime = (day, p) => day === '星期五' ? (fridayTimeMap[p] || '—') : (timeMap[p] || '—');
  // 某天的课后服务最大节次（周五只到第8节社团活动，无 9-11节）
  const maxAfterSchoolPeriod = (day) => day === '星期五' ? 8 : 11;
  // 课后服务时间映射（周一~周四，课后服务时间一致）
  const afterSchoolTimeMap = { 7:'15:40-16:20', 8:'16:25-17:05', 9:'17:10-17:50', 10:'19:30-20:30', 11:'13:00-13:50' };
  // 星期五课后服务时间映射（只有两节）
  const fridayAfterSchoolTimeMap = { 7:'14:40-15:20', 8:'15:25-16:50' };
  // 课后服务时间：周五用 fridayAfterSchoolTimeMap，其余用 afterSchoolTimeMap
  const getAfterSchoolTime = (day, period) => day === '星期五' ? (fridayAfterSchoolTimeMap[period] || '—') : (afterSchoolTimeMap[period] || '—');

  // 获取课后服务的班级数据
  const normDay = (s) => {
    // 去除换行、空格、中文字符，只保留"星"+"期"+"数字"
    const cleaned = String(s || '').replace(/[\s\n\r]/g, '');
    const m = cleaned.match(/星\s*期\s*([一二三四五六日])/);
    if (!m) return cleaned;
    return '星期' + m[1];
  };
  // 归一化：去掉所有空白字符后比较（Excel单元格可能含全角空格/换行）
  const normD = (s) => String(s || '').replace(/[\s\n\r]/g, '');
  const getAfterSchoolSlot = (day, period) => {
    const slots = afterschool.slots || [];
    const target = normD(day);
    let found = slots.find(s => normD(s.day) === target && Number(s.period) === Number(period));
    // 只输出一次全部 slot 摘要
    if (!window._asDbgPrinted && slots.length) {
      window._asDbgPrinted = true;
      console.log('[DBG-all-slots]', JSON.stringify(slots.map(s => ({day:s.day, period:s.period, time:s.time}))));
    }
    return found;
  };

  // 获取课后服务教师（显示单周/双周）
  const getAfterSchoolTeacher = (day, period) => {
    const slot = getAfterSchoolSlot(day, period);
    if (!slot) return null;
    const assignments = slot.assignments || {};
    // 班级名归一化：去除全角括号、空格、"班"字
    const normalize = (s) => String(s || '').replace(/[\s（()）班]/g, '');
    const targetKey = normalize(cn);
    // 尝试精确匹配 + 归一化匹配
    for (const key in assignments) {
      if (key === cn || normalize(key) === targetKey) {
        let asn = assignments[key];
        // 运行时补上：如果是拼接教师名，按空白/逗号/分号拆分转单周/双周
        if (asn && asn.teacher && typeof asn.teacher === 'string') {
          const parts = asn.teacher.split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t);
          if (parts.length >= 2) {
            asn = { singleWeek: parts[0], doubleWeek: parts[1], week: '单周/双周' };
          }
        }
        return asn;
      }
    }
    if (day === '星期一' && period === 7) {
      console.log(`[getAfterSchoolTeacher] not matched. cn="${cn}", keys=`, Object.keys(assignments));
    }
    return null;
  };

  let html = `<div class="table-wrap"><table class="data-table tt-table">`;
  html += `<thead><tr><th>节次</th>${days.map(d=>`<th>${d}<br><small>${d === '星期五' ? '时间' : '时间'}</small></th>`).join('')}</tr></thead><tbody>`;

  // 常规课程（1-6节）
  for (const p of [1,2,3,4,5,6]) {
    html += `<tr><td>第${p}节</td>`;
    for (const d of days) {
      const slots = tt[d]?.[cn] || [];
      const slot = slots.find(s => s.period === p);
      const t = getTime(d, p);
      html += `<td>
        <div class="time-cell">${t}</div>
        <div class="${slot ? 'has-class' : 'empty-cell'}">
          ${slot ? `<span class="subj">${esc(slot.subject)}</span><br><span class="tea">${esc(slot.teacher)}</span>` : '—'}
        </div>
      </td>`;
    }
    html += `</tr>`;
  }

  // 课后服务（每行只在该天有节次时渲染）
  // 星期一~周四：7-11节；星期五：7-8节
  const afterschoolPeriodsByDay = {};
  for (const d of days) {
    const max = maxAfterSchoolPeriod(d);
    afterschoolPeriodsByDay[d] = [];
    for (let p = 7; p <= max; p++) afterschoolPeriodsByDay[d].push(p);
  }
  // 合并所有出现过的课后服务节次
  const allAfterSchoolPeriods = [...new Set(days.flatMap(d => afterschoolPeriodsByDay[d]))].sort((a,b)=>a-b);
  // 名称
  const afterSchoolName = { 7:'课后服务1', 8:'课后服务2', 9:'课后服务3', 10:'晚自习', 11:'午休' };

  for (const p of allAfterSchoolPeriods) {
    // 课后服务行节次列：仅节次名字（时间已合并到内容格“名字上方”）
    html += `<tr class="afterschool-row"><td class="period-cell">第${p}节</td>`;
    for (const d of days) {
      // 该天没这节次显示空白
      if (!afterschoolPeriodsByDay[d].includes(p)) {
        html += `<td class="empty-cell afterschool-cell">—</td>`;
        continue;
      }
      const t = getTime(d, p);
      const asn = getAfterSchoolTeacher(d, p);
      // 星期五第8节特殊处理：只显示时间，不显示具体安排
      if (d === '星期五' && p === 8) {
        html += `<td class="afterschool-cell special-club">
          <div class="time-cell">${t}</div>
          <span class="subj">特色社团活动</span>
        </td>`;
        continue;
      }
      // 内容格：名字上方显示「时间+项目名」
      // 周五：只第7节在时间前加「课后服务1」，其余（周五原样）保持 t
      let timeLabel;
      if (d === '星期五') {
        timeLabel = (p === 7) ? `${t}${esc(afterSchoolName[7])}` : t;
      } else {
        timeLabel = `${esc(afterSchoolTimeMap[p] || '')} ${esc(afterSchoolName[p] || '')}`.trim();
      }
      html += `<td>
        <div class="time-cell">${timeLabel}</div>`;
      if (asn) {
        if (asn.week === '单周/双周') {
          html += `<div class="has-class afterschool-cell">
            <span class="subj">${esc(asn.singleWeek||'')}</span><span class="week-tag">单周</span><br>
            <span class="subj">${esc(asn.doubleWeek||'')}</span><span class="week-tag week-double">双周</span>
          </div>`;
        } else {
          html += `<div class="has-class afterschool-cell">
            <span class="subj">${esc(asn.teacher||'')}</span>
            ${asn.week ? `<span class="week-tag">${esc(asn.week)}</span>` : ''}
          </div>`;
        }
      } else {
        html += `<div class="empty-cell afterschool-cell">—</div>`;
      }
      html += `</td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  area.innerHTML = html;
}

function renderTTMy() {
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const afterSchool = td.afterSchoolService || {};
  const myName = sessionStorage.getItem('teacherName') || '';
  const area = $('tt-my-content');
  if (!area) return;

  // 顶部工具条：「社团活动」按钮
  const toolbar = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
    <button class="btn btn-club-table" onclick="showClubTable()">🎯 社团活动</button>
  </div>`;

  const days = ['星期一','星期二','星期三','星期四','星期五'];
  const dayOrder = d => days.indexOf(d);
  
  // 正课时间映射（周一~周四）
  const timeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'14:00-14:40', 6:'14:50-15:30' };
  // 星期五特殊时间
  const fridayTimeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'13:00-13:40', 6:'13:50-14:30', 7:'14:40-15:20', 8:'15:25-16:50' };
  // 根据天和节次返回时间
  const getTime = (day, p) => day === '星期五' ? (fridayTimeMap[p] || '—') : (timeMap[p] || '—');
  // 课后服务时间映射（周一~周四）
  const afterSchoolTimeMap = { 7:'15:40-16:20', 8:'16:25-17:05', 9:'17:10-17:50', 10:'19:30-20:30', 11:'13:00-13:50' };
  // 星期五课后服务时间映射（只有两节）
  const fridayAfterSchoolTimeMap = { 7:'14:40-15:20', 8:'15:25-16:50' };
  // 课后服务名称
  const afterSchoolName = { 7:'课后服务1', 8:'课后服务2', 9:'课后服务3', 10:'晚自习', 11:'午休' };
  // 课后服务时间取：根据星期取对应映射，没有再回退原 slot.time
  const getAfterSchoolTime = (day, period, fallback) => day === '星期五' ? (fridayAfterSchoolTimeMap[period] || fallback || '—') : (afterSchoolTimeMap[period] || fallback || '—');

  // 收集正课
  const mySlots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cn, slots] of Object.entries(classMap)) {
      for (const s of slots) {
        if (s.teacher === myName) mySlots.push({ day, className: cn, ...s, isAfterSchool: false });
      }
    }
  }

  // 收集课后服务
  const myAfterSchoolSlots = [];
  const assSlots = afterSchool.slots || [];
  for (const slot of assSlots) {
    const period = getPeriod(slot.time);
    if (period >= 7 && slot.assignments) {
      // assignments 可能是数组或对象
      const assignments = Array.isArray(slot.assignments) 
        ? slot.assignments 
        : Object.entries(slot.assignments).map(([className, data]) => ({ className, ...data }));
      for (const assign of assignments) {
        // 双教师场景：存储为 { singleWeek, doubleWeek }；单教师场景：{ teacher }
        // 这里把三种字段都拆成候选人名，避免单/双周老师的课在个人课表里丢失
        const candidates = [];
        if (assign.teacher) {
          assign.teacher.split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t).forEach(t => candidates.push({ name: t, week: assign.week || '通用' }));
        }
        if (assign.singleWeek) candidates.push({ name: assign.singleWeek, week: '单周' });
        if (assign.doubleWeek) candidates.push({ name: assign.doubleWeek, week: '双周' });

        for (const c of candidates) {
          if (c.name !== myName) continue;
          myAfterSchoolSlots.push({
            day: slot.day,
            className: assign.className,
            period: period,
            subject: afterSchoolName[period] || slot.project || '课后服务',
            time: getAfterSchoolTime(slot.day, period, slot.time),
            isAfterSchool: true,
            weekType: c.week
          });
        }
      }
    }
  }

  // 合并所有课程
  const allSlots = [...mySlots, ...myAfterSchoolSlots];

  if (allSlots.length === 0) {
    area.innerHTML = toolbar + '<p class="text-muted">暂无您的课表记录</p>';
    return;
  }

  // 按星期、节次排序
  allSlots.sort((a,b) => dayOrder(a.day) - dayOrder(b.day) || a.period - b.period);

  let html = `<div class="table-wrap"><table class="data-table tt-table">`;
  html += `<thead><tr><th>星期</th><th>节次</th><th>时间</th><th>班级</th><th>科目</th></tr></thead><tbody>`;

  allSlots.forEach(s => {
    const weekTag = s.isAfterSchool && s.weekType !== '通用' 
      ? `<span class="week-tag ${s.weekType === '双周' ? 'week-double' : ''}" style="margin-left:4px;font-size:11px;">${s.weekType}</span>` 
      : '';
    // 星期五第8节特殊处理：显示“特色社团活动”
    let subjectLabel = esc(s.subject);
    if (s.day === '星期五' && s.period === 8 && s.isAfterSchool) {
      subjectLabel = '特色社团活动';
    }
    // 计算实际时间：优先用 slot.time，否则根据星期动态查
    const actualTime = s.time || getTime(s.day, s.period);
    html += `<tr>
      <td>${esc(s.day)}</td>
      <td>第${s.period}节</td>
      <td class="time-cell">${actualTime}</td>
      <td>${esc(s.className)}</td>
      <td>${subjectLabel}${weekTag}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  area.innerHTML = toolbar + html;
}

// ══════════════════════════════════════════════════════
//  请假登记页
// ══════════════════════════════════════════════════════
function renderLeavePage(area) {
  const td = scheduleData || {};
  const teas = td.allTeachers || [];

  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('请假登记')}
    <h2 class="page-title">🏖️ 请假登记</h2>

    <div class="card">
      <h3>📝 新增请假</h3>
      <form id="leave-form" onsubmit="submitLeave(event)">
        <div class="form-grid">
          <div class="form-group">
            <label>教师姓名 *</label>
            ${isAdmin ? `
            <select name="teacherName" required class="form-select">
              <option value="">— 选择教师 —</option>
              ${teas.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
            </select>` :
            `<input type="text" name="teacherName" value="${esc(sessionStorage.getItem('teacherName')||'')}" readonly class="form-input">`
            }
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>请假类型 *</label>
            <select name="leaveType" id="leave-type" class="form-select" onchange="toggleLeaveType(this.value)">
              <option value="single">单日请假（选具体节次）</option>
              <option value="range">连续多天（全天）</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>假别 *</label>
            <select name="leaveKind" id="leave-kind" class="form-select">
              <option value="事假">事假（需校长签字审批）</option>
              <option value="病假">病假（需校长签字审批）</option>
              <option value="婚假">婚假</option>
              <option value="丧假">丧假</option>
              <option value="公假">公假</option>
              <option value="其他">其他</option>
            </select>
            <p style="margin:4px 0 0; font-size:12px; color:#6B7280;">事假/病假需填写请假条并经校长手写签字审批后，方可安排代课</p>
          </div>
          <div id="single-leave">
            <div class="form-group">
              <label>请假日期 *</label>
              <input type="date" name="leaveDate" id="leave-date-single" class="form-input" value="${now()}" onchange="updateLeaveWday(this)">
            </div>
            <div class="form-group">
              <label>星期</label>
              <input type="text" name="dayOfWeek" readonly class="form-input" id="leave-wday" value="${wday(now())}">
            </div>
            <div class="form-group">
              <label>请假节次 *</label>
              <select name="period" id="leave-period" class="form-select">
                <option value="">— 选择节次 —</option>
                ${[1,2,3,4,5,6].map(p => `<option value="${p}">第${p}节</option>`).join('')}
                <optgroup label="课后服务">
                  <option value="7">第7节 课后服务1</option>
                  <option value="8">第8节 课后服务2</option>
                  <option value="9">第9节 课后服务3</option>
                  <option value="10">第10节 晚自习</option>
                  <option value="11">第11节 午休</option>
                </optgroup>
                <option value="all">全天（按课表自动判断）</option>
              </select>
            </div>
          </div>
          <div id="range-leave" style="display:none">
            <div class="form-group">
              <label>开始日期 *</label>
              <input type="date" name="startDate" id="leave-start" class="form-input" value="${now()}">
            </div>
            <div class="form-group">
              <label>结束日期 *</label>
              <input type="date" name="endDate" id="leave-end" class="form-input" value="${now()}">
            </div>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>请假原因</label>
            <input type="text" name="reason" class="form-input" placeholder="如：出差、培训、急事">
          </div>
        </div>
        <button type="submit" class="btn btn-primary">提交请假</button>
      </form>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>📋 请假记录 (${leaveRecords.length})</h3>
        ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="clearAllLeaves()">清空</button>` : ''}
      </div>
      ${leaveRecords.length > 0 ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>假别/原因</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${leaveRecords.map(l => `
            <tr class="${l.status==='approved'?'row-approved':''}">
              <td>${esc(l.teacherName)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${esc(l.dayOfWeek)}</td>
              <td>${l.period ? '第'+l.period+'节' : '—'}</td>
              <td>${esc(l.leaveType||'—')}${l.reason ? '<br><span style="font-size:12px;color:#9CA3AF;">'+esc(l.reason)+'</span>' : ''}</td>
              <td><span class="badge badge-${l.status==='approved'?'green':l.status==='rejected'?'red':l.status==='pending_principal'?'blue':'yellow'}">${l.status==='pending_principal'?'待校长签字':(l.status||'待审核')}</span></td>
              <td>
                ${isAdmin ? `<button class="btn btn-sm btn-success" onclick="approveLeave('${l.id}')" ${l.status==='pending_principal'?'disabled title="事假/病假需先经校长签字"':''}>批准</button>` : ''}
                ${(isAdmin || l.status!=='approved') ? `<button class="btn btn-sm btn-danger"  onclick="deleteLeave('${l.id}')">删除</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<p class="text-muted">暂无请假记录</p>'}
    </div>
  </div>`;
}

function updateLeaveWday(el) {
  const w = $('leave-wday');
  if (w) w.value = wday(el.value);
}

function toggleLeaveType(type) {
  $('single-leave').style.display = type === 'single' ? '' : 'none';
  $('range-leave').style.display = type === 'range' ? '' : 'none';
  const periodSel = $('leave-period');
  if (periodSel) {
    periodSel.required = type === 'single';
  }
}

// 根据课表获取教师某天的有课节次
function getTeacherPeriods(teacherName, dayOfWeek) {
  const periods = [];
  if (!scheduleData) return periods;
  
  // 1. 扫描正课表（1-6节）
  const dayData = scheduleData.timetable?.[dayOfWeek];
  if (dayData) {
    for (const [className, slots] of Object.entries(dayData)) {
      for (const slot of slots) {
        if (slot.teacher === teacherName && slot.period) {
          periods.push(parseInt(slot.period));
        }
      }
    }
  }
  
  // 2. 扫描课后服务表（7-11节：课后服务1/2/3 + 晚自习 + 午休）
  const afterSlots = scheduleData.afterSchoolService?.slots || [];
  for (const slot of afterSlots) {
    if (normDay(slot.day) !== normDay(dayOfWeek)) continue;
    if (!slot.period || slot.period < 7 || slot.period > 11) continue;
    const assignments = slot.assignments || {};
    for (const [cls, asn] of Object.entries(assignments)) {
      // 跳过 “单周/双周”型赋中的未指定周
      if (slot.period === 11 && asn.week && asn.week.includes('双周') === false) continue;
      const isMine = asn.teacher === teacherName || asn.singleWeek === teacherName || asn.doubleWeek === teacherName;
      if (isMine) {
        periods.push(parseInt(slot.period));
        break;
      }
    }
  }
  
  // 去重并排序
  return [...new Set(periods)].sort((a, b) => a - b);
}

async function submitLeave(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  // 防重复点击：全局锁 + 按钮锁双层保护
  if (isSubmittingLeave || (submitBtn && submitBtn.disabled)) {
    toast('正在提交中，请勿重复点击', 'warning');
    return;
  }
  isSubmittingLeave = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.origText = submitBtn.textContent;
    submitBtn.textContent = '提交中…';
  }
  try {
  const fd  = new FormData(form);
  const leaveType = fd.get('leaveType');
  const leaveKind = fd.get('leaveKind') || '其他'; // 假别：事假/病假/婚假/丧假/公假/其他
  const teacherName = fd.get('teacherName');
  const reason = fd.get('reason');
  const status = isAdmin ? 'approved' : 'pending';

  const leavesToAdd = [];

  if (leaveType === 'single') {
    // 单日请假
    const leaveDate = fd.get('leaveDate');
    const periodVal = fd.get('period');
    const dayOfWeek = wdayFull(leaveDate);

    if (periodVal === 'all') {
      // 根据课表自动判断该教师当天有哪些课
      const teacherPeriods = getTeacherPeriods(teacherName, dayOfWeek);
      if (teacherPeriods.length === 0) {
        toast('该教师当天没有课程', 'warning');
        return;
      }
      for (const p of teacherPeriods) {
        leavesToAdd.push({ teacherName, leaveDate, dayOfWeek, period: p, reason, leaveType: leaveKind, status });
      }
    } else {
      // 单节
      leavesToAdd.push({ teacherName, leaveDate, dayOfWeek, period: parseInt(periodVal), reason, leaveType: leaveKind, status });
    }
  } else {
    // 连续多天
    const startDate = fd.get('startDate');
    const endDate = fd.get('endDate');
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = wdayFull(dateStr);
      // 跳过周末
      if (dayOfWeek === '星期六' || dayOfWeek === '星期日') continue;
      // 根据课表判断该教师当天有哪些课
      const teacherPeriods = getTeacherPeriods(teacherName, dayOfWeek);
      for (const p of teacherPeriods) {
        leavesToAdd.push({ teacherName, leaveDate: dateStr, dayOfWeek, period: p, reason, leaveType: leaveKind, status });
      }
    }
  }

  if (leavesToAdd.length === 0) {
    toast('没有可请假的课程记录', 'warning');
    return;
  }

  // 提交前先 reload 一次数据，以服务器为权威源进行去重
  try {
    const reload = await API.getLeaves();
    if (reload.success && Array.isArray(reload.data)) {
      leaveRecords = reload.data;
    }
  } catch (err) {
    console.warn('reload leaves failed:', err);
  }

  // 客户端去重：过滤掉已存在的请假记录（同一教师+同一日期+同一节次+同一状态）
  const beforeFilter = leavesToAdd.length;
  const newLeaves = leavesToAdd.filter(obj => {
    return !leaveRecords.some(existing =>
      existing.teacherName === obj.teacherName &&
      existing.leaveDate === obj.leaveDate &&
      String(existing.period ?? '') === String(obj.period ?? '')
    );
  });
  const skipCount = beforeFilter - newLeaves.length;
  if (newLeaves.length === 0) {
    toast(skipCount > 0 ? `本次 ${skipCount} 条请假均已登记，未重复提交` : '没有可请假的课程记录', 'warning');
    return;
  }

  // 批量提交
  let successCount = 0;
  let dupCount = 0;
  const submittedIds = [];
  for (const obj of newLeaves) {
    const r = await API.addLeave(obj);
    if (r.success) {
      leaveRecords.unshift({ id: r.data?.id || Date.now().toString(36), ...obj });
      if (r.data?.id) submittedIds.push(r.data.id);
      successCount++;
    } else if (r.duplicate || (r.error && r.error.includes('已存在'))) {
      dupCount++;
    }
  }
  // 提交过程中又被别人添加的，全部重新 reload
  if (dupCount > 0) {
    try {
      const reload = await API.getLeaves();
      if (reload.success && Array.isArray(reload.data)) leaveRecords = reload.data;
    } catch (err) {}
  }

  if (successCount > 0) {
    const msg = skipCount + dupCount > 0
      ? `成功登记 ${successCount} 条请假（跳过 ${skipCount + dupCount} 条重复）`
      : `成功登记 ${successCount} 条请假记录`;
    toast(msg, 'success');
    form.reset();
    $('leave-wday').value = wday(now());
    renderLeavePage($('main-content'));
    // 事假/病假 → 弹出请假条（仅教师端；管理员代录不需要请假条）
    if (PRINCIPAL_REVIEW_TYPES.includes(leaveKind) && !isAdmin && submittedIds.length > 0) {
      const startDate = leaveType === 'single' ? fd.get('leaveDate') : fd.get('startDate');
      const endDate = leaveType === 'single' ? fd.get('leaveDate') : fd.get('endDate');
      showLeaveSlipModal({ leaveIds: submittedIds, teacherName, reason, startDate, endDate });
    }
  } else {
    toast(skipCount + dupCount > 0 ? '所有请假记录均已存在，未重复提交' : '提交失败', 'error');
  }
  } catch (err) {
    console.error('submitLeave error:', err);
    toast('提交出错：' + (err.message || err), 'error');
  } finally {
    isSubmittingLeave = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.origText || '提交请假';
      delete submitBtn.dataset.origText;
    }
  }
}

async function deleteLeave(id) {
  const headers = {};
  if (isAdmin) {
    headers['x-admin-pwd'] = adminPwd;
  }
  const r = await fetch(`/api/leaves/${id}`, { method:'DELETE', headers });
  const data = await r.json().catch(() => ({}));
  if (!data.success) {
    toast(data.error || '删除失败', 'error');
    return;
  }
  leaveRecords = leaveRecords.filter(l => l.id !== id);
  toast('已删除', 'success');
  renderLeavePage($('main-content'));
}

// ══════════════════════════════════════════════════════
//  校长审批页（请假条手写签字）
// ══════════════════════════════════════════════════════
let principalAuthed = sessionStorage.getItem('principalAuthed') === '1';

function renderPrincipalPage(area) {
  if (!principalAuthed) {
    area.innerHTML = `
    <div class="page">
      ${mobileBackBar('校长审批')}
      <h2 class="page-title">✍️ 校长审批</h2>
      <div class="card" style="max-width:420px; margin:0 auto;">
        <h3>🔑 请输入校长审批密码</h3>
        <p style="color:#6B7280; font-size:13px;">请假条（事假/病假）需校长手写签字审批后才能安排代课。</p>
        <input type="password" id="principal-pwd-input" class="form-input" placeholder="校长审批密码" style="margin:12px 0;" onkeydown="if(event.key==='Enter')verifyPrincipalPwd()">
        <p id="principal-pwd-msg" style="color:#DC2626; font-size:13px; min-height:18px;"></p>
        <button class="btn btn-primary" onclick="verifyPrincipalPwd()">进入审批</button>
      </div>
    </div>`;
    return;
  }
  const pendingSlips = slipRecords.filter(s => s.status === 'pending');
  const doneSlips = slipRecords.filter(s => s.status !== 'pending');
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('校长审批')}
    <h2 class="page-title">✍️ 校长审批</h2>
    <div class="card">
      <div class="card-header">
        <h3>🕐 待审批请假条 (${pendingSlips.length})</h3>
        <button class="btn btn-sm" onclick="principalAuthed=false;sessionStorage.removeItem('principalAuthed');renderPrincipalPage($('main-content'))">退出校长模式</button>
      </div>
      ${pendingSlips.length === 0 ? '<p class="text-muted">暂无待审批的请假条</p>' : `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>事由</th><th>请假时间</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>
            ${pendingSlips.map(s => `
            <tr>
              <td>${esc(s.teacherName)}</td>
              <td>${esc(s.reason)}</td>
              <td>${fmtDate(s.startDate)} ~ ${fmtDate(s.endDate)}</td>
              <td>${new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
              <td><button class="btn btn-sm btn-primary" onclick="showPrincipalApproveModal('${s.id}')">签字审批</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
    ${doneSlips.length > 0 ? `
    <div class="card">
      <h3>📋 已处理 (${doneSlips.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>事由</th><th>时间</th><th>结果</th></tr></thead>
          <tbody>
            ${doneSlips.map(s => `
            <tr>
              <td>${esc(s.teacherName)}</td>
              <td>${esc(s.reason)}</td>
              <td>${fmtDate(s.startDate)} ~ ${fmtDate(s.endDate)}</td>
              <td><span class="badge badge-${s.status==='approved'?'green':'red'}">${s.status==='approved'?'✅ 已同意':'❌ 已拒绝'}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  </div>`;
}

function verifyPrincipalPwd() {
  const input = $('principal-pwd-input');
  const msg = $('principal-pwd-msg');
  if (!input) return;
  if (input.value === PRINCIPAL_PWD) {
    principalAuthed = true;
    sessionStorage.setItem('principalAuthed', '1');
    renderPrincipalPage($('main-content'));
  } else {
    msg.textContent = '密码错误，请重试';
  }
}

// 校长签字审批弹窗
function showPrincipalApproveModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) return;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:88vh; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">✍️ 请假条审批</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px; overflow-y:auto; max-height:70vh;">
        <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:16px; margin-bottom:16px;">
          <p style="margin:4px 0;"><strong>教师：</strong>${esc(slip.teacherName)}</p>
          <p style="margin:4px 0;"><strong>事由：</strong>${esc(slip.reason)}</p>
          <p style="margin:4px 0;"><strong>时间：</strong>${fmtDate(slip.startDate)} ~ ${fmtDate(slip.endDate)}</p>
          <p style="margin:4px 0;"><strong>关联请假：</strong>${slip.leaveIds.length} 条记录</p>
        </div>
        ${slip.teacherSignature ? `
        <div style="margin-bottom:16px;">
          <p style="font-size:13px; color:#6B7280; margin-bottom:4px;">教师签字：</p>
          <img src="${slip.teacherSignature}" style="max-height:80px; border:1px solid #E5E7EB; border-radius:6px; background:#fff; padding:4px;">
        </div>` : ''}
        <div class="form-group">
          <label>校长签字 *（请用鼠标/手指签名）</label>
          <div style="border:2px dashed #CBD5E1; border-radius:8px; overflow:hidden; background:#FAFAFA;">
            <canvas id="principal-canvas" style="width:100%; height:140px; display:block; touch-action:none; cursor:crosshair;"></canvas>
          </div>
          <button type="button" id="principal-clear" class="btn btn-sm" style="margin-top:8px;">✖ 清空重签</button>
        </div>
        <p id="principal-msg" style="color:#DC2626; font-size:13px; min-height:18px; margin:8px 0 0;"></p>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; justify-content:flex-end; gap:8px;">
        <button id="principal-reject" style="padding:8px 16px; background:#EF4444; color:#fff; border:none; border-radius:6px; cursor:pointer;">❌ 拒绝</button>
        <button id="principal-approve" style="padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;">✅ 同意并签字</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
  
  const canvas = modal.querySelector('#principal-canvas');
  const pad = initSignaturePad(canvas);
  modal.querySelector('#principal-clear').onclick = () => pad.clear();
  const msgEl = modal.querySelector('#principal-msg');
  
  async function submit(action) {
    const sig = action === 'approve' ? pad.getDataUrl() : '';
    if (action === 'approve' && pad.isEmpty()) { msgEl.textContent = '请先手写签字'; return; }
    const btn = modal.querySelector(action === 'approve' ? '#principal-approve' : '#principal-reject');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      const r = await fetch(`/api/leave-slips/${slip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-principal-pwd': PRINCIPAL_PWD },
        body: JSON.stringify({ action, signature: sig, principalName: '校长' })
      });
      const j = await r.json();
      if (j.success) {
        // 更新本地请假条状态
        slip.status = action === 'approve' ? 'approved' : 'rejected';
        slip.principalSignedAt = new Date().toISOString();
        // 同步更新关联请假记录状态
        if (j.data?.leaveIds) {
          for (const lid of j.data.leaveIds) {
            const l = leaveRecords.find(x => x.id === lid);
            if (l) l.status = action === 'approve' ? 'approved' : 'rejected';
          }
        }
        modal.remove();
        toast(action === 'approve' ? '✅ 已同意，可安排代课' : '已拒绝该请假条', action === 'approve' ? 'success' : 'info');
        renderPrincipalPage($('main-content'));
      } else {
        msgEl.textContent = j.error || '提交失败';
        btn.disabled = false; btn.textContent = action === 'approve' ? '✅ 同意并签字' : '❌ 拒绝';
      }
    } catch (err) {
      msgEl.textContent = '网络错误：' + (err.message || err);
      btn.disabled = false; btn.textContent = action === 'approve' ? '✅ 同意并签字' : '❌ 拒绝';
    }
  }
  modal.querySelector('#principal-approve').onclick = () => submit('approve');
  modal.querySelector('#principal-reject').onclick = () => submit('reject');
}

async function approveLeave(id) {
  const r = await fetch(`/api/leaves/${id}`, {
    method:'PUT', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd},
    body: JSON.stringify({ status: 'approved' })
  });
  const j = await r.json();
  if (j.success) {
    const l = leaveRecords.find(l=>l.id===id);
    if (l) l.status = 'approved';
    toast('已批准','success');
    renderLeavePage($('main-content'));
  }
}

async function clearAllLeaves() {
  if (!confirm('确定清空所有请假记录？')) return;
  const r = await API.clearLeaves(); // 正确：清空请假记录
  if (!r.success) { toast('清空失败：' + (r.error || '未知错误'), 'error'); return; }
  toast('已清空，页面即将刷新...','success');
  setTimeout(() => location.reload(), 800); // 强制刷新确保所有页面数据同步
}

// ══════════════════════════════════════════════════════
//  代课安排页
// ══════════════════════════════════════════════════════
let previewSubstitutes = []; // 预览状态的代课安排

function renderSubPage(area) {
  const approvedLeaves = leaveRecords.filter(l => l.status === 'approved');
  const pendingCount = approvedLeaves.length;
  
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('代课记录')}
    <h2 class="page-title">✅ 代课记录</h2>

    ${isAdmin ? `
    <div class="action-bar">
      ${pendingCount > 0 ? `<span class="pending-badge">${pendingCount} 条请假待安排</span>` : ''}
      <button class="btn btn-primary" onclick="doGenerateSubstitutes()">⚡ 自动生成代课安排</button>
      ${previewSubstitutes.length > 0 ? `
        <button class="btn btn-success" onclick="confirmSubstitutes()">✅ 确认方案</button>
        <button class="btn btn-secondary" onclick="cancelPreview()">❌ 取消预览</button>
      ` : `<button class="btn btn-secondary" onclick="exportSubExcel()" ${substituteRecords.length === 0 ? 'disabled' : ''}>📥 导出Excel</button>
      <button class="btn btn-secondary" onclick="exportSubKaoqin()" ${substituteRecords.length === 0 ? 'disabled' : ''}>📋 按考勤表导出</button>`}
    </div>` : ''}

    ${previewSubstitutes.length > 0 ? renderPreviewTable() : renderSubTable()}
  </div>`;
}

function renderPreviewTable() {
  return `
  <div class="card preview-card">
    <div class="card-header">
      <h3>📋 代课方案预览（请检查确认）</h3>
      <span class="preview-hint">可点击修改代课教师</span>
    </div>
    <div class="table-wrap">
      <table class="data-table preview-table">
        <thead><tr>
          <th>请假教师</th><th>代课教师</th><th>班级</th><th>科目</th>
          <th>代课日期</th><th>星期</th><th>节次</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${previewSubstitutes.map((s, idx) => `
          <tr class="preview-row ${s.isConflict ? 'conflict' : ''}">
            <td>${esc(s.leaveTeacher||'')}</td>
            <td>
              <select class="form-select sub-select" onchange="updatePreviewSub(${idx}, this.value)">
                ${getSubstituteOptions(s.substituteTeacher)}
              </select>
            </td>
            <td>${esc(s.className||'')}</td>
            <td>${esc(s.subject||'—')}</td>
            <td>${fmtDate(s.leaveDate||'')}</td>
            <td>${esc(s.dayOfWeek||'')}</td>
            <td>第${s.period||''}节</td>
            <td><button class="btn btn-sm btn-danger" onclick="removePreviewItem(${idx})">删除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function getSubstituteOptions(currentTeacher) {
  const teachers = scheduleData?.allTeachers || [];
  return teachers.map(t => `<option value="${esc(t)}" ${t === currentTeacher ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function updatePreviewSub(idx, newTeacher) {
  previewSubstitutes[idx].substituteTeacher = newTeacher;
}

function removePreviewItem(idx) {
  previewSubstitutes.splice(idx, 1);
  renderSubPage($('main-content'));
}

function cancelPreview() {
  previewSubstitutes = [];
  renderSubPage($('main-content'));
  toast('已取消预览', 'info');
}

async function confirmSubstitutes() {
  if (previewSubstitutes.length === 0) {
    toast('没有可确认的方案', 'warning');
    return;
  }
  // 保存到正式记录
  substituteRecords = [...previewSubstitutes];
  previewSubstitutes = [];
  // 调用API保存
  const r = await API.saveSubstitutes(substituteRecords);
  if (r.success) {
    toast('代课方案已确认并保存', 'success');
    renderSubPage($('main-content'));
  } else {
    toast('保存失败：' + r.error, 'error');
  }
}

function renderSubTable() {
  // 优先显示已批准但未安排代课的请假
  const approvedLeaves = leaveRecords.filter(l => l.status === 'approved');
  
  if (approvedLeaves.length > 0) {
    return `
    <div class="card">
      <div class="card-header">
        <h3>⏳ 待安排代课的请假 (${approvedLeaves.length})</h3>
        <span class="preview-hint">点击上方"自动生成代课安排"生成方案</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>请假教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th>
          </tr></thead>
          <tbody>
            ${approvedLeaves.map(l => `
            <tr>
              <td>${esc(l.teacherName)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${esc(l.dayOfWeek)}</td>
              <td>第${l.period}节</td>
              <td>${esc(l.reason||'—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }
  
  if (substituteRecords.length === 0) {
    return `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>暂无代课记录</h3>
      <p>${isAdmin ? '请先登记请假，再点击"自动生成代课安排"' : '请等候管理员安排代课'}</p>
    </div>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <h3>代课记录 (${substituteRecords.length})</h3>
      <div class="filter-row">
        <input type="text" id="sub-filter" class="form-input" placeholder="搜索教师/班级..."
               oninput="filterSubTable(this.value)">
      </div>
    </div>
    <div class="table-wrap">
      <table class="data-table" id="sub-table">
        <thead><tr>
          <th>请假教师</th><th>代课教师</th><th>班级</th><th>科目</th>
          <th>代课日期</th><th>星期</th><th>节次</th>
          <th>安排方式</th><th>操作</th>
        </tr></thead>
        <tbody id="sub-tbody">
          ${substituteRecords.map(s => `
          <tr class="sub-row">
            <td>${esc(s.leaveTeacher||'')}</td>
            <td class="sub-tea">${esc(s.substituteTeacher||'—')}</td>
            <td>${esc(s.className||'')}</td>
            <td>${esc(s.subject||'—')}</td>
            <td>${fmtDate(s.leaveDate||'')}</td>
            <td>${esc(s.dayOfWeek||'')}</td>
            <td>第${s.period||''}节</td>
            <td>${esc(s.reason||'')}</td>
            <td>
              ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="deleteSubstituteRecord('${s.id}')" title="删除这条记录">🗑️ 删除</button>` : '<span style="color:#9CA3AF;font-size:12px;">只读</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

async function doGenerateSubstitutes() {
  if (!scheduleData || !scheduleData.timetable) {
    toast('请先导入课表','warning'); return;
  }
  const approvedLeaves = leaveRecords.filter(l => l.status === 'approved');
  if (approvedLeaves.length === 0) {
    toast('暂无已批准的请假记录','warning'); return;
  }
  // 【防重复】清空旧预览
  previewSubstitutes = [];
  const loading = showLoading('正在分析代课方案...');
  try {
    const r = await API.generateSubstitutes();
    loading.remove();
    console.log('[doGenerateSubstitutes] API返回:', r.summary, 'results.length:', (r.data||r.results||[]).length);
    if (r.success) {
      const results = r.data || r.results || [];
      // 前端也去重
      const seen = new Set();
      const uniqueResults = [];
      for (const s of results) {
        const key = `${s.leaveId}_${s.period}_${s.className}`;
        if (seen.has(key)) {
          console.warn('[doGenerateSubstitutes] 跳过重复:', s.leaveTeacher, '第'+s.period+'节', s.className);
          continue;
        }
        seen.add(key);
        uniqueResults.push(s);
      }
      console.log('[doGenerateSubstitutes] 去重后:', uniqueResults.length, '条');
      if (uniqueResults.length > 0) {
        previewSubstitutes = uniqueResults; // 进入预览模式
        toast(`生成完成！共 ${uniqueResults.length} 条代课安排，请检查确认`, 'success');
        renderSubPage($('main-content'));
      } else {
        toast('未能生成代课安排：'+(r.error||r.message||'无可用数据'),'warning');
      }
    } else {
      toast('生成失败：'+r.error,'error');
    }
    renderSubPage($('main-content'));
  } catch(e) {
    loading.remove();
    toast('网络错误','error');
  }
}

function showLoading(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:99999';
  el.innerHTML = `<div style="background:#fff;border-radius:8px;padding:24px 40px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.15)">
    <div style="font-size:32px;margin-bottom:12px">⏳</div>
    <div style="font-size:15px;color:#374151">${msg}</div>
  </div>`;
  document.body.appendChild(el);
  return el;
}

function filterSubTable(q) {
  q = q.toLowerCase();
  document.querySelectorAll('.sub-row').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// 删除单条代课记录（仅管理员）
async function deleteSubstituteRecord(id) {
  if (!isAdmin) { toast('仅管理员可删除','warning'); return; }
  if (!confirm('确认删除这条代课记录？')) return;
  try {
    const r = await fetch('/api/substitutes/delete-one', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
      body: JSON.stringify({ id })
    });
    const data = await r.json();
    if (data.success) {
      toast('删除成功','success');
      // 本地刷新
      substituteRecords = substituteRecords.filter(s => s.id !== id);
      switchPage('sub');
    } else {
      toast(data.error || '删除失败','error');
    }
  } catch (e) {
    toast('网络错误: ' + e.message,'error');
  }
}

function exportSubExcel() {
  if (substituteRecords.length === 0) { toast('无记录可导出','warning'); return; }
  const data = substituteRecords.map(s => ({
    '请假教师': s.leaveTeacher||'',
    '代课教师': s.substituteTeacher||'',
    '班级': s.className||'',
    '科目': s.subject||'',
    '日期': fmtDate(s.leaveDate||''),
    '星期': s.dayOfWeek||'',
    '节次': '第'+(s.period||'')+'节',
    '安排方式': s.reason||'',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '代课记录');
  XLSX.writeFile(wb, `代课记录_${now()}.xlsx`);
  toast('导出成功','success');
}

// 按「教师考勤统计表」模板格式导出（自动填可生成项，其余留空手填）
function exportSubKaoqin() {
  if (substituteRecords.length === 0) { toast('无记录可导出','warning'); return; }
  // 统计每位请假教师每天的总节数（用于「节数」列）
  const cntMap = {};
  substituteRecords.forEach(s => {
    const k = (s.leaveTeacher||'') + '|' + (s.leaveDate||'');
    cntMap[k] = (cntMap[k] || 0) + 1;
  });
  const arr = (n, v) => Array.from({length:n}, () => v);
  const parseDate = (d) => {
    if (!d) return {y:'',m:'',dd:''};
    const m = String(d).split(/[-/]/);
    return { y: m[0]||'', m: m[1]||'', dd: m[2]||'' };
  };
  const rows = [];
  rows[0] = arr(16,''); rows[0][0] = '施秉县双井镇小学、幼儿园教师考勤统计表';
  rows[1] = arr(16,''); rows[1][0] = '（2025—2026学年度第二学期）';
  rows[2] = arr(16,''); rows[2][0] = '  （2026年        月）';
  rows[3] = arr(16,''); rows[3][9] = '登记人：';
  rows[4] = arr(16,''); rows[4][0] = '学校（盖章）：施秉县双井镇中心小学'; rows[4][9] = '审核人：';
  rows[5] = arr(16,'');
  rows[5][0]='序号'; rows[5][1]='有假教师'; rows[5][2]='考勤备注';
  rows[5][10]='前去代课教师'; rows[5][11]='代课情况'; rows[5][15]='备注';
  rows[6] = arr(16,'');
  rows[6][2]='请假时间'; rows[6][5]='星期'; rows[6][6]='事由'; rows[6][7]='假别';
  rows[6][8]='迟到、早退、旷工'; rows[6][9]='天数';
  rows[6][11]='班级'; rows[6][12]='节次'; rows[6][13]='科目'; rows[6][14]='节数';
  rows[7] = arr(16,''); rows[7][2]='年'; rows[7][3]='月'; rows[7][4]='日';
  let idx = 1;
  substituteRecords.forEach(s => {
    const dr = parseDate(s.leaveDate);
    const k = (s.leaveTeacher||'') + '|' + (s.leaveDate||'');
    const r = arr(16,'');
    r[0]  = idx++;
    r[1]  = s.leaveTeacher || '';
    r[2]  = dr.y;  r[3] = dr.m;  r[4] = dr.dd;
    r[5]  = s.dayOfWeek || '';
    r[6]  = s.reason || '';
    r[7]  = '';          // 假别：系统未存储，留空手填
    r[8]  = '';          // 迟到早退旷工：留空手填
    r[9]  = '';          // 天数：留空手填
    r[10] = s.substituteTeacher || '';
    r[11] = s.className || '';
    r[12] = s.period || '';
    r[13] = s.subject || '';
    r[14] = cntMap[k] || 1;
    r[15] = '';          // 备注：留空手填
    rows.push(r);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [
    {s:{r:0,c:0},e:{r:0,c:15}}, {s:{r:1,c:0},e:{r:1,c:15}}, {s:{r:2,c:0},e:{r:2,c:15}},
    {s:{r:3,c:9},e:{r:3,c:15}}, {s:{r:4,c:0},e:{r:4,c:8}}, {s:{r:4,c:9},e:{r:4,c:15}},
    {s:{r:6,c:2},e:{r:6,c:9}}, {s:{r:6,c:11},e:{r:6,c:14}},
    {s:{r:7,c:2},e:{r:7,c:4}},
    {s:{r:6,c:0},e:{r:8,c:0}}, {s:{r:6,c:1},e:{r:8,c:1}},
    {s:{r:7,c:5},e:{r:8,c:5}}, {s:{r:7,c:6},e:{r:8,c:6}}, {s:{r:7,c:7},e:{r:8,c:7}},
    {s:{r:7,c:8},e:{r:8,c:8}}, {s:{r:7,c:9},e:{r:8,c:9}},
    {s:{r:6,c:10},e:{r:8,c:10}}, {s:{r:7,c:11},e:{r:8,c:11}}, {s:{r:7,c:12},e:{r:8,c:12}},
    {s:{r:7,c:13},e:{r:8,c:13}}, {s:{r:7,c:14},e:{r:8,c:14}}, {s:{r:6,c:15},e:{r:8,c:15}}
  ];
  ws['!cols'] = [
    {wch:6},{wch:12},{wch:6},{wch:5},{wch:5},{wch:8},{wch:12},{wch:8},{wch:12},{wch:6},
    {wch:12},{wch:10},{wch:6},{wch:10},{wch:6},{wch:12}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '教师考勤统计表');
  XLSX.writeFile(wb, `教师考勤统计表_${now()}.xlsx`);
  toast('考勤表导出成功','success');
}

// ══════════════════════════════════════════════════════
//  导入课表页（管理员）
// ══════════════════════════════════════════════════════
function renderImportPage(area) {
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('导入课表')}
    <h2 class="page-title">📤 导入课表</h2>

    <div class="card">
      <h3>📊 方式一：直接上传总课表 Excel</h3>
      <p class="text-muted">将标准化后的 <code>总课表_标准化.xlsx</code> 上传，系统自动解析全部课表与教师信息。</p>
      <div class="form-group">
        <input type="file" id="import-excel" accept=".xlsx,.xls" class="form-file"
               onchange="handleExcelImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📚 方式二：上传课后服务表 Excel</h3>
      <p class="text-muted">分别上传 <code>单周.xlsx</code> 和 <code>双周.xlsx</code>，系统自动合并生成单双周课表。</p>
      <div class="form-group">
        <label style="display:block;margin-bottom:4px;color:#666;font-size:12px;">单周表：</label>
        <input type="file" id="import-single" accept=".xlsx,.xls" class="form-file"
               onchange="handleAfterSchoolImport('single', this.files[0])">
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label style="display:block;margin-bottom:4px;color:#666;font-size:12px;">双周表：</label>
        <input type="file" id="import-double" accept=".xlsx,.xls" class="form-file"
               onchange="handleAfterSchoolImport('double', this.files[0])">
      </div>
      <div id="afterschool-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>📅 方式三：上传校历表 Excel</h3>
      <p class="text-muted">上传校历表，系统自动识别每一周是<b>单周</b>还是<b>双周</b>（以及假期）。导入后，代课记录会按单/双周匹配对应教师。</p>
      <div class="form-group">
        <input type="file" id="import-calendar" accept=".xlsx,.xls" class="form-file"
               onchange="handleCalendarImport(this.files[0])">
      </div>
      <div id="calendar-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>📁 方式四：导入 JSON 数据</h3>
      <p class="text-muted">将 <code>parsed_data.json</code> 文件上传。</p>
      <div class="form-group">
        <input type="file" id="import-json" accept=".json" class="form-file"
               onchange="handleJsonImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📝 方式五：手动粘贴JSON数据</h3>
      <p class="text-muted">从 parsed_data.json 文件中复制内容，粘贴到下方：</p>
      <textarea id="import-textarea" class="form-textarea" rows="8"
                placeholder="粘贴 parsed_data.json 的内容..."></textarea>
      <button class="btn btn-primary" onclick="handleTextImport()">导入数据</button>
    </div>

    <div class="card">
      <h3>🎯 方式六：上传社团活动安排表 Excel</h3>
      <p class="text-muted">上传全校社团活动安排表（多 Sheet 整体保存），教师个人课表页的"社团活动"按钮会原样弹出本表。</p>
      <div class="form-group">
        <input type="file" id="import-club" accept=".xlsx,.xls" class="form-file"
               onchange="handleClubActivitiesImport(this.files[0])">
      </div>
      <div id="club-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>📋 当前数据状态</h3>
      ${renderDataStatus()}
    </div>
  </div>`;
}

function renderDataStatus() {
  const td = scheduleData || {};
  const cls = td.classes  || [];
  const teas = td.allTeachers || [];
  const cal = td.calendar || null;
  const clubSheets = (td.clubActivities && td.clubActivities.sheets) ? td.clubActivities.sheets.length : 0;
  const hasData = cls.length > 0 || !!cal || clubSheets > 0;
  const calInfo = cal ? `
    <div class="stat-mini" style="width:100%"><span class="sl" style="font-size:12px;line-height:1.6">📅 校历：${esc(cal.term || '')}<br>${cal.startDate} ~ ${cal.endDate}<br>${cal.stats?.weeks || cal.weeks?.length || 0} 周（单 ${cal.weeks?.filter?.(w=>w.parity==='single').length ?? '-'} / 双 ${cal.weeks?.filter?.(w=>w.parity==='double').length ?? '-'}），假日 ${cal.stats?.holidays ?? '-'} 天</span></div>` : '';

  return hasData ? `
  <div class="status-ok">✅ 已导入</div>
  <div class="stats-row" style="margin-top:12px">
    <div class="stat-mini"><span class="sn">${cls.length}</span><span class="sl">班级</span></div>
    <div class="stat-mini"><span class="sn">${teas.length}</span><span class="sl">教师</span></div>
    <div class="stat-mini"><span class="sn">${cls.length*30}</span><span class="sl">总课时</span></div>
    ${clubSheets > 0 ? `<div class="stat-mini"><span class="sn">${clubSheets}</span><span class="sl">社团表</span></div>` : ''}
  </div>
  ${calInfo}
  <button class="btn btn-danger btn-sm" style="margin-top:12px" onclick="clearScheduleData()">🗑️ 清空课表</button>
  ` : `<div class="status-warn">⚠️ 尚未导入课表</div>`;
}

async function clearScheduleData() {
  if (!confirm('确定清空课表数据？请假记录不受影响。')) return;
  const r = await API.clearSchedule();
  if (r.success) {
    scheduleData = null;
    toast('课表已清空', 'success');
    renderImportPage($('main-content'));
  } else {
    toast('清空失败：' + r.error, 'error');
  }
}

async function handleJsonImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await doImport(data);
  } catch(e) {
    toast('JSON解析失败：'+e.message,'error');
  }
}

/**
 * 直接解析标准化的总课表 Excel
 * 格式：教师姓名|星期|节次|班级|课程|教师
 */
// 日期规范化：'周一'/'周二'/... → '星期一'/'星期二'/...
const DAY_NORM = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六','周日':'星期日' };
function normDay(d) { return DAY_NORM[d] || d; }

/**
 * 社团活动安排表：整体存入 KV，点击按钮原样弹出，【不解析】
 * 数据形状：{ sheets: [{ name, rows: [[...], [...]] }], uploadedAt }
 */
async function handleClubActivitiesImport(file) {
  if (!file) return;
  const status = document.getElementById('club-status');
  if (status) status.textContent = '⏳ 正在读取 Excel...';
  const loading = showLoading('正在读取社团活动安排表...');
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheets = wb.SheetNames.map(name => {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
      // 压缩尾部全空行
      while (rows.length && rows[rows.length - 1].every(c => c === '' || c == null)) rows.pop();
      return { name, rows };
    });
    if (sheets.length === 0) { throw new Error('Excel 中没有任何工作表'); }
    const clubData = { sheets, uploadedAt: new Date().toISOString() };
    const r = await API.importSchedule({ clubActivities: clubData });
    loading.remove();
    if (r.success) {
      if (status) status.textContent = `✅ 已导入 ${sheets.length} 个 Sheet（${sheets.map(s => s.name).join(' / ')}）`;
      toast(r.message || '社团活动表导入成功', 'success');
      // 刷新本地缓存
      if (scheduleData) {
        scheduleData.clubActivities = clubData;
      } else {
        scheduleData = { timetable: {}, teacherAssignment: {}, afterSchoolService: {}, calendar: null, classes: [], allTeachers: [], clubActivities: clubData };
      }
      renderImportPage(document.getElementById('main-content'));
    } else {
      if (status) status.textContent = '❌ 导入失败：' + (r.error || '未知错误');
      toast('导入失败：' + (r.error || ''), 'error');
    }
  } catch(e) {
    loading.remove();
    if (status) status.textContent = '❌ 读取失败：' + e.message;
    toast('Excel 读取失败：' + e.message, 'error');
  }
}

function showClubTable() {
  const td = scheduleData || {};
  const data = td.clubActivities;
  // 懒创建弹窗容器（initApp 会重写 body，静态节点会被冲掉，故此处动态补回）
  let modal = document.getElementById('club-table-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'club-table-modal';
    document.body.appendChild(modal);
  }
  if (!data || !Array.isArray(data.sheets) || data.sheets.length === 0) {
    toast('尚未导入社团活动安排表，请先在"导入课表"页上传', 'warning');
    return;
  }
  let html = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>🎯 全校社团活动安排表</h3>
        <button class="modal-close" onclick="closeClubTable()">×</button>
      </div>
      <div class="modal-body">`;
  for (const sh of data.sheets) {
    html += `<h4 style="margin:8px 0 4px;color:var(--gray-700);">📄 ${esc(sh.name)}</h4>`;
    if (!sh.rows || sh.rows.length === 0) { html += `<p class="text-muted">（此 Sheet 无内容）</p>`; continue; }
    html += `<div class="table-wrap" style="margin-bottom:12px;"><table class="data-table"><tbody>`;
    sh.rows.forEach(row => {
      html += '<tr>' + row.map(cell => `<td>${esc(cell == null ? '' : String(cell))}</td>`).join('') + '</tr>';
    });
    html += `</tbody></table></div>`;
  }
  html += `      </div>
    </div>`;
  modal.innerHTML = html;
  modal.classList.add('open');
  modal.style.display = 'flex';
}

function closeClubTable() {
  const modal = document.getElementById('club-table-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.style.display = 'none';
}

async function handleExcelImport(file) {
  if (!file) return;
  const loading = showLoading('正在解析 Excel...');
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const data = parseTimetableWorkbook(wb);
    loading.remove();
    if (!data) { toast('未识别到总课表数据，请检查格式','error'); return; }
    await doImport(data);
  } catch(e) {
    loading.remove();
    toast('Excel 解析失败：'+e.message,'error');
  }
}

/**
 * 解析课后服务安排表（独立 Sheet）
 */
// 临时存储单周/双周数据
let afterSchoolTemp = { single: null, double: null };

async function handleAfterSchoolImport(weekType, file) {
  if (!file) return;
  const loading = showLoading(`正在解析${weekType === 'single' ? '单周' : '双周'}表...`);
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    console.log(`[AfterSchoolImport ${weekType}] SheetNames:`, wb.SheetNames);
    
    // 直接解析第一个 Sheet（可能是 Sheet1/单周/双周等），标记为单周或双周
    const firstSheetName = wb.SheetNames[0];
    const data = parseAfterSchoolSheet(wb.Sheets[firstSheetName], weekType === 'single' ? '单周' : '双周');
    console.log(`[AfterSchoolImport ${weekType}] parsed slots:`, data?.slots?.length);
    loading.remove();
    
    if (!data) { toast(`未识别到${weekType === 'single' ? '单周' : '双周'}数据`,'error'); return; }
    
    // 存储到临时变量
    afterSchoolTemp[weekType] = data;
    
    // 更新状态显示
    const statusEl = $('afterschool-status');
    if (statusEl) {
      const singleOk = afterSchoolTemp.single ? '✅' : '⏳';
      const doubleOk = afterSchoolTemp.double ? '✅' : '⏳';
      statusEl.innerHTML = `单周：${singleOk} ${afterSchoolTemp.single?.slots?.length || 0}时段 / 双周：${doubleOk} ${afterSchoolTemp.double?.slots?.length || 0}时段`;
    }
    
    toast(`${weekType === 'single' ? '单周' : '双周'}表已加载：${data.days?.length||0} 天 ${data.slots?.length||0} 时段`,'success');
    
    // 如果两个都加载了，自动合并导入
    if (afterSchoolTemp.single && afterSchoolTemp.double) {
      await mergeAndImportAfterSchool();
    }
  } catch(e) {
    loading.remove();
    toast(`${weekType === 'single' ? '单周' : '双周'}表解析失败：`+e.message,'error');
  }
}

// ══════════════════════════════════════════════════════
//  校历表解析（支持同结构新校历表复用）
//  校历表结构：
//    row0: 标题（学期名）
//    row1: 开始日期 如 "3/1/26"
//    row2: 表头 [月份, 周次, 星期日..星期六, 每周事务, 值周领导, 负责人, 值周教师, 值周班级]
//    row3+: 每周一行；col0=月份(三/四/...)，col1=周次(1..N)，col2-8=周日~周六日期
//          日期格式："1" 或 "12\n植树节" 或 "4\n清明 休"；含"休"=放假
//          跨月周拆成两行：第一行带周次（上月部分），第二行是新月份行（无周次，并入同一周）
// ══════════════════════════════════════════════════════
function parseCalendarWorkbook(wb) {
  const sn = wb.SheetNames[0];
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  // 1. 找表头行（含"周次"+ 含"星期日"）
  let headerRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (String(r[1] || '').includes('周次') && String(r[2] || '').includes('星期日')) { headerRow = i; break; }
  }
  if (headerRow === -1) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || [];
      if (String(r[1] || '').includes('周次')) { headerRow = i; break; }
    }
  }
  if (headerRow === -1) throw new Error('未找到校历表头（需含"周次"列）');

  // 2. 解析开始日期行（表头上一行 col0）：如 "3/1/26"
  let startYear = new Date().getFullYear();
  const dateRow = rows[headerRow - 1] || [];
  const dm = String(dateRow[0] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (dm) {
    const y = parseInt(dm[3]);
    startYear = y < 100 ? 2000 + y : y;
  }

  // 3. 学期标题
  const term = String(rows[0]?.[0] || '校历表').trim();

  const CN_MONTH = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12 };
  const WEEKDAYS = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];

  const weeks = [];
  const dayMap = {};
  let currentWeek = null;
  let currentMonth = 0;
  let currentYear = startYear;
  let prevMonthNum = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r.length < 3) continue;
    // 备注行跳过
    if (String(r[0] || '').includes('备注')) continue;

    // col0: 月份（"三"/"四"...，跨月行也会出现）
    const monthStr = String(r[0] || '').trim();
    if (monthStr && CN_MONTH[monthStr]) {
      const mm = CN_MONTH[monthStr];
      if (prevMonthNum && mm < prevMonthNum) currentYear++; // 跨年（秋季学期 12→1 月）
      currentMonth = mm;
      prevMonthNum = mm;
    }

    // col1: 周次（数字）→ 新的一周；空 → 跨月行，并入当前周
    const weekStr = String(r[1] || '').trim();
    if (weekStr && /^\d+$/.test(weekStr)) {
      const weekNum = parseInt(weekStr);
      currentWeek = { weekNum, parity: weekNum % 2 === 1 ? 'single' : 'double', days: [] };
      weeks.push(currentWeek);
    }
    if (!currentWeek) continue;

    // col2-8: 周日~周六
    for (let c = 2; c <= 8; c++) {
      const cell = String(r[c] || '').trim();
      if (!cell) continue;
      const m2 = cell.match(/(\d{1,2})/);
      if (!m2) continue;
      const day = parseInt(m2[1]);
      if (!currentMonth) continue;
      const date = new Date(currentYear, currentMonth - 1, day);
      if (isNaN(date.getTime())) continue;
      const dateStr = date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
      // 防重复（跨月行同一日期可能出现两次）
      if (dayMap[dateStr]) continue;
      const isHoliday = cell.includes('休');
      const dayInfo = { date: dateStr, weekday: WEEKDAYS[date.getDay()], isHoliday, weekNum: currentWeek.weekNum, parity: currentWeek.parity };
      currentWeek.days.push(dayInfo);
      dayMap[dateStr] = dayInfo;
    }
  }

  weeks.forEach(w => w.days.sort((a, b) => a.date < b.date ? -1 : 1));
  const allDays = Object.values(dayMap).sort((a, b) => a.date < b.date ? -1 : 1);

  return {
    source: sn,
    term,
    startDate: allDays.length ? allDays[0].date : null,
    endDate: allDays.length ? allDays[allDays.length - 1].date : null,
    weeks,
    dayMap,
    stats: { weeks: weeks.length, days: allDays.length, holidays: allDays.filter(d => d.isHoliday).length }
  };
}

async function handleCalendarImport(file) {
  if (!file) return;
  const loading = showLoading('正在解析校历表...');
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const calendar = parseCalendarWorkbook(wb);
    console.log('[CalendarImport] parsed:', calendar.stats, 'term:', calendar.term, calendar.startDate, '~', calendar.endDate);
    loading.remove();

    const holidayWeeks = calendar.weeks.filter(w => w.days.every(d => d.isHoliday));
    const ok = confirm(`校历表解析成功：\n学期：${calendar.term}\n日期范围：${calendar.startDate} ~ ${calendar.endDate}\n共 ${calendar.stats.weeks} 周（单周 ${calendar.weeks.filter(w=>w.parity==='single').length} / 双周 ${calendar.weeks.filter(w=>w.parity==='double').length}）\n共 ${calendar.stats.days} 天，其中假日 ${calendar.stats.holidays} 天\n\n确认导入？`);
    if (!ok) return;

    await doImport({ calendar });
  } catch(e) {
    loading.remove();
    console.error('[CalendarImport] error:', e);
    toast('校历表解析失败：' + e.message, 'error');
  }
}

// 合并单周双周数据并导入
async function mergeAndImportAfterSchool() {
  const loading = showLoading('正在合并单周/双周数据...');
  try {
    const single = afterSchoolTemp.single;
    const double = afterSchoolTemp.double;
    
    // 合并逻辑
    const mergedSlots = [];
    const slotKey = s => `${s.day}_${s.period}`;
    const singleMap = {};
    const doubleMap = {};
    
    for (const s of single.slots) singleMap[slotKey(s)] = s;
    for (const s of double.slots) doubleMap[slotKey(s)] = s;
    
    const allKeys = new Set([...Object.keys(singleMap), ...Object.keys(doubleMap)]);
    
    for (const key of allKeys) {
      const s = singleMap[key];
      const d = doubleMap[key];
      const newAssign = {};
      
      // 获取所有班级
      const allClasses = new Set([
        ...Object.keys(s?.assignments || {}),
        ...Object.keys(d?.assignments || {})
      ]);
      
      for (const cls of allClasses) {
        const asnS = s?.assignments?.[cls];
        const asnD = d?.assignments?.[cls];
        
        // 提取教师名字
        const tS = typeof asnS === 'object' ? (asnS.teacher || asnS.singleWeek) : asnS;
        const tD = typeof asnD === 'object' ? (asnD.teacher || asnD.singleWeek) : asnD;
        
        if (tS && tD && tS !== tD) {
          newAssign[cls] = { singleWeek: tS, doubleWeek: tD, week: '单周/双周' };
        } else if (tS) {
          newAssign[cls] = { teacher: tS, week: '通用' };
        } else if (tD) {
          newAssign[cls] = { teacher: tD, week: '通用' };
        }
      }
      
      mergedSlots.push({
        day: s?.day || d?.day,
        time: s?.time || d?.time,
        project: s?.project || d?.project,
        period: s?.period || d?.period,
        sheet: '单周/双周',
        assignments: newAssign
      });
    }
    
    const merged = {
      source: 'separate-files',
      days: single.days,
      slots: mergedSlots,
      classes: single.classes,
      single, double
    };
    
    // 只发送课后服务数据；总课表/校历等由后端沿用已有配置，避免误清空旧数据
    const importData = {
      afterSchoolService: merged
    };
    
    await doImport(importData);
    
    // 清空临时存储
    afterSchoolTemp = { single: null, double: null };
    const statusEl = $('afterschool-status');
    if (statusEl) statusEl.innerHTML = '';
    
    loading.remove();
    toast(`课后服务导入成功：${merged.days?.length||0} 天 ${merged.slots?.length||0} 时段`,'success');
  } catch(e) {
    loading.remove();
    toast('合并导入失败：'+e.message,'error');
  }
}

/**
 * 总课表解析 - 支持两种格式：
 * 1. 标准化格式（6列：教师姓名、星期、节次、班级、课程、教师）
 * 2. 原始总课表格式（每天21列，学科行+教师行）
 */
function parseTimetableWorkbook(wb) {
  // 优先找"总表"，否则用第一个 Sheet
  const sheetName = wb.SheetNames.includes('总表') ? '总表' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  
  // 调试信息
  const dbg = document.createElement('div');
  dbg.id = 'parse-debug';
  dbg.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:yellow;color:black;padding:8px;z-index:99999;font-size:11px;max-height:180px;overflow:auto;font-family:monospace';
  dbg.textContent = 'PARSING... sheet=' + sheetName;
  document.body.appendChild(dbg);
  
  // 先尝试解析为原始总课表格式
  const result = parseOriginalTimetableV2(ws);
  if (result) {
    dbg.textContent += ' | 识别为原始总课表格式: ' + result.classes.length + '班, ' + result.summary.totalSlots + '节课';
    setTimeout(() => { const e = document.getElementById('parse-debug'); if (e) e.remove(); }, 5000);
    return result;
  }
  
  // 回退到标准化格式
  const stdResult = parseStandardTimetable(ws);
  if (stdResult) {
    dbg.textContent += ' | 识别为标准格式: ' + stdResult.classes.length + '班';
    setTimeout(() => { const e = document.getElementById('parse-debug'); if (e) e.remove(); }, 5000);
    return stdResult;
  }
  
  dbg.textContent += ' | 解析失败';
  return null;
}

/**
 * 解析原始总课表格式 V2 - 使用 sheet_to_json
 */
function parseOriginalTimetableV2(ws) {
  // 读取所有数据（header:1 返回二维数组）
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows || rows.length < 10) return null;
  
  // 班级名在第3行（index 2），从第3列（index 2）开始
  const classRow = rows[2] || [];
  const classes = [];
  for (let c = 2; c < 23 && c < classRow.length; c++) {
    const cls = String(classRow[c] || '').trim();
    if (cls && cls !== 'null' && cls !== 'undefined') classes.push(cls);
  }
  if (classes.length === 0) return null;
  
  // 每天起始列（0-based index）
  const dayConfig = [
    { day: '星期一', startCol: 2 },   // C列
    { day: '星期二', startCol: 23 },  // X列
    { day: '星期三', startCol: 44 },  // AS列
    { day: '星期四', startCol: 65 },  // BN列
    { day: '星期五', startCol: 86 }   // CI列
  ];
  
  // 节次定义（0-based row index）
  const periodConfig = [
    { period: 1, subjectRow: 5, teacherRow: 6 },    // 第6,7行
    { period: 2, subjectRow: 7, teacherRow: 8 },    // 第8,9行
    { period: 3, subjectRow: 10, teacherRow: 11 },  // 第11,12行
    { period: 4, subjectRow: 12, teacherRow: 13 },  // 第13,14行
    { period: 5, subjectRow: 19, teacherRow: 20 },  // 第20,21行
    { period: 6, subjectRow: 21, teacherRow: 22 }   // 第22,23行
  ];
  
  const timetable = {};
  const teachers = new Set();
  const teacherAssignment = {};
  
  for (const { day, startCol } of dayConfig) {
    timetable[day] = {};
    
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const col = startCol + i;
      timetable[day][cls] = [];
      
      for (const { period, subjectRow, teacherRow } of periodConfig) {
        const subjectRowData = rows[subjectRow] || [];
        const teacherRowData = rows[teacherRow] || [];
        const subject = String(subjectRowData[col] || '').trim();
        const teacherRaw = String(teacherRowData[col] || '').trim();
        
        if (subject && subject !== 'null' && subject !== 'undefined') {
          // 拆分双教师（按换行/逗号/分号/全角半角空格）
          const teacherList = teacherRaw.split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t);
          const teacher = teacherList[0] || '';
          
          timetable[day][cls].push({
            period,
            subject,
            teacher: teacher || '',
            teachers: teacherList  // 保留完整列表备用
          });
          
          teacherList.forEach(t => teachers.add(t));
          if (teacher) {
            if (!teacherAssignment[cls]) teacherAssignment[cls] = {};
            teacherAssignment[cls][subject] = teacher;
          }
        }
      }
    }
  }
  
  const allTeachers = [...teachers];
  const totalSlots = Object.values(timetable).reduce(
    (sum, day) => sum + Object.values(day).reduce(
      (s, cls) => s + cls.length, 0
    ), 0
  );
  
  return {
    timetable,
    teacherAssignment,
    classes,
    allTeachers,
    summary: {
      classes: classes.length,
      teachers: allTeachers.length,
      totalSlots
    }
  };
}

/**
 * 解析标准化格式（6列表）
 */
function parseStandardTimetable(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!rows.length) return null;
  
  let headerRow = 0;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const r = rows[i] || [];
    if (r.some(c => /教师/.test(String(c))) && r.some(c => /班级|星期|节次|课程/.test(String(c)))) {
      headerRow = i; break;
    }
  }
  
  const header = (rows[headerRow] || []).map(c => String(c||'').trim());
  const findCol = re => { for (let i=0; i<header.length; i++) if (re.test(header[i])) return i; return -1; };
  
  let iTeacher = findCol(/教师姓名|姓名/);
  let iDay = findCol(/星期/);
  let iPeriod = findCol(/节次|第.*节/);
  let iClass = findCol(/班级/);
  let iSubject = findCol(/课程|科目/);
  
  // fallback: 6列格式
  if (iDay<0 && header.length === 6 && /^教师姓名|姓名$/.test(header[0])) {
    iTeacher = 0; iDay = 1; iPeriod = 2; iClass = 3; iSubject = 4;
  }
  
  if (iDay<0 || iClass<0 || iPeriod<0 || iSubject<0) return null;
  
  const timetable = {};
  const classes = new Set();
  const teachers = new Set();
  const teacherAssignment = {};
  
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const teacherRaw = String(r[iTeacher] || '').trim();
    const teacherList = teacherRaw.split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t);
    const teacher = teacherList[0] || '';
    const day = normDay(String(r[iDay] || '').trim());
    const period = parseInt(String(r[iPeriod] || '').replace(/[^\d]/g,'')) || 0;
    const cls = String(r[iClass] || '').trim();
    const subject = String(r[iSubject] || '').trim();
    
    if (!day || !cls || !period || !subject) continue;
    
    classes.add(cls);
    teacherList.forEach(t => teachers.add(t));
    
    if (!timetable[day]) timetable[day] = {};
    if (!timetable[day][cls]) timetable[day][cls] = [];
    timetable[day][cls].push({ period, subject, teacher, teachers: teacherList });
    
    if (teacher) {
      if (!teacherAssignment[cls]) teacherAssignment[cls] = {};
      teacherAssignment[cls][subject] = teacher;
    }
  }
  
  return {
    timetable, teacherAssignment,
    classes: [...classes], allTeachers: [...teachers],
    summary: {
      classes: classes.size,
      teachers: teachers.size,
      totalSlots: Object.values(timetable).reduce(
        (s,d) => s + Object.values(d).reduce((ss,p) => ss+p.length, 0), 0)
    }
  };
}

/**
 * 课后服务安排表解析
 * 列结构：[星期, 时间段, 空, 项目, 21 班教师...]
 */
function parseAfterSchoolWorkbook(wb) {
  console.log('[parseAfterSchoolWorkbook] All sheets:', wb.SheetNames);
  // 优先用「单周」/「双周」两个独立 Sheet（最准确的数据源）
  // 优先精确匹配 Sheet 名称，其次在 Sheet1 中按「单周」「双周」文件区分
  const sheetNames = wb.SheetNames;
  let singleSheet = sheetNames.find(n => /单周/.test(n) && !/双周/.test(n));
  let doubleSheet = sheetNames.find(n => /双周/.test(n) && !/单周/.test(n));
  // fallback：直接在 Sheet1 中解析（文件本身已区分单/双周）
  if (!singleSheet) singleSheet = 'Sheet1';
  if (!doubleSheet) doubleSheet = 'Sheet1';
  const hasSeparateSheets = singleSheet && doubleSheet;
  console.log('[parseAfterSchoolWorkbook] 单周 sheet:', singleSheet, '/ 双周 sheet:', doubleSheet);
  if (hasSeparateSheets) {
    const single = parseAfterSchoolSheet(wb.Sheets[singleSheet], '单周');
    const double = parseAfterSchoolSheet(wb.Sheets[doubleSheet], '双周');
    if (single && double) {
      // 合并单周/双周数据到统一的 slots 数组
      const mergedSlots = [];
      // 按 day+period 配对
      const slotKey = s => `${s.day}_${s.period}`;
      const singleMap = {};
      const doubleMap = {};
      for (const s of single.slots) singleMap[slotKey(s)] = s;
      for (const s of double.slots) doubleMap[slotKey(s)] = s;
      const allKeys = new Set([...Object.keys(singleMap), ...Object.keys(doubleMap)]);
      for (const key of allKeys) {
        const s = singleMap[key] || doubleMap[key];
        const d = doubleMap[key];
        const newAssign = {};
        for (const cls in (s?.assignments || {})) {
          const asnS = s.assignments[cls];
          const asnD = d?.assignments?.[cls];
          // 提取教师名字
          const tS = typeof asnS === 'object' ? (asnS.teacher || asnS.singleWeek) : asnS;
          const tD = typeof asnD === 'object' ? (asnD.teacher || asnD.singleWeek) : asnD;
          if (tS && tD && tS !== tD) {
            newAssign[cls] = { singleWeek: tS, doubleWeek: tD, week: '单周/双周' };
          } else if (tS) {
            newAssign[cls] = { teacher: tS, week: '通用' };
          }
        }
        mergedSlots.push({
          day: s.day,
          time: s.time,
          project: s.project,
          period: s.period,
          sheet: '单周/双周',
          assignments: newAssign
        });
      }
      return {
        source: 'separate-sheets',
        days: single.days,
        slots: mergedSlots,
        classes: single.classes,
        single, double
      };
    }
  }

  // 否则用 3.3执行 / 无午休 Sheet；同一单元格双教师 → 上一个=单周，下一个=双周
  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const base = parseAfterSchoolSheet(wb.Sheets[mainSheet], mainSheet);
  if (!base) return null;
  // 给 assignments 打 week 标记：双行拆分
  for (const slot of base.slots) {
    const newAssign = {};
    for (const cls in slot.assignments) {
      const v = slot.assignments[cls];
      // 提取教师名（可能是对象或字符串）
      let teachers = [];
      if (typeof v === 'object' && v !== null) {
        if (v.teacher) teachers.push(v.teacher);
        if (v.singleWeek) teachers.push(v.singleWeek);
        if (v.doubleWeek) teachers.push(v.doubleWeek);
      } else {
        teachers = String(v).split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t);
      }
      if (teachers.length === 1) {
        newAssign[cls] = { teacher: teachers[0], week: '通用' };
      } else if (teachers.length === 2) {
        newAssign[cls] = { singleWeek: teachers[0], doubleWeek: teachers[1], week: '单周/双周' };
      } else if (teachers.length > 0) {
        newAssign[cls] = { teacher: teachers[0], week: '通用' };
      }
    }
    slot.assignments = newAssign;
  }
  return { source: mainSheet, days: base.days, slots: base.slots, classes: base.classes };
}

function parseAfterSchoolSheet(ws, sheetName) {
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  if (!rows.length) return null;
  let headerRow = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const r = rows[i] || [];
    if (r.some(c => /星期/.test(String(c))) && r.some(c => /项目/.test(String(c)))) {
      headerRow = i; break;
    }
  }
  if (headerRow < 0) headerRow = 2;
  const header = (rows[headerRow] || []).map(c => String(c||'').trim());
  const classCols = [];
  for (let i = 0; i < header.length; i++) {
    // 匹配 "一1", "一（1）", "一(1)", "一 1" 等格式
    if (/[一二三四五六]/.test(header[i]) && /\d/.test(header[i])) {
      // 归一化名称为 "一（1）" 格式以匹配前端
      const m = header[i].match(/^([一二三四五六])\s*[（(]?\s*(\d+)\s*[）)]?\s*$/);
      if (m) {
        classCols.push({ idx: i, name: `${m[1]}（${m[2]}）` });
      } else {
        classCols.push({ idx: i, name: header[i] });
      }
    }
  }
  if (!classCols.length) return null;

  // 节次映射：课后服务1=7, 2=8, 3=9, 晚自习=10, 午休=11
  const PROJECT_PERIOD_MAP = {
    '课后服务1': 7,
    '课后服务2': 8,
    '课后服务3': 9,
    '晚自习': 10,
    '午休': 11
  };
  // 按时间段判断节次（处理"课后服务"不带数字的情况）
  const TIME_PERIOD_MAP = {
    '13:00': 11, '13：00': 11,
    '14:40': 7, '14：40': 7,  // 周五课后服务
    '15:40': 7, '15：40': 7,
    '16:25': 8, '16：25': 8,
    '17:10': 9, '17：10': 9,
    '19:30': 10, '19：30': 10
  };
  const getPeriod = (project, timeRange) => {
    if (PROJECT_PERIOD_MAP[project]) return PROJECT_PERIOD_MAP[project];
    // 从时间中提取开始小时:分钟
    const m = String(timeRange).match(/(\d{1,2})[:：]\d{2}/);
    if (m) {
      const key = m[0];
      return TIME_PERIOD_MAP[key] || 0;
    }
    return 0;
  };

  const slots = [];
  let currentDay = '';
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (r[0]) currentDay = normDay(String(r[0]).trim().replace(/\s/g,''));
    const timeRange = String(r[1] || '').trim();
    const project = String(r[3] || '').trim();
    if (!timeRange && !project) continue;
    
    // 映射节次
    const period = getPeriod(project, timeRange);
    if (!period) continue;
    
    // 存入时归一化星期：去掉空格/换行，转换为"星期一"格式
    const rawDay = String(r[0] || currentDay).trim();
    const normalizedDay = normDay(rawDay.replace(/\s/g, ''));
    const slot = { day: normalizedDay, time: timeRange, project, period, sheet: sheetName, assignments: {} };
    for (const c of classCols) {
      let v = r[c.idx];
      // 处理富文本/对象：只取文字
      if (v && typeof v === 'object') {
        if (v.richText) {
          v = v.richText.map(t => t.text || '').join('');
        } else {
          v = String(v);
        }
      }
      v = String(v || '').trim();
      if (!v || v === '[object Object]') continue;
      // 拆分双教师（按换行/中英文逗号/分号/任意空白字符）
      const parts = v.split(/[\n\r,，;；\s　]+/).map(t => t.trim()).filter(t => t);
      if (parts.length === 1) {
        slot.assignments[c.name] = { teacher: parts[0], week: '通用' };
      } else if (parts.length === 2) {
        // 记住：上一个名字 = 单周、下一个名字 = 双周
        slot.assignments[c.name] = { singleWeek: parts[0], doubleWeek: parts[1], week: '单周/双周' };
      } else if (parts.length > 2) {
        slot.assignments[c.name] = { teacher: parts[0], week: '通用' };
      }
    }
    slots.push(slot);
  }
  const days = [...new Set(slots.map(s => s.day).filter(Boolean))];
  return { sheet: sheetName, days, slots, classes: classCols.map(c=>c.name) };
}

async function handleTextImport() {
  const ta = $('import-textarea');
  if (!ta || !ta.value.trim()) { toast('请先粘贴数据','warning'); return; }
  try {
    const data = JSON.parse(ta.value);
    await doImport(data);
  } catch(e) {
    toast('JSON格式错误：'+e.message,'error');
  }
}

async function doImport(data) {
  if (!data.timetable && !data.classes && !data.calendar && !data.afterSchoolService && !data.clubActivities) {
    toast('数据格式不正确，缺少 timetable/classes/calendar/afterSchoolService/clubActivities','error'); return;
  }
  const loading = showLoading('正在导入...');
  try {
    const r = await API.importSchedule(data);
    loading.remove();
    if (r.success) {
      // ✅ 从后端重新加载完整数据（确保合并后的数据一致）
      await loadScheduleData();
      // 新学期导入新课表时，自动清空教师登录缓存，确保教师列表同步更新
      localStorage.removeItem('teachers_cache');
      toast(r.message || '导入成功！','success');
      renderImportPage($('main-content'));
    } else {
      toast('导入失败：'+r.error,'error');
    }
  } catch(e) {
    loading.remove();
    toast('网络错误','error');
  }
}

// ══════════════════════════════════════════════════════
//  通知设置页（管理员）
// ══════════════════════════════════════════════════════
function renderSettingsPage(area) {
  const cfg = JSON.parse(localStorage.getItem('notify_cfg') || '{}');
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('通知设置')}
    <h2 class="page-title">🔔 通知设置</h2>

    <div class="card">
      <h3>📱 企业微信通知</h3>
      <p class="text-muted">配置企业微信机器人 Webhook URL，有新请假/代课时会自动推送通知。</p>
      <div class="form-group">
        <label>Webhook URL</label>
        <input type="text" id="wx-webhook" class="form-input" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
               value="${esc(cfg.webhook||'')}">
      </div>
      <button class="btn btn-primary" onclick="saveNotifyCfg()">保存设置</button>
      <button class="btn btn-secondary" onclick="testWxNotify()">发送测试消息</button>
    </div>

    <div class="card">
      <h3>📧 邮件通知（可选）</h3>
      <div class="form-group">
        <label>管理员邮箱</label>
        <input type="email" id="notify-email" class="form-input" placeholder="admin@example.com"
               value="${esc(cfg.email||'')}">
      </div>
      <button class="btn btn-primary" onclick="saveNotifyCfg()">保存</button>
    </div>

    ${isAdmin ? `
    <div class="card">
      <h3>🔐 教师隐私密码管理</h3>
      <p class="text-muted">查看和重置教师的隐私密码。教师忘记密码时可在此重置。</p>
      <div id="teacher-pwd-list" style="margin:12px 0;">
        <p style="color:#6B7280; font-size:13px;">加载中...</p>
      </div>
      <div class="form-group" style="margin-top:12px;">
        <label>重置指定教师的密码</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="reset-teacher-name" class="form-input" placeholder="输入教师姓名" style="flex:1;">
          <button class="btn btn-warning" onclick="adminResetTeacherPwd()">重置</button>
        </div>
      </div>
      <button class="btn btn-secondary" onclick="loadTeacherPwdList()">刷新列表</button>
    </div>
    <script>loadTeacherPwdList();</script>` : ''}

    <div class="card">
      <h3>ℹ️ 关于本系统</h3>
      <p>施秉县双井镇中心小学 · 代课调课系统 v1.0</p>
      <p class="text-muted">基于云端数据库，支持多端同步。不依赖主机电脑，随时随地访问。</p>
      <p class="text-muted">默认管理员密码：<code>admin888</code></p>
    </div>
  </div>`;
}

function saveNotifyCfg() {
  const webhook = $('wx-webhook')?.value?.trim() || '';
  const email   = $('notify-email')?.value?.trim() || '';
  localStorage.setItem('notify_cfg', JSON.stringify({ webhook, email }));
  toast('设置已保存','success');
}

async function testWxNotify() {
  const cfg = JSON.parse(localStorage.getItem('notify_cfg') || '{}');
  if (!cfg.webhook) { toast('请先填写 Webhook URL','warning'); return; }
  try {
    const r = await fetch(cfg.webhook, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ msgtype:'text', text:{ content:'🔔 代课调课系统通知测试消息\n时间：'+new Date().toLocaleString('zh-CN') } })
    });
    if (r.ok) toast('测试消息发送成功','success');
    else toast('发送失败：'+r.status,'error');
  } catch(e) {
    toast('网络错误','error');
  }
}

// 管理员：加载设置了隐私密码的教师列表
async function loadTeacherPwdList() {
  const container = $('teacher-pwd-list');
  if (!container) return;
  
  container.innerHTML = '<p style="color:#6B7280; font-size:13px;">加载中...</p>';
  
  const result = await getTeachersWithPrivacyPwd();
  if (!result.success) {
    container.innerHTML = '<p style="color:#EF4444; font-size:13px;">加载失败：' + esc(result.error || '未知错误') + '</p>';
    return;
  }
  
  const teachers = result.teachersWithPassword || [];
  if (teachers.length === 0) {
    container.innerHTML = '<p style="color:#6B7280; font-size:13px;">暂无教师设置隐私密码</p>';
    return;
  }
  
  container.innerHTML = `
    <table class="data-table" style="font-size:13px;">
      <thead><tr><th>教师姓名</th><th>操作</th></tr></thead>
      <tbody>
        ${teachers.map(t => `
          <tr>
            <td>${esc(t)}</td>
            <td><button class="btn btn-sm btn-warning" onclick="adminResetTeacherPwd('${esc(t)}')">重置密码</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="color:#6B7280; font-size:12px; margin-top:8px;">共 ${teachers.length} 位教师设置了隐私密码</p>
  `;
}

// 管理员：重置教师隐私密码
async function adminResetTeacherPwd(teacherName) {
  if (!teacherName) {
    teacherName = $('reset-teacher-name')?.value?.trim();
  }
  if (!teacherName) {
    toast('请输入教师姓名', 'warning');
    return;
  }
  
  if (!confirm(`确定要重置 ${teacherName} 的隐私密码吗？\n重置后该教师查看请假记录和代课记录将不需要密码。`)) {
    return;
  }
  
  const result = await resetTeacherPrivacyPwd(teacherName);
  if (result.success) {
    toast(result.message, 'success');
    loadTeacherPwdList(); // 刷新列表
    if ($('reset-teacher-name')) $('reset-teacher-name').value = '';
  } else {
    toast(result.error || '重置失败', 'error');
  }
}

// ══════════════════════════════════════════════════════
//  初始化
// ══════════════════════════════════════════════════════
async function initApp() {
  // 恢复管理员身份
  const role = sessionStorage.getItem('role');
  if (role === 'admin') {
    isAdmin  = true;
    adminPwd = sessionStorage.getItem('adminPwd') || '';
  }

  document.body.innerHTML = renderAppShell();

  // 加载数据
  const [schR, leavesR, subsR, slipsR] = await Promise.all([
    API.getSchedule(), API.getLeaves(), API.getSubstitutes(), API.getLeaveSlips()
  ]);

  if (schR.success && schR.data && Object.keys(schR.data).length > 0) {
    scheduleData = {
      timetable: schR.data,
      teacherAssignment: schR.teacherAssignment || {},
      afterSchoolService: schR.afterSchoolService || {},
      calendar: schR.calendar || null,
      classes: schR.classes || [],
      allTeachers: schR.allTeachers || [],
      clubActivities: schR.clubActivities || null
    };
  } else if (schR.afterSchoolService || schR.calendar) {
    // 只有课后服务/校历数据
    scheduleData = {
      timetable: {},
      teacherAssignment: {},
      afterSchoolService: schR.afterSchoolService || {},
      calendar: schR.calendar || null,
      classes: [],
      allTeachers: [],
      clubActivities: schR.clubActivities || null
    };
  } else {
    // 尝试直接读 parsed_data.json
    try {
      const r = await fetch('parsed_data.json');
      if (r.ok) scheduleData = await r.json();
    } catch {}
  }

  leaveRecords = (leavesR.success ? leavesR.data : []) || [];
  substituteRecords = (subsR.success ? subsR.data : []) || [];
  slipRecords = (slipsR.success ? slipsR.data : []) || [];

  // 教师端：检查是否有新安排的代课任务，推送通知
  const myName = sessionStorage.getItem('teacherName') || '';
  if (!isAdmin && myName) {
    checkAndNotifyNewSubstitutes(myName);
  }

  switchPage('home');
}

// 检查并推送新安排的代课任务（教师端）
function checkAndNotifyNewSubstitutes(teacherName) {
  // 当前教师作为代课人的记录
  const mySubs = substituteRecords.filter(s => s.substituteTeacher === teacherName);
  if (mySubs.length === 0) return;

  // 已通知过的 ID 列表（存 localStorage，避免重复推送）
  const notifiedKey = 'notified_substitutes';
  const notified = JSON.parse(localStorage.getItem(notifiedKey) || '[]');

  // 筛选出新记录的代课任务（ID 未在 notified 中的）
  const newSubs = mySubs.filter(s => !notified.includes(s.id));
  if (newSubs.length === 0) return;

  // 1. 浏览器内弹窗推送（醒目）
  showSubstituteNotification(teacherName, newSubs);

  // 2. 记录已通知的 ID
  const newNotified = [...notified, ...newSubs.map(s => s.id)];
  localStorage.setItem(notifiedKey, JSON.stringify(newNotified));

  // 3. 如果配置了企业微信 Webhook，同时推送微信（可选）
  const notifyCfg = JSON.parse(localStorage.getItem('notify_cfg') || '{}');
  if (notifyCfg.wecom_webhook) {
    newSubs.forEach(s => {
      const msg = `【代课提醒】${teacherName}老师，您被安排代课：\n请假教师：${s.leaveTeacher}\n日期：${s.leaveDate}（${s.dayOfWeek||''}）\n班级：${s.className}\n科目：${s.subject||''}\n节次：第${s.period}节`;
      fetch(notifyCfg.wecom_webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: msg } })
      }).catch(e => console.warn('企业微信推送失败:', e));
    });
  }
}

// 浏览器内推送代课通知
function showSubstituteNotification(teacherName, subs) {
  const html = `
    <div style="text-align:left;">
      <p style="font-size:14px; color:#374151; margin:0 0 12px;">
        <strong style="color:#F59E0B;">📌 您被安排了新的代课任务！</strong>
      </p>
      ${subs.map(s => `
      <div style="background:#FEF3C7; border-left:3px solid #F59E0B; padding:10px 12px; margin-bottom:8px; border-radius:4px;">
        <div style="font-size:13px; color:#1F2937;">
          <div><strong>请假教师：</strong>${esc(s.leaveTeacher||'—')}</div>
          <div><strong>日期：</strong>${esc(s.leaveDate)} ${esc(s.dayOfWeek||'')}</div>
          <div><strong>班级：</strong>${esc(s.className||'—')}</div>
          <div><strong>科目：</strong>${esc(s.subject||'—')}</div>
          <div><strong>节次：</strong>第${s.period}节</div>
        </div>
      </div>
      `).join('')}
      <p style="font-size:12px; color:#6B7280; margin-top:12px;">共 ${subs.length} 条新代课任务</p>
    </div>
  `;
  showModal('🔔 代课通知', html);
}

// ── 启动 ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const role = sessionStorage.getItem('role');
  if (!role) {
    document.body.innerHTML = renderLogin();
    await loadTeacherList();
  } else {
    await initApp();
  }
});
