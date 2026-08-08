/**
 * 课程表解析器 - 从原始Excel提取结构化数据
 * 支持：总课表.xlsx / 任课教师一览表.xlsx / 课后服务安排表.xlsx
 */

const XLSX = require('xlsx');
const path = require('path');

// ============ 1. 解析总课表 ============
function parseMainTimetable(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['总表'];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 找到各天起始列（扫描 Row 2 中的"星期X"文本）
    const headerRow = rawData[2]; // Row 2 = 班级名称行
    const dayStarts = {}; // { dayName: colIndex }
    const dayNames = ['星期一', '星期二', '星期三', '星期四', '星期五'];

    for (let col = 0; col < headerRow.length; col++) {
        const cell = String(headerRow[col] || '');
        for (const day of dayNames) {
            if (cell.includes(day) && !dayStarts[day]) {
                dayStarts[day] = col;
            }
        }
    }

    // 根据列位置重建课表结构
    // 每个班级占用2列（科目+教师），共23个班级
    const CLASS_COUNT = 23;
    const dataPerDay = 2 * CLASS_COUNT; // 46 cols per day

    const timetable = {}; // { day: { class: [{period, time, subject, teacher}] } }

    // 节次定义（Row索引 → 节次信息）
    // Row 5=第1节, Row 7=第2节, Row 10=第3节, Row 12=第4节, Row 19=第5节(下午), Row 21=第6节
    const periodRows = [
        { row: 5,  period: 1, label: '第一节', time: '8:20-9:00',    section: '上午' },
        { row: 7,  period: 2, label: '第二节', time: '9:10-9:50',    section: '上午' },
        { row: 10, period: 3, label: '第三节', time: '10:30-11:10',  section: '上午' },
        { row: 12, period: 4, label: '第四节', time: '11:20-12:00',  section: '上午' },
        { row: 19, period: 5, label: '第五节', time: '14:00-14:40',  section: '下午' },
        { row: 21, period: 6, label: '第六节', time: '14:50-15:30',  section: '下午' },
    ];

    for (const day of dayNames) {
        const startCol = dayStarts[day];
        if (!startCol) { console.warn(`未找到 ${day} 起始列`); continue; }

        const classData = {}; // { className: [] }

        for (const p of periodRows) {
            const subjectRow = rawData[p.row];
            const teacherRow = rawData[p.row + 1];

            for (let i = 0; i < CLASS_COUNT; i++) {
                const col = startCol + i * 2;
                const classCol = startCol + i * 2 + 1; // 班级名列在第二列

                const subject = String(subjectRow[col] || '').replace(/\n/g, '').trim();
                const teacher = String(teacherRow[col] || '').replace(/\n/g, '').trim();
                const className = String(subjectRow[classCol] || teacherRow[classCol] || '').replace(/[（）()]/g, c => c === '（' || c === '(' ? '⑴'.charAt(0) : '⑴'.charAt(1)).trim();

                if (subject && subject !== 'undefined') {
                    // 规范化班级名称
                    const normClass = normalizeClassName(headerRow[classCol] || '');

                    if (!classData[normClass]) classData[normClass] = [];
                    classData[normClass].push({
                        period: p.period,
                        subject: subject,
                        teacher: teacher,
                        time: p.time,
                        section: p.section
                    });
                }
            }
        }

        timetable[day] = classData;
    }

    return timetable;
}

// ============ 2. 解析任课教师一览表（标准格式，班级数=21） ============
function parseTeacherAssignment(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['任课教师一览表'];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const subjectCols = {
        1: '班主任',
        2: '语文',
        3: '数学',
        4: '英语',
        5: '道德与法治',
        6: '科学',
        7: '音乐',
        8: '美术',
        9: '体育',
        10: '健康',
        11: '综合实践',
        12: '信息技术',
        13: '劳动教育',
        14: '地方课程',
        15: '校本课程'
    };

    const result = {}; // { className: { subject: teacher } }

    for (let i = 3; i < rawData.length; i++) {
        const row = rawData[i];
        const firstCell = String(row[0] || '');

        // 跳过"周课时数"和"备注"行
        if (firstCell.includes('周课时') || firstCell.includes('备注') || !firstCell) continue;

        const className = normalizeClassName(firstCell);
        const teachers = {};

        for (let col = 1; col < row.length; col++) {
            const subject = subjectCols[col];
            const teacher = String(row[col] || '').trim();
            if (subject && teacher && teacher !== '0' && teacher !== 'undefined') {
                teachers[subject] = teacher;
            }
        }

        result[className] = teachers;
    }

    return result;
}

