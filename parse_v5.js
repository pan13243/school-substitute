/**
 * 课程表解析器 v5 - 精确版
 * 精确行结构（从 peek2.js）：
 * - Row 6 (idx 5) = 第一节 label（节次时间在 col 1）
 * - Row 7 (idx 6) = 第一节 科目（一~六各科）
 * - Row 8 (idx 7) = 第一节 教师
 * - Row 9 (idx 8) = 第二节 label
 * - Row 10 (idx 9) = 第二节 科目
 * - Row 11 (idx 10) = 9:50-10:30 课间操（跳过）
 * - Row 12 (idx 11) = 第三节 科目
 * - Row 13 (idx 12) = 第三节 教师
 * - Row 14 (idx 13) = 第四节 label
 * - Row 15 (idx 14) = 第四节 科目
 * - Row 16 (idx 15) = 第四节 教师
 * - [午休 rows 16-19]
 * - Row 21 (idx 20) = 第五节 label
 * - Row 22 (idx 21) = 第五节 科目
 * - Row 23 (idx 22) = 第五节 教师
 * - Row 24 (idx 23) = 第六节 label
 * - Row 25 (idx 24) = 第六节 科目
 * - Row 26 (idx 25) = 第六节 教师
 *
 * 每节 = 2 行（subject行在label后1行，teacher行在subject后1行）
 * subject行col 1含"第X节"，teacher行col 1无内容或空白
 */
const XLSX = require('xlsx');
const fs = require('fs');

const BASE = 'E:\\课后服务\\调课表\\2026春\\';
const OUT  = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\';

function norm(s) { return String(s||'').replace(/\n/g,'').replace(/\s+/g,'').trim(); }

// 21个班级（从 Row 3 col 2-22）
const CLASSES_21 = [
    '一（1）','一（2）','一（3）','二（1）','二（2）','二（3）',
    '三（1）','三（2）','三（3）','四（1）','四（2）','四（3）','四（4）',
    '五（1）','五（2）','五（3）','五（4）',
    '六（1）','六（2）','六（3）','六（4）'
];

// 节次（idx 0-based = Excel row - 1）
// peek2.js 确认: subRow=odd, teaRow=even, each subject=label后1行
// 上午: idx 7/8=第一节, idx 10/11=第二节, idx 13/14=第三节, idx 16/17=第四节
// 下午: idx 22/23=第五节, idx 25/26=第六节
const PERIODS = [
    { subRow: 7,  teaRow: 8,  period: 1, time: '8:20-9:00' },
    { subRow: 10, teaRow: 11, period: 2, time: '9:10-9:50' },
    { subRow: 13, teaRow: 14, period: 3, time: '10:30-11:10' },
    { subRow: 16, teaRow: 17, period: 4, time: '11:20-12:00' },
    { subRow: 22, teaRow: 23, period: 5, time: '14:00-14:40' },
    { subRow: 25, teaRow: 26, period: 6, time: '14:50-15:30' },
];

const DAY_START = { '星期一': 2, '星期二': 23, '星期三': 44, '星期四': 65, '星期五': 86 };
const DAYS = ['星期一','星期二','星期三','星期四','星期五'];

// 过滤非科目内容
const SKIP_KEYWORDS = ['节', '午', '眼', '操', '课间', '练字', '自习', '活动', '服务', '间'];
function isSubject(s) {
    if (!s || !s.length || s.length > 10) return false;
    const low = s.toLowerCase();
    for (const kw of SKIP_KEYWORDS) {
        if (low.includes(kw)) return false;
    }
    return true;
}

