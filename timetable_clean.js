/**
 * 课程表解析器 - 最终版 v2
 * 精确结构（从 debug_cols.js 确认）：
 * - Row 2 (index 1): 头部标签行。col 1="星期", col 2="星期一", col 23="星期二", col 44="星期三", col 65="星期四", col 86="星期五"
 * - Row 3 (index 2): 班级名称行。col 2=一(1), col 4=一(2), ..., col 44=一(1)重复, ...
 * - Row 5/6 (index 4/5): 第一节数据。col 1=节次label(merged), col 2=一(1)科, col 3=一(1)师, col 4=一(2)科, col 5=一(2)师...
 * - 每节 = 44 cols (22 classes * 2 cols: 科+师)，从 col 2 开始
 * - 周一: cols 2-45, 周二: cols 46-89, 周三: cols 90-133, 周四: cols 134-177, 周五: cols 178-221
 * - 节次行索引: 5=第一节科, 6=第一节师; 8=第二节科, 9=第二节师; 11=第三节科, 12=第三节师; 13=第四节科, 14=第四节师; 20=第五节科, 21=第五节师; 22=第六节科, 23=第六节师
 */
const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const OUT = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\';

function normalizeClass(name) {
    if (!name) return '';
    return String(name).trim()
        .replace(/⑴/g, '（1）').replace(/⑵/g, '（2）')
        .replace(/⑶/g, '（3）').replace(/⑶/g, '（3）')
        .replace(/⑷/g, '（4）').replace(/⑸/g, '（5）')
        .replace(/⑹/g, '（6）').replace(/⑺/g, '（7）')
        .replace(/⑻/g, '（8）').replace(/⑼/g, '（9）');
}

