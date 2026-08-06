/**
 * 学校代课安排系统 - 主逻辑
 */

// ========== 常量 ==========
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
// 代课优先级分组：1=语文/数学, 2=英语, 3=道德与法治/科学, 4=其他
function getSubstitutePriority(subject) {
  if (subject === '语文' || subject === '数学') return 1;
  if (subject === '英语') return 2;
  if (subject === '道德与法治' || subject === '科学') return 3;
  return 4;
}

const SUBJECT_PRIORITY = ['语文', '数学', '英语', '道德与法治', '科学'];
const STORAGE_KEYS = {
  schedule: 'substitute_schedule_data',
  leaves: 'substitute_leave_data',
  substitutions: 'substitute_result_data',
  role: 'substitute_user_role',
  webhook: 'substitute_webhook_url'
};
const ADMIN_PASSWORD = 'admin888'; // 管理员密码，可修改

// ========== 角色管理 ==========
const Role = {
  ADMIN: 'admin',
  TEACHER: 'teacher',
  current() {
    return localStorage.getItem(STORAGE_KEYS.role) || Role.TEACHER; // 默认教师模式
  },
  set(role) {
    localStorage.setItem(STORAGE_KEYS.role, role);
  },
  isAdmin() {
    return this.current() === Role.ADMIN;
  },
  isTeacher() {
    return this.current() === Role.TEACHER;
  },
  switchToAdmin() {
    const pwd = prompt('请输入管理员密码：');
    if (pwd === null) return false; // 用户取消
    if (pwd === ADMIN_PASSWORD) {
      this.set(Role.ADMIN);
      updateRoleUI();
      const activePage = document.querySelector('.nav-item.active');
      if (activePage) activePage.click();
      showToast('已进入管理员模式', 'success');
      return true;
    } else {
      showToast('密码错误', 'error');
      return false;
    }
  },
  switchToTeacher() {
    this.set(Role.TEACHER);
    updateRoleUI();
    const activePage = document.querySelector('.nav-item.active');
    if (activePage) activePage.click();
    showToast('已切换为教师模式', 'success');
  }
};

function updateRoleUI() {
  const isAdmin = Role.isAdmin();
  // 更新角色切换按钮
  const roleBtn = document.getElementById('role-toggle-btn');
  if (roleBtn) {
    roleBtn.textContent = isAdmin ? '切换为教师' : '切换为管理员';
    roleBtn.className = isAdmin ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-primary';
  }
  // 更新角色标识
  const roleLabel = document.getElementById('role-label');
  if (roleLabel) {
    roleLabel.textContent = isAdmin ? '管理员模式' : '教师模式';
    roleLabel.className = isAdmin ? 'role-label admin' : 'role-label teacher';
  }
  // 隐藏/显示代课安排导航（仅管理员可见）
  const subNav = document.querySelector('[data-page="substitute"]');
  if (subNav) subNav.style.display = isAdmin ? '' : 'none';
  // 隐藏/显示课表管理导航（仅管理员可见）
  const scheduleNav = document.querySelector('[data-page="schedule"]');
  if (scheduleNav) scheduleNav.style.display = isAdmin ? '' : 'none';
  // 如果不是管理员且当前在管理员专属页面，切换到请假页
  if (!isAdmin) {
    const activePage = document.querySelector('.nav-item.active');
    if (activePage && (activePage.dataset.page === 'substitute' || activePage.dataset.page === 'schedule')) {
      document.querySelector('[data-page="leave"]').click();
    }
  }
}

// ========== 数据管理（后端 API + localStorage 后备） ==========
const API_BASE = window.location.origin;

