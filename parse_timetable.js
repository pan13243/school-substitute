const XLSX = require('xlsx');

// Load main schedule
const wb = XLSX.readFile('E:\\课后服务\\调课表\\2026春\\双井镇中心小学026年春季学期总课表.xlsx');
const ws = wb.Sheets['总表'];
const rawData = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});

// 解析课程总表
function parseMainSchedule(data) {
    const totalRows = data.length;
    console.log('总行数:', totalRows);
    
    // Row 2 contains day and class headers
    const headerRow = data[2];
    
    // Find day boundaries by scanning row 2 for day names
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五'];
    const dayBoundaries = {};
    
    for (const day of dayNames) {
        const indices = [];
        for (let col = 0; col < headerRow.length; col++) {
            if (String(headerRow[col]).includes(day)) {
                indices.push(col);
            }
        }
        if (indices.length > 0) {
            dayBoundaries[day] = indices;
            console.log(`${day}: 起始列=${indices[0]}, 出现次数=${indices.length}`);
        }
    }
    
    // Show more rows to understand full structure
    console.log('\n=== 各行首尾内容 ===');
    for (let i = 0; i < totalRows; i++) {
        const row = data[i];
        const nonEmpty = row.filter(c => c !== '' && c !== 0);
        if (nonEmpty.length > 0) {
            const first = String(nonEmpty[0]).substring(0, 40);
            const last = String(nonEmpty[nonEmpty.length - 1]).substring(0, 40);
            console.log(`Row ${i}: [${first}] ... [${last}] (${nonEmpty.length} cells)`);
        }
    }
    
    return dayBoundaries;
}

const dayBoundaries = parseMainSchedule(rawData);

// 解析任课教师表
console.log('\n\n=== 解析任课教师表 ===');
const wb2 = XLSX.readFile('E:\\课后服务\\调课表\\2026春\\双井镇中心小学2026年春季学期任课教师一览表.xlsx');
const ws2 = wb2.Sheets['任课教师一览表'];
const teacherData = XLSX.utils.sheet_to_json(ws2, {header:1, defval:''});

const subjects = ['班主任', '语文', '数学', '英语', '道德与法治', '科学', '音乐', '美术', '体育', '健康', '综合实践', '信息技术', '劳动教育', '地方课程', '校本课程'];
const classTeacherMap = {};

for (let i = 3; i < teacherData.length; i++) {
    const row = teacherData[i];
    const firstCell = String(row[0] || '');
    // Skip "周课时数" rows and "备注" rows
    if (firstCell.includes('周课时') || firstCell.includes('备注')) continue;
    if (!firstCell) continue;
    
    const className = firstCell;
    const classTeachers = {};
    for (let j = 1; j < row.length && j - 1 < subjects.length; j++) {
        const teacher = String(row[j] || '').trim();
        if (teacher && teacher !== '0') {
            classTeachers[subjects[j-1]] = teacher;
        }
    }
    classTeacherMap[className] = classTeachers;
    console.log(`${className}:`, JSON.stringify(classTeachers));
}

console.log('\n总班级数:', Object.keys(classTeacherMap).length);
