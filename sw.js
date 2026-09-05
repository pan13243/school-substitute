// v148: 清理旧 SW 缓存陷阱,改为 NetworkOnly
// 旧版 daiketiao-v84 缓存了 app.js/index.html 等静态资源,强刷仍走 SW 命中老响应→
// 与强刷绕过 disk cache 冲突→出现"强刷归0、关掉重开又正常"的缓存幻觉
// 新策略:不预缓存任何资源;静态资源 NetworkOnly;API 仍直接透传 fetch
const CACHE_NAME = 'daiketiao-v148';
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