const Store = {
  // 获取所有教师（从课表中提取）
  async getTeachers() {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`);
      if (!res.ok) throw new Error('获取课表失败');
      const json = await res.json();
      const records = json?.data || json?.records || [];
      const teachers = new Set();
      records.forEach(r => {
        if (r.teacherName) teachers.add(r.teacherName);
        if (r.oddWeekTeacher) teachers.add(r.oddWeekTeacher);
        if (r.evenWeekTeacher) teachers.add(r.evenWeekTeacher);
      });
      return Array.from(teachers).map(name => ({ name }));
    } catch (e) {
      console.warn('API 获取教师失败，使用 localStorage:', e.message);
      const scheduleData = JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule) || 'null');
      if (!scheduleData) return [];
      const teachers = new Set();
      for (const classData of Object.values(scheduleData.classes || {})) {
        for (const dayData of Object.values(classData)) {
          for (const periodData of Object.values(dayData)) {
            if (periodData?.teacher) teachers.add(periodData.teacher);
          }
        }
      }
      return Array.from(teachers).map(name => ({ name }));
    }
  },

  // 获取所有班级（从课表中提取）
  async getClasses() {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`);
      if (!res.ok) throw new Error('获取课表失败');
      const json = await res.json();
      const records = json?.data || json?.records || [];
      const classes = new Set();
      records.forEach(r => {
        if (r.className) classes.add(r.className);
      });
      return Array.from(classes).map(name => ({ name }));
    } catch (e) {
      console.warn('API 获取班级失败，使用 localStorage:', e.message);
      const scheduleData = JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule) || 'null');
      if (!scheduleData) return [];
      return Object.keys(scheduleData.classes || {}).map(name => ({ name }));
    }
  },

  // 获取课表（原始数据）
  async getSchedule() {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`);
      if (!res.ok) throw new Error('获取课表失败');
      const json = await res.json();
      const records = json?.data || json?.records || [];
      // 转换为前端期望的格式
      if (records.length > 0) {
        const scheduleData = { classes: {}, teachers: new Set() };
        records.forEach(r => {
          const cls = r.className;
          const day = r.weekday;
          const period = r.period;
          if (!scheduleData.classes[cls]) scheduleData.classes[cls] = {};
          if (!scheduleData.classes[cls][day]) scheduleData.classes[cls][day] = {};
          scheduleData.classes[cls][day][period] = {
            teacher: r.teacherName,
            subject: r.subject,
            oddWeekTeacher: r.oddWeekTeacher,
            evenWeekTeacher: r.evenWeekTeacher
          };
          if (r.teacherName) scheduleData.teachers.add(r.teacherName);
          if (r.oddWeekTeacher) scheduleData.teachers.add(r.oddWeekTeacher);
          if (r.evenWeekTeacher) scheduleData.teachers.add(r.evenWeekTeacher);
        });
        scheduleData.teachers = Array.from(scheduleData.teachers);
        return scheduleData;
      }
      return null;
    } catch (e) {
      console.warn('API 获取课表失败，使用 localStorage:', e.message);
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule)) || null; }
      catch { return null; }
    }
  },

  // 保存课表（整体替换）
  async saveSchedule(scheduleData) {
    try {
      // 转换为扁平记录格式
      const records = [];
      if (scheduleData?.classes) {
        for (const [className, days] of Object.entries(scheduleData.classes)) {
          for (const [weekday, periods] of Object.entries(days)) {
            for (const [period, data] of Object.entries(periods)) {
              if (data?.teacher) {
                records.push({
                  className,
                  teacherName: data.teacher,
                  subject: data.subject || '',
                  weekday,
                  period: parseInt(period),
                  oddWeekTeacher: data.oddWeekTeacher || null,
                  evenWeekTeacher: data.evenWeekTeacher || null
                });
              }
            }
          }
        }
      }
      const res = await fetch(`${API_BASE}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });
      if (!res.ok) throw new Error('保存课表失败');
      return scheduleData;
    } catch (e) {
      console.warn('API 保存课表失败，使用 localStorage:', e.message);
      localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(scheduleData));
      return scheduleData;
    }
  },

  // 清空课表
  async clearSchedule() {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`, { method: 'DELETE' });
      if (!res.ok) throw new Error('清空课表失败');
    } catch (e) {
      console.warn('API 清空课表失败，使用 localStorage:', e.message);
      localStorage.removeItem(STORAGE_KEYS.schedule);
    }
  },

  // 批量添加课表记录（追加模式）
   // 批量添加课表记录（追加模式）
  async addScheduleRecords(records) {
    try {
      // 先获取现有记录
      const existingRes = await fetch(`${API_BASE}/api/schedule`);
      const existingJson = await existingRes.json();
      const existing = existingJson?.data || existingJson?.records || [];
      // 合并记录
      const merged = [...existing, ...records];
      // 保存合并后的记录
      const res = await fetch(`${API_BASE}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: merged })
      });
      if (!res.ok) throw new Error('添加课表记录失败');
      return await res.json();
    } catch (e) {
      console.warn('API 添加课表记录失败，使用 localStorage:', e.message);
      // 保存到 localStorage 作为后备
      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEYS.schedule)) || { classes: {}, teachers: [] };
        // 将 records 转换为 classes 格式
        for (const r of records) {
          if (!existing.classes[r.className]) existing.classes[r.className] = {};
          if (!existing.classes[r.className][r.weekday]) existing.classes[r.className][r.weekday] = {};
          existing.classes[r.className][r.weekday][r.period] = {
            teacher: r.teacherName,
            subject: r.subject || ''
          };
        }
        localStorage.setItem(STORAGE_KEYS.schedule, JSON.stringify(existing));
      } catch (err) {
        console.error('localStorage 保存失败:', err);
      }
      return { records };
    }
  },


  // 获取请假记录
  async getLeaves() {
    try {
      const res = await fetch(`${API_BASE}/api/leaves`);
      if (!res.ok) throw new Error('获取请假记录失败');
      const json = await res.json();
      const records = json?.data || json?.records || [];
      // 转换字段名为前端期望的格式
      return records.map(r => ({
        id: r.id,
        teacher: r.teacherName || r.teacher,
        date: r.leaveDate || r.date,
        weekday: r.weekday,
        period: r.period,
        reason: r.reason,
        fullDay: r.isAllDay || r.fullDay || false,
        periods: r.isAllDay ? null : (r.periods || (r.period ? [r.period] : null)),
        endDate: r.endDate || null
      }));
    } catch (e) {
      console.warn('API 获取请假记录失败，使用 localStorage:', e.message);
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.leaves)) || []; }
      catch { return []; }
    }
  },

  // 添加请假记录
  async addLeave(teacherName, leaveDate, weekday, period, reason, isAllDay = false, endDate = null) {
    try {
      const res = await fetch(`${API_BASE}/api/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leave: { teacherName, leaveDate, weekday, period, reason, isAllDay, endDate }
        })
      });
      if (!res.ok) throw new Error('添加请假记录失败');
      return await res.json();
    } catch (e) {
      console.warn('API 添加请假记录失败:', e.message);
      return { teacherName, leaveDate, weekday, period, reason };
    }
  },

  // 删除请假记录
  async deleteLeave(id) {
    try {
      const res = await fetch(`${API_BASE}/api/leaves/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除请假记录失败');
    } catch (e) {
      console.warn('API 删除请假记录失败:', e.message);
    }
  },

  // 获取代课记录
  async getSubstitutions() {
    try {
      const res = await fetch(`${API_BASE}/api/substitutes`);
      if (!res.ok) throw new Error('获取代课记录失败');
      const json = await res.json();
      return json?.data || json?.records || [];
    } catch (e) {
      console.warn('API 获取代课记录失败，使用 localStorage:', e.message);
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.substitutions)) || []; }
      catch { return []; }
    }
  },

  // 批量添加代课记录
  async addSubstitutions(records) {
    try {
      const res = await fetch(`${API_BASE}/api/substitutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });
      if (!res.ok) throw new Error('批量添加代课记录失败');
      return await res.json();
    } catch (e) {
      console.warn('API 批量添加代课记录失败:', e.message);
      return records;
    }
  },

  // 清空代课记录
  async clearSubstitutions() {
    try {
      const res = await fetch(`${API_BASE}/api/substitutes`, { method: 'DELETE' });
      if (!res.ok) throw new Error('清空代课记录失败');
    } catch (e) {
      console.warn('API 清空代课记录失败，使用 localStorage:', e.message);
      localStorage.removeItem(STORAGE_KEYS.substitutions);
    }
  }
};

// ========== 企业微信通知 ==========
const WebhookNotify = {
  getUrl() {
    return localStorage.getItem(STORAGE_KEYS.webhook) || '';
  },
  setUrl(url) {
    localStorage.setItem(STORAGE_KEYS.webhook, url);
  },
  isEnabled() {
    return !!this.getUrl();
  },
  // 发送请假通知
  async sendLeaveNotification(teacher, date, weekday, periodDisplay, reason) {
    const url = this.getUrl();
    if (!url) return false;
    try {
      const content = `【请假通知】\n教师：${teacher}\n日期：${date}（${weekday}）\n节次：${periodDisplay}\n原因：${reason || '未填写'}\n请及时安排代课。`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } })
      });
      if (res.ok) {
        console.log('[企业微信] 请假通知发送成功');
        return true;
      }
      console.warn('[企业微信] 通知发送失败:', res.status);
      return false;
    } catch (e) {
      console.warn('[企业微信] 通知发送异常:', e.message);
      return false;
    }
  }
};

// 保存 Webhook 地址
function saveWebhookUrl() {
  const url = document.getElementById('webhook-url').value.trim();
  WebhookNotify.saveUrl(url);
  alert(url ? 'Webhook 地址已保存！' : '已清除 Webhook 地址');
  // 刷新页面显示状态
  const currentPage = document.querySelector('.nav-item.active')?.dataset.page || 'schedule';
  navigateTo(currentPage);
}

// 测试 Webhook
async function testWebhook() {
  const url = document.getElementById('webhook-url').value.trim();
  if (!url) {
    alert('请先填写 Webhook 地址');
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: '【系统测试】学校代课安排系统企业微信通知已配置成功！' }
      })
    });
    if (res.ok) {
      alert('测试消息发送成功！请检查企业微信群消息。');
    } else {
      alert('发送失败，请检查 Webhook 地址是否正确。');
    }
  } catch (e) {
    alert('发送失败：' + e.message);
  }
}

// ========== 工具函数 ==========
function getSubjectPriority(subject) {
  return getSubstitutePriority(subject);
}

function getAllTeachers(scheduleData) {
  if (!scheduleData || !scheduleData.classes) return [];
  const teachers = new Set();
  Object.values(scheduleData.classes).forEach(classSchedule => {
    WEEKDAYS.forEach(day => {
      PERIODS.forEach(period => {
        const entry = classSchedule[day] && classSchedule[day][period];
        if (entry && entry.teacher) teachers.add(entry.teacher);
      });
    });
  });
  return Array.from(teachers).sort();
}

function getTeacherSubjects(scheduleData, teacherName) {
  if (!scheduleData || !scheduleData.classes) return [];
  const subjects = new Set();
  Object.values(scheduleData.classes).forEach(classSchedule => {
    WEEKDAYS.forEach(day => {
      PERIODS.forEach(period => {
        const entry = classSchedule[day] && classSchedule[day][period];
        if (entry && entry.teacher === teacherName) subjects.add(entry.subject);
      });
    });
  });
  return Array.from(subjects);
}

function isTeacherBusy(scheduleData, teacherName, weekday, period, excludeClass, dateStr) {
  if (!scheduleData || !scheduleData.classes) return false;
  const weekNum = dateStr ? getWeekNumber(dateStr) : 0;
  
  for (const [className, classSchedule] of Object.entries(scheduleData.classes)) {
    if (className === excludeClass) continue;
    const entry = classSchedule[weekday] && classSchedule[weekday][period];
    if (!entry) continue;
    
    // 处理单双周教师
    let actualTeacher = entry.teacher;
    if (entry.oddWeekTeacher && entry.evenWeekTeacher && weekNum > 0) {
      actualTeacher = (weekNum % 2 === 1) ? entry.oddWeekTeacher : entry.evenWeekTeacher;
    }
    
    if (actualTeacher === teacherName) return true;
  }
  return false;
}

function isTeacherOnLeave(leaves, teacherName, dateStr, weekday, period) {
  return leaves.some(leave =>
    leave.teacher === teacherName &&
    leave.date === dateStr &&
    (leave.fullDay || leave.periods === null || leave.periods.includes(period))
  );
}

function isAlreadyAssigned(substitutions, teacherName, dateStr, period) {
  return substitutions.some(sub =>
    sub.substituteTeacher === teacherName &&
    sub.date === dateStr &&
    sub.period === period
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${month}月${day}日`;
}

function getWeekdayFromDate(dateStr) {
  const d = new Date(dateStr);
  const dayIndex = d.getDay();
  const mapping = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 0: '周日' };
  return mapping[dayIndex] || '';
}

// 计算日期是学期第几周（单周/双周判断）
// 假设学期从2026年2月23日（周一）开始
function getWeekNumber(dateStr) {
  const semesterStart = new Date('2026-02-23'); // 学期开始日期（可调整）
  const d = new Date(dateStr);
  const diffTime = d.getTime() - semesterStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ========== Excel 解析 ==========
function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        // 优先选择"总表"sheet
        var sheetName = workbook.SheetNames.find(function(s) { return s.indexOf('总表') >= 0; }) || workbook.SheetNames[0];
        console.log('[课表解析] 使用Sheet: ' + sheetName + ', 所有Sheet: ' + workbook.SheetNames.join(', '));
        var sheet = workbook.Sheets[sheetName];

        // 展开合并单元格 - 只展开表头区域（前4行），避免数据区域的节次标签合并导致重复检测
        var merges = sheet['!merges'] || [];
        console.log('[课表解析] 合并单元格数量: ' + merges.length);
        for (var i = 0; i < merges.length; i++) {
          var merge = merges[i];
          // 只展开起始行在前4行的合并区域（标题行、星期行、班级行、午别行）
          if (merge.s.r > 3) continue;
          var originAddr = XLSX.utils.encode_cell(merge.s);
          var originCell = sheet[originAddr];
          var originVal = originCell ? (originCell.v !== undefined ? originCell.v : (originCell.w || '')) : '';
          for (var r = merge.s.r; r <= merge.e.r; r++) {
            for (var c = merge.s.c; c <= merge.e.c; c++) {
              if (r === merge.s.r && c === merge.s.c) continue;
              var addr = XLSX.utils.encode_cell({ r: r, c: c });
              if (!sheet[addr]) {
                sheet[addr] = { t: 's', v: originVal };
              }
            }
          }
        }

        var jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        console.log('[课表解析] 展开合并单元格后, 行数: ' + jsonData.length + ', 列数: ' + (jsonData[0] ? jsonData[0].length : 0));

        if (jsonData.length < 2) {
          reject(new Error('Excel文件数据不足，请检查格式'));
          return;
        }

        var result = parseScheduleData(jsonData);
        resolve(result);
      } catch (err) {
        reject(new Error('解析Excel文件失败: ' + err.message));
      }
    };
    reader.onerror = function() { reject(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 解析课表数据 - 自动检测格式
 * 支持三种格式：
 * 1. 总表格式：星期标记在行首，班级在列头，每节课占两行（科目行+教师行）
 * 2. 班级维度：班级 | 节次 | 周一 | 周二 | ... 单元格为"教师/科目"
 * 3. 教师维度：教师 | 科目 | 班级 | 周一1 | 周一2 | ...
 */
function parseScheduleData(rawData) {
  console.log('[课表解析] 开始解析, 行数: ' + rawData.length + ', 列数: ' + (rawData[0] ? rawData[0].length : 0));
  // 优先检测课后服务表格式
  const afterSchoolResult = tryParseAfterSchoolSchedule(rawData);
  if (afterSchoolResult) {
    console.log('[课表解析] 识别为课后服务表格式');
    return afterSchoolResult;
  }
  // 优先检测总表格式（含"星期一"等标记）
  const totalResult = tryParseTotalSchedule(rawData);
  if (totalResult) {
    console.log('[课表解析] 识别为总表格式');
    return totalResult;
  }

  // 回退到简单格式
  const headers = rawData[0].map(h => String(h).trim());
  const firstCol = headers[0] || '';

  if (firstCol.includes('教师') || firstCol.includes('姓名')) {
    return parseTeacherFormat(rawData, headers);
  }
  return parseClassFormat(rawData, headers);
}

/**
 * 尝试解析课后服务表格式
 * 特征：Col0有星期标记，Col1有时间，Col3有项目类型（午休/课后服务/晚自习）
 * 班级从Col5开始，格式为"一1"、"二2"等
 */
/**
 * 尝试解析课后服务表格式
 * 特征：Col0有星期标记，Col1有时间，Col3有项目类型（午休/课后服务/晚自习）
 * 班级从Col5开始，格式为"一1"、"二2"等
 */
/**
 * 尝试解析课后服务表格式
 * 特征：Col0有星期标记，Col1有时间，Col3有项目类型（午休/课后服务/晚自习）
 * 班级从Col5开始，格式为"一1"、"二2"等
 */
/**
 * 尝试解析课后服务表格式
 * 特征：Col0有星期标记，Col1有时间，Col3有项目类型（午休/课后服务/晚自习）
 * 班级从Col5开始，格式为"一1"、"二2"等
 */
function tryParseAfterSchoolSchedule(rawData) {
  // 检测特征：Col0有"星期"标记，Col1有时间格式
  let hasWeekdayMarker = false;
  let hasTimeColumn = false;
  let weekdayRowIdx = -1;

  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;
    const col0 = String(row[0] || '').trim();
    const col1 = String(row[1] || '').trim();

    // 检查星期标记（支持"星期一"、"星 期 一"等格式，但排除"年级星期"）
    const col0Clean = col0.replace(/\s+/g, '');
    if ((col0Clean === '星期一' || col0Clean === '星期二' || col0Clean === '星期三' || 
         col0Clean === '星期四' || col0Clean === '星期五' || col0Clean === '星期六' || col0Clean === '星期日') ||
        col0Clean.match(/^[一二三四五六七八九十]$/)) {
      hasWeekdayMarker = true;
      if (weekdayRowIdx === -1) {
        weekdayRowIdx = r; // 只记录第一个星期标记
      }
    }
    // 检查时间格式（如"13:00-13:50"）
    if (col1.match(/\d{1,2}:\d{2}/)) {
      hasTimeColumn = true;
    }
  }

  if (!hasWeekdayMarker || !hasTimeColumn) return null;

  console.log('[课后服务表] 检测到特征，开始解析');

  // 班级名称映射：一1 -> 一（1）, 二3 -> 二（3）
  const normalizeClassName = (name) => {
    const match = name.match(/^([一二三四五六七八九十]+)(\d+)$/);
    if (match) {
      return `${match[1]}（${match[2]}）`;
    }
    return name;
  };

  // 时间段映射到节次（支持全角和半角冒号）
  const timeToPeriod = (timeStr) => {
    if (timeStr.includes('13:00') || timeStr.includes('13：00') || timeStr.includes('午休')) return 7;
    if (timeStr.includes('15:40') || timeStr.includes('15：40') || timeStr.includes('课后服务1')) return 8;
    if (timeStr.includes('16:25') || timeStr.includes('16：25') || timeStr.includes('课后服务2')) return 9;
    if (timeStr.includes('17:10') || timeStr.includes('17：10') || timeStr.includes('课后服务3')) return 10;
    if (timeStr.includes('19:30') || timeStr.includes('19：30') || timeStr.includes('晚自习')) return 11;
    return null;
  };

  // 星期映射
  const weekdayMap = {
    '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四', '星期五': '周五',
    '一': '周一', '二': '周二', '三': '周三', '四': '周四', '五': '周五'
  };

  // 表头行（班级名称行）- 固定为 Row 2
  const headerRow = rawData[2];

  // 找班级列范围（从表头行找第一个和最后一个班级列）
  let firstClassCol = -1;
  let lastClassCol = -1;
  for (let c = 0; c < headerRow.length; c++) {
    const val = String(headerRow[c] || '').trim();
    if (val.match(/^[一二三四五六七八九十]+\d+$/)) {
      if (firstClassCol < 0) firstClassCol = c;
      lastClassCol = c;
    }
  }

  if (firstClassCol < 0) return null;

  // 提取班级列表
  const classList = [];
  for (let c = firstClassCol; c <= lastClassCol; c++) {
    const val = String(headerRow[c] || '').trim();
    if (val) {
      classList.push({ col: c, name: normalizeClassName(val) });
    }
  }

  // 收集所有教师名字（用于后续分割连在一起的名字）
  const allTeacherNames = new Set();
  for (let r = weekdayRowIdx; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row) continue;
    for (const cls of classList) {
      const val = String(row[cls.col] || '').trim();
      if (!val || /^\d+$/.test(val)) continue;
      // 按换行符分割
      if (val.includes('\n')) {
        val.split('\n').forEach(t => {
          const trimmed = t.trim();
          if (trimmed && trimmed.length >= 2 && trimmed.length <= 3) {
            allTeacherNames.add(trimmed);
          }
        });
      } else if (val.length >= 2 && val.length <= 3) {
        allTeacherNames.add(val);
      }
    }
  }
  const teacherNameList = Array.from(allTeacherNames).sort((a, b) => b.length - a.length);
  console.log(`[课后服务表] 收集到 ${teacherNameList.length} 个教师名字`);

  // 尝试分割连在一起的两个教师名字
  const trySplitTeachers = (raw) => {
    // 已有换行符，直接分割
    if (raw.includes('\n')) {
      return raw.split('\n').map(t => t.trim()).filter(t => t);
    }
    
    // 尝试用已知教师名字匹配
    for (const t1 of teacherNameList) {
      if (raw.startsWith(t1)) {
        const rest = raw.substring(t1.length);
        if (rest && teacherNameList.includes(rest)) {
          return [t1, rest];
        }
      }
    }
    
    // 尝试按长度分割（2-3字名字）
    if (raw.length >= 4 && raw.length <= 6) {
      for (let i = 2; i <= 3; i++) {
        const t1 = raw.substring(0, i);
        const t2 = raw.substring(i);
        if (t2.length >= 2 && t2.length <= 3) {
          return [t1, t2];
        }
      }
    }
    
    return [raw];
  };

  const classes = {};
  let entryCount = 0;

  // 从星期标记行开始解析
  let currentWeekday = null;

  for (let r = weekdayRowIdx; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row) continue;

    const col0 = String(row[0] || '').trim().replace(/\s+/g, '');
    const col1 = String(row[1] || '').trim();
    const col3 = String(row[3] || '').trim();

    // 检测星期标记（必须完整匹配，避免误判"第  周"等）
    let detectedWeekday = null;
    for (const [key, value] of Object.entries(weekdayMap)) {
      // 使用更严格的匹配：必须是完整的星期名称
      if (col0 === key || col0 === `星期${key}`) {
        detectedWeekday = value;
        break;
      }
    }

    if (detectedWeekday) {
      currentWeekday = detectedWeekday;
      // 不要跳过，继续处理该行的数据（星期标记行也包含数据）
    }

    if (!currentWeekday) continue;

    // 跳过没有时间的行（支持全角和半角冒号）
    if (!col1.match(/\d{1,2}[:：]\d{2}/)) continue;

    const period = timeToPeriod(col1);
    if (!period) continue;

    // 遍历所有班级列
    for (const cls of classList) {
      const teacherRaw = String(row[cls.col] || '').trim();
      if (!teacherRaw || teacherRaw === '') continue;
      if (/^\d+$/.test(teacherRaw)) continue;

      if (!classes[cls.name]) classes[cls.name] = {};
      if (!classes[cls.name][currentWeekday]) classes[cls.name][currentWeekday] = {};

      // 尝试分割教师名字（支持换行符和连在一起的情况）
      const teachers = trySplitTeachers(teacherRaw);
      
      if (teachers.length >= 2) {
        // 单周教师和双周教师
        classes[cls.name][currentWeekday][period] = {
          teacher: teachers[0],
          oddWeekTeacher: teachers[0],
          evenWeekTeacher: teachers[1],
          subject: col3 || '课后服务'
        };
      } else {
        // 只有一个教师
        classes[cls.name][currentWeekday][period] = {
          teacher: teachers[0],
          subject: col3 || '课后服务'
        };
      }
      entryCount++;
    }
  }

  if (entryCount === 0) return null;
  console.log(`[课后服务表] 解析成功: ${Object.keys(classes).length}个班级, ${entryCount}条记录`);
  return { classes };
}

