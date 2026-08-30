const base = "https://school-substitute.pages.dev";
const name = "验证老师V95";

// 1) 等 Cloudflare 部署：轮询 index.html 版本号
async function liveVer() {
  const h = await (await fetch(base + "/")).text();
  const m = h.match(/app\.js\?v=(\d+)/);
  return m ? m[1] : "?";
}
let ver = "?";
for (let i = 0; i < 8; i++) {
  ver = await liveVer();
  console.log(`[${i}] 线上 app.js?v=${ver}`);
  if (ver === "95") break;
  await new Promise(r => setTimeout(r, 8000));
}

// 2) 签名保存（v95 前端逻辑：header 发 '1' 占位符，真实中文名在 body）
console.log("--- 保存签名（header='1' 占位符 + 中文 body.name）---");
const save = await fetch(base + "/api/signatures", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-teacher-name": "1" },
  body: JSON.stringify({ scope: "teacher", name, action: "add", sigName: "测试签", dataUrl: "data:image/png;base64,iVBORw0KGgo=" })
});
console.log(`保存: 状态=${save.status} 响应=${await save.text()}`);

// 3) 读取（占位符 header，不要求等于 name）
console.log("--- 读取签名 ---");
const read = await fetch(base + "/api/signatures?scope=teacher&name=" + encodeURIComponent(name), { headers: { "x-teacher-name": "1" } });
const rd = await read.json();
console.log(`读取: 状态=${read.status} 条数=${rd.data?.length} 首条name=${rd.data?.[0]?.name}`);

// 4) 清理
const del = await fetch(base + "/api/signatures", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-pwd": "admin888" },
  body: JSON.stringify({ scope: "teacher", name, action: "delete", id: rd.data?.[0]?.id })
});
console.log(`清理: 状态=${del.status} 响应=${await del.text()}`);
