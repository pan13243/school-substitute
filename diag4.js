/**
 * 最清晰的诊断：直接用 cell 地址读，不依赖 header:1
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];

function cellAddr(row0, col0) { return XLSX.utils.encode_cell({r: row0, c: col0}); }
function cv(row0, col0) { return String(ws[cellAddr(row0, col0)]?.v || '').replace(/\n/g,'').replace(/\s+/g,''); }

// Row 3 (Excel row 3 = idx 2): 班级名（col C onwards = col 2 onwards）
console.log('=== Row 3 col C onwards (Excel) ===');
for (let col = 2; col <= 23; col++) {
    const v = cv(2, col);
    if (v) console.log('  col ' + col + ' [' + XLSX.utils.encode_col(col) + ']: ' + v);
}

// Row 6-7 for 一（1）班 (col C = col 2), 全部节次
console.log('\n=== 一（1）班 (col C=2) Row 6-30 ===');
for (let row = 5; row < 30; row++) {
    const label = cv(row, 1);
    const val = cv(row, 2);
    if (val || label) {
        console.log('  Row ' + (row+1) + ' label="' + label.substring(0,15) + '" val="' + val + '"');
    }
}

// 手动构造 CLASSES_21 并打印对应列
console.log('\n=== CLASSES_21 = Row 3 col 2,3,4,...,22 ===');
const CLASSES_21 = [];
for (let i = 0; i < 22; i++) {
    const v = cv(2, 2 + i);
    if (v) CLASSES_21.push(v);
}
console.log(CLASSES_21.join(', '));

// 关键：用 CLASSES_21 索引，col = dayStart + classIdx，打印一(1)班周二数据
const dayStart = { '星期一': 2, '星期二': 23, '星期三': 44, '星期四': 65, '星期五': 86 };
console.log('\n=== 一（1）班 各天 节次数据 (col 2, 23, 44, 65, 86) ===');
for (const [day, dc] of Object.entries(dayStart)) {
    console.log('--- ' + day + ' ---');
    for (let row = 5; row < 30; row++) {
        const label = cv(row, 1);
        const val = cv(row, dc); // 一（1）班 = idx 0 = dayStart + 0
        if (val || label) {
            console.log('  Row ' + (row+1) + ' label="' + label.substring(0,15) + '" val="' + val + '"');
        }
    }
}
