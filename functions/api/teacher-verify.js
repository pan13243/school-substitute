/**
 * v160 教师隐私密码验证 API（新增文件，纯增量）
 * 路由: /api/teacher-verify
 *   GET  /api/teacher-verify?teacher=<name>      → 返回 { success, hasPassword }
 *   POST /api/teacher-verify  body: { teacherName, password } → 验证密码 { success }
 *
 * 解决旧 /api/teacher/pwd 的三个问题：
 *   1. GET 需 x-teacher-name header 但浏览器禁止中文 header → 改为 query param，无需 header
 *   2. POST 验证共用"设置"接口 oldPassword 逻辑 → 本接口只做验证，不碰 oldPassword
 *   3. 不影响旧接口（/api/teacher/pwd 仍可用于管理员列表/重置）
 *
 * KV: teacher_privacy_passwords（复用旧 key，只读不写）
 */
function v160Json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }

  if (!env.SCHOOL_SUB) return v160Json({ success: false, error: 'KV 未绑定' }, 500);

  // 读取 KV 中的教师隐私密码
  let passwords = {};
  try {
    passwords = await env.SCHOOL_SUB.get('teacher_privacy_passwords', { type: 'json' }) || {};
  } catch (e) {
    // 如果 JSON 解析失败，尝试文本再 parse
    try {
      const raw = await env.SCHOOL_SUB.get('teacher_privacy_passwords');
      if (raw) passwords = JSON.parse(raw);
    } catch (e2) {
      return v160Json({ success: false, error: '读取 KV 失败' }, 500);
    }
  }

  // GET: 查询教师是否设置了隐私密码
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const teacherName = url.searchParams.get('teacher') || url.searchParams.get('teacherName');
    if (!teacherName) return v160Json({ success: false, error: '缺少 teacher 参数' }, 400);
    return v160Json({
      success: true,
      hasPassword: !!passwords[teacherName],
      teacherName: teacherName
    });
  }

  // POST: 验证教师隐私密码
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); }
    catch (e) { return v160Json({ success: false, error: 'JSON 解析失败' }, 400); }

    const teacherName = (body.teacherName || '').toString().trim();
    const password = (body.password || '').toString().trim();

    if (!teacherName) return v160Json({ success: false, error: '缺少教师姓名' }, 400);
    if (!password) return v160Json({ success: false, error: '请输入密码' }, 400);

    // 教师未设置密码 → 视为验证通过（不拦截）
    if (!passwords[teacherName]) {
      return v160Json({ success: true, message: '未设置密码' });
    }

    // 比对密码
    if (passwords[teacherName] === password) {
      return v160Json({ success: true });
    } else {
      return v160Json({ success: false, error: '密码错误' }, 403);
    }
  }

  return v160Json({ success: false, error: '仅支持 GET/POST' }, 405);
}
