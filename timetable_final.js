/**
 * 课程表解析器 - 最终版
 * 关键发现：每列=1个班，无科目/教师区分；col 2=一(1)科, col 3=一(1)师, col 4=一(2)科, col 5=一(2)师...
 * 周一: col 2-67 (每section 22 cols * 3 sections + 1 label = 67)
 * 周二: col 69-134, 周三: col 136-201, 周四: col 203-268, 周五: col 270-335
 * 每section: [节次label, 科1, 师1, 科2, 师2, ..., 科22, 师22]
 */
const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';

// ============ 班级名归一化 ============
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

    // 从 Row 3（index 2）提取班级名称: col 2=一(1), col 4=一(2), col 6=一(3), col 8=二(1)...
    const classes = [];
    for (let i = 0; i < 22; i++) {
        const name = normalizeClass(data[2][2 + i * 2] || '');
        if (name) classes.push(name);
    }
    console.log(`班级(${classes.length}):`, classes.join(', '));

    // 节次定义（按 section 分组）
    // Section 1 (上午): periodRows = [5,7,10,12], label/col 1
    // Section 2 (下午): periodRows = [19,21], label/col 1
    // 每节占 2 cols: [科目, 教师]
    const sections = [
        { name: '上午', periodRows: [5, 7, 10, 12] },
        { name: '下午', periodRows: [19, 21] }
    ];

    // 每天起始 col（从 Row 6 数据行看，label col 在每 section 最左侧）
    // 关键：每 section = 1 label col + 22 classes * 2 cols = 45 cols
    // 周一: starts at col 2
    // 3 sections * 45 cols = 135 cols → 但实际上只有 66 cols 数据！
    // 重新测量：Row 6 非空列到 col 106 (107 cols total, col 0-106)
    // col 0=午别, col 1=第一节label, col 2=一(1)科, col 3=一(1)师, ...
    // 每 class = 2 cols (科+师)，col 2 开始
    // 22 classes = 44 data cols + 1 label = 45 cols per section
    // 
    // 实测 col 范围：
    // Row 5 非空: col 1(第一节) + col 2-45(22*2+1) + col 46-89 + col 90-133
    //           = 1 + 44 + 44 + 44 = 133 cols
    // Row 6 非空: col 2-105 = 104 cols... 
    // 让我精确测量！

    // 用精确的单元格读取方式
    const nonEmptyByRow = {};
    for (let r = 0; r < data.length; r++) {
        const row = data[r];
        let lastNonEmpty = 0;
        for (let c = 0; c < row.length; c++) {
            if (row[c] !== undefined && row[c] !== null && row[c] !== '') {
                lastNonEmpty = c;
            }
        }
        nonEmptyByRow[r] = lastNonEmpty;
    }
    console.log('\n每行最大非空列:', nonEmptyByRow);

    // 直接读取第一天的数据来验证结构
    // Row 5 col 1 = "第一节\n8:20..."
    // Row 6 col 2 = 一(1)科, col 3 = 一(1)师, col 4 = 一(2)科, col 5 = 一(2)师 ...
    // Row 7 col 1 = "第二节..."
    // Row 8 col 2 = 一(1)科, col 3 = 一(1)师 ...
    // Row 10 col 1 = "第三节..."
    // Row 12 col 1 = "第四节..."
    // Row 13 col 2 = 一(1)科, col 3 = 一(1)师 ...
    // Row 15 col 0 = "中午"
    // Row 19 col 1 = "第五节..." (下)
    // Row 20 col 2 = 一(1)科, col 3 = 一(1)师 ...
    // Row 21 col 1 = "第六节..."
    // Row 22 col 2 = 一(1)科, col 3 = 一(1)师 ...

    // 节次定义（所有节次的 row index）
    const allPeriods = [
        { row: 6,  period: 1, label: '第一节', time: '8:20-9:00' },
        { row: 8,  period: 2, label: '第二节', time: '9:10-9:50' },
        { row: 11, period: 3, label: '第三节', time: '10:30-11:10' },
        { row: 13, period: 4, label: '第四节', time: '11:20-12:00' },
        { row: 20, period: 5, label: '第五节', time: '14:00-14:40' },
        { row: 22, period: 6, label: '第六节', time: '14:50-15:30' },
    ];

    // 精确测量每一天的列范围（通过找 label 列的值）
    // 星期一的 label 列 col 1，节次名含 "第X节"
    // 星期二的第一节 label col 46 (45 + 1)
    // 每 section = 45 cols
    const DAY_SECTION_WIDTH = 45; // 1 label + 22*2
    const DAY_WIDTH = DAY_SECTION_WIDTH * 3; // 135 cols (3 sections per day)

    // 但实际宽度需要从数据中确定！
    // 找 "星期二" 的 label col → Row 1 (index 1) col 23 = "星期二"
    // 但数据行的星期二起始列应该从 Row 5/Row 6 中找 "第二节"
    // 
    // 结论：从 debug 数据，Row 6 col 46 = "第一节\n8：20..."
    // 说明星期二的第一节 label col = 46
    // 每 section = 45 cols
    // 
    // col 2 = 一(1)科(周一Section1)
    // col 46 = 一(1)科(周二Section1)
    // 
    // 所以：col = 2 + (dayIndex * 3 + sectionIndex) * 45
    // 
    // 或者更简单：每节课的 label col = dayStartCol + sectionOffset * 45
    // dayStartCol[0] = 1 (周一第一节 label)
    // dayStartCol[1] = 1 + 3*45 = 136 (周二第一节 label)
    // ... 不对，Row 1 显示星期二在 col 23

    // 让我重新精确测量：用"第一节"标签来定位每一天的第一节
    const dayLabelCols = {}; // { dayName: firstPeriodLabelCol }
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五'];

    for (let col = 0; col < 290; col++) {
        const cell = data[1][col]; // Row 1 (index 1)
        const cellStr = String(cell || '');
        for (const day of dayNames) {
            if (cellStr.includes(day)) {
                // 这是星期标签列，实际第一节 label 在 col + 1
                // 但数据行的"第一节" label col 是多少？
                // 从 Row 5 (index 4) 找：col 1 = "上      午"
                // Row 5 = index 4, not 5
            }
        }
    }

    // 让我直接验证：读 Row 5/6 的多个列
    const row6 = data[5]; // Row 6 (index 5)
    const row8 = data[7];
    const row20 = data[19];
    console.log('\nRow 6 (index 5) 列分布:');
    for (let c = 0; c < 140; c += 22) {
        console.log(`  col ${c}: ${JSON.stringify(String(row6[c]||'').substring(0,15))}, col ${c+1}: ${JSON.stringify(String(row6[c+1]||'').substring(0,15))}`);
    }

    // 提取每天的数据
    const timetable = {};

    // 用精确列位置：每 section 44 data cols (22 classes * 2) + 1 label = 45
    // 每天 3 sections = 135 cols
    // col 1 = 第一节 label (周一上), col 2 = 一(1)科, col 3 = 一(1)师...
    // 
    // 从 Row 6 数据验证：col 46 = 第一节 label = 周二上第一节
    // col 2 → col 45 = 周一上 (44 cols = 22 classes * 2)
    // col 46 → col 89 = 周二上 (44 cols)
    // col 90 → col 133 = 周三上 (44 cols)
    // col 134 → 午休
    // col ? → col ? = 周四上 (44 cols) → 但 Row 1 显示 col 65 = 星期四
    
    // 让我直接验证 col 90 的值
    console.log('\n关键列的值:');
    console.log('col 1:', JSON.stringify(String(data[5][1]||'').substring(0,20)));
    console.log('col 2:', JSON.stringify(String(data[5][2]||'')));
    console.log('col 3:', JSON.stringify(String(data[5][3]||'')));
    console.log('col 46:', JSON.stringify(String(data[5][46]||'').substring(0,20)));
    console.log('col 47:', JSON.stringify(String(data[5][47]||'')));
    console.log('col 90:', JSON.stringify(String(data[5][90]||'').substring(0,20)));
    console.log('col 91:', JSON.stringify(String(data[5][91]||'')));
    console.log('col 134:', JSON.stringify(String(data[5][134]||'').substring(0,20)));
    console.log('col 135:', JSON.stringify(String(data[5][135]||'')));

    // 根据验证结果，设置正确的列偏移
    const dayStartDataCols = {
        '星期一': 2,
        '星期二': 46,
        '星期三': 90,
        '星期四': 134,
        '星期五': 178
    };

    const timetableResult = {};

    for (const [day, startCol] of Object.entries(dayStartDataCols)) {
        timetableResult[day] = {};

        for (let classIdx = 0; classIdx < 22; classIdx++) {
            const className = classes[classIdx];
            timetableResult[day][className] = [];

            for (const p of allPeriods) {
                const row = data[p.row];
                const subjectCol = startCol + classIdx * 2;
                const teacherCol = subjectCol + 1;

                const subject = String(row[subjectCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();
                const teacher = String(row[teacherCol] || '').replace(/\n/g, '').replace(/\s+/g, '').trim();

                if (subject && !subject.includes('节') && !subject.includes('午') && subject !== '午') {
                    timetableResult[day][className].push({
                        period: p.period,
                        subject,
                        teacher,
                        time: p.time
                    });
                }
            }
        }
    }

    return timetableResult;
}

// ============ 解析任课教师一览表 ============
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

// ============ 解析课后服务 ============
function parseAfterSchool(filePath, sheetName = '3.3执行') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const headerRow = data[2];
    const classCols = {};
    for (let col = 5; col < headerRow.length; col++) {
        const h = String(headerRow[col] || '').replace(/\n/g, '').trim();
        if (h && !h.includes('时间') && !h.includes('项目')) {
            classCols[h] = col;
        }
    }

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
                    if (teacher) {
                        result[day][type].push({ time: timeCell, teacher, className });
                    }
                }
            }

            const nextFirst = i + 1 < data.length
                ? String(data[i + 1][0] || '').replace(/\n/g, '').trim()
                : '';
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
console.log('课后服务天次:', Object.keys(afterSchool).length);

