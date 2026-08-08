/**
 * 诊断为什么 period 4 和 6 丢失
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

const CLASSES_21 = [
    '一（1）','一（2）','一（3）','二（1）','二（2）','二（3）',
    '三（1）','三（2）','三（3）','四（1）','四（2）','四（3）','四（4）',
    '五（1）','五（2）','五（3）','五（4）',
    '六（1）','六（2）','六（3）','六（4）'
];

const DAY_START = { '星期一': 2, '星期二': 23, '星期三': 44, '星期四': 65, '星期五': 86 };

// 直接检查 Row 15/16 (idx 14/15) 和 Row 25/26 (idx 24/25)
const probeRows = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26];
const probeDays = ['星期一', '星期四'];

function norm(s) { return String(s||'').replace(/\n/g,'').replace(/\s+/g,'').trim(); }
function isSubject(s) {
    if (!s || !s.length || s.length > 10) return false;
    const low = s.toLowerCase();
    if (low.includes('节')||low.includes('午')||low.includes('眼')||low.includes('操')||low.includes('课间')) return false;
    return true;
}

// 检查一（1）班（col 2）和五（1）班（col 36）在各行的值
for (const day of probeDays) {
    const dc = DAY_START[day];
    console.log('\n=== ' + day + ' (dayStart=' + dc + ') ===');
    for (const rowIdx of probeRows) {
        const row = data[rowIdx];
        const label = norm(row[1]); // label col
        const val_1_1 = norm(row[dc + 0]);  // 一（1）班
        const val_5_1 = norm(row[dc + 14]); // 五（1）班 (idx 14)
        if (val_1_1 || val_5_1 || label) {
            const flag1 = isSubject(val_1_1) ? '✅SUBJ' : '❌SKIP';
            const flag2 = isSubject(val_5_1) ? '✅SUBJ' : '❌SKIP';
            console.log(`  Row ${rowIdx+1} [label="${label.substring(0,12)}"] 一(1)=${flag1} "${val_1_1}" | 五(1)=${flag2} "${val_5_1}"`);
        }
    }
}

// 重点检查 Row 16/17 (idx 15/16) 和 Row 26/27 (idx 25/26) 的所有 col 值
for (const rowIdx of [15, 16, 25, 26]) {
    console.log('\n--- Row ' + (rowIdx+1) + ' 所有非空列 ---');
    for (let c = 0; c < 120; c++) {
        const v = data[rowIdx][c];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            const cls = CLASSES_21[c - DAY_START['星期一']] || '';
            console.log('  col ' + c + ' [' + cls + ']: "' + norm(v).substring(0,12) + '"');
        }
    }
}
