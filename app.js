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
  async getSubstitutes() {
    try {
      const r = await fetch('/api/substitutes');
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
          <p class="login-hint">请选择您的姓名</p>
          <select id="login-teacher-select" class="form-select" onchange="handleTeacherLogin(this.value)">
            <option value="">— 选择教师 —</option>
          </select>
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
  adminPwd = pwd;
  isAdmin = true;
  sessionStorage.setItem('role','admin');
  sessionStorage.setItem('adminPwd', pwd);
  currentPage = 'home';
  toast('管理员登录成功','success');
  initApp();
}

async function loadTeacherList() {
  const sel = $('login-teacher-select');
  if (!sel) return;
  // 优先从 localStorage 缓存加载教师列表
  const cached = localStorage.getItem('teachers_cache');
  if (cached) {
    const teachers = JSON.parse(cached);
    teachers.forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
    return;
  }
  const { data } = await API.getSchedule();
  if (data && data.allTeachers) {
    localStorage.setItem('teachers_cache', JSON.stringify(data.allTeachers));
    data.allTeachers.forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
  } else {
    // 从parsed_data.json直接加载
    try {
      const r = await fetch('parsed_data.json');
      const pd = await r.json();
      if (pd.allTeachers) {
        localStorage.setItem('teachers_cache', JSON.stringify(pd.allTeachers));
        pd.allTeachers.forEach(t => { const o = document.createElement('option'); o.value=t; o.textContent=t; sel.appendChild(o); });
      }
    } catch {}
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

    <div class="app-body">
      <!-- 侧边栏 -->
      <nav class="sidebar">
        <div class="sidebar-section">
          <div class="sidebar-section-title">📋 功能菜单</div>
          <button class="nav-btn" data-page="home"    onclick="switchPage('home')">🏠 首页</button>
          <button class="nav-btn" data-page="tt"      onclick="switchPage('tt')">📅 课表查询</button>
          <button class="nav-btn" data-page="leave"   onclick="switchPage('leave')">🏖️ 请假登记</button>
          <button class="nav-btn" data-page="sub"     onclick="switchPage('sub')">✅ 代课安排${subBadge}</button>
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
  const pendingLeaves = leaveRecords.filter(l => l.status !== 'approved');
  const hasData = cls.length > 0;

  area.innerHTML = `
  <div class="page">
    <h2 class="page-title">📊 系统概览</h2>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon">🏫</div>
        <div class="stat-num">${cls.length}</div>
        <div class="stat-label">班级</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">👩‍🏫</div>
        <div class="stat-num">${teas.length}</div>
        <div class="stat-label">教师</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">📚</div>
        <div class="stat-num">${cls.length * 30}</div>
        <div class="stat-label">周总课时</div>
      </div>
      <div class="stat-card ${pendingLeaves.length > 0 ? 'stat-alert' : ''}">
        <div class="stat-icon">🏖️</div>
        <div class="stat-num">${leaveRecords.length}</div>
        <div class="stat-label">请假记录</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-num">${substituteRecords.length}</div>
        <div class="stat-label">代课安排</div>
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
        <span class="action-label">代课安排</span>
      </button>
      <button class="action-card" onclick="switchPage('import')">
        <span class="action-icon">📤</span>
        <span class="action-label">导入课表</span>
      </button>` : ''}
      <button class="action-card" onclick="switchPage('tt')">
        <span class="action-icon">📅</span>
        <span class="action-label">课表查询</span>
      </button>
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
  const timeMap = {
    1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00',
    5:'14:00-14:40', 6:'14:50-15:30',
    7:'课后服务1', 8:'课后服务2', 9:'课后服务3',
    10:'晚自习', 11:'午休'
  };

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
    const found = slots.find(s => normD(s.day) === target && s.period === period);
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
  html += `<thead><tr><th>节次</th><th>时间</th>${days.map(d=>`<th>${d}</th>`).join('')}</tr></thead><tbody>`;

  // 常规课程（1-6节）
  for (const p of [1,2,3,4,5,6]) {
    html += `<tr><td>第${p}节</td><td class="time-cell">${timeMap[p]}</td>`;
    for (const d of days) {
      const slots = tt[d]?.[cn] || [];
      const slot = slots.find(s => s.period === p);
      html += `<td class="${slot ? 'has-class' : 'empty-cell'}">
        ${slot ? `<span class="subj">${esc(slot.subject)}</span><br><span class="tea">${esc(slot.teacher)}</span>` : '—'}
      </td>`;
    }
    html += `</tr>`;
  }

  // 课后服务（7-11节）
  const afterschoolPeriods = [7,8,9,10,11];
  for (const p of afterschoolPeriods) {
    html += `<tr class="afterschool-row"><td>第${p}节</td><td class="time-cell">${timeMap[p]}</td>`;
    for (const d of days) {
      const asn = getAfterSchoolTeacher(d, p);
      if (asn) {
        if (asn.week === '单周/双周') {
          html += `<td class="has-class afterschool-cell">
            <span class="subj">${esc(asn.singleWeek||'')}</span><span class="week-tag">单周</span><br>
            <span class="subj">${esc(asn.doubleWeek||'')}</span><span class="week-tag week-double">双周</span>
          </td>`;
        } else {
          html += `<td class="has-class afterschool-cell">
            <span class="subj">${esc(asn.teacher||'')}</span>
            ${asn.week ? `<span class="week-tag">${esc(asn.week)}</span>` : ''}
          </td>`;
        }
      } else {
        html += `<td class="empty-cell afterschool-cell">—</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  area.innerHTML = html;
}

function renderTTMy() {
  const td = scheduleData || {};
  const tt = td.timetable || {};
  const myName = sessionStorage.getItem('teacherName') || '';
  const area = $('tt-my-content');
  if (!area) return;

  const mySlots = [];
  for (const [day, classMap] of Object.entries(tt)) {
    for (const [cn, slots] of Object.entries(classMap)) {
      for (const s of slots) {
        if (s.teacher === myName) mySlots.push({ day, className: cn, ...s });
      }
    }
  }

  if (mySlots.length === 0) {
    area.innerHTML = '<p class="text-muted">暂无您的课表记录</p>';
    return;
  }

  const days = ['星期一','星期二','星期三','星期四','星期五'];
  const timeMap = { 1:'8:20-9:00', 2:'9:10-9:50', 3:'10:30-11:10', 4:'11:20-12:00', 5:'14:00-14:40', 6:'14:50-15:30' };

  let html = `<div class="table-wrap"><table class="data-table tt-table">`;
  html += `<thead><tr><th>节次</th><th>时间</th><th>班级</th><th>科目</th></tr></thead><tbody>`;

  const dayOrder = d => days.indexOf(d);
  mySlots.sort((a,b) => dayOrder(a.day) - dayOrder(b.day) || a.period - b.period)
    .forEach(s => {
      html += `<tr>
        <td>第${s.period}节</td>
        <td class="time-cell">${timeMap[s.period]||''}</td>
        <td>${esc(s.className)}</td>
        <td>${esc(s.subject)}</td>
      </tr>`;
    });
  html += `</tbody></table></div>`;
  area.innerHTML = html;
}

// ══════════════════════════════════════════════════════
//  请假登记页
// ══════════════════════════════════════════════════════
function renderLeavePage(area) {
  const td = scheduleData || {};
  const teas = td.allTeachers || [];

  area.innerHTML = `
  <div class="page">
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
          <thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th><th>状态</th>${isAdmin?'<th>操作</th>':''}</tr></thead>
          <tbody>
            ${leaveRecords.map(l => `
            <tr class="${l.status==='approved'?'row-approved':''}">
              <td>${esc(l.teacherName)}</td>
              <td>${fmtDate(l.leaveDate)}</td>
              <td>${esc(l.dayOfWeek)}</td>
              <td>${l.period ? '第'+l.period+'节' : '—'}</td>
              <td>${esc(l.reason||'—')}</td>
              <td><span class="badge badge-${l.status==='approved'?'green':l.status==='rejected'?'red':'yellow'}">${l.status||'待审核'}</span></td>
              ${isAdmin ? `<td>
                <button class="btn btn-sm btn-success" onclick="approveLeave('${l.id}')">批准</button>
                <button class="btn btn-sm btn-danger"  onclick="deleteLeave('${l.id}')">删除</button>
              </td>` : ''}
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
  if (!scheduleData || !scheduleData.timetable) return periods;
  
  const dayData = scheduleData.timetable[dayOfWeek];
  if (!dayData) return periods;
  
  for (const [className, slots] of Object.entries(dayData)) {
    for (const slot of slots) {
      if (slot.teacher === teacherName && slot.period) {
        periods.push(parseInt(slot.period));
      }
    }
  }
  
  // 去重并排序
  return [...new Set(periods)].sort((a, b) => a - b);
}

async function submitLeave(e) {
  e.preventDefault();
  const fd  = new FormData(e.target);
  const leaveType = fd.get('leaveType');
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
        leavesToAdd.push({ teacherName, leaveDate, dayOfWeek, period: p, reason, status });
      }
    } else {
      // 单节
      leavesToAdd.push({ teacherName, leaveDate, dayOfWeek, period: parseInt(periodVal), reason, status });
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
        leavesToAdd.push({ teacherName, leaveDate: dateStr, dayOfWeek, period: p, reason, status });
      }
    }
  }

  if (leavesToAdd.length === 0) {
    toast('没有可请假的课程记录', 'warning');
    return;
  }

  // 批量提交
  let successCount = 0;
  for (const obj of leavesToAdd) {
    const r = await API.addLeave(obj);
    if (r.success) {
      leaveRecords.unshift({ id: r.data?.id || Date.now().toString(36), ...obj });
      successCount++;
    }
  }

  if (successCount > 0) {
    toast(`成功登记 ${successCount} 条请假记录`, 'success');
    e.target.reset();
    $('leave-wday').value = wday(now());
    renderLeavePage($('main-content'));
  } else {
    toast('提交失败', 'error');
  }
}

async function deleteLeave(id) {
  if (!confirm('确定删除？')) return;
  await API.deleteLeave(id);
  leaveRecords = leaveRecords.filter(l => l.id !== id);
  toast('已删除','success');
  renderLeavePage($('main-content'));
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
  await API.clearSubstitutes(); // Note: separate API needed, use direct fetch
  leaveRecords = [];
  toast('已清空','success');
  renderLeavePage($('main-content'));
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
    <h2 class="page-title">✅ 代课安排</h2>

    ${isAdmin ? `
    <div class="action-bar">
      ${pendingCount > 0 ? `<span class="pending-badge">${pendingCount} 条请假待安排</span>` : ''}
      <button class="btn btn-primary" onclick="doGenerateSubstitutes()">⚡ 自动生成代课安排</button>
      ${previewSubstitutes.length > 0 ? `
        <button class="btn btn-success" onclick="confirmSubstitutes()">✅ 确认方案</button>
        <button class="btn btn-secondary" onclick="cancelPreview()">❌ 取消预览</button>
      ` : `<button class="btn btn-secondary" onclick="exportSubExcel()" ${substituteRecords.length === 0 ? 'disabled' : ''}>📥 导出Excel</button>`}
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
          <th>安排方式</th>
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
  const loading = showLoading('正在分析代课方案...');
  try {
    const r = await API.generateSubstitutes();
    loading.remove();
    if (r.success) {
      const results = r.data || r.results || [];
      if (results.length > 0) {
        previewSubstitutes = results; // 进入预览模式
        toast(`生成完成！请检查预览方案，确认后再导出`, 'success');
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
  XLSX.utils.book_append_sheet(wb, ws, '代课安排');
  XLSX.writeFile(wb, `代课安排_${now()}.xlsx`);
  toast('导出成功','success');
}

// ══════════════════════════════════════════════════════
//  导入课表页（管理员）
// ══════════════════════════════════════════════════════
function renderImportPage(area) {
  area.innerHTML = `
  <div class="page">
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
      <h3>📁 方式三：导入 JSON 数据</h3>
      <p class="text-muted">将 <code>parsed_data.json</code> 文件上传。</p>
      <div class="form-group">
        <input type="file" id="import-json" accept=".json" class="form-file"
               onchange="handleJsonImport(this.files[0])">
      </div>
    </div>

    <div class="card">
      <h3>📝 方式四：手动粘贴JSON数据</h3>
      <p class="text-muted">从 parsed_data.json 文件中复制内容，粘贴到下方：</p>
      <textarea id="import-textarea" class="form-textarea" rows="8"
                placeholder="粘贴 parsed_data.json 的内容..."></textarea>
      <button class="btn btn-primary" onclick="handleTextImport()">导入数据</button>
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
  const hasData = cls.length > 0;

  return hasData ? `
  <div class="status-ok">✅ 已导入</div>
  <div class="stats-row" style="margin-top:12px">
    <div class="stat-mini"><span class="sn">${cls.length}</span><span class="sl">班级</span></div>
    <div class="stat-mini"><span class="sn">${teas.length}</span><span class="sl">教师</span></div>
    <div class="stat-mini"><span class="sn">${cls.length*30}</span><span class="sl">总课时</span></div>
  </div>
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
    
    const importData = {
      timetable: scheduleData?.timetable || {},
      teacherAssignment: scheduleData?.teacherAssignment || {},
      classes: scheduleData?.classes || [],
      allTeachers: scheduleData?.allTeachers || [],
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
  if (!data.timetable || !data.classes) {
    toast('数据格式不正确，缺少 timetable 或 classes','error'); return;
  }
  const loading = showLoading('正在导入课表...');
  try {
    const r = await API.importSchedule(data);
    loading.remove();
    if (r.success) {
      scheduleData = data;
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

    <div class="card">
      <h3>ℹ️ 关于本系统</h3>
      <p>施秉县双井镇中心小学 · 代课调课系统 v1.0</p>
      <p class="text-muted">基于云端数据库，支持多端同步。不依赖主机电脑，随时随地访问。</p>
      <p class="text-muted">默认管理员密码：<code>admin888</code>（首次使用请修改 server.js 中的 ADMIN_HASH）</p>
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
  const [schR, leavesR, subsR] = await Promise.all([
    API.getSchedule(), API.getLeaves(), API.getSubstitutes()
  ]);

  if (schR.success && schR.data && Object.keys(schR.data).length > 0) {
    scheduleData = {
      timetable: schR.data,
      teacherAssignment: schR.teacherAssignment || {},
      afterSchoolService: schR.afterSchoolService || {},
      classes: schR.classes || [],
      allTeachers: schR.allTeachers || []
    };
  } else if (schR.afterSchoolService) {
    // 只有课后服务数据
    scheduleData = {
      timetable: {},
      teacherAssignment: {},
      afterSchoolService: schR.afterSchoolService || {},
      classes: [],
      allTeachers: []
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

  switchPage('home');
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