function tryParseTotalSchedule(rawData) {
  // 第1步：找到星期标记行
  let weekdayRowIdx = -1;
  const weekdayColMap = {}; // { weekday: startCol }

  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const row = rawData[r];
    if (!row) continue;
    let found = 0;
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      for (const wd of WEEKDAYS) {
        if ((val === wd || val === '星期' + wd.replace('周', '')) && weekdayColMap[wd] === undefined) {
          weekdayColMap[wd] = c;
          found++;
        }
      }
    }
    if (found >= 3) { weekdayRowIdx = r; break; }
  }
  if (weekdayRowIdx === -1) {
    console.log('[总表解析] 未找到星期标记行(星期一~星期五)');
    return null;
  }
  console.log('[总表解析] 星期标记行: Row ' + (weekdayRowIdx + 1) + ', 列映射:', JSON.stringify(weekdayColMap));

  // 第2步：从星期行提取班级列表
  // 找到第一个星期的起始列和下一个星期的起始列，中间就是班级列
  const sortedWeekdays = WEEKDAYS.filter(wd => weekdayColMap[wd] !== undefined);
  if (sortedWeekdays.length < 1) return null;

  const firstWdStart = weekdayColMap[sortedWeekdays[0]];
  const secondWdStart = sortedWeekdays.length > 1 ? weekdayColMap[sortedWeekdays[1]] : rawData[0].length;
  const classCount = secondWdStart - firstWdStart;

  // 班级名在星期行的下一行（或下两行，跳过午别行）
  let classRowIdx = weekdayRowIdx + 1;
  let classRow = rawData[classRowIdx];
  // 如果下一行没有班级名（可能是午别行），再下一行
  if (!classRow || !classRow[firstWdStart] || String(classRow[firstWdStart]).trim() === '') {
    classRowIdx++;
    classRow = rawData[classRowIdx];
  }

  const classNames = [];
  for (let c = firstWdStart; c < firstWdStart + classCount; c++) {
    const val = classRow ? String(classRow[c] || '').trim() : '';
    if (val) classNames.push({ col: c - firstWdStart, name: val });
  }
  if (classNames.length === 0) {
    console.log('[总表解析] 班级列表为空, classRowIdx=' + classRowIdx);
    return null;
  }
  console.log('[总表解析] 班级行: Row ' + (classRowIdx + 1) + ', 班级数: ' + classNames.length);

  // 第3步：找到节次行（包含"第X节"标记的行，支持中文数字和阿拉伯数字）
  // 节次标题可能在col 0(A列)或col 1(B列)
  const cnNumMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  const periodRows = []; // [{ period, subjectRow, teacherRow }]
  for (let r = classRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row) continue;
    // 检查col 0和col 1中的节次标记
    const cellA = String(row[0] || '').trim();
    const cellB = String(row[1] || '').trim();
    const cellText = cellB || cellA; // 优先用B列，兼容A列
    // 匹配 "第一节" "第1节" "第 一 节" 等
    const periodMatch = cellText.match(/第\s*([一二三四五六七八九十\d]+)\s*节/);
    if (periodMatch) {
      const numStr = periodMatch[1];
      const period = cnNumMap[numStr] || parseInt(numStr);
      if (period && period >= 1 && period <= 10) {
        const subjectRow = r;
        const teacherRow = r + 1;
        if (teacherRow < rawData.length) {
          periodRows.push({ period: period, subjectRow: subjectRow, teacherRow: teacherRow });
        }
      }
    }
    // 也检查课后服务："课后服务1" "课后服务 2" 等
    const fwMatch = cellText.match(/课后服务\s*(\d+)/);
    if (fwMatch) {
      const fwNum = parseInt(fwMatch[1]);
      const fwPeriod = 6 + fwNum; // 课后服务1=第7节, 课后服务2=第8节...
      const fwSubjectRow = r;
      const fwTeacherRow = r + 1;
      if (fwTeacherRow < rawData.length) {
        periodRows.push({ period: fwPeriod, subjectRow: fwSubjectRow, teacherRow: fwTeacherRow });
      }
    }
  }
  if (periodRows.length === 0) {
    console.log('[总表解析] 未找到节次行(第X节)');
    return null;
  }
  console.log('[总表解析] 节次: ' + periodRows.map(function(p) { return '第' + p.period + '节(Row' + (p.subjectRow + 1) + ')'; }).join(', '));

  // 第4步：提取课表数据
  const classes = {};
  let entryCount = 0;

  for (const wd of sortedWeekdays) {
    const wdStartCol = weekdayColMap[wd];

    for (const cls of classNames) {
      const col = wdStartCol + cls.col;
      const className = cls.name;

      if (!classes[className]) classes[className] = {};
      if (!classes[className][wd]) classes[className][wd] = {};

      for (const pr of periodRows) {
        const subject = String((rawData[pr.subjectRow] || [])[col] || '').trim();
        const teacher = String((rawData[pr.teacherRow] || [])[col] || '').trim();

        if (!teacher || !subject) continue;
        if (subject === 'x' || subject === '#REF!' || teacher === '#REF!') continue;
        if (subject === '' || teacher === '') continue;
        // 跳过纯数字编码（如课后服务的编号数据）
        if (/^\d+$/.test(teacher)) continue;

        classes[className][wd][pr.period] = { teacher: teacher, subject: subject };
        entryCount++;
      }
    }
  }

  if (entryCount === 0) {
    console.log('[总表解析] 未提取到有效课表数据');
    return null;
  }

  console.log('[总表解析] 成功! ' + classNames.length + '个班级, ' + sortedWeekdays.length + '天, ' + periodRows.length + '节课, ' + entryCount + '条记录');
  return { classes: classes, format: 'total' };
}

