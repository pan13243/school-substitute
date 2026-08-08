/**
 * 精确验证 periods 结构：label → teacher → subject
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

function norm(s) { return String(s||'').replace(/\n/g,'').replace(/\s+/g,'').trim(); }

// 自动检测：每行col1含"节"字的行（节次标签行）
const periodLabels = [];
for (let r = 0; r < data.length; r++) {
    const v = norm(data[r][1]);
    if (v.includes('节') && v.length < 25) {
        const r1 = norm(data[r+1][2]); // row+1, col 2
        const r2 = norm(data[r+2][2]); // row+2, col 2
        periodLabels.push({ row: r+1, label: v, row1Val: r1, row2Val: r2 });
    }
}
console.log('自动检测到的节次标签行:');
periodLabels.forEach(p => {
    console.log('  Row ' + p.row + ' ["' + p.label + '"] | r+1=' + p.row1Val + ' | r+2=' + p.row2Val);
});

// 正确的 periods 数组（0-based index = Excel row - 1）
console.log('\n=== 正确的 PERIODS 数组 ===');
const correctPeriods = periodLabels.map((p, i) => ({
    period: i + 1,
    labelRow: p.row - 1,     // 0-based
    teaRow: p.row,           // 0-based (label后1行)
    subRow: p.row + 1        // 0-based (label后2行)
}));
correctPeriods.forEach(p => {
    const sub = norm(data[p.subRow][2]);
    const tea = norm(data[p.teaRow][2]);
    console.log('Period ' + p.period + ': labelRow=' + (p.labelRow+1) + ' teaRow=' + (p.teaRow+1) + ' subRow=' + (p.subRow+1) + ' | sub=' + sub + ' tea=' + tea);
});

// 用自动检测的 periods 重新解析
console.log('\n=== 重新解析验证 ===');
const DAY_START = { '星期一': 2, '星期二': 23, '星期三': 44, '星期四': 65, '星期五': 86 };
const CLASSES_21 = [
    '一（1）','一（2）','一（3）','二（1）','二（2）','二（3）',
    '三（1）','三（2）','三（3）','四（1）','四（2）','四（3）','四（4）',
    '五（1）','五（2）','五（3）','五（4）',
    '六（1）','六（2）','六（3）','六（4）'
];
const TIME_MAP = {
    '第一节': '8:20-9:00', '第二节': '9:10-9:50',
    '第三节': '10:30-11:10', '第四节': '11:20-12:00',
    '第五节': '14:00-14:40', '第六节': '14:50-15:30'
};

const SKIP_KEYWORDS = ['节', '午', '眼', '操', '课间', '练字', '自习', '活动', '服务', '预备', '早读', '午餐'];
function isSubject(s) {
    if (!s || !s.length || s.length > 10) return false;
    const low = s.toLowerCase();
    for (const kw of SKIP_KEYWORDS) { if (low.includes(kw)) return false; }
    return true;
}
function getTime(label) {
    for (const [k, v] of Object.entries(TIME_MAP)) { if (label.includes(k)) return v; }
    return '';
}

const tt = {};
for (const [day, dc] of Object.entries(DAY_START)) {
    tt[day] = {};
    for (const cn of CLASSES_21) {
        tt[day][cn] = [];
        for (const p of correctPeriods) {
            const sub = norm(data[p.subRow][dc + CLASSES_21.indexOf(cn)]);
            const tea = norm(data[p.teaRow][dc + CLASSES_21.indexOf(cn)]);
            if (isSubject(sub)) {
                tt[day][cn].push({
                    period: p.period,
                    subject: sub,
                    teacher: tea,
                    time: getTime(p.labelRow !== undefined ? norm(data[p.labelRow][1]) : '')
                });
            }
        }
    }
}

console.log('一（1）班 星期一:', JSON.stringify(tt['星期一']['一（1）']));
console.log('一（1）班 星期二:', JSON.stringify(tt['星期二']['一（1）']));
console.log('六（4）班 星期三:', JSON.stringify(tt['星期三']['六（4）']));
console.log('五（1）班 星期四:', JSON.stringify(tt['星期四']['五（1）']));
console.log('四（2）班 星期五:', JSON.stringify(tt['星期五']['四（2）']));

let total = 0, hasTea = 0;
for (const d of Object.values(tt)) {
    for (const cls of Object.values(d)) {
        for (const s of cls) { total++; if (s.teacher) hasTea++; }
    }
}
console.log('总节次:', total, '| 有教师:', hasTea, '| 无教师:', total - hasTea);
