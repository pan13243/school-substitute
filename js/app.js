// ==================== 数据存储层 ====================
const API_BASE = '';

const Store = {
  async getSchedule() {
    try {
      const res = await fetch(`${API_BASE}/api/schedule`);
      const json = await res.json();
      if (json.success && json.data && json.data.length > 0) {
        const data = json.data;
        const classes = {};
        const teachers = new Set();
        for (const record of data) {
          const { className, teacherName, subject, weekday, period, oddWeekTeacher, evenWeekTeacher, isAfterSchool } = record;
          if (!classes[className]) classes[className] = {};
          if (!classes[className][weekday]) classes[className][weekday] = {};
          classes[className][weekday][period] = {
            teacherName,
            subject: subject || '',
            oddWeekTeacher: oddWeekTeacher || null,
            evenWeekTeacher: evenWeekTeacher || null,
            isAfterSchool: isAfterSchool || false,
          };
          if (teacherName) teachers.add(teacherName);
          if (oddWeekTeacher) teachers.add(oddWeekTeacher);
          if (evenWeekTeacher) teachers.add(evenWeekTeacher);
        }
        return { classes, teachers: Array.from(teachers) };
      }
      return null;
    } catch (e) {
      console.warn('API getSchedule failed:', e);
      return null;
    }
  },
  async saveSchedule(data) {
    try {
      const records = [];
      for (const [className, weekData] of Object.entries(data.classes)) {
        for (const [weekday, periodData] of Object.entries(weekData)) {
          for (const [period, entry] of Object.entries(periodData)) {
            records.push({
              className,
              teacherName: entry.teacherName,
              subject: entry.subject || '',
              weekday,
              period: parseInt(period),
              oddWeekTeacher: entry.oddWeekTeacher || null,
              evenWeekTeacher: entry.evenWeekTeacher || null,
              isAfterSchool: entry.isAfterSchool || false,
            });
          }
        }
      }
      const res = await fetch(`${API_BASE}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      const json = await res.json();
      return json.success;
    } catch (e) {
      console.error('saveSchedule error:', e);
      return false;
    }
  },
  async clearSchedule() {
    try {
      await fetch(`${API_BASE}/api/schedule`, { method: 'DELETE' });
      return true;
    } catch (e) {
      return false;
    }
  },
  async getLeaves() {
    try {
      const res = await fetch(`${API_BASE}/api/leaves`);
      const json = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      return [];
    }
  },
  async addLeave(leave) {
    try {
      const res = await fetch(`${API_BASE}/api/leaves`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leave }),
      });
      const json = await res.json();
      return json.success;
    } catch (e) {
      return false;
    }
  },
  async clearLeaves() {
    try {
      await fetch(`${API_BASE}/api/leaves`, { method: 'DELETE' });
      return true;
    } catch (e) {
      return false;
    }
  },
  async getSubstitutes() {
    try {
      const res = await fetch(`${API_BASE}/api/substitutes`);
      const json = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      return [];
    }
  },
  async addSubstitutes(records) {
    try {
      const res = await fetch(`${API_BASE}/api/substitutes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      });
      const json = await res.json();
      return json.success;
    } catch (e) {
      return false;
    }
  },
  async clearSubstitutes() {
    try {
      await fetch(`${API_BASE}/api/substitutes`, { method: 'DELETE' });
      return true;
    } catch (e) {
      return false;
    }
  },
};

// ==================== 全局状态 ====================
let scheduleData = { classes: {}, teachers: [] };
let leaveRecords = [];
let substituteRecords = [];
let currentMode = 'teacher'; // 'teacher' or 'admin'
let currentPage = 'schedule'; // 'schedule', 'leave', 'substitute'

// ==================== 工具函数 ====================
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'];
const PERIODS_NORMAL = [1, 2, 3, 4, 5, 6];
const PERIODS_AFTER = [7, 8, 9, 10];