function parseClassFormat(rawData, headers) {
  const classes = {};

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const className = String(row[0] || '').trim();
    const periodStr = String(row[1] || '').trim();

    if (!className || !periodStr) continue;

    // 解析节次
    const periodMatch = periodStr.match(/(\d+)/);
    if (!periodMatch) continue;
    const period = parseInt(periodMatch[1]);
    if (period < 1 || period > 11) continue;

    if (!classes[className]) {
      classes[className] = {};
    }

    // 从第3列开始，对应周一到周五
    for (let col = 2; col < headers.length && col - 2 < WEEKDAYS.length; col++) {
      const weekday = WEEKDAYS[col - 2];
      const cellValue = String(row[col] || '').trim();

      if (!cellValue || cellValue === '-' || cellValue === '—') continue;

      // 解析 "教师/科目" 格式
      let teacher = '', subject = '';
      if (cellValue.includes('/')) {
        const parts = cellValue.split('/');
        teacher = parts[0].trim();
        subject = parts[1] ? parts[1].trim() : '未知';
      } else if (cellValue.includes('、') || cellValue.includes(' ')) {
        // 可能是 "教师 科目" 格式
        const parts = cellValue.split(/[、\s]/);
        teacher = parts[0].trim();
        subject = parts[1] ? parts[1].trim() : '未知';
      } else {
        // 只有教师名
        teacher = cellValue;
        subject = '未知';
      }

      if (!teacher) continue;

      if (!classes[className][weekday]) {
        classes[className][weekday] = {};
      }
      classes[className][weekday][period] = { teacher, subject };
    }
  }

  return { classes, format: 'class' };
}

function parseTeacherFormat(rawData, headers) {
  const classes = {};

  // 找到时间列的起始位置
  // 表头格式: 教师, 科目, 班级, 周一1, 周一2, ..., 周二1, ...
  const timeColStart = 3;
  const timeHeaders = headers.slice(timeColStart);

  // 解析时间列对应的星期和节次
  const timeMapping = [];
  timeHeaders.forEach((h, idx) => {
    const hStr = String(h).trim();
    let weekday = null, period = null;

    // 匹配 "周一1" "周一第1节" 等
    for (const wd of WEEKDAYS) {
      if (hStr.includes(wd)) {
        weekday = wd;
        const periodMatch = hStr.match(/(\d+)/);
        if (periodMatch) period = parseInt(periodMatch[1]);
        break;
      }
    }

    // 如果没匹配到星期，按列顺序推断
    if (!weekday) {
      const dayIdx = Math.floor(idx / PERIODS.length);
      const periodIdx = idx % PERIODS.length;
      if (dayIdx < WEEKDAYS.length) {
        weekday = WEEKDAYS[dayIdx];
        period = periodIdx + 1;
      }
    }

    if (weekday && period) {
      timeMapping.push({ col: timeColStart + idx, weekday, period });
    }
  });

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const teacher = String(row[0] || '').trim();
    const subject = String(row[1] || '').trim();
    const classList = String(row[2] || '').trim();

    if (!teacher || !classList) continue;

    // 班级可能是逗号分隔的多个班级
    const classNames = classList.split(/[,，、\s]+/).filter(Boolean);

    timeMapping.forEach(({ col, weekday, period }) => {
      const cellValue = String(row[col] || '').trim();
      // 有课标记: "1", "✓", "√", "有", "是", 或班级名
      if (cellValue && cellValue !== '0' && cellValue !== '' && cellValue !== '-' && cellValue !== '无') {
        classNames.forEach(className => {
          if (!classes[className]) classes[className] = {};
          if (!classes[className][weekday]) classes[className][weekday] = {};
          if (!classes[className][weekday][period]) {
            classes[className][weekday][period] = { teacher, subject: subject || '未知' };
          }
        });
      }
    });
  }

  return { classes, format: 'teacher' };
}

// ========== 代课安排算法 ==========
function generateSubstitutions(scheduleData, leaves) {
  const substitutions = [];
  const allTeachers = getAllTeachers(scheduleData);

  // 按日期和节次遍历请假记录
  leaves.forEach(leave => {
    const dateStr = leave.date;
    const weekday = getWeekdayFromDate(dateStr);

    if (!WEEKDAYS.includes(weekday)) return; // 周末不处理

    // 全天请假：periods 为 null，遍历所有节次
    const periodsToCheck = leave.fullDay || leave.periods === null
      ? [1, 2, 3, 4, 5, 6]
      : leave.periods;

    periodsToCheck.forEach(period => {
      // 找出该教师在该时间段的所有课
      for (const [className, classSchedule] of Object.entries(scheduleData.classes)) {
        const entry = classSchedule[weekday] && classSchedule[weekday][period];
        if (!entry) continue;

        // 处理单双周教师
        let actualTeacher = entry.teacher;
        if (entry.oddWeekTeacher && entry.evenWeekTeacher) {
          // 根据日期判断是单周还是双周
          const weekNum = getWeekNumber(dateStr);
          actualTeacher = (weekNum % 2 === 1) ? entry.oddWeekTeacher : entry.evenWeekTeacher;
        }

        if (actualTeacher !== leave.teacher) continue;

        // 找到需要代课的课
        const substitute = findSubstitute(
          scheduleData, allTeachers, leaves, substitutions,
          leave.teacher, entry.subject, className, weekday, period, dateStr
        );

        substitutions.push({
          date: dateStr,
          weekday: weekday,
          period: period,
          class: className,
          subject: entry.subject,
          originalTeacher: leave.teacher,
          substituteTeacher: substitute || '未安排'
        });
      }
    });
  });

  // 排序：按日期、节次
  substitutions.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.period - b.period;
  });

  return substitutions;
}

