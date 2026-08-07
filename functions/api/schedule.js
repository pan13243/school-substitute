/**
 * GET  /api/schedule           → 返回课表数据
 * POST /api/schedule/import    → 导入课表（管理员）
 * POST /api/schedule/legacy    → 旧格式导入
 * DELETE /api/schedule         → 清空数据
 */
import { mem, json, err, checkAdmin } from './supabase-client.js';
import { buildTeacherAssignment } from './algorithm.js';

export async function handleScheduleGet(env) {
  return json({
    success: true,
    data:            mem.config?.timetable            || null,
    teacherAssignment: mem.config?.teacherAssignment   || null,
    afterSchoolService: mem.config?.afterSchoolService || null,
    classes:         mem.config?.classes               || [],
    allTeachers:     mem.config?.allTeachers            || []
  });
}

export async function handleScheduleImport(request, env) {
  if (!checkAdmin(request.headers)) return err('管理员密码错误', 401);

  let body;
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json();
    } else {
      // multipart / form
      const formData = await request.formData();
      const jsonStr  = formData.get('data');
      body = jsonStr ? JSON.parse(jsonStr) : {};
    }
  } catch(e) {
    return err('请求格式错误');
  }

  const { timetable, afterSchoolService } = body;
  if (!timetable) return err('缺少 timetable 字段');

  // 重建 teacherAssignment
  const teacherAssignment = buildTeacherAssignment(timetable);

  // 收集班级和教师
  const classSet = new Set();
  const teacherSet = new Set();
  for (const [, classMap] of Object.entries(timetable)) {
    for (const cls of Object.keys(classMap)) classSet.add(cls);
    for (const periods of Object.values(classMap)) {
      for (const s of periods) if (s.teacher) teacherSet.add(s.teacher);
    }
  }

  const classes = [...classSet].sort();
  const allTeachers = [...teacherSet].sort();

  mem.config = { timetable, teacherAssignment, afterSchoolService: afterSchoolService || [], classes, allTeachers };

  // 持久化到 Cloudflare KV
  if (env?.SCHEDULE_KV) {
    await env.SCHEDULE_KV.put('timetable', JSON.stringify(mem.config));
  }

  return json({ success: true, message: '课表导入成功', stats: {
    classes: classes.length, teachers: allTeachers.length,
    slots: Object.values(timetable).reduce((a,b)=>a+Object.values(b).reduce((a2,b2)=>a2+b2.length,0),0)
  }});
}
