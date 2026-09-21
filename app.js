/**
 * school-substitute 代课调课系统 - 前端
 * 角色:管理员(需密码)/ 教师
 * 数据:课表、请假、代课安排
 */

// v148: 清理旧 Service Worker 缓存,避免"强刷归0/重开正常"陷阱
// 旧 sw.js (daiketiao-v84) 把静态资源用"网络优先、缓存备用"策略拦截;
// 强刷绕过 disk cache 但不绕过 SW → 仍命中旧缓存老响应 → 与真实 KV 不一致
// 启动时 unregister 所有 SW + 删所有 caches,确保新版永远 NetworkOnly
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister().catch(() => {}));
  }).catch(() => {});
}
if ('caches' in window) {
  caches.keys().then(keys => {
    keys.forEach(k => caches.delete(k).catch(() => {}));
  }).catch(() => {});
}

// ══════════════════════════════════════════════════════
//  全局状态
// ══════════════════════════════════════════════════════
let isAdmin   = false;
let adminPwd   = '';
let currentPage = 'login';
let scheduleData = null;   // { timetable, teacherAssignment, allTeachers, classes }
let leaveRecords = [];
let slipRecords = []; // 请假条(校长签字审批)
let leaveDurationMap = {}; // 本地缓存:leaveId → 请假时长(提交时写入,供列表/考勤导出用)
let isSubmittingLeave = false;  // 提交请假全局锁
// 需校长审批的假别(事假/病假 → 请假条+校长手写签字)
const PRINCIPAL_REVIEW_TYPES = ['事假', '病假'];
// 校长审批密码(默认值,会从 KV 加载实际值)
let principalPwd = 'principal888';
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
function wdayFull(d) { return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date(d + 'T00:00:00').getDay()]; }
// 转换为完整形式'星期一'以匹配系统数据
// 补课请假显示"六补五(双周)"格式
function formatWeekday(record) {
  if (!record) return '-';
  if (record.makeupDay) {
    const origDay = record.leaveDate ? wdayFull(record.leaveDate) : record.dayOfWeek || '';
    const origShort = origDay.replace('星期','').replace('周','');
    const makeupShort = record.makeupDay.replace('星期','').replace('周','');
    const parity = record.makeupParity === '单' ? '（单周）' : record.makeupParity === '双' ? '（双周）' : '';
    return origShort + '补' + makeupShort + parity;
  }
  // 补课场景(数据没存 makeupDay 但 dayOfWeek 已是工作日 且 leaveDate 是周末):
  // 用 leaveDate 反推原星期 + dayOfWeek 作为补的星期
  if (record.leaveDate && record.dayOfWeek) {
    const weekdayMap = { '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5 };
    const targetDow = weekdayMap[record.dayOfWeek];
    if (targetDow) {
      const base = new Date(record.leaveDate + 'T00:00:00');
      const curDow = base.getDay();
      if (curDow === 0 || curDow === 6) {
        const origShort = ['日','一','二','三','四','五','六'][curDow];
        const makeupShort = record.dayOfWeek.replace('星期','').replace('周','');
        return origShort + '补' + makeupShort;
      }
    }
  }
  return record.dayOfWeek || '-';
}

// 代课记录专用:从关联的请假记录取 leaveDate 计算原星期,保证显示「六补五」而非「五补五」
function formatSubstituteWeekday(s) {
  if (!s) return '-';
  const leaveMap = Object.fromEntries((leaveRecords || []).filter(l => l.id).map(l => [l.id, l]));
  const leave = s.leaveId ? leaveMap[s.leaveId] : null;
  if (leave && leave.makeupDay) {
    const origDay = leave.leaveDate ? wdayFull(leave.leaveDate) : leave.dayOfWeek || '';
    const origShort = origDay.replace('星期','').replace('周','');
    const makeupShort = leave.makeupDay.replace('星期','').replace('周','');
    const parity = leave.makeupParity === '单' ? '（单周）' : leave.makeupParity === '双' ? '（双周）' : '';
    return origShort + '补' + makeupShort + parity;
  }
  return formatWeekday(s);
}


function getTeacherClass(teacherName, leaveDate, period, forcedParity) {
  if (!teacherName || !scheduleData) return '-';
  if (period !== null && period !== undefined && period !== '' && period !== 'all') {
    const p = Number(period);
    if (p < 1 || p > 11) return '-';
  }
  const dow = leaveDate ? wdayFull(leaveDate) : null;
  if (!dow) return '-';

  // 计算 parity:优先用 forcedParity(教师手动选择),否则按 leaveDate 自动算
  let parity = null;
  if (forcedParity === '单') parity = 'single';
  else if (forcedParity === '双') parity = 'double';
  if (!parity) {
    const cal = scheduleData.calendar;
    if (cal && cal.startDate) {
      const start = new Date(cal.startDate + 'T00:00:00');
      const cur = new Date(leaveDate + 'T00:00:00');
      const days = Math.floor((cur - start) / (24 * 3600 * 1000));
      const weekNum = Math.floor(days / 7) + 1;
      parity = (weekNum % 2 === 1) ? 'single' : 'double';
    }
  }

  // 判断是查全天还是单节
  const wantAll = period === 'all' || period === null || period === undefined || period === '';

  // 正课表(period 1-6):timetable[day][className][slots]
  if (wantAll || Number(period) <= 6) {
    const dayData = scheduleData.timetable && scheduleData.timetable[dow];
    if (dayData) {
      if (wantAll) {
        // 查该教师当天所有正课节次对应的班级(去重)
        const classSet = new Set();
        for (const [cls, slots] of Object.entries(dayData)) {
          const arr = Array.isArray(slots) ? slots : [];
          for (const s of arr) {
            if (s && s.teacher === teacherName) {
              classSet.add(cls);
            }
          }
        }
        if (classSet.size > 0) return [...classSet].join('、');
      } else {
        for (const [cls, slots] of Object.entries(dayData)) {
          const arr = Array.isArray(slots) ? slots : [];
          const matched = arr.find(s => s && s.period == period);
          if (matched && matched.teacher === teacherName) return cls;
        }
      }
    }
  }

  // 课后服务段(period 7-11):afterSchoolService.slots[].assignments
  // wantAll 时:遍历该日所有课后服务节次
  const ass = scheduleData.afterSchoolService && scheduleData.afterSchoolService.slots;
  if (Array.isArray(ass)) {
    const targetSlots = wantAll
      ? ass.filter(s => s.day === dow)
      : ass.filter(s => s.day === dow && s.period == period);
    const classSet = new Set();
    for (const slot of targetSlots) {
      if (!slot || !slot.assignments) continue;
      for (const [cls, info] of Object.entries(slot.assignments)) {
        if (!info) continue;
        const isSingleDouble = info.singleWeek && info.doubleWeek;
        if (isSingleDouble) {
          // 单双周轮值:必须精确匹配 parity
          if (parity === 'single' && info.singleWeek === teacherName) classSet.add(cls);
          if (parity === 'double' && info.doubleWeek === teacherName) classSet.add(cls);
        } else if (info.teacher === teacherName) {
          // 固定教师
          classSet.add(cls);
        }
      }
    }
    if (classSet.size > 0) return [...classSet].join('、');
  }
  return '-';
}

// 从时间段获取节次(用于课后服务)
const AFTER_SCHOOL_PERIOD_MAP = {
  '13:00': 11, '13:00': 11,
  '14:40': 7, '14:40': 7,  // 周五课后服务
  '15:25': 8,  // 周五课后服务2
  '16:10': 9,  // 周五课后服务3
  '15:40': 7, '15:40': 7,
  '16:25': 8, '16:25': 8,
  '17:10': 9, '17:10': 9,
  '19:30': 10, '19:30': 10
};
function getPeriod(timeRange) {
  if (!timeRange) return 0;
  const t = String(timeRange).replace(/[：:]/g, ':');
  const m = t.match(/(\d{1,2}):\d{2}/);
  if (m) {
    const key = m[0];
    return AFTER_SCHOOL_PERIOD_MAP[key] || 0;
  }
  return 0;
}

// 周末补课请假专用：查补到那一天的班级（补周X时查 weekday 班而不是 weekend）
// makeupParity 为 '单'/'双' 时，用 period=null 查出该日所有班级并按 parity 过滤
function getClassForLeave(l) {
  if (!l) return '-';
  if (l.makeupDay) {
    const dow = l.makeupDay;  // '星期一' ~ '星期五'
    const weekdayMap = { '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5 };
    const targetDow = weekdayMap[dow];
    if (targetDow && l.leaveDate) {
      const base = new Date(l.leaveDate + 'T00:00:00');
      const curDow = base.getDay();
      const diff = targetDow - curDow;
      const makeupDate = new Date(base);
      makeupDate.setDate(base.getDate() + diff);
      // 用本地日期格式化(避免 toISOString 的 UTC 时区偏移,例如 6-19 CST 00:00 会变 6-18)
      const yyyy = makeupDate.getFullYear();
      const mm = String(makeupDate.getMonth() + 1).padStart(2, '0');
      const dd = String(makeupDate.getDate()).padStart(2, '0');
      const makeupDateStr = `${yyyy}-${mm}-${dd}`;
      // 查指定节次(单/双周按时传,未指定则让 getTeacherClass 按 makeupDateStr 自动算 parity)
      const forcedP = l.makeupParity || null;
      const result = getTeacherClass(l.teacherName, makeupDateStr, l.period, forcedP);
      if (result && result !== '-') return result;
    }
    return '-';
  }
  // 补课场景(数据没存 makeupDay 但 dayOfWeek 已是工作日):用 dayOfWeek 反查课表
  if (l.leaveDate && l.dayOfWeek) {
    const weekdayMap = { '星期一': 1, '星期二': 2, '星期三': 3, '星期四': 4, '星期五': 5 };
    const targetDow = weekdayMap[l.dayOfWeek];
    const base = new Date(l.leaveDate + 'T00:00:00');
    const curDow = base.getDay();
    if (targetDow && (curDow === 0 || curDow === 6)) {
      const diff = targetDow - curDow;
      const makeupDate = new Date(base);
      makeupDate.setDate(base.getDate() + diff);
      const yyyy = makeupDate.getFullYear();
      const mm = String(makeupDate.getMonth() + 1).padStart(2, '0');
      const dd = String(makeupDate.getDate()).padStart(2, '0');
      const makeupDateStr = `${yyyy}-${mm}-${dd}`;
      const result = getTeacherClass(l.teacherName, makeupDateStr, l.period, l.makeupParity || null);
      if (result && result !== '-') return result;
    }
  }
  return getTeacherClass(l.teacherName, l.leaveDate, l.period);
}

// 手机端返回栏(每个页面顶部显示)
function mobileBackBar(title) {
  if (currentPage === 'home' || currentPage === 'login') return '';
  return `<div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; padding:8px 0; border-bottom:1px solid #E5E7EB;">
    <button onclick="switchPage('home')" style="background:#EFF6FF; border:none; border-radius:6px; color:#3B82F6; font-size:13px; font-weight:500; cursor:pointer; padding:6px 12px; display:flex; align-items:center; gap:4px;">← 返回首页</button>
    <span style="font-size:15px; font-weight:600; color:#374151;">${title}</span>
  </div>`;
}

// 教师隐私密码管理(后端存储)
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

// 验证教师隐私密码(通过后端验证)
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

// 获取所有设置了隐私密码的教师(管理员用)
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
        <p style="margin:8px 0 0; color:#6B7280; font-size:13px;">${hasPwd ? '修改或取消隐私密码' : '设置隐私密码后,查看请假记录和代课记录需要验证'}</p>
      </div>
      <div style="padding:20px;">
        ${hasPwd ? `<div style="margin-bottom:12px;"><input type="password" id="privacy-old-pwd" class="form-input" placeholder="原密码(不修改请留空)" style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;"></div>` : ''}
        <div style="margin-bottom:12px;"><input type="password" id="privacy-new-pwd" class="form-input" placeholder="新密码(留空则取消密码)" style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;"></div>
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

// 教师端:显示自己的请假记录(只读弹窗)
async function showMyLeaves() {
  const currentTeacher = sessionStorage.getItem('teacherName');
  if (!currentTeacher) return;

  await showPrivacyVerifyModal(currentTeacher, () => {
    const myLeaves = leaveRecords.filter(l => l.teacherName === currentTeacher);

    const content = myLeaves.length === 0 ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无请假记录</p>' :
      `<table class="data-table"><thead><tr><th>日期</th><th>星期</th><th>班级</th><th>节次</th><th>假别</th><th>原因</th><th>状态</th></tr></thead><tbody>` +
      myLeaves.map(l => {
        const st = l.status==='approved' ? '✅已批准' : (l.status==='pending_principal' ? '⏳待校长签字' : (l.status==='rejected' ? '❌已拒绝' : '⏳待审批'));
        return `<tr><td>${fmtDate(l.leaveDate)}</td><td>${formatWeekday(l)}</td><td>${getClassForLeave(l)}</td><td>${l.period ? '第'+l.period+'节' : '全天'}</td><td>${esc(l.leaveType||'-')}</td><td>${esc(l.reason||'-')}</td><td>${st}</td></tr>`;
      }).join('') +
      `</tbody></table>`;

    showModal('我的请假记录', content);
  }, '请假记录');
}

// 教师端:显示自己的代课记录(只读弹窗)
async function showMySubstitutes() {
  const currentTeacher = sessionStorage.getItem('teacherName');
  if (!currentTeacher) return;

  await showPrivacyVerifyModal(currentTeacher, () => {
    // 我请假的由别人代课,或我帮别人代课
    const mySubstitutes = substituteRecords.filter(s =>
      s.leaveTeacher === currentTeacher || s.substituteTeacher === currentTeacher
    ).sort((a,b)=>{const da=a.leaveDate||'',db=b.leaveDate||'';if(!da&&db)return 1;if(da&&!db)return -1;if(da!==db)return da<db?-1:1;return(parseInt(a.period)||0)-(parseInt(b.period)||0);});

    const content = mySubstitutes.length === 0 ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无代课记录</p>' :
      `<table class="data-table"><thead><tr><th>类型</th><th>日期</th><th>星期</th><th>班级</th><th>科目</th><th>节次</th><th>对方教师</th></tr></thead><tbody>` +
      mySubstitutes.map(s => {
        const isMyLeave = s.leaveTeacher === currentTeacher;
        const type = isMyLeave ? '<span style="color:#F59E0B;">被代课</span>' : '<span style="color:#10B981;">代他人</span>';
        const otherTeacher = isMyLeave ? s.substituteTeacher : s.leaveTeacher;
        const dow = formatSubstituteWeekday(s);
        return `<tr data-sub-id="${s.id}"><td>${type}</td><td>${fmtDate(s.leaveDate)}</td><td>${dow}</td><td>${esc(s.className)}</td><td>${esc(s.subject||'-')}</td><td>第${s.period}节</td><td>${esc(otherTeacher||'-')}</td></tr>`;
      }).join('') +
      `</tbody></table>`;

    showModal('我的代课记录', content);
  }, '代课记录');
}

// 管理员:查看所有历史代课记录(可删除)
function showAdminSubstituteHistory() {
  if (!isAdmin) {
    toast('无权访问', 'error');
    return;
  }

  const records = (substituteRecords || []).slice().sort((a,b)=>{const da=a.leaveDate||'',db=b.leaveDate||'';if(!da&&db)return 1;if(da&&!db)return -1;if(da!==db)return da<db?-1:1;return(parseInt(a.period)||0)-(parseInt(b.period)||0);});
  const content = records.length === 0
    ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无代课记录</p>'
    : `<table class="data-table"><thead><tr><th>日期</th><th>星期</th><th>请假教师</th><th>代课教师</th><th>班级</th><th>科目</th><th>节次</th><th>操作</th></tr></thead><tbody>` +
      records.map(s => `
        <tr data-sub-id="${s.id}">
          <td>${fmtDate(s.leaveDate)}</td>
          <td>${formatSubstituteWeekday(s)}</td>
          <td>${esc(s.leaveTeacher)}</td>
          <td>${esc(s.substituteTeacher)}</td>
          <td>${esc(s.className)}</td>
          <td>${esc(s.subject || '-')}</td>
          <td>第${s.period}节</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteSubstituteFromModal('${s.id}')">删除</button></td>
        </tr>
      `).join('') +
      `</tbody></table>`;

  showModal('代课记录历史(管理员)', content);
}

// 管理员:查看所有请假记录(可删除)
function showAdminLeaveHistory() {
  if (!isAdmin) {
    toast('无权访问', 'error');
    return;
  }

  const records = leaveRecords || [];
  const content = records.length === 0
    ? '<p style="text-align:center; color:#6B7280; padding:20px;">暂无请假记录</p>'
    : `<table class="data-table"><thead><tr><th>教师</th><th>班级</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>` +
      records.map(l => {
        const statusMap = { 'pending': '<span style="color:#F59E0B;">待审批</span>', 'pending_principal': '<span style="color:#EF4444;">待校长签字</span>', 'approved': '<span style="color:#10B981;">已批准</span>', 'rejected': '<span style="color:#EF4444;">已拒绝</span>' };
        return `<tr>
          <td>${esc(l.teacherName)}</td>
          <td>${getClassForLeave(l)}</td>
          <td>${fmtDate(l.leaveDate)}</td>
          <td>${formatWeekday(l)}</td>
          <td>${l.period ? '第'+l.period+'节' : '-'}</td>
          <td>${esc(l.reason || '-')}</td>
          <td>${statusMap[l.status] || l.status}</td>
          <td><button class="btn btn-sm btn-danger" onclick="deleteLeaveFromModal('${l.id}')">删除</button></td>
        </tr>`;
      }).join('') +
      `</tbody></table>`;

  showModal('请假记录(管理员)', content);
}

// 从弹窗删除请假记录(仅管理员,删除后刷新弹窗)
async function deleteLeaveFromModal(id) {
  if (!isAdmin) { toast('仅管理员可删除','warning'); return; }
  if (!confirm('确认删除这条请假记录?')) return;
  try {
    const r = await fetch(`/api/leaves/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-pwd': adminPwd }
    });
    const data = await r.json();
    if (data.success) {
      toast('删除成功','success');
      leaveRecords = leaveRecords.filter(l => l.id !== id);
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
      showAdminLeaveHistory();
    } else {
      toast(data.error || '删除失败','error');
    }
  } catch (e) {
    toast('网络错误: ' + e.message,'error');
  }
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
//  请假条 + 手写签字板(Canvas)
// ══════════════════════════════════════════════════════

// 初始化一个手写签字板,返回 { getDataUrl, clear, isEmpty }
function initSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  // 高分辨率适配:按 CSS 尺寸设置实际像素,保证签字清晰
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

  const sigPad = {
    getDataUrl: () => hasInk ? canvas.toDataURL('image/png') : '',
    clear: () => {
      ctx.setTransform(1, 0, 0, 1, 1, 1);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      hasInk = false;
    },
    isEmpty: () => !hasInk,
    setInk: (value) => { hasInk = !!value; },
    paint: (dataUrl) => paintSignatureOnCanvas(canvas, dataUrl)
  };
  canvas._sigPad = sigPad; // 暴露引用供外部调用
  return sigPad;
}

// ══════════════════════════════════════════════════════
//  签名库(localStorage 保存本地手写签名,最多 10 个)
// ══════════════════════════════════════════════════════
const SIG_LIB_MAX = 10;

function getSigLibKey(scope) {
  // scope = 'teacher' | 'principal'
  return scope === 'principal' ? 'principalSigs' : 'teacherSigs';
}

// 签名库上下文(模块级,避免 onclick 字符串转义问题)
let _sigCtx = { scope: 'teacher', name: '' };
// 签名库内存缓存,按 scope|name 缓存,避免每次打开都请求 API
const _sigCache = {};
function _sigCacheKey(scope, name) { return scope + '|' + (name || ''); }
function setSigCtx(scope, name) { _sigCtx = { scope, name: name || '' }; }
function sigScopeName(scope) {
  if (scope === 'principal') return '';
  return (_sigCtx.name || (sessionStorage.getItem('teacherName') || '').trim());
}

function sigHeaders() {
  const h = { 'Content-Type': 'application/json' };
  // 注意: 浏览器 fetch 拒绝非 ISO-8859-1 字符的 header 值,
  // 故不能直接把中文教师名放到 x-teacher-name 里(会报 non ISO-8859-1 code point)。
  // 后端(签名 API)只检查该 header 是否存在(教师登录态凭证),值是什么无关紧要,
  // 所以用 ASCII '1' 作为存在性占位符;真实姓名由 body/query 传递(后端作存储键)。
  if ((sessionStorage.getItem('teacherName') || '').trim()) h['x-teacher-name'] = '1';
  if (adminPwd) h['x-admin-pwd'] = adminPwd;
  if (principalPwd) h['x-principal-pwd'] = principalPwd;
  return h;
}

// 读取签名库(异步,云端 KV),结果缓存到 _sigCache
async function loadSigLib(scope, name) {
  const key = _sigCacheKey(scope, name);
  try {
    const params = scope === 'principal' ? '?scope=principal' : ('?scope=teacher&name=' + encodeURIComponent(name || ''));
    const r = await fetch('/api/signatures' + params, { headers: sigHeaders() });
    const j = await r.json();
    if (j.success) { _sigCache[key] = Array.isArray(j.data) ? j.data : []; return _sigCache[key]; }
  } catch (e) { console.warn('读取签名库失败', e); }
  return [];
}

// 保存一条签名(异步,云端 KV),同步更新缓存
async function addToSigLib(scope, name, sigName, dataUrl) {
  try {
    const r = await fetch('/api/signatures', {
      method: 'POST',
      headers: sigHeaders(),
      body: JSON.stringify({ scope, name: name || '', action: 'add', sigName, dataUrl })
    });
    const j = await r.json();
    if (j.success) {
      const key = _sigCacheKey(scope, name || '');
      _sigCache[key] = Array.isArray(j.data) ? j.data : (_sigCache[key] || []);
    }
    return !!j.success;
  } catch (e) { console.warn('保存签名失败', e); return false; }
}

// 删除一条签名(异步,云端 KV),同步更新缓存
async function removeFromSigLib(scope, name, id) {
  try {
    const r = await fetch('/api/signatures', {
      method: 'POST',
      headers: sigHeaders(),
      body: JSON.stringify({ scope, name: name || '', action: 'delete', id })
    });
    const j = await r.json();
    if (j.success) {
      const key = _sigCacheKey(scope, name || '');
      if (_sigCache[key]) _sigCache[key] = _sigCache[key].filter(e => e.id !== id);
    }
    return !!j.success;
  } catch (e) { console.warn('删除签名失败', e); return false; }
}

// 将已有签名渲染到签字板上(供"选择签名"使用)
function paintSignatureOnCanvas(canvas, dataUrl) {
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    // 重置画布,保留原有 dpr 缩放逻辑
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 1, 1);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    const rect = canvas.getBoundingClientRect();
    // 适应画布高度保持比例
    const maxH = rect.height - 8;
    const maxW = rect.width - 8;
    let w = img.width, h = img.height;
    if (h > maxH) { w = w * maxH / h; h = maxH; }
    if (w > maxW) { h = h * maxW / w; w = maxW; }
    const x = (rect.width - w) / 2;
    const y = (rect.height - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  };
  img.src = dataUrl;
}

// 纯渲染:根据已加载的 lib 生成 HTML(不再内部读取)
function renderSigPickerHTML(scope, lib) {
  if (!lib || lib.length === 0) {
    return `<span style="font-size:12px; color:#9CA3AF;">暂无保存的签名</span>`;
  }
  const items = lib.map(e => `
    <div class="sig-lib-item" data-sigid="${esc(e.id)}" style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border:1px solid #E5E7EB; border-radius:6px; margin-bottom:4px; background:#fff;">
      <div style="display:flex; align-items:center; gap:8px; flex:1; cursor:pointer;" onclick="onPickSavedSig('${esc(scope)}','${esc(e.id)}')">
        <img src="${e.dataUrl}" style="height:28px; max-width:120px; object-fit:contain; background:#fff; border:1px solid #F3F4F6; border-radius:4px;">
        <span style="font-size:13px;">${esc(e.name)}</span>
      </div>
      <button type="button" onclick="onDeleteSavedSig('${esc(scope)}','${esc(e.id)}')" style="background:none; border:none; color:#EF4444; cursor:pointer; font-size:14px; padding:0 4px;" title="删除此签名">×</button>
    </div>
  `).join('');
  return `<div class="sig-lib-list" style="max-height:200px; overflow-y:auto; padding:4px;">${items}</div>`;
}

// 异步刷新签名库面板(在 DOM 中查找 .sig-lib-host 并填充)
async function refreshSigLibUI(scope, name) {
  const host = document.querySelector('.sig-lib-host');
  if (!host) return;
  host.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:8px;">加载中...</div>';
  const lib = await loadSigLib(scope, name);
  if (host) host.innerHTML = renderSigPickerHTML(scope, lib);
}

// 供 HTML onclick 调用:选中已保存签名 -> 渲染到当前打开的签字板
window.onPickSavedSig = function(scope, id) {
  // 优先从缓存快速渲染(无网络延迟),同时静默刷新最新数据
  const name = sigScopeName(scope);
  const key = _sigCacheKey(scope, name);
  const cached = _sigCache[key];
  const entry = cached ? cached.find(e => e.id === id) : null;
  if (entry) {
    const canvas = document.querySelector('.modal-overlay canvas#slip-canvas') || document.querySelector('.modal-overlay canvas#principal-canvas');
    if (canvas) { paintSignatureOnCanvas(canvas, entry.dataUrl); if (canvas._sigPad) canvas._sigPad.setInk(true); }
    toast('✓ 已加载签名:"' + entry.name + '"', 'success');
  }
  // 静默刷新(保证点击到最新保存的签名)
  loadSigLib(scope, name);
};

window.onDeleteSavedSig = async function(scope, id) {
  if (!confirm('确认删除此签名?')) return;
  await removeFromSigLib(scope, sigScopeName(scope), id);
  const name = sigScopeName(scope);
  const host = document.querySelector('.sig-lib-host');
  if (host) host.innerHTML = renderSigPickerHTML(scope, _sigCache[_sigCacheKey(scope, name)] || []);
};

window.toggleSigPicker = function(btn, scope, name) {
  setSigCtx(scope, name);
  const modal = btn.closest('.modal-overlay') || document;
  let host = modal.querySelector('.sig-lib-host');
  if (host) {
    host.remove();
    btn.textContent = '📂 选择签名';
    return;
  }
  host = document.createElement('div');
  host.className = 'sig-lib-host';
  host.style.cssText = 'margin-top:8px; padding:8px; background:#F9FAFB; border:1px solid #E5E7EB; border-radius:6px;';
  host.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:8px;">加载中...</div>';
  const row = btn.parentElement;
  row.parentElement.insertBefore(host, row.nextSibling);
  btn.textContent = '📂 收起签名库';
  // 优先从缓存立即渲染,避免等 API 延迟;同时静默拉最新
  // 注意:函数参数 name 已存在(onclick 传入的教师名),不重复声明
  const sigName = sigScopeName(scope);
  const key = _sigCacheKey(scope, sigName);
  if (!_sigCache[key]) {
    host.innerHTML = '<div style="font-size:12px;color:#9CA3AF;padding:8px;">加载中...</div>';
    loadSigLib(scope, sigName).then(lib => {
      if (host) host.innerHTML = renderSigPickerHTML(scope, lib);
    });
  } else {
    host.innerHTML = renderSigPickerHTML(scope, _sigCache[key]);
    loadSigLib(scope, sigName); // 静默刷新
  }
};

window.saveSigToLib = async function(btn, scope, canvasId, name) {
  setSigCtx(scope, name);
  const modal = btn.closest('.modal-overlay');
  const canvas = modal.querySelector('#' + canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let hasInk = false;
  for (let i = 3; i < data.length; i += 4) { if (data[i] > 0) { hasInk = true; break; } }
  if (!hasInk) { toast('请先在签字板上签名', 'error'); return; }
  const dataUrl = canvas.toDataURL('image/png');
  const sigName = prompt('给这个签名起个名字:', scope === 'principal' ? '校长签字' : '本人签字');
  if (!sigName) return;
  const ok = await addToSigLib(scope, sigScopeName(scope), sigName.trim(), dataUrl);
  toast(ok ? '✓ 已保存到签名库' : '保存失败', ok ? 'success' : 'error');
  // 若签名库面板已打开,直接用最新缓存刷新(避免再等一次 API)
  // 注意:函数参数 name 已存在(onclick 传入的教师名),不重复声明;sigName 已被 prompt 占用
  const scopeName = sigScopeName(scope);
  if (modal.querySelector('.sig-lib-host')) {
    const host = modal.querySelector('.sig-lib-host');
    if (host) host.innerHTML = renderSigPickerHTML(scope, _sigCache[_sigCacheKey(scope, scopeName)] || []);
  }
};

// 教师提交请假条弹窗(事假/病假)
// 计算请假时长(工作日天数,跳过周六日);老数据无 duration 时兜底显示用
function calcLeaveDays(startDate, endDate) {
  if (!startDate) return 1;
  const s = new Date(startDate);
  const e = new Date(endDate || startDate);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
  let days = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  return days || 1;
}

function showLeaveSlipModal({ leaveIds, teacherName, leaveType, reason, startDate, endDate, duration }) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:88vh; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">📄 请假条(事假/病假需校长审批)</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px; overflow-y:auto; max-height:70vh;">
        <div class="form-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="form-group" style="grid-column:1/-1">
            <label>教师姓名</label>
            <input type="text" id="slip-teacher" value="${esc(teacherName)}" readonly class="form-input" style="background:#F3F4F6;">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>假别</label>
            <input type="text" id="slip-leave-type" value="${esc(leaveType||'')}" readonly class="form-input" style="background:#F3F4F6;">
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>请假时长(天)*</label>
            <select id="slip-duration" class="form-input">
              <option value="0.3">0.3 天(1节)</option>
              <option value="0.5">0.5 天</option>
              <option value="1">1 天</option>
              <option value="1.5">1.5 天</option>
              <option value="2">2 天</option>
              <option value="2.5">2.5 天</option>
              <option value="3">3 天</option>
              <option value="3.5">3.5 天</option>
              <option value="4">4 天</option>
              <option value="5">5 天</option>
              <option value="6">6 天</option>
              <option value="7">7 天</option>
              <option value="10">10 天</option>
              <option value="15">15 天</option>
              <option value="30">30 天</option>
            </select>
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
            <label>本人签字 *(请用鼠标/手指在框内签名)</label>
            <div style="border:2px dashed #CBD5E1; border-radius:8px; overflow:hidden; background:#FAFAFA;">
              <canvas id="slip-canvas" style="width:100%; height:140px; display:block; touch-action:none; cursor:crosshair;"></canvas>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
              <button type="button" id="slip-clear" class="btn btn-sm">✖ 清空重签</button>
              <button type="button" class="btn btn-sm" style="background:#F3F4F6; color:#374151;" onclick="toggleSigPicker(this,'teacher','${esc(teacherName)}')">📂 选择签名</button>
              <button type="button" class="btn btn-sm" style="background:#F3F4F6; color:#374151;" onclick="saveSigToLib(this,'teacher','slip-canvas','${esc(teacherName)}')">💾 保存到签名库</button>
            </div>
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
  // 预填请假时长:传入值优先;多天按工作日数,单日默认 1(用户可改)
  const durSel = modal.querySelector('#slip-duration');
  if (durSel) {
    let dv = duration;
    if (dv == null) {
      dv = (startDate && endDate && startDate !== endDate) ? calcLeaveDays(startDate, endDate) : 1;
    }
    const opts = Array.from(durSel.options).map(o => o.value);
    if (!opts.includes(String(dv))) {
      const opt = document.createElement('option');
      opt.value = dv; opt.textContent = dv + ' 天';
      durSel.appendChild(opt);
    }
    durSel.value = String(dv);
  }
  const canvas = modal.querySelector('#slip-canvas');
  const pad = initSignaturePad(canvas);
  modal.querySelector('#slip-clear').onclick = () => pad.clear();

  modal.querySelector('#slip-submit').onclick = async () => {
    const reasonV = modal.querySelector('#slip-reason').value.trim();
    const durationV = modal.querySelector('#slip-duration').value;
    const startV = modal.querySelector('#slip-start').value;
    const endV = modal.querySelector('#slip-end').value;
    const sig = pad.getDataUrl();
    if (!reasonV) { modal.querySelector('#slip-msg').textContent = '请填写请假事由'; return; }
    if (!startV || !endV) { modal.querySelector('#slip-msg').textContent = '请选择开始和结束日期'; return; }
    if (pad.isEmpty()) { modal.querySelector('#slip-msg').textContent = '请先签名'; return; }
    const btn = modal.querySelector('#slip-submit');
    btn.disabled = true; btn.textContent = '提交中...';
    try {
      const r = await fetch('/api/leave-slips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaveIds, teacherName, leaveType: leaveType, reason: reasonV, startDate: startV, endDate: endV, duration: durationV, signature: sig })
      });
      const j = await r.json();
      if (j.success) {
        modal.remove();
        toast('✅ 请假条已提交,等待校长审批', 'success');
        // 刷新本地 slipRecords,避免校长审批页看不到刚提交的请假条
        try { const sr = await fetch('/api/leave-slips', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } }); const sj = await sr.json(); if (sj.success) slipRecords = sj.data || []; } catch {}
      } else {
        modal.querySelector('#slip-msg').textContent = j.error || '提交失败';
        btn.disabled = false; btn.textContent = '✍️ 提交请假条';
      }
    } catch (err) {
      modal.querySelector('#slip-msg').textContent = '网络错误:' + (err.message || err);
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

    // 匹配:姓名包含 或 拼音首字母包含
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
      // 教师:只看自己的请假条;管理员/校长:看全部(管理员需要密码)
      const headers = {};
      const myName = sessionStorage.getItem('teacherName') || '';
      if (myName && !isAdmin && !principalAuthed) headers['x-teacher-name'] = myName;
      if (isAdmin) headers['x-admin-pwd'] = adminPwd;
      if (principalAuthed) headers['x-principal-pwd'] = principalPwd;
      const r = await fetch('/api/leave-slips', { headers });
      return await r.json();
    } catch { return { success:false, data:[] }; }
  },
  async previewSubstitutes() {
    // 只预览,不保存
    const r = await fetch('/api/substitutes/generate?preview=true', {
      method:'POST', headers:{'Content-Type':'application/json','x-admin-pwd':adminPwd}
    });
    return await r.json();
  },
  async generateSubstitutes() {
    // 预览+保存(兼容旧调用)
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
      <p class="login-subtitle" id="v186-sn-login">施秉县双井镇中心小学</p>
      <div class="login-tabs">
        <button class="tab-btn active" onclick="setLoginMode('teacher')">教师入口</button>
        <button class="tab-btn" onclick="setLoginMode('admin')">管理员入口</button>
        <button class="tab-btn" onclick="setLoginMode('principal')">审批入口</button>
      </div>
      <div id="login-form-area">
        <div id="teacher-login">
          <p class="login-hint">请选择您的姓名(支持拼音首字母搜索)</p>
          <div class="teacher-search-box">
            <input type="text" id="teacher-search-input" class="form-input" placeholder="输入拼音首字母或姓名搜索..." autocomplete="off" name="teacher_search_no_autofill" data-lpignore="true" data-1p-ignore="true">
            <div id="teacher-search-dropdown" class="search-dropdown" style="display:none;"></div>
          </div>
          <input type="hidden" id="login-teacher-select" value="">
        </div>
        <div id="admin-login" style="display:none">
          <p class="login-hint">请输入管理员密码</p>
          <input type="password" id="login-pwd" class="form-input" placeholder="输入管理员密码" autocomplete="new-password"
                 onkeydown="if(event.key==='Enter')handleAdminLogin()">
          <button class="btn btn-primary btn-block" onclick="handleAdminLogin()">登录</button>
        </div>
        <div id="principal-login" style="display:none">
          <p class="login-hint">请输入校长密码</p>
          <input type="password" id="principal-pwd-input-login" class="form-input" placeholder="输入校长密码" autocomplete="new-password"
                 onkeydown="if(event.key==='Enter')handlePrincipalLogin()">
          <button class="btn btn-primary btn-block" onclick="handlePrincipalLogin()">进入审批</button>
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
  $('principal-login').style.display = mode === 'principal' ? 'block' : 'none';
  if (mode === 'teacher') loadTeacherList();
}

function handleTeacherLogin(teacherName) {
  if (!teacherName) return;
  isAdmin = false;
  principalAuthed = false;
  sessionStorage.setItem('role','teacher');
  sessionStorage.setItem('teacherName', teacherName);
  sessionStorage.removeItem('principalAuthed');
  currentPage = 'home';
  initApp();
}

function handleAdminLogin() {
  const pwd = $('login-pwd').value.trim();
  if (!pwd) return toast('请输入密码','warning');
  // 验证管理员密码
  if (pwd !== 'admin888') {
    return toast('密码错误,请重新输入','error');
  }
  adminPwd = pwd;
  isAdmin = true;
  principalAuthed = false;
  sessionStorage.setItem('role','admin');
  sessionStorage.setItem('adminPwd', pwd);
  sessionStorage.removeItem('principalAuthed');
  currentPage = 'home';
  toast('管理员登录成功','success');
  initApp();
}

async function handlePrincipalLogin() {
  const pwd = $('principal-pwd-input-login').value.trim();
  if (!pwd) return toast('请输入密码','warning');
  try {
    const r = await fetch('/api/principal-pwd', { headers: { 'x-principal-pwd': pwd } });
    if (r.ok) {
      const j = await r.json();
      if (j.success) {
        principalPwd = j.data.password; // 从 KV 加载实际密码
        isAdmin = false;
        principalAuthed = true;
        sessionStorage.setItem('role','principal');
        sessionStorage.setItem('principalAuthed','1');
        sessionStorage.setItem('principalPwd', principalPwd); // 存密码供 initApp 恢复
        currentPage = 'principal';
        toast('校长登录成功','success');
        initApp();
      } else {
        toast(j.error || '验证失败','error');
      }
    } else if (r.status === 401) {
      toast('密码错误,请重新输入','error');
    } else {
      toast('网络错误','error');
    }
  } catch (err) {
    toast('网络错误:' + (err.message || err),'error');
  }
}

async function loadTeacherList() {
  // 优先从 localStorage 缓存加载教师列表(缓存 24 小时内有效,保证名单变更能刷新)
  let teachers = [];
  const cached = localStorage.getItem('teachers_cache');
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      if (Array.isArray(obj)) {
        teachers = []; // 旧格式(纯数组)→ 视为过期,重新拉取
      } else if (Array.isArray(obj.t)) {
        teachers = (obj.ts && Date.now() - obj.ts <= 24 * 3600 * 1000) ? obj.t : [];
      } else {
        teachers = [];
      }
    } catch { teachers = []; }
  }
  if (teachers.length === 0) {
    const r = await API.getSchedule();
    if (r && r.success && r.allTeachers) {
      teachers = r.allTeachers;
      localStorage.setItem('teachers_cache', JSON.stringify({ t: teachers, ts: Date.now() }));
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
  const role = isAdmin ? 'admin' : (principalAuthed ? 'principal' : 'teacher');
  const roleLabel = isAdmin ? '🔐 管理员' : (principalAuthed ? '🏫 校长' : '👤 教师');
  // 计算待处理请假数量(已批准但未安排代课的)
  const pendingSubs = leaveRecords.filter(l => l.status === 'approved' && l.needSubstitute !== false).length;
  const subBadge = (isAdmin && pendingSubs > 0) ? `<span class="nav-badge">${pendingSubs}</span>` : '';
  // 待处理请假数量(pending + pending_principal,用于请假登记按钮徽章)
  const pendingLeaves = leaveRecords.filter(l => l.status === 'pending' || l.status === 'pending_principal').length;
  const leaveBadge = (isAdmin && pendingLeaves > 0) ? `<span class="nav-badge" style="background:#EF4444;">${pendingLeaves}</span>` : '';
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
    slip: '请假条管理',
    settings: '通知设置',
    shared: '共享文件夹'
  };
  const currentTitle = pageTitles[currentPage] || '代课调课系统';
  const showBackBtn = currentPage !== 'home';
  return `
  <div class="app-shell">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar-left">
        <span class="topbar-icon">🏫</span>
        <span class="topbar-title" id="v186-sn-topbar">施秉县双井镇中心小学</span>
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
          ${!principalAuthed ? `
          <button class="nav-btn" data-page="home"    onclick="switchPage('home')">🏠 首页</button>
          <button class="nav-btn" data-page="tt"      onclick="switchPage('tt')">📅 课表查询</button>
          <button class="nav-btn" data-page="leave"   onclick="switchPage('leave')">🏖️ 请假登记${leaveBadge}</button>
<button class="nav-btn" data-page="shared" onclick="switchPage('shared')">📁 共享文件夹</button>
          ` : ''}
          ${principalAuthed ? `<button class="nav-btn" data-page="principal" onclick="switchPage('principal')">✍️ 校长审批${principalBadge}</button>` : ''}
          ${isAdmin ? `
          <div class="sidebar-section-title" style="margin-top:16px">⚙️ 管理员</div>
          <button class="nav-btn" data-page="import"  onclick="switchPage('import')">📤 导入课表</button>
          <button class="nav-btn" data-page="slip"    onclick="switchPage('slip')">📄 请假条管理</button>
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
  else if (page === 'slip')    renderSlipPage(area);
  else if (page === 'settings') renderSettingsPage(area);
  else if (page === 'shared') renderSharedPage(area);
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

  // 获取当前教师姓名(教师端)
  const currentTeacher = sessionStorage.getItem('teacherName') || '';

  // 教师端:只显示自己的已批准请假
  const myLeaves = currentTeacher ? leaveRecords.filter(l => l.teacherName === currentTeacher && l.status === 'approved') : [];
  const mySubstitutes = currentTeacher ? substituteRecords.filter(s => s.leaveTeacher === currentTeacher || s.substituteTeacher === currentTeacher) : [];

  // 教师端显示欢迎语,管理员端显示系统概览
  const pageTitle = (!isAdmin && currentTeacher)
    ? `👋 欢迎,${esc(currentTeacher)}老师`
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
      <div class="stat-card" onclick="switchPage('tt')" style="cursor:pointer;">
        <div class="stat-icon">📅</div>
        <div class="stat-num">—</div>
        <div class="stat-label">课表查询</div>
      </div>
    </div>

    <!-- v149 共享文件夹入口(所有登录角色可见) -->
    <div class="home-big-card home-shared-entry" style="border-left:4px solid #8B5CF6; background:linear-gradient(135deg,#F5F3FF,#EEF2FF);" onclick="switchPage('shared')">
      <div class="home-big-icon">📁</div>
      <div class="home-big-text">
        <div class="home-big-title">共享文件夹</div>
        <div class="home-big-sub">上传 / 下载学校共享文件(教案·课件·通知)</div>
      </div>
    </div>

    ${hasData && !principalAuthed ? `
    <div class="home-big-card" onclick="switchPage('leave')">
      <div class="home-big-icon">🏖️</div>
      <div class="home-big-text">
        <div class="home-big-title">请假登记</div>
        <div class="home-big-sub">点击填写请假申请</div>
      </div>
    </div>` : ''}

    ${!principalAuthed ? `
    <div class="home-pair">
      <div class="home-half-card" onclick="${isAdmin ? 'showAdminLeaveHistory()' : 'showMyLeaves()'}">
        <div class="home-half-icon">🏖️</div>
        <div class="home-half-num">${isAdmin ? leaveRecords.length : myLeaves.length}</div>
        <div class="home-half-label">请假记录</div>
      </div>
      <div class="home-half-card" onclick="${isAdmin ? 'showAdminSubstituteHistory()' : 'showMySubstitutes()'}">
        <div class="home-half-icon">✅</div>
        <div class="home-half-num">${isAdmin ? substituteRecords.length : mySubstitutes.length}</div>
        <div class="home-half-label">代课记录</div>
      </div>
    </div>` : ''}

    ${!hasData && isAdmin ? `
    <div class="alert alert-warn">
      ⚠️ 课表未导入,请先<span onclick="switchPage('import')" class="link">导入课表</span>
    </div>` : ''}

    ${hasData ? `
    <div class="quick-actions admin-quick">
      ${isAdmin ? `
      <button class="action-card" onclick="switchPage('sub')">
        <span class="action-icon">✅</span>
        <span class="action-label">代课安排</span>
      </button>
      <button class="action-card" onclick="switchPage('slip')">
        <span class="action-icon">📄</span>
        <span class="action-label">请假条管理</span>
      </button>
      <button class="action-card" onclick="switchPage('import')">
        <span class="action-icon">📤</span>
        <span class="action-label">导入课表</span>
      </button>
      <button class="action-card" onclick="showResetPrincipalPwdModal()">
        <span class="action-icon">🔑</span>
        <span class="action-label">重置校长密码</span>
      </button>` : ''}
      ${principalAuthed ? `
      <button class="action-card principal-big-card" onclick="switchPage('principal')">
        <span class="action-icon">📋</span>
        <span class="action-label">校长审批</span>
      </button>` : ''}
    </div>` : ''}

    ${(!isAdmin && !principalAuthed) ? `
    <div class="home-privacy-row">
      <button class="action-card" onclick="showSetPrivacyPwdModal()">
        <span class="action-icon">🔐</span>
        <span class="action-label">隐私设置</span>
      </button>
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

  // 管理员端 / 校长端:Tab 2 改为「按教师查看」;教师端:保持「我的课表」
  const tab2Label = (isAdmin || principalAuthed) ? '按教师查看' : '我的课表';
  const tab2Disabled = (isAdmin || principalAuthed) ? false : !myName; // 管理员/校长不disabled,教师没 myName 才 disabled

  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('课表查询')}
    <h2 class="page-title">📅 课表查询</h2>

    <div class="view-toggle">
      <button class="tab-btn active" onclick="setTTView('class',this)">按班级查看</button>
      <button class="tab-btn" onclick="setTTView('my',this)" ${tab2Disabled?'disabled':''}>${tab2Label}</button>
    </div>

    <div id="tt-class-view">
      <div class="form-row">
        <label>选择班级:</label>
        <select id="tt-class-sel" class="form-select" onchange="renderTTClass()">
          <option value="">- 选择班级 -</option>
          ${cls.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div id="tt-class-content"></div>
    </div>

    <div id="tt-my-view" style="display:none">
      ${(isAdmin || principalAuthed) ? `
      <div class="form-row" style="position:relative;">
        <label>教师姓名:</label>
        <input type="text" id="tt-teacher-input" class="form-input"
               placeholder="输入教师姓名..."
               oninput="onTeacherNameInput(this.value)"
               onblur="onTeacherNameBlur()"
               style="width:200px;">
        <div id="tt-teacher-suggest" class="suggest-list" style="display:none;"></div>
      </div>` : (myName ? `<h3>👤 ${esc(myName)} 老师的课表</h3>` : '')}
      <div id="tt-my-content"></div>
    </div>
  </div>`;
}

let ttView = 'class';

function setTTView(v, btn) {
  ttView = v;
  document.querySelectorAll('.view-toggle .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  $('tt-class-view').style.display  = v === 'class' ? 'block' : 'none';
  $('tt-my-view').style.display     = v === 'my'    ? 'block' : 'none';
  if (v === 'my') {
    // 管理员不传参,等用户输入;教师直接传 myName
    const myName = sessionStorage.getItem('teacherName') || '';
    if (!isAdmin && myName) renderTTMy(myName);
  } else renderTTClass();
}

// 教师姓名输入模糊匹配(管理员端课表查询)
let ttTeacherInputTimer = null;
function onTeacherNameInput(val) {
  clearTimeout(ttTeacherInputTimer);
  ttTeacherInputTimer = setTimeout(() => {
    const suggest = $('tt-teacher-suggest');
    if (!suggest) return;
    val = val.trim();
    if (!val) { suggest.style.display = 'none'; return; }
    const teas = scheduleData?.allTeachers || [];
    const matches = teas.filter(t => t.includes(val)).slice(0, 8); // 最多显示 8 条
    if (matches.length === 0) {
      suggest.innerHTML = '<div class="suggest-item" style="color:#9CA3AF;">未找到匹配教师</div>';
      suggest.style.display = 'block';
      return;
    }
    suggest.innerHTML = matches.map(t => `<div class="suggest-item" onclick="pickTeacherName('${esc(t)}')">${esc(t)}</div>`).join('');
    suggest.style.display = 'block';
  }, 150);
}

function onTeacherNameBlur() {
  // 延迟隐藏,让 onclick 事件能触发
  setTimeout(() => {
    const suggest = $('tt-teacher-suggest');
    if (suggest) suggest.style.display = 'none';
  }, 200);
}

function pickTeacherName(name) {
  const input = $('tt-teacher-input');
  if (input) input.value = name;
  const suggest = $('tt-teacher-suggest');
  if (suggest) suggest.style.display = 'none';
  renderTTMy(name);
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
  // 普通时间映射(周一~周四)
  const timeMap = {
    1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00',
    5:'14:00-14:40', 6:'14:50-15:30',
    7:'课后服务1', 8:'课后服务2', 9:'课后服务3',
    10:'晚自习', 11:'午休'
  };
  // 星期五特殊时间映射(下午不同)
  const fridayTimeMap = {
    1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00',
    5:'13:00-13:40', 6:'13:50-14:30',
    7:'14:40-15:20', 8:'15:25-16:50'
  };
  // 获取某天的节次时间
  const getTime = (day, p) => day === '星期五' ? (fridayTimeMap[p] || '-') : (timeMap[p] || '-');
  // 某天的课后服务最大节次(周五只到第8节社团活动,无 9-11节)
  const maxAfterSchoolPeriod = (day) => day === '星期五' ? 9 : 11;
  // 课后服务时间映射(周一~周四,课后服务时间一致)
  const afterSchoolTimeMap = { 7:'15:40-16:20', 8:'16:25-17:05', 9:'17:10-17:50', 10:'19:30-20:30', 11:'13:00-13:50' };
  // 星期五课后服务时间映射(只有两节)
  const fridayAfterSchoolTimeMap = { 7:'14:40-15:20', 8:'15:25-16:05', 9:'16:10-16:50' };
  // 课后服务时间:周五用 fridayAfterSchoolTimeMap,其余用 afterSchoolTimeMap
  const getAfterSchoolTime = (day, period) => day === '星期五' ? (fridayAfterSchoolTimeMap[period] || '-') : (afterSchoolTimeMap[period] || '-');

  // 获取课后服务的班级数据
  const normDay = (s) => {
    // 去除换行、空格、中文字符,只保留"星"+"期"+"数字"
    const cleaned = String(s || '').replace(/[\s\n\r]/g, '');
    const m = cleaned.match(/星\s*期\s*([一二三四五六日])/);
    if (!m) return cleaned;
    return '星期' + m[1];
  };
  // 归一化:去掉所有空白字符后比较(Excel单元格可能含全角空格/换行)
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

  // 获取课后服务教师(显示单周/双周)
  const getAfterSchoolTeacher = (day, period) => {
    const slot = getAfterSchoolSlot(day, period);
    if (!slot) return null;
    const assignments = slot.assignments || {};
    // 班级名归一化:去除全角括号、空格、"班"字
    const normalize = (s) => String(s || '').replace(/[\s(())班]/g, '');
    const targetKey = normalize(cn);
    // 尝试精确匹配 + 归一化匹配
    for (const key in assignments) {
      if (key === cn || normalize(key) === targetKey) {
        let asn = assignments[key];
        // 运行时补上:如果是拼接教师名,按空白/逗号/分号拆分转单周/双周
        if (asn && asn.teacher && typeof asn.teacher === 'string') {
          const parts = asn.teacher.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t);
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

  // 常规课程(1-6节)
  for (const p of [1,2,3,4,5,6]) {
    html += `<tr><td>第${p}节</td>`;
    for (const d of days) {
      const slots = tt[d]?.[cn] || [];
      const slot = slots.find(s => s.period === p);
      const t = getTime(d, p);
      html += `<td>
        <div class="time-cell">${t}</div>
        <div class="${slot ? 'has-class' : 'empty-cell'}">
          ${slot ? `<span class="subj">${esc(slot.subject||'')}</span><br><span class="tea">${esc(slot.teacher||'')}</span>` : '-'}
        </div>
      </td>`;
    }
    html += `</tr>`;
  }

  // 课后服务(每行只在该天有节次时渲染)
  // 星期一~周四:7-11节;星期五:7-8节
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
    // 课后服务行节次列:仅节次名字(时间已合并到内容格"名字上方")
    html += `<tr class="afterschool-row"><td class="period-cell">第${p}节</td>`;
    for (const d of days) {
      // 该天没这节次显示空白
      if (!afterschoolPeriodsByDay[d].includes(p)) {
        html += `<td class="empty-cell afterschool-cell">-</td>`;
        continue;
      }
      const t = getTime(d, p);
      const asn = getAfterSchoolTeacher(d, p);
      // 星期五第8节特殊处理:只显示时间,不显示具体安排
      if (d === '星期四' && (p === 8 || p === 9)) {
        html += `<td class="afterschool-cell special-club">
          <div class="time-cell">${getAfterSchoolTime(d, p)}</div>
          <span class="subj">特色社团活动</span>
        </td>`;
        continue;
      }
      // 内容格:名字上方显示「时间+项目名」
      // 周五课后服务(P7/P8/P9)用 fridayAfterSchoolTimeMap 取正确时间,并补全「课后服务1/2/3」标签
      let timeLabel;
      if (d === '星期五') {
        const asTime = getAfterSchoolTime(d, p);
        const asName = afterSchoolName[p] || '';
        timeLabel = asName ? `${asTime} ${asName}` : asTime;
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
        html += `<div class="empty-cell afterschool-cell">-</div>`;
      }
      html += `</td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  area.innerHTML = html;
}

function renderTTMy(teacherName) {
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const afterSchool = td.afterSchoolService || {};
  // 管理员传参;教师用 sessionStorage
  const myName = teacherName || sessionStorage.getItem('teacherName') || '';
  const area = $('tt-my-content');
  if (!area) return;
  if (!myName) { area.innerHTML = '<p class="text-muted">请输入教师姓名</p>'; return; }

  // 顶部工具条:「社团活动」按钮
  const toolbar = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
    <button class="btn btn-club-table" onclick="showClubTable()">🎯 社团活动</button>
  </div>`;

  const days = ['星期一','星期二','星期三','星期四','星期五'];
  const dayOrder = d => days.indexOf(d);

  // 正课时间映射(周一~周四)
  const timeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'14:00-14:40', 6:'14:50-15:30' };
  // 星期五特殊时间
  const fridayTimeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'13:00-13:40', 6:'13:50-14:30', 7:'14:40-15:20', 8:'15:25-16:50' };
  // 根据天和节次返回时间
  const getTime = (day, p) => day === '星期五' ? (fridayTimeMap[p] || '-') : (timeMap[p] || '-');
  // 课后服务时间映射(周一~周四)
  const afterSchoolTimeMap = { 7:'15:40-16:20', 8:'16:25-17:05', 9:'17:10-17:50', 10:'19:30-20:30', 11:'13:00-13:50' };
  // 星期五课后服务时间映射(只有两节)
  const fridayAfterSchoolTimeMap = { 7:'14:40-15:20', 8:'15:25-16:05', 9:'16:10-16:50' };
  // 课后服务名称
  const afterSchoolName = { 7:'课后服务1', 8:'课后服务2', 9:'课后服务3', 10:'晚自习', 11:'午休' };
  // 课后服务时间取:根据星期取对应映射,没有再回退原 slot.time
  const getAfterSchoolTime = (day, period, fallback) => day === '星期五' ? (fridayAfterSchoolTimeMap[period] || fallback || '-') : (afterSchoolTimeMap[period] || fallback || '-');

  // 收集正课
  const mySlots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cn, slots] of Object.entries(classMap)) {
      const arr = Array.isArray(slots) ? slots : [];
      for (const s of arr) {
        if (s && s.teacher === myName) mySlots.push({ day, className: cn, ...s, isAfterSchool: false });
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
        if (!assign) continue;
        // 双教师场景:存储为 { singleWeek, doubleWeek };单教师场景:{ teacher }
        // 这里把三种字段都拆成候选人名,避免单/双周老师的课在个人课表里丢失
        const candidates = [];
        if (assign.teacher) {
          assign.teacher.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t).forEach(t => candidates.push({ name: t, week: assign.week || '通用' }));
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
    // 星期四第8节特殊处理:显示"特色社团活动"(数据里周四 R21 是"社团活动")
    let subjectLabel = esc(s.subject);
    if (s.day === '星期四' && s.period === 8 && s.isAfterSchool) {
      subjectLabel = '特色社团活动';
    }
    // 计算实际时间:优先用 slot.time,否则根据星期动态查
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
  // 教师端只显示自己的请假记录;管理员看全部
  const currentTeacher = (sessionStorage.getItem('teacherName') || '').trim();
  const displayLeaves = isAdmin ? leaveRecords : (currentTeacher ? leaveRecords.filter(l => l.teacherName === currentTeacher) : []);

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
              <option value="">- 选择教师 -</option>
              ${teas.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
            </select>` :
            `<input type="text" name="teacherName" value="${esc(sessionStorage.getItem('teacherName')||'')}" readonly class="form-input">`
            }
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>请假类型 *</label>
            <select name="leaveType" id="leave-type" class="form-select" onchange="toggleLeaveType(this.value)">
              <option value="single">单日请假(选具体节次)</option>
              <option value="range">连续多天(全天)</option>
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1">
            <label>假别 *</label>
            <select name="leaveKind" id="leave-kind" class="form-select">
              <option value="事假">事假(需校长签字审批)</option>
              <option value="病假">病假(需校长签字审批)</option>
              <option value="婚假">婚假</option>
              <option value="丧假">丧假</option>
              <option value="公假">公假</option>
              <option value="育儿假">育儿假</option>
              <option value="产检假">产检假</option>
              <option value="其他">其他</option>
            </select>
            <p style="margin:4px 0 0; font-size:12px; color:#6B7280;">事假/病假需填写请假条并经校长手写签字审批后,方可安排代课</p>
          </div>
          <div id="single-leave">
            <div class="form-group">
              <label>请假日期 *</label>
              <input type="date" name="leaveDate" id="leave-date-single" class="form-input" value="${now()}" onchange="updateLeaveWday(this)">
            </div>
            <div class="form-group">
              <label>星期</label>
              <div style="display:flex; gap:8px;">
                <input type="text" name="dayOfWeek" readonly class="form-input" id="leave-wday" value="${wday(now())}" style="flex:1;">
                <select id="makeup-day" class="form-select" style="display:none; width:100px;" onchange="updateMakeupDisplay()">
                  <option value="">- 补 -</option>
                  <option value="星期一">补周一</option>
                  <option value="星期二">补周二</option>
                  <option value="星期三">补周三</option>
                  <option value="星期四">补周四</option>
                  <option value="星期五">补周五</option>
                </select>
                <select id="makeup-parity" class="form-select" style="display:none; width:90px;" onchange="updateMakeupDisplay()">
                  <option value="">- 周次 -</option>
                  <option value="单">单周</option>
                  <option value="双">双周</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>请假节次 *</label>
              <div style="position:relative;">
<input type="text" id="leave-period" class="form-input" readonly placeholder="- 选择节次(可多选)-" onclick="togglePeriodDropdown()" onblur="closePeriodDropdown()">
<div id="leave-period-panel" onmousedown="event.preventDefault()" style="display:none; position:absolute; top:calc(100% + 4px); left:0; right:0; z-index:99; background:#fff; border:1px solid #E5E7EB; border-radius:8px; padding:6px; max-height:260px; overflow-y:auto; box-shadow:0 4px 12px rgba(0,0,0,0.12);">
<label style="display:block; padding:7px 8px; border-radius:6px; cursor:pointer; font-size:14px; background:#F0FDF4;"><input type="checkbox" name="period" value="none" onclick="updatePeriodText()" style="accent-color:#10B981;"> 无课(仅登记,不安排代课)</label>
<div style="padding:6px 8px; font-size:12px; color:#9CA3AF; border-top:1px solid #E5E7EB; margin-top:4px;">正课</div>
${[1,2,3,4,5,6].map(p => `<label style="display:block; padding:7px 8px; border-radius:6px; cursor:pointer; font-size:14px;"><input type="checkbox" name="period" value="${p}" onclick="updatePeriodText()" style="accent-color:#3B82F6;"> 第${p}节</label>`).join("")}
<div style="padding:6px 8px; font-size:12px; color:#9CA3AF; border-top:1px solid #E5E7EB; margin-top:4px;">课后服务</div>
${[7,8,9,10,11].map(p => { const names = {"7":"课后服务1","8":"课后服务2","9":"课后服务3","10":"晚自习","11":"午休"}; return `<label style="display:block; padding:7px 8px; border-radius:6px; cursor:pointer; font-size:14px;"><input type="checkbox" name="period" value="${p}" onclick="updatePeriodText()" style="accent-color:#3B82F6;"> 第${p}节 ${names[p]}</label>`; }).join("")}
<label style="display:block; padding:7px 8px; border-radius:6px; cursor:pointer; font-size:14px; background:#EFF6FF; margin-top:4px; border-top:1px solid #E5E7EB;"><input type="checkbox" name="period" value="all" onclick="updatePeriodText()" style="accent-color:#3B82F6;"> 全天(按课表自动判断)</label>
</div>
</div>
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
            <input type="text" name="reason" class="form-input" placeholder="如:出差、培训、急事">
          </div>
        </div>
        <button type="submit" class="btn btn-primary">提交请假</button>
      </form>
    </div>

    ${(() => {
      // 管理员只显示待处理的请假记录(pending / pending_principal)
      // 教师端只显示待批准的记录(未 approved)
      const pendingLeaves = isAdmin
        ? leaveRecords.filter(l => l.status === 'pending' || l.status === 'pending_principal')
        : displayLeaves.filter(l => l.status !== 'approved');
      const showLeaves = pendingLeaves;
      return `
    <div class="card">
      <div class="card-header">
        <h3>${isAdmin ? '⏳ 待处理请假' : '⏳ 待批准请假'} (${showLeaves.length})</h3>
        ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="clearAllLeaves()">清空</button>` : ''}
      </div>
      ${showLeaves.length > 0 ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>班级</th><th>日期</th><th>星期</th><th>节次</th><th>时长</th><th>假别/原因</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${showLeaves.map(l => `
            <tr class="${l.status==='approved'?'row-approved':''}">
              <td>${esc(l.teacherName)}</td>
              <td>${getClassForLeave(l)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${formatWeekday(l)}</td>
              <td>${l.period === 'all' ? '全天' : (l.period ? '第'+l.period+'节' : '-')}</td>
              <td>${l.duration != null ? l.duration : (leaveDurationMap[l.id] != null ? leaveDurationMap[l.id] : (l.period === 'all' || !l.period ? calcLeaveDays(l.leaveDate, l.leaveDate) : 1))} 天</td>
              <td>${esc(l.leaveType||'-')}${l.needSubstitute === false ? ' <span class="badge badge-blue">仅登记</span>' : ''}${l.reason ? '<br><span style="font-size:12px;color:#9CA3AF;">'+esc(l.reason)+'</span>' : ''}</td>
              <td><span class="badge badge-${l.status==='approved'?'green':l.status==='rejected'?'red':l.status==='pending_principal'?'blue':'yellow'}">${l.status==='pending_principal'?'待校长签字':(l.status||'待审核')}</span></td>
              <td>
                ${isAdmin ? `<button class="btn btn-sm btn-success" onclick="approveLeave('${l.id}')" ${l.status==='pending_principal'?'disabled title="事假/病假需先经校长签字"':''}>批准</button>` : ''}
                ${(isAdmin || l.status!=='approved') ? `<button class="btn btn-sm btn-danger"  onclick="deleteLeave('${l.id}')">删除</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<p class="text-muted">${isAdmin ? '暂无待处理的请假记录' : '暂无请假记录'}</p>`}
    </div>`;
    })()}
  </div>`;
}

// 旧的 formatMakeupDay 已删除:补课请假记录的星期栏直接显示 makeupDay(如"星期五"),不拼接"补"字

function updateLeaveWday(el) {
  const w = $('leave-wday');
  const m = $('makeup-day');
  const p = $('makeup-parity');
  if (w) w.value = wday(el.value);
  // 周末时显示"补周几"和"单/双周"下拉框
  if (m) {
    const d = new Date(el.value + 'T00:00:00');
    const day = d.getDay();
    if (day === 0 || day === 6) {
      m.style.display = '';
      m.value = '';
      if (p) { p.style.display = ''; p.value = ''; }
    } else {
      m.style.display = 'none';
      m.value = '';
      if (p) { p.style.display = 'none'; p.value = ''; }
    }
  }
}

function updateMakeupDisplay() {
  const w = $('leave-wday');
  const m = $('makeup-day');
  const p = $('makeup-parity');
  if (!w || !m) return;
  const makeup = m.value;
  const parity = p ? p.value : '';
  if (makeup) {
    // 显示如"六补三(单)"或"六补三"
    const shortDay = w.value.replace('星期', '').replace('周', '');
    const shortMakeup = makeup.replace('星期', '').replace('周', '');
    w.value = shortDay + '补' + shortMakeup + (parity ? '(' + parity + ')' : '');
  }
}

function toggleLeaveType(type) {
  $('single-leave').style.display = type === 'single' ? '' : 'none';
  $('range-leave').style.display = type === 'range' ? '' : 'none';
}

function togglePeriodDropdown() {
  const p = $('leave-period-panel');
  if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function closePeriodDropdown() {
  setTimeout(() => { const p = $('leave-period-panel'); if (p) p.style.display = 'none'; }, 150);
}

function updatePeriodText() {
  const boxes = document.querySelectorAll('#leave-period-panel input[name="period"]:checked');
  const t = $('leave-period');
  if (!t) return;
  const values = Array.from(boxes).map(b => b.value);
  // 互斥逻辑:选了"无课"就不能选其他;选了其他就取消"无课"
  const hasNone = values.includes('none');
  const hasOthers = values.some(v => v !== 'none');
  if (hasNone && hasOthers) {
    // 当前点击的是 none → 取消其他;否则取消 none
    const clicked = event?.target?.value;
    if (clicked === 'none') {
      boxes.forEach(b => { if (b.value !== 'none') b.checked = false; });
    } else {
      boxes.forEach(b => { if (b.value === 'none') b.checked = false; });
    }
  }
  // 重新计算
  const finalBoxes = document.querySelectorAll('#leave-period-panel input[name="period"]:checked');
  const labels = [];
  finalBoxes.forEach(b => {
    if (b.value === 'all') labels.push('全天');
    else if (b.value === 'none') labels.push('无课(仅登记)');
    else labels.push('第' + b.value + '节');
  });
  t.value = labels.join('、');
}

// 根据课表获取教师某天的有课节次
// dateStr 可选(YYYY-MM-DD):传入后启用单/双周自动判定 + period 11 修正
function getTeacherPeriods(teacherName, dayOfWeek, dateStr, forcedParity) {
  const periods = [];
  if (!scheduleData) return periods;
  // 解析单/双周(优先查 calendar.weeks,回退按 startDate + 周数计算)
  let parity = null;
  if (dateStr) {
    const cal = scheduleData.calendar;
    if (cal && Array.isArray(cal.weeks)) {
      for (const w of cal.weeks) {
        if (Array.isArray(w.days) && w.days.some(d => d && d.date === dateStr)) {
          parity = (w.parity === 'double') ? 'double' : 'single';
          break;
        }
      }
    }
    if (!parity && cal && cal.startDate) {
      const start = new Date(cal.startDate + 'T00:00:00');
      const cur = new Date(dateStr + 'T00:00:00');
      const days = Math.floor((cur - start) / (24 * 3600 * 1000));
      const weekNum = Math.floor(days / 7) + 1;
      parity = (weekNum % 2 === 1) ? 'single' : 'double';
    }
  }
  if (forcedParity) parity = forcedParity;  // 补课场景:明确指定单/双周

  // 1. 扫描正课表(1-6节)
  const dayData = scheduleData.timetable?.[dayOfWeek];
  if (dayData) {
    for (const [className, slots] of Object.entries(dayData)) {
      for (const slot of slots) {
        if (slot && slot.teacher === teacherName && slot.period) {
          periods.push(parseInt(slot.period));
        }
      }
    }
  }

  // 2. 扫描课后服务表(7-11节:课后服务1/2/3 + 晚自习 + 午休)
  const afterSlots = scheduleData.afterSchoolService?.slots || [];
  for (const slot of afterSlots) {
    if (normDay(slot.day) !== normDay(dayOfWeek)) continue;
    if (!slot.period || slot.period < 7 || slot.period > 11) continue;
    const assignments = slot.assignments || {};
    for (const [cls, asn] of Object.entries(assignments)) {
      if (!asn) continue;
      const isSingleDouble = Boolean(typeof asn.singleWeek === 'string' && asn.singleWeek && typeof asn.doubleWeek === 'string' && asn.doubleWeek);
      let matches = false;
      if (!isSingleDouble) {
        // 通用周:asn.teacher 直接匹配
        matches = asn.teacher === teacherName;
      } else if (parity) {
        // 单/双周型:按当前周次匹配对应侧的教师(支持中文'单/双'和英文'single/double')
        if ((parity === 'single' || parity === '单') && asn.singleWeek === teacherName) matches = true;
        if ((parity === 'double' || parity === '双') && asn.doubleWeek === teacherName) matches = true;
      } else {
        // 无日期可用:为兼容旧调用,退化为双侧都计入(避免漏判)
        matches = (asn.singleWeek === teacherName || asn.doubleWeek === teacherName);
      }
      if (matches) {
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
  // 防重复点击:全局锁 + 按钮锁双层保护
  if (isSubmittingLeave || (submitBtn && submitBtn.disabled)) {
    toast('正在提交中,请勿重复点击', 'warning');
    return;
  }
  isSubmittingLeave = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.origText = submitBtn.textContent;
    submitBtn.textContent = '提交中...';
  }
  try {
  // 确保课表数据已加载
  if (!scheduleData || !scheduleData.timetable) {
    await API.getSchedule();
  }
  const fd  = new FormData(form);
  const leaveType = fd.get('leaveType');
  const leaveKind = fd.get('leaveKind') || '其他'; // 假别:事假/病假/婚假/丧假/公假/其他
  const teacherName = fd.get('teacherName');
  const reason = fd.get('reason');
  // 事假/病假 → 必须走校长签字流程(不管身份)。其他假别:admin 直接批准,教师待审。
  const status = PRINCIPAL_REVIEW_TYPES.includes(leaveKind) ? 'pending_principal' : (isAdmin ? 'approved' : 'pending');

  // 预填请假时长:单日按有课节次推断(1节=0.3天/2-3节=0.5天/4节+=1天/无课=1天),连续多天按工作日(跳过周六日)。
  // 弹窗内可改,但 leave 记录用此预填值;弹窗内用户改的话,slip 提交时再回传同步给对应 leave(这里先按预填走,弹窗内修改不联动更新 leave--请假记录时长按此预填值。
  // 老数据无 duration → 列表/考勤导出用 calcLeaveDays 兜底。
  let durationVal = null;
  if (leaveType === 'single') {
    const pv0 = fd.getAll('period');
    if (pv0.includes('all')) durationVal = 1;
    else {
      const dayOfWeek0 = wdayFull(fd.get('leaveDate'));
      const classN0 = getTeacherPeriods(teacherName, dayOfWeek0, fd.get('leaveDate')).filter(p => pv0.map(Number).includes(p)).length;
      if (classN0 >= 4) durationVal = 1;
      else if (classN0 === 0) durationVal = 1; // 勾选节次都没课 → 全天计
      else if (classN0 === 1) durationVal = 0.3;
      else durationVal = 0.5;
    }
  } else {
    durationVal = calcLeaveDays(fd.get('startDate'), fd.get('endDate'));
  }
  leaveDurationMap = {};
  function attachDuration(o) { return { ...o, duration: durationVal }; }

  const leavesToAdd = [];

  if (leaveType === 'single') {
    // 单日请假
    const leaveDate = fd.get('leaveDate');
    const periodVals = fd.getAll('period');
    const rawDayOfWeek = wdayFull(leaveDate);
    const makeupDay = $('makeup-day')?.value || null;  // 补周几
    const makeupParity = $('makeup-parity')?.value || null;  // 单/双周
    // 补课场景:用 makeupDay 查课表(否则 leaveDate=周末,查不到)
    const dayOfWeek = makeupDay || rawDayOfWeek;

    if (periodVals.length === 0) {
      toast('请至少选择一个请假节次', 'warning');
      return;
    }

    // 选了"无课(仅登记)"→ 直接生成一条仅登记记录
    if (periodVals.includes('none')) {
      leavesToAdd.push(attachDuration({ teacherName, leaveDate, dayOfWeek, period: 'all', reason, leaveType: leaveKind, status, needSubstitute: false, makeupDay, makeupParity }));
    } else if (periodVals.includes('all')) {
      // 根据课表自动判断该教师当天有哪些课(补课场景:传 makeupParity)
      const teacherPeriods = getTeacherPeriods(teacherName, dayOfWeek, leaveDate, makeupParity);
      if (teacherPeriods.length === 0) {
        // 无课(如后勤老师)→ 仅登记一条,不安排代课
        leavesToAdd.push(attachDuration({ teacherName, leaveDate, dayOfWeek, period: 'all', reason, leaveType: leaveKind, status, needSubstitute: false, makeupDay, makeupParity }));
      } else {
        for (const p of teacherPeriods) {
          leavesToAdd.push(attachDuration({ teacherName, leaveDate, dayOfWeek, period: p, reason, leaveType: leaveKind, status, needSubstitute: true, makeupDay, makeupParity }));
        }
      }
    } else {
      // 勾选的每个节次各生成一条记录;该节次无课 → 仅登记不代课(补课场景:传 makeupParity)
      const hasClassPeriods = getTeacherPeriods(teacherName, dayOfWeek, leaveDate, makeupParity);
      for (const pv of periodVals) {
        const pNum = parseInt(pv);
        leavesToAdd.push(attachDuration({ teacherName, leaveDate, dayOfWeek, period: pNum, reason, leaveType: leaveKind, status, needSubstitute: hasClassPeriods.includes(pNum), makeupDay, makeupParity }));
      }
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
      // 根据课表判断该教师当天有哪些课;无课(如后勤老师)→ 仅登记一条,不安排代课
      const teacherPeriods = getTeacherPeriods(teacherName, dayOfWeek, dateStr);
      if (teacherPeriods.length === 0) {
        leavesToAdd.push(attachDuration({ teacherName, leaveDate: dateStr, dayOfWeek, period: 'all', reason, leaveType: leaveKind, status, needSubstitute: false }));
      } else {
        for (const p of teacherPeriods) {
          leavesToAdd.push(attachDuration({ teacherName, leaveDate: dateStr, dayOfWeek, period: p, reason, leaveType: leaveKind, status, needSubstitute: true }));
        }
      }
    }
  }

  if (leavesToAdd.length === 0) {
    toast('没有可请假的课程记录', 'warning');
    return;
  }

  // 提交前先 reload 一次数据,以服务器为权威源进行去重
  try {
    const reload = await API.getLeaves();
    if (reload.success && Array.isArray(reload.data)) {
      leaveRecords = reload.data;
    }
  } catch (err) {
    console.warn('reload leaves failed:', err);
  }

  // 客户端去重:过滤掉已存在的请假记录(同一教师+同一日期+同一节次+同一状态)
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
    toast(skipCount > 0 ? `本次 ${skipCount} 条请假均已登记,未重复提交` : '没有可请假的课程记录', 'warning');
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
  // 提交过程中又被别人添加的,全部重新 reload
  if (dupCount > 0) {
    try {
      const reload = await API.getLeaves();
      if (reload.success && Array.isArray(reload.data)) leaveRecords = reload.data;
    } catch (err) {}
  }

  if (successCount > 0) {
    const msg = skipCount + dupCount > 0
      ? `成功登记 ${successCount} 条请假(跳过 ${skipCount + dupCount} 条重复)`
      : `成功登记 ${successCount} 条请假记录`;
    toast(msg, 'success');
    form.reset();
    $('leave-wday').value = wday(now());
    renderLeavePage($('main-content'));
    // 事假/病假 → 弹出请假条(不管什么身份都要走校长审批)
    if (PRINCIPAL_REVIEW_TYPES.includes(leaveKind) && submittedIds.length > 0) {
      const startDate = leaveType === 'single' ? fd.get('leaveDate') : fd.get('startDate');
      const endDate = leaveType === 'single' ? fd.get('leaveDate') : fd.get('endDate');
      showLeaveSlipModal({ leaveIds: submittedIds, teacherName, leaveType: leaveKind, reason, startDate, endDate, duration: durationVal });
    }
    // 所有假别都把请假时长写入 leaveDurationMap(让列表/考勤表渲染时用)
    if (submittedIds.length > 0) {
      for (const id of submittedIds) leaveDurationMap[id] = durationVal;
    }
  } else {
    toast(skipCount + dupCount > 0 ? '所有请假记录均已存在,未重复提交' : '提交失败', 'error');
  }
  } catch (err) {
    console.error('submitLeave error:', err);
    toast('提交出错:' + (err.message || err), 'error');
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
//  校长审批页(请假条手写签字)
// ══════════════════════════════════════════════════════
let principalAuthed = sessionStorage.getItem('principalAuthed') === '1';

function renderPrincipalPage(area) {
  loadAndRenderPrincipalPage(area);
}

async function loadAndRenderPrincipalPage(area) {
  // 先渲染登录界面,避免空白等待
  _renderPrincipalPageBody(area);
  if (!principalAuthed) return; // 未登录时不发请求
  
  try {
    // 校长页需要查看全部请假条,带30秒超时防止卡死(KV冷启动较慢)
    const timeout = (ms, p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r({success:false, error:'timeout'}), ms))]);
    const [sr, lr] = await Promise.all([
      timeout(30000, fetch('/api/leave-slips', { headers: { 'x-principal-pwd': principalPwd || '' } }).then(r => r.json()).catch(() => ({ success: false, data: [] }))),
      timeout(30000, API.getLeaves())
    ]);
    // PC 端专属:检测到 401(密码错误)时,清空 principal sessionStorage 并强制重登
    // 注意:超时/网络错误(sr.error==='timeout' 或 !sr 且无 error)不触发重登,只提示网络问题
    if (!sr.success && sr.error === '无权限查看请假条' && window.innerWidth >= 601 && principalPwd) {
      console.warn('[PC] 校长密码失效,清空登录态要求重新登录');
      sessionStorage.removeItem('role');
      sessionStorage.removeItem('principalAuthed');
      sessionStorage.removeItem('principalPwd');
      principalAuthed = false;
      principalPwd = '';
      _renderPrincipalPageBody(area);
      toast('校长密码已变更,请重新登录', 'warning');
      return;
    }
    // 超时/网络错误单独提示
    if (!sr.success && sr.error === 'timeout') {
      console.warn('加载请假条超时,请刷新重试');
      toast('网络超时,请刷新重试', 'warning');
      return;
    }
    if (sr.success) slipRecords = sr.data || [];
    if (lr.success) leaveRecords = lr.data || [];
    // 数据加载完成后重新渲染
    _renderPrincipalPageBody(area);
  } catch (e) { console.warn('加载请假条/请假记录失败', e); }
}

function _renderPrincipalPageBody(area) {
  if (!principalAuthed) {
    area.innerHTML = `
    <div class="page">
      ${mobileBackBar('校长审批')}
      <h2 class="page-title">✍️ 校长审批</h2>
      <div class="card" style="max-width:420px; margin:0 auto;">
        <h3>🔑 请输入校长审批密码</h3>
        <p style="color:#6B7280; font-size:13px;">请假条(事假/病假)需校长手写签字审批后才能安排代课。</p>
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
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button class="btn btn-sm" onclick="showChangePrincipalPwdModal()" style="display:${window.innerWidth>=601?'inline-block':'none'};">🔑 修改密码</button>
          <button class="btn btn-sm" onclick="principalAuthed=false;sessionStorage.removeItem('principalAuthed');renderPrincipalPage($('main-content'))">退出校长模式</button>
        </div>
      </div>
      ${pendingSlips.length === 0 ? '<p class="text-muted">暂无待审批的请假条</p>' : `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>班级</th><th>节次</th><th>事由</th><th>请假时间</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>
            ${pendingSlips.map(s => {
              // 从 slip.leaveIds 反查 leave 记录，取班级和节次
              const slipLeaves = (leaveRecords || []).filter(l => (s.leaveIds || []).includes(l.id));
              const classes = slipLeaves.map(l => getClassForLeave(l)).filter(c => c && c !== '-');
              const classStr = classes.length > 0 ? classes.join('、') : '-';
              const periodStr = slipLeaves.length === 0 ? '-' : slipLeaves.map(l => l.period === 'all' ? '全天' : (l.period ? '第'+l.period+'节' : '-')).join('、');
              return `<tr>
              <td>${esc(s.teacherName)}</td>
              <td>${classStr}</td>
              <td>${periodStr}</td>
              <td>${esc(s.reason)}</td>
              <td>${fmtDate(s.startDate)}（${wday(s.startDate)}）~ ${fmtDate(s.endDate)}（${wday(s.endDate)}）</td>
              <td>${new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
              <td><button class="btn btn-sm btn-primary" onclick="showPrincipalApproveModal('${s.id}')">签字审批</button></td>
            </tr>`; }).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
    ${doneSlips.length > 0 ? `
    <div class="card">
      <h3>📋 已处理 (${doneSlips.length})</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>教师</th><th>班级</th><th>节次</th><th>事由</th><th>时间</th><th>结果</th><th>操作</th></tr></thead>
          <tbody>
            ${doneSlips.map(s => {
              const slipLeaves = (leaveRecords || []).filter(l => (s.leaveIds || []).includes(l.id));
              const classes = slipLeaves.map(l => getClassForLeave(l)).filter(c => c && c !== '-');
              const classStr = classes.length > 0 ? classes.join('、') : '-';
              const periodStr = slipLeaves.length === 0 ? '-' : slipLeaves.map(l => l.period === 'all' ? '全天' : (l.period ? '第'+l.period+'节' : '-')).join('、');
              return `<tr>
              <td>${esc(s.teacherName)}</td>
              <td>${classStr}</td>
              <td>${periodStr}</td>
              <td>${esc(s.reason)}</td>
              <td>${fmtDate(s.startDate)}（${wday(s.startDate)}）~ ${fmtDate(s.endDate)}（${wday(s.endDate)}）</td>
              <td><span class="badge badge-${s.status==='approved'?'green':'red'}">${s.status==='approved'?'✅ 已同意':'❌ 已拒绝'}</span></td>
              <td><button class="btn btn-sm btn-danger" onclick="deletePrincipalSlip('${s.id}')">🗑 删除</button></td>
            </tr>`; }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  </div>`;
}

async function verifyPrincipalPwd() {
  const input = $('principal-pwd-input');
  const msg = $('principal-pwd-msg');
  if (!input) return;
  const pwd = input.value;
  try {
    const r = await fetch('/api/principal-pwd', { headers: { 'x-principal-pwd': pwd } });
    if (r.ok) {
      const j = await r.json();
      if (j.success) {
        principalPwd = j.data.password; // 从 KV 加载实际密码
        principalAuthed = true;
        sessionStorage.setItem('principalAuthed', '1');
        renderPrincipalPage($('main-content'));
      } else {
        msg.textContent = j.error || '验证失败';
      }
    } else if (r.status === 401) {
      msg.textContent = '密码错误,请重试';
    } else {
      msg.textContent = '网络错误';
    }
  } catch (err) {
    msg.textContent = '网络错误:' + (err.message || err);
  }
}

// 校长审批页:删除已处理请假条(需 principal pwd)
async function deletePrincipalSlip(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) { toast('未找到该请假条', 'error'); return; }
  if (!confirm(`确认删除 "${slip.teacherName} / ${slip.reason}" 这条请假条吗?\n该操作不可恢复。`)) return;
  try {
    const r = await fetch('/api/leave-slips/' + slipId, {
      method: 'DELETE',
      headers: { 'x-principal-pwd': principalPwd }
    });
    const j = await r.json();
    if (j.success) {
      slipRecords = slipRecords.filter(s => s.id !== slipId);
      loadAndRenderPrincipalPage($('main-content'));
      toast('✓ 已删除该请假条', 'success');
    } else {
      toast(j.error || '删除失败', 'error');
    }
  } catch (err) {
    toast('网络错误:' + (err.message || err), 'error');
  }
}

// 修改校长密码弹窗
function showChangePrincipalPwdModal() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:420px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">🔑 修改校长密码</h3>
        <button onclick=\"this.closest('.modal-overlay').remove()\" style=\"background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;\">×</button>
      </div>
      <div style=\"padding:20px;\">
        <div class=\"form-group\">
          <label>新密码 *</label>
          <input type=\"password\" id=\"new-principal-pwd\" class=\"form-input\" placeholder=\"请输入新密码(至少4位)\" style=\"margin:8px 0;\">
        </div>
        <div class=\"form-group\">
          <label>确认新密码 *</label>
          <input type=\"password\" id=\"confirm-principal-pwd\" class=\"form-input\" placeholder=\"请再次输入新密码\" style=\"margin:8px 0;\">
        </div>
        <p id=\"change-pwd-msg\" style=\"color:#DC2626; font-size:13px; min-height:18px; margin:8px 0 0;\"></p>
      </div>
      <div style=\"padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right;\">
        <button onclick=\"this.closest('.modal-overlay').remove()\" style=\"padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer; margin-right:8px;\">取消</button>
        <button id=\"change-pwd-submit\" style=\"padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;\">确认修改</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);

  modal.querySelector('#change-pwd-submit').onclick = async () => {
    const newPwd = modal.querySelector('#new-principal-pwd').value;
    const confirmPwd = modal.querySelector('#confirm-principal-pwd').value;
    const msgEl = modal.querySelector('#change-pwd-msg');
    if (!newPwd || newPwd.length < 4) { msgEl.textContent = '新密码至少4位'; return; }
    if (newPwd !== confirmPwd) { msgEl.textContent = '两次输入的密码不一致'; return; }
    const btn = modal.querySelector('#change-pwd-submit');
    btn.disabled = true; btn.textContent = '修改中...';
    try {
      const r = await fetch('/api/principal-pwd', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-principal-pwd': principalPwd },
        body: JSON.stringify({ newPassword: newPwd })
      });
      const j = await r.json();
      if (j.success) {
        principalPwd = newPwd; // 更新本地变量
        modal.remove();
        toast('✓ 密码已更新', 'success');
      } else {
        msgEl.textContent = j.error || '修改失败';
        btn.disabled = false; btn.textContent = '确认修改';
      }
    } catch (err) {
      msgEl.textContent = '网络错误:' + (err.message || err);
      btn.disabled = false; btn.textContent = '确认修改';
    }
  };
}

// 管理员重置校长密码弹窗
function showResetPrincipalPwdModal() {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:420px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">🔑 重置校长密码</h3>
        <button onclick=\"this.closest('.modal-overlay').remove()\" style=\"background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;\">×</button>
      </div>
      <div style=\"padding:20px;\">
        <p style=\"color:#6B7280; font-size:13px; margin:0 0 12px;\">设置新的校长审批密码,校长登录时需使用新密码。</p>
        <div class=\"form-group\">
          <label>新密码 *</label>
          <input type=\"password\" id=\"reset-principal-pwd\" class=\"form-input\" placeholder=\"请输入新密码(至少4位)\" style=\"margin:8px 0;\">
        </div>
        <div class=\"form-group\">
          <label>确认新密码 *</label>
          <input type=\"password\" id=\"reset-confirm-principal-pwd\" class=\"form-input\" placeholder=\"请再次输入新密码\" style=\"margin:8px 0;\">
        </div>
        <p id=\"reset-pwd-msg\" style=\"color:#DC2626; font-size:13px; min-height:18px; margin:8px 0 0;\"></p>
      </div>
      <div style=\"padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right;\">
        <button onclick=\"this.closest('.modal-overlay').remove()\" style=\"padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer; margin-right:8px;\">取消</button>
        <button id=\"reset-pwd-submit\" style=\"padding:8px 20px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:600;\">确认重置</button>
      </div>
    </div>
  `;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);

  modal.querySelector('#reset-pwd-submit').onclick = async () => {
    const newPwd = modal.querySelector('#reset-principal-pwd').value;
    const confirmPwd = modal.querySelector('#reset-confirm-principal-pwd').value;
    const msgEl = modal.querySelector('#reset-pwd-msg');
    if (!newPwd || newPwd.length < 4) { msgEl.textContent = '新密码至少4位'; return; }
    if (newPwd !== confirmPwd) { msgEl.textContent = '两次输入的密码不一致'; return; }
    const btn = modal.querySelector('#reset-pwd-submit');
    btn.disabled = true; btn.textContent = '重置中...';
    try {
      const r = await fetch('/api/principal-pwd', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd || 'admin888' },
        body: JSON.stringify({ newPassword: newPwd })
      });
      const j = await r.json();
      if (j.success) {
        principalPwd = newPwd; // 同步更新本地
        modal.remove();
        toast('✓ 校长密码已重置', 'success');
      } else {
        msgEl.textContent = j.error || '重置失败';
        btn.disabled = false; btn.textContent = '确认重置';
      }
    } catch (err) {
      msgEl.textContent = '网络错误:' + (err.message || err);
      btn.disabled = false; btn.textContent = '确认重置';
    }
  };
}
function showPrincipalApproveModal(slipId) {
  const slip = slipRecords.find(s => s.id === slipId);
  if (!slip) return;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:560px; width:100%; max-height:88vh; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:16px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; font-weight:600;">✍️ 请假条 - 审批人签字</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px; overflow-y:auto; max-height:70vh;">
        <div style="background:#F9FAFB; border:1px solid #E5E7EB; border-radius:8px; padding:16px; margin-bottom:16px;">
          <p style="margin:4px 0;"><strong>教师:</strong>${esc(slip.teacherName)}</p>
          <p style="margin:4px 0;"><strong>事由:</strong>${esc(slip.reason)}</p>
          <p style="margin:4px 0;"><strong>时间:</strong>${fmtDate(slip.startDate)} ~ ${fmtDate(slip.endDate)}</p>
          <p style="margin:4px 0;"><strong>请假时长:</strong>${slip.duration || calcLeaveDays(slip.startDate, slip.endDate)} 天</p>
          <p style="margin:4px 0;"><strong>关联请假:</strong>${slip.leaveIds.length} 条记录</p>
        </div>
        ${slip.teacherSignature ? `
        <div style="margin-bottom:16px;">
          <p style="font-size:13px; color:#6B7280; margin-bottom:4px;">教师签字:</p>
          <img src="${slip.teacherSignature}" style="max-height:80px; border:1px solid #E5E7EB; border-radius:6px; background:#fff; padding:4px;">
        </div>` : ''}
        <div class="form-group">
          <label>审批人签字 *(请用鼠标/手指签名)</label>
          <div style="border:2px dashed #CBD5E1; border-radius:8px; overflow:hidden; background:#FAFAFA;">
            <canvas id="principal-canvas" style="width:100%; height:140px; display:block; touch-action:none; cursor:crosshair;"></canvas>
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:8px;">
            <button type="button" id="principal-clear" class="btn btn-sm">✖ 清空重签</button>
            <button type="button" class="btn btn-sm" style="background:#F3F4F6; color:#374151;" onclick="toggleSigPicker(this,'principal','')">📂 选择签名</button>
            <button type="button" class="btn btn-sm" style="background:#F3F4F6; color:#374151;" onclick="saveSigToLib(this,'principal','principal-canvas','')">💾 保存到签名库</button>
          </div>
          <div style="margin-top:10px;">
            <label style="font-size:13px; color:#374151; margin-bottom:4px; display:block;">审批人姓名 *</label>
            <input id="principal-name-input" type="text" class="form-input" placeholder="请输入审批人姓名" style="width:100%;" required>
          </div>
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
    const pname = modal.querySelector('#principal-name-input')?.value.trim();
    if (!pname) { msgEl.textContent = '请输入审批人姓名'; return; }

    const sig = action === 'approve' ? pad.getDataUrl() : '';
    if (action === 'approve' && pad.isEmpty()) { msgEl.textContent = '请先手写签字'; return; }
    const btn = modal.querySelector(action === 'approve' ? '#principal-approve' : '#principal-reject');
    btn.disabled = true; btn.textContent = '提交中...';
    try {
      const r = await fetch(`/api/leave-slips/${slip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-principal-pwd': principalPwd },
        body: JSON.stringify({ action, signature: sig, principalName: (modal.querySelector('#principal-name-input')?.value.trim() || '审批人') })
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
        toast(action === 'approve' ? '✅ 已同意,可安排代课' : '已拒绝该请假条', action === 'approve' ? 'success' : 'info');
        renderPrincipalPage($('main-content'));
      } else {
        msgEl.textContent = j.error || '提交失败';
        btn.disabled = false; btn.textContent = action === 'approve' ? '✅ 同意并签字' : '❌ 拒绝';
      }
    } catch (err) {
      msgEl.textContent = '网络错误:' + (err.message || err);
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
  if (!confirm('确定清空所有请假记录?')) return;
  const r = await API.clearLeaves(); // 正确:清空请假记录
  if (!r.success) { toast('清空失败:' + (r.error || '未知错误'), 'error'); return; }
  toast('已清空,页面即将刷新...','success');
  setTimeout(() => location.reload(), 800); // 强制刷新确保所有页面数据同步
}

// ══════════════════════════════════════════════════════
//  代课安排页
// ══════════════════════════════════════════════════════
let previewSubstitutes = []; // 预览状态的代课安排
let lastConfirmedSubstitutes = []; // 本次已确认但未导出的代课(用于导出本次安排)

// 代课安排页当前选中的教师(用于课表对比)
let currentSubTeacher = null;

function renderSubPage(area) {
  // 教师端只看到自己的待安排代课;管理员看全部
  const currentTeacher = (sessionStorage.getItem('teacherName') || '').trim();
  // 已安排代课的请假不显示在待安排列表
  const arrangedLeaveIds = new Set(substituteRecords.map(s => s.leaveId).filter(Boolean));
  const approvedLeaves = isAdmin
    ? leaveRecords.filter(l => l.status === 'approved' && l.needSubstitute !== false && !arrangedLeaveIds.has(l.id))
    : (currentTeacher ? leaveRecords.filter(l => l.status === 'approved' && l.teacherName === currentTeacher && l.needSubstitute !== false && !arrangedLeaveIds.has(l.id)) : []);
  const pendingCount = approvedLeaves.length;

  // 方案B:提取所有待安排代课的请假教师(去重,trim处理)
  const pendingTeachers = [...new Set(approvedLeaves.map(l => (l.teacherName || '').trim()).filter(Boolean))];
  // 默认选中第一个
  if (!currentSubTeacher || !pendingTeachers.includes(currentSubTeacher)) {
    currentSubTeacher = pendingTeachers[0] || null;
  }

  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('代课安排')}
    <h2 class="page-title">✅ 代课安排</h2>

    ${isAdmin ? `
    ${pendingTeachers.length > 0 ? `
    <div class="sub-teacher-tabs">
      <span class="sub-tab-label">待安排教师:</span>
      ${pendingTeachers.map(t => `
        <button class="sub-tab-btn ${t === currentSubTeacher ? 'active' : ''}"
                onclick="switchSubTeacher('${esc(t)}')">
          ${esc(t)}
        </button>`).join('')}
    </div>` : ''}

    <div class="action-bar">
      ${pendingCount > 0 ? `<span class="pending-badge">${pendingCount} 条请假待安排</span>` : ''}
      <button class="btn btn-primary" onclick="doGenerateSubstitutes()">⚡ 自动生成代课安排</button>
      ${previewSubstitutes.length > 0 ? `
        <button class="btn btn-success" onclick="confirmSubstitutes()">✅ 确认方案</button>
        <button class="btn btn-secondary" onclick="cancelPreview()">❌ 取消预览</button>
      ` : lastConfirmedSubstitutes.length > 0 ? `
        <button class="btn btn-info" onclick="exportCurrentSubstitutes()">📥 导出本次安排</button>
        <button class="btn btn-secondary" onclick="clearLastConfirmed()">清空本次记录</button>
        <button class="btn btn-secondary" onclick="exportSubExcel()" ${substituteRecords.length === 0 ? 'disabled' : ''}>📥 导出全部</button>
        <button class="btn btn-secondary" onclick="exportSubKaoqin()">📋 按考勤表导出</button>
      ` : `<button class="btn btn-secondary" onclick="exportSubExcel()" ${substituteRecords.length === 0 ? 'disabled' : ''}>📥 导出Excel</button>
      <button class="btn btn-secondary" onclick="exportSubKaoqin()"  >📋 按考勤表导出</button>`}
    </div>` : ''}

    ${previewSubstitutes.length > 0 ? `
    <div class="card" style="background:linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%);border:1px solid #3b82f6;margin-bottom:16px;">
      <div style="padding:16px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px">👁️</div>
        <div style="flex:1">
          <div style="font-weight:600;color:#1e40af;font-size:15px">当前为预览模式</div>
          <div style="color:#3b82f6;font-size:13px;margin-top:4px">请检查以下代课方案,确认无误后点击上方「✅ 确认方案」按钮保存</div>
        </div>
      </div>
    </div>
    ${renderPreviewTable()}` : renderSubTable()}

    ${isAdmin && !previewSubstitutes.length && currentSubTeacher ? `
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <h3>📅 ${esc(currentSubTeacher)} 老师的课表</h3>
        <span class="preview-hint">点击上方教师标签切换查看</span>
      </div>
      <div id="sub-teacher-tt">
        ${renderTeacherSubTT(currentSubTeacher)}
      </div>
    </div>` : ''}
  </div>`;
}

function switchSubTeacher(teacherName) {
  currentSubTeacher = teacherName;
  renderSubPage($('main-content'));
}

// 渲染指定教师的课表(用于代课安排页课表对比)
function renderTeacherSubTT(teacherName) {
  if (!teacherName) return '<p class="text-muted">请从上方选择一位教师</p>';
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const afterSchool = td.afterSchoolService || {};
  const days = ['星期一','星期二','星期三','星期四','星期五'];
  const dayOrder = d => days.indexOf(d);
  const timeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'14:00-14:40', 6:'14:50-15:30' };
  const fridayTimeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'13:00-13:40', 6:'13:50-14:30', 7:'14:40-15:20', 8:'15:25-16:50' };
  const getTime = (day, p) => day === '星期五' ? (fridayTimeMap[p] || '-') : (timeMap[p] || '-');
  const afterSchoolTimeMap = { 7:'15:40-16:20', 8:'16:25-17:05', 9:'17:10-17:50', 10:'19:30-20:30', 11:'13:00-13:50' };
  const fridayAfterSchoolTimeMap = { 7:'14:40-15:20', 8:'15:25-16:05', 9:'16:10-16:50' };
  const afterSchoolName = { 7:'课后服务1', 8:'课后服务2', 9:'课后服务3', 10:'晚自习', 11:'午休' };
  const getAfterSchoolTime = (day, period, fallback) => day === '星期五' ? (fridayAfterSchoolTimeMap[period] || fallback || '-') : (afterSchoolTimeMap[period] || fallback || '-');

  const mySlots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cn, slots] of Object.entries(classMap)) {
      const arr = Array.isArray(slots) ? slots : [];
      for (const s of arr) {
        if (s && s.teacher === teacherName) mySlots.push({ day, className: cn, ...s, isAfterSchool: false });
      }
    }
  }

  const myAfterSchoolSlots = [];
  const assSlots = afterSchool.slots || [];
  for (const slot of assSlots) {
    const period = getPeriod(slot.time);
    if (period >= 7 && slot.assignments) {
      const assignments = Array.isArray(slot.assignments)
        ? slot.assignments
        : Object.entries(slot.assignments).map(([className, data]) => ({ className, ...data }));
      for (const assign of assignments) {
        if (!assign) continue;
        const candidates = [];
        if (assign.teacher) {
          assign.teacher.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t).forEach(t => candidates.push({ name: t, week: assign.week || '通用' }));
        }
        if (assign.singleWeek) candidates.push({ name: assign.singleWeek, week: '单周' });
        if (assign.doubleWeek) candidates.push({ name: assign.doubleWeek, week: '双周' });
        for (const c of candidates) {
          if (c.name !== teacherName) continue;
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

  const allSlots = [...mySlots, ...myAfterSchoolSlots];
  if (allSlots.length === 0) return `<p class="text-muted" style="padding:12px">暂无 ${esc(teacherName)} 老师的课表记录</p>`;
  allSlots.sort((a,b) => dayOrder(a.day) - dayOrder(b.day) || a.period - b.period);

  let html = `<div class="table-wrap"><table class="data-table tt-table">`;
  html += `<thead><tr><th>星期</th><th>节次</th><th>时间</th><th>班级</th><th>科目</th></tr></thead><tbody>`;
  allSlots.forEach(s => {
    const weekTag = s.isAfterSchool && s.weekType !== '通用'
      ? `<span class="week-tag ${s.weekType === '双周' ? 'week-double' : ''}" style="margin-left:4px;font-size:11px;">${s.weekType}</span>`
      : '';
    let subjectLabel = esc(s.subject);
    if (s.day === '星期四' && s.period === 8 && s.isAfterSchool) {
      subjectLabel = '特色社团活动';
    }
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
  return html;
}

function renderPreviewTable() {
  return `
  <div class="card preview-card">
    <div class="card-header">
      <h3>📋 代课方案预览(请检查确认)</h3>
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
                ${getSubstituteOptions(s.substituteTeacher, s)}
              </select>
            </td>
            <td>${esc(s.className||'')}</td>
            <td>${esc(s.subject||'-')}</td>
            <td>${fmtDate(s.leaveDate||'')}</td>
            <td>${formatSubstituteWeekday(s)}</td>
            <td>第${s.period||''}节</td>
            <td><button class="btn btn-sm btn-danger" onclick="removePreviewItem(${idx})">删除</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

// 判断老师t在dow/period是否有课,有课返回班级名,无课返回null
function getTeacherConflict(t, dow, period, leaveDate) {
  if (!t || !dow || !scheduleData) return null;
  const p = parseInt(period);
  // day 格式归一化:leave.dayOfWeek 可能为「星期二」(长)或「周二」(短),timetable/afterSchoolService
  // 的 slot.day 也可能两种混用 —— 两端都 normDay 一下保证匹配。
  const targetDow = normDay(dow);
  const dayData = scheduleData.timetable?.[targetDow];
  if (dayData) {
    for (const [cls, slots] of Object.entries(dayData)) {
      const slot = slots.find ? slots.find(s => s && s.period == p) : null;
      if (!slot) continue;
      if (slot.teachers ? slot.teachers.includes(t) : slot.teacher === t) return cls;
    }
  }
  if (p >= 7 && scheduleData.afterSchoolService?.slots) {
    const slot = scheduleData.afterSchoolService.slots.find(s => normDay(s.day) === targetDow && s.period == p);
    if (slot?.assignments) {
      // 单/双周过滤:用校历 dayMap 查请假当天 parity,只有当前周次对应的教师才算冲突
      const parity = leaveDate ? (scheduleData.calendar?.dayMap?.[leaveDate]?.parity || null) : null;
      for (const [cls, info] of Object.entries(slot.assignments)) {
        if (!info) continue;
        const teachers = [];
        if (info.teacher) teachers.push(info.teacher);
        if (info.singleWeek && info.doubleWeek) {
          // 轮换制:有 parity 时只取对应侧;无 parity 则都视为冲突(保守)
          if (parity === 'single') {
            if (Array.isArray(info.singleWeek)) teachers.push(...info.singleWeek);
            else teachers.push(info.singleWeek);
          } else if (parity === 'double') {
            if (Array.isArray(info.doubleWeek)) teachers.push(...info.doubleWeek);
            else teachers.push(info.doubleWeek);
          } else {
            if (Array.isArray(info.singleWeek)) teachers.push(...info.singleWeek);
            else teachers.push(info.singleWeek);
            if (Array.isArray(info.doubleWeek)) teachers.push(...info.doubleWeek);
            else teachers.push(info.doubleWeek);
          }
        } else {
          // 单一固定:有 parity 时按匹配侧;无 parity 都计入
          if (info.singleWeek) {
            if (Array.isArray(info.singleWeek)) teachers.push(...info.singleWeek);
            else if (!parity || parity === 'single') teachers.push(info.singleWeek);
          }
          if (info.doubleWeek) {
            if (Array.isArray(info.doubleWeek)) teachers.push(...info.doubleWeek);
            else if (!parity || parity === 'double') teachers.push(info.doubleWeek);
          }
        }
        if (teachers.includes(t)) return cls;
      }
    }
  }
  return null;
}

// 老师在targetClass的周几属于哪个优先级档位
// 1=同班语文/数学 2=同班英语 3=同班科学/道法 4=同班副科 5=跨班副科 99=跨班主科(不安排)
function getTeacherTier(teacherName, targetClass, dow) {
  if (!teacherName || !targetClass || !dow) return 99;
  const dayData = scheduleData.timetable?.[dow];
  if (!dayData) {
    // 课后服务时段也在 timetable 里,不单独处理 afterSchoolService
    // 若 timetable 无数据,用 teacherAssignment 估算
    const ta = scheduleData.teacherAssignment || {};
    const clsSubs = ta[targetClass] || {};
    const subjs = Object.entries(clsSubs);
    const myMain = subjs.find(([,t]) => t === teacherName);
    if (myMain) {
      const s = myMain[0];
      if (['语文','数学'].includes(s)) return 1;
      if (s === '英语') return 2;
      if (['科学','道德与法治','道德','科学课'].includes(s)) return 3;
      return 4;
    }
    // 跨班:查该老师的主科身份
    return isMainSubjectTeacher(teacherName) ? 99 : 5;
  }
  const slots = dayData[targetClass];
  if (!slots) return 99;
  // 查该老师在 targetClass 教什么
  const mySlots = Array.isArray(slots) ? slots.filter(s =>
    s && (s.teachers ? s.teachers.includes(teacherName) : s.teacher === teacherName)
  ) : [];
  if (mySlots.length === 0) {
    // 不在 targetClass 教课 → 跨班
    return isMainSubjectTeacher(teacherName) ? 99 : 5;
  }
  // 在 targetClass 教课 → 取最高优先级学科
  for (const s of mySlots) {
    const subj = s.subject;
    if (['语文','数学'].includes(subj)) return 1;
  }
  for (const s of mySlots) {
    const subj = s.subject;
    if (['英语'].includes(subj)) return 2;
  }
  for (const s of mySlots) {
    const subj = s.subject;
    if (['科学','道德与法治','道德'].includes(subj)) return 3;
  }
  return 4; // 同班副科
}

// 判断是否为跨班主科老师(教两个班以上的语文/数学/科学/道德)
// 英语为独立学科,不算主科也不算副科,跨班可安排代课(优先级=2)
function isMainSubjectTeacher(teacherName) {
  const ta = scheduleData?.teacherAssignment || {};
  let mainCount = 0;
  for (const [cls, subs] of Object.entries(ta)) {
    for (const [subj, t] of Object.entries(subs)) {
      if (t && t === teacherName && ['语文','数学','科学','道德与法治','道德'].includes(subj)) mainCount++;
    }
  }
  return mainCount >= 2; // 教两个班以上的语文/数学/科学/道法为主科老师
}

// 当前选中老师的档位(用于保持选中状态)
function getCurrentTier(currentTeacher, targetClass, dow) {
  if (!currentTeacher) return 99;
  // 查该老师在 targetClass 是否有课
  const conflict = getTeacherConflict(currentTeacher, dow, null);
  if (!conflict) return isMainSubjectTeacher(currentTeacher) ? 99 : 5;
  return getTeacherTier(currentTeacher, targetClass, dow);
}

function getSubstituteOptions(currentTeacher, s) {
  if (!s) {
    // 兜底:老调用方式
    const teachers = scheduleData?.allTeachers || [];
    return teachers.map(t => `<option value="${esc(t)}" ${t === currentTeacher ? 'selected' : ''}>${esc(t)}</option>`).join('');
  }
  const dow = s.dayOfWeek;
  const period = s.period;
  const leaveDate = s.leaveDate;
  const targetClass = s.className || '';
  const teachers = scheduleData?.allTeachers || [];
  // 收集当天已请假的老师(过滤掉)
  const absentTeachers = new Set();
  if (leaveDate) {
    for (const l of leaveRecords) {
      if ((l.status === 'pending' || l.status === 'approved') && l.leaveDate === leaveDate) {
        absentTeachers.add(l.teacherName);
      }
    }
  }
  const result = [];
  for (const t of teachers) {
    if (t === s.leaveTeacher) continue; // 不安排自己
    if (absentTeachers.has(t)) continue; // 当天已请假的老师过滤掉
    if (getTeacherConflict(t, dow, period, leaveDate)) continue; // 有课的老师过滤掉(含课后服务单/双周过滤)
    const tier = getTeacherTier(t, targetClass, dow);
    if (tier === 99) continue; // 跨班主科不安排
    const curTier = t === currentTeacher ? tier : getCurrentTier(currentTeacher, targetClass, dow);
    result.push({ name: t, tier });
  }
  // 按档位排序:1→2→3→4→5,同档位按姓名
  result.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'zh'));
  return result.map(t => `<option value="${esc(t.name)}" ${t.name === currentTeacher ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
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

// 导出本次已确认的代课安排
function exportCurrentSubstitutes() {
  if (lastConfirmedSubstitutes.length === 0) { toast('暂无本次代课安排可导出','warning'); return; }
  const data = lastConfirmedSubstitutes.map(s => ({
    '请假教师': s.leaveTeacher||'',
    '代课教师': s.substituteTeacher||'',
    '班级': s.className||'',
    '科目': s.subject||'',
    '日期': fmtDate(s.leaveDate||''),
    '星期': formatSubstituteWeekday(s),
    '节次': '第'+(s.period||'')+'节',
    '安排方式': s.reason||'',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '本次代课安排');
  XLSX.writeFile(wb, `本次代课安排_${now()}.xlsx`);
  toast('本次代课安排导出成功','success');
}

// 清空本次已确认的记录（导出后手动清空）
function clearLastConfirmed() {
  lastConfirmedSubstitutes = [];
  renderSubPage($('main-content'));
  toast('已清空本次记录', 'info');
}

async function confirmSubstitutes() {
  if (previewSubstitutes.length === 0) {
    toast('没有可确认的方案', 'warning');
    return;
  }
  // 按 leaveId 去重追加:同 leaveId 的代课替换旧的,不同的保留
  // 修复:原"整份覆盖"逻辑导致后续确认会抹掉之前的代课记录
  const previewLeaveIds = new Set(previewSubstitutes.map(s => s.leaveId).filter(Boolean));
  const existingKept = substituteRecords.filter(s => !previewLeaveIds.has(s.leaveId));
  substituteRecords = [...existingKept, ...previewSubstitutes];
  // 保存本次确认的方案,用于导出
  lastConfirmedSubstitutes = [...previewSubstitutes];
  previewSubstitutes = [];
  // 调用API保存
  const r = await API.saveSubstitutes(substituteRecords);
  if (r.success) {
    toast('代课方案已确认并保存', 'success');
    renderSubPage($('main-content'));
  } else {
    toast('保存失败:' + r.error, 'error');
  }
}

function renderSubTable() {
  // 优先显示已批准但未安排代课的请假
  // 教师端只看到自己的;管理员看全部
  const currentTeacher = (sessionStorage.getItem('teacherName') || '').trim();
  // 已安排过的请假 leaveId 集合(去重)--同 leaveId 的代课任一存在即视为已安排
  const arrangedLeaveIds = new Set(substituteRecords.map(s => s.leaveId).filter(Boolean));
  const approvedLeaves = isAdmin
    ? leaveRecords.filter(l => l.status === 'approved' && l.needSubstitute !== false && !arrangedLeaveIds.has(l.id))
    : (currentTeacher ? leaveRecords.filter(l => l.status === 'approved' && l.teacherName === currentTeacher && l.needSubstitute !== false && !arrangedLeaveIds.has(l.id)) : []);

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
            <th>请假教师</th><th>班级</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th>
          </tr></thead>
          <tbody>
            ${approvedLeaves.map(l => `
            <tr>
              <td>${esc(l.teacherName)}</td>
              <td>${getClassForLeave(l)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${formatWeekday(l)}</td>
              <td>第${l.period}节</td>
              <td>${esc(l.reason||'-')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  // 教师端:只显示与自己相关的代课(自己请假被代课,或自己代别人的课)
  const myTeacherName = (sessionStorage.getItem('teacherName') || '').trim();
  let displaySubs = isAdmin
    ? [] // 管理员端不显示已安排代课(在首页"代课记录"卡片查看)
    : (myTeacherName ? substituteRecords.filter(s => s.leaveTeacher === myTeacherName || s.substituteTeacher === myTeacherName) : []);

  // 去重:同一天同节次同班级只显示一条
  const seen = new Set();
  displaySubs = displaySubs.filter(s => {
    const key = `${s.leaveDate}_${s.period}_${s.className}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (displaySubs.length === 0) {
    return `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>暂无待安排代课</h3>
      <p>${isAdmin ? '请先登记请假,再点击"自动生成代课安排"' : '请等候管理员安排代课'}</p>
    </div>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <h3>代课安排 (${displaySubs.length})</h3>
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
          ${displaySubs.map(s => `
          <tr class="sub-row">
            <td>${esc(s.leaveTeacher||'')}</td>
            <td class="sub-tea">${esc(s.substituteTeacher||'-')}</td>
            <td>${esc(s.className||'')}</td>
            <td>${esc(s.subject||'-')}</td>
            <td>${fmtDate(s.leaveDate||'')}</td>
            <td>${formatSubstituteWeekday(s)}</td>
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
    // 改用预览接口,只获取方案不保存
    const r = await API.previewSubstitutes();
    loading.remove();
    console.log('[doGenerateSubstitutes] API返回:', r.summary, 'results.length:', (r.data||r.results||[]).length);
    if (r.success) {
      const results = r.data || r.results || [];
      // 前端也去重(增加日期维度,确保同一天同节次同班级只出现一次)
      const seen = new Set();
      const uniqueResults = [];
      for (const s of results) {
        if (!s) continue;
        const key = `${s.leaveId}_${s.leaveDate}_${s.period}_${s.className}`;
        if (seen.has(key)) {
          console.warn('[doGenerateSubstitutes] 跳过重复:', s.leaveTeacher, s.leaveDate, '第'+s.period+'节', s.className);
          continue;
        }
        seen.add(key);
        uniqueResults.push(s);
      }
      console.log('[doGenerateSubstitutes] 去重后:', uniqueResults.length, '条');
      if (uniqueResults.length > 0) {
        previewSubstitutes = uniqueResults; // 进入预览模式
        toast(`生成完成!共 ${uniqueResults.length} 条代课方案,请检查后点击「✅ 确认方案」保存`, 'success');
      } else {
        toast('未能生成代课安排:'+(r.error||r.message||'无可用数据'),'warning');
      }
    } else {
      toast('生成失败:'+r.error,'error');
    }
    renderSubPage($('main-content'));
  } catch(e) {
    loading.remove();
    previewSubstitutes = []; // 错误时确保清空预览状态
    console.error('[doGenerateSubstitutes] 错误:', e);
    toast('网络错误:' + (e.message || '请检查网络后重试'), 'error');
    renderSubPage($('main-content')); // 错误后刷新页面,回到待安排列表
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

// 删除单条代课记录(仅管理员)
async function deleteSubstituteRecord(id) {
  if (!isAdmin) { toast('仅管理员可删除','warning'); return; }
  if (!confirm('确认删除这条代课记录?')) return;
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

// 从弹窗删除代课记录(仅管理员,删除后刷新弹窗)
async function deleteSubstituteFromModal(id) {
  if (!isAdmin) { toast('仅管理员可删除','warning'); return; }
  if (!confirm('确认删除这条代课记录?')) return;
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
      // 关闭旧弹窗,重新打开刷新后的内容
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
      showAdminSubstituteHistory();
    } else {
      toast(data.error || '删除失败','error');
    }
  } catch (e) {
    toast('网络错误: ' + e.message,'error');
  }
}

function exportSubExcel() {
  if (substituteRecords.length === 0) { toast('无记录可导出','warning'); return; }
  // 科目栏:课后服务记录标 课后服务1/2/3 (period 7/8/9 映射)
  const subjectLabel = (s) => {
    const p = String(s.period || '');
    if (p.includes('课后服务')) return p;
    const n = parseInt(p);
    if (n === 7) return '课后服务1';
    if (n === 8) return '课后服务2';
    if (n === 9) return '课后服务3';
    return s.subject || '';
  };
  const data = substituteRecords.map(s => ({
    '请假教师': s.leaveTeacher||'',
    '代课教师': s.substituteTeacher||'',
    '班级': s.className||'',
    '科目': subjectLabel(s),
    '日期': fmtDate(s.leaveDate||''),
    '星期': formatSubstituteWeekday(s),
    '节次': '第'+(s.period||'')+'节',
    '安排方式': s.reason||'',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '代课记录');
  XLSX.writeFile(wb, `代课记录_${now()}.xlsx`);
  toast('导出成功','success');
}

// 按「教师考勤统计表」模板格式导出(自动填可生成项,其余留空手填)
async function exportSubKaoqin() {
  // 先 reload 最新数据(用户可能刚提交请假未刷新页面)
  try {
    const lr = await API.getLeaves();
    if (lr.success && Array.isArray(lr.data)) leaveRecords = lr.data;
    const sr = await API.getSubstitutes();
    if (sr.success && Array.isArray(sr.data)) substituteRecords = sr.data;
  } catch (e) { console.warn('reload failed', e); }
  const noSubLeaves = (leaveRecords || []).filter(l => l.needSubstitute === false);
  if (substituteRecords.length === 0 && noSubLeaves.length === 0) { toast('无记录可导出','warning'); return; }
  // 以请假条(slip)的 duration 为准
  let slipDurMap = {};
  try {
    const slipRes = await fetch('/api/leave-slips', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } });
    const slipData = slipRes.ok ? await slipRes.json() : null;
    if (slipData && Array.isArray(slipData.data)) {
      slipData.data.forEach(slip => {
        if (slip.duration != null) {
          // 该请假条关联的每条 leave 都用同一个 duration
          const dur = Number(slip.duration);
          (slip.leaveIds || []).forEach(lid => { slipDurMap[lid] = dur; });
        }
      });
    }
  } catch (e) { console.warn('slip fetch failed', e); }
  // 节次数值(用于「节数」列): 常规课1-6=1, 午休11=1, 晚自习10=2, 课后服务7/8/9=空白
  // 数字period → 节数; 字符串period(如"课后服务2、3")→ 留空白
  const periodNum = (p) => {
    const n = parseInt(p);
    return isNaN(n) ? -1 : n;
  };
  const jieShu = (p) => {
    const n = periodNum(p);
    if (n === 10) return 2;   // 晚自习=2节
    if (n === 11) return 1;   // 午休=1节
    if (n >= 7) return '';    // 课后服务(7/8/9)=留空白
    if (n >= 1 && n <= 6) return 1;  // 常规课=1节
    return '';
  };
  // 时间拆分: leaveDate → [年, 月, 日] (去前导零,数字型)
  const splitYMD = (d) => {
    if (!d) return ['', '', ''];
    const m = String(d).split(/[-/]/);
    return [m[0] || '', (m[1] || '').replace(/^0/, ''), (m[2] || '').replace(/^0/, '')];
  };
  const numOrEmpty = (v) => (v === '' || v == null) ? '' : Number(v);
  // 15 列 A-O 模板(年/月/日拆三列,对齐学校考勤统计表模板)
  // A=序号 B=有假教师 C=年 D=月 E=日 F=星期 G=事由 H=假别
  // I=迟到、早退、旷工 J=天数 K=前去代课教师 L=班级 M=节次 N=科目 O=节数
  const arr = (n, v) => Array.from({length:n}, () => v);
  const rows = [];
  rows[0] = arr(15, ''); rows[0][0] = '施秉县双井镇小学、幼儿园教师考勤统计表';
  rows[1] = arr(15, ''); rows[1][0] = '(2025-2026学年度第二学期)';
  rows[2] = arr(15, ''); rows[2][0] = '  (2026年        月)';
  rows[3] = arr(15, ''); rows[3][7] = '登记人:                       ';
  rows[4] = arr(15, ''); rows[4][0] = '学校(盖章):施秉县双井镇中心小学';
  rows[4][7] = '审核人:                            ';
  // 第 6 行(索引 5):表头(15 列,单行)
  rows[5] = arr(15, '');
  rows[5][0]  = '序号';
  rows[5][1]  = '有假教师';
  rows[5][2]  = '年';
  rows[5][3]  = '月';
  rows[5][4]  = '日';
  rows[5][5]  = '星期';
  rows[5][6]  = '事由';
  rows[5][7]  = '假别';
  rows[5][8]  = '迟到、早退、旷工';
  rows[5][9]  = '天数';
  rows[5][10] = '前去代课教师';
  rows[5][11] = '班级';
  rows[5][12] = '节次';
  rows[5][13] = '科目';
  rows[5][14] = '节数';
  let idx = 1;
  // 有代课记录的请假
  substituteRecords.forEach(s => {
    const r = arr(15, '');
    const ymd = splitYMD(s.leaveDate);
    r[0]  = idx++;
    r[1]  = s.leaveTeacher || '';
    r[2]  = numOrEmpty(ymd[0]);
    r[3]  = numOrEmpty(ymd[1]);
    r[4]  = numOrEmpty(ymd[2]);
    r[5]  = formatSubstituteWeekday(s);
    r[6]  = s.reason || '';
    r[7]  = s.leaveType || '';     // 假别:自动填
    r[8]  = '';                    // 迟到早退旷工:留空手填
    r[9]  = (slipDurMap[s.leaveId] != null ? slipDurMap[s.leaveId] : (s.duration != null ? s.duration : (leaveDurationMap[s.leaveId] != null ? leaveDurationMap[s.leaveId] : 1)));  // 天数:以请假条时长为准
    r[10] = s.substituteTeacher || '';
    r[11] = s.className || '';
    r[12] = (() => {
      const p = s.period;
      const n = periodNum(p);
      if (String(p).includes('课后服务') || String(p).includes('晚自习') || String(p).includes('午休')) return p;
      if (n >= 10) return n === 10 ? '晚自习' : '午休';
      if (n >= 7) return n === 7 ? '课后服务1' : n === 8 ? '课后服务2' : '课后服务3';
      if (n >= 1) return '第' + n + '节';
      return p || '';
    })();
    r[13] = s.subject || '';
    r[14] = jieShu(s.period);       // 节数:课后服务留空白,常规课1,午休1,晚自习2
    rows.push(r);
  });
  // 仅登记请假(后勤/无课老师):代课情况留空
  noSubLeaves.forEach(l => {
    const r = arr(15, '');
    const ymd = splitYMD(l.leaveDate);
    r[0]  = idx++;
    r[1]  = l.teacherName || '';
    r[2]  = numOrEmpty(ymd[0]);
    r[3]  = numOrEmpty(ymd[1]);
    r[4]  = numOrEmpty(ymd[2]);
    r[5]  = formatWeekday(l);
    r[6]  = l.reason || '';
    r[7]  = l.leaveType || '';
    r[8]  = '';
    r[9]  = (slipDurMap[l.id] != null ? slipDurMap[l.id] : (l.duration != null ? l.duration : (leaveDurationMap[l.id] != null ? leaveDurationMap[l.id] : 1)));
    r[10] = '';
    r[11] = '';
    r[12] = l.period === 'all' ? '全天' : (l.period || '');
    r[13] = '';
    r[14] = '';
    rows.push(r);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = [
    {s:{r:0,c:0},e:{r:0,c:14}},  // 标题
    {s:{r:1,c:0},e:{r:1,c:14}},  // 学期
    {s:{r:2,c:0},e:{r:2,c:14}},  // 月份
    {s:{r:3,c:7},e:{r:3,c:14}},  // 登记人 H-O
    {s:{r:4,c:0},e:{r:4,c:6}},   // 学校盖章 A-G
    {s:{r:4,c:7},e:{r:4,c:14}}   // 审核人 H-O
  ];
  ws['!cols'] = [
    {wch:6},{wch:12},{wch:8},{wch:6},{wch:6},{wch:8},{wch:14},{wch:8},
    {wch:14},{wch:8},{wch:12},{wch:10},{wch:10},{wch:10},{wch:8}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '请假表');
  XLSX.writeFile(wb, '教师考勤统计表_' + now() + '.xlsx');
  toast('考勤表导出成功','success');
}

// ══════════════════════════════════════════════════════
//  导入课表页(管理员)
// ══════════════════════════════════════════════════════
function renderImportPage(area) {
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('导入课表')}
    <h2 class="page-title">📤 导入课表</h2>

    <div class="card">
      <h3>📊 方式一:直接上传总课表 Excel</h3>
      <p class="text-muted">将标准化后的 <code>总课表_标准化.xlsx</code> 上传,系统自动解析全部课表与教师信息。</p>
      <div class="form-group">
        <input type="file" id="import-excel" accept=".xlsx,.xls" class="form-file"
               onchange="handleExcelImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📚 方式二:上传课后服务表 Excel</h3>
      <p class="text-muted">分别上传 <code>单周.xlsx</code> 和 <code>双周.xlsx</code>,系统自动合并生成单双周课表。</p>
      <div class="form-group">
        <label style="display:block;margin-bottom:4px;color:#666;font-size:12px;">单周表:</label>
        <input type="file" id="import-single" accept=".xlsx,.xls" class="form-file"
               onchange="handleAfterSchoolImport('single', this.files[0])">
      </div>
      <div class="form-group" style="margin-top:8px;">
        <label style="display:block;margin-bottom:4px;color:#666;font-size:12px;">双周表:</label>
        <input type="file" id="import-double" accept=".xlsx,.xls" class="form-file"
               onchange="handleAfterSchoolImport('double', this.files[0])">
      </div>
      <div id="afterschool-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>📅 方式三:上传校历表 Excel</h3>
      <p class="text-muted">上传校历表,系统自动识别每一周是<b>单周</b>还是<b>双周</b>(以及假期)。导入后,代课记录会按单/双周匹配对应教师。</p>
      <div class="form-group">
        <input type="file" id="import-calendar" accept=".xlsx,.xls" class="form-file"
               onchange="handleCalendarImport(this.files[0])">
      </div>
      <div id="calendar-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>📁 方式四:导入 JSON 数据</h3>
      <p class="text-muted">将 <code>parsed_data.json</code> 文件上传。</p>
      <div class="form-group">
        <input type="file" id="import-json" accept=".json" class="form-file"
               onchange="handleJsonImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📝 方式五:手动粘贴JSON数据</h3>
      <p class="text-muted">从 parsed_data.json 文件中复制内容,粘贴到下方:</p>
      <textarea id="import-textarea" class="form-textarea" rows="8"
                placeholder="粘贴 parsed_data.json 的内容..."></textarea>
      <button class="btn btn-primary" onclick="handleTextImport()">导入数据</button>
    </div>

    <div class="card">
      <h3>🎯 方式六:上传社团活动安排表 Excel</h3>
      <p class="text-muted">上传全校社团活动安排表(多 Sheet 整体保存),教师个人课表页的"社团活动"按钮会原样弹出本表。</p>
      <div class="form-group">
        <input type="file" id="import-club" accept=".xlsx,.xls" class="form-file"
               onchange="handleClubActivitiesImport(this.files[0])">
      </div>
      <div id="club-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
    </div>

    <div class="card">
      <h3>🧑🔧 后勤/无课教师名单</h3>
      <p class="text-muted">负责后勤等岗位、课表上没有课的老师,登记在此名单后即可请假(自动「仅登记」,不安排代课,考勤表照常导出)。</p>
      <div class="form-group">
        <textarea id="extra-teachers-input" class="form-textarea" rows="3" placeholder="每行一个姓名,例如:&#10;张后勤&#10;李干事">${(scheduleData && scheduleData.extraTeachers ? scheduleData.extraTeachers : []).join('\n')}</textarea>
      </div>
      <button class="btn btn-primary" onclick="saveExtraTeachers()">💾 保存名单</button>
      <div id="extra-teachers-status" style="margin-top:8px;font-size:12px;color:#666;"></div>
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
    <div class="stat-mini" style="width:100%"><span class="sl" style="font-size:12px;line-height:1.6">📅 校历:${esc(cal.term || '')}<br>${cal.startDate} ~ ${cal.endDate}<br>${cal.stats?.weeks || cal.weeks?.length || 0} 周(单 ${cal.weeks?.filter?.(w=>w.parity==='single').length ?? '-'} / 双 ${cal.weeks?.filter?.(w=>w.parity==='double').length ?? '-'}),假日 ${cal.stats?.holidays ?? '-'} 天</span></div>` : '';

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
  if (!confirm('确定清空课表数据?请假记录不受影响。')) return;
  const r = await API.clearSchedule();
  if (r.success) {
    scheduleData = null;
    localStorage.removeItem('teachers_cache');
    toast('课表已清空', 'success');
    renderImportPage($('main-content'));
  } else {
    toast('清空失败:' + r.error, 'error');
  }
}

async function saveExtraTeachers() {
  const ta = $('extra-teachers-input');
  if (!ta) return;
  const names = (ta.value || '').split(/[\n,,、]+/).map(s => s.trim()).filter(Boolean);
  const r = await fetch('/api/extra-teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd || 'admin888' },
    body: JSON.stringify({ teachers: names })
  });
  const data = await r.json().catch(() => ({}));
  if (data.success) {
    // 同步本地 scheduleData(allTeachers 合并新名单)
    if (scheduleData) {
      scheduleData.extraTeachers = data.teachers || [];
      scheduleData.allTeachers = [...new Set([...(scheduleData.allTeachers || []), ...(data.teachers || [])])].sort();
      localStorage.setItem('teachers_cache', JSON.stringify({ t: scheduleData.allTeachers, ts: Date.now() }));
    }
    toast('✅ 名单已保存(' + (data.teachers || []).length + ' 人)', 'success');
    renderImportPage($('main-content'));
  } else {
    toast('保存失败:' + (data.error || '未知错误'), 'error');
  }
}

async function handleJsonImport(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await doImport(data);
  } catch(e) {
    toast('JSON解析失败:'+e.message,'error');
  }
}

/**
 * 直接解析标准化的总课表 Excel
 * 格式:教师姓名|星期|节次|班级|课程|教师
 */
// 日期规范化:'周一'/'周二'/... → '星期一'/'星期二'/...
const DAY_NORM = { '周一':'星期一','周二':'星期二','周三':'星期三','周四':'星期四','周五':'星期五','周六':'星期六','周日':'星期日' };
function normDay(d) { return DAY_NORM[d] || d; }

/**
 * 社团活动安排表:整体存入 KV,点击按钮原样弹出,【不解析】
 * 数据形状:{ sheets: [{ name, rows: [[...], [...]] }], uploadedAt }
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
      if (status) status.textContent = `✅ 已导入 ${sheets.length} 个 Sheet(${sheets.map(s => s.name).join(' / ')})`;
      toast(r.message || '社团活动表导入成功', 'success');
      // 刷新本地缓存
      if (scheduleData) {
        scheduleData.clubActivities = clubData;
      } else {
        scheduleData = { timetable: {}, teacherAssignment: {}, afterSchoolService: {}, calendar: null, classes: [], allTeachers: [], clubActivities: clubData };
      }
      renderImportPage(document.getElementById('main-content'));
    } else {
      if (status) status.textContent = '❌ 导入失败:' + (r.error || '未知错误');
      toast('导入失败:' + (r.error || ''), 'error');
    }
  } catch(e) {
    loading.remove();
    if (status) status.textContent = '❌ 读取失败:' + e.message;
    toast('Excel 读取失败:' + e.message, 'error');
  }
}

function showClubTable() {
  const td = scheduleData || {};
  const data = td.clubActivities;
  // 懒创建弹窗容器(initApp 会重写 body,静态节点会被冲掉,故此处动态补回)
  let modal = document.getElementById('club-table-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'club-table-modal';
    document.body.appendChild(modal);
  }
  if (!data || !Array.isArray(data.sheets) || data.sheets.length === 0) {
    toast('尚未导入社团活动安排表,请先在"导入课表"页上传', 'warning');
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
    if (!sh.rows || sh.rows.length === 0) { html += `<p class="text-muted">(此 Sheet 无内容)</p>`; continue; }
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
    if (!data) { toast('未识别到总课表数据,请检查格式','error'); return; }
    await doImport(data);
  } catch(e) {
    loading.remove();
    toast('Excel 解析失败:'+e.message,'error');
  }
}

/**
 * 解析课后服务安排表(独立 Sheet)
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

    // 直接解析第一个 Sheet(可能是 Sheet1/单周/双周等),标记为单周或双周
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
      statusEl.innerHTML = `单周:${singleOk} ${afterSchoolTemp.single?.slots?.length || 0}时段 / 双周:${doubleOk} ${afterSchoolTemp.double?.slots?.length || 0}时段`;
    }

    toast(`${weekType === 'single' ? '单周' : '双周'}表已加载:${data.days?.length||0} 天 ${data.slots?.length||0} 时段`,'success');

    // 如果两个都加载了,自动合并导入
    if (afterSchoolTemp.single && afterSchoolTemp.double) {
      await mergeAndImportAfterSchool();
    }
  } catch(e) {
    loading.remove();
    toast(`${weekType === 'single' ? '单周' : '双周'}表解析失败:`+e.message,'error');
  }
}

// ══════════════════════════════════════════════════════
//  校历表解析(支持同结构新校历表复用)
//  校历表结构:
//    row0: 标题(学期名)
//    row1: 开始日期 如 "3/1/26"
//    row2: 表头 [月份, 周次, 星期日..星期六, 每周事务, 值周领导, 负责人, 值周教师, 值周班级]
//    row3+: 每周一行;col0=月份(三/四/...),col1=周次(1..N),col2-8=周日~周六日期
//          日期格式:"1" 或 "12\n植树节" 或 "4\n清明 休";含"休"=放假
//          跨月周拆成两行:第一行带周次(上月部分),第二行是新月份行(无周次,并入同一周)
// ══════════════════════════════════════════════════════
function parseCalendarWorkbook(wb) {
  const sn = wb.SheetNames[0];
  const ws = wb.Sheets[sn];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });

  // 1. 找表头行(含"周次"+ 含"星期日")
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
  if (headerRow === -1) throw new Error('未找到校历表头(需含"周次"列)');

  // 2. 解析开始日期行(表头上一行 col0):如 "3/1/26"
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
  const cn2int = (s) => {
    if (!s) return 0;
    const d = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
    if (s === '十') return 10;
    if (s.indexOf('十') >= 0) { const p = s.split('十'); const t = p[0] ? d[p[0]] : 1; const o = p[1] ? d[p[1]] : 0; return t * 10 + o; }
    return d[s] || 0;
  };

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

    // col0: 月份("三"/"四"...,跨月行也会出现)
    const monthStr = String(r[0] || '').trim();
    {
      const ym = monthStr.match(/(\d{4})年(\d{1,2})月/);
      if (ym) { currentYear = parseInt(ym[1]); currentMonth = parseInt(ym[2]); prevMonthNum = currentMonth; }
      else { const md = parseInt(monthStr); if (!isNaN(md) && md > 0) { if (prevMonthNum && md < prevMonthNum) currentYear++; currentMonth = md; prevMonthNum = md; } }
    }

    // col1: 周次(数字或中文数字 一/二/…/二十一)→ 新的一周;空 → 跨月行,并入当前周
    const weekStr = String(r[1] || '').trim();
    const wn = cn2int(weekStr);
    if (weekStr && wn) {
      const weekNum = wn;
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
      // 防重复(跨月行同一日期可能出现两次)
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
    const ok = confirm(`校历表解析成功:\n学期:${calendar.term}\n日期范围:${calendar.startDate} ~ ${calendar.endDate}\n共 ${calendar.stats.weeks} 周(单周 ${calendar.weeks.filter(w=>w.parity==='single').length} / 双周 ${calendar.weeks.filter(w=>w.parity==='double').length})\n共 ${calendar.stats.days} 天,其中假日 ${calendar.stats.holidays} 天\n\n确认导入?`);
    if (!ok) return;

    await doImport({ calendar });
  } catch(e) {
    loading.remove();
    console.error('[CalendarImport] error:', e);
    toast('校历表解析失败:' + e.message, 'error');
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

    // 只发送课后服务数据;总课表/校历等由后端沿用已有配置,避免误清空旧数据
    const importData = {
      afterSchoolService: merged
    };

    await doImport(importData);

    // 清空临时存储
    afterSchoolTemp = { single: null, double: null };
    const statusEl = $('afterschool-status');
    if (statusEl) statusEl.innerHTML = '';

    loading.remove();
    toast(`课后服务导入成功:${merged.days?.length||0} 天 ${merged.slots?.length||0} 时段`,'success');
  } catch(e) {
    loading.remove();
    toast('合并导入失败:'+e.message,'error');
  }
}

/**
 * 总课表解析 - 支持两种格式:
 * 1. 标准化格式(6列:教师姓名、星期、节次、班级、课程、教师)
 * 2. 原始总课表格式(每天21列,学科行+教师行)
 */
function parseTimetableWorkbook(wb) {
  // 优先找"总表",否则用第一个 Sheet
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
  // 归一化班级名(半角()->全角(), 六1->六(1)),避免重导时半角/全角混用造成重复
  const normCls = (s) => {
    s = String(s || '').trim();
    const m = s.match(/^([一二三四五六七])\s*[（(]?\s*(\d+)\s*[）)]?\s*$/);
    return m ? (m[1] + '（' + m[2] + '）') : s;
  };

  // 读取所有数据(header:1 返回二维数组)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows || rows.length < 10) return null;

  // 班级名在第3行(index 2),从第3列(index 2)开始
  const classRow = rows[2] || [];
  const classes = [];
  for (let c = 2; c < 22 && c < classRow.length; c++) {
    const raw = String(classRow[c] || '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') continue;
    const cls = normCls(raw);
    // 只接受形如 "一（1）"/"六(3)" 的班级名，过滤数字/文字/科目名等误匹配
    if (/^[一二三四五六七]（\d+）$/.test(cls)) classes.push(cls);
  }
  // 至少 3 个有效班级名才认定为横版格式
  if (classes.length < 3) return null;

  // 每天起始列(0-based index) —— 当前总课表各日块之间无空列,每块20班连续排列
  const dayConfig = [
    { day: '星期一', startCol: 2 },   // C列
    { day: '星期二', startCol: 22 },  // V列
    { day: '星期三', startCol: 42 },  // AP列
    { day: '星期四', startCol: 62 },  // BK列
    { day: '星期五', startCol: 82 }   // CG列
  ];

  // 节次定义(0-based row index)
  const periodConfig = [
    { period: 1, subjectRow: 5, teacherRow: 6 },    // 第6,7行
    { period: 2, subjectRow: 7, teacherRow: 8 },    // 第8,9行
    { period: 3, subjectRow: 10, teacherRow: 11 },  // 第11,12行
    { period: 4, subjectRow: 12, teacherRow: 13 },  // 第13,14行
    { period: 5, subjectRow: 18, teacherRow: 19 },  // 第19,20行
    { period: 6, subjectRow: 20, teacherRow: 21 }   // 第21,22行
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
          // 拆分双教师(按换行/逗号/分号/全角半角空格)
          const teacherList = teacherRaw.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t);
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
 * 解析标准化格式(6列表)
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
    const teacherList = teacherRaw.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t);
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
 * 列结构:[星期, 时间段, 空, 项目, 21 班教师...]
 */
function parseAfterSchoolWorkbook(wb) {
  console.log('[parseAfterSchoolWorkbook] All sheets:', wb.SheetNames);
  // 优先用「单周」/「双周」两个独立 Sheet(最准确的数据源)
  // 优先精确匹配 Sheet 名称,其次在 Sheet1 中按「单周」「双周」文件区分
  const sheetNames = wb.SheetNames;
  let singleSheet = sheetNames.find(n => /单周/.test(n) && !/双周/.test(n));
  let doubleSheet = sheetNames.find(n => /双周/.test(n) && !/单周/.test(n));
  // fallback:直接在 Sheet1 中解析(文件本身已区分单/双周)
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

  // 否则用 3.3执行 / 无午休 Sheet;同一单元格双教师 → 上一个=单周,下一个=双周
  const preferred = ['3.3执行','无午休'];
  let mainSheet = null;
  for (const n of preferred) if (wb.SheetNames.includes(n)) { mainSheet = n; break; }
  if (!mainSheet) mainSheet = wb.SheetNames[0];
  const base = parseAfterSchoolSheet(wb.Sheets[mainSheet], mainSheet);
  if (!base) return null;
  // 给 assignments 打 week 标记:双行拆分
  for (const slot of base.slots) {
    const newAssign = {};
    for (const cls in slot.assignments) {
      const v = slot.assignments[cls];
      // 提取教师名(可能是对象或字符串)
      let teachers = [];
      if (typeof v === 'object' && v !== null) {
        if (v.teacher) teachers.push(v.teacher);
        if (v.singleWeek) teachers.push(v.singleWeek);
        if (v.doubleWeek) teachers.push(v.doubleWeek);
      } else {
        teachers = String(v).split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t);
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
    // 匹配 "一1", "一(1)", "一(1)", "一 1" 等格式
    if (/[一二三四五六]/.test(header[i]) && /\d/.test(header[i])) {
      // 归一化名称为 "一（1）" 格式(全角括号),与 parseOriginalTimetableV2 对齐,避免半角/全角/无括号混用导致 classes 翻倍
      const m = header[i].match(/^([一二三四五六七])\s*[（(]?\s*(\d+)\s*[）)]?\s*$/);
      if (m) {
        classCols.push({ idx: i, name: `${m[1]}（${m[2]}）` });
      } else {
        classCols.push({ idx: i, name: header[i] });
      }
    }
  }
  if (!classCols.length) return null;

  // 节次映射:课后服务1=7, 2=8, 3=9, 晚自习=10, 午休=11
  const PROJECT_PERIOD_MAP = {
    '课后服务1': 7,
    '课后服务2': 8,
    '课后服务3': 9,
    '晚自习': 10,
    '午休': 11
  };
  // 按时间段判断节次(处理"课后服务"不带数字的情况;支持全角冒号和破折号)
  const TIME_PERIOD_MAP = {
    '13:00': 11,  // 午休
    '14:40': 7,   // 周五课后服务
    '15:25': 8,   // 周五课后服务
    '15:40': 7,
    '16:25': 8,
    '16:10': 9,   // 周五课后服务
    '17:10': 9,
    '19:30': 10
  };
  const getPeriod = (project, timeRange) => {
    if (PROJECT_PERIOD_MAP[project]) return PROJECT_PERIOD_MAP[project];
    // 归一化时间串:全角冒号→半角,破折号→半角连字符
    const normalized = String(timeRange).replace(/[：]/g, ':').replace(/[—–]/g, '-');
    // 提取开始时间(第一个 HH:MM,避免匹到末尾时间)
    const m = normalized.match(/(\d{1,2}:\d{2})/);
    if (m) {
      return TIME_PERIOD_MAP[m[1]] || 0;
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

    // 存入时归一化星期:去掉空格/换行,转换为"星期一"格式
    const rawDay = String(r[0] || currentDay).trim();
    const normalizedDay = normDay(rawDay.replace(/\s/g, ''));
    const slot = { day: normalizedDay, time: timeRange, project, period, sheet: sheetName, assignments: {} };
    for (const c of classCols) {
      let v = r[c.idx];
      // 处理富文本/对象:只取文字
      if (v && typeof v === 'object') {
        if (v.richText) {
          v = v.richText.map(t => t.text || '').join('');
        } else {
          v = String(v);
        }
      }
      v = String(v || '').trim();
      if (!v || v === '[object Object]') continue;
      // 拆分双教师(按换行/中英文逗号/分号/任意空白字符)
      const parts = v.split(/[\n\r,,;;\s ]+/).map(t => t.trim()).filter(t => t);
      if (parts.length === 1) {
        slot.assignments[c.name] = { teacher: parts[0], week: '通用' };
      } else if (parts.length === 2) {
        // 记住:上一个名字 = 单周、下一个名字 = 双周
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
    toast('JSON格式错误:'+e.message,'error');
  }
}

async function loadScheduleData() {
  try {
    const r = await API.getSchedule();
    if (r && r.success) {
      scheduleData = {
        timetable: r.data || null,
        schoolName: r.schoolName || "施秉县双井镇中心小学",
        teacherAssignment: r.teacherAssignment || null,
        afterSchoolService: r.afterSchoolService || null,
        calendar: r.calendar || null,
        classes: r.classes || [],
        allTeachers: r.allTeachers || [],
        clubActivities: r.clubActivities || null
      };
    }
  } catch (e) { console.error('loadScheduleData failed', e); }
}
async function doImport(data) {
  if (!data.timetable && !data.classes && !data.calendar && !data.afterSchoolService && !data.clubActivities) {
    toast('数据格式不正确,缺少 timetable/classes/calendar/afterSchoolService/clubActivities','error'); return;
  }
  // 防呆:检测解析异常(如浏览器 XLSX 把单元格解析成 Promise,班级名变 "[object Promise]")
  if (data.timetable) {
    for (const day of Object.keys(data.timetable)) {
      for (const cls of Object.keys(data.timetable[day])) {
        if (typeof cls !== 'string' || cls.includes('[object ')) {
          toast('解析结果异常(班级名非法:'+cls+'),请刷新重试或联系管理员用脚本导入','error'); return;
        }
      }
    }
  }
  const loading = showLoading('正在导入...');
  try {
    const r = await API.importSchedule(data);
    loading.remove();
    if (r.success) {
      // ✅ 从后端重新加载完整数据(确保合并后的数据一致)
      await loadScheduleData();
      // 新学期导入新课表时,自动清空教师登录缓存,确保教师列表同步更新
      localStorage.removeItem('teachers_cache');
      toast(r.message || '导入成功!','success');
      renderImportPage($('main-content'));
    } else {
      toast('导入失败:'+r.error,'error');
    }
  } catch(e) {
    loading.remove();
    toast('网络错误','error');
  }
}

// ══════════════════════════════════════════════════════
//  通知设置页(管理员)
// ══════════════════════════════════════════════════════
function renderSettingsPage(area) {
  const cfg = JSON.parse(localStorage.getItem('notify_cfg') || '{}');
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('通知设置')}
    <h2 class="page-title">🔔 通知设置</h2>

    <div class="card">
      <h3>📱 企业微信通知</h3>
      <p class="text-muted">配置企业微信机器人 Webhook URL,有新请假/代课时会自动推送通知。</p>
      <div class="form-group">
        <label>Webhook URL</label>
        <input type="text" id="wx-webhook" class="form-input" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
               value="${esc(cfg.webhook||'')}">
      </div>
      <button class="btn btn-primary" onclick="saveNotifyCfg()">保存设置</button>
      <button class="btn btn-secondary" onclick="testWxNotify()">发送测试消息</button>
    </div>

    <div class="card">
      <h3>📧 邮件通知(可选)</h3>
      <div class="form-group">
        <label>管理员邮箱</label>
        <input type="email" id="notify-email" class="form-input" placeholder="admin@example.com"
               value="${esc(cfg.email||'')}">
      </div>
      <button class="btn btn-primary" onclick="saveNotifyCfg()">保存</button>
    </div>

    <div class="card">
      <h3>👥 教师企业微信账号配置</h3>
      <p class="text-muted">配置教师的企业微信账号,用于发送私聊通知。格式:教师姓名=企业微信账号,每行一个。</p>
      <div class="form-group">
        <label>教师账号列表</label>
        <textarea id="teacher-wechat-list" class="form-input" rows="10" placeholder="龙杰=longjie&#10;张烨=zhangye&#10;潘懂平=pandongping&#10;校长=zhangsan&#10;管理员=lisi" style="font-family:monospace;font-size:12px;"></textarea>
      </div>
      <button class="btn btn-primary" onclick="saveTeacherWechat()">保存配置</button>
      <button class="btn btn-secondary" onclick="loadTeacherWechat()">加载现有配置</button>
    </div>
    <script>loadTeacherWechat();</script>

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
      <h3>i️ 关于本系统</h3>
      <p id="v186-sn-about">施秉县双井镇中心小学 · 代课调课系统 v1.0</p>
      <p class="text-muted">基于云端数据库,支持多端同步。不依赖主机电脑,随时随地访问。</p>
      <p class="text-muted">默认管理员密码:<code>admin888</code></p>
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
      body: JSON.stringify({ msgtype:'text', text:{ content:'🔔 代课调课系统通知测试消息\n时间:'+new Date().toLocaleString('zh-CN') } })
    });
    if (r.ok) toast('测试消息发送成功','success');
    else toast('发送失败:'+r.status,'error');
  } catch(e) {
    toast('网络错误','error');
  }
}

// 加载教师企业微信账号配置
async function loadTeacherWechat() {
  try {
    const r = await fetch('/api/teacher-wechat', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } });
    const obj = await r.json();
    if (obj.success) {
      const map = obj.data || {};
      const lines = Object.entries(map).map(([name, account]) => `${name}=${account}`);
      const textarea = $('teacher-wechat-list');
      if (textarea) textarea.value = lines.join('\n');
    }
  } catch(e) {
    console.error('加载教师企业微信账号失败:', e);
  }
}

// 保存教师企业微信账号配置
async function saveTeacherWechat() {
  const textarea = $('teacher-wechat-list');
  if (!textarea) return;

  const lines = textarea.value.trim().split('\n').filter(Boolean);
  const map = {};
  for (const line of lines) {
    const [name, account] = line.split('=').map(s => s.trim());
    if (name && account) {
      map[name] = account;
    }
  }

  try {
    const r = await fetch('/api/teacher-wechat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd || 'admin888' },
      body: JSON.stringify({ teacherWechatMap: map })
    });
    const obj = await r.json();
    if (obj.success) {
      toast('教师企业微信账号已保存','success');
    } else {
      toast('保存失败: ' + (obj.error || '未知错误'), 'error');
    }
  } catch(e) {
    toast('网络错误', 'error');
  }
}

// 管理员:加载设置了隐私密码的教师列表
async function loadTeacherPwdList() {
  const container = $('teacher-pwd-list');
  if (!container) return;

  container.innerHTML = '<p style="color:#6B7280; font-size:13px;">加载中...</p>';

  const result = await getTeachersWithPrivacyPwd();
  if (!result.success) {
    container.innerHTML = '<p style="color:#EF4444; font-size:13px;">加载失败:' + esc(result.error || '未知错误') + '</p>';
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

// 管理员:重置教师隐私密码
async function adminResetTeacherPwd(teacherName) {
  if (!teacherName) {
    teacherName = $('reset-teacher-name')?.value?.trim();
  }
  if (!teacherName) {
    toast('请输入教师姓名', 'warning');
    return;
  }

  if (!confirm(`确定要重置 ${teacherName} 的隐私密码吗?\n重置后该教师查看请假记录和代课记录将不需要密码。`)) {
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
// ═════════════════════════════════════════════════════════
async function initApp() {
  // 恢复管理员身份
  const role = sessionStorage.getItem('role');
  if (role === 'admin') {
    isAdmin  = true;
    principalAuthed = false;
    adminPwd = sessionStorage.getItem('adminPwd') || '';
    sessionStorage.removeItem('principalAuthed');
  } else if (role === 'principal') {
    // 恢复校长身份:先从 API 加载真实密码
    isAdmin = false;
    principalAuthed = true;
    const storedPwd = sessionStorage.getItem('principalPwd');
    if (storedPwd) {
      principalPwd = storedPwd;
    }
    currentPage = 'principal';
  } else if (role === 'teacher') {
    // 教师端:确保清除校长身份标记
    isAdmin = false;
    principalAuthed = false;
    sessionStorage.removeItem('principalAuthed');
  }

  document.body.innerHTML = renderAppShell();

  // 加载数据(带5秒超时,防止单个请求卡死;校长模式跳过leaves/slips由loadAndRenderPrincipalPage单独处理)
  const timeout = (ms, p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r({success:false, error:'timeout'}), ms))]);
  let schR = {success:false, data:null}, leavesR = {success:false, data:[]}, subsR = {success:false, data:[]}, slipsR = {success:false, data:[]};
  await Promise.all([
    timeout(15000, API.getSchedule()).then(r => schR = r),
    // 校长身份:leaves/slips由loadAndRenderPrincipalPage单独带密码请求,这里跳过避免401白等
    principalAuthed ? null : timeout(15000, API.getLeaves()).then(r => leavesR = r),
    principalAuthed ? null : timeout(15000, API.getSubstitutes()).then(r => subsR = r),
    principalAuthed ? null : timeout(15000, API.getLeaveSlips()).then(r => slipsR = r)
  ]);

  if (schR.success && schR.data && Object.keys(schR.data).length > 0) {
    scheduleData = {
      timetable: schR.data,
      teacherAssignment: schR.teacherAssignment || {},
      afterSchoolService: schR.afterSchoolService || {},
      calendar: schR.calendar || null,
      classes: schR.classes || [],
      allTeachers: schR.allTeachers || [],
      extraTeachers: schR.extraTeachers || [],
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
      extraTeachers: schR.extraTeachers || [],
      clubActivities: schR.clubActivities || null
    };
  }

  leaveRecords = (leavesR.success ? leavesR.data : []) || [];
  substituteRecords = (subsR.success ? subsR.data : []) || [];
  slipRecords = (slipsR.success ? slipsR.data : []) || [];

  // 教师端:检查是否有新安排的代课任务,推送通知
  const myName = sessionStorage.getItem('teacherName') || '';
  if (!isAdmin && myName) {
    checkAndNotifyNewSubstitutes(myName);
  }

  // 角色感知跳转,避免校长恢复后被强制切到首页
  if (principalAuthed) {
    switchPage('principal');
  } else {
    switchPage('home');
  }
}

// ══════════════════════════════════════════════════════

/* ══════════════════════════════════════════════════════
 *  v157 首屏加载优化（2026-09-08 23:30）
 *  - B 方案：拦截 API.getLeaveSlips，让 initApp 内的 Promise.all 立即拿到空响应
 *    不再等 leave-slips（首跳 1360ms / 103KB 实测瓶颈），首屏渲染时间 -1.3s
 *    后台异步真实 fetch，结果赋给 slipRecords 全局变量（虽然 renderSlipPage
 *    自己再 fetch，但首屏不卡）
 *  - C 方案：详见 index.html，xlsx CDN 加 defer（不阻塞 DOMContentLoaded）
 *  - 风险评估：v153 之前代码 0 字节改动，全部在文件末尾追加
 *  ══════════════════════════════════════════════════════ */
(function v157Init() {
  if (typeof window === 'undefined') return;
  if (window.__v157Installed) return;
  window.__v157Installed = true;

  // 拦截 API.getLeaveSlips：让 initApp 内的 Promise.all 立即拿到空响应
  if (typeof API !== 'undefined' && API && typeof API.getLeaveSlips === 'function') {
    const __origGetLeaveSlips = API.getLeaveSlips.bind(API);
    API.getLeaveSlips = function v157FastGetLeaveSlips(...args) {
      // 立即返回已 resolved 的 promise，Promise.all 不再等待
      const fastResult = Promise.resolve({ success: false, data: [], __v157: 'fast-path' });
      // 后台异步真实加载，结果存 slipRecords
      setTimeout(() => {
        __origGetLeaveSlips(...args).then(r => {
          if (r && r.success) {
            try { slipRecords = r.data || []; } catch (e) { /* slipRecords 未定义时忽略 */ }
          }
        }).catch(e => console.log('[v157] 后台 leave-slips 失败:', e));
      }, 200);
      return fastResult;
    };
  }
  console.log('[v157] 首屏加载优化已安装');
})();
//  请假条管理页(管理员)
// ══════════════════════════════════════════════════════
async function renderSlipPage(area) {
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('请假条管理')}
    <h2 class="page-title">📄 请假条管理</h2>
    <p class="text-muted" style="margin:0 0 12px;">事假/病假请假条永久存档,支持查看和打印导出。</p>
    <div id="slip-admin-list"></div>
  </div>`;
  await loadSlipAdminList();
}

async function loadSlipAdminList() {
  const el = $('slip-admin-list');
  if (!el) return;
  el.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:20px;">加载中...</p>';
  try {
    const r = await fetch('/api/leave-slips', { headers: { 'x-admin-pwd': adminPwd || 'admin888' } });
    const j = await r.json();
    if (!j.success) { el.innerHTML = '<p style="color:#DC2626; text-align:center;">加载失败</p>'; return; }
    const slips = (j.data || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    slipRecords = slips; // 同步全局,供 showSlipDetailModal 等使用
    if (slips.length === 0) { el.innerHTML = '<p class="text-muted" style="text-align:center;">暂无请假条</p>'; return; }
    el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>教师</th><th>假别</th><th>请假时间</th><th>时长</th><th>审批状态</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody>
          ${slips.map(s => `
          <tr>
            <td>${esc(s.teacherName)}</td>
            <td>${esc(s.reason)}</td>
            <td>${fmtDate(s.startDate)}${s.startDate !== s.endDate ? ' ~ ' + fmtDate(s.endDate) : ''}</td>
            <td>${s.duration != null ? s.duration + ' 天' : calcLeaveDays(s.startDate, s.endDate) + ' 天'}</td>
            <td><span class="badge badge-${s.status==='approved'?'green':s.status==='pending'?'yellow':'red'}">${s.status==='approved'?'✅ 同意':s.status==='pending'?'⏳ 待批':'❌ 拒绝'}</span></td>
            <td>${new Date(s.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
            <td><button class="btn btn-sm" onclick="showSlipDetailModal('${s.id}')">📋 查看</button><button class="btn btn-sm btn-danger" onclick="deleteSlip('${s.id}')" style="margin-left:6px;">🗑️ 删除</button></td>
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
          <tr><td style="padding:6px 0; color:#6B7280;">请假时长</td><td style="padding:6px 0;">${slip.duration != null ? slip.duration + ' 天' : calcLeaveDays(slip.startDate, slip.endDate) + ' 天'}</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">开始时间</td><td style="padding:6px 0;">${fmtDate(slip.startDate)}（${wday(slip.startDate)}）</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">结束时间</td><td style="padding:6px 0;">${fmtDate(slip.endDate)}（${wday(slip.endDate)}）</td></tr>
          <tr><td style="padding:6px 0; color:#6B7280;">提交时间</td><td style="padding:6px 0;">${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}</td></tr>
          ${slip.principalName ? '<tr><td style="padding:6px 0; color:#6B7280;">审批校长</td><td style="padding:6px 0;">'+esc(slip.principalName)+'</td></tr>' : ''}
          ${slip.principalSignedAt ? '<tr><td style="padding:6px 0; color:#6B7280;">审批时间</td><td style="padding:6px 0;">'+new Date(slip.principalSignedAt).toLocaleString('zh-CN',{hour12:false})+'</td></tr>' : ''}
        </table>
        ${slip.teacherSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">教师签字:</p><img src="'+slip.teacherSignature+'" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
        ${slip.principalSignature ? '<p style="color:#6B7280; font-size:13px; margin:12px 0 4px;">校长签字:</p><img src="'+slip.principalSignature+'" style="border:1px solid #E5E7EB; border-radius:4px; max-width:200px; display:block;"/>' : ''}
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
      <div id="slip-print-area" style="padding:28px; background:#fff; position:relative;">
        ${stampEl}
        <div style="text-align:center; margin-bottom:20px;">
          <div style="font-size:24px; font-weight:700; letter-spacing:6px;">请假条</div>
          <div style="font-size:13px; color:#6B7280; margin-top:6px;" id="v186-sn-footer">施秉县双井镇中心小学</div>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:15px; line-height:2;">
          <tr>
            <td style="padding:6px 10px; width:100px;"><b>教师姓名:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${esc(slip.teacherName)}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>假别:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${esc(slip.leaveType || slip.reason || '其他')}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>请假时长:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${slip.duration != null ? slip.duration + ' 天' : calcLeaveDays(slip.startDate, slip.endDate) + ' 天'}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px; vertical-align:top;"><b>请假事由:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333; height:52px; vertical-align:top;">${esc(slip.reason)}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>开始时间:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${fmtDate(slip.startDate)}（${wday(slip.startDate)}）</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>结束时间:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${fmtDate(slip.endDate)}（${wday(slip.endDate)}）</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>提交时间:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${new Date(slip.createdAt).toLocaleString('zh-CN',{hour12:false})}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>审批人:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${slip.status==='approved' || slip.status==='rejected' ? (esc(slip.principalName || '校长') + (slip.status==='approved' ? ' ✓ 同意' : ' ✗ 拒绝')) : '待审批'}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>审批时间:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">${slip.principalSignedAt ? new Date(slip.principalSignedAt).toLocaleString('zh-CN',{hour12:false}) : '-'}</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>教师签字:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">
              ${slip.teacherSignature ? '<img src="'+slip.teacherSignature+'" style="max-height:40px; max-width:160px; object-fit:contain; vertical-align:middle;"/>' : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><b>校长签字:</b></td>
            <td style="padding:6px 10px; border-bottom:1px solid #333;">
              ${slip.principalSignature ? '<img src="'+slip.principalSignature+'" style="max-height:40px; max-width:160px; object-fit:contain; vertical-align:middle;"/>' : ''}
            </td>
          </tr>
        </table>
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
  const w = window.open('', '_blank', 'width=680,height=900');
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>请假条</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"SimSun","宋体",serif;padding:32px 36px;font-size:15px;line-height:2;background:#fff;}table{width:100%;border-collapse:collapse;}td{padding:6px 10px;vertical-align:top;}b{display:inline-block;width:90px;}img{max-height:40px;max-width:160px;object-fit:contain;vertical-align:middle;}@media print{body{padding:0;}}</style></head><body>' + html + '</body></html>');
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

// 删除请假条
async function deleteSlip(slipId) {
  if (!confirm('确定要删除这条请假条吗?删除后不可恢复。')) return;
  try {
    const r = await fetch(`/api/leave-slips/${slipId}`, {
      method: 'DELETE',
      headers: { 'x-admin-pwd': adminPwd || 'admin888' }
    });
    const j = await r.json();
    if (j.success) {
      toast('请假条已删除', 'success');
      // 关闭可能打开的详情弹窗
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
      // 刷新列表
      await loadSlipAdminList();
    } else {
      toast(j.message || '删除失败', 'error');
    }
  } catch (err) {
    toast('网络错误,删除失败', 'error');
  }
}

// 检查并推送新安排的代课任务(教师端)
function checkAndNotifyNewSubstitutes(teacherName) {
  // 当前教师作为代课人的记录
  const mySubs = substituteRecords.filter(s => s.substituteTeacher === teacherName);
  if (mySubs.length === 0) return;

  // 已通知过的 ID 列表(存 localStorage,避免重复推送)
  const notifiedKey = 'notified_substitutes';
  const notified = JSON.parse(localStorage.getItem(notifiedKey) || '[]');

  // 筛选出新记录的代课任务(ID 未在 notified 中的)
  const newSubs = mySubs.filter(s => !notified.includes(s.id));
  if (newSubs.length === 0) return;

  // 1. 浏览器内弹窗推送(醒目)
  showSubstituteNotification(teacherName, newSubs);

  // 2. 记录已通知的 ID
  const newNotified = [...notified, ...newSubs.map(s => s.id)];
  localStorage.setItem(notifiedKey, JSON.stringify(newNotified));

  // 3. 如果配置了企业微信 Webhook,同时推送微信(可选)
  const notifyCfg = JSON.parse(localStorage.getItem('notify_cfg') || '{}');
  if (notifyCfg.wecom_webhook) {
    newSubs.forEach(s => {
      const msg = `【代课提醒】${teacherName}老师,您被安排代课:\n请假教师:${s.leaveTeacher}\n日期:${s.leaveDate}(${formatSubstituteWeekday(s)||''})\n班级:${s.className}\n科目:${s.subject||''}\n节次:第${s.period}节`;
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
        <strong style="color:#F59E0B;">📌 您被安排了新的代课任务!</strong>
      </p>
      ${subs.map(s => `
      <div style="background:#FEF3C7; border-left:3px solid #F59E0B; padding:10px 12px; margin-bottom:8px; border-radius:4px;">
        <div style="font-size:13px; color:#1F2937;">
          <div><strong>请假教师:</strong>${esc(s.leaveTeacher||'-')}</div>
          <div><strong>日期:</strong>${esc(s.leaveDate)} ${esc(formatSubstituteWeekday(s)||'')}</div>
          <div><strong>班级:</strong>${esc(s.className||'-')}</div>
          <div><strong>科目:</strong>${esc(s.subject||'-')}</div>
          <div><strong>节次:</strong>第${s.period}节</div>
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

// ══════════════════════════════════════════════════════
//  共享文件夹 v149 (R2) — 纯新增,不动任何 v148 现有逻辑
// ══════════════════════════════════════════════════════
// 鉴权(v94 教训):浏览器禁止中文 header,x-teacher-name 只发 ASCII 占位符 '1';
//   真实姓名一律放 form/body 字段(uploader),后端据此记录/校验。
const SHARED_ALLOWED_EXTS = ['.docx', '.xlsx', '.pptx', '.pdf', '.jpg', '.jpeg', '.png', '.zip', '.txt', '.mp4', '.doc']; // v154: 增加 .doc
let sharedCache = { files: [], totalBytes: 0, hardLimitBytes: 10 * 1024 * 1024 * 1024, categories: ['教案','课件','通知','其他'] };

function fmtBytes(b) {
  if (!b && b !== 0) return '-';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function sharedAuthHeaders() {
  const h = {};
  if (isAdmin) {
    h['x-admin-pwd'] = adminPwd || 'admin888';
  } else if (principalAuthed) {
    h['x-principal-pwd'] = principalPwd || 'principal888';
  } else {
    h['x-teacher-name'] = '1'; // ASCII 占位符,真实姓名走 body/form
  }
  return h;
}

function sharedMyName() {
  if (isAdmin) return '管理员';
  return sessionStorage.getItem('teacherName') || '';
}

function renderSharedPage(area) {
  area.innerHTML = `
  <div class="page">
    ${mobileBackBar('共享文件夹')}
    <h2 class="page-title">📁 共享文件夹</h2>
    <p class="text-muted" style="margin:0 0 14px;">学校共享文件库(教案·课件·通知等)。教师可上传/下载,管理员可上传/下载/删除。</p>

    <div style="background:#fff; border:1px solid #E5E7EB; border-radius:10px; padding:14px 16px; margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
        <span style="font-size:13px; color:#4B5563; font-weight:600;">容量使用</span>
        <span style="font-size:13px; color:#8B5CF6; font-weight:700;" id="shared-usage-text">加载中...</span>
      </div>
      <div style="background:#EDE9FE; border-radius:6px; height:10px; overflow:hidden;">
        <div id="shared-usage-bar" style="height:100%; width:0%; background:linear-gradient(90deg,#8B5CF6,#6D28D9); border-radius:6px; transition:width .4s;"></div>
      </div>
      <div id="shared-upload-panel" style="margin-top:14px;">
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <input type="file" id="shared-file-input" style="font-size:13px; flex:1; min-width:180px;"
                 accept=".docx,.xlsx,.pptx,.pdf,.jpg,.jpeg,.png,.zip,.txt,.mp4,.doc">
          <select id="shared-category" class="form-input" style="width:auto; padding:6px 10px; font-size:13px;">
            ${(sharedCache.categories||[]).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
          <input type="text" id="shared-note" class="form-input" placeholder="备注(可选)" style="flex:1; min-width:140px; font-size:13px;">
          <button class="btn btn-primary" onclick="uploadSharedFile()">⬆️ 上传</button>
        </div>
        <div style="font-size:12px; color:#9CA3AF; margin-top:6px;">单个文件 ≤50MB(MP4 ≤100MB); 类型:${SHARED_ALLOWED_EXTS.join(' ')}</div>
      </div>
    </div>

    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;" id="shared-filter-row">
      ${isAdmin ? '<button class="btn btn-sm" onclick="adminManageCategories()" style="background:#F5F3FF; color:#6D28D9; border:1px dashed #8B5CF6; margin-right:6px;">⚙️ 管理分类</button>' : ''}
      <button class="btn btn-sm shared-filter-btn" data-cat="" onclick="filterSharedFiles('')" style="background:#8B5CF6; color:#fff;">全部</button>
      ${renderSharedFilterBtns()}
    </div>

    <div id="shared-file-list"><p style="color:#9CA3AF; text-align:center; padding:30px;">加载中...</p></div>
  </div>`;
  loadSharedFiles();
}

function renderSharedFilterBtns() {
  return (sharedCache.categories || []).map(c =>
    `<button class="btn btn-sm shared-filter-btn" data-cat="${esc(c)}" onclick="filterSharedFiles(this.dataset.cat)" style="background:#F3F4F6; color:#374151;">${esc(c)}</button>`
  ).join('');
}

let sharedFilterCat = '';

function filterSharedFiles(cat) {
  sharedFilterCat = cat || '';
  document.querySelectorAll('.shared-filter-btn').forEach(b => {
    const active = (b.dataset.cat || '') === sharedFilterCat;
    b.style.background = active ? '#8B5CF6' : '#F3F4F6';
    b.style.color = active ? '#fff' : '#374151';
  });
  renderSharedFileList();
}

async function loadSharedFiles() {
  const listEl = $('shared-file-list');
  if (!listEl) return;
  listEl.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:30px;">加载中...</p>';
  try {
    const r = await fetch('/api/shared/list', { headers: sharedAuthHeaders() });
    const j = await r.json();
    if (!j.success) {
      listEl.innerHTML = `<p style="color:#DC2626; text-align:center; padding:30px;">加载失败:${esc(j.error || '未知错误')}</p>`;
      return;
    }
    sharedCache = { files: j.files || [], totalBytes: j.totalBytes || 0, hardLimitBytes: j.hardLimitBytes || (10 * 1024 * 1024 * 1024), categories: j.categories || sharedCache.categories || ['教案','课件','通知','其他'] };
    renderSharedUsage();
    // v151 fix: 分类列表变化后,重渲染筛选按钮行(保留'管理分类'按钮和'全部'按钮)
    const filterRow = document.getElementById('shared-filter-row');
    if (filterRow) {
      const adminBtn = filterRow.querySelector('button[onclick="adminManageCategories()"]');
      filterRow.innerHTML = (adminBtn ? adminBtn.outerHTML : '') +
        '<button class="btn btn-sm shared-filter-btn" data-cat="" onclick="filterSharedFiles(\'\')" style="background:#8B5CF6; color:#fff;">全部</button>' +
        renderSharedFilterBtns();
    }
        // v152 fix: 上传弹窗的 #shared-category select 也要重渲染(共享同一份 sharedCache.categories)
        const categorySel = document.getElementById('shared-category');
        if (categorySel) {
          categorySel.innerHTML = (sharedCache.categories || []).map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
        }

    renderSharedFileList();
  } catch (err) {
    listEl.innerHTML = '<p style="color:#DC2626; text-align:center; padding:30px;">网络错误</p>';
  }
}

function renderSharedUsage() {
  const used = sharedCache.totalBytes || 0;
  const limit = sharedCache.hardLimitBytes || (10 * 1024 * 1024 * 1024);
  const pct = Math.min(100, Math.round(used / limit * 100));
  const usageEl = $('shared-usage-text');
  const barEl = $('shared-usage-bar');
  if (usageEl) usageEl.textContent = `${fmtBytes(used)} / ${fmtBytes(limit)} (${pct}%)`;
  if (barEl) {
    barEl.style.width = pct + '%';
    barEl.style.background = pct >= 90 ? 'linear-gradient(90deg,#EF4444,#DC2626)' : 'linear-gradient(90deg,#8B5CF6,#6D28D9)';
  }
  // 总容量满 → 全员禁传(前端提示;后端同样校验)
  const uploadPanel = $('shared-upload-panel');
  if (uploadPanel) {
    const btn = uploadPanel.querySelector('button');
    if (btn) btn.disabled = used >= limit;
  }
}

function renderSharedFileList() {
  const listEl = $('shared-file-list');
  if (!listEl) return;
  const myName = sharedMyName();
  const files = sharedCache.files || [];
  const filtered = sharedFilterCat ? files.filter(f => f.category === sharedFilterCat) : files;
  if (filtered.length === 0) {
    listEl.innerHTML = '<p style="color:#9CA3AF; text-align:center; padding:30px;">暂无文件(可点击上方按钮上传)</p>';
    return;
  }
  listEl.innerHTML = `
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr><th>文件名</th><th>分类</th><th>大小</th><th>上传者</th><th>备注</th><th>上传时间</th><th>操作</th></tr></thead>
      <tbody>
        ${filtered.map(f => `
        <tr>
          <td style="max-width:220px; word-break:break-all;">${esc(f.fileName)}</td>
          <td><span class="badge badge-blue">${esc(f.category || '其他')}</span></td>
          <td>${fmtBytes(f.size)}</td>
          <td>${esc(f.uploader || '-')}</td>
          <td style="max-width:140px; word-break:break-all; color:#6B7280;">${esc(f.note || '') || '-'}</td>
          <td>${f.uploadedAt ? new Date(f.uploadedAt).toLocaleString('zh-CN',{hour12:false}).replace(/\//g,'-') : '-'}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-sm" onclick="downloadSharedFile('${f.id}')">⬇️ 下载</button>
            ${(isAdmin || f.uploader === myName) ? `<button class="btn btn-sm" style="margin-left:4px;" onclick="openSharedEditModal('${f.id}')">✏️ 修改</button>` : ''}
            ${isAdmin ? `<button class="btn btn-sm btn-danger" style="margin-left:4px;" onclick="askDeleteSharedFile('${f.id}')">🗑️ 删除</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  <p style="font-size:12px; color:#9CA3AF; margin-top:8px;">共 ${filtered.length} 个文件</p>`;
}

function sharedValidateFile(file) {
  if (!file) return '请先选择文件';
  const name = file.name || '';
  const idx = name.lastIndexOf('.');
  const ext = idx >= 0 ? name.slice(idx).toLowerCase() : '';
  if (!SHARED_ALLOWED_EXTS.includes(ext)) return '文件类型不允许: ' + (ext || '(无后缀)') + '。允许: ' + SHARED_ALLOWED_EXTS.join('/');
  const limit = ext === '.mp4' ? 100 * 1024 * 1024 : 50 * 1024 * 1024;
  if (file.size > limit) return '文件超过 ' + (ext === '.mp4' ? 100 : 50) + 'MB 上限';
  if ((sharedCache.totalBytes || 0) + file.size > (sharedCache.hardLimitBytes || (10 * 1024 * 1024 * 1024))) {
    return '共享文件夹总容量已满(10GB 上限),请联系管理员清理';
  }
  return '';
}

async function uploadSharedFile() {
  const input = $('shared-file-input');
  const file = input && input.files && input.files[0];
  const err = sharedValidateFile(file);
  if (err) { toast(err, 'warning'); return; }

  const fd = new FormData();
  fd.append('file', file);
  fd.append('category', ($('shared-category') && $('shared-category').value) || '其他');
  fd.append('note', ($('shared-note') && $('shared-note').value.trim()) || '');
  fd.append('uploader', sharedMyName()); // 真实姓名走 form 字段(中文 header 被浏览器禁)

  const btn = document.querySelector('#shared-upload-panel button');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 上传中...'; }
  try {
    const r = await fetch('/api/shared/upload', { method: 'POST', headers: sharedAuthHeaders(), body: fd });
    const j = await r.json();
    if (j.success) {
      toast('✅ 上传成功', 'success');
      if (input) input.value = '';
      const noteEl = $('shared-note'); if (noteEl) noteEl.value = '';
      await loadSharedFiles();
    } else {
      toast(j.error || '上传失败', 'error');
    }
  } catch (e2) {
    toast('网络错误:' + (e2.message || e2), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬆️ 上传'; }
  }
}

async function downloadSharedFile(id) {
  const f = (sharedCache.files || []).find(x => x.id === id);
  if (!f) { toast('文件不存在', 'error'); return; }
  try {
    const r = await fetch('/api/shared/download?id=' + encodeURIComponent(id), { headers: sharedAuthHeaders() });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      toast(j.error || '下载失败', 'error');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.fileName || '下载';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    toast('下载失败:' + (err.message || err), 'error');
  }
}

function askDeleteSharedFile(id) {
  const f = (sharedCache.files || []).find(x => x.id === id);
  if (!f) { toast('文件不存在', 'error'); return; }
  const name = f.fileName;
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:440px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px; color:#DC2626;">🗑️ 删除文件确认</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px;">
        <p style="margin:0 0 8px; font-size:14px; color:#374151;">删除后不可恢复。请输入完整文件名以确认:</p>
        <p style="margin:0 0 10px; font-size:14px; font-weight:600; color:#111827; word-break:break-all;">${name}</p>
        <input type="text" id="shared-delete-confirm-input" class="form-input" placeholder="输入上方完整文件名" style="width:100%; box-sizing:border-box;">
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer;">取消</button>
        <button onclick="doDeleteSharedFile('${id}')" style="padding:8px 16px; background:#DC2626; color:#fff; border:none; border-radius:6px; cursor:pointer;">确认删除</button>
      </div>
    </div>`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
  setTimeout(() => { const inp = $('shared-delete-confirm-input'); if (inp) inp.focus(); }, 50);
}

async function doDeleteSharedFile(id) {
  const f = (sharedCache.files || []).find(x => x.id === id);
  if (!f) { toast('文件不存在', 'error'); return; }
  const input = $('shared-delete-confirm-input');
  const typed = input ? input.value.trim() : '';
  if (typed !== f.fileName) { toast('文件名不匹配,无法删除', 'error'); return; }
  try {
    const r = await fetch('/api/shared/delete?id=' + encodeURIComponent(id) + '&confirmName=' + encodeURIComponent(typed), {
      method: 'DELETE', headers: sharedAuthHeaders()
    });
    const j = await r.json();
    if (j.success) {
      toast('✅ 已删除', 'success');
      const m = document.querySelector('.modal-overlay'); if (m) m.remove();
      await loadSharedFiles();
    } else {
      toast(j.error || '删除失败', 'error');
    }
  } catch (err) {
    toast('网络错误:' + (err.message || err), 'error');
  }
}

function openSharedEditModal(id) {
  const f = (sharedCache.files || []).find(x => x.id === id);
  if (!f) { toast('文件不存在', 'error'); return; }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff; border-radius:12px; max-width:440px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="padding:14px 20px; border-bottom:1px solid #E5E7EB; display:flex; align-items:center; justify-content:space-between;">
        <h3 style="margin:0; font-size:16px;">✏️ 修改文件信息</h3>
        <button onclick="this.closest('.modal-overlay').remove()" style="background:none; border:none; font-size:20px; cursor:pointer; color:#6B7280;">×</button>
      </div>
      <div style="padding:20px;">
        <p style="margin:0 0 14px; font-size:14px; font-weight:600; word-break:break-all;">${esc(f.fileName)}</p>
        <div style="margin-bottom:12px;">
          <label style="font-size:13px; color:#6B7280; display:block; margin-bottom:4px;">分类</label>
          <select id="shared-edit-category" class="form-input" style="width:100%; box-sizing:border-box;">
            ${(sharedCache.categories||[]).map(c => `<option value="${esc(c)}" ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:13px; color:#6B7280; display:block; margin-bottom:4px;">备注</label>
          <input type="text" id="shared-edit-note" class="form-input" value="${esc(f.note || '')}" style="width:100%; box-sizing:border-box;" placeholder="备注(可选)">
        </div>
      </div>
      <div style="padding:12px 20px; border-top:1px solid #E5E7EB; text-align:right; display:flex; gap:8px; justify-content:flex-end;">
        <button onclick="this.closest('.modal-overlay').remove()" style="padding:8px 16px; background:#9CA3AF; color:#fff; border:none; border-radius:6px; cursor:pointer;">取消</button>
        <button onclick="doUpdateSharedFile('${id}')" style="padding:8px 16px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer;">保存</button>
      </div>
    </div>`;
  modal.className = 'modal-overlay';
  document.body.appendChild(modal);
}

async function doUpdateSharedFile(id) {
  const category = ($('shared-edit-category') && $('shared-edit-category').value) || '其他';
  const note = ($('shared-edit-note') && $('shared-edit-note').value.trim()) || '';
  const body = { id, category, note };
  if (!isAdmin) body.uploader = sessionStorage.getItem('teacherName') || ''; // 真实姓名走 body
  try {
    const r = await fetch('/api/shared/update', {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, sharedAuthHeaders()),
      body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.success) {
      toast('✅ 已保存', 'success');
      const m = document.querySelector('.modal-overlay'); if (m) m.remove();
      await loadSharedFiles();
    } else {
      toast(j.error || '保存失败', 'error');
    }
  } catch (err) {
    toast('网络错误:' + (err.message || err), 'error');
  }
}


async function sharedUpdateCategoryApi(action, name, newName) {
  const fd = { action, name, newName: newName || '' };
  try {
    const r = await fetch('/api/shared/categories/update', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, sharedAuthHeaders()),
      body: JSON.stringify(fd)
    });
    const j = await r.json();
    return j;
  } catch (e) { return { success: false, error: '网络错误:' + (e.message || e) }; }
}

function adminManageCategories() {
  const cats = sharedCache.categories || [];
  const listHtml = cats.length
    ? cats.map(c => {
        const oldCount = (sharedCache.files || []).filter(f => f.category === c).length;
        return `<div style="display:flex; align-items:center; gap:6px; padding:8px 10px; background:#F9FAFB; border-radius:8px; margin-bottom:6px;">
          <span style="flex:1; font-size:14px; color:#1F2937;">${esc(c)}</span>
          <span style="font-size:12px; color:#9CA3AF;">${oldCount} 个文件</span>
          <button class="btn btn-sm" onclick="adminRenameCategoryPrompt('${esc(c)}')" style="background:#EEF2FF; color:#4338CA;">重命名</button>
          <button class="btn btn-sm" onclick="adminDeleteCategory('${esc(c)}')" style="background:#FEE2E2; color:#B91C1C;">删除</button>
        </div>`;
      }).join('')
    : '<p style="color:#9CA3AF; text-align:center; padding:20px;">暂无分类</p>';

  const body = `
    <div style="margin-bottom:14px;">
      <div style="display:flex; gap:6px; align-items:center;">
        <input id="admin-cat-new" class="form-input" placeholder="新分类名称" style="flex:1;">
        <button class="btn btn-primary" onclick="adminAddCategory()">➕ 添加</button>
      </div>
    </div>
    <div style="max-height:50vh; overflow-y:auto;">${listHtml}</div>
    <div style="margin-top:12px; padding:8px 10px; background:#FEF3C7; border-radius:6px; font-size:12px; color:#92400E;">
      💡 删除分类时该分类下的文件<strong>保留原分类名(已锁定)</strong>,仅从可选列表移除。
    </div>
  `;
  showModal('⚙️ 管理分类', body);
}

async function adminAddCategory() {
  const inp = $('admin-cat-new');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) { toast('请输入分类名', 'warning'); return; }
  const j = await sharedUpdateCategoryApi('add', name);
  if (j.success) {
    toast('✅ 已添加', 'success');
    sharedCache.categories = j.categories || [];
    inp.value = '';
    await loadSharedFiles();
    adminManageCategories();
  } else {
    toast(j.error || '添加失败', 'error');
  }
}

async function adminRenameCategoryPrompt(oldName) {
  const newName = prompt('将 "' + oldName + '" 重命名为:', oldName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) { toast('名称不能为空', 'warning'); return; }
  if (trimmed === oldName) return;
  const j = await sharedUpdateCategoryApi('rename', oldName, trimmed);
  if (j.success) {
    toast('✅ 已重命名', 'success');
    sharedCache.categories = j.categories || [];
    await loadSharedFiles();
    adminManageCategories();
  } else {
    toast(j.error || '重命名失败', 'error');
  }
}

async function adminDeleteCategory(name) {
  const oldCount = (sharedCache.files || []).filter(f => f.category === name).length;
  const msg = oldCount > 0
    ? '确认删除分类 "' + name + '"?\n\n该分类下还有 ' + oldCount + ' 个文件,将保留原分类名(已锁定),仅从可选列表移除。'
    : '确认删除分类 "' + name + '"?';
  if (!confirm(msg)) return;
  const j = await sharedUpdateCategoryApi('delete', name);
  if (j.success) {
    if (j.lockedFiles) toast('已删除,' + j.lockedFiles + ' 个老文件保留原分类', 'success');
    else toast('✅ 已删除', 'success');
    sharedCache.categories = j.categories || [];
    if (sharedFilterCat === name) sharedFilterCat = '';
    await loadSharedFiles();
    adminManageCategories();
  } else {
    toast(j.error || '删除失败', 'error');
  }
}

// ══════════════════════════════════════════════════════
//  v158 病假证明（管理员端"请假记录"弹窗增强）
//  纯追加：wrap showModal / showAdminLeaveHistory + 新增 v158* 函数
//  存储：R2 桶 proofs/xxx + KV 'leaveProofs'（新 key，不动旧 KV）
//  路由：/api/leave-proofs（新增文件 functions/api/leave-proofs.js）
// ══════════════════════════════════════════════════════
(function v158Init() {
  if (window.__v158Installed) return;
  window.__v158Installed = true;
  window.v158ProofCache = window.v158ProofCache || {};

  // 1) 弹窗加宽：包装 showModal，对"请假记录(管理员)"与"病假证明*"放宽 max-width 并允许横向滚动
  var __v158OrigShowModal = window.showModal;
  if (typeof __v158OrigShowModal === 'function') {
    window.showModal = function (title, content) {
      var r = __v158OrigShowModal.call(this, title, content);
      try {
        var t = String(title || '');
        if (t.indexOf('请假记录(管理员)') === 0 || t.indexOf('病假证明') === 0) {
          var ov = document.body.lastElementChild;
          var inner = ov && ov.firstElementChild;
          if (inner) {
            inner.style.maxWidth = '960px';
            inner.style.width = '96vw';
            var body = inner.children[1];
            if (body) { body.style.overflowX = 'auto'; }
          }
        }
      } catch (e) { /* ignore */ }
      return r;
    };
    window.__v158OrigShowModal = __v158OrigShowModal;
  }

  // 2) 管理员请假记录弹窗：加"假别"列 + 病假行"证明"按钮
  var __v158OrigShowAdminLeaveHistory = window.showAdminLeaveHistory;
  if (typeof __v158OrigShowAdminLeaveHistory === 'function') {
    window.showAdminLeaveHistory = function () {
      var out = __v158OrigShowAdminLeaveHistory.apply(this, arguments);
      try { v158EnhanceAdminLeaveModal(); } catch (e) { console.log('[v158] 增强失败:', e); }
      return out;
    };
    window.__v158OrigShowAdminLeaveHistory = __v158OrigShowAdminLeaveHistory;
  }
  console.log('[v158] 病假证明已安装');
})();

// 给已渲染的"请假记录(管理员)"弹窗插入"假别"列，并为病假行加"证明"按钮
function v158EnhanceAdminLeaveModal() {
  var overlay = document.body.lastElementChild;
  if (!overlay || !overlay.classList || !overlay.classList.contains('modal-overlay')) return;
  var table = overlay.querySelector('table.data-table');
  if (!table) return;
  var records = (typeof leaveRecords !== 'undefined' && leaveRecords) ? leaveRecords : [];
  var headRow = table.querySelector('thead tr');
  if (!headRow) return;
  var bodyRows = table.querySelectorAll('tbody tr');
  if (headRow.children.length < 8 || bodyRows.length !== records.length) return;
  if (headRow.querySelector('.v158-th')) return; // 防重复

  var th = document.createElement('th');
  th.className = 'v158-th';
  th.textContent = '假别';
  headRow.insertBefore(th, headRow.children[5]);

  bodyRows.forEach(function (tr, i) {
    var l = records[i];
    var tds = tr.children;
    if (!l || tds.length < 8) return;
    var td = document.createElement('td');
    td.className = 'v158-td';
    td.textContent = l.leaveType ? l.leaveType : '-';
    if (l.leaveType === '病假') {
      var btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-primary';
      btn.style.marginTop = '4px';
      btn.textContent = '📎 证明';
      btn.onclick = function () { v158OpenProofModal(l.id, l.teacherName); };
      td.appendChild(document.createElement('br'));
      td.appendChild(btn);
    }
    tr.insertBefore(td, tds[5]);
  });
}

function v158FindLeave(id) {
  return (typeof leaveRecords !== 'undefined' && leaveRecords) ? leaveRecords.find(function (l) { return l.id === id; }) : null;
}

function v158FormatSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function v158FormatTime(t) {
  if (!t) return '';
  var d = new Date(t);
  var p = function (x) { return String(x).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 打开"病假证明"对话框（上传 + 查看 + 下载 + 删除）
function v158OpenProofModal(leaveId, teacherName) {
  if (!isAdmin) { toast('无权访问', 'error'); return; }
  var leave = v158FindLeave(leaveId);
  var title = '病假证明 - ' + (teacherName || (leave && leave.teacherName) || '') + (leave ? ' ' + fmtDate(leave.leaveDate) : '');
  var html =
    '<div>' +
      '<div style="margin-bottom:12px; padding:10px; background:#F9FAFB; border:1px dashed #D1D5DB; border-radius:8px;">' +
        '<input type="file" id="v158-proof-input" multiple accept=".jpg,.jpeg,.png,.pdf" style="font-size:13px; max-width:100%;">' +
        '<button class="btn btn-sm btn-primary" style="margin-left:8px;" onclick="v158UploadProof(\'' + leaveId + '\')">上传</button>' +
        '<div style="margin-top:6px; font-size:12px; color:#6B7280;">支持 jpg / png / pdf，可多选，单文件不超过 20MB</div>' +
      '</div>' +
      '<div id="v158-proof-list"></div>' +
    '</div>';
  showModal(title, html);
  v158RenderProofList(leaveId);
}

async function v158RenderProofList(leaveId) {
  var box = document.getElementById('v158-proof-list');
  if (!box) return;
  box.innerHTML = '<div style="color:#6B7280; font-size:13px; padding:8px 0;">加载中...</div>';
  try {
    var r = await fetch('/api/leave-proofs?leaveId=' + encodeURIComponent(leaveId), { headers: { 'x-admin-pwd': adminPwd } });
    var j = await r.json();
    var list = (j && j.success && j.data) ? j.data : [];
    window.v158ProofCache = window.v158ProofCache || {};
    list.forEach(function (p) { window.v158ProofCache[p.id] = p; });
    if (!list.length) {
      box.innerHTML = '<div style="color:#9CA3AF; font-size:13px; padding:8px 0;">暂无证明材料</div>';
      return;
    }
    box.innerHTML = list.map(function (p) {
      return '<div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #F3F4F6;">' +
        '<div style="min-width:0;">' +
          '<div style="font-size:14px; word-break:break-all;">📄 ' + esc(p.fileName || '未命名') + '</div>' +
          '<div style="font-size:12px; color:#9CA3AF;">' + v158FormatSize(p.size) + ' · ' + v158FormatTime(p.uploadedAt) + (p.uploader ? ' · ' + esc(p.uploader) : '') + '</div>' +
        '</div>' +
        '<div style="flex-shrink:0; white-space:nowrap;">' +
          '<button class="btn btn-sm btn-success" onclick="v158DownloadProof(\'' + p.id + '\')">下载</button> ' +
          '<button class="btn btn-sm btn-danger" onclick="v158DeleteProof(\'' + p.id + '\',\'' + leaveId + '\')">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    box.innerHTML = '<div style="color:#EF4444; font-size:13px; padding:8px 0;">加载失败: ' + esc(e && e.message ? e.message : String(e)) + '</div>';
  }
}

async function v158UploadProof(leaveId) {
  if (!isAdmin) { toast('无权访问', 'error'); return; }
  var inp = document.getElementById('v158-proof-input');
  if (!inp || !inp.files || !inp.files.length) { toast('请先选择文件', 'warning'); return; }
  var allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
  var files = Array.prototype.slice.call(inp.files);
  var ok = 0, fail = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var dot = f.name.lastIndexOf('.');
    var ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : '';
    if (allowed.indexOf(ext) < 0) { toast('不支持的类型: ' + f.name, 'error'); fail++; continue; }
    if (f.size > 20 * 1024 * 1024) { toast('文件过大(>20MB): ' + f.name, 'error'); fail++; continue; }
    try {
      var fd = new FormData();
      fd.append('file', f);
      fd.append('leaveId', leaveId);
      fd.append('uploader', '管理员');
      var r = await fetch('/api/leave-proofs', { method: 'POST', headers: { 'x-admin-pwd': adminPwd }, body: fd });
      var j = await r.json();
      if (j && j.success) ok++;
      else { fail++; toast((j && j.error) || '上传失败', 'error'); }
    } catch (e) { fail++; toast('上传失败: ' + (e && e.message ? e.message : e), 'error'); }
  }
  if (ok) toast('✅ 已上传 ' + ok + ' 个文件' + (fail ? '，失败 ' + fail + ' 个' : ''), 'success');
  inp.value = '';
  await v158RenderProofList(leaveId);
}

function v158DownloadProof(id) {
  var p = (window.v158ProofCache || {})[id];
  var name = (p && p.fileName) ? p.fileName : ('proof_' + id);
  fetch('/api/leave-proofs?action=download&id=' + encodeURIComponent(id), { headers: { 'x-admin-pwd': adminPwd } })
    .then(function (r) {
      if (!r.ok) throw new Error('下载失败 (' + r.status + ')');
      return r.blob();
    })
    .then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    })
    .catch(function (e) { toast(e && e.message ? e.message : '下载失败', 'error'); });
}

async function v158DeleteProof(id, leaveId) {
  if (!isAdmin) { toast('无权访问', 'error'); return; }
  if (!confirm('确认删除该证明文件？删除后不可恢复。')) return;
  try {
    var r = await fetch('/api/leave-proofs?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-admin-pwd': adminPwd } });
    var j = await r.json();
    if (j && j.success) { toast('已删除', 'success'); await v158RenderProofList(leaveId); }
    else toast((j && j.error) || '删除失败', 'error');
  } catch (e) { toast('删除失败: ' + (e && e.message ? e.message : e), 'error'); }
}

// ══════════════════════════════════════════════════════
//  v159 管理员端"代课记录历史"弹窗增强：
//  "代课教师"栏可修改（点击 ✏️ 弹出 select 下拉选择新代课教师）
//  纯追加：wrap showAdminSubstituteHistory + 新增 v159* 函数
//  后端：/api/substitute-update（新增文件 functions/api/substitute-update.js）
// ══════════════════════════════════════════════════════
(function v159Init() {
  if (window.__v159Installed) return;
  window.__v159Installed = true;

  // 包装 showAdminSubstituteHistory：原函数跑完后增强"代课教师"列
  var __v159Orig = window.showAdminSubstituteHistory;
  if (typeof __v159Orig === 'function') {
    window.showAdminSubstituteHistory = function () {
      var out = __v159Orig.apply(this, arguments);
      try { v159EnhanceAdminSubModal(); } catch (e) { console.log('[v159] 增强失败:', e); }
      return out;
    };
    window.__v159OrigShowAdminSubstituteHistory = __v159Orig;
  }
  console.log('[v159] 代课教师可编辑已安装');
})();

// 给已渲染的"代课记录历史(管理员)"弹窗的"代课教师"列每行加 ✏️ 编辑按钮
function v159EnhanceAdminSubModal() {
  var overlay = document.body.lastElementChild;
  if (!overlay || !overlay.classList || !overlay.classList.contains('modal-overlay')) return;
  var table = overlay.querySelector('table.data-table');
  if (!table) return;
  var records = (typeof substituteRecords !== 'undefined' && substituteRecords) ? substituteRecords : [];
  var bodyRows = table.querySelectorAll('tbody tr');
  if (!bodyRows.length || bodyRows.length !== records.length) return;
  if (table.querySelector('.v159-edit-btn')) return; // 防重复

  bodyRows.forEach(function (tr, i) {
    var subId = tr.getAttribute('data-sub-id');
    if (!subId) return;
    var s = v159FindSub(subId);
    if (!s) return;
    var cell = tr.children[3]; // 第4列：代课教师
    if (!cell) return;
    var btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-secondary v159-edit-btn';
    btn.style.marginLeft = '6px';
    btn.style.fontSize = '11px';
    btn.style.padding = '2px 6px';
    btn.style.lineHeight = '1';
    btn.textContent = '✏️';
    btn.title = '修改代课教师';
    btn.onclick = function (ev) { ev.stopPropagation(); v159OpenEdit(s.id); };
    cell.appendChild(btn);
  });
}

function v159FindSub(id) {
  return (typeof substituteRecords !== 'undefined' && substituteRecords) ? substituteRecords.find(function (x) { return x.id === id; }) : null;
}

// 关闭最近的一个 modal-overlay（用于保存/取消后清理弹窗）
function v159CloseTopModal() {
  var overlays = document.querySelectorAll('.modal-overlay');
  if (overlays && overlays.length) {
    var last = overlays[overlays.length - 1];
    if (last && last.parentNode) last.parentNode.removeChild(last);
  }
}

// 打开"修改代课教师"弹窗
function v159OpenEdit(id) {
  if (!isAdmin) { toast('无权访问', 'error'); return; }
  var s = v159FindSub(id);
  if (!s) { toast('记录不存在', 'error'); return; }
  var current = s.substituteTeacher || '';

  // 智能过滤：复用 getSubstituteOptions（排除请假教师、当天请假者、有课冲突者）
  var opts = '';
  try {
    if (typeof getSubstituteOptions === 'function') {
      opts = getSubstituteOptions(current, s) || '';
    }
  } catch (e) { opts = ''; console.log('[v159] getSubstituteOptions 异常:', e); }

  // 兜底：如果没拿到选项，用全部教师
  if (!opts) {
    var teachers = (typeof scheduleData !== 'undefined' && scheduleData && scheduleData.allTeachers) ? scheduleData.allTeachers : [];
    opts = teachers.map(function (t) {
      return '<option value="' + esc(t) + '"' + (t === current ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
  }

  var html =
    '<div>' +
      '<div style="margin-bottom:12px; padding:10px 12px; background:#F9FAFB; border:1px dashed #D1D5DB; border-radius:8px; font-size:13px; color:#374151;">' +
        '<div><b>请假教师</b>: ' + esc(s.leaveTeacher || '-') + '</div>' +
        '<div style="margin-top:4px;"><b>日期</b>: ' + esc(fmtDate(s.leaveDate)) + ' (' + esc(formatSubstituteWeekday(s) || '-') + ')' + '</div>' +
        '<div style="margin-top:4px;"><b>班级</b>: ' + esc(s.className || '-') + ' · <b>科目</b>: ' + esc(s.subject || '-') + ' · <b>节次</b>: 第' + (s.period || '-') + '节</div>' +
        '<div style="margin-top:4px;"><b>当前代课教师</b>: <span style="color:#2563EB;">' + esc(current || '-') + '</span></div>' +
      '</div>' +
      '<div style="padding:0 4px;">' +
        '<label style="display:block; font-size:13px; margin-bottom:6px;">新代课教师</label>' +
        '<select id="v159-new-teacher" style="width:100%; padding:8px 10px; border:1px solid #D1D5DB; border-radius:6px; font-size:14px;">' + opts + '</select>' +
        '<div style="margin-top:10px; display:flex; gap:8px; justify-content:flex-end;">' +
          '<button class="btn btn-sm" onclick="v159Cancel()">取消</button>' +
          '<button class="btn btn-sm btn-primary" onclick="v159Save(\'' + id + '\')">保存</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  showModal('修改代课教师', html);

  // 确保默认选中当前教师（防止 select 第一个 option 不对）
  var sel = document.getElementById('v159-new-teacher');
  if (sel && current) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === current) { sel.selectedIndex = i; break; }
    }
  }
}

function v159Cancel() {
  v159CloseTopModal();
}

async function v159Save(id) {
  if (!isAdmin) { toast('无权访问', 'error'); return; }
  var sel = document.getElementById('v159-new-teacher');
  if (!sel) { toast('找不到选择框', 'error'); return; }
  var newTeacher = sel.value;
  if (!newTeacher) { toast('请选择教师', 'warning'); return; }
  var s = v159FindSub(id);
  if (!s) { toast('记录不存在', 'error'); return; }
  if (newTeacher === s.substituteTeacher) {
    toast('代课教师未变化', 'warning');
    v159CloseTopModal();
    return;
  }
  try {
    var r = await fetch('/api/substitute-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
      body: JSON.stringify({ id: id, substituteTeacher: newTeacher })
    });
    var j = await r.json();
    if (j && j.success) {
      s.substituteTeacher = newTeacher;
      toast('✅ 已修改', 'success');
      v159CloseTopModal();
      // 重渲管理员代课记录弹窗
      try { showAdminSubstituteHistory(); } catch (e) { console.log('[v159] 刷新弹窗失败:', e); }
    } else {
      toast((j && j.error) || '保存失败', 'error');
    }
  } catch (e) {
    toast('保存失败: ' + (e && e.message ? e.message : e), 'error');
  }
}

// ══════════════════════════════════════════════════════
//  v160 教师隐私密码功能修复（纯追加 monkey-patch，不动 v159 及之前代码）
//
//  修复三个问题：
//    1. GET 查密码状态 → 旧接口 403（需 header 鉴权）→ 改用 /api/teacher-verify（query param）
//    2. POST 验证密码 → 旧接口 403"原密码错误"（共用设置接口）→ 改用 /api/teacher-verify（专用验证）
//    3. 登录流程无拦截 → selectTeacher 直接进系统 → monkey-patch selectTeacher 加密码验证
//
//  后端：/api/teacher-verify（新增文件 functions/api/teacher-verify.js）
//  KV：复用旧 key teacher_privacy_passwords（只读）
// ══════════════════════════════════════════════════════
(function v160Init() {
  if (window.__v160Installed) return;
  window.__v160Installed = true;
  console.log('[v160] 教师隐私密码修复已安装');

  // --- 1. 覆盖 getTeacherPrivacyPwdStatus：改用新 API ---
  var __v160OrigGetStatus = window.getTeacherPrivacyPwdStatus;
  window.getTeacherPrivacyPwdStatus = async function (teacherName) {
    try {
      var r = await fetch('/api/teacher-verify?teacher=' + encodeURIComponent(teacherName));
      var data = await r.json();
      if (data.success) {
        teacherPwdCache[teacherName] = data.hasPassword;
        return data.hasPassword;
      }
    } catch (e) {}
    // 兜底：如果新 API 挂了，尝试旧缓存
    return teacherPwdCache[teacherName] || false;
  };

  // --- 2. 覆盖 verifyTeacherPrivacyPwd：改用新 API ---
  var __v160OrigVerify = window.verifyTeacherPrivacyPwd;
  window.verifyTeacherPrivacyPwd = async function (teacherName, inputPwd) {
    try {
      var r = await fetch('/api/teacher-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherName: teacherName, password: inputPwd })
      });
      var data = await r.json();
      return data.success;
    } catch (e) {
      return false;
    }
  };

  // --- 3. 包装 selectTeacher：选名字后先检查隐私密码 ---
  var __v160OrigSelectTeacher = window.selectTeacher;
  window.selectTeacher = function (name) {
    // 先执行原逻辑：填值、关下拉
    var input = $('teacher-search-input');
    var hidden = $('login-teacher-select');
    var dropdown = $('teacher-search-dropdown');
    if (input) input.value = name;
    if (hidden) hidden.value = name;
    if (dropdown) dropdown.style.display = 'none';

    // 异步检查隐私密码
    v160CheckPrivacyBeforeLogin(name);
  };

  // 登录前隐私密码检查
  async function v160CheckPrivacyBeforeLogin(teacherName) {
    if (!teacherName) return;
    try {
      var hasPwd = await getTeacherPrivacyPwdStatus(teacherName);
      if (!hasPwd) {
        // 没设密码 → 直接登录
        handleTeacherLogin(teacherName);
        return;
      }
      // 设了密码 → 弹出密码输入框
      v160ShowLoginPwdModal(teacherName);
    } catch (e) {
      // 查询失败 → 允许登录（不因网络问题阻塞）
      console.log('[v160] 查询隐私密码状态失败，允许登录:', e);
      handleTeacherLogin(teacherName);
    }
  }

  // 登录时的密码输入弹窗
  function v160ShowLoginPwdModal(teacherName) {
    var modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
    modal.innerHTML =
      '<div style="background:#fff; border-radius:12px; max-width:360px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
        '<div style="padding:20px; border-bottom:1px solid #E5E7EB;">' +
          '<h3 style="margin:0; font-size:16px; font-weight:600;">🔒 隐私验证</h3>' +
          '<p style="margin:8px 0 0; color:#6B7280; font-size:13px;">教师 <b>' + esc(teacherName) + '</b> 已设置隐私密码，请输入密码后进入</p>' +
        '</div>' +
        '<div style="padding:20px;">' +
          '<input type="password" id="v160-login-pwd-input" class="form-input" placeholder="请输入隐私密码" autocomplete="off" ' +
          'style="width:100%; padding:12px; border:2px solid #E5E7EB; border-radius:8px; font-size:14px;" ' +
          'onkeydown="if(event.key===\'Enter\')document.getElementById(\'v160-login-confirm-btn\').click()">' +
          '<p style="margin:8px 0 0; color:#9CA3AF; font-size:12px;">忘记密码请联系管理员重置</p>' +
        '</div>' +
        '<div style="padding:12px 20px; border-top:1px solid #E5E7EB; display:flex; gap:8px; justify-content:flex-end;">' +
          '<button id="v160-login-cancel-btn" style="padding:8px 16px; background:#F3F4F6; color:#374151; border:none; border-radius:6px; cursor:pointer;">取消</button>' +
          '<button id="v160-login-confirm-btn" style="padding:8px 16px; background:#3B82F6; color:#fff; border:none; border-radius:6px; cursor:pointer;">确认</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    // 聚焦输入框
    setTimeout(function () { var inp = $('v160-login-pwd-input'); if (inp) inp.focus(); }, 100);

    // 取消按钮
    var cancelBtn = $('v160-login-cancel-btn');
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        modal.remove();
        // 清空搜索框，让用户重新选
        var searchInput = $('teacher-search-input');
        if (searchInput) searchInput.value = '';
        var hiddenField = $('login-teacher-select');
        if (hiddenField) hiddenField.value = '';
      };
    }

    // 确认按钮
    var confirmBtn = $('v160-login-confirm-btn');
    if (confirmBtn) {
      confirmBtn.onclick = async function () {
        var inputPwd = $('v160-login-pwd-input');
        if (!inputPwd || !inputPwd.value.trim()) {
          toast('请输入密码', 'warning');
          return;
        }
        var verified = await verifyTeacherPrivacyPwd(teacherName, inputPwd.value.trim());
        if (verified) {
          modal.remove();
          handleTeacherLogin(teacherName);
        } else {
          toast('密码错误', 'error');
          // 清空输入框，重新聚焦
          inputPwd.value = '';
          inputPwd.focus();
        }
      };
    }
  }
})();
// ══════════════════════════════════════════════════════
//  v161 教师登录后已通过隐私密码验证 → 我的请假/代课记录跳过二次弹窗
//  (纯追加 monkey-patch，不动 v160 及之前代码)
// ══════════════════════════════════════════════════════
(function v161Init() {
  if (window.__v161Installed) return;
  window.__v161Installed = true;
  console.log('[v161] 已登录教师跳过二次隐私弹窗');

  // 标记已通过隐私密码验证的教师集合
  window.__v161Authed = new Set();

  // wrap verifyTeacherPrivacyPwd：验证通过时记录教师名
  var __v161OrigVerify = window.verifyTeacherPrivacyPwd;
  window.verifyTeacherPrivacyPwd = async function (teacherName, inputPwd) {
    var ok = await __v161OrigVerify(teacherName, inputPwd);
    if (ok && teacherName) {
      window.__v161Authed.add(teacherName);
      console.log('[v161] 隐私验证通过:', teacherName);
    }
    return ok;
  };

  // wrap handleTeacherLogin：登录完成时立即标记当前教师为已验证
  // v160 在登录入口已经过密码才能调到这里，所以登录后到关闭浏览器期间都算"已验证"
  var __v161OrigLogin = window.handleTeacherLogin;
  window.handleTeacherLogin = function (teacherName) {
    if (teacherName) {
      window.__v161Authed.add(teacherName);
      console.log('[v161] 登录时标记已验证:', teacherName);
    }
    return __v161OrigLogin.apply(this, arguments);
  };

  // wrap showPrivacyVerifyModal：已验证教师直接放行，不弹框
  var __v161OrigModal = window.showPrivacyVerifyModal;
  window.showPrivacyVerifyModal = async function (teacherName, onSuccess, title) {
    if (teacherName && window.__v161Authed.has(teacherName)) {
      console.log('[v161] 跳过隐私弹窗:', teacherName, title || '');
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }
    return __v161OrigModal.apply(this, arguments);
  };

  console.log('[v161] 已安装');
})();
// ══════════════════════════════════════════════════════
//  v162 一键查询课表功能（纯追加，不动 v161 及之前代码）
//  位置：管理员端课表查询页，「按班级查看」与「按教师查看」之间
//  节次 1-6: 查总课表 timetable；7-9: 查课后服务表 afterSchoolService；
//  节次 10-11: 查总课表；详情弹窗多行多列展示有课/没课老师，按优先级排序
// ══════════════════════════════════════════════════════
(function v162Init() {
  if (window.__v162Installed) return;
  window.__v162Installed = true;

  // ── 1. 包装 renderTimetablePage，注入「一键查询」按钮 ──
  var __v162OrigRenderTT = window.renderTimetablePage;
  window.renderTimetablePage = function (area) {
    // 先调原函数（它会写入完整 page HTML）
    __v162OrigRenderTT.apply(this, arguments);
    // 插入按钮：在 tt-class-view 结束后、tt-my-view 开始前
    var insertionPt = document.getElementById('tt-my-view');
    if (!insertionPt) return;
    var btn = document.createElement('div');
    btn.style.cssText = 'text-align:center;padding:8px 0 4px;';
    btn.innerHTML = '<button class="btn btn-primary" onclick="v162ShowQuickQuery()" style="font-size:14px;padding:6px 20px;">🔍 一键查询</button>';
    insertionPt.parentNode.insertBefore(btn, insertionPt);
  };

  // ── 2. 主入口：显示星期×节次 网格弹窗 ──
  window.v162ShowQuickQuery = function () {
    var days = ['星期一', '星期二', '星期三', '星期四', '星期五'];
    var dayLabels = ['一', '二', '三', '四', '五'];
    var periods = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    var periodNames = ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节',
      '课后服务1', '课后服务2', '课后服务3', '晚自习', '午休'];

    // 构建网格表头
    var th = '<th style="min-width:70px;background:#f3f4f6;">节次\\星期</th>';
    days.forEach(function (d, i) {
      th += '<th style="background:#EEF2FF;color:#3730A3;font-size:13px;padding:6px 4px;">' + dayLabels[i] + '</th>';
    });

    // 构建网格主体（11行×5列）
    var rows = '';
    periods.forEach(function (p, pi) {
      rows += '<tr><td style="background:#f3f4f6;font-weight:600;font-size:13px;padding:4px 6px;">' + periodNames[pi] + '</td>';
      days.forEach(function (day) {
        var key = day + '_' + p;
        rows += '<td style="text-align:center;padding:4px;">' +
          '<button class="btn btn-sm" style="padding:4px 8px;font-size:12px;border-radius:6px;" ' +
          'onclick="v162ShowSlotDetail(\'' + day + '\',' + p + ')">查</button></td>';
      });
      rows += '</tr>';
    });

    var html =
      '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap;">' +
      '<thead><tr>' + th + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
      '<p style="text-align:center;color:#9CA3AF;font-size:12px;margin:8px 0 0;">点击任意格子查看该节次有课/没课教师</p>';

    // 弹窗：标题宽、max-width 大一些
    v162OpenModal('📅 一键查询课表', html, 'wide');
  };

  // ── 3. 点击格子 → 显示该节次详情 ──
  window.v162ShowSlotDetail = function (day, period) {
    var result = v162CalcSlot(day, period);
    var periodNames = ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节',
      '课后服务1', '课后服务2', '课后服务3', '晚自习', '午休'];

    // 详情弹窗也用 wide 样式
    v162OpenModal(periodNames[period - 1] + ' ' + day, result.html, 'wide');
  };

  // ── 4. 核心计算：查某天某节的所有有课/没课老师 ──
  //    节次 1-6/10-11: 遍历 timetable[day] 所有班级
  //    节次 7-9:       查 afterSchoolService.slots，支持单双周
  //    节次 7-9        若 timetable 里有课后服务记录也一并收入
  window.v162CalcSlot = function (day, period) {
    var td = (typeof scheduleData !== 'undefined' ? scheduleData : window.scheduleData) || {};
    var tt = td.timetable || {};
    var aft = td.afterSchoolService || {};
    var allTeachers = td.allTeachers || [];
    var isAft = (period >= 7 && period <= 11);

    var hasSet = {};  // 已安排的教师名 → { teacher, tier, note }
    var noteMap = {}; // 教师 → 备注（如"一1语文"/"单周"/"双周"）

    if (isAft) {
      // ── 课后服务节次（7/8/9）────────────────────────────────
      var slot = aft.slots
        ? aft.slots.find(function (s) { return s && s.day === day && s.period == period; })
        : null;
      if (slot && slot.assignments) {
        Object.entries(slot.assignments).forEach(function (entry) {
          var cls = entry[0];
          var info = entry[1];
          if (!info) return;
          // 单周+双周都有的轮换制
          if (info.singleWeek && info.doubleWeek) {
            [info.singleWeek, info.doubleWeek].forEach(function (t, idx) {
              var wk = idx === 0 ? '单周' : '双周';
              var teacher = Array.isArray(t) ? t.join(' / ') : t;
              if (teacher && teacher !== '-') {
                hasSet[teacher] = true;
                noteMap[teacher] = (noteMap[teacher] ? noteMap[teacher] + '；' : '') + cls + ' ' + wk;
              }
            });
          } else if (info.teacher) {
            // 固定教师
            hasSet[info.teacher] = true;
            noteMap[info.teacher] = (noteMap[info.teacher] ? noteMap[info.teacher] + '；' : '') + cls;
          } else if (info.singleWeek) {
            var t = Array.isArray(info.singleWeek) ? info.singleWeek.join(' / ') : info.singleWeek;
            if (t && t !== '-') {
              hasSet[t] = true;
              noteMap[t] = (noteMap[t] ? noteMap[t] + '；' : '') + cls + ' 单周';
            }
          } else if (info.doubleWeek) {
            var t2 = Array.isArray(info.doubleWeek) ? info.doubleWeek.join(' / ') : info.doubleWeek;
            if (t2 && t2 !== '-') {
              hasSet[t2] = true;
              noteMap[t2] = (noteMap[t2] ? noteMap[t2] + '；' : '') + cls + ' 双周';
            }
          }
        });
      }
      // timetable 里也可能记录了课后服务（补充兜底）
      var dayTt = tt[day] || {};
      Object.entries(dayTt).forEach(function (entry) {
        var cls = entry[0];
        var slots = entry[1];
        if (!Array.isArray(slots)) return;
        var found = slots.find(function (s) { return s && s.period == period; });
        if (found && (found.teacher || (found.teachers && found.teachers.length))) {
          var teachers = found.teachers || [found.teacher];
          teachers.forEach(function (t) {
            if (t && t !== '-') {
              hasSet[t] = true;
              noteMap[t] = (noteMap[t] ? noteMap[t] + '；' : '') + cls;
            }
          });
        }
      });
    } else {
      // ── 普通节次（1-6, 10, 11）────────────────────────────
      var dayTt2 = tt[day] || {};
      Object.entries(dayTt2).forEach(function (entry) {
        var cls = entry[0];
        var slots = entry[1];
        if (!Array.isArray(slots)) return;
        var found = slots.find(function (s) { return s && s.period == period; });
        if (found && (found.teacher || (found.teachers && found.teachers.length))) {
          var teachers = found.teachers || [found.teacher];
          teachers.forEach(function (t) {
            if (t && t !== '-') {
              hasSet[t] = true;
              noteMap[t] = (noteMap[t] ? noteMap[t] + '；' : '') + cls;
            }
          });
        }
      });
    }

    // 计算每个老师的 tier（优先级）
    var teacherList = allTeachers.map(function (t) {
      var tier = window.getTeacherTier ? window.getTeacherTier(t, '', day) : 5;
      return { name: t, tier: tier, note: noteMap[t] || '' };
    });

    // 有课老师（按 tier ASC 排）
    var hasTeachers = teacherList
      .filter(function (item) { return hasSet[item.name]; })
      .sort(function (a, b) { return a.tier - b.tier; });

    // 没课老师（按 tier ASC 排，跨班主科 tier=99 排最后）
    var freeTeachers = teacherList
      .filter(function (item) { return !hasSet[item.name]; })
      .sort(function (a, b) { return a.tier - b.tier; });

    // 多行多列展示（每行最多 5 个）
    var makeGrid = function (arr, cls) {
      if (!arr.length) return '<span style="color:#9CA3AF;">无</span>';
      var html = '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;">';
      arr.forEach(function (item) {
        var tag = cls === 'free' ? '○' : '●';
        var note = item.note ? ' <span style="color:#9CA3AF;font-size:11px;">' + item.note + '</span>' : '';
        var bg = cls === 'free' ? '#F3F4F6' : '#DCFCE7';
        var color = cls === 'free' ? '#6B7280' : '#16A34A';
        html += '<span style="display:inline-block;padding:2px 8px;border-radius:12px;background:' + bg + ';color:' + color + ';font-size:12px;margin:2px;">' +
          tag + ' ' + window.esc(item.name) + note + '</span>';
      });
      html += '</div>';
      return html;
    };

    var html =
      '<div style="font-size:13px;line-height:1.8;">' +
      '<p style="margin:0 0 8px 0;color:#6B7280;font-size:12px;">' + day + ' ' + periodNames2(period) + '，共 ' + hasTeachers.length + ' 位教师有课，' + freeTeachers.length + ' 位教师无课</p>' +
      '<div style="margin-bottom:12px;">' +
      '<div style="font-weight:600;color:#16A34A;margin-bottom:4px;">✅ 有课教师（' + hasTeachers.length + '）</div>' +
      makeGrid(hasTeachers, 'has') +
      '</div>' +
      '<div>' +
      '<div style="font-weight:600;color:#6B7280;margin-bottom:4px;">○ 没课教师（' + freeTeachers.length + '）</div>' +
      makeGrid(freeTeachers, 'free') +
      '</div>' +
      '</div>';

    return { html: html, hasTeachers: hasTeachers, freeTeachers: freeTeachers };
  };

  // 节次名称辅助
  function periodNames2(p) {
    var names = ['第1节', '第2节', '第3节', '第4节', '第5节', '第6节',
      '课后服务1', '课后服务2', '课后服务3', '晚自习', '午休'];
    return names[p - 1] || ('第' + p + '节');
  }

  // ── 5. 弹窗工具（内联，不依赖 showModal，避免 max-width:500px 限制）──
  window.v162OpenModal = function (title, content, mode) {
    var isWide = mode === 'wide';
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px;';
    var maxW = isWide ? '96vw' : '500px';
    var innerMaxW = isWide ? '96vw' : '480px';
    modal.innerHTML =
      '<div style="background:#fff;border-radius:12px;max-width:' + maxW + ';width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
      '<div style="padding:16px 20px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">' +
      '<h3 style="margin:0;font-size:15px;font-weight:600;">' + window.esc(title) + '</h3>' +
      '<button onclick="this.closest(\'.v162-modal\').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#9CA3AF;padding:0;line-height:1;">✕</button>' +
      '</div>' +
      '<div class="v162-modal-body" style="padding:16px 20px;overflow-y:auto;max-width:' + innerMaxW + ';width:100%;box-sizing:border-box;">' +
      content +
      '</div>' +
      '</div>';
    modal.className = 'v162-modal';
    document.body.appendChild(modal);

    // ESC 键关闭
    var escHandler = function (e) {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  };

  console.log('[v162] 一键查询已安装');
})();
// ══════════════════════════════════════════════════════
// v166: 一键查询按校历本周单双周过滤 (2026-09-16)
//   - 包装 v162ShowSlotDetail, 弹窗DOM落地后过滤非本周老师
//   - 校历来源: scheduleData.calendar.weeks[*].parity (single/double)
//   - 仅对 period 7-11 (课后服务/晚自习/午休) 生效
//   - 1-6 普通课没有单双周, 不动
//   - 兜底: 校历查不到今天 → 不过滤, 保持v165原样
// ══════════════════════════════════════════════════════
(function v166Init() {
  if (typeof window === 'undefined') return;
  if (window.__v166Installed) return;
  window.__v166Installed = true;

  // 查今天 parity: 'single' | 'double' | null
  function v166GetTodayParity() {
    try {
      var sd;
      try { sd = scheduleData; } catch (e) {}
      if (!sd) { try { sd = window.scheduleData; } catch (e) {} }
      if (!sd || !sd.calendar || !Array.isArray(sd.calendar.weeks)) return null;
      var d = new Date();
      var today = d.getFullYear() + '-' +
                  String(d.getMonth() + 1).padStart(2, '0') + '-' +
                  String(d.getDate()).padStart(2, '0');
      for (var i = 0; i < sd.calendar.weeks.length; i++) {
        var w = sd.calendar.weeks[i];
        if (!Array.isArray(w.days)) continue;
        for (var j = 0; j < w.days.length; j++) {
          if (w.days[j] && w.days[j].date === today) return w.parity;
        }
      }
    } catch (e) {}
    return null;
  }

  function v166ParityLabel(p) {
    return p === 'single' ? '单周' : (p === 'double' ? '双周' : null);
  }

  if (typeof window.v162ShowSlotDetail !== 'function') {
    console.warn('[v166] v162ShowSlotDetail 未找到, 跳过');
    return;
  }

  var __origShowSlotDetail = window.v162ShowSlotDetail;

  window.v162ShowSlotDetail = function v166ShowSlotDetail(day, period) {
    // 先调原函数弹窗
    var result = __origShowSlotDetail(day, period);

    // 仅课后服务/晚自习/午休 (period 7-11) 需要单双周过滤
    var isAft = (period >= 7 && period <= 11);
    if (!isAft) return result;

    var parity = v166GetTodayParity();
    var label = parity ? v166ParityLabel(parity) : null;
    if (!label) return result;

    // 等弹窗 DOM 落地 (v162ShowSlotDetail 同步 appendChild, 直接查即可)
    var modal = document.querySelector('.v162-modal:last-of-type');
    if (!modal) return result;
    var body = modal.querySelector('.v162-modal-body');
    if (!body) return result;

    // 顶部注入状态条 (让用户看到 v166 在跑)
    var oldStatus = body.querySelector('.v166-status');
    if (oldStatus) oldStatus.remove();
    var statusDiv = document.createElement('div');
    statusDiv.className = 'v166-status';
    statusDiv.style.cssText = 'background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:6px 10px;margin-bottom:8px;font-size:12px;color:#92400E;';
    statusDiv.textContent = 'v166 | 今天 ' + label + ', 按校历过滤中...';
    body.insertBefore(statusDiv, body.firstChild);

    // 找"有课教师"和"没课教师"两个 section
    // v162OpenModal 生成的结构: 两个 div, 各含一个 font-weight:600 的 header
    var hasSection = null, freeSection = null;
    var headerDivs = body.querySelectorAll('div[style*="font-weight:600"]');
    Array.from(headerDivs).forEach(function (header) {
      var h = header.textContent || '';
      if (h.indexOf('有课教师') >= 0) hasSection = header.parentElement;
      else if (h.indexOf('没课教师') >= 0) freeSection = header.parentElement;
    });
    if (!hasSection || !freeSection) return result;

    var hasContainer = hasSection.querySelector('div[style*="display:flex"]');
    var freeContainer = freeSection.querySelector('div[style*="display:flex"]');
    if (!hasContainer || !freeContainer) return result;

    // 遍历有课的 pill, 把非本周的移到没课
    var pills = hasContainer.querySelectorAll(':scope > span');
    var movedCount = 0;
    Array.from(pills).forEach(function (pill) {
      var txt = pill.textContent || '';
      // 通用周 (无单/双周标注) → 保留
      if (txt.indexOf('单周') < 0 && txt.indexOf('双周') < 0) return;
      // 含今天 parity 标注 → 保留 (可能同时含单周+双周, 如孙焕英单周五(4)+双周三(2))
      if (txt.indexOf(label) >= 0) return;
      // 只含相反标注 → 移到没课, 改色
      try {
        pill.innerHTML = pill.innerHTML.replace(/●/g, '○');
        pill.style.background = '#F3F4F6';
        pill.style.color = '#6B7280';
        freeContainer.appendChild(pill);
        movedCount++;
      } catch (e) {}
    });

    if (movedCount === 0) return result;

    // 更新顶部总数文字
    var totalP = body.querySelector('p');
    if (totalP) {
      var t2 = totalP.textContent || '';
      totalP.textContent = t2.replace(
        /共 (\d+) 位教师有课，(\d+) 位教师无课/,
        function (_, h, f) {
          return '共 ' + (parseInt(h, 10) - movedCount) +
                 ' 位教师有课，' + (parseInt(f, 10) + movedCount) + ' 位教师无课' +
                 '（已按校历' + label + '过滤 ' + movedCount + ' 位）';
        }
      );
    }

    // 更新两个 section 标题里的数字
    var hasHeader = hasSection.querySelector('div[style*="font-weight:600"]');
    if (hasHeader) {
      var hm = (hasHeader.textContent || '').match(/有课教师（(\d+)）/);
      if (hm) hasHeader.textContent = '✅ 有课教师（' + (parseInt(hm[1], 10) - movedCount) + '）';
    }
    var freeHeader = freeSection.querySelector('div[style*="font-weight:600"]');
    if (freeHeader) {
      var fm = (freeHeader.textContent || '').match(/没课教师（(\d+)）/);
      if (fm) freeHeader.textContent = '○ 没课教师（' + (parseInt(fm[1], 10) + movedCount) + '）';
    }

    return result;
  };

  console.log('[v166] 一键查询按校历单双周过滤已安装');
})();


// ============================================================================
// v167: 管理员端"代课安排"页按当前选中教师筛选 + 自动生成按筛选累加 (2026-09-18)
//   - 仅在管理员端生效;教师端 0 改动 (isAdmin 为 false 时所有后处理直接 return)
//   - 顶部"待安排教师"按钮区新增「全部」按钮 (data-v167="all")
//   - 选中某教师 → 下方"待安排代课的请假"表格只显示该教师
//   - 自动生成代课安排 → 仅生成当前筛选教师的请假 (append 到 preview, 不覆盖)
//   - 切到「全部」时 → 显示所有预览; 点自动生成 → v166 全量生成行为 (兜底)
//   - 确认方案 → v166 行为 (保存 preview 全部)
//   - v165 之前所有代码不动, 仅 monkey-patch 顶层函数引用
//   - 当前选中教师通过 DOM 查 .sub-tab-btn.active 取 textContent (避免依赖 let currentSubTeacher)
// ============================================================================

(function v167Init() {
  if (typeof window === 'undefined') return;
  if (window.__v167Installed) return;
  window.__v167Installed = true;

  // v167 累加状态 (闭包, 不污染 v165 变量)
  var __v167OldPreview = [];
  var __v167AccumKeys = {};

  function v167GetActiveTeacher() {
    try {
      var btns = document.querySelectorAll('.sub-tab-btn');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].classList.contains('active')) {
          var txt = (btns[i].textContent || '').trim();
          if (txt === '全部') return '__all__';
          return txt;
        }
      }
    } catch (e) {}
    return null;
  }

  function v167UpdateAllBtn() {
    try {
      var tabs = document.querySelector('.sub-teacher-tabs');
      if (!tabs) return;
      var existing = tabs.querySelector('[data-v167="all"]');
      if (!existing) {
        var btn = document.createElement('button');
        btn.className = 'sub-tab-btn';
        btn.setAttribute('data-v167', 'all');
        btn.setAttribute('onclick', 'v167SwitchAll()');
        btn.textContent = '全部';
        tabs.insertBefore(btn, tabs.firstChild);
      }
      var active = v167GetActiveTeacher();
      var allBtn = tabs.querySelector('[data-v167="all"]');
      if (allBtn) {
        if (active === '__all__') allBtn.classList.add('active');
        else allBtn.classList.remove('active');
      }
    } catch (e) {}
  }

  function v167FilterSubPage() {
    try {
      if (typeof isAdmin === 'undefined' || !isAdmin) return;
      var root = document.getElementById('main-content');
      if (!root) return;
      v167UpdateAllBtn();
      var active = v167GetActiveTeacher();
      if (!active || active === '__all__') return;

      var cards = root.querySelectorAll('.card');
      var targetCard = null;
      for (var i = 0; i < cards.length; i++) {
        var h3 = cards[i].querySelector('.card-header h3');
        if (h3 && h3.textContent.indexOf('待安排代课的请假') >= 0) {
          targetCard = cards[i];
          break;
        }
      }
      if (!targetCard) return;
      var h3 = targetCard.querySelector('.card-header h3');
      var tbody = targetCard.querySelector('tbody');
      if (!tbody) return;

      var rows = tbody.querySelectorAll('tr');
      var keepCount = 0;
      for (var j = 0; j < rows.length; j++) {
        var firstCell = rows[j].querySelector('td');
        var name = firstCell ? firstCell.textContent.trim() : '';
        if (name === active) {
          keepCount++;
        } else {
          rows[j].parentNode.removeChild(rows[j]);
        }
      }

      if (h3) h3.textContent = '⏳ 待安排代课的请假 (' + keepCount + ')';
      var badge = root.querySelector('.pending-badge');
      if (badge) badge.textContent = keepCount + ' 条请假待安排';
    } catch (e) {
      console.warn('[v167] filter error:', e);
    }
  }

  function v167HideTeacherTT() {
    try {
      if (typeof isAdmin === 'undefined' || !isAdmin) return;
      var active = v167GetActiveTeacher();
      if (active !== '__all__') return;
      var root = document.getElementById('main-content');
      if (!root) return;
      var blocks = root.querySelectorAll('.card');
      for (var i = 0; i < blocks.length; i++) {
        var h3 = blocks[i].querySelector('h3');
        if (h3 && h3.textContent.indexOf('老师的课表') >= 0) {
          blocks[i].style.display = 'none';
        }
      }
    } catch (e) {}
  }

  function v167InjectStatus(active) {
    try {
      var root = document.getElementById('main-content');
      if (!root) return;
      var old = root.querySelector('.v167-status');
      if (old) old.remove();
      var div = document.createElement('div');
      div.className = 'v167-status';
      div.style.cssText = 'background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:6px 10px;margin:8px 0;font-size:12px;color:#92400E;';
      div.textContent = 'v167 | 当前筛选: ' + (active === '__all__' ? '全部' : active) + ' (仅显示该教师待安排请假, 生成代课仅生成该教师)';
      root.insertBefore(div, root.firstChild);
    } catch (e) {}
  }

  function v167AfterRender() {
    try {
      if (typeof isAdmin === 'undefined' || !isAdmin) return;
      var active = v167GetActiveTeacher();
      v167UpdateAllBtn();
      if (active && active !== '__all__') {
        v167FilterSubPage();
      } else {
        v167HideTeacherTT();
      }
      v169HideLeaveCardIfV168();
      v168FilterPreviewTable();
      v169RenderTeacherTT();
      v167InjectStatus(active || '__all__');
    } catch (e) {
      console.warn('[v169] afterRender error:', e);
    }
  }

  window.v167SwitchAll = function v167SwitchAll() {
    try {
      if (typeof isAdmin === 'undefined' || !isAdmin) return;
      var tabs = document.querySelector('.sub-teacher-tabs');
      if (tabs) {
        var btns = tabs.querySelectorAll('.sub-tab-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
        var allBtn = tabs.querySelector('[data-v167="all"]');
        if (allBtn) allBtn.classList.add('active');
      }
      if (typeof renderSubPage === 'function') renderSubPage(document.getElementById('main-content'));
    } catch (e) {}
  };

  if (typeof switchSubTeacher === 'function') {
    var __origSwitchSubTeacher = switchSubTeacher;
    switchSubTeacher = function v167SwitchSubTeacher(teacherName) {
      var r = __origSwitchSubTeacher.apply(this, arguments);
      setTimeout(function() { v167AfterRender(); }, 0);
      return r;
    };
  }

  if (typeof renderSubPage === 'function') {
    var __origRenderSubPage = renderSubPage;
    renderSubPage = function v167RenderSubPage() {
      var r = __origRenderSubPage.apply(this, arguments);
      setTimeout(function() { v167AfterRender(); }, 0);
      return r;
    };
  }

  if (typeof doGenerateSubstitutes === 'function') {
    var __origDoGenerate = doGenerateSubstitutes;
    doGenerateSubstitutes = async function v167DoGenerate() {
      var active = v167GetActiveTeacher();
      var result = await __origDoGenerate.apply(this, arguments);
      try {
        if (typeof isAdmin !== 'undefined' && isAdmin) {
          var justGenerated = (typeof previewSubstitutes !== 'undefined' ? previewSubstitutes : []).slice();
          var filtered;
          if (active && active !== '__all__') {
            filtered = justGenerated.filter(function(s) { return (s.leaveTeacher || '').trim() === active; });
          } else {
            filtered = justGenerated;
          }
          var toAdd = [];
          for (var i = 0; i < filtered.length; i++) {
            var k = (filtered[i].leaveId || '') + '_' + (filtered[i].period || '') + '_' + (filtered[i].className || '');
            if (!__v167AccumKeys[k]) {
              __v167AccumKeys[k] = true;
              toAdd.push(filtered[i]);
            }
          }
          __v167OldPreview = __v167OldPreview.concat(toAdd);
          if (typeof previewSubstitutes !== 'undefined') {
            previewSubstitutes = __v167OldPreview.slice();
          }
          if (typeof renderSubPage === 'function') renderSubPage(document.getElementById('main-content'));
        }
      } catch (e) {
        console.warn('[v167] doGenerate error:', e);
      }
      return result;
    };
  }

  if (typeof cancelPreview === 'function') {
    var __origCancelPreview = cancelPreview;
    cancelPreview = function v167CancelPreview() {
      __v167OldPreview = [];
      __v167AccumKeys = {};
      return __origCancelPreview.apply(this, arguments);
    };
  }


  // ===== v168 修复: preview 模式下"待安排代课的请假"卡片缺失 + preview 表格按当前教师筛选 =====


  // ===== v169 修复: preview 模式下不显示"待安排请假"卡片, 显示"老师课表"区块 =====

  function v169HideLeaveCardIfV168() {
    try {
      var root = document.getElementById('main-content');
      if (!root) return;
      var v168Card = root.querySelector('.v168-leave-card');
      if (v168Card) v168Card.remove();
    } catch (e) {}
  }

  function v169RenderTeacherTT() {
    try {
      var root = document.getElementById('main-content');
      if (!root) return;
      // v165 已渲染课表区块? 跳过
      var cards = root.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {
        var h3 = cards[i].querySelector('.card-header h3');
        if (h3 && h3.textContent.indexOf('老师的课表') >= 0) return;
      }
      // 当前选中教师 (非 __all__)
      var active = v167GetActiveTeacher();
      if (!active || active === '__all__') return;
      // 调 renderTeacherSubTT 拿课表 HTML
      var ttHtml = '';
      if (typeof renderTeacherSubTT === 'function') {
        ttHtml = renderTeacherSubTT(active);
      } else if (window.renderTeacherSubTT) {
        ttHtml = window.renderTeacherSubTT(active);
      }
      if (!ttHtml) return;
      var escFn = (typeof esc === 'function') ? esc : window.esc || function(t) { return String(t == null ? '' : t); };
      var html =
        '<div class="card v169-teacher-tt" style="margin-top:16px;">' +
          '<div class="card-header">' +
            '<h3>📅 ' + escFn(active) + ' 老师的课表</h3>' +
            '<span class="preview-hint">v169 | 当前教师课表</span>' +
          '</div>' +
          '<div class="table-wrap">' + ttHtml + '</div>' +
        '</div>';
      root.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      console.warn('[v169] renderTeacherTT error:', e);
    }
  }

  function v168GetApprovedLeaves() {
    try {
      var lr = (typeof leaveRecords !== 'undefined' ? leaveRecords : window.leaveRecords) || [];
      var sr = (typeof substituteRecords !== 'undefined' ? substituteRecords : window.substituteRecords) || [];
      var arrangedLeaveIds = new Set(sr.map(function(x) { return x.leaveId; }).filter(Boolean));
      return lr.filter(function(l) {
        return l.status === 'approved' && l.needSubstitute !== false && !arrangedLeaveIds.has(l.id);
      });
    } catch (e) { return []; }
  }

  function v168RenderLeaveCard() {
    try {
      var root = document.getElementById('main-content');
      if (!root) return;
      var oldV168 = root.querySelector('.v168-leave-card');
      if (oldV168) oldV168.remove();
      // 如果 v165 已渲染"待安排代课的请假"卡片(preview 模式之外), 不重复注入
      var cards = root.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++) {
        var h3 = cards[i].querySelector('.card-header h3');
        if (h3 && h3.textContent.indexOf('待安排代课的请假') >= 0) return;
      }
      var active = v167GetActiveTeacher();
      var allLeaves = v168GetApprovedLeaves();
      var leaves;
      if (active && active !== '__all__') {
        leaves = allLeaves.filter(function(l) { return (l.teacherName || '').trim() === active; });
      } else {
        leaves = allLeaves;
      }
      if (leaves.length === 0) return;
      var escFn = (typeof esc === 'function') ? esc : window.esc || function(t) { return String(t == null ? '' : t); };
      var getClassFn = (typeof getClassForLeave === 'function') ? getClassForLeave : window.getClassForLeave || function() { return ''; };
      var fmtDateFn = (typeof fmtDate === 'function') ? fmtDate : window.fmtDate || function(t) { return t || ''; };
      var fmtWeekFn = (typeof formatWeekday === 'function') ? formatWeekday : window.formatWeekday || function() { return ''; };
      var rows = leaves.map(function(l) {
        return '<tr>' +
          '<td>' + escFn((l.teacherName || '').trim()) + '</td>' +
          '<td>' + escFn(getClassFn(l)) + '</td>' +
          '<td>' + escFn(fmtDateFn(l.leaveDate || '')) + '</td>' +
          '<td>' + escFn(fmtWeekFn(l)) + '</td>' +
          '<td>第' + escFn(l.period || '') + '节</td>' +
          '<td>' + escFn(l.reason || '-') + '</td>' +
          '</tr>';
      }).join('');
      var html =
        '<div class="card v168-leave-card" style="margin-top:16px;border:2px solid #10B981;">' +
          '<div class="card-header">' +
            '<h3>⏳ 待安排代课的请假 (' + leaves.length + ')</h3>' +
            '<span class="preview-hint" style="color:#10B981;font-weight:600;">v168 | 当前教师待安排</span>' +
          '</div>' +
          '<div class="table-wrap">' +
            '<table class="data-table">' +
              '<thead><tr><th>请假教师</th><th>班级</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th></tr></thead>' +
              '<tbody>' + rows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      root.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      console.warn('[v168] renderLeaveCard error:', e);
    }
  }

  function v168FilterPreviewTable() {
    try {
      var root = document.getElementById('main-content');
      if (!root) return;
      var rows = root.querySelectorAll('.preview-table tbody .preview-row');
      if (rows.length === 0) return;
      var active = v167GetActiveTeacher();
      for (var i = 0; i < rows.length; i++) {
        var firstCell = rows[i].querySelector('td');
        var name = firstCell ? (firstCell.textContent || '').trim() : '';
        if (!active || active === '__all__') rows[i].style.display = '';
        else if (name === active) rows[i].style.display = '';
        else rows[i].style.display = 'none';
      }
    } catch (e) {
      console.warn('[v168] filterPreviewTable error:', e);
    }
  }

  console.log('[v167] 管理员端代课安排按教师筛选 + 自动生成累加已安装');
})();

// ===== v170 保守修: timetable 查不到时 tier=5 而非 tier=99 =====
// 问题: 张洪斌在 teacherAssignment 里是五（1）道德与法治老师，
// 但 timetable 五（1）周一第5节没有他的记录 → 被误判为"跨班主科" tier=99 → 下拉名单消失
// 保守修: timetable 查不到该老师，默认 tier=5，不再调用 isMainSubjectTeacher

(function v170Init() {
  if (window.__v170Installed) return;
  window.__v170Installed = true;

  // 保存原始 getTeacherTier（闭包内不再调用，保留给其他路径用）
  // 重写 getTeacherTier: 把 "不在targetClass教课 → isMainSubjectTeacher → tier=99"
  // 改为 "不在targetClass教课 → tier=5"
  var __origGetTeacherTier = window.getTeacherTier;

  window.getTeacherTier = function getTeacherTier_patched(teacherName, targetClass, dow) {
    if (!teacherName || !targetClass || !dow) return 99;
    var dayData = scheduleData && scheduleData.timetable ? scheduleData.timetable[dow] : null;
    if (dayData) {
      var slots = dayData[targetClass];
      if (slots) {
        var mySlots = Array.isArray(slots) ? slots.filter(function(sl) {
          if (!sl) return false;
          var teachers = sl.teachers || (sl.teacher ? [sl.teacher] : []);
          return teachers.indexOf(teacherName) >= 0;
        }) : [];
        if (mySlots.length === 0) {
          // ===== 保守修: 查不到就给 tier=5，不做 isMainSubjectTeacher 判定 =====
          return 5;
        }
        for (var i = 0; i < mySlots.length; i++) {
          var subj = mySlots[i].subject;
          if (['语文','数学'].indexOf(subj) >= 0) return 1;
        }
        for (var i = 0; i < mySlots.length; i++) {
          var subj = mySlots[i].subject;
          if (subj === '英语') return 2;
        }
        for (var i = 0; i < mySlots.length; i++) {
          var subj = mySlots[i].subject;
          if (['科学','道德与法治','道德','科学课'].indexOf(subj) >= 0) return 3;
        }
        return 4;
      }
    }
    // timetable 无数据时用 teacherAssignment 兜底
    var ta = scheduleData && scheduleData.teacherAssignment ? scheduleData.teacherAssignment : {};
    var clsSubs = ta[targetClass] || {};
    var subjs = Object.entries(clsSubs);
    var myMain = null;
    for (var i = 0; i < subjs.length; i++) {
      if (subjs[i][1] === teacherName) { myMain = subjs[i]; break; }
    }
    if (myMain) {
      var sb = myMain[0];
      if (['语文','数学'].indexOf(sb) >= 0) return 1;
      if (sb === '英语') return 2;
      if (['科学','道德与法治','道德','科学课'].indexOf(sb) >= 0) return 3;
      return 4;
    }
    // 跨班: 用 isMainSubjectTeacher 确认是否为主科老师
    if (typeof isMainSubjectTeacher === 'function' && isMainSubjectTeacher(teacherName)) return 99;
    return 5;
  };

  console.log('[v170] tier保守修: getTeacherTier查不到时tier=5已安装');
})();

/* ===== v171 主系统管理（多租户阶段1：授权码生成 + 查看） ===== */
(function v171Init() {
  if (window.__v171Installed) return;
  window.__v171Installed = true;

  // 注入「主系统管理」菜单项（仅管理员可见）
  var __origRenderAppShell = window.renderAppShell;
  if (typeof __origRenderAppShell === 'function') {
    window.renderAppShell = function () {
      var html = __origRenderAppShell.apply(this, arguments);
      if (typeof isAdmin !== 'undefined' && isAdmin) {
        var inject = '<button class="nav-btn" data-page="master" onclick="v171OpenMasterAdmin()">🏫 主系统管理</button>';
        return html.replace(
          '<button class="nav-btn" data-page="settings" onclick="switchPage(\'settings\')">🔔 通知设置</button>',
          '<button class="nav-btn" data-page="settings" onclick="switchPage(\'settings\')">🔔 通知设置</button>' + inject
        );
      }
      return html;
    };
  }

  window.v171OpenMasterAdmin = function () {
    if (typeof isAdmin === 'undefined' || !isAdmin) { toast('仅管理员可访问', 'warning'); return; }
    var content = ''
      + '<div style="padding:8px;">'
      + '  <h3 style="margin:0 0 12px;">🏫 主系统管理（多租户控制台）</h3>'
      + '  <div style="border:1px solid #E5E7EB;border-radius:8px;padding:12px;margin-bottom:16px;">'
      + '    <div style="font-weight:600;margin-bottom:8px;">生成授权码</div>'
      + '    <div style="display:flex;gap:8px;align-items:center;">'
      + '      <input id="v171-code-count" type="number" min="1" max="20" value="1" style="width:70px;padding:6px;border:1px solid #D1D5DB;border-radius:6px;">'
      + '      <button class="btn btn-primary" onclick="v171GenCode()">生成</button>'
      + '    </div>'
      + '    <div id="v171-code-result" style="margin-top:8px;color:#059669;font-weight:600;min-height:20px;"></div>'
      + '  </div>'
      + '  <div style="border:1px solid #E5E7EB;border-radius:8px;padding:12px;">'
      + '    <div style="font-weight:600;margin-bottom:8px;">授权码列表</div>'
      + '    <div id="v171-codes-list">加载中...</div>'
      + '  </div>'
      + '  <div style="border:1px solid #E5E7EB;border-radius:8px;padding:12px;margin-top:16px;">'
      + '    <div style="font-weight:600;margin-bottom:8px;">学校列表</div>'
      + '    <div id="v171-schools-list">加载中...</div>'
      + '  </div>'
      + '</div>';
    showModal('主系统管理', content);
    setTimeout(function () {
      var ov = document.querySelector('.modal-overlay:last-of-type');
      if (ov) { var box = ov.querySelector('div[style*="max-width:500px"]'); if (box) box.style.maxWidth = '960px'; }
    }, 50);
    v171LoadCodes();
    v171LoadSchools();
  };

  window.v171GenCode = async function () {
    var el = document.getElementById('v171-code-count');
    var cnt = el ? (parseInt(el.value) || 1) : 1;
    var out = document.getElementById('v171-code-result');
    try {
      var res = await fetch('/api/master/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
        body: JSON.stringify({ count: cnt })
      });
      var j = await res.json();
      if (out) {
        if (j.success) {
          out.textContent = '已生成: ' + j.codes.map(function (c) { return c.code; }).join('  ');
          out.style.color = '#059669';
          v171LoadCodes();
        } else {
          out.textContent = '失败: ' + (j.message || '未知错误');
          out.style.color = '#DC2626';
        }
      }
    } catch (e) {
      if (out) { out.textContent = '网络错误'; out.style.color = '#DC2626'; }
    }
  };

  window.v171LoadCodes = async function () {
    var el = document.getElementById('v171-codes-list');
    if (!el) return;
    try {
      var res = await fetch('/api/master/codes', { headers: { 'x-admin-pwd': adminPwd } });
      var j = await res.json();
      if (!j.success) { el.textContent = '加载失败'; return; }
      if (!j.codes.length) { el.textContent = '暂无授权码'; return; }
      el.innerHTML = j.codes.map(function (c) {
        return '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #F3F4F6;">'
          + '<span style="font-family:monospace;font-weight:600;">' + esc(c.code) + '</span>'
          + '<span style="color:' + (c.used ? '#EF4444' : '#059669') + ';">' + (c.used ? '已用' : '未用') + '</span>'
          + '<span style="color:#9CA3AF;font-size:12px;">' + new Date(c.createdAt).toLocaleString('zh-CN') + '</span>'
          + '</div>';
      }).join('');
    } catch (e) { el.textContent = '加载失败'; }
  };

  window.v171LoadSchools = async function () {
    var el = document.getElementById('v171-schools-list');
    if (!el) return;
    try {
      var res = await fetch('/api/master/schools', { headers: { 'x-admin-pwd': adminPwd } });
      var j = await res.json();
      if (!j.success) { el.textContent = '加载失败'; return; }
      if (!j.schools.length) { el.textContent = '暂无学校（阶段1未开通子系统）'; return; }
      el.innerHTML = j.schools.map(function (s) {
        return '<div style="padding:4px 0;border-bottom:1px solid #F3F4F6;">'
          + '<b>' + esc(s.schoolName) + '</b> | ' + esc(s.phone || '') + ' | ' + (s.active ? '已激活' : '未激活')
          + ' | ' + (s.url || '—') + ' | 到期 ' + (s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('zh-CN') : '—')
          + '</div>';
      }).join('');
    } catch (e) { el.textContent = '加载失败'; }
  };
})();
/* ===== v172 主系统管理增强：缴费管理 + 续费 + 到期状态 ===== */
(function v172Init() {
  if (window.__v172Installed) return;
  window.__v172Installed = true;

  // ============ 价格计算 ============
  window.v172CalcPrice = function (classCount) {
    if (!classCount || classCount <= 0) return 300;
    if (classCount <= 20) return 300;
    return 300 + Math.ceil((classCount - 20) / 20) * 100;
  };

  window.v172FmtDate = function (d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  window.v172DaysLeft = function (expiresAt) {
    if (!expiresAt) return -999;
    var diff = new Date(expiresAt) - new Date();
    return Math.ceil(diff / 86400000);
  };

  window.v172ExpiryTag = function (expiresAt) {
    var days = window.v172DaysLeft(expiresAt);
    if (days < 0) return '<span style="background:#FEE2E2;color:#991B1B;padding:2px 6px;border-radius:4px;font-size:12px;">已到期</span>';
    if (days <= 30) return '<span style="background:#FEF3C7;color:#92400E;padding:2px 6px;border-radius:4px;font-size:12px;">' + days + '天后到期</span>';
    return '<span style="background:#D1FAE5;color:#065F46;padding:2px 6px;border-radius:4px;font-size:12px;">正常</span>';
  };

  // ============ 覆盖 v171LoadSchools（增强学校列表） ============
  var __origV171LoadSchools = window.v171LoadSchools;
  window.v171LoadSchools = async function () {
    var el = document.getElementById('v171-schools-list');
    if (!el) return;
    try {
      var res = await fetch('/api/master/schools', { headers: { 'x-admin-pwd': adminPwd } });
      var j = await res.json();
      if (!j.success) { el.textContent = '加载失败'; return; }
      if (!j.schools.length) {
        el.innerHTML = '<div style="color:#9CA3AF;text-align:center;padding:16px;">暂无学校</div>';
        return;
      }
      el.innerHTML = ''
        + '<div style="display:grid;grid-template-columns:2fr 1fr 80px 80px 80px 100px 100px 80px;gap:0;font-size:13px;font-weight:600;color:#6B7280;border-bottom:2px solid #E5E7EB;padding:4px 8px;margin-bottom:4px;">'
        + '  <div>学校名称</div>'
        + '  <div>管理员</div>'
        + '  <div>班级数</div>'
        + '  <div>年费(元)</div>'
        + '  <div>到期日</div>'
        + '  <div>状态</div>'
        + '  <div>联系</div>'
        + '  <div>操作</div>'
        + '</div>';
      j.schools.forEach(function (s) {
        var days = window.v172DaysLeft(s.expiresAt);
        var tag = window.v172ExpiryTag(s.expiresAt);
        var price = window.v172CalcPrice(s.classCount || 0);
        el.innerHTML += ''
          + '<div style="display:grid;grid-template-columns:2fr 1fr 80px 80px 80px 100px 100px 80px;gap:0;font-size:13px;padding:6px 8px;border-bottom:1px solid #F3F4F6;align-items:center;">'
          + '  <div style="font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(s.schoolName || '') + '">' + esc(s.schoolName || '—') + '</div>'
          + '  <div style="color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(s.adminName || '—') + '</div>'
          + '  <div style="color:#374151;text-align:center;">' + (s.classCount || '?') + '</div>'
          + '  <div style="color:#059669;font-weight:600;text-align:center;">' + price + '</div>'
          + '  <div style="color:#6B7280;font-size:12px;text-align:center;">' + window.v172FmtDate(s.expiresAt) + '</div>'
          + '  <div>' + tag + '</div>'
          + '  <div style="color:#6B7280;font-size:12px;text-align:center;" title="' + esc(s.phone || '') + '">' + esc(s.phone || '—') + '</div>'
          + '  <div style="text-align:center;">'
          + '    <button onclick="v172OpenRenew(\'' + esc(s.schoolId) + '\',\'' + esc(s.schoolName) + '\',' + price + ',' + days + ')" data-school-id="' + esc(s.schoolId) + '" data-school-name="' + esc(s.schoolName) + '" style="background:#1E40AF;color:#FFF;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px;">续费</button>'
          + '  </div>'
          + '</div>';
      });

      // 底部汇总
      var totalSchools = j.schools.length;
      var expiredCount = j.schools.filter(function (s) { return window.v172DaysLeft(s.expiresAt) < 0; }).length;
      var warnCount = j.schools.filter(function (s) { var d = window.v172DaysLeft(s.expiresAt); return d >= 0 && d <= 30; }).length;
      el.innerHTML += ''
        + '<div style="margin-top:12px;padding:8px;background:#F9FAFB;border-radius:6px;font-size:13px;color:#6B7280;display:flex;gap:20px;">'
        + '  <span>学校总数：<b style="color:#111827">' + totalSchools + '</b></span>'
        + '  <span style="color:#EF4444;">已到期：<b>' + expiredCount + '</b></span>'
        + '  <span style="color:#D97706;">即将到期：<b>' + warnCount + '</b></span>'
        + '  <button onclick="v172OpenPayments()" style="margin-left:auto;background:#F59E0B;color:#FFF;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;font-weight:600;">💰 缴费记录</button>'
        + '</div>';
    } catch (e) { el.textContent = '加载失败'; }
  };

  // ============ 缴费记录弹窗 ============
  window.v172OpenPayments = function () {
    var content = ''
      + '<div style="padding:8px;">'
      + '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
      + '    <h3 style="margin:0;font-size:16px;">💰 缴费记录</h3>'
      + '    <button onclick="v172ShowAddPayment()" style="background:#1E40AF;color:#FFF;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600;">+ 新增缴费</button>'
      + '  </div>'
      + '  <div id="v172-payments-list" style="max-height:400px;overflow-y:auto;">加载中...</div>'
      + '  <div id="v172-payments-summary" style="margin-top:12px;padding:8px;background:#EFF6FF;border-radius:6px;font-size:13px;"></div>'
      + '</div>';
    showModal('缴费记录', content);
    setTimeout(function () {
      var ov = document.querySelector('.modal-overlay:last-of-type');
      if (ov) { var box = ov.querySelector('div[style*="max-width:500px"]'); if (box) box.style.maxWidth = '720px'; }
    }, 50);
    v172LoadPayments();
  };

  window.v172LoadPayments = async function () {
    var el = document.getElementById('v172-payments-list');
    var sumEl = document.getElementById('v172-payments-summary');
    if (!el) return;
    try {
      var res = await fetch('/api/master/payments', { headers: { 'x-admin-pwd': adminPwd } });
      var j = await res.json();
      if (!j.success) { el.textContent = '加载失败: ' + (j.message || ''); return; }
      if (!j.payments.length) {
        el.innerHTML = '<div style="text-align:center;color:#9CA3AF;padding:32px;">暂无缴费记录</div>';
        if (sumEl) sumEl.textContent = '';
        return;
      }
      var total = j.payments.reduce(function (s, p) { return s + (parseInt(p.amount) || 0); }, 0);
      el.innerHTML = ''
        + '<div style="display:grid;grid-template-columns:2fr 1fr 80px 60px 80px 1fr;gap:0;font-size:12px;font-weight:600;color:#6B7280;border-bottom:2px solid #E5E7EB;padding:4px 8px;margin-bottom:4px;">'
        + '  <div>学校</div><div>日期</div><div>金额</div><div>时长</div><div>收款人</div><div>备注</div>'
        + '</div>';
      j.payments.slice().reverse().forEach(function (p) {
        el.innerHTML += ''
          + '<div style="display:grid;grid-template-columns:2fr 1fr 80px 60px 80px 1fr;gap:0;font-size:13px;padding:6px 8px;border-bottom:1px solid #F3F4F6;align-items:center;">'
          + '  <div style="font-weight:600;color:#111827;">' + esc(p.schoolName || '—') + '</div>'
          + '  <div style="color:#6B7280;font-size:12px;">' + window.v172FmtDate(p.paidAt) + '</div>'
          + '  <div style="color:#059669;font-weight:600;">' + (parseInt(p.amount) || 0) + '元</div>'
          + '  <div style="color:#374151;text-align:center;">' + (p.duration || 1) + '月</div>'
          + '  <div style="color:#6B7280;font-size:12px;">' + esc(p.remark || '—') + '</div>'
          + '</div>';
      });
      if (sumEl) sumEl.innerHTML = '累计收入：<b style="color:#059669;font-size:16px;">' + total + '</b> 元（共 ' + j.payments.length + ' 条记录）';
    } catch (e) { el.textContent = '网络错误'; }
  };

  window.v172ShowAddPayment = function () {
    // 先加载学校列表填下拉
    var schools = [];
    var schoolsEl = document.querySelectorAll('#v171-schools-list b');
    // 用 API 拿
    fetch('/api/master/schools', { headers: { 'x-admin-pwd': adminPwd } }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.success || !j.schools) return;
      var sel = document.getElementById('v172-pay-school');
      if (sel) sel.innerHTML = j.schools.map(function (s) {
        return '<option value="' + esc(s.schoolId) + '">' + esc(s.schoolName) + ' (' + (s.classCount || '?') + '班)</option>';
      }).join('');
    }).catch(function () {});
    var content = ''
      + '<div style="padding:8px;">'
      + '  <div style="font-weight:600;margin-bottom:12px;">新增缴费记录</div>'
      + '  <div class="form-group">'
      + '    <label>学校 *</label>'
      + '    <select id="v172-pay-school" style="width:100%;padding:8px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;"><option value="">请选择学校</option></select>'
      + '  </div>'
      + '  <div class="form-group">'
      + '    <label>缴费金额（元）*</label>'
      + '    <input id="v172-pay-amount" type="number" min="1" placeholder="如：300" style="width:100%;padding:8px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;">'
      + '  </div>'
      + '  <div class="form-group">'
      + '    <label>续费时长（月）*</label>'
      + '    <input id="v172-pay-duration" type="number" min="1" value="12" style="width:100%;padding:8px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;">'
      + '  </div>'
      + '  <div class="form-group">'
      + '    <label>备注</label>'
      + '    <input id="v172-pay-remark" type="text" placeholder="如：微信转账、2024年续费" style="width:100%;padding:8px;border:1.5px solid #D1D5DB;border-radius:8px;font-size:14px;">'
      + '  </div>'
      + '  <div id="v172-pay-msg" style="margin-bottom:8px;font-size:14px;min-height:20px;"></div>'
      + '  <button onclick="v172DoAddPayment()" style="width:100%;padding:10px;background:#1E40AF;color:#FFF;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">确认添加</button>'
      + '</div>';
    showModal('新增缴费', content);
  };

  window.v172DoAddPayment = async function () {
    var schoolId = document.getElementById('v172-pay-school') ? document.getElementById('v172-pay-school').value : '';
    var amount = document.getElementById('v172-pay-amount') ? document.getElementById('v172-pay-amount').value : '';
    var duration = document.getElementById('v172-pay-duration') ? document.getElementById('v172-pay-duration').value : '12';
    var remark = document.getElementById('v172-pay-remark') ? document.getElementById('v172-pay-remark').value : '';
    var msgEl = document.getElementById('v172-pay-msg');
    if (!schoolId || !amount) { if (msgEl) { msgEl.textContent = '请填写学校和金额'; msgEl.style.color = '#DC2626'; } return; }
    if (msgEl) { msgEl.textContent = '提交中...'; msgEl.style.color = '#6B7280'; }
    try {
      var res = await fetch('/api/master/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
        body: JSON.stringify({ schoolId: schoolId, amount: amount, duration: duration, remark: remark })
      });
      var j = await res.json();
      if (j.success) {
        if (msgEl) { msgEl.textContent = '✅ 添加成功，有效期已延长至 ' + window.v172FmtDate(j.newExpiresAt); msgEl.style.color = '#059669'; }
        setTimeout(function () { v172CloseCurrentModal(); v172LoadPayments(); v171LoadSchools(); }, 1200);
      } else {
        if (msgEl) { msgEl.textContent = '失败: ' + (j.message || '未知错误'); msgEl.style.color = '#DC2626'; }
      }
    } catch (e) { if (msgEl) { msgEl.textContent = '网络错误'; msgEl.style.color = '#DC2626'; } }
  };

  // ============ 续费弹窗 ============
  window.v172OpenRenew = function (schoolId, schoolName, price, daysLeft) {
    var content = ''
      + '<div style="padding:8px;">'
      + '  <div style="text-align:center;margin-bottom:16px;">'
      + '    <div style="font-size:40px;margin-bottom:8px;">🏫</div>'
      + '    <div style="font-size:16px;font-weight:700;color:#111827;">' + esc(schoolName) + '</div>'
      + '    <div style="font-size:13px;color:#6B7280;margin-top:4px;">年费：<b style="color:#059669;">' + price + '</b> 元/年</div>'
      + '    <div style="font-size:13px;color:' + (daysLeft < 0 ? '#EF4444' : '#6B7280') + ';margin-top:2px;">当前状态：' + (daysLeft < 0 ? '已到期' : '剩余 ' + daysLeft + ' 天') + '</div>'
      + '  </div>'
      + '  <div style="border:1px solid #E5E7EB;border-radius:8px;padding:12px;margin-bottom:12px;">'
      + '    <div style="font-weight:600;margin-bottom:8px;">选择续费时长</div>'
      + '    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">'
      + '      <button onclick="v172SetDur(this,6)" style="padding:6px 14px;border:1.5px solid #D1D5DB;border-radius:6px;background:#FFF;cursor:pointer;font-size:13px;">6个月</button>'
      + '      <button onclick="v172SetDur(this,12)" style="padding:6px 14px;border:1.5px solid #1E40AF;border-radius:6px;background:#1E40AF;color:#FFF;font-weight:600;cursor:pointer;font-size:13px;">1年</button>'
      + '      <button onclick="v172SetDur(this,24)" style="padding:6px 14px;border:1.5px solid #D1D5DB;border-radius:6px;background:#FFF;cursor:pointer;font-size:13px;">2年</button>'
      + '    </div>'
      + '    <div style="font-size:13px;color:#6B7280;">续费金额：<b id="v172-renew-amount" style="color:#059669;font-size:16px;">' + price + '</b> 元</div>'
      + '  </div>'
      + '  <input type="hidden" id="v172-renew-school" value="' + esc(schoolId) + '">'
      + '  <input type="hidden" id="v172-renew-duration" value="12">'
      + '  <div id="v172-renew-msg" style="margin-bottom:8px;font-size:14px;min-height:20px;"></div>'
      + '  <button onclick="v172DoRenew()" style="width:100%;padding:10px;background:#1E40AF;color:#FFF;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">确认续费</button>'
      + '</div>';
    showModal('续费 ' + schoolName, content);
  };

  window.v172SetDur = function (btn, months) {
    document.querySelectorAll('[onclick^="v172SetDur"]').forEach(function (b) {
      b.style.borderColor = '#D1D5DB'; b.style.background = '#FFF'; b.style.color = '#374151';
    });
    btn.style.borderColor = '#1E40AF'; btn.style.background = '#1E40AF'; btn.style.color = '#FFF';
    var schoolId = document.getElementById('v172-renew-school') ? document.getElementById('v172-renew-school').value : '';
    var price = 300;
    // 从按钮上的价格取
    var amtEl = document.getElementById('v172-renew-amount');
    var durEl = document.getElementById('v172-renew-duration');
    if (durEl) durEl.value = months;
    // 价格 = 年费 * (月数/12)
    if (amtEl) amtEl.textContent = Math.round(300 * (months / 12));
  };

  window.v172DoRenew = async function () {
    var schoolId = document.getElementById('v172-renew-school') ? document.getElementById('v172-renew-school').value : '';
    var duration = document.getElementById('v172-renew-duration') ? parseInt(document.getElementById('v172-renew-duration').value) || 12 : 12;
    var msgEl = document.getElementById('v172-renew-msg');
    if (!schoolId) return;
    if (msgEl) { msgEl.textContent = '提交中...'; msgEl.style.color = '#6B7280'; }
    try {
      var res = await fetch('/api/master/schools/' + schoolId + '/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-pwd': adminPwd },
        body: JSON.stringify({ duration: duration })
      });
      var j = await res.json();
      if (j.success) {
        if (msgEl) { msgEl.textContent = '✅ 续费成功，有效期已延长至 ' + window.v172FmtDate(j.newExpiresAt); msgEl.style.color = '#059669'; }
        setTimeout(function () { v172CloseCurrentModal(); v171LoadSchools(); }, 1200);
      } else {
        if (msgEl) { msgEl.textContent = '失败: ' + (j.message || '未知错误'); msgEl.style.color = '#DC2626'; }
      }
    } catch (e) { if (msgEl) { msgEl.textContent = '网络错误'; msgEl.style.color = '#DC2626'; } }
  };

  // 关闭当前最新弹窗
  window.v172CloseCurrentModal = function () {
    var ov = document.querySelector('.modal-overlay:last-of-type');
    if (ov) { var close = ov.querySelector('.modal-close'); if (close) close.click(); }
  };

})();
/* ===== v174 使用说明页（帮助中心｜纯追加：仅新增页面与入口，不改动任何现有逻辑） ===== */
(function v174Init() {
  if (window.__v174Installed) return;
  window.__v174Installed = true;

  // 1) 注入「使用说明」侧边栏入口（所有角色可见，放在功能菜单末尾）
  var __origRenderAppShell = window.renderAppShell;
  if (typeof __origRenderAppShell === 'function') {
    window.renderAppShell = function () {
      var html = __origRenderAppShell.apply(this, arguments);
      try {
        if (html && html.indexOf('</nav>') !== -1 && html.indexOf('data-page="guide"') === -1) {
          var btn = '<div class="sidebar-section-title" style="margin-top:16px">📖 帮助</div>'
            + '<button class="nav-btn" data-page="guide" onclick="switchPage(\'guide\')">📖 使用说明</button>';
          html = html.replace('</nav>', btn + '</nav>');
        }
      } catch (e) {}
      return html;
    };
  }

  // 2) 渲染「使用说明」页
  window.v174RenderGuide = function (area) {
    if (!area) return;
    var html = `
  <div class="page">
    <h2 class="page-title">📖 使用说明</h2>

    <div class="card" style="background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border:1px solid #C7D2FE;">
      <div style="display:flex;gap:14px;align-items:flex-start;">
        <div style="font-size:34px;line-height:1;">💡</div>
        <div>
          <div style="font-weight:700;font-size:16px;color:#3730A3;margin-bottom:6px;">三步搞定日常代课</div>
          <div style="color:#4338CA;font-size:14px;line-height:1.9;">
            教师在线请假 &nbsp;➜&nbsp; 校长手写签字审批 &nbsp;➜&nbsp; 管理员一键安排代课并自动通知代课老师
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>👥 角色与权限</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>角色</th><th>登录方式</th><th>可用功能</th></tr></thead>
          <tbody>
            <tr><td>👩‍🏫 教师</td><td>教师姓名（支持拼音首字母搜索）</td><td>请假登记 · 我的请假/代课 · 课表查询 · 共享文件夹</td></tr>
            <tr><td>✍️ 校长</td><td>校长审批密码</td><td>审批事假 / 病假请假条（手写签字）</td></tr>
            <tr><td>⚙️ 管理员</td><td>管理员密码</td><td>导入课表 · 代课安排 · 请假条管理 · 通知设置 · 主系统管理</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>🚀 功能详解</h3>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">📤 导入课表 <span style="font-size:12px;font-weight:600;color:#B45309;background:#FEF3C7;border-radius:4px;padding:1px 6px;margin-left:4px;">管理员 · 首次使用必做</span></div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>方式一 / 二：上传「总课表 Excel」「课后服务表 Excel」</li>
          <li>方式三：上传「校历表 Excel」，用于单 / 双周判断</li>
          <li>方式四 / 五：导入 JSON 文件，或手动粘贴 JSON 内容</li>
          <li>方式六：上传「社团活动安排表 Excel」</li>
          <li>可维护「后勤 / 无课教师名单」（每行一个姓名）</li>
          <li style="color:#B91C1C;">⚠️ 导入会覆盖当前课表数据，请谨慎操作</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">🏖️ 请假登记</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>「单日请假」选择具体节次；「连续多天」按全天填写日期区间</li>
          <li>假别共 8 种：事假 / 病假 / 婚假 / 丧假 / 公假 / 育儿假 / 产检假 / 其他</li>
          <li>事假、病假需经校长审批签字后，方可安排代课</li>
          <li>节次可多选：正课第 1–6 节、课后服务第 7–9 节、晚自习第 10 节、午休第 11 节，另有「全天」「无课」选项</li>
          <li>调休 / 补课日：选到周六、周日会弹出「补课日 + 单 / 双周」，例如「六补三(单)」</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">✍️ 校长审批</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>输入校长审批密码进入审批界面</li>
          <li>在「待审批请假条」中点「签字审批」，手写签名后确认</li>
          <li>「已处理」列表可查看或删除历史记录</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">✅ 代课安排 <span style="font-size:12px;font-weight:600;color:#1E40AF;background:#DBEAFE;border-radius:4px;padding:1px 6px;margin-left:4px;">管理员</span></div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>顶部列出「待安排教师」，点击标签可切换查看其课表对比</li>
          <li>点「⚡ 自动生成代课安排」进入预览模式</li>
          <li>核对方案无误后点「✅ 确认方案」保存并写入记录</li>
          <li>支持导出「本次安排 / 全部 / 按考勤表」Excel</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">📄 请假条管理</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>查看每条请假条详情</li>
          <li>点「🖨️ 打印预览」可直接打印或另存为 PDF</li>
          <li>可删除不再需要的记录</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">📅 课表查询</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>支持「按班级查看 / 按教师查看」两种方式切换</li>
          <li>教师端默认只能查看本人课表</li>
          <li>管理员可用「🔍 一键查询」查看某节次所有有课 / 没课的老师</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">📁 共享文件夹</div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>上传 / 下载学校共享文件（教案、课件、通知等）</li>
          <li>支持按分类筛选；管理员可点「⚙️ 管理分类」维护分类</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">🔔 通知设置 <span style="font-size:12px;font-weight:600;color:#1E40AF;background:#DBEAFE;border-radius:4px;padding:1px 6px;margin-left:4px;">管理员</span></div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>配置企业微信机器人 Webhook，代课安排自动推送通知</li>
          <li>维护「教师企业微信账号」映射（格式：姓名=账号，每行一条）</li>
          <li>可重置教师隐私密码</li>
        </ul>
      </div>

      <div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;">
        <div style="font-weight:700;color:#111827;font-size:15px;margin-bottom:8px;">🏫 主系统管理 <span style="font-size:12px;font-weight:600;color:#6D28D9;background:#F5F3FF;border-radius:4px;padding:1px 6px;margin-left:4px;">管理员</span></div>
        <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.9;">
          <li>生成「授权码」，用于开通新的学校子系统</li>
          <li>查看学校列表：班级数、年费、到期状态一目了然</li>
          <li>「💰 缴费记录」登记收费，一键「续费」延长到期时间</li>
        </ul>
      </div>
    </div>

    <div class="card">
      <h3>❓ 常见问题</h3>
      <div style="color:#374151;font-size:14px;line-height:2;">
        <div style="margin-bottom:10px;"><b style="color:#111827;">1. 请假后为什么找不到代课安排？</b><br>事假 / 病假需先由校长审批通过，才会进入「待安排」列表。</div>
        <div style="margin-bottom:10px;"><b style="color:#111827;">2. 教师端看不到别人的课表？</b><br>这是权限设计，教师只能查看本人课表；管理员可查看全部。</div>
        <div style="margin-bottom:10px;"><b style="color:#111827;">3. 数据安全吗？</b><br>所有数据实时存储在云端，请勿随意点击「清空课表」等危险操作。</div>
        <div style="margin-bottom:10px;"><b style="color:#111827;">4. 忘记密码怎么办？</b><br>管理员密码、校长密码可由管理员在对应入口重置。</div>
      </div>
    </div>

    <div style="text-align:center;color:#9CA3AF;font-size:12px;padding:8px 0 24px;">如有疑问请联系系统管理员</div>
  </div>
  `;
    area.innerHTML = html;
    // 手机端顶部标题修正
    try {
      var mt = document.querySelector('.mobile-header span[style*="flex:1"]');
      if (mt) mt.textContent = '使用说明';
    } catch (e) {}
  };

  // 3) 包装 switchPage，接管 guide 页（其余页面原样透传）
  var __origSwitchPage = window.switchPage;
  window.switchPage = function (page) {
    if (page === 'guide') {
      try { currentPage = 'guide'; } catch (e) {}
      document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
      var btn = document.querySelector('[data-page="guide"]');
      if (btn) btn.classList.add('active');
      window.v174RenderGuide(document.getElementById('main-content'));
      return;
    }
    return __origSwitchPage.apply(this, arguments);
  };

  console.log('[v174] 使用说明页已安装');
})();

// ===== v176: 代课记录弹窗按日期排序 + v159 用 data-sub-id 按 ID 查 (不依赖位置) =====
window.__v176Installed = true;
// ===== end v176 =====

// ===== v177: 教育主题淡色图案背景 (纯CSS多层渐变,无SVG) =====
window.__v177Installed = true;
(function v177Init() {
  var s = document.createElement("style");
  s.id = "v177-bg-style";
  s.textContent = "/* v177 教育主题背景 */\nbody {\n  background-color: #EEF2F7 !important;\n  background-image:\n    /* 第1层：淡蓝渐变底色 */\n    linear-gradient(160deg, rgba(219,234,254,0.7) 0%, rgba(238,242,247,0.9) 50%, rgba(226,232,240,0.85) 100%),\n    /* 第2层：圆点网格 — 教育/笔记本感 */\n    radial-gradient(circle, rgba(59,130,246,0.18) 1.5px, transparent 1.5px),\n    /* 第3层：细斜线条纹 — 书页/格子纸感 */\n    repeating-linear-gradient(\n      45deg,\n      transparent,\n      transparent 18px,\n      rgba(59,130,246,0.04) 18px,\n      rgba(59,130,246,0.04) 19px\n    ),\n    /* 第4层：大圆环装饰 — 书本翻页感 */\n    radial-gradient(circle at 20% 30%, rgba(59,130,246,0.07) 0%, transparent 8%),\n    radial-gradient(circle at 75% 70%, rgba(245,158,11,0.06) 0%, transparent 6%),\n    radial-gradient(circle at 50% 50%, rgba(139,92,246,0.05) 0%, transparent 10%),\n    radial-gradient(circle at 85% 20%, rgba(16,185,129,0.05) 0%, transparent 5%),\n    radial-gradient(circle at 10% 80%, rgba(239,68,68,0.04) 0%, transparent 7%) !important;\n  background-attachment: fixed !important;\n  background-size: auto, 24px 24px, auto, auto, auto, auto, auto, auto !important;\n  background-position: 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0 !important;\n  background-repeat: no-repeat, repeat, repeat, no-repeat, no-repeat, no-repeat, no-repeat, no-repeat !important;\n}\n/* 登录页保持原渐变 */\n.login-bg {\n  background: linear-gradient(135deg, #1E3A5F 0%, #2563EB 50%, #0EA5E9 100%) !important;\n  background-image: none !important;\n}\n/* 内容区白底半透明，保证文字可读 */\n.content {\n  background: rgba(249, 250, 251, 0.88) !important;\n  background-image: none !important;\n}\n/* 侧边栏白底半透明 */\n.sidebar {\n  background: rgba(255, 255, 255, 0.93) !important;\n}\n/* v177 角标 */\nbody::after {\n  content: \"v177\";\n  position: fixed;\n  bottom: 4px;\n  right: 6px;\n  font-size: 10px;\n  color: rgba(59, 130, 246, 0.3);\n  z-index: 99999;\n  pointer-events: none;\n  font-family: monospace;\n}";
  document.head.appendChild(s);
  console.log("[v177] 教育主题背景已安装 (纯CSS v2)");
})();
// ===== end v177 =====

// ===== v178: 修复 v177 (登录页渐变恢复 + 内容区透明) =====
window.__v178Installed = true;
(function v178Init() {
  // 检查 v177 style 是否存在，存在则在其后追加修正规则；不存在则新建
  var old = document.getElementById("v177-bg-style");
  if (old) {
    // 在 v177 CSS 后面追加 v178 修正规则
    old.textContent = old.textContent +
      "\n/* v178 修正覆盖 */\n" +
      ".login-bg { background: linear-gradient(135deg, #1E3A5F 0%, #2563EB 50%, #0EA5E9 100%) !important; }\n" +
      ".content { background: transparent !important; }\n" +
      "body::after { content: \"v178\" !important; }\n";
    console.log("[v178] 已在 v177 style 上追加修正规则");
  } else {
    var s = document.createElement("style");
    s.id = "v177-bg-style";
    s.textContent = "/* v178 修复：保留登录页渐变 + 内容区透明让背景透出 */\nbody { background-attachment: fixed !important; }\n.login-bg {\n  background: linear-gradient(135deg, #1E3A5F 0%, #2563EB 50%, #0EA5E9 100%) !important;\n}\n.content {\n  background: transparent !important;\n}\n.sidebar {\n  background: rgba(255, 255, 255, 0.93) !important;\n}\n.topbar {\n  background: rgba(255, 255, 255, 0.05) !important;\n}\nbody::after { content: \"v178\"; }";
    document.head.appendChild(s);
    console.log("[v178] v177 style 不存在，新建立");
  }
})();
// ===== end v178 =====

// ===== v179: 登录页 + 主页面背景加可见教育主题图案 (base64 SVG) =====
window.__v179Installed = true;
(function v179Init() {
  // 删除 v177/v178 旧 style（避免叠加）
  var old = document.getElementById("v177-bg-style");
  if (old) old.parentNode.removeChild(old);
  // 新建 v179 style
  var s = document.createElement("style");
  s.id = "v179-bg-style";
  s.textContent = "/* v179 强化图案：主页面 body 叠加 SVG 图案 + 登录页叠加白色 SVG 图案 */\nbody {\n  background-color: #EEF2F7 !important;\n  background-image:\n    /* 顶层：SVG 教育图标（蓝紫色调） */\n    url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iODAwIiB2aWV3Qm94PSIwIDAgODAwIDgwMCI+CiAgPGcgb3BhY2l0eT0iMC4xOCI+CiAgICA8IS0tIOS5puacrO+8iOW3puS4iu+8iSAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDYwLDgwKSI+CiAgICAgIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MCIgaGVpZ2h0PSI1MCIgcng9IjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzNCODJGNiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxsaW5lIHgxPSIzNSIgeTE9IjAiIHgyPSIzNSIgeTI9IjUwIiBzdHJva2U9IiMzQjgyRjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICAgIDxsaW5lIHgxPSIxMCIgeTE9IjE0IiB4Mj0iMjgiIHkyPSIxNCIgc3Ryb2tlPSIjM0I4MkY2IiBzdHJva2Utd2lkdGg9IjEuNSIvPgogICAgICA8bGluZSB4MT0iMTAiIHkxPSIyNCIgeDI9IjI4IiB5Mj0iMjQiIHN0cm9rZT0iIzNCODJGNiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgICAgPGxpbmUgeDE9IjEwIiB5MT0iMzQiIHgyPSIyOCIgeTI9IjM0IiBzdHJva2U9IiMzQjgyRjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICAgIDxsaW5lIHgxPSI0MiIgeTE9IjE0IiB4Mj0iNjAiIHkyPSIxNCIgc3Ryb2tlPSIjM0I4MkY2IiBzdHJva2Utd2lkdGg9IjEuNSIvPgogICAgICA8bGluZSB4MT0iNDIiIHkxPSIyNCIgeDI9IjYwIiB5Mj0iMjQiIHN0cm9rZT0iIzNCODJGNiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICAgICAgPGxpbmUgeDE9IjQyIiB5MT0iMzQiIHgyPSI2MCIgeTI9IjM0IiBzdHJva2U9IiMzQjgyRjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICA8L2c+CiAgICA8IS0tIOmTheeslO+8iOS4reS4iu+8jOaWnOaUvu+8iSAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDM4MCw5MCkgcm90YXRlKDM1KSI+CiAgICAgIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMTQiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0Y1OUUwQiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxwb2x5Z29uIHBvaW50cz0iMTAwLDAgMTE2LDcgMTAwLDE0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGNTlFMEIiIHN0cm9rZS13aWR0aD0iMiIvPgogICAgICA8cG9seWdvbiBwb2ludHM9IjEwOCwzIDExNiw3IDEwOCwxMSIgZmlsbD0iI0Y1OUUwQiIvPgogICAgICA8bGluZSB4MT0iMCIgeTE9IjE0IiB4Mj0iMTAwIiB5Mj0iMTQiIHN0cm9rZT0iI0Y1OUUwQiIgc3Ryb2tlLXdpZHRoPSIwLjgiLz4KICAgIDwvZz4KICAgIDwhLS0g54Gv5rOh77yI5Y+z5LiK77yJIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNjQwLDYwKSI+CiAgICAgIDxjaXJjbGUgY3g9IjMwIiBjeT0iMjgiIHI9IjIyIiBmaWxsPSJub25lIiBzdHJva2U9IiNGNTlFMEIiIHN0cm9rZS13aWR0aD0iMiIvPgogICAgICA8cmVjdCB4PSIyMiIgeT0iNTAiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRjU5RTBCIiBzdHJva2Utd2lkdGg9IjIiLz4KICAgICAgPGxpbmUgeDE9IjIyIiB5MT0iNjAiIHgyPSIzOCIgeTI9IjYwIiBzdHJva2U9IiNGNTlFMEIiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICAgIDxsaW5lIHgxPSIzMCIgeTE9IjYiIHgyPSIzMCIgeTI9IjAiIHN0cm9rZT0iI0Y1OUUwQiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxsaW5lIHgxPSI2IiB5MT0iMTgiIHgyPSIwIiB5Mj0iMTQiIHN0cm9rZT0iI0Y1OUUwQiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxsaW5lIHgxPSI1NCIgeTE9IjE4IiB4Mj0iNjAiIHkyPSIxNCIgc3Ryb2tlPSIjRjU5RTBCIiBzdHJva2Utd2lkdGg9IjIiLz4KICAgICAgPGxpbmUgeDE9IjgiIHkxPSIzNCIgeDI9IjIiIHkyPSIzNiIgc3Ryb2tlPSIjRjU5RTBCIiBzdHJva2Utd2lkdGg9IjIiLz4KICAgICAgPGxpbmUgeDE9IjUyIiB5MT0iMzQiIHgyPSI1OCIgeTI9IjM2IiBzdHJva2U9IiNGNTlFMEIiIHN0cm9rZS13aWR0aD0iMiIvPgogICAgPC9nPgogICAgPCEtLSBFPW1jwrLvvIjlt6bkuK3vvIkgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNzAsMjkwKSI+CiAgICAgIDx0ZXh0IHg9IjAiIHk9IjI0IiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMjgiIGZpbGw9IiM4QjVDRjYiIGZvbnQtc3R5bGU9Iml0YWxpYyIgZm9udC13ZWlnaHQ9ImJvbGQiPkU9bWM8L3RleHQ+CiAgICAgIDx0ZXh0IHg9IjYyIiB5PSIxNCIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjE4IiBmaWxsPSIjOEI1Q0Y2IiBmb250LXdlaWdodD0iYm9sZCI+MjwvdGV4dD4KICAgIDwvZz4KICAgIDwhLS0g5YiG5pWwIGEvYu+8iOS4reS4re+8iSAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQ1MCwzMTApIj4KICAgICAgPHRleHQgeD0iMCIgeT0iMTAiIGZvbnQtZmFtaWx5PSJHZW9yZ2lhLCBzZXJpZiIgZm9udC1zaXplPSIyMCIgZmlsbD0iIzEwQjk4MSIgZm9udC1zdHlsZT0iaXRhbGljIiBmb250LXdlaWdodD0iYm9sZCI+YTwvdGV4dD4KICAgICAgPGxpbmUgeDE9IjAiIHkxPSIxNiIgeDI9IjIyIiB5Mj0iMTYiIHN0cm9rZT0iIzEwQjk4MSIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDx0ZXh0IHg9IjIiIHk9IjM0IiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMjAiIGZpbGw9IiMxMEI5ODEiIGZvbnQtc3R5bGU9Iml0YWxpYyIgZm9udC13ZWlnaHQ9ImJvbGQiPmI8L3RleHQ+CiAgICA8L2c+CiAgICA8IS0tIOWLvuWPtyDinJPvvIjlj7PkuK3vvIkgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2NjAsMzAwKSI+CiAgICAgIDxjaXJjbGUgY3g9IjI0IiBjeT0iMjQiIHI9IjIyIiBmaWxsPSJub25lIiBzdHJva2U9IiMxMEI5ODEiIHN0cm9rZS13aWR0aD0iMi41Ii8+CiAgICAgIDxwb2x5bGluZSBwb2ludHM9IjE0LDI0IDIxLDMyIDM0LDE4IiBmaWxsPSJub25lIiBzdHJva2U9IiMxMEI5ODEiIHN0cm9rZS13aWR0aD0iMy41Ii8+CiAgICA8L2c+CiAgICA8IS0tIM+AcsKy77yI5bem5LiL77yJIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNzAsNTQwKSI+CiAgICAgIDx0ZXh0IHg9IjAiIHk9IjI2IiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiNFRjQ0NDQiIGZvbnQtc3R5bGU9Iml0YWxpYyIgZm9udC13ZWlnaHQ9ImJvbGQiPs+AcjwvdGV4dD4KICAgICAgPHRleHQgeD0iMzgiIHk9IjE4IiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IiNFRjQ0NDQiIGZvbnQtd2VpZ2h0PSJib2xkIj4yPC90ZXh0PgogICAgPC9nPgogICAgPCEtLSDmr5XkuJrluL3vvIjkuK3kuIvvvIkgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgzMTAsNTQwKSI+CiAgICAgIDxwb2x5Z29uIHBvaW50cz0iMCwxMCAyNSwwIDUwLDEwIDI1LDIwIiBmaWxsPSJub25lIiBzdHJva2U9IiMxRDRFRDgiIHN0cm9rZS13aWR0aD0iMiIvPgogICAgICA8cmVjdCB4PSIxOCIgeT0iMTgiIHdpZHRoPSIxNCIgaGVpZ2h0PSIxMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMUQ0RUQ4IiBzdHJva2Utd2lkdGg9IjIiLz4KICAgICAgPGxpbmUgeDE9IjUwIiB5MT0iMTAiIHgyPSI1NiIgeTI9IjIyIiBzdHJva2U9IiMxRDRFRDgiIHN0cm9rZS13aWR0aD0iMiIvPgogICAgICA8Y2lyY2xlIGN4PSI1NiIgY3k9IjI0IiByPSIyLjUiIGZpbGw9IiMxRDRFRDgiLz4KICAgIDwvZz4KICAgIDwhLS0g5ZyG6KeEICsg5ZyG77yI5Lit5Y+z77yJIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNTMwLDU2MCkiPgogICAgICA8Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOEI1Q0Y2IiBzdHJva2Utd2lkdGg9IjIiLz4KICAgICAgPGxpbmUgeDE9IjMwIiB5MT0iMzAiIHgyPSIxNCIgeTI9IjYiIHN0cm9rZT0iIzhCNUNGNiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxjaXJjbGUgY3g9IjE0IiBjeT0iNiIgcj0iMiIgZmlsbD0iIzhCNUNGNiIvPgogICAgPC9nPgogICAgPCEtLSBhYmMg5a2X5q+N77yI5Y+z5LiL77yJIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNjgwLDU2MCkiPgogICAgICA8dGV4dCB4PSIwIiB5PSIyOCIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjI4IiBmaWxsPSIjRjU5RTBCIiBmb250LXN0eWxlPSJpdGFsaWMiIGZvbnQtd2VpZ2h0PSJib2xkIj5BQkM8L3RleHQ+CiAgICA8L2c+CiAgICA8IS0tIOS5puacrCAy77yI57+75byA77yM5Lit5LiL5YGP5bem77yJIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjAwLDY4MCkiPgogICAgICA8cGF0aCBkPSJNMCw2IFEyMiwyIDQ0LDYgTDQ0LDQwIFEyMiwzNiAwLDQwIFoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzNCODJGNiIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgICAgIDxsaW5lIHgxPSIyMiIgeTE9IjQiIHgyPSIyMiIgeTI9IjM4IiBzdHJva2U9IiMzQjgyRjYiIHN0cm9rZS13aWR0aD0iMS41Ii8+CiAgICA8L2c+CiAgPC9nPgo8L3N2Zz4=\"),\n    /* 中层：淡蓝渐变 */\n    linear-gradient(160deg, rgba(219,234,254,0.4) 0%, rgba(238,242,247,0.5) 50%, rgba(226,232,240,0.5) 100%) !important;\n  background-attachment: fixed !important;\n  background-size: 800px 800px, auto !important;\n  background-repeat: repeat, no-repeat !important;\n  background-position: 0 0, 0 0 !important;\n}\n/* 登录页：深蓝渐变 + 白色 SVG 图案 */\n.login-bg {\n  background-color: #1E3A5F !important;\n  background-image:\n    url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNjAwIiB2aWV3Qm94PSIwIDAgNjAwIDYwMCI+CiAgPGcgb3BhY2l0eT0iMC4xMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjIuNSI+CiAgICA8IS0tIOS5puacrCAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDUwLDYwKSI+CiAgICAgIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI4MCIgaGVpZ2h0PSI1OCIgcng9IjQiLz4KICAgICAgPGxpbmUgeDE9IjQwIiB5MT0iMCIgeDI9IjQwIiB5Mj0iNTgiLz4KICAgICAgPGxpbmUgeDE9IjEyIiB5MT0iMTgiIHgyPSIzMiIgeTI9IjE4Ii8+CiAgICAgIDxsaW5lIHgxPSIxMiIgeTE9IjMwIiB4Mj0iMzIiIHkyPSIzMCIvPgogICAgICA8bGluZSB4MT0iMTIiIHkxPSI0MiIgeDI9IjMyIiB5Mj0iNDIiLz4KICAgICAgPGxpbmUgeDE9IjQ4IiB5MT0iMTgiIHgyPSI2OCIgeTI9IjE4Ii8+CiAgICAgIDxsaW5lIHgxPSI0OCIgeTE9IjMwIiB4Mj0iNjgiIHkyPSIzMCIvPgogICAgICA8bGluZSB4MT0iNDgiIHkxPSI0MiIgeDI9IjY4IiB5Mj0iNDIiLz4KICAgIDwvZz4KICAgIDwhLS0g6ZOF56yUIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMzMwLDgwKSByb3RhdGUoNDApIj4KICAgICAgPHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjExMCIgaGVpZ2h0PSIxNiIvPgogICAgICA8cG9seWdvbiBwb2ludHM9IjExMCwwIDEyOCw4IDExMCwxNiIvPgogICAgICA8bGluZSB4MT0iMCIgeTE9IjE2IiB4Mj0iMTEwIiB5Mj0iMTYiLz4KICAgIDwvZz4KICAgIDwhLS0gRT1tY8KyIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTQwLDI0MCkiPgogICAgICA8dGV4dCB4PSIwIiB5PSIyOCIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjMyIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiIGZvbnQtc3R5bGU9Iml0YWxpYyIgZm9udC13ZWlnaHQ9ImJvbGQiPkU9bWM8L3RleHQ+CiAgICAgIDx0ZXh0IHg9Ijc0IiB5PSIxNiIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjIwIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiIGZvbnQtd2VpZ2h0PSJib2xkIj4yPC90ZXh0PgogICAgPC9nPgogICAgPCEtLSBhYmMgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgzODAsMjUwKSI+CiAgICAgIDx0ZXh0IHg9IjAiIHk9IjMwIiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMzIiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0ibm9uZSIgZm9udC1zdHlsZT0iaXRhbGljIiBmb250LXdlaWdodD0iYm9sZCI+QUJDPC90ZXh0PgogICAgPC9nPgogICAgPCEtLSDPgCAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDgwLDQyMCkiPgogICAgICA8dGV4dCB4PSIwIiB5PSIzNiIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjQwIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiIGZvbnQtc3R5bGU9Iml0YWxpYyIgZm9udC13ZWlnaHQ9ImJvbGQiPs+APC90ZXh0PgogICAgPC9nPgogICAgPCEtLSDli77lj7cgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgyMjAsNDIwKSI+CiAgICAgIDxjaXJjbGUgY3g9IjI4IiBjeT0iMjgiIHI9IjI2Ii8+CiAgICAgIDxwb2x5bGluZSBwb2ludHM9IjE2LDI4IDI0LDM4IDQyLDIwIi8+CiAgICA8L2c+CiAgICA8IS0tIOavleS4muW4vSAtLT4KICAgIDxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDM4MCw0MjApIj4KICAgICAgPHBvbHlnb24gcG9pbnRzPSIwLDEyIDMwLDAgNjAsMTIgMzAsMjQiLz4KICAgICAgPHJlY3QgeD0iMjIiIHk9IjIyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiLz4KICAgICAgPGxpbmUgeDE9IjYwIiB5MT0iMTIiIHgyPSI2OCIgeTI9IjI2Ii8+CiAgICAgIDxjaXJjbGUgY3g9IjY4IiBjeT0iMjgiIHI9IjMiLz4KICAgIDwvZz4KICAgIDwhLS0g54Gv5rOhIC0tPgogICAgPGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoNDkwLDQyMCkiPgogICAgICA8Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyNCIvPgogICAgICA8cmVjdCB4PSIyMiIgeT0iNTQiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxMCIvPgogICAgPC9nPgogICAgPCEtLSDliIbmlbAgLS0+CiAgICA8ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxNDAsNTQwKSI+CiAgICAgIDx0ZXh0IHg9IjAiIHk9IjE0IiBmb250LWZhbWlseT0iR2VvcmdpYSwgc2VyaWYiIGZvbnQtc2l6ZT0iMjIiIGZpbGw9IiNGRkZGRkYiIHN0cm9rZT0ibm9uZSIgZm9udC1zdHlsZT0iaXRhbGljIiBmb250LXdlaWdodD0iYm9sZCI+YTwvdGV4dD4KICAgICAgPGxpbmUgeDE9IjAiIHkxPSIyMiIgeDI9IjI2IiB5Mj0iMjIiLz4KICAgICAgPHRleHQgeD0iMiIgeT0iNDIiIGZvbnQtZmFtaWx5PSJHZW9yZ2lhLCBzZXJpZiIgZm9udC1zaXplPSIyMiIgZmlsbD0iI0ZGRkZGRiIgc3Ryb2tlPSJub25lIiBmb250LXN0eWxlPSJpdGFsaWMiIGZvbnQtd2VpZ2h0PSJib2xkIj5iPC90ZXh0PgogICAgPC9nPgogIDwvZz4KPC9zdmc+\"),\n    linear-gradient(135deg, #1E3A5F 0%, #2563EB 50%, #0EA5E9 100%) !important;\n  background-attachment: fixed !important;\n  background-size: 600px 600px, auto !important;\n  background-repeat: repeat, no-repeat !important;\n}\n/* 内容区透明，让 body 背景透出 */\n.content { background: transparent !important; }\n/* 侧边栏白底半透明 */\n.sidebar { background: rgba(255, 255, 255, 0.93) !important; }\n/* v179 角标 */\nbody::after { content: \"v179\" !important; }";
  document.head.appendChild(s);
  console.log("[v179] 教育主题图案背景已安装 (base64 SVG)");
})();
// ===== end v179 =====


// ===== v182: 手机端角标+系统通知（iOS/Android 兼容）=====
window.__v182Installed = true;
(function v182Init() {
  // ─── 工具函数 ───────────────────────────────────
  function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // 统一更新角标（兼容所有平台）
  async function v182UpdateBadge(count) {
    // 1. 优先用 setAppBadge（桌面 Chrome/Edge/iOS 16.4+）
    if (navigator.setBadge) {
      try {
        if (count > 0) await navigator.setBadge(count);
        else await navigator.clearBadge();
      } catch(e) { /* ignore */ }
    }
    // 2. iOS 专用（老版本 iOS）
    if (navigator.setAppBadge) {
      try {
        if (count > 0) navigator.setAppBadge(count);
        else navigator.clearAppBadge();
      } catch(e) { /* ignore */ }
    }
    // 3. 更新页面红点
    v182UpdateDot(count);
    // 4. 更新标签标题
    var baseTitle = document.title.replace(/^\[\d+\]\s*/, '');
    document.title = count > 0 ? '[' + count + '] ' + baseTitle : baseTitle;
  }

  // 页面红点（侧边栏按钮上）
  function v182UpdateDot(count) {
    var existing = document.querySelector('.v182-nav-dot');
    var btns = document.querySelectorAll('.nav-btn');
    var subBtn = null;
    for (var i = 0; i < btns.length; i++) {
      var t = btns[i].textContent || '';
      if (t.includes('代课') || btns[i].getAttribute('data-page') === 'substitute') {
        subBtn = btns[i]; subBtn.style.position = 'relative'; break;
      }
    }
    if (count > 0) {
      if (!existing && subBtn) {
        var dot = document.createElement('span');
        dot.className = 'v182-nav-dot';
        dot.style.cssText = 'position:absolute;top:-2px;right:-2px;background:#EF4444;color:white;font-size:10px;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:bold;border:2px solid white;padding:0 4px;';
        dot.textContent = count > 99 ? '99+' : count;
        subBtn.appendChild(dot);
      } else if (existing) {
        existing.textContent = count > 99 ? '99+' : count;
        existing.style.display = 'flex';
      }
    } else if (existing) {
      existing.style.display = 'none';
    }
  }

  // 发系统通知（触发 Android 图标红点 / iOS 通知）
  async function v182ShowNotification(count, subs) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (count <= 0) return;
    if (!navigator.serviceWorker) return;
    try {
      var reg = await navigator.serviceWorker.ready;
      var title = count === 1 ? '📌 您有 1 条代课安排' : '📌 您有 ' + count + ' 条代课安排';
      var body = subs && subs[0]
        ? subs[0].leaveDate + ' ' + subs[0].className + ' 第' + subs[0].period + '节 ' + (subs[0].subject||'')
        : '请打开系统查看详情';
      await reg.showNotification(title, {
        body: body,
        tag: 'v182-sub-notify',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%234A90E2" width="192" height="192" rx="38"/><text x="96" y="128" font-size="90" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold">代</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="24" fill="%23EF4444"/><text x="24" y="32" font-size="22" text-anchor="middle" fill="white" font-weight="bold">' + (count > 9 ? '9+' : count) + '</text></svg>',
        requireInteraction: false,
        silent: false,
        vibrate: [200, 100, 200]
      });
    } catch(e) { console.warn('[v182] 通知失败', e); }
  }

  // ─── 页面端检查新代课 ─────────────────────────────
  async function v182PageCheck() {
    try {
      var r = await fetch('/api/substitutes');
      var data = await r.json();
      if (!data.success || !data.data) return;

      var role = sessionStorage.getItem('role');
      var myName = sessionStorage.getItem('teacherName') || '';
      var unreadCount = 0;
      var newSubs = [];

      if (role === 'teacher' && myName) {
        var mySubs = data.data.filter(function(s) { return s.substituteTeacher === myName; });
        var notifiedKey = 'v182_notified';
        var notified = JSON.parse(localStorage.getItem(notifiedKey) || '[]');
        newSubs = mySubs.filter(function(s) { return !notified.includes(s.id); });
        unreadCount = newSubs.length;

        if (newSubs.length > 0) {
          // 后台时发通知
          if (document.visibilityState === 'hidden') {
            await v182ShowNotification(unreadCount, newSubs);
          }
          // 页面可见时更新 badge
          await v182UpdateBadge(unreadCount);
        } else {
          await v182UpdateBadge(0);
        }

      } else if (role === 'admin') {
        var pending = data.data.filter(function(s) { return s.status === 'pending'; }).length;
        unreadCount = pending;
        await v182UpdateBadge(pending);
      } else {
        await v182UpdateBadge(0);
      }
    } catch(e) { console.warn('[v182] 检查失败', e); }
  }

  // ─── SW 消息监听 ─────────────────────────────────
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function(event) {
      var d = event.data || {};
      if (d.type === 'v182_new_subs') {
        v182UpdateBadge(d.count);
        if (d.count > 0) {
          if (document.visibilityState === 'hidden') {
            v182ShowNotification(d.count, d.subs);
          }
        }
      }
      if (d.type === 'v182_get_teacher_reply') {
        // SW 询问 teacherName 的回复，已在 SW 端处理
      }
    });
  }

  // ─── 通知权限请求 ─────────────────────────────────
  async function v182RequestPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') {
      // 用户拒绝过，提示他开启
      v182ShowPermHint();
      return;
    }
    // 首次请求
    var perm = await Notification.requestPermission();
    if (perm === 'granted') {
      v182UpdatePermStatus(true);
      // 立即检查一次
      v182PageCheck();
    } else {
      v182UpdatePermStatus(false);
    }
  }

  function v182UpdatePermStatus(granted) {
    var el = document.querySelector('.v182-perm-hint');
    if (!el) return;
    if (granted) {
      el.innerHTML = '✅ 已开启通知提醒';
      el.style.color = '#10B981';
      el.style.display = 'block';
    }
  }

  function v182ShowPermHint() {
    var el = document.querySelector('.v182-perm-hint');
    if (el) { el.style.display = 'block'; }
  }

  // ─── 事件绑定 ────────────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      v182PageCheck();
    }
  });

  // ─── 启动 ────────────────────────────────────────
  // 登录后立即请求权限（3 秒后）
  setTimeout(v182RequestPermission, 3000);
  // 每 5 分钟检查一次
  setInterval(v182PageCheck, 5 * 60 * 1000);
  // 首次检查（页面加载 5 秒后）
  setTimeout(v182PageCheck, 5000);

  console.log('[v182] 手机端角标+系统通知已安装');
})();
// ===== end v182 =====
// ===== end v180 =====


// ===== v184: 标准模板下载入口（在「导入课表」页顶部注入下载卡片）=====
window.__v184Installed = true;
(function v184Init() {
  if (window.__v184Installed !== true) return;
  window.__v184Installed = true;

  // 通用下载（base64 -> Blob -> a.download）
  function v184SaveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 120);
  }

  window.v184Download = function (key) {
    var t = window.SCHOOL_TEMPLATES && window.SCHOOL_TEMPLATES[key];
    if (!t || !t.base64) { alert('模板数据缺失，请刷新页面重试'); return; }
    try {
      var byteChars = atob(t.base64);
      var bytes = new Uint8Array(byteChars.length);
      for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      v184SaveBlob(new Blob([bytes], { type: t.mime }), t.filename);
    } catch (e) { alert('下载失败：' + (e && e.message ? e.message : e)); }
  };

  window.v184DownloadGuide = function () {
    var g = window.SCHOOL_TEMPLATES && window.SCHOOL_TEMPLATES.guide;
    if (!g || !g.text) { alert('说明文档缺失，请刷新页面重试'); return; }
    v184SaveBlob(new Blob([g.text], { type: g.mime }), g.filename);
  };

  // 注入下载卡片
  function v184InjCard(area) {
    var pageEl = area.querySelector ? area.querySelector('.page') : null;
    if (!pageEl) return;
    if (pageEl.querySelector('.v184-tpl-card')) return; // 防重
    var card = document.createElement('div');
    card.className = 'card v184-tpl-card';
    card.style.border = '2px solid #4A90E2';
    card.style.background = '#F5F9FF';
    card.innerHTML =
      '<h3>📥 标准模板下载</h3>' +
      '<p class="text-muted">首次导入前请先下载对应模板，按格式填写后上传，系统可准确解析。' +
      '三种模板分别用于：总课表、课后服务/晚自习/午休、校历。</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
      '<button class="btn btn-primary" onclick="v184Download(\'timetable\')">📊 总课表模板</button>' +
      '<button class="btn btn-primary" onclick="v184Download(\'afterschool\')">📚 课后服务表模板</button>' +
      '<button class="btn btn-primary" onclick="v184Download(\'calendar\')">📅 校历表模板</button>' +
      '<button class="btn" onclick="v184DownloadGuide()">📋 填写说明</button>' +
      '</div>';
    // 插入到第一个 .card 之前（标题之后）
    var firstCard = pageEl.querySelector('.card');
    if (firstCard) pageEl.insertBefore(card, firstCard);
    else pageEl.appendChild(card);
  }

  // wrap renderImportPage
  if (typeof window.renderImportPage === 'function') {
    var _origRenderImportPage = window.renderImportPage;
    window.renderImportPage = function (area) {
      _origRenderImportPage(area);
      try { v184InjCard(area); } catch (e) { /* ignore */ }
    };
  } else {
    // 兜底：监听 switchPage 后注入
    if (typeof window.switchPage === 'function') {
      var _origSwitch = window.switchPage;
      window.switchPage = function (page) {
        _origSwitch.apply(this, arguments);
        if (page === 'import') {
          var mc = document.getElementById('main-content');
          if (mc) setTimeout(function () { try { v184InjCard(mc); } catch (e) {} }, 50);
        }
      };
    }
  }

  console.log('[v184] 标准模板下载入口已安装');
})();
// ===== end v184 =====


// ===== v186: 动态学校名 =====
(function () {
  if (window.__v186Installed) return;
  window.__v186Installed = true;

  function applySchoolName(name) {
    if (!name) return;
    var map = {
      'v186-sn-login': name,
      'v186-sn-topbar': name,
      'v186-sn-about': name + ' · 代课调课系统 v1.0',
      'v186-sn-footer': name
    };
    for (var id in map) {
      var el = document.getElementById(id);
      if (el) el.textContent = map[id];
    }
    document.title = '代课调课系统 - ' + name;
  }

  if (window.schoolName) applySchoolName(window.schoolName);

  var orig = window.loadScheduleData;
  if (orig) {
    window.loadScheduleData = function () {
      var args = arguments;
      return orig.apply(this, args).then(function (r) {
        if (window.schoolName) applySchoolName(window.schoolName);
        return r;
      });
    };
  }
})();


// ===== v187: 删除学校按钮（DOM注入） =====
(function () {
  if (window.__v187Installed) return;
  window.__v187Installed = true;

  window.v187DeleteSchool = async function (schoolId, schoolName) {
    if (!confirm('确定要删除「' + schoolName + '」吗？\n\n这将同时删除：\n- 学校的独立网页\n- 学校的所有数据 (KV)\n\n此操作不可恢复！')) return;
    if (!confirm('再次确认：删除后「' + schoolName + '」将无法恢复！')) return;
    try {
      var res = await fetch('/api/master/schools/' + schoolId, {
        method: 'DELETE',
        headers: { 'x-admin-pwd': adminPwd }
      });
      var j = await res.json();
      if (j.success) {
        alert('「' + schoolName + '」已删除。');
        if (window.v171LoadSchools) v171LoadSchools();
      } else {
        alert('删除失败: ' + (j.message || '未知错误'));
      }
    } catch (e) {
      alert('网络错误: ' + e.message);
    }
  };

  // DOM注入：在v171LoadSchools完成后给每行追加删除按钮
  var orig = window.v171LoadSchools;
  if (orig) {
    window.v171LoadSchools = async function () {
      var r = orig.apply(this, arguments);
      if (r && r.then) {
        await r;
      }
      // 等列表渲染完
      setTimeout(function () {
        var renewBtns = document.querySelectorAll('[onclick*="v172OpenRenew"]');
        renewBtns.forEach(function (btn) {
          // 检查是否已有删除按钮
          if (btn.nextSibling && btn.nextSibling.className && btn.nextSibling.className.includes('v187-del')) return;
          var schoolId = btn.getAttribute('data-school-id');
          var schoolName = btn.getAttribute('data-school-name');
          if (!schoolId) return;
          var sep = document.createElement('span');
          sep.textContent = ' | ';
          sep.style.color = '#E5E7EB';
          sep.style.margin = '0 4px';
          var delBtn = document.createElement('button');
          delBtn.textContent = '删除';
          delBtn.style.cssText = 'background:#EF4444;color:#FFF;border:none;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px;';
          delBtn.onclick = function (e) {
            e.stopPropagation();
            window.v187DeleteSchool(schoolId, schoolName);
          };
          btn.parentNode.insertBefore(sep, btn.nextSibling);
          btn.parentNode.insertBefore(delBtn, sep.nextSibling);
        });
      }, 100);
      return r;
    };
  }
})();
