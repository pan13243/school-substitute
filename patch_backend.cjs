const fs = require('fs');
const p = 'D:\\school-substitute\\functions\\api\\[[path]].js';
let s = fs.readFileSync(p, 'utf8');
const eol = s.includes('\r\n') ? '\r\n' : '\n';

// GET teacher 分支：去掉 header==name 相等比对
const getOld = "  const currentTeacher = request.headers.get('x-teacher-name') || '';" + eol +
  "  const isAdmin = authAdmin(request.headers);" + eol +
  "  if (!isAdmin && currentTeacher !== name) {" + eol +
  "    return json({ success: false, error: '无权查看' }, 403);" + eol +
  "  }";
const getNew = "  const currentTeacher = request.headers.get('x-teacher-name') || '';" + eol +
  "  const isAdmin = authAdmin(request.headers);" + eol +
  "  // 不再用 header 中的 name 与查询 name 做相等比对(中文名经 Workers/Latin1 解码会乱码," + eol +
  "  // 且浏览器禁止非 ISO-8859-1 的 header 值),改为: 具备任一身份凭证即可,存储键以查询参数 name 为准。" + eol +
  "  if (!isAdmin && !currentTeacher) {" + eol +
  "    return json({ success: false, error: '无权查看' }, 403);" + eol +
  "  }";
if (!s.includes(getOld)) { console.error('GET 旧文本未匹配!'); process.exit(1); }
s = s.replace(getOld, getNew);

// POST teacher 分支：去掉 header==name 相等比对
const postOld = "  // teacher scope" + eol +
  "  const currentTeacher = request.headers.get('x-teacher-name') || '';" + eol +
  "  const isAdmin = authAdmin(request.headers);" + eol +
  "  if (!name || (!isAdmin && currentTeacher !== name)) {" + eol +
  "    return json({ success: false, error: '无权操作' }, 403);" + eol +
  "  }";
const postNew = "  // teacher scope" + eol +
  "  const currentTeacher = request.headers.get('x-teacher-name') || '';" + eol +
  "  const isAdmin = authAdmin(request.headers);" + eol +
  "  const isPrincipal = await authPrincipal(request.headers, env);" + eol +
  "  // 不再用 header 中的 name 与 body.name 做相等比对(中文名经 Workers/Latin1 解码会乱码," + eol +
  "  // 且浏览器禁止非 ISO-8859-1 的 header 值),改为: 具备任一身份凭证即可,存储键以 body.name 为准。" + eol +
  "  if (!name || (!isAdmin && !isPrincipal && !currentTeacher)) {" + eol +
  "    return json({ success: false, error: '无权操作' }, 403);" + eol +
  "  }";
if (!s.includes(postOld)) { console.error('POST 旧文本未匹配!'); process.exit(1); }
s = s.replace(postOld, postNew);

fs.writeFileSync(p, s, 'utf8');
console.log('后端 [[path]].js 已打补丁（v91 -> 去相等比对, 换行符=' + (eol === '\r\n' ? 'CRLF' : 'LF') + '）');
