/**
 * 课程表解析器 - 修正版
 * 正确理解：Row 2 头部有1列偏移（label列），数据从 col 1 开始，头部从 col 2 开始
 * 每2列=1个班（奇数col=科目，偶数col=教师）
 * 每5天 = 5 * 23 * 2 = 230 cols（含label列），实际约261 cols（含更多列用于周五特殊排法）
 */

const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';

// ============ 归一化班级名称 ============
function normalizeClass(name) {
    if (!name) return '';
    return String(name)
        .trim()
        .replace(/⑴/g, '（1）').replace(/⑵/g, '（2）')
        .replace(/⑶/g, '（3）').replace(/⑷/g, '（4）')
        .replace(/⑸/g, '（5）').replace(/⑹/g, '（6）')
        .replace(/⑺/g, '（7）').replace(/⑻/g, '（8）')
        .replace(/⑼/g, '（9）');
}

// ============ 解析总课表 ============
function parseMainTimetable(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['总表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Row 2 = 班级名行（含label列）
    // 结构: [col0=午别/节次, col1=一(1)名col, col2=一(1)师col, col3=一(2)名col, col4=一(2)师col, ...]
    // 头部: row[2] col 2 = "一（1）", col 4 = "一（2）", ...
    // 数据: row[5] col 1 = 一（1）科目, col 2 = 一（1）教师, col 3 = 一（2）科目, col 4 = 一（2）教师, ...

    const CLASSES_PER_DAY = 23;
    const COLS_PER_DAY = CLASSES_PER_DAY * 2; // 46 cols per day

    // 从 Row 2 提取班级名称（从 col 2 开始，每隔2列）
    const classes = [];
    const headerRow = data[2];
    for (let i = 0; i < CLASSES_PER_DAY; i++) {
        const className = normalizeClass(headerRow[2 + i * 2] || '');
        if (className) classes.push(className);
    }
    console.log('班级列表:', classes.join(', '));
    console.log('班级数量:', classes.length);

    // 节次信息：periodRow, periodNum, label, time
    const periods = [
        { periodRow: 5,  period: 1, label: '第一节', time: '8:20-9:00' },
        { periodRow: 7,  period: 2, label: '第二节', time: '9:10-9:50' },
        { periodRow: 10, period: 3, label: '第三节', time: '10:30-11:10' },
        { periodRow: 12, period: 4, label: '第四节', time: '11:20-12:00' },
        { periodRow: 19, period: 5, label: '第五节', time: '14:00-14:40' },
        { periodRow: 21, period: 6, label: '第六节', time: '14:50-15:30' },
    ];

    const days = ['星期一', '星期二', '星期三', '星期四', '星期五'];
    const result = {};

    // 对每一天、每一节、每一个班级提取数据
    for (let dayIdx = 0; dayIdx < days.length; dayIdx++) {
        const day = days[dayIdx];
        const dayStartCol = 1 + dayIdx * COLS_PER_DAY; // col 1, 47, 93, 139, 185

        result[day] = {};

        for (let classIdx = 0; classIdx < classes.length; classIdx++) {
            const className = classes[classIdx];
            result[day][className] = [];

            for (const p of periods) {
                const subjectRow = data[p.periodRow];
                const teacherRow = data[p.periodRow + 1];

                // 数据结构：col 0=节次label, col 1=一(1)科, col 2=一(1)师, col 3=一(2)科, col 4=一(2)师...
                const subjectCol = dayStartCol + classIdx * 2;
                const teacherCol = subjectCol + 1;

                const subject = String(subjectRow[subjectCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();
                const teacher = String(teacherRow[teacherCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();

                if (subject && !subject.includes('节') && !subject.includes('午')) {
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

    // 验证：打印第一个班级的数据
    const firstClass = classes[0];
    console.log(`\n验证 ${firstClass} 星期一:`, JSON.stringify(result['星期一']?.[firstClass]));

    return result;
}

// ============ 解析任课教师一览表（标准格式） ============
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
            if (subject && teacher && teacher !== '0') {
                teachers[subject] = teacher;
            }
        }
        if (className) result[className] = teachers;
    }
    return result;
}

// ============ 解析课后服务安排表 ============
function parseAfterSchool(filePath, sheetName = '3.3执行') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Row 2 = 表头: col 5 开始是班级名（一1, 一2, ...六4）
    const headerRow = data[2];
    const classCols = {};
    for (let col = 5; col < headerRow.length; col++) {
        const h = String(headerRow[col] || '').replace(/\n/g, '').trim();
        if (h && !h.includes('时间') && !h.includes('项目')) {
            classCols[h] = col;
        }
    }

    // 每天的起始行
    const dayStartRows = {};
    for (let i = 3; i < data.length; i++) {
        const firstCell = String(data[i][0] || '').replace(/\n/g, '').trim();
        for (const d of ['星期一', '星期二', '星期三', '星期四', '星期五']) {
            if (firstCell.includes(d) && !dayStartRows[d]) {
                dayStartRows[d] = i;
            }
        }
    }

    const result = {};
    const serviceTypes = ['午休', '课后服务', '晚自习'];

    for (const [day, startRow] of Object.entries(dayStartRows)) {
        result[day] = {};
        let i = startRow;

        while (i < data.length) {
            const row = data[i];
            const typeCell = String(row[3] || '').replace(/\n/g, '').trim();
            const timeCell = String(row[1] || '').replace(/\n/g, '').trim();

            let type = null;
            if (typeCell.includes('午休')) type = '午休';
            else if (typeCell.includes('服务') || typeCell.includes('课后')) type = '课后服务';
            else if (typeCell.includes('晚自习') || typeCell.includes('晚')) type = '晚自习';

            if (type) {
                if (!result[day][type]) result[day][type] = [];
                for (const [className, col] of Object.entries(classCols)) {
                    const teacher = String(row[col] || '').replace(/\n/g, '').trim();
                    if (teacher) {
                        result[day][type].push({ time: timeCell, teacher, className });
                    }
                }
            }

            // 检查是否到下一天
            const nextFirst = i + 1 < data.length
                ? String(data[i + 1][0] || '').replace(/\n/g, '').trim()
                : '';
            const isNewDay = ['星期一', '星期二', '星期三', '星期四', '星期五'].some(d => nextFirst.includes(d));
            if (isNewDay && nextFirst !== String(data[startRow][0] || '').replace(/\n/g, '').trim()) break;
            i++;
        }
    }

    return result;
}

// ============ 归并所有教师名单 ============
function extractAllTeachers(timetable, teacherAssignments, afterSchool) {
    const teachers = new Set();
    for (const day of Object.values(timetable)) {
        for (const classSchedule of Object.values(day)) {
            for (const slot of classSchedule) {
                if (slot.teacher && slot.teacher.length >= 2) {
                    teachers.add(slot.teacher);
                }
            }
        }
    }
    for (const cls of Object.values(teacherAssignments)) {
        for (const t of Object.values(cls)) {
            if (t) teachers.add(t);
        }
    }
    for (const day of Object.values(afterSchool)) {
        for (const type of Object.values(day)) {
            for (const s of type) {
                if (s.teacher) {
                    // 处理多人合管情况：龙光辉邰昌礼 → 拆分成两个人
                    s.teacher.split(/[\u4e00-\u9fa5]{2,}/).forEach(p => {
                        const t = p.trim();
                        if (t && t.length >= 2) teachers.add(t);
                    });
                }
            }
        }
    }
    return Array.from(teachers).sort();
}

// ============ 主程序 ============
console.log('=== 1. 解析总课表 ===');
const timetable = parseMainTimetable(BASE + '双井镇中心小学026年春季学期总课表.xlsx');

console.log('\n=== 2. 解析任课教师表 ===');
const teacherAssignments = parseTeacherAssignment(BASE + '双井镇中心小学2026年春季学期任课教师一览表.xlsx');
console.log('班级数:', Object.keys(teacherAssignments).length);

console.log('\n=== 3. 解析课后服务 ===');
const afterSchool = parseAfterSchool(BASE + '2026年春季学期课后服务安排表.xlsx');
console.log('课后服务天次:', Object.keys(afterSchool).length);

console.log('\n=== 4. 提取教师名单 ===');
const allTeachers = extractAllTeachers(timetable, teacherAssignments, afterSchool);
console.log('教师总数:', allTeachers.length);
console.log(allTeachers.join(', '));

// 打印示例
console.log('\n=== 示例：一（1）班 星期三 ===');
console.log(JSON.stringify(timetable['星期三']?.['一（1）'], null, 2));

// 保存完整数据
const output = {
    generatedAt: new Date().toISOString(),
    schoolName: '施秉县双井镇中心小学',
    semester: '2025-2026学年度第二学期',
    totalClasses: 23,
    timetable,
    teacherAssignments,
    afterSchoolService: afterSchool,
    allTeachers
};

fs.writeFileSync('C:\\Users\\HUA WEI\\Downloads\\school-substitute\\parsed_data.json', JSON.stringify(output, null, 2), 'utf8');
console.log('\n✅ 数据已保存到 parsed_data.json');
