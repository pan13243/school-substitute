// 按照用户桌面模板（13列 A-M）生成 xlsx
const XLSX = require('./node_modules/xlsx');

const arr = (n, v) => Array.from({length:n}, () => v);

// 用户模板列结构（13列 A-M）:
// A=序号, B=有假教师, C=时间(年/月/日), D=星期, E=事由, F=假别,
// G=迟到、早退、旷工, H=天数, I=前去代课教师, J=班级, K=节次, L=科目, M=节数

const rows = [];
rows[0] = arr(13, ''); rows[0][0] = '施秉县双井镇小学、幼儿园教师考勤统计表';
rows[1] = arr(13, ''); rows[1][0] = '（2025—2026学年度第二学期）';
rows[2] = arr(13, ''); rows[2][0] = '  （2026年        月）';
rows[3] = arr(13, ''); rows[3][7] = '登记人：                       ';
rows[4] = arr(13, ''); rows[4][0] = '学校（盖章）：施秉县双井镇中心小学';
rows[4][7] = '审核人：                            ';
// 第6行（5）：表头
rows[5] = arr(13, '');
rows[5][0] = '序号';
rows[5][1] = '有假教师';
rows[5][2] = '时间';
rows[5][3] = '星期';
rows[5][4] = '事由';
rows[5][5] = '假别';
rows[5][6] = '迟到、早退、旷工';
rows[5][7] = '天数';
rows[5][8] = '前去代课教师';
rows[5][9] = '班级';
rows[5][10] = '节次';
rows[5][11] = '科目';
rows[5][12] = '节数';

// 模拟数据
const sample = [
  { teacher: '龙实忠', date: '2026-08-18', dow: '星期二', reason: '生病', leaveType: '病假', duration: 1, sub: '张烨', cls: '三(1)', period: '第3节', subject: '数学', only: false },
  { teacher: '吴君书', date: '2026-08-18', dow: '星期一', reason: '有事', leaveType: '事假', duration: 1, sub: '田如香', cls: '二(2)', period: '第3节', subject: '数学', only: false }
];
let idx = 1;
sample.forEach(s => {
  const [y, m, d] = s.date.split('-');
  const r = arr(13, '');
  r[0] = idx++;
  r[1] = s.teacher;
  r[2] = `${y}/${m}/${d}`;  // 时间合并到一格
  r[3] = s.dow;
  r[4] = s.reason;
  r[5] = s.leaveType;
  r[6] = '';
  r[7] = s.duration;
  r[8] = s.sub;
  r[9] = s.cls;
  r[10] = s.period;
  r[11] = s.subject;
  r[12] = 1;
  rows.push(r);
});

const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!merges'] = [
  {s:{r:0,c:0},e:{r:0,c:12}},
  {s:{r:1,c:0},e:{r:1,c:12}},
  {s:{r:2,c:0},e:{r:2,c:12}},
  {s:{r:3,c:7},e:{r:3,c:12}},
  {s:{r:4,c:0},e:{r:4,c:6}},
  {s:{r:4,c:7},e:{r:4,c:12}}
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '请假表');
XLSX.writeFile(wb, 'C:/Users/HUA WEI/Desktop/test_user_format.xlsx');

// 重新读，验证
const wb2 = XLSX.readFile('C:/Users/HUA WEI/Desktop/test_user_format.xlsx');
const ws2 = wb2.Sheets['请假表'];
console.log('=== 生成 merges ===');
(ws2['!merges'] || []).forEach(m => {
  console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
});
const data = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
data.forEach((r, i) => {
  const has = r.some(c => String(c).trim() !== '');
  if (has) {
    const cols = [];
    r.forEach((c, ci) => {
      if (String(c).trim() !== '') cols.push(`${String.fromCharCode(65+ci)}${i+1}=${JSON.stringify(c)}`);
    });
    console.log(`  R${i+1}: ${cols.join(' | ')}`);
  }
});
console.log('\nWritten: C:/Users/HUA WEI/Desktop/test_user_format.xlsx');
