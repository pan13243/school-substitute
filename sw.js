// v148: 清理旧 SW 缓存陷阱,改为 NetworkOnly
// 旧版 daiketiao-v84 缓存了 app.js/index.html 等静态资源,强刷仍走 SW 命中老响应→
// 与强刷绕过 disk cache 冲突→出现"强刷归0、关掉重开又正常"的缓存幻觉
// 新策略:不预缓存任何资源;静态资源 NetworkOnly;API 仍直接透传 fetch
const CACHE_NAME = 'daiketiao-v180';
const urlsToCache = []; // 不再预缓存

// 安装:立刻接管,不等下载
self.addEventListener('install', event => {
  self.skipWaiting();
});

// 激活:清掉所有旧缓存(包括 daiketiao-v84),接管当前页面
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      )
    ).then(() => self.clients.claim())
  );
});

// fetch:全部 NetworkOnly,失败直接报错(不再回退旧缓存)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API 请求:网络失败返回 JSON error(便于前端识别处理)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: '网络错误' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 静态资源:NetworkOnly(永远走网络,失败返回 504)
  event.respondWith(
    fetch(event.request).catch(() =>
      new Response('Network error', { status: 504 })
    )
  );
});

// ===== v182: 后台轮询+系统通知(iOS/Android 兼容) =====
const __v182BadgeSW = true;
const V182_POLL = 5 * 60 * 1000; // 5 分钟

// IndexedDB 存取已通知列表
async function v182DBGet(key) {
  try {
    var db = await new Promise(function(resolve, reject) {
      var req = indexedDB.open('v182_db', 1);
      req.onupgradeneeded = function(e) { e.target.result.createObjectStore('kv', {keyPath:'k'}); };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { reject(null); };
    });
    if (!db) return [];
    var tx = db.transaction('kv', 'readonly');
    var r = await new Promise(function(resolve) {
      var req = tx.objectStore('kv').get(key);
      req.onsuccess = function() { resolve(req.result ? req.result.v : []); };
      req.onerror = function() { resolve([]); };
    });
    db.close();
    return r;
  } catch(e) { return []; }
}

async function v182DBSave(key, val) {
  try {
    var db = await new Promise(function(resolve, reject) {
      var req = indexedDB.open('v182_db', 1);
      req.onupgradeneeded = function(e) { e.target.result.createObjectStore('kv', {keyPath:'k'}); };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function() { reject(null); };
    });
    if (!db) return;
    var tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({k: key, v: val});
    await new Promise(function(r) { tx.oncomplete = r; tx.onerror = r; });
    db.close();
  } catch(e) {}
}

async function v182GetTeacherName() {
  try {
    var clients = await self.clients.matchAll({type:'window'});
    for (var c of clients) {
      if (c.url && c.url.includes('school-substitute')) {
        var reply = await new Promise(function(resolve) {
          var ch = new MessageChannel();
          ch.port1.onmessage = function(e) { resolve(e.data); };
          c.postMessage({type:'v182_get_teacher'}, [ch.port2]);
          setTimeout(function() { resolve(null); }, 2000);
        });
        if (reply && reply.teacherName) return reply.teacherName;
      }
    }
  } catch(e) {}
  return null;
}

async function v182CheckNewSubs() {
  try {
    var r = await fetch(self.location.origin + '/api/substitutes');
    var data = await r.json();
    if (!data.success || !Array.isArray(data.data)) return;

    var teacherName = await v182GetTeacherName();
    var mySubs, notified, newSubs, unreadCount;

    if (teacherName) {
      mySubs = data.data.filter(function(s) { return s.substituteTeacher === teacherName; });
      notified = await v182DBGet('notified');
      newSubs = mySubs.filter(function(s) { return !notified.includes(s.id); });
      unreadCount = newSubs.length;
    } else {
      // 管理员：显示待处理数
      unreadCount = data.data.filter(function(s) { return s.status === 'pending'; }).length;
    }

    // 更新角标（桌面端用 setBadge）
    if (unreadCount > 0) {
      if (navigator.setBadge) { try { await navigator.setBadge(unreadCount); } catch(e) {} }
      if (navigator.setAppBadge) { try { navigator.setAppBadge(unreadCount); } catch(e) {} }
    } else {
      if (navigator.clearBadge) { try { await navigator.clearBadge(); } catch(e) {} }
      if (navigator.clearAppBadge) { try { navigator.clearAppBadge(); } catch(e) {} }
    }

    // 发系统通知（iOS/Android/桌面全兼容）
    if (unreadCount > 0 && self.registration) {
      var subs = (newSubs && newSubs.length > 0) ? newSubs : [];
      // 只通知最新一条
      var first = subs[0] || {};
      await self.registration.showNotification(
        '📌 您有 ' + unreadCount + ' 条代课安排',
        {
          body: (first.leaveDate||'') + ' ' + (first.className||'') + ' 第' + (first.period||'') + '节 ' + (first.subject||''),
          tag: 'v182-sub',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%234A90E2" width="192" height="192" rx="38"/><text x="96" y="128" font-size="90" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold">代</text></svg>',
          badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="24" fill="%23EF4444"/><text x="24" y="32" font-size="20" text-anchor="middle" fill="white" font-weight="bold">' + (unreadCount > 9 ? '9+' : unreadCount) + '</text></svg>',
          requireInteraction: false,
          silent: false,
          vibrate: [200, 100, 200]
        }
      );
    }

    // 保存已通知 ID
    if (newSubs && newSubs.length > 0) {
      await v182DBSave('notified', [...notified, ...newSubs.map(function(s) { return s.id; })]);
    }

    // 通知页面
    var clients = await self.clients.matchAll({type:'window'});
    clients.forEach(function(c) {
      c.postMessage({type:'v182_new_subs', count: unreadCount, subs: newSubs||[]});
    });
  } catch(e) { console.warn('[v182 SW] 轮询失败', e); }
}

// SW 安装后启动
self.addEventListener('activate', function(event) {
  event.waitUntil(
    Promise.all([self.clients.claim(), v182CheckNewSubs()]).then(function() {
      setInterval(v182CheckNewSubs, V182_POLL);
    })
  );
});

// ===== end v182 =====
// ===== end v180 =====