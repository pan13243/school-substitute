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
// ===== v180: 后台轮询 + Badge 更新 =====
const __v180BadgeSW = true;
const V180_POLL_INTERVAL = 5 * 60 * 1000; // 5 分钟
const V180_API_BASE = self.registration ? (self.location.origin.replace('school-substitute.pages.dev', 'school-substitute.pages.dev')) : '';

// 读取上次已通知的代课 ID 列表（用 SW IndexedDB）
async function v180GetNotified() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('v180_badge_db', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(null);
    });
    if (!db) return [];
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const result = await new Promise(resolve => {
      const req = store.get('notified_ids');
      req.onsuccess = () => resolve(req.result ? req.result.value : []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return result;
  } catch(e) { return []; }
}

async function v180SaveNotified(ids) {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('v180_badge_db', 1);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore('kv', { keyPath: 'key' });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = () => reject(null);
    });
    if (!db) return;
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ key: 'notified_ids', value: ids });
    await new Promise(r => { tx.oncomplete = r; tx.onerror = r; });
    db.close();
  } catch(e) {}
}

async function v180GetTeacherName() {
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      if (c.url.includes('school-substitute')) {
        // 通过 postMessage 向页面要 teacherName
        const resp = await new Promise(resolve => {
          const ch = new MessageChannel();
          ch.port1.onmessage = e => resolve(e.data);
          c.postMessage({ type: 'v180_get_teacher' }, [ch.port2]);
          setTimeout(() => resolve(null), 2000);
        });
        if (resp && resp.teacherName) return resp.teacherName;
      }
    }
    return null;
  } catch(e) { return null; }
}

async function v180CheckNewSubs() {
  try {
    const teacherName = await v180GetTeacherName();
    if (!teacherName) {
      // 管理员或未登录：检查待处理代课数
      const r = await fetch(self.location.origin + '/api/substitutes');
      const data = await r.json();
      if (data.success && data.data) {
        const pending = data.data.filter(s => s.status === 'pending').length;
        if (navigator.setBadge) {
          if (pending > 0) await navigator.setBadge(pending);
          else await navigator.clearBadge();
        }
      }
      return;
    }

    // 教师端：检查我的新代课
    const r = await fetch(self.location.origin + '/api/substitutes');
    const data = await r.json();
    if (!data.success || !data.data) return;

    const mySubs = data.data.filter(s => s.substituteTeacher === teacherName);
    const notified = await v180GetNotified();
    const newSubs = mySubs.filter(s => !notified.includes(s.id));

    // 更新 badge
    const unreadCount = newSubs.length;
    if (navigator.setBadge) {
      if (unreadCount > 0) {
        await navigator.setBadge(unreadCount);
        // 发系统通知
        for (const s of newSubs.slice(0, 3)) {
          self.registration.showNotification('代课提醒', {
            body: s.leaveDate + ' ' + (s.className||'') + ' 第' + s.period + '节 - ' + (s.subject||''),
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect fill="%234A90E2" width="192" height="192" rx="38"/><text x="96" y="125" font-size="96" text-anchor="middle" fill="white">代</text></svg>',
            tag: s.id,
            requireInteraction: false
          });
        }
      } else {
        await navigator.clearBadge();
      }
    }

    // 更新已通知列表
    if (newSubs.length > 0) {
      await v180SaveNotified([...notified, ...newSubs.map(s => s.id)]);
    }

    // 通知页面更新红点
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'v180_new_subs', count: unreadCount, subs: newSubs }));
  } catch(e) {
    console.warn('[v180 SW] 轮询失败:', e);
  }
}

// periodicsync 事件（如果浏览器支持）
self.addEventListener('periodicsync', event => {
  if (event.tag === 'v180-check-subs') {
    event.waitUntil(v180CheckNewSubs());
  }
});

// message 事件：页面回复 teacherName
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'v180_teacher_reply') {
    // 由 MessageChannel 处理
  }
});

// 安装后立即检查一次 + 定时轮询
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      v180CheckNewSubs()
    ]).then(() => {
      // 注册定时器（SW 可能被杀，所以靠 periodicsync + 页面心跳双重保障）
      setInterval(v180CheckNewSubs, V180_POLL_INTERVAL);
    })
  );
});

// ===== end v180 =====