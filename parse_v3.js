/**
 * 课程表解析器 v3 - 最终确认版
 * 精确结构（从 peek2.js 确认）：
 * - 合并行：每节 = 2 rows (odd=subject, even=teacher)
 * - 每列 = 1个班（无分列），22 classes × 5 days
 * - 班级行: col 2=一(1), col 3=一(2), ..., col 22=六(4)（周内）
 * - 每周数据: 21 cols/day × 5 days = 105 cols → cols 2-106
 * - 每天起始: Mon=2, Tue=25, Wed=48, Thu=71, Fri=94
 * - 上午节次行: 6/7, 8/9, 11/12, 13/14, 下午节次行: 20/21, 22/23
 */
const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const OUT = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\';

function normalizeClass(name) {
    if (!name) return '';
    return String(name).trim()
        .replace(/⑴/g, '（1）').replace(/⑵/g, '（2）')
        .replace(/⑶/g, '（3）').replace(/⑷/g, '（4）')
        .replace(/⑸/g, '（5）').replace(/⑹/g, '（6）');
}

function clean(v) {
    return String(v || '').replace(/\n/g, '').replace(/\s+/g, '').trim();
}

// ============ 主课表 ============
function parseMainTimetable(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['总表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 班级列表：从 Row 3 (index 2) 的周内列（col 2-23）
    const CLASS_COUNT = 22;
    const classes = [];
    for (let i = 0; i < CLASS_COUNT; i++) {
        classes.push(normalizeClass(data[2][2 + i] || ''));
    }
    console.log('班级(' + classes.length + '): ' + classes.join(', '));

    // 每天起始数据列（col index）
    const dayStartCol = { '星期一': 2, '星期二': 25, '星期三': 48, '星期四': 71, '星期五': 94 };
    const days = ['星期一', '星期二', '星期三', '星期四', '星期五'];

    // 节次行（subjectRow, teacherRow, periodNum, time）
    // 上午4节，下午2节
    const periods = [
        { subRow: 6,  teaRow: 7,  period: 1, time: '8:20-9:00' },
        { subRow: 8,  teaRow: 9,  period: 2, time: '9:10-9:50' },
        { subRow: 11, teaRow: 12, period: 3, time: '10:30-11:10' },
        { subRow: 13, teaRow: 14, period: 4, time: '11:20-12:00' },
        { subRow: 20, teaRow: 21, period: 5, time: '14:00-14:40' },
        { subRow: 22, teaRow: 23, period: 6, time: '14:50-15:30' },
    ];

    const timetable = {};

    for (const day of days) {
        timetable[day] = {};
        const dayCol = dayStartCol[day];

        for (let classIdx = 0; classIdx < CLASS_COUNT; classIdx++) {
            const className = classes[classIdx];
            timetable[day][className] = [];

            for (const p of periods) {
                const subRow = data[p.subRow];
                const teaRow = data[p.teaRow];
                const col = dayCol + classIdx;

                const subject = clean(subRow[col]);
                const teacher = clean(teaRow[col]);

                if (subject && subject.length > 0 && !subject.includes('节') && !subject.includes('午')) {
                    timetable[day][className].push({
                        period: p.period,
                        subject,
                        teacher,
                        time: p.time
                    });
                }
            }
        }
    }

    // 验证
    console.log('\n验证:');
    console.log('一（1）班 星期一:', JSON.stringify(timetable['星期一']['一（1）']));
    console.log('一（2）班 星期一:', JSON.stringify(timetable['星期一']['一（2）']));
    console.log('一（1）班 星期二:', JSON.stringify(timetable['星期二']['一（1）']));
    console.log('六（4）班 星期三:', JSON.stringify(timetable['星期三']['六（4）']));
    console.log('五（1）班 星期五:', JSON.stringify(timetable['星期五']['五（1）']));

    // 统计
    let totalSlots = 0, withTeacher = 0;
    for (const day of Object.values(timetable)) {
        for (const cls of Object.values(day)) {
            for (const s of cls) { totalSlots++; if (s.teacher) withTeacher++; }
        }
    }
    console.log('总节次:', totalSlots, '有教师:', withTeacher);

    return timetable;
}

// ============ 任课教师表 ============
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

// ============ 课后服务 ============
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
console.log('=== 总课表 ===');
const timetable = parseMainTimetable(BASE + '双井镇中心小学026年春季学期总课表.xlsx');

console.log('\n=== 任课教师表 ===');
const teacherAssignments = parseTeacherAssignment(BASE + '双井镇中心小学2026年春季学期任课教师一览表.xlsx');
console.log('班级数:', Object.keys(teacherAssignments).length);

console.log('\n=== 课后服务 ===');
const afterSchool = parseAfterSchool(BASE + '2026年春季学期课后服务安排表.xlsx');
console.log('天次:', Object.keys(afterSchool).join(', '));

// 收集教师
const allTeachers = new Set();
for (const day of Object.values(timetable)) {
    for (const cls of Object.values(day)) {
        for (const s of cls) { if (s.teacher) allTeachers.add(s.teacher); }
    }
}
for (const cls of Object.values(teacherAssignments)) {
    for (const t of Object.values(cls)) { if (t) allTeachers.add(t); }
}
console.log('教师总数:', allTeachers.size);

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
