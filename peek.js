/**
 * 精确检查行6-9的列数据
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row 3 (index 2): 班级名称
const classes = [];
for (let i = 0; i < 22; i++) {
    classes.push(String(data[2][2 + i * 2] || '').trim());
}
console.log('班级:', classes.join(', '));

// 检查 Row 6 (index 5) 非空列
console.log('\n--- Row 6 (index 5) 非空列 ---');
for (let c = 0; c <= 50; c++) {
    const v = data[5][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        const cls = classes[Math.floor((c-2)/2)] || '';
        console.log('  col ' + c + ' [' + cls + ']: "' + String(v).replace(/\n/g,' ').substring(0,20) + '"');
    }
}

// 检查 Row 7 (index 6) 非空列
console.log('\n--- Row 7 (index 6) 非空列 ---');
for (let c = 0; c <= 50; c++) {
    const v = data[6][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        const cls = classes[Math.floor((c-2)/2)] || '';
        console.log('  col ' + c + ' [' + cls + ']: "' + String(v).replace(/\n/g,' ').substring(0,20) + '"');
    }
}

// 检查 Row 8 (index 7) 非空列
console.log('\n--- Row 8 (index 7) 非空列 ---');
for (let c = 0; c <= 50; c++) {
    const v = data[7][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        const cls = classes[Math.floor((c-2)/2)] || '';
        console.log('  col ' + c + ' [' + cls + ']: "' + String(v).replace(/\n/g,' ').substring(0,20) + '"');
    }
}

// 验证：从 Row 7 读 col 2 的值，应该是教师
console.log('\n--- Row 6 col 2 = 第一节科目? = ' + String(data[5][2]||'').replace(/\n/g,' '));
console.log('--- Row 7 col 2 = 第一节教师? = ' + String(data[6][2]||'').replace(/\n/g,' '));
console.log('--- Row 8 col 2 = 第二节科目? = ' + String(data[7][2]||'').replace(/\n/g,' '));

// 再检查 Row 9
console.log('\n--- Row 9 (index 8) 非空列 ---');
for (let c = 0; c <= 50; c++) {
    const v = data[8][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        const cls = classes[Math.floor((c-2)/2)] || '';
        console.log('  col ' + c + ' [' + cls + ']: "' + String(v).replace(/\n/g,' ').substring(0,20) + '"');
    }
}