// ============ 3. 解析课后服务安排表 ============
function parseAfterSchool(filePath, sheetName = '3.3执行') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Row 2 = header: 时间, 项目, 一1, 一2, ...六4
    const headerRow = rawData[2];
    const classCols = {}; // { className: colIndex }
    for (let col = 5; col < headerRow.length; col++) {
        const h = String(headerRow[col] || '').trim();
        if (h) {
            classCols[h] = col;
        }
    }

    // 找每天的起始行
    const dayStartRows = {};
    const dayPatterns = ['星 期 一', '星\n期\n一', '星期一', '星 期 二', '星\n期\n二', '星期二'];
    let currentDay = null;

    for (let rowIdx = 3; rowIdx < rawData.length; rowIdx++) {
        const firstCell = String(rawData[rowIdx][0] || '').replace(/\n/g, '').trim();

        if (firstCell.includes('一') && (firstCell.includes('星') || firstCell === '一')) {
            dayStartRows['星期一'] = rowIdx;
            currentDay = '星期一';
        } else if (firstCell.includes('二') && firstCell.includes('星')) {
            dayStartRows['星期二'] = rowIdx;
            currentDay = '星期二';
        } else if (firstCell.includes('三') && firstCell.includes('星')) {
            dayStartRows['星期三'] = rowIdx;
            currentDay = '星期三';
        } else if (firstCell.includes('四') && firstCell.includes('星')) {
            dayStartRows['星期四'] = rowIdx;
            currentDay = '星期四';
        } else if (firstCell.includes('五') && firstCell.includes('星')) {
            dayStartRows['星期五'] = rowIdx;
            currentDay = '星期五';
        }
    }

    // 提取每天各节次数据
    const schedule = {};
    const serviceTypes = ['午休', '课后服务', '晚自习'];
    const timePatterns = {
        '午休': ['13：00', '13：00—13：50'],
        '课后服务1': ['15：40', '15：40—16：20'],
        '课后服务2': ['16：25', '16：25—17:05'],
        '课后服务3': ['17：10', '17:10—17:50'],
        '晚自习': ['19：30', '19:30—20:30']
    };

    for (const [day, startRow] of Object.entries(dayStartRows)) {
        const daySchedule = {};
        let rowIdx = startRow;

        while (rowIdx < rawData.length) {
            const row = rawData[rowIdx];
            const timeCell = String(row[1] || '').trim();
            const typeCell = String(row[3] || '').replace(/\n/g, '').trim();

            // 识别服务类型
            let serviceType = null;
            if (typeCell.includes('午休')) serviceType = '午休';
            else if (typeCell.includes('课后') || typeCell.includes('服务')) serviceType = '课后服务';
            else if (typeCell.includes('晚自习') || typeCell.includes('晚')) serviceType = '晚自习';

            if (serviceType) {
                for (const [className, col] of Object.entries(classCols)) {
                    const teacher = String(row[col] || '').replace(/\n/g, '').trim();
                    if (teacher) {
                        if (!daySchedule[serviceType]) daySchedule[serviceType] = [];
                        daySchedule[serviceType].push({ time: timeCell, teacher, className });
                    }
                }
            }

            // 检查是否到了下一天
            const nextFirstCell = rowIdx + 1 < rawData.length
                ? String(rawData[rowIdx + 1][0] || '').replace(/\n/g, '').trim()
                : '';
            if (nextFirstCell.includes('星') && nextFirstCell !== String(rawData[startRow][0] || '').replace(/\n/g, '').trim()) {
                break;
            }
            rowIdx++;
        }

        schedule[day] = daySchedule;
    }

    return schedule;
}

// ============ 工具函数 ============
function normalizeClassName(name) {
    if (!name) return '';
    let n = String(name).trim();
    // 一⑴ → 一（1） 统一格式
    n = n.replace(/⑴/g, '（1）').replace(/⑵/g, '（2）')
         .replace(/⑶/g, '（3）').replace(/⑷/g, '（4）')
         .replace(/⑸/g, '（5）').replace(/⑹/g, '（6）')
         .replace(/⑺/g, '（7）').replace(/⑻/g, '（8）')
         .replace(/⑼/g, '（9）');
    return n;
}

// ============ 主程序 ============
const BASE = 'E:\\课后服务\\调课表\\2026春\\';

const mainResult = parseMainTimetable(BASE + '双井镇中心小学026年春季学期总课表.xlsx');
const teacherResult = parseTeacherAssignment(BASE + '双井镇中心小学2026年春季学期任课教师一览表.xlsx');
const afterSchoolResult = parseAfterSchool(BASE + '2026年春季学期课后服务安排表.xlsx');

// 输出解析结果统计
console.log('=== 解析结果 ===');
console.log('班级数:', Object.keys(teacherResult).length);
console.log('班级列表:', Object.keys(teacherResult).join(', '));

console.log('\n=== 示例：星期一的课表 ===');
const classes = Object.keys(teacherResult);
const sampleClass = classes[0];
console.log(`${sampleClass}:`, JSON.stringify(mainResult['星期一']?.[sampleClass], null, 2));

console.log('\n=== 课后服务示例 ===');
console.log('星期一:', JSON.stringify(afterSchoolResult['星期一'], null, 2));

// 导出为 JSON
const fs = require('fs');
const output = {
    generatedAt: new Date().toISOString(),
    schoolName: '施秉县双井镇中心小学',
    semester: '2025-2026学年度第二学期',
    timetable: mainResult,
    teacherAssignments: teacherResult,
    afterSchoolService: afterSchoolResult
};

fs.writeFileSync(
    path.join(__dirname, 'parsed_data.json'),
    JSON.stringify(output, null, 2),
    'utf8'
);
console.log('\n✅ 解析完成，数据已保存到 parsed_data.json');