function findSubstitute(scheduleData, allTeachers, leaves, currentSubs, leaveTeacher, subject, className, weekday, period, dateStr) {
  // 辅助函数：检查候选人是否可用
  function isAvailable(name) {
    // 检查1：该时间段是否有自己的课（排除当前班级）
    if (isTeacherBusy(scheduleData, name, weekday, period, className, dateStr)) return false;
    // 检查2：是否已请假
    if (isTeacherOnLeave(leaves, name, dateStr, weekday, period)) return false;
    // 检查3：是否已被安排代其他课
    if (isAlreadyAssigned(currentSubs, name, dateStr, period)) return false;
    return true;
  }

  // 辅助函数：获取教师在当前班级教的主要科目
  function getTeacherSubjectInClass(teacherName) {
    const classSchedule = scheduleData.classes[className];
    if (!classSchedule) return '其他';
    const weekNum = getWeekNumber(dateStr);
    // 优先科目列表（按重要性排序）
    const mainSubjects = ['语文', '数学', '英语', '道德与法治', '科学', '体育', '音乐', '美术', '信息', '健康', '劳动', '综合', '地方', '校本课程'];
    let foundSubjects = new Set();
    
    WEEKDAYS.forEach(day => {
      PERIODS.forEach(p => {
        const entry = classSchedule[day] && classSchedule[day][p];
        if (!entry || !entry.teacher) return;
        let actualTeacher = entry.teacher;
        if (entry.oddWeekTeacher && entry.evenWeekTeacher && weekNum > 0) {
          actualTeacher = (weekNum % 2 === 1) ? entry.oddWeekTeacher : entry.evenWeekTeacher;
        }
        if (actualTeacher === teacherName && entry.subject) {
          foundSubjects.add(entry.subject);
        }
      });
    });
    
    // 按主科目优先级返回第一个匹配的科目
    for (const subj of mainSubjects) {
      if (foundSubjects.has(subj)) return subj;
    }
    // 如果有其他科目（午休、课后服务、晚自习等），返回第一个
    if (foundSubjects.size > 0) return Array.from(foundSubjects)[0];
    return '其他';
  }

  // 辅助函数：按新优先级排序候选人
  function sortByPriority(teachers) {
    return teachers
      .filter(t => t !== leaveTeacher)
      .map(t => {
        const teacherSubject = getTeacherSubjectInClass(t);
        return {
          name: t,
          priority: getSubstitutePriority(teacherSubject)
        };
      })
      .sort((a, b) => a.priority - b.priority);
  }

  // 收集同班级所有任课老师（排除请假老师本人）
  const classSchedule = scheduleData.classes[className];
  const sameClassTeachers = new Set();
  if (classSchedule) {
    const weekNum = getWeekNumber(dateStr);
    WEEKDAYS.forEach(day => {
      PERIODS.forEach(p => {
        const entry = classSchedule[day] && classSchedule[day][p];
        if (!entry || !entry.teacher) return;
        let actualTeacher = entry.teacher;
        if (entry.oddWeekTeacher && entry.evenWeekTeacher && weekNum > 0) {
          actualTeacher = (weekNum % 2 === 1) ? entry.oddWeekTeacher : entry.evenWeekTeacher;
        }
        if (actualTeacher !== leaveTeacher) {
          sameClassTeachers.add(actualTeacher);
        }
      });
    });
  }

  // 第一步：在同班级老师中按优先级分组查找
  // 优先级1：语文/数学老师
  const tier1 = sortByPriority(Array.from(sameClassTeachers)).filter(c => c.priority === 1);
  for (const candidate of tier1) {
    if (isAvailable(candidate.name)) return candidate.name;
  }

  // 优先级2：英语老师
  const tier2 = sortByPriority(Array.from(sameClassTeachers)).filter(c => c.priority === 2);
  for (const candidate of tier2) {
    if (isAvailable(candidate.name)) return candidate.name;
  }

  // 优先级3：道德与法治/科学老师
  const tier3 = sortByPriority(Array.from(sameClassTeachers)).filter(c => c.priority === 3);
  for (const candidate of tier3) {
    if (isAvailable(candidate.name)) return candidate.name;
  }

  // 优先级4：同班其他科目老师
  const tier4 = sortByPriority(Array.from(sameClassTeachers)).filter(c => c.priority === 4);
  for (const candidate of tier4) {
    if (isAvailable(candidate.name)) return candidate.name;
  }

  // 第二步：本班教师全部有冲突，从其他班老师中按科目优先级选择
  const otherTeachers = allTeachers.filter(t => !sameClassTeachers.has(t) && t !== leaveTeacher);
  const otherCandidates = otherTeachers
    .map(t => ({
      name: t,
      priority: getSubstitutePriority(getTeacherSubjects(scheduleData, t)[0] || '其他')
    }))
    .sort((a, b) => a.priority - b.priority);
  for (const candidate of otherCandidates) {
    if (isAvailable(candidate.name)) return candidate.name;
  }

  return null;
}

