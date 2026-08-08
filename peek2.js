/**
 * 直接读每个单元格，不做任何假设
 * 检查每一列在每一行的值，搞清楚每列到底是科目还是教师
 */
const XLSX = require('xlsx');
const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];

// 直接读前15行前50列的原始值
console.log('=== 前10行前40列原始值 ===');
const startRow = 5; // index 5 = Row 6
for (let r = startRow; r < startRow + 8; r++) {
    const rowNum = r + 1;
    let hasData = false;
    const parts = [];
    for (let c = 0; c < 46; c++) {
        const cell = ws[XLSX.utils.encode_cell({r, c})];
        if (cell) {
            hasData = true;
            const v = String(cell.v).replace(/\n/g,' ').substring(0,12);
            parts.push(c + ':' + v);
        }
    }
    if (hasData) {
        console.log('Row ' + rowNum + ': ' + parts.join(' | '));
    }
}

// 检查 !merges
console.log('\n=== 合并单元格 ===');
if (ws['!merges']) {
    ws['!merges'].slice(0, 20).forEach(m => {
        console.log(JSON.stringify(m));
    });
}

// 打印班级行（Row 3, index 2）前30列
console.log('\n=== Row 3 (index 2) 前30列 ===');
for (let c = 0; c < 30; c++) {
    const cell = ws[XLSX.utils.encode_cell({r: 2, c})];
    if (cell) {
        console.log('  col ' + c + ' [' + XLSX.utils.encode_col(c) + ']: "' + String(cell.v||'').replace(/\n/g,' ') + '"');
    }
}

// 直接从 sheet_to_json 和 direct cell 读取对比
console.log('\n=== 直接读 Row 6 (index 5) col 0-50 ===');
const data_direct = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const row6 = data_direct[5];
console.log('row6 length:', row6.length);
for (let c = 0; c <= 50; c++) {
    if (row6[c] !== undefined && row6[c] !== null && row6[c] !== '') {
        console.log('  col ' + c + ' [' + XLSX.utils.encode_col(c) + ']: "' + String(row6[c]).replace(/\n/g,' ').substring(0,20) + '"');
    }
}