function showToast(msg, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  const colors = { success: '#10B981', error: '#EF4444', info: '#4F46E5', warning: '#F59E0B' };
  toast.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 24px;background:${colors[type] || colors.info};color:#fff;border-radius:6px;font-size:14px;z-index:10000;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:slideIn 0.3s ease;`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getWeekdayName(dateStr) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date(dateStr).getDay()];
}

// ==================== 课表解析 ====================
function parseScheduleData(jsonData) {
  if (!jsonData || jsonData.length < 3) return null;
  
  // 查找星期行
  let weekdayRow = -1;
  let weekdayMap = {};
  
  for (let r = 0; r < Math.min(jsonData.length, 10); r++) {
    const row = jsonData[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (['周一', '星期二', '周三', '星期四', '周五'].includes(val) || /^周[一二三四五]$/.test(val)) {
        if (weekdayRow === -1) weekdayRow = r;
        const dayName = val.replace('星期', '周');
        weekdayMap[dayName] = c;
      }
    }
  }
  
  if (weekdayRow === -1) return null;
  
  // 查找班级行（星期行的下一行）
  const classRow = weekdayRow + 1;
  if (classRow >= jsonData.length) return null;
  
  const classes = {};
  const teachers = new Set();
  const classRowData = jsonData[classRow] || [];
  
  // 找到班级列
  const classColumns = {};
  for (let c = 0; c < classRowData.length; c++) {
    const val = String(classRowData[c] || '').trim();
    if (val && /\d+年级|班|年级/.test(val)) {
      for (const [dayName, dayCol] of Object.entries(weekdayMap)) {
        if (Math.abs(c - dayCol) <= 2) {
          classColumns[dayName] = { col: c, className: val };
          break;
        }
      }
    }
  }
  
  // 如果没找到班级列，尝试从第一列获取
  if (Object.keys(classColumns).length === 0) {
    for (let r = classRow + 1; r < jsonData.length; r++) {
      const row = jsonData[r];
      if (!row || !row[0]) continue;
      const className = String(row[0]).trim();
      if (className && /\d+年级|班/.test(className)) {
        for (const [dayName, dayCol] of Object.entries(weekdayMap)) {
          if (!classes[className]) classes[className] = {};
          // 查找该班级的课程
          for (let periodRow = r; periodRow < Math.min(r + 10, jsonData.length); periodRow++) {
            const periodData = jsonData[periodRow];
            if (!periodData) continue;
            const periodVal = String(periodData[0] || '').trim();
            if (/^\d+$/.test(periodVal) || /第\d+节/.test(periodVal)) {
              const period = parseInt(periodVal.replace('第', '').replace('节', '')) || periodRow - r + 1;
              const teacherVal = String(periodData[dayCol] || '').trim();
              if (teacherVal && teacherVal !== '-') {
                if (!classes[className][dayName]) classes[className][dayName] = {};
                classes[className][dayName][period] = { teacherName: teacherVal, subject: '' };
                teachers.add(teacherVal);
              }
            }
          }
        }
        break;
      }
    }
  } else {
    // 按列解析
    for (const [dayName, info] of Object.entries(classColumns)) {
      const { col, className } = info;
      if (!classes[className]) classes[className] = {};
      
      for (let r = classRow + 1; r < jsonData.length; r++) {
        const row = jsonData[r];
        if (!row) continue;
        const periodVal = String(row[0] || '').trim();
        if (/^\d+$/.test(periodVal) || /第\d+节/.test(periodVal)) {
          const period = parseInt(periodVal.replace('第', '').replace('节', '')) || r - classRow;
          const teacherVal = String(row[col] || '').trim();
          if (teacherVal && teacherVal !== '-') {
            if (!classes[className][dayName]) classes[className][dayName] = {};
            classes[className][dayName][period] = { teacherName: teacherVal, subject: '' };
            teachers.add(teacherVal);
          }
        }
      }
    }
  }
  
  if (Object.keys(classes).length === 0) return null;
  return { classes, teachers: Array.from(teachers) };
}

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        var sheetName = workbook.SheetNames.find(function(s) { return s.indexOf('总表') >= 0; }) || workbook.SheetNames[0];
        console.log('[课表解析] 使用Sheet: ' + sheetName + ', 所有Sheet: ' + workbook.SheetNames.join(', '));
        var sheet = workbook.Sheets[sheetName];

        var merges = sheet['!merges'] || [];
        console.log('[课表解析] 合并单元格数量: ' + merges.length);
        for (var i = 0; i < merges.length; i++) {
          var merge = merges[i];
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

// ==================== 课表管理页面 ====================
function renderSchedulePage() {
  const container = document.getElementById('app-content');
  const teacherCount = scheduleData.teachers ? scheduleData.teachers.length : 0;
  const classCount = scheduleData.classes ? Object.keys(scheduleData.classes).length : 0;
  
  let periodCount = 0;
  if (scheduleData.classes) {
    for (const classData of Object.values(scheduleData.classes)) {
      for (const dayData of Object.values(classData)) {
        periodCount += Object.keys(dayData).length;
      }
    }
  }

  container.innerHTML = `
    <div class="page-header">
      <h1>课表管理</h1>
      <p class="page-desc">导入学校总课表，支持 Excel 格式（.xlsx / .xls）</p>
    </div>
    
    ${classCount > 0 ? `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${teacherCount}</div>
        <div class="stat-label">教师人数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${classCount}</div>
        <div class="stat-label">班级数量</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${periodCount}</div>
        <div class="stat-label">课程节数</div>
      </div>
    </div>
    
    <div class="action-bar">
      <button class="btn btn-primary" onclick="document.getElementById('file-input').click()">
        <span>📁</span> 重新导入课表
      </button>
      <button class="btn btn-danger" onclick="clearScheduleData()">
        <span>🗑️</span> 清空课表
      </button>
    </div>
    
    <div class="schedule-preview">
      <h3>课表预览</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>班级</th>
              <th>周一</th>
              <th>周二</th>
              <th>周三</th>
              <th>周四</th>
              <th>周五</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(scheduleData.classes).slice(0, 10).map(([className, weekData]) => `
              <tr>
                <td class="class-name">${escapeHtml(className)}</td>
                ${WEEKDAYS.map(day => {
                  const periods = weekData[day] || {};
                  const entries = Object.entries(periods).sort((a, b) => a[0] - b[0]);
                  return `<td>${entries.map(([p, e]) => `<div class="period-entry"><span class="period-num">${p}</span> ${escapeHtml(e.teacherName)}${e.subject ? ' - ' + escapeHtml(e.subject) : ''}</div>`).join('')}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${Object.keys(scheduleData.classes).length > 10 ? `<p class="text-muted" style="margin-top:12px;">仅显示前 10 个班级，共 ${Object.keys(scheduleData.classes).length} 个班级</p>` : ''}
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>暂无课表数据</h3>
      <p>请上传 Excel 格式的课表文件</p>
      <button class="btn btn-primary" onclick="document.getElementById('file-input').click()">
        <span>📁</span> 导入课表
      </button>
    </div>
    `}
    
    <input type="file" id="file-input" accept=".xlsx,.xls" style="display:none" onchange="handleFileUpload(event)">
  `;
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const loadingToast = document.createElement('div');
  loadingToast.id = 'loading-toast';
  loadingToast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 24px;background:#4F46E5;color:#fff;border-radius:6px;font-size:14px;z-index:10000;';
  loadingToast.textContent = '正在解析课表...';
  document.body.appendChild(loadingToast);
  
  try {
    const result = await parseExcelFile(file);
    if (result && result.classes) {
      scheduleData = result;
      
      // 保存到 Supabase
      const saved = await Store.saveSchedule(scheduleData);
      if (saved) {
        showToast(`课表导入成功！共 ${Object.keys(scheduleData.classes).length} 个班级`, 'success');
      } else {
        showToast('课表解析成功，但保存失败', 'warning');
      }
      
      renderSchedulePage();
    } else {
      showToast('未能解析到有效课表数据', 'error');
    }
  } catch (err) {
    showToast('导入失败：' + err.message, 'error');
  } finally {
    const loading = document.getElementById('loading-toast');
    if (loading) loading.remove();
    event.target.value = '';
  }
}

async function clearScheduleData() {
  if (!confirm('确定要清空所有课表数据吗？此操作不可恢复。')) return;
  
  const success = await Store.clearSchedule();
  if (success) {
    scheduleData = { classes: {}, teachers: [] };
    showToast('课表已清空', 'success');
    renderSchedulePage();
  } else {
    showToast('清空失败', 'error');
  }
}

// ==================== 请假登记页面 ====================
function renderLeavePage() {
  const container = document.getElementById('app-content');
  
  container.innerHTML = `
    <div class="page-header">
      <h1>请假登记</h1>
      <p class="page-desc">登记教师请假信息，系统将自动安排代课</p>
    </div>
    
    <div class="leave-form-card">
      <h3>新增请假</h3>
      <form id="leave-form" onsubmit="handleLeaveSubmit(event)">
        <div class="form-grid">
          <div class="form-group">
            <label>教师姓名 *</label>
            <select name="teacherName" required>
              <option value="">请选择教师</option>
              ${(scheduleData.teachers || []).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>请假日期 *</label>
            <input type="date" name="leaveDate" required value="${getToday()}">
          </div>
          <div class="form-group">
            <label>星期</label>
            <input type="text" name="dayOfWeek" readonly value="${getWeekdayName(getToday())}">
          </div>
          <div class="form-group">
            <label>请假节次 *</label>
            <select name="period" required>
              <option value="">请选择节次</option>
              ${[...PERIODS_NORMAL, ...PERIODS_AFTER].map(p => `<option value="${p}">第${p}节</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="grid-column: 1 / -1;">
            <label>请假原因</label>
            <input type="text" name="reason" placeholder="可选">
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">提交请假</button>
        </div>
      </form>
    </div>
    
    <div class="leave-list-card">
      <h3>请假记录 (${leaveRecords.length})</h3>
      ${leaveRecords.length > 0 ? `
      <div class="action-bar">
        <button class="btn btn-danger" onclick="clearAllLeaves()">清空所有请假记录</button>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>教师</th>
              <th>请假日期</th>
              <th>星期</th>
              <th>节次</th>
              <th>原因</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${leaveRecords.map(leave => `
              <tr>
                <td>${escapeHtml(leave.teacherName)}</td>
                <td>${formatDate(leave.leaveDate)}</td>
                <td>${escapeHtml(leave.dayOfWeek)}</td>
                <td>第${leave.period}节</td>
                <td>${escapeHtml(leave.reason || '-')}</td>
                <td>
                  <button class="btn btn-sm btn-danger" onclick="deleteLeave('${leave.id}')">删除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ` : '<p class="text-muted">暂无请假记录</p>'}
    </div>
  `;
}

async function handleLeaveSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  
  const leave = {
    id: generateId(),
    teacherName: formData.get('teacherName'),
    teacherId: formData.get('teacherName'),
    leaveDate: formData.get('leaveDate'),
    dayOfWeek: formData.get('dayOfWeek'),
    period: parseInt(formData.get('period')),
    reason: formData.get('reason'),
    createdAt: new Date().toISOString(),
  };
  
  const success = await Store.addLeave(leave);
  if (success) {
    leaveRecords.push(leave);
    showToast('请假登记成功', 'success');
    renderLeavePage();
  } else {
    showToast('登记失败', 'error');
  }
}

async function deleteLeave(id) {
  if (!confirm('确定删除这条请假记录吗？')) return;
  // 注意：当前 API 不支持单条删除，这里只从本地移除
  leaveRecords = leaveRecords.filter(l => l.id !== id);
  showToast('已删除（注意：云端数据需手动清空）', 'warning');
  renderLeavePage();
}

async function clearAllLeaves() {
  if (!confirm('确定清空所有请假记录吗？')) return;
  const success = await Store.clearLeaves();
  if (success) {
    leaveRecords = [];
    showToast('请假记录已清空', 'success');
    renderLeavePage();
  } else {
    showToast('清空失败', 'error');
  }
}

// ==================== 代课安排页面 ====================
function renderSubstitutePage() {
  const container = document.getElementById('app-content');
  
  container.innerHTML = `
    <div class="page-header">
      <h1>代课安排</h1>
      <p class="page-desc">根据请假记录自动安排代课教师</p>
    </div>
    
    <div class="action-bar">
      <button class="btn btn-primary" onclick="generateSubstitutions()">
        <span>⚡</span> 自动生成代课安排
      </button>
      <button class="btn btn-secondary" onclick="exportSubstitutes()">
        <span>📊</span> 导出 Excel
      </button>
      ${substituteRecords.length > 0 ? `
      <button class="btn btn-danger" onclick="clearAllSubstitutes()">
        <span>🗑️</span> 清空代课记录
      </button>
      ` : ''}
    </div>
    
    ${substituteRecords.length > 0 ? `
    <div class="substitute-list-card">
      <h3>代课安排记录 (${substituteRecords.length})</h3>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>请假教师</th>
              <th>代课教师</th>
              <th>班级</th>
              <th>日期</th>
              <th>星期</th>
              <th>节次</th>
              <th>科目</th>
            </tr>
          </thead>
          <tbody>
            ${substituteRecords.map(sub => `
              <tr>
                <td>${escapeHtml(sub.leaveTeacherName)}</td>
                <td class="substitute-teacher">${escapeHtml(sub.substituteTeacher)}</td>
                <td>${escapeHtml(sub.className)}</td>
                <td>${formatDate(sub.leaveDate)}</td>
                <td>${escapeHtml(sub.dayOfWeek)}</td>
                <td>第${sub.period}节</td>
                <td>${escapeHtml(sub.subject || '-')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : `
    <div class="empty-state">
      <div class="empty-icon">📝</div>
      <h3>暂无代课安排</h3>
      <p>请先登记请假记录，然后点击"自动生成代课安排"</p>
    </div>
    `}
  `;
}

function generateSubstitutions() {
  if (leaveRecords.length === 0) {
    showToast('没有请假记录，无法生成代课安排', 'warning');
    return;
  }
  
  if (!scheduleData.classes || Object.keys(scheduleData.classes).length === 0) {
    showToast('请先导入课表', 'warning');
    return;
  }
  
  const newSubstitutes = [];
  const teacherSchedule = {}; // 记录每位教师的已有安排
  
  // 构建教师时间表
  for (const [className, weekData] of Object.entries(scheduleData.classes)) {
    for (const [weekday, periodData] of Object.entries(weekData)) {
      for (const [period, entry] of Object.entries(periodData)) {
        const teacher = entry.teacherName;
        if (teacher) {
          const key = `${teacher}-${weekday}-${period}`;
          if (!teacherSchedule[key]) teacherSchedule[key] = [];
          teacherSchedule[key].push({ className, ...entry });
        }
      }
    }
  }
  
  // 为每个请假记录找代课教师
  for (const leave of leaveRecords) {
    const weekday = leave.dayOfWeek;
    const period = leave.period;
    const leaveDate = leave.leaveDate;
    
    // 找到请假教师在该时段教的班级
    const affectedClasses = [];
    for (const [className, weekData] of Object.entries(scheduleData.classes)) {
      const periodData = weekData[weekday] || {};
      const entry = periodData[period];
      if (entry && entry.teacherName === leave.teacherName) {
        affectedClasses.push({ className, subject: entry.subject });
      }
    }
    
    if (affectedClasses.length === 0) continue;
    
    // 为每个班级找代课教师
    for (const { className, subject } of affectedClasses) {
      const substitute = findSubstitute(leave.teacherName, weekday, period, teacherSchedule);
      if (substitute) {
        newSubstitutes.push({
          id: generateId(),
          leaveId: leave.id,
          leaveTeacherName: leave.teacherName,
          substituteTeacher: substitute,
          className,
          leaveDate,
          dayOfWeek: weekday,
          period,
          subject,
          createdAt: new Date().toISOString(),
        });
        
        // 更新教师时间表
        const key = `${substitute}-${weekday}-${period}`;
        if (!teacherSchedule[key]) teacherSchedule[key] = [];
        teacherSchedule[key].push({ className, teacherName: substitute });
      }
    }
  }
  
  if (newSubstitutes.length > 0) {
    substituteRecords.push(...newSubstitutes);
    Store.addSubstitutes(newSubstitutes);
    showToast(`成功生成 ${newSubstitutes.length} 条代课安排`, 'success');
    renderSubstitutePage();
  } else {
    showToast('未能找到合适的代课教师', 'warning');
  }
}

function findSubstitute(excludeTeacher, weekday, period, teacherSchedule) {
  const allTeachers = scheduleData.teachers || [];
  const candidates = allTeachers.filter(t => t !== excludeTeacher);
  
  // 按空闲优先级排序
  candidates.sort((a, b) => {
    const aBusy = (teacherSchedule[`${a}-${weekday}-${period}`] || []).length;
    const bBusy = (teacherSchedule[`${b}-${weekday}-${period}`] || []).length;
    return aBusy - bBusy;
  });
  
  return candidates[0] || null;
}

function exportSubstitutes() {
  if (substituteRecords.length === 0) {
    showToast('没有代课记录可导出', 'warning');
    return;
  }
  
  const data = substituteRecords.map(sub => ({
    '请假教师': sub.leaveTeacherName,
    '代课教师': sub.substituteTeacher,
    '班级': sub.className,
    '日期': formatDate(sub.leaveDate),
    '星期': sub.dayOfWeek,
    '节次': `第${sub.period}节`,
    '科目': sub.subject || '',
  }));
  
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '代课安排');
  XLSX.writeFile(wb, `代课安排_${getToday()}.xlsx`);
  showToast('导出成功', 'success');
}

async function clearAllSubstitutes() {
  if (!confirm('确定清空所有代课记录吗？')) return;
  const success = await Store.clearSubstitutes();
  if (success) {
    substituteRecords = [];
    showToast('代课记录已清空', 'success');
    renderSubstitutePage();
  } else {
    showToast('清空失败', 'error');
  }
}

// ==================== 导航与初始化 ====================
function switchPage(page) {
  currentPage = page;
  
  // 更新导航高亮
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  const activeNav = document.querySelector(`[data-page="${page}"]`);
  if (activeNav) activeNav.classList.add('active');
  
  // 渲染页面
  if (page === 'schedule') renderSchedulePage();
  else if (page === 'leave') renderLeavePage();
  else if (page === 'substitute') renderSubstitutePage();
}

async function initApp() {
  // 加载数据
  const [schedule, leaves, substitutes] = await Promise.all([
    Store.getSchedule(),
    Store.getLeaves(),
    Store.getSubstitutes(),
  ]);
  
  if (schedule) scheduleData = schedule;
  if (leaves) leaveRecords = leaves;
  if (substitutes) substituteRecords = substitutes;
  
  // 绑定导航事件
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
    });
  });
  
  // 绑定日期变化事件
  document.addEventListener('change', (e) => {
    if (e.target.name === 'leaveDate') {
      const dayOfWeekInput = e.target.form.querySelector('[name="dayOfWeek"]');
      if (dayOfWeekInput) {
        dayOfWeekInput.value = getWeekdayName(e.target.value);
      }
    }
  });
  
  // 渲染首页
  switchPage('schedule');
}

// 启动应用
document.addEventListener('DOMContentLoaded', initApp);