console.log('\n=== 验证 ===');
const firstClass = classes[0];
console.log(`一（1）班 星期一:`, JSON.stringify(timetable['星期一']?.['一（1）']));
console.log(`一（2）班 星期二:`, JSON.stringify(timetable['星期二']?.['一（2）']));
console.log(`四（2）班 星期三:`, JSON.stringify(timetable['星期三']?.['四（2）']));

// 提取所有教师
const allTeachers = new Set();
for (const day of Object.values(timetable)) {
    for (const cls of Object.values(day)) {
        for (const s of cls) {
            if (s.teacher && s.teacher.length >= 2) allTeachers.add(s.teacher);
        }
    }
}
for (const cls of Object.values(teacherAssignments)) {
    for (const t of Object.values(cls)) {
        if (t) allTeachers.add(t);
    }
}
console.log('\n教师总数:', allTeachers.size);

// 保存数据
const output = {
    generatedAt: new Date().toISOString(),
    schoolName: '施秉县双井镇中心小学',
    semester: '2025-2026学年度第二学期',
    totalClasses: 23,
    timetable,
    teacherAssignments,
    afterSchoolService: afterSchool,
    allTeachers: Array.from(allTeachers).sort()
};

fs.writeFileSync(
    'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\parsed_data.json',
    JSON.stringify(output, null, 2),
    'utf8'
);
console.log('\n✅ 数据已保存');