function parseMainTimetable(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['总表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    console.log('班级(' + CLASSES_21.length + '): ' + CLASSES_21.join(', '));

    const tt = {};
    for (const day of DAYS) {
        tt[day] = {};
        const dc = DAY_START[day];
        for (let ci = 0; ci < CLASSES_21.length; ci++) {
            const cn = CLASSES_21[ci];
            tt[day][cn] = [];
            for (const p of PERIODS) {
                const sub = norm(data[p.subRow][dc + ci]);
                const tea = norm(data[p.teaRow][dc + ci]);
                if (isSubject(sub)) {
                    tt[day][cn].push({ period: p.period, subject: sub, teacher: tea, time: p.time });
                }
            }
        }
    }

    // 验证
    console.log('\n验证:');
    console.log('一（1）班 星期一:', JSON.stringify(tt['星期一']['一（1）']));
    console.log('一（2）班 星期二:', JSON.stringify(tt['星期二']['一（2）']));
    console.log('六（4）班 星期三:', JSON.stringify(tt['星期三']['六（4）']));
    console.log('五（1）班 星期四:', JSON.stringify(tt['星期四']['五（1）']));
    console.log('四（2）班 星期五:', JSON.stringify(tt['星期五']['四（2）']));

    let total = 0, hasTea = 0;
    for (const d of Object.values(tt)) {
        for (const cls of Object.values(d)) {
            for (const s of cls) { total++; if (s.teacher) hasTea++; }
        }
    }
    console.log('总节次:', total, '| 有教师:', hasTea, '| 无教师:', total - hasTea);
    return tt;
}

function parseTeacherAssignment(filePath) {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets['任课教师一览表'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const sc = { 1:'班主任',2:'语文',3:'数学',4:'英语',5:'道德与法治',6:'科学',
                 7:'音乐',8:'美术',9:'体育',10:'健康',11:'综合实践',12:'信息技术',
                 13:'劳动教育',14:'地方课程',15:'校本课程' };
    const result = {};
    for (let i = 3; i < data.length; i++) {
        const row = data[i];
        const first = norm(row[0]);
        if (first.includes('周课时') || first.includes('备注') || !first) continue;
        const cn = norm(first);
        const teachers = {};
        for (let col = 1; col < row.length; col++) {
            const sub = sc[col];
            const tea = norm(row[col]);
            if (sub && tea && tea !== '0') teachers[sub] = tea;
        }
        if (cn) result[cn] = teachers;
    }
    return result;
}

function parseAfterSchool(filePath, sheetName = '3.3执行') {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const hdr = data[2];
    const cc = {};
    for (let col = 5; col < hdr.length; col++) {
        const h = norm(hdr[col]);
        if (h && !h.includes('时间') && !h.includes('项目')) cc[h] = col;
    }
    const dsr = {};
    for (let i = 3; i < data.length; i++) {
        const fc = norm(data[i][0]);
        for (const d of ['星期一','星期二','星期三','星期四','星期五']) {
            if (fc.includes(d) && !dsr[d]) dsr[d] = i;
        }
    }
    const result = {};
    for (const [day, sr] of Object.entries(dsr)) {
        result[day] = {};
        let i = sr;
        while (i < data.length) {
            const row = data[i];
            const tc = norm(row[3]);
            const tim = norm(row[1]);
            let type = null;
            if (tc.includes('午休')) type = '午休';
            else if (tc.includes('服务')) type = '课后服务';
            else if (tc.includes('晚自习') || tc.includes('晚')) type = '晚自习';
            if (type) {
                if (!result[day][type]) result[day][type] = [];
                for (const [cn, col] of Object.entries(cc)) {
                    const tea = norm(row[col]);
                    if (tea) result[day][type].push({ time: tim, teacher: tea, className: cn });
                }
            }
            const nf = i+1 < data.length ? norm(data[i+1][0]) : '';
            const isNew = ['星期一','星期二','星期三','星期四','星期五'].some(d=>nf.includes(d));
            if (isNew && nf !== norm(data[sr][0])) break;
            i++;
        }
    }
    return result;
}

// ============ 主程序 ============
console.log('=== 总课表 ===');
const tt = parseMainTimetable(BASE + '双井镇中心小学026年春季学期总课表.xlsx');

console.log('\n=== 任课教师表 ===');
const tas = parseTeacherAssignment(BASE + '双井镇中心小学2026年春季学期任课教师一览表.xlsx');
console.log('班级数:', Object.keys(tas).length);

console.log('\n=== 课后服务 ===');
const as_ = parseAfterSchool(BASE + '2026年春季学期课后服务安排表.xlsx');
console.log('天次:', Object.keys(as_).join(', '));

const teachers = new Set();
for (const d of Object.values(tt)) {
    for (const c of Object.values(d)) {
        for (const s of c) { if (s.teacher) teachers.add(s.teacher); }
    }
}
for (const c of Object.values(tas)) {
    for (const t of Object.values(c)) { if (t) teachers.add(t); }
}
console.log('教师总数:', teachers.size);

const out = {
    generatedAt: new Date().toISOString(),
    schoolName: '施秉县双井镇中心小学',
    semester: '2025-2026学年度第二学期',
    totalClasses: 21,
    timetable: tt,
    teacherAssignments: tas,
    afterSchoolService: as_,
    allTeachers: Array.from(teachers).sort()
};
fs.writeFileSync(OUT + 'parsed_data.json', JSON.stringify(out, null, 2), 'utf8');
console.log('\n✅ 已保存到 parsed_data.json');
