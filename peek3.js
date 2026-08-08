/**
 * 验证星期二列范围
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Row 3 (index 2): 班级名称，col 23 onwards
console.log('Row 3 cols 23-50:');
for (let c = 23; c <= 50; c++) {
    const v = data[2][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        console.log('  col ' + c + ': "' + String(v).replace(/\n/g,' ') + '"');
    }
}

// Row 6 (index 5): 第一节数据，col 25 onwards (Tuesday data)
console.log('\nRow 6 (index 5) col 25-50:');
for (let c = 25; c <= 50; c++) {
    const v = data[5][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        console.log('  col ' + c + ': "' + String(v).replace(/\n/g,' ').substring(0,15) + '"');
    }
}

// Row 7 (index 6): 第一节教师，col 25 onwards
console.log('\nRow 7 (index 6) col 25-50:');
for (let c = 25; c <= 50; c++) {
    const v = data[6][c];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
        console.log('  col ' + c + ': "' + String(v).replace(/\n/g,' ').substring(0,15) + '"');
    }
}

// 检查 Row 6 col 24 是否为空（周一和周二的间隙）
console.log('\nRow 6 cols 23-28:');
for (let c = 23; c <= 28; c++) {
    const v = data[5][c];
    console.log('  col ' + c + ': "' + String(v||'').replace(/\n/g,' ').substring(0,15) + '"');
}

// Row 2 (index 1) col 23 是什么？
console.log('\nRow 2 (index 1) col 23:', JSON.stringify(String(data[1][23]||'')));

// 对比：col 2 和 col 25 的值（应该都是一(1)）
console.log('\n对比：col 2 vs col 25');
console.log('Row 3 col 2:', JSON.stringify(String(data[2][2]||'')));
console.log('Row 3 col 25:', JSON.stringify(String(data[2][25]||'')));
console.log('Row 6 col 2:', JSON.stringify(String(data[5][2]||'')));
console.log('Row 6 col 25:', JSON.stringify(String(data[5][25]||'')));
console.log('Row 7 col 2:', JSON.stringify(String(data[6][2]||'')));
console.log('Row 7 col 25:', JSON.stringify(String(data[6][25]||'')));
