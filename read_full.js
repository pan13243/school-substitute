const XLSX = require('xlsx');

const wb = XLSX.readFile('E:\\课后服务\\调课表\\2026春\\双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

// Find all period rows (rows that contain time patterns like "8：20" or "节" or "午别")
console.log('=== 总表 完整节次结构分析 ===');
console.log('总行数:', data.length);

for (let i = 0; i < Math.min(50, data.length); i++) {
    const row = data[i];
    const nonEmpty = row.filter(c => c !== '' && c !== 0);
    if (nonEmpty.length > 0) {
        const firstFew = nonEmpty.slice(0, 5).map(c => String(c).substring(0, 30)).join(' | ');
        console.log(`Row ${i}: [${firstFew}] (non-empty cells: ${nonEmpty.length})`);
    }
}

// Show the teacher sheet structure
console.log('\n\n=== 任课教师一览表 完整结构 ===');
const wb2 = XLSX.readFile('E:\\课后服务\\调课表\\2026春\\双井镇中心小学2026年春季学期任课教师一览表.xlsx');
const ws2 = wb2.Sheets['任课教师一览表'];
const data2 = XLSX.utils.sheet_to_json(ws2, {header:1, defval:''});
for (let i = 0; i < data2.length; i++) {
    const row = data2[i];
    const nonEmpty = row.filter(c => c !== '' && c !== 0);
    if (nonEmpty.length > 0) {
        console.log(`Row ${i}: [${nonEmpty.slice(0,10).join(' | ')}]`);
    }
}

// Extract all unique teacher names from 总表
console.log('\n\n=== 所有教师名单（从总表提取）===');
const teachers = new Set();
for (let i = 0; i < data.length; i++) {
    const row = data[i];
    for (const cell of row) {
        if (typeof cell === 'string' && cell.length >= 2 && cell.length <= 5 && !cell.includes('节') && !cell.includes('午') && !cell.includes('星期') && !cell.includes('班') && !cell.match(/[\u4e00-\u9fa5]{6,}/)) {
            // Looks like a name
            teachers.add(cell.trim());
        }
    }
}
const sorted = Array.from(teachers).sort();
console.log('教师数量:', sorted.length);
console.log(sorted.join(', '));

// Check after-school service structure
console.log('\n\n=== 课后服务完整结构 ===');
const wb3 = XLSX.readFile('E:\\课后服务\\调课表\\2026春\\2026年春季学期课后服务安排表.xlsx');
const ws3 = wb3.Sheets['3.3执行'];
const data3 = XLSX.utils.sheet_to_json(ws3, {header:1, defval:''});
for (let i = 0; i < Math.min(20, data3.length); i++) {
    const row = data3[i];
    const nonEmpty = row.filter(c => c !== '' && c !== 0);
    if (nonEmpty.length > 0) {
        console.log(`Row ${i}: [${nonEmpty.slice(0,8).map(c => String(c).replace(/\n/g,' ')).join(' | ')}]`);
    }
}
