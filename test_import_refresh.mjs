// 用真实部署代码验证「重新导入=整份刷新」语义
import { pathToFileURL } from 'url';

const filePath = 'C:\\Users\\HUA WEI\\Downloads\\school-substitute\\functions\\api\\[[path]].js';
const u = pathToFileURL(filePath).href.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
const mod = await import(u);
const { onRequest } = mod;

// 内存版 KV
function makeEnv() {
  return {
    SCHOOL_SUB: {
      store: {},
      async get(k) { return this.store[k] ? JSON.parse(this.store[k]) : null; },
      async put(k, v) { this.store[k] = typeof v === 'string' ? v : JSON.stringify(v); },
      async delete(k) { delete this.store[k]; }
    }
  };
}
const makeReq = (method, path, body, headers = {}) => ({
  url: 'https://x' + path, method,
  headers: { get: (k) => headers[k] || null },
  json: async () => body
});
const CFG = async (env) => JSON.parse(env.SCHOOL_SUB.store['config'] || 'null');

let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };

const env = makeEnv();
const admin = { 'x-admin-pwd': 'admin888' };

// 第1步：导入总课表 v1（含 张三）
let r = await onRequest({ request: makeReq('POST', '/api/schedule', {
  timetable: { '星期一': {
    '一（1）': [ {period:1,subject:'语文',teacher:'龙燕'}, {period:2,subject:'数学',teacher:'吴寿成'} ],
    '一（2）': [ {period:1,subject:'语文',teacher:'张三'} ]
  } }
}, admin), env });
let cfg = await CFG(env);
console.log('第1步 导入课表v1');
check('班级含 一（1）', cfg.classes.includes('一（1）'));
check('班级含 一（2）', cfg.classes.includes('一（2）'));
check('教师含 龙燕', cfg.allTeachers.includes('龙燕'));
check('教师含 张三(v1)', cfg.allTeachers.includes('张三'));
check('ta 一（1）语文=龙燕', cfg.teacherAssignment['一（1）']['语文'] === '龙燕');

// 第2步：重导同结构课表 v2（张三调走、李四加入，其余不变）
r = await onRequest({ request: makeReq('POST', '/api/schedule', {
  timetable: { '星期一': {
    '一（1）': [ {period:1,subject:'语文',teacher:'龙燕'}, {period:2,subject:'数学',teacher:'吴寿成'} ],
    '一（2）': [ {period:1,subject:'语文',teacher:'李四'} ]
  } }
}, admin), env });
cfg = await CFG(env);
console.log('第2步 重导课表v2（张三走/李四来）');
check('教师 张三 已被清除', !cfg.allTeachers.includes('张三'));
check('教师 李四 已加入', cfg.allTeachers.includes('李四'));
check('教师 龙燕 仍在', cfg.allTeachers.includes('龙燕'));
check('教师 吴寿成 仍在', cfg.allTeachers.includes('吴寿成'));
check('班级未多生（仅2班）', cfg.classes.length === 2);
check('总课表已替换为 v2（一（2）语文=李四）', cfg.timetable['星期一']['一（2）'][0].teacher === '李四');

// 第3步：单独重导课后服务（不应清空课表）
r = await onRequest({ request: makeReq('POST', '/api/schedule', {
  afterSchoolService: { slots: [ { day:'星期一', period:7, project:'课后服务1', assignments: { '一（1）': { teacher:'王五', week:'通用' } } } ] }
}, admin), env });
cfg = await CFG(env);
console.log('第3步 单独重导课后服务');
check('课表未被清空（仍有 一（1））', !!cfg.timetable['星期一']['一（1）']);
check('课表教师 龙燕 仍在', cfg.allTeachers.includes('龙燕'));
check('课后服务已替换（含 王五）', cfg.afterSchoolService.slots[0].assignments['一（1）'].teacher === '王五');
check('课后服务教师 王五 进入教师名单', cfg.allTeachers.includes('王五'));

// 第4步：单独导入校历（不应清空课表/课后服务）
r = await onRequest({ request: makeReq('POST', '/api/schedule', {
  calendar: { term:'2026春', startDate:'2026-03-01', endDate:'2026-07-10', weeks:[], dayMap:{} }
}, admin), env });
cfg = await CFG(env);
console.log('第4步 单独导入校历');
check('校历已写入', cfg.calendar && cfg.calendar.term === '2026春');
check('课表仍在', !!cfg.timetable['星期一']['一（1）']);
check('课后服务仍在', !!cfg.afterSchoolService.slots[0]);

// 第5步：再重导一次课后服务（王五→赵六），验证不重复累加
r = await onRequest({ request: makeReq('POST', '/api/schedule', {
  afterSchoolService: { slots: [ { day:'星期一', period:7, project:'课后服务1', assignments: { '一（1）': { teacher:'赵六', week:'通用' } } } ] }
}, admin), env });
cfg = await CFG(env);
console.log('第5步 再次重导课后服务（王五→赵六）');
check('课后服务已刷新为 赵六', cfg.afterSchoolService.slots[0].assignments['一（1）'].teacher === '赵六');
check('课后服务仍只有1个 slot（无重复）', cfg.afterSchoolService.slots.length === 1);
check('王五 已不在教师名单', !cfg.allTeachers.includes('王五'));
check('赵六 已加入教师名单', cfg.allTeachers.includes('赵六'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