// ========== 导出功能 ==========
function exportToExcel(substitutions) {
  if (!substitutions.length) {
    showToast('没有代课记录可导出', 'error');
    return;
  }

  const exportData = [
    ['日期', '星期', '节次', '班级', '科目', '原教师', '代课教师']
  ];

  substitutions.forEach(sub => {
    exportData.push([
      sub.date,
      sub.weekday,
      `第${sub.period}节`,
      sub.class,
      sub.subject,
      sub.originalTeacher,
      sub.substituteTeacher
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(exportData);
  // 设置列宽
  ws['!cols'] = [
    { wch: 12 }, { wch: 6 }, { wch: 8 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 10 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '代课安排表');
  XLSX.writeFile(wb, `代课安排表_${getTodayStr()}.xlsx`);
  showToast('导出成功', 'success');
}

// ========== Toast 通知 ==========
function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

// ========== UI 渲染 ==========
let currentPage = 'schedule';

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const section = document.getElementById(`page-${page}`);
  if (section) section.classList.add('active');

  const navBtn = document.querySelector(`[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  // 关闭移动端菜单
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');

  // 刷新页面数据
  if (page === 'schedule') renderSchedulePage();
  else if (page === 'leave') renderLeavePage();
  else if (page === 'substitute') renderSubstitutePage();
}

// ---------- 课表管理页 ----------
async function renderSchedulePage() {
  const scheduleData = await Store.getSchedule();
  const statsEl = document.getElementById('schedule-stats');
  const contentEl = document.getElementById('schedule-content');

  if (!scheduleData) {
    statsEl.innerHTML = '';
    contentEl.innerHTML = `
      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          导入课表
        </div>
        <div class="upload-area" id="upload-area">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p>点击或拖拽上传 Excel 课表文件</p>
          <p class="upload-hint">支持 .xlsx / .xls 格式</p>
        </div>
        <input type="file" id="file-input" accept=".xlsx,.xls" style="display:none" />
        <div style="margin-top: 16px;">
          <button class="btn btn-secondary btn-sm" onclick="showFormatHelp()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            查看导入格式说明
          </button>
          <button class="btn btn-secondary btn-sm" onclick="downloadTemplate()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载模板文件
          </button>
        </div>
      </div>
    `;
    bindUploadEvents();
    return;
  }

  // 有课表数据
  const teachers = getAllTeachers(scheduleData);
  const classNames = Object.keys(scheduleData.classes);
  const totalLessons = classNames.reduce((sum, cn) => {
    let count = 0;
    WEEKDAYS.forEach(day => {
      PERIODS.forEach(p => {
        if (scheduleData.classes[cn][day] && scheduleData.classes[cn][day][p]) count++;
      });
    });
    return sum + count;
  }, 0);

  statsEl.innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
        <div class="stat-info"><div class="stat-value">${teachers.length}</div><div class="stat-label">教师人数</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg></div>
        <div class="stat-info"><div class="stat-value">${classNames.length}</div><div class="stat-label">班级数量</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
        <div class="stat-info"><div class="stat-value">${totalLessons}</div><div class="stat-label">周课时总数</div></div>
      </div>
    </div>
  `;

  // 管理员企业微信通知设置
  const isAdmin = Role.isAdmin();
  const webhookUrl = WebhookNotify.getUrl();
  if (isAdmin) {
    statsEl.innerHTML += `
      <div class="card" style="margin-top: 16px;">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          企业微信通知设置
        </div>
        <div style="margin-bottom: 12px;">
          <label class="form-label">Webhook 地址</label>
          <input type="text" class="form-input" id="webhook-url" value="${webhookUrl}" placeholder="请输入企业微信群机器人 Webhook 地址" />
          <div class="form-hint" style="margin-top: 8px;">
             在企业微信群中添加机器人，复制 Webhook 地址粘贴到此处。教师提交请假后会自动通知管理员。
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" onclick="saveWebhookUrl()">保存设置</button>
          <button class="btn btn-secondary btn-sm" onclick="testWebhook()">发送测试消息</button>
          ${webhookUrl ? '<span style="color: #10B981; font-size: 13px; line-height: 32px;">✓ 已启用</span>' : '<span style="color: #64748B; font-size: 13px; line-height: 32px;">未配置</span>'}
        </div>
      </div>
    `;
  }

  // 渲染课表预览
  let tableHTML = `
    <div class="card">
      <div class="card-title" style="justify-content: space-between;">
        <span style="display:flex;align-items:center;gap:8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          课表预览
        </span>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="exportScheduleData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出课表数据
          </button>
          <button class="btn btn-secondary btn-sm" onclick="reUploadSchedule()">重新导入</button>
          <button class="btn btn-primary btn-sm" onclick="appendUploadSchedule()">追加导入</button>
          <button class="btn btn-danger btn-sm" onclick="clearAllData()">清空数据</button>
        </div>
      </div>
  `;

  // 班级选择器
  tableHTML += `
    <div style="margin-bottom: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
      ${classNames.map((cn, i) => `
        <button class="btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-secondary'}" onclick="showClassSchedule('${cn}', this)">${cn}</button>
      `).join('')}
    </div>
  `;

  // 默认显示第一个班级的课表
  if (classNames.length > 0) {
    tableHTML += renderClassTable(scheduleData, classNames[0]);
  }

  tableHTML += '</div>';
  contentEl.innerHTML = tableHTML;
}

function renderClassTable(scheduleData, className) {
  const classSchedule = scheduleData.classes[className];
  if (!classSchedule) return '<p>无数据</p>';

  let html = '<div class="table-wrapper schedule-grid"><table class="table">';
  html += '<thead><tr><th>节次</th>';
  WEEKDAYS.forEach(day => { html += `<th>${day}</th>`; });
  html += '</tr></thead><tbody>';

  PERIODS.forEach(period => {
    html += `<tr><td style="font-weight:600;white-space:nowrap;">第${period}节</td>`;
    WEEKDAYS.forEach(day => {
      const entry = classSchedule[day] && classSchedule[day][period];
      if (entry) {
        // 检查是否有单双周教师
        if (entry.oddWeekTeacher && entry.evenWeekTeacher) {
          html += `<td><div class="cell-info">
            <div class="cell-teacher" style="font-size:11px;">
              <span style="color:#4F46E5;">单:${entry.oddWeekTeacher}</span><br>
              <span style="color:#F59E0B;">双:${entry.evenWeekTeacher}</span>
            </div>
            <div class="cell-subject">${entry.subject}</div>
          </div></td>`;
        } else {
          html += `<td><div class="cell-info"><div class="cell-teacher">${entry.teacher}</div><div class="cell-subject">${entry.subject}</div></div></td>`;
        }
      } else {
        html += '<td><span style="color:#CBD5E1;">-</span></td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

async function showClassSchedule(className, btn) {
  const scheduleData = await Store.getSchedule();
  if (!scheduleData) return;

  // 更新按钮状态
  btn.parentElement.querySelectorAll('.btn').forEach(b => {
    b.className = 'btn btn-sm btn-secondary';
  });
  btn.className = 'btn btn-sm btn-primary';

  // 替换课表区域
  const card = btn.closest('.card');
  const existingTable = card.querySelector('.table-wrapper');
  if (existingTable) existingTable.remove();
  card.insertAdjacentHTML('beforeend', renderClassTable(scheduleData, className));
}

function reUploadSchedule() {
  // 动态创建 file input（课表已导入时页面上没有该元素）
  const existingInput = document.getElementById('file-input');
  if (existingInput) {
    existingInput.click();
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.id = 'file-input';
  input.accept = '.xlsx,.xls';
  input.style.display = 'none';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

// 追加导入：保留现有课表，将新文件数据合并进去
function appendUploadSchedule() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.style.display = 'none';
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file, true); // true = append mode
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}

async function clearAllData() {
  if (confirm('确定要清空所有数据吗？此操作不可撤销。')) {
    await Store.clearSchedule();
    await Store.clearSubstitutions();
    renderSchedulePage();
    showToast('数据已清空', 'success');
  }
}

// 导出课表数据为 JSON 文件（供其他教师导入）
async function exportScheduleData() {
  const scheduleData = await Store.getSchedule();
  if (!scheduleData) {
    showToast('没有课表数据可导出', 'error');
    return;
  }

  const dataStr = JSON.stringify(scheduleData);
  
  // 显示微信分享选项
  showWechatShareDialog(dataStr, '课表数据', 'schedule');
}

// 微信分享对话框
function showWechatShareDialog(dataStr, dataType, importType) {
  const compressed = btoa(encodeURIComponent(dataStr));
  const isLarge = compressed.length > 50000; // 约 50KB
  
  let html = `
    <div class="modal-overlay" id="wechat-share-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
      <div class="modal-content" style="background:#fff;border-radius:8px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;">
        <h3 style="margin-bottom:16px;font-size:18px;">📱 微信分享${dataType}</h3>
        
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
            <input type="radio" name="share-method" value="file" checked onchange="toggleShareMethod('${importType}')" />
            <strong>方式一：发送文件</strong>（推荐）
          </label>
          <div style="padding-left:24px;color:#64748B;font-size:13px;">
            <p>1. 点击下方按钮下载文件</p>
            <p>2. 通过微信发送给其他老师</p>
            <p>3. 其他老师接收后导入</p>
          </div>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
            <input type="radio" name="share-method" value="text" onchange="toggleShareMethod('${importType}')" />
            <strong>方式二：复制文本</strong>（适合小数据）
          </label>
          <div style="padding-left:24px;color:#64748B;font-size:13px;">
            <p>1. 点击复制按钮</p>
            <p>2. 粘贴到微信聊天</p>
            <p>3. 其他老师复制后导入</p>
          </div>
        </div>
        
        <div id="share-actions" style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="downloadForWechat('${importType}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载文件
          </button>
          <button class="btn btn-secondary" onclick="copyForWechat('${importType}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制文本
          </button>
        </div>
        
        <div style="margin-top:16px;padding:12px;background:#F8FAFC;border-radius:6px;font-size:12px;color:#64748B;">
           <strong>提示：</strong>微信支持发送 .txt 文件，接收后重命名为 .json 即可导入
        </div>
        
        <button class="btn btn-secondary" style="margin-top:16px;width:100%;" onclick="closeWechatShareDialog()">关闭</button>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', html);
  
  // 存储数据供后续使用
  window._shareData = { dataStr, compressed, importType };
}

function closeWechatShareDialog() {
  const modal = document.getElementById('wechat-share-modal');
  if (modal) modal.remove();
}

function toggleShareMethod(importType) {
  // 可以在这里根据选择显示不同的操作提示
}

function downloadForWechat(importType) {
  const { dataStr } = window._shareData;
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${importType}_${getTodayStr()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('文件已下载，请通过微信发送给其他老师', 'success');
}

function copyForWechat(importType) {
  const { compressed } = window._shareData;
  const text = `【${importType}】${compressed}`;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板，请粘贴到微信', 'success');
  }).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('已复制到剪贴板，请粘贴到微信', 'success');
  });
}

// 从微信文本导入
function importFromWechatText(text) {
  // 提取压缩数据
  const match = text.match(/【(课表数据 | 请假数据 | 代课安排)】(.+)/);
  if (!match) {
    showToast('无效的微信分享数据', 'error');
    return null;
  }
  
  const [, type, compressed] = match;
  try {
    const dataStr = decodeURIComponent(atob(compressed));
    return JSON.parse(dataStr);
  } catch (err) {
    showToast('解析数据失败：' + err.message, 'error');
    return null;
  }
}

// 导出请假数据为 JSON 文件
async function exportLeaveData() {
  const leaves = await Store.getLeaves();
  if (leaves.length === 0) {
    showToast('没有请假数据可导出', 'error');
    return;
  }

  const dataStr = JSON.stringify(leaves);
  showWechatShareDialog(dataStr, '请假数据', 'leave');
}

// 导入请假数据
function importLeaveData() {
  navigator.clipboard.readText().then(text => {
    if (text && text.includes('【请假数据】')) {
      if (confirm('检测到剪贴板中有请假数据，是否导入？')) {
        const data = importFromWechatText(text);
        if (data) {
          processImportData('leave', data);
        }
        return;
      }
    }
    showFileImportDialog('leave');
  }).catch(() => {
    showFileImportDialog('leave');
  });
}

// 导出代课安排数据
async function exportSubstitutionData() {
  const substitutions = await Store.getSubstitutions();
  if (substitutions.length === 0) {
    showToast('没有代课数据可导出', 'error');
    return;
  }

  const dataStr = JSON.stringify(substitutions);
  showWechatShareDialog(dataStr, '代课安排', 'substitution');
}

// 导入代课安排数据
function importSubstitutionData() {
  navigator.clipboard.readText().then(text => {
    if (text && text.includes('【代课安排】')) {
      if (confirm('检测到剪贴板中有代课数据，是否导入？')) {
        const data = importFromWechatText(text);
        if (data) {
          processImportData('substitution', data);
        }
        return;
      }
    }
    showFileImportDialog('substitution');
  }).catch(() => {
    showFileImportDialog('substitution');
  });
}

// 导入课表数据（教师使用）
async function importScheduleData() {
  // 先检查剪贴板是否有微信分享数据
  navigator.clipboard.readText().then(async text => {
    if (text && text.includes('【课表数据】')) {
      if (confirm('检测到剪贴板中有课表数据，是否导入？')) {
        const data = importFromWechatText(text);
        if (data) {
          // data 可能是 { classes: {...} } 格式或 records 数组格式
          if (data.classes) {
            await Store.saveSchedule(data);
          } else if (Array.isArray(data)) {
            await Store.clearSchedule();
            await Store.addScheduleRecords(data);
          }
          showToast('课表数据导入成功！', 'success');
          renderSchedulePage();
          if (document.getElementById('leave-page').classList.contains('active')) {
            renderLeavePage();
          }
        }
        return;
      }
    }
    // 否则显示文件选择
    showFileImportDialog('schedule');
  }).catch(() => {
    // 无法读取剪贴板，显示文件选择
    showFileImportDialog('schedule');
  });
}

// 显示文件导入对话框
function showFileImportDialog(importType) {
  let html = `
    <div class="modal-overlay" id="file-import-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
      <div class="modal-content" style="background:#fff;border-radius:8px;padding:24px;max-width:400px;width:90%;">
        <h3 style="margin-bottom:16px;font-size:18px;">📂 导入${importType === 'schedule' ? '课表' : importType === 'leave' ? '请假' : '代课安排'}数据</h3>
        
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
            <input type="radio" name="import-method" value="file" checked />
            <strong>从文件导入</strong>
          </label>
          <div style="padding-left:24px;color:#64748B;font-size:13px;">
            <p>选择微信接收的 .json 文件</p>
          </div>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer;">
            <input type="radio" name="import-method" value="text" />
            <strong>从文本导入</strong>
          </label>
          <div style="padding-left:24px;color:#64748B;font-size:13px;">
            <p>粘贴微信中的文本数据</p>
          </div>
        </div>
        
        <div style="display:flex;gap:12px;margin-top:20px;">
          <button class="btn btn-primary" style="flex:1;" onclick="executeImport('${importType}')">确定</button>
          <button class="btn btn-secondary" style="flex:1;" onclick="closeFileImportDialog()">取消</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', html);
  window._importType = importType;
}

function closeFileImportDialog() {
  const modal = document.getElementById('file-import-modal');
  if (modal) modal.remove();
}

function executeImport(importType) {
  const method = document.querySelector('input[name="import-method"]:checked').value;
  closeFileImportDialog();
  
  if (method === 'file') {
    // 文件导入
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.txt';
    input.style.display = 'none';
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          processImportData(importType, data);
        } catch (err) {
          showToast('解析文件失败：' + err.message, 'error');
        }
      };
      reader.readAsText(file);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  } else {
    // 文本导入
    const text = prompt('请粘贴微信中的文本数据：');
    if (text) {
      const data = importFromWechatText(text);
      if (data) {
        processImportData(importType, data);
      }
    }
  }
}

async function processImportData(importType, data) {
  if (importType === 'schedule') {
    if (!data.classes || Object.keys(data.classes).length === 0) {
      showToast('无效的课表数据', 'error');
      return;
    }
    await Store.clearSchedule();
    // 转换数据格式：将嵌套的 classes 结构转换为扁平的 records 数组
    const records = [];
    for (const [className, weekdays] of Object.entries(data.classes)) {
      for (const [weekday, periods] of Object.entries(weekdays)) {
        for (const [period, periodData] of Object.entries(periods)) {
          records.push({
            className: className,
            teacherName: periodData.teacher,
            subject: periodData.subject || '',
            weekday: weekday,
            period: parseInt(period),
            oddWeekTeacher: periodData.oddWeekTeacher || null,
            evenWeekTeacher: periodData.evenWeekTeacher || null
          });
        }
      }
    }
    if (records.length > 0) {
      await Store.addScheduleRecords(records);
    }
    showToast('课表数据导入成功！', 'success');
    renderSchedulePage();
    if (document.getElementById('leave-page').classList.contains('active')) {
      renderLeavePage();
    }
  } else if (importType === 'leave') {
    if (!Array.isArray(data)) {
      showToast('无效的请假数据', 'error');
      return;
    }
    const existingLeaves = await Store.getLeaves();
    const newLeaves = [...existingLeaves];
    data.forEach(leave => {
      const exists = newLeaves.some(l => 
        l.teacher === leave.teacher && 
        l.date === leave.date && 
        JSON.stringify(l.periods) === JSON.stringify(leave.periods)
      );
      if (!exists) newLeaves.push(leave);
    });
    // 批量添加请假记录
    for (const leave of data) {
      if (!newLeaves.some(l => l.id === leave.id)) {
        await Store.addLeave(leave.teacher || leave.teacherName, leave.date || leave.leaveDate, leave.weekday, leave.period, leave.reason, leave.fullDay || leave.isAllDay, leave.endDate);
      }
    }
    showToast(`成功导入 ${data.length} 条请假记录`, 'success');
    renderLeavePage();
  } else if (importType === 'substitution') {
    if (!Array.isArray(data)) {
      showToast('无效的代课数据', 'error');
      return;
    }
    // 批量添加代课记录
    await Store.addSubstitutions(data);
    showToast(`成功导入 ${data.length} 条代课记录`, 'success');
    renderSubstitutePage();
  }
}

// 切换到课表管理页面
function switchToSchedulePage() {
  document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));
  document.getElementById('schedule-page').classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-page="schedule"]').classList.add('active');
  renderSchedulePage();
}

// ---------- 上传事件 ----------
function bindUploadEvents() {
  const uploadArea = document.getElementById('upload-area');
  const fileInput = document.getElementById('file-input');
  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
  });
}

async function handleFileUpload(file, appendMode = false) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('请上传 .xlsx 或 .xls 格式的文件', 'error');
    return;
  }

  try {
    showToast('正在解析课表...', 'info');
    const newScheduleData = await parseExcelFile(file);

    if (!newScheduleData.classes || Object.keys(newScheduleData.classes).length === 0) {
      showToast('未能解析到有效课表数据，请检查文件格式', 'error');
      return;
    }

    if (appendMode) {
      // 追加模式：合并到现有数据
      const existingData = await Store.getSchedule();
      if (existingData && existingData.classes) {
        // 合并班级数据
        for (const [className, weekData] of Object.entries(newScheduleData.classes)) {
          if (!existingData.classes[className]) {
            existingData.classes[className] = {};
          }
          for (const [weekday, periodData] of Object.entries(weekData)) {
            if (!existingData.classes[className][weekday]) {
              existingData.classes[className][weekday] = {};
            }
            for (const [period, entry] of Object.entries(periodData)) {
              existingData.classes[className][weekday][period] = entry;
            }
          }
        }
        // 保存到数据库
        await saveScheduleToDatabase(existingData);
        const totalClasses = Object.keys(existingData.classes).length;
        showToast(`课表追加成功！现有 ${totalClasses} 个班级`, 'success');
      } else {
        await saveScheduleToDatabase(newScheduleData);
        showToast(`课表导入成功！共 ${Object.keys(newScheduleData.classes).length} 个班级`, 'success');
      }
    } else {
      // 覆盖模式
      await saveScheduleToDatabase(newScheduleData);
      showToast(`课表导入成功！共 ${Object.keys(newScheduleData.classes).length} 个班级`, 'success');
    }
    renderSchedulePage();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 保存课表数据到数据库
async function saveScheduleToDatabase(scheduleData) {
  if (!scheduleData || !scheduleData.classes) return;

  // 清空现有课表
  await Store.clearSchedule();

  // 转换并保存数据
  const records = [];
  for (const [className, weekdays] of Object.entries(scheduleData.classes)) {
    for (const [weekday, periods] of Object.entries(weekdays)) {
      for (const [period, periodData] of Object.entries(periods)) {
        if (periodData && periodData.teacher) {
          records.push({
            className: className,
            teacherName: periodData.teacher,
            subject: periodData.subject || '',
            weekday: weekday,
            period: parseInt(period),
            oddWeekTeacher: periodData.oddWeekTeacher || null,
            evenWeekTeacher: periodData.evenWeekTeacher || null
          });
        }
      }
    }
  }

  // 批量插入课表记录
  if (records.length > 0) {
    await Store.addScheduleRecords(records);
  }
}

// ---------- 请假登记页 ----------
async function renderLeavePage() {
  const leaves = await Store.getLeaves();
  const scheduleData = await Store.getSchedule();
  const teachers = scheduleData ? getAllTeachers(scheduleData) : [];
  const contentEl = document.getElementById('leave-content');

  let html = '';

  // 如果没有课表数据，显示导入提示
  if (!scheduleData) {
    html += `
      <div class="card">
        <div class="card-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          导入课表数据
        </div>
        <p style="color: #64748B; margin-bottom: 16px;">请先导入课表数据才能登记请假。您可以：</p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn btn-primary" onclick="importScheduleData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导入课表数据文件
          </button>
          <button class="btn btn-secondary" onclick="switchToSchedulePage()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            去课表管理页导入 Excel
          </button>
        </div>
        <div class="form-hint" style="margin-top: 12px;">
          💡 提示：管理员在课表管理页导入 Excel 后，可导出课表数据文件（JSON 格式），其他教师只需导入该文件即可。
        </div>
      </div>
    `;
  }

  // 请假登记表单
  html += `
    <div class="card">
      <div class="card-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
        登记请假
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">教师姓名</label>
          <input type="text" class="form-input" id="leave-teacher" placeholder="请输入教师姓名" autocomplete="off" />
          ${teachers.length > 0 ? `<div class="form-hint">已导入 ${teachers.length} 位教师，请直接输入姓名</div>` : '<div class="form-hint">请先导入课表，或手动输入教师姓名</div>'}
        </div>
        <div class="form-group">
          <label class="form-label">请假类型</label>
          <div class="radio-group" style="display: flex; gap: 16px; padding-top: 8px;">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="radio" name="leave-type" value="partial" checked onchange="toggleLeaveType()" /> 部分节次
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="radio" name="leave-type" value="full" onchange="toggleLeaveType()" /> 全天请假
            </label>
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">开始日期</label>
          <input type="date" class="form-input" id="leave-date-start" value="${getTodayStr()}" onchange="toggleMultiDay()" />
        </div>
        <div class="form-group">
          <label class="form-label">结束日期（同天则留空）</label>
          <input type="date" class="form-input" id="leave-date-end" placeholder="与开始日期相同" onchange="toggleMultiDay()" />
        </div>
      </div>
      <div class="form-group" id="period-selection">
        <label class="form-label">请假节次（可多选）</label>
        <div class="checkbox-group" id="leave-periods">
          ${PERIODS.map(p => `
            <div class="checkbox-item" data-period="${p}" onclick="togglePeriod(this)">
              ${p <= 6 ? '第' + p + '节' : ['午休', '课后服务1', '课后服务2', '课后服务3', '晚自习'][p - 7]}
            </div>
          `).join('')}
        </div>
        <div class="form-hint">全天请假无需选择节次，系统将自动安排该教师当天所有课程代课</div>
      </div>
      <div class="form-group">
        <label class="form-label">请假原因（选填）</label>
        <input type="text" class="form-input" id="leave-reason" placeholder="如：事假、病假等" />
      </div>
      <button class="btn btn-primary" onclick="addLeave()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        添加请假记录
      </button>
    </div>
  `;

  // 请假记录列表
  const isAdmin = Role.isAdmin();
  html += `
    <div class="card">
      <div class="card-title" style="justify-content: space-between;">
        <span style="display:flex;align-items:center;gap:8px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          请假记录 (${leaves.length})
        </span>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="exportLeaveData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出数据
          </button>
          <button class="btn btn-secondary btn-sm" onclick="importLeaveData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            导入数据
          </button>
          ${isAdmin && leaves.length > 0 ? '<button class="btn btn-danger btn-sm" onclick="clearAllLeaves()">清空记录</button>' : ''}
        </div>
      </div>
  `;

  if (leaves.length === 0) {
    html += `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <p>暂无请假记录</p>
      </div>
    `;
  } else {
    html += '<div class="table-wrapper"><table class="table">';
    html += `<thead><tr><th>教师</th><th>日期</th><th>星期</th><th>节次</th><th>原因</th>${isAdmin ? '<th>操作</th>' : ''}</tr></thead>`;
    html += '<tbody>';
    leaves.forEach((leave, idx) => {
      const weekday = getWeekdayFromDate(leave.date);
      const periodDisplay = leave.fullDay ? '全天' : (leave.periods ? leave.periods.map(p => `第${p}节`).join('、') : '全天');
      html += `<tr class="leave-mark">
        <td><strong>${leave.teacher}</strong></td>
        <td>${leave.date}</td>
        <td>${weekday}</td>
        <td>${periodDisplay}</td>
        <td>${leave.reason || '-'}</td>
        ${isAdmin ? `<td><button class="btn btn-danger btn-sm" onclick="removeLeave(${idx})">删除</button></td>` : ''}
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  html += '</div>';
  contentEl.innerHTML = html;
}

function togglePeriod(el) {
  el.classList.toggle('checked');
}

function toggleLeaveType() {
  const type = document.querySelector('input[name="leave-type"]:checked').value;
  const periodSection = document.getElementById('period-selection');
  if (type === 'full') {
    periodSection.style.display = 'none';
    // 取消所有节次选择
    periodSection.querySelectorAll('.checkbox-item').forEach(el => el.classList.remove('checked'));
  } else {
    periodSection.style.display = '';
  }
}

function toggleMultiDay() {
  // UI feedback only - end date is optional
}

async function addLeave() {
  const teacher = document.getElementById('leave-teacher').value.trim();
  const dateStart = document.getElementById('leave-date-start').value;
  const dateEnd = document.getElementById('leave-date-end').value;
  const reason = document.getElementById('leave-reason').value.trim();
  const leaveType = document.querySelector('input[name="leave-type"]:checked').value;
  const isFullDay = leaveType === 'full';

  // 获取选择的节次（全天请假时为空数组）
  let periods = [];
  if (!isFullDay) {
    const periodEls = document.querySelectorAll('#leave-periods .checkbox-item.checked');
    periods = Array.from(periodEls).map(el => parseInt(el.dataset.period));
  }

  if (!teacher) { showToast('请输入教师姓名', 'error'); return; }
  if (!dateStart) { showToast('请选择开始日期', 'error'); return; }
  if (!isFullDay && periods.length === 0) { showToast('请选择请假节次，或选择"全天请假"', 'error'); return; }

  // 计算日期范围
  const dates = [];
  const start = new Date(dateStart);
  const end = dateEnd ? new Date(dateEnd) : start;
  if (end < start) { showToast('结束日期不能早于开始日期', 'error'); return; }

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const weekday = getWeekdayFromDate(dateStr);
    if (WEEKDAYS.includes(weekday)) {
      dates.push(dateStr);
    }
  }

  if (dates.length === 0) {
    showToast('日期范围内没有工作日', 'error');
    return;
  }

  const leaves = await Store.getLeaves();
  let addedCount = 0;

  for (const date of dates) {
    const weekday = getWeekdayFromDate(date);
    const existing = leaves.findIndex(l => l.teacher === teacher && l.date === date);

    if (isFullDay) {
      // 全天请假：覆盖已有记录
      if (existing >= 0) {
        leaves[existing].periods = null; // null 表示全天
        leaves[existing].fullDay = true;
        if (reason) leaves[existing].reason = reason;
      } else {
        leaves.push({ teacher, date, periods: null, fullDay: true, reason });
      }
      addedCount++;
    } else {
      // 部分节次请假
      if (existing >= 0 && !leaves[existing].fullDay) {
        const merged = new Set([...leaves[existing].periods, ...periods]);
        leaves[existing].periods = Array.from(merged).sort((a, b) => a - b);
        if (reason) leaves[existing].reason = reason;
      } else {
        leaves.push({ teacher, date, periods: periods.sort((a, b) => a - b), fullDay: false, reason });
      }
      addedCount++;
    }
  }

  // 保存到数据库
  for (const leave of leaves) {
    if (!leave.id) {
      await Store.addLeave(leave.teacher, leave.date, getWeekdayFromDate(leave.date), leave.periods, leave.reason, leave.fullDay, leave.endDate);
    }
  }
  const msg = dates.length > 1
    ? `已提交 ${dates.length} 天的请假记录`
    : '请假已提交';
  showToast(Role.isTeacher() ? msg + '，请等待管理员安排代课' : msg, 'success');
  renderLeavePage();
}

async function removeLeave(idx) {
  const leaves = await Store.getLeaves();
  const leave = leaves[idx];
  if (leave && leave.id) {
    await Store.deleteLeave(leave.id);
  }
  leaves.splice(idx, 1);
  renderLeavePage();
  showToast('已删除', 'success');
}

async function clearAllLeaves() {
  if (confirm('确定要清空所有请假记录吗？')) {
    // 删除所有请假记录
    const leaves = await Store.getLeaves();
    for (const leave of leaves) {
      if (leave.id) {
        await Store.deleteLeave(leave.id);
      }
    }
    await Store.clearSubstitutions();
    renderLeavePage();
    showToast('请假记录已清空', 'success');
  }
}

// ---------- 代课安排页 ----------
async function renderSubstitutePage() {
  const scheduleData = await Store.getSchedule();
  const leaves = await Store.getLeaves();
  const substitutions = await Store.getSubstitutions();
  const contentEl = document.getElementById('substitute-content');

  let html = '';

  // 操作区
  html += `
    <div class="card">
      <div class="card-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14l2 2 4-4"/></svg>
        自动安排代课
      </div>
      <p style="font-size:13px;color:#64748B;margin-bottom:16px;">
        系统将根据请假记录和课表自动安排代课教师。代课优先级：语文 > 数学 > 英语 > 道德与法治 > 科学 > 其他科目老师。
      </p>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="runSubstitution()" ${!scheduleData || leaves.length === 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          开始安排
        </button>
        ${substitutions.length > 0 ? `
          <button class="btn btn-success" onclick="exportToExcelFromDB()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出 Excel
          </button>
          <button class="btn btn-secondary" onclick="exportSubstitutionData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            导出数据
          </button>
          <button class="btn btn-secondary" onclick="importSubstitutionData()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            导入数据
          </button>
          <button class="btn btn-secondary" onclick="window.print()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            打印
          </button>
        ` : ''}
      </div>
      ${!scheduleData ? '<p class="form-hint" style="color:#EF4444;margin-top:8px;">请先导入课表</p>' : ''}
      ${scheduleData && leaves.length === 0 ? '<p class="form-hint" style="color:#F59E0B;margin-top:8px;">请先登记教师请假</p>' : ''}
    </div>
  `;

  // 代课安排结果
  if (substitutions.length > 0) {
    // 统计
    const totalAssigned = substitutions.filter(s => s.substituteTeacher !== '未安排').length;
    const totalUnassigned = substitutions.filter(s => s.substituteTeacher === '未安排').length;

    html += `
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-icon blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="stat-info"><div class="stat-value">${substitutions.length}</div><div class="stat-label">代课总节数</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
          <div class="stat-info"><div class="stat-value">${totalAssigned}</div><div class="stat-label">已安排</div></div>
        </div>
        <div class="stat-card">
          <div class="stat-icon red"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <div class="stat-info"><div class="stat-value">${totalUnassigned}</div><div class="stat-label">未安排</div></div>
        </div>
      </div>
    `;

    // 表格形式展示
    html += `
      <div class="card" id="substitution-result">
        <div class="card-title" style="justify-content: space-between;">
          <span style="display:flex;align-items:center;gap:8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            代课安排表
          </span>
        </div>
        <div class="table-wrapper">
          <table class="table" id="sub-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>星期</th>
                <th>节次</th>
                <th>班级</th>
                <th>科目</th>
                <th>原教师</th>
                <th>代课教师</th>
              </tr>
            </thead>
            <tbody>
    `;

    substitutions.forEach(sub => {
      const isAssigned = sub.substituteTeacher !== '未安排';
      html += `<tr ${!isAssigned ? 'style="background:#FEF2F2;"' : ''}>
        <td>${sub.date}</td>
        <td>${sub.weekday}</td>
        <td>第${sub.period}节</td>
        <td>${sub.class}</td>
        <td><span class="tag tag-blue">${sub.subject}</span></td>
        <td><span style="color:#EF4444;">${sub.originalTeacher}</span></td>
        <td>${isAssigned
          ? `<span class="tag tag-green">${sub.substituteTeacher}</span>`
          : `<span class="tag tag-red">未安排</span>`
        }</td>
      </tr>`;
    });

    html += '</tbody></table></div></div>';
  } else {
    html += `
      <div class="card">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 14l2 2 4-4"/></svg>
          <p>点击"开始安排"生成代课安排表</p>
        </div>
      </div>
    `;
  }

  contentEl.innerHTML = html;
}

async function runSubstitution() {
  const scheduleData = await Store.getSchedule();
  const leaves = await Store.getLeaves();

  if (!scheduleData) { showToast('请先导入课表', 'error'); return; }
  if (leaves.length === 0) { showToast('请先登记请假', 'error'); return; }

  const substitutions = generateSubstitutions(scheduleData, leaves);
  await Store.clearSubstitutions();
  await Store.addSubstitutions(substitutions);

  const assigned = substitutions.filter(s => s.substituteTeacher !== '未安排').length;
  const unassigned = substitutions.filter(s => s.substituteTeacher === '未安排').length;

  showToast(`代课安排完成！共 ${substitutions.length} 节，已安排 ${assigned} 节${unassigned > 0 ? `，${unassigned} 节未安排` : ''}`, assigned > 0 ? 'success' : 'info');
  renderSubstitutePage();
}

// 从数据库获取数据并导出 Excel
async function exportToExcelFromDB() {
  const substitutions = await Store.getSubstitutions();
  exportToExcel(substitutions);
}

// ========== 格式说明 & 模板下载 ==========
function showFormatHelp() {
  const modal = document.getElementById('help-modal');
  modal.classList.add('show');
}

function closeHelpModal() {
  document.getElementById('help-modal').classList.remove('show');
}

function downloadTemplate() {
  // 创建模板数据
  const templateData = [
    ['班级', '节次', '周一', '周二', '周三', '周四', '周五'],
    ['一年级1班', '第1节', '张三/语文', '李四/数学', '王五/英语', '赵六/道德与法治', '孙七/科学'],
    ['一年级1班', '第2节', '李四/数学', '张三/语文', '赵六/道德与法治', '王五/英语', '张三/语文'],
    ['一年级1班', '第3节', '王五/英语', '孙七/科学', '张三/语文', '李四/数学', '李四/数学'],
    ['一年级1班', '第4节', '赵六/道德与法治', '王五/英语', '孙七/科学', '张三/语文', '王五/英语'],
    ['一年级2班', '第1节', '李四/数学', '张三/语文', '赵六/道德与法治', '王五/英语', '张三/语文'],
    ['一年级2班', '第2节', '张三/语文', '王五/英语', '李四/数学', '孙七/科学', '赵六/道德与法治'],
    ['一年级2班', '第3节', '孙七/科学', '赵六/道德与法治', '王五/英语', '张三/语文', '李四/数学'],
    ['一年级2班', '第4节', '王五/英语', '李四/数学', '张三/语文', '赵六/道德与法治', '孙七/科学'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(templateData);
  ws['!cols'] = [
    { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 12 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '课表模板');
  XLSX.writeFile(wb, '课表导入模板.xlsx');
  showToast('模板已下载', 'success');
}

// ========== 初始化 ==========
function init() {
  // 绑定导航
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
  });

  // 移动端汉堡菜单
  const hamburger = document.getElementById('hamburger-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('show');
    });
  }
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }

  // 初始化角色UI
  updateRoleUI();

  // 初始渲染
  switchPage('schedule');
}

document.addEventListener('DOMContentLoaded', init);
