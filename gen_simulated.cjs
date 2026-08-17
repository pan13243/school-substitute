// 模拟 exportSubKaoqin 生成一个 xlsx 文件，跟用户的模板对比
const XLSX = require('./node_modules/xlsx');

const arr = (n, v) => Array.from({length:n}, () => v);
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
// 模拟一条数据
const r = arr(16, '');
r[0]=1; r[1]='龙实忠'; r[2]=2026; r[3]=8; r[4]=14; r[5]='四';
r[6]='生病'; r[7]='病假'; r[9]=1;
r[10]='张烨'; r[11]='三(1)'; r[12]='第3节'; r[13]='数学'; r[14]=1;
rows.push(r);

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

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '教师考勤统计表');
XLSX.writeFile(wb, 'C:/Users/HUA WEI/Desktop/test_kaoqin_generated.xlsx');
console.log('Written: C:/Users/HUA WEI/Desktop/test_kaoqin_generated.xlsx');

// 重新读，看实际列位
const wb2 = XLSX.readFile('C:/Users/HUA WEI/Desktop/test_kaoqin_generated.xlsx');
const ws2 = wb2.Sheets['教师考勤统计表'];
console.log('Merges:');
(ws2['!merges'] || []).forEach(m => {
  console.log(`  (${m.s.r+1},${m.s.c+1})[${String.fromCharCode(65+m.s.c)}] -> (${m.e.r+1},${m.e.c+1})[${String.fromCharCode(65+m.e.c)}]`);
});
const data = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: '' });
console.log('Rows:');
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
