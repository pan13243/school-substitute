/**
 * 精确检查 rows 15-27，验证 periods 3-6 的行位置
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

function norm(s) { return String(s||'').replace(/\n/g,'').replace(/\s+/g,'').trim(); }

// 检查 rows 15-27 的 col 1 (label) 和 col 2 (一（1）班, dayStart=2)
console.log('=== Rows 15-27 col 1 (label) + col 2 (一（1）班) ===');
for (let r = 14; r <= 27; r++) {
    const label = norm(data[r][1]);
    const cls1 = norm(data[r][2]); // 一（1）班, col 2
    console.log('Row ' + (r+1) + ' [idx ' + r + ']: label="' + label.substring(0,15) + '" | 一(1)="' + cls1 + '"');
}

// 直接列出当前 PERIODS 数组对应的值
console.log('\n=== 当前 PERIODS 定义验证 ===');
const PERIODS_CURRENT = [
    { subRow: 7,  teaRow: 8,  period: 1 },
    { subRow: 10, teaRow: 11, period: 2 },
    { subRow: 13, teaRow: 14, period: 3 },
    { subRow: 16, teaRow: 17, period: 4 },
    { subRow: 22, teaRow: 23, period: 5 },
    { subRow: 25, teaRow: 26, period: 6 },
];
for (const p of PERIODS_CURRENT) {
    const subLabel = norm(data[p.subRow][1]);
    const subVal   = norm(data[p.subRow][2]);
    const teaLabel = norm(data[p.teaRow][1]);
    const teaVal   = norm(data[p.teaRow][2]);
    console.log('P' + p.period + ': subRow=' + (p.subRow+1) + ' label="' + subLabel.substring(0,12) + '" 一(1)="' + subVal + '" | teaRow=' + (p.teaRow+1) + ' label="' + teaLabel.substring(0,12) + '" 一(1)="' + teaVal + '"');
}

// 从数据中自动检测每节的标签行
console.log('\n=== 自动检测节次标签行 (col 1 含 "节") ===');
for (let r = 0; r < data.length; r++) {
    const v = norm(data[r][1]);
    if (v.includes('节') && v.length < 20) {
        const subVal = norm(data[r+1][2]);  // 下一行应该是subject
        const subVal2 = norm(data[r+2][2]); // 下下行是teacher
        console.log('Row ' + (r+1) + ' [idx ' + r + ']: "' + v.substring(0,15) + '" | 下1行: "' + subVal + '" | 下2行: "' + subVal2 + '"');
    }
}