function parseMainTimetable(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['总表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 从 Row 3 (index 2) 提取班级名：col 2,4,6,... 共22个
    const CLASS_COUNT = 22;
    const classes = [];
    for (let i = 0; i < CLASS_COUNT; i++) {
        const name = normalizeClass(data[2][2 + i * 2] || '');
        if (name) classes.push(name);
    }
    console.log(`班级(${classes.length}): ${classes.join(', ')}`);

    // 每天起始列（数据从 col 2 开始，每个班占 2 列：subject, teacher）
    // Row 6: col 2=一(1)科, col 3=一(1)师, col 4=一(2)科, col 5=一(2)师...
    // 周一: 2, 周二: 46, 周三: 90, 周四: 134, 周五: 178
    const dayDataCols = [2, 46, 90, 134, 178]; // 周一二三四五
    const days = ['星期一', '星期二', '星期三', '星期四', '星期五'];

    // 节次信息: subjectRow, teacherRow (Row 6=节次label, Row 7=第一节科目, Row 8=第一节教师...)
    const periods = [
        { subRow: 7,  teaRow: 8,  period: 1, time: '8:20-9:00' },
        { subRow: 10, teaRow: 11, period: 2, time: '9:10-9:50' },
        { subRow: 13, teaRow: 14, period: 3, time: '10:30-11:10' },
        { subRow: 15, teaRow: 16, period: 4, time: '11:20-12:00' },
        { subRow: 22, teaRow: 23, period: 5, time: '14:00-14:40' },
        { subRow: 24, teaRow: 25, period: 6, time: '14:50-15:30' },
    ];

    const result = {};

    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const dayStartCol = dayDataCols[dayIdx];
        result[day] = {};

        for (let classIdx = 0; classIdx < classes.length; classIdx++) {
            const className = classes[classIdx];
            result[day][className] = [];

            for (const p of periods) {
                const subRow = data[p.subRow];
                const teaRow = data[p.teaRow];
                const subCol = dayStartCol + classIdx * 2;
                const teaCol = subCol + 1;

                const subject = String(subRow[subCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();
                const teacher = String(teaRow[teaCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();

                if (subject && !subject.includes('节') && !subject.includes('午') && subject.length > 0) {
                    result[day][className].push({
                        period: p.period,
                        subject,
                        teacher,
                        time: p.time
                    });
                }
            }
        }
    }

    return result;
}

function parseTeacherAssignment(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['任课教师一览表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const subjectCols = {
        1: '班主任', 2: '语文', 3: '数学', 4: '英语',
        5: '道德与法治', 6: '科学', 7: '音乐', 8: '美术',
        9: '体育', 10: '健康', 11: '综合实践', 12: '信息技术',
        13: '劳动教育', 14: '地方课程', 15: '校本课程'
    };

    const result = {};
    for (let i = 3; i < data.length; i++) {
        const row = data[i];
        const firstCell = String(row[0] || '');
        if (firstCell.includes('周课时') || firstCell.includes('备注') || !firstCell) continue;
        const className = normalizeClass(firstCell);
        const teachers = {};
        for (let col = 1; col < row.length; col++) {
            const subject = subjectCols[col];
            const teacher = String(row[col] || '').trim();
            if (subject && teacher && teacher !== '0') teachers[subject] = teacher;
        }
        if (className) result[className] = teachers;
    }
    return result;
}

function parseAfterSchool(filePath, sheetName = '3.3执行') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const headerRow = data[2];
    const classCols = {};
    for (let col = 5; col < headerRow.length; col++) {
        const h = String(headerRow[col] || '').replace(/\n/g, '').trim();
        if (h && !h.includes('时间') && !h.includes('项目')) classCols[h] = col;
    }

    const dayStartRows = {};
    for (let i = 3; i < data.length; i++) {
        const firstCell = String(data[i][0] || '').replace(/\n/g, '').trim();
        for (const d of ['星期一', '星期二', '星期三', '星期四', '星期五']) {
            if (firstCell.includes(d) && !dayStartRows[d]) dayStartRows[d] = i;
        }
    }

    const result = {};
    for (const [day, startRow] of Object.entries(dayStartRows)) {
        result[day] = {};
        let i = startRow;
        while (i < data.length) {
            const row = data[i];
            const typeCell = String(row[3] || '').replace(/\n/g, '').trim();
            const timeCell = String(row[1] || '').replace(/\n/g, '').trim();

            let type = null;
            if (typeCell.includes('午休')) type = '午休';
            else if (typeCell.includes('服务')) type = '课后服务';
            else if (typeCell.includes('晚自习') || typeCell.includes('晚')) type = '晚自习';

            if (type) {
                if (!result[day][type]) result[day][type] = [];
                for (const [className, col] of Object.entries(classCols)) {
                    const teacher = String(row[col] || '').replace(/\n/g, '').trim();
                    if (teacher) result[day][type].push({ time: timeCell, teacher, className });
                }
            }

            const nextFirst = i + 1 < data.length
                ? String(data[i + 1][0] || '').replace(/\n/g, '').trim() : '';
            const isNewDay = ['星期一', '星期二', '星期三', '星期四', '星期五']
                .some(d => nextFirst.includes(d));
            if (isNewDay && nextFirst !== String(data[startRow][0] || '').replace(/\n/g, '').trim()) break;
            i++;
        }
    }
    return result;
}

// ============ 主程序 ============
console.log('=== 解析总课表 ===');
const timetable = parseMainTimetable(BASE + '双井镇中心小学026年春季学期总课表.xlsx');

console.log('\n=== 解析任课教师表 ===');
const teacherAssignments = parseTeacherAssignment(BASE + '双井镇中心小学2026年春季学期任课教师一览表.xlsx');
console.log('班级数:', Object.keys(teacherAssignments).length);

console.log('\n=== 解析课后服务 ===');
const afterSchool = parseAfterSchool(BASE + '2026年春季学期课后服务安排表.xlsx');
console.log('天次:', Object.keys(afterSchool).join(', '));

// 验证
console.log('\n=== 验证结果 ===');
const allTeachers = new Set();
let totalSlots = 0;
for (const day of Object.values(timetable)) {
    for (const cls of Object.values(day)) {
        totalSlots += cls.length;
        for (const s of cls) {
            if (s.teacher) allTeachers.add(s.teacher);
        }
    }
}
for (const cls of Object.values(teacherAssignments)) {
    for (const t of Object.values(cls)) {
        if (t) allTeachers.add(t);
    }
}

console.log('课表总节次:', totalSlots);
console.log('教师总数:', allTeachers.size);
console.log('\n一（1）班 星期一:', JSON.stringify(timetable['星期一']?.['一（1）']));
console.log('\n一（1）班 星期二:', JSON.stringify(timetable['星期二']?.['一（1）']));
console.log('\n五（2）班 星期三:', JSON.stringify(timetable['星期三']?.['五（2）']));
console.log('\n四（2）班 星期三:', JSON.stringify(timetable['星期三']?.['四（2）']));

// 对比：任课表中一（1）班语文教师 vs 课表中星期一的语文教师
console.log('\n一（1）班 任课表语文教师:', teacherAssignments['一（1）']?.['语文']);
console.log('一（1）班 课表星期二第2节教师:', timetable['星期二']?.['一（1）']?.[1]?.teacher);

// 保存
const output = {
    generatedAt: new Date().toISOString(),
    schoolName: '施秉县双井镇中心小学',
    semester: '2025-2026学年度第二学期',
    totalClasses: 22,
    timetable,
    teacherAssignments,
    afterSchoolService: afterSchool,
    allTeachers: Array.from(allTeachers).sort()
};

fs.writeFileSync(OUT + 'parsed_data.json', JSON.stringify(output, null, 2), 'utf8');
console.log('\n✅ 数据已保存到 parsed_data.json');
