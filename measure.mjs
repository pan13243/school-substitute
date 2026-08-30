const base = "https://school-substitute.pages.dev";
const H = { "x-admin-pwd": "admin888" };

async function time(method, path, headers, body) {
  const t = Date.now();
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  return { ms: Date.now() - t, status: r.status, kb: (txt.length/1024).toFixed(1) };
}

console.log("=== /api/leave-slips 连续 3 次（区分冷启动 vs 持续）===");
for (let i = 0; i < 3; i++) {
  const r = await time("GET", "/api/leave-slips", H);
  console.log(`  #${i+1} ${r.status} ${r.ms}ms ${r.kb}KB`);
}
console.log("=== /api/leaves 2 次 ===");
for (let i = 0; i < 2; i++) {
  const r = await time("GET", "/api/leaves", H);
  console.log(`  #${i+1} ${r.status} ${r.ms}ms ${r.kb}KB`);
}
console.log("=== /api/substitutes 1 次 ===");
{ const r = await time("GET", "/api/substitutes", H); console.log(`  ${r.status} ${r.ms}ms ${r.kb}KB`); }
