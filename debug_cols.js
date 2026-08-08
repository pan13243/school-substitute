/**
 * 精确调试：直接从XLSX读取行列数据，找到每一天的实际列范围
 */
const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const wb = XLSX.readFile(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];

console.log('Sheet ref:', ws['!ref']);
console.log('Sheet cols:', JSON.stringify(ws['!cols']));

// 直接用 range 读取
const range = XLSX.utils.decode_range(ws['!ref']);
console.log('Range:', range.s.r, 'to', range.e.r, 'rows;', range.s.c, 'to', range.e.c, 'cols');
console.log('Total cols:', range.e.c - range.s.c + 1);
console.log('Total rows:', range.e.r - range.s.r + 1);

// 读取前3行的非空单元格
console.log('\n=== Row 1 (index 0) 非空列 ===');
for (let col = 0; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 0, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        console.log(`  col ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(String(cell.v).substring(0,20))}`);
    }
}

console.log('\n=== Row 2 (index 1) 非空列 ===');
for (let col = 0; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 1, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        console.log(`  col ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(String(cell.v).substring(0,20))}`);
    }
}

console.log('\n=== Row 3 (index 2) 前50列 ===');
for (let col = 0; col <= Math.min(50, range.e.c); col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 2, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        console.log(`  col ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(String(cell.v).substring(0,20))}`);
    }
}

console.log('\n=== Row 6 (index 5) 前50列（前几个) ===');
for (let col = 0; col <= Math.min(50, range.e.c); col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 5, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        console.log(`  col ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(String(cell.v).substring(0,20))}`);
    }
}

// 检查 row1 中 "星期二" 的位置
console.log('\n=== 查找 "星期二" 和 "星期三" 位置 ===');
for (let col = 0; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 1, c: col})];
    if (cell && cell.v) {
        const v = String(cell.v);
        if (v.includes('星期二')) {
            console.log(`Row 1 "星期二" 在列 ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(v.substring(0,30))}`);
        }
        if (v.includes('星期三')) {
            console.log(`Row 1 "星期三" 在列 ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(v.substring(0,30))}`);
        }
        if (v.includes('星期四')) {
            console.log(`Row 1 "星期四" 在列 ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(v.substring(0,30))}`);
        }
        if (v.includes('星期五')) {
            console.log(`Row 1 "星期五" 在列 ${col} (${XLSX.utils.encode_col(col)}): ${JSON.stringify(v.substring(0,30))}`);
        }
    }
}

// 检查 row2 中 class names 的位置
console.log('\n=== 查找 row 2 中的班级名（一(1) 和 二(1)） ===');
for (let col = 0; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 2, c: col})];
    if (cell && cell.v) {
        const v = String(cell.v);
        if (v.includes('一（1）')) {
            console.log(`Row 2 "一（1）" 在列 ${col} (${XLSX.utils.encode_col(col)})`);
        }
        if (v.includes('二（1）')) {
            console.log(`Row 2 "二（1）" 在列 ${col} (${XLSX.utils.encode_col(col)})`);
        }
        if (v.includes('五（1）')) {
            console.log(`Row 2 "五（1）" 在列 ${col} (${XLSX.utils.encode_col(col)})`);
        }
    }
}

// 打印第3行（数据行）的列数
console.log('\n=== Row 6 (row index 5) 列数 ===');
let count = 0;
for (let col = 0; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 5, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && cell.v !== '') count++;
}
console.log('Non-empty cells in row 6:', count);

// 检查 row 3 (morning section row) 的列结构
console.log('\n=== Row 4 (row index 3) 非空列 ===');
for (let col = 0; col <= Math.min(100, range.e.c); col++) {
    const cell = ws[XLSX.utils.encode_cell({r: 3, c: col})];
    if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        console.log(`  col ${col}: ${JSON.stringify(String(cell.v).substring(0,20))}`);
    }
}
