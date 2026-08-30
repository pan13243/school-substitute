const base = "https://school-substitute.pages.dev";

// 1) /api/leave-slips 真实耗时（用管理员密码，避免校长密码已改）
const t0 = Date.now();
const r = await fetch(base + "/api/leave-slips", { headers: { "x-admin-pwd": "admin888" } });
const dt = Date.now() - t0;
const txt = await r.text();
console.log(`/api/leave-slips 状态=${r.status} 耗时=${dt}ms 字节=${txt.length}`);
try { const j = JSON.parse(txt); console.log("  success=", j.success, " data条数=", Array.isArray(j.data) ? j.data.length : "n/a"); } catch(e) { console.log("  非JSON前80:", txt.slice(0,80)); }

// 2) 签名保存：模拟 v91 前端把中文教师名塞进 x-teacher-name header
console.log("--- 签名保存测试（v91 前端逻辑：中文名进 header）---");
try {
  const s = await fetch(base + "/api/signatures", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-teacher-name": "张三测试" },
    body: JSON.stringify({ scope:"teacher", name:"张三测试", action:"add", sigName:"s", dataUrl:"data:image/png;base64,iVBORw0KGgo=" })
  });
  console.log(`签名POST 状态=${s.status} 响应=${await s.text()}`);
} catch (e) {
  console.log("签名POST 直接抛错（请求根本没发出去）:", e.message);
}
