const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.DEPLOY_RUN_PORT || 5000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 文件路径
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const LEAVES_FILE = path.join(DATA_DIR, 'leaves.json');
const SUBSTITUTES_FILE = path.join(DATA_DIR, 'substitutes.json');

// 初始化数据文件
function initDataFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], 'utf8'));
  }
}

initDataFile(SCHEDULE_FILE);
initDataFile(LEAVES_FILE);
initDataFile(SUBSTITUTES_FILE);

// 读取 JSON 文件
function readJsonFile(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

// 写入 JSON 文件
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 解析请求体
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// API 路由处理
async function handleApi(req, res, urlPath) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    // 获取课表数据
    if (urlPath === '/api/schedule' && req.method === 'GET') {
      const data = readJsonFile(SCHEDULE_FILE);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // 批量保存课表数据（覆盖）
    if (urlPath === '/api/schedule' && req.method === 'POST') {
      const body = await parseBody(req);
      const { records } = body;
      if (Array.isArray(records)) {
        writeJsonFile(SCHEDULE_FILE, records);
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, count: records.length }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'records must be an array' }));
      }
      return;
    }

    // 清空课表数据
    if (urlPath === '/api/schedule' && req.method === 'DELETE') {
      writeJsonFile(SCHEDULE_FILE, []);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 获取请假记录
    if (urlPath === '/api/leaves' && req.method === 'GET') {
      const data = readJsonFile(LEAVES_FILE);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // 添加请假记录
    if (urlPath === '/api/leaves' && req.method === 'POST') {
      const body = await parseBody(req);
      const { leave } = body;
      const data = readJsonFile(LEAVES_FILE);
      leave.id = Date.now();
      leave.created_at = new Date().toISOString();
      data.push(leave);
      writeJsonFile(LEAVES_FILE, data);
      res.writeHead(201);
      res.end(JSON.stringify({ success: true, id: leave.id }));
      return;
    }

    // 删除请假记录
    if (urlPath.match(/^\/api\/leaves\/\d+$/) && req.method === 'DELETE') {
      const id = parseInt(urlPath.split('/').pop());
      let data = readJsonFile(LEAVES_FILE);
      data = data.filter(item => item.id !== id);
      writeJsonFile(LEAVES_FILE, data);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 清空请假记录
    if (urlPath === '/api/leaves' && req.method === 'DELETE') {
      writeJsonFile(LEAVES_FILE, []);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 获取代课记录
    if (urlPath === '/api/substitutes' && req.method === 'GET') {
      const data = readJsonFile(SUBSTITUTES_FILE);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data }));
      return;
    }

    // 批量添加代课记录
    if (urlPath === '/api/substitutes' && req.method === 'POST') {
      const body = await parseBody(req);
      const { records } = body;
      const data = readJsonFile(SUBSTITUTES_FILE);
      if (Array.isArray(records)) {
        records.forEach(r => {
          r.id = Date.now() + Math.random();
          r.created_at = new Date().toISOString();
          data.push(r);
        });
        writeJsonFile(SUBSTITUTES_FILE, data);
        res.writeHead(201);
        res.end(JSON.stringify({ success: true, count: records.length }));
      } else {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'records must be an array' }));
      }
      return;
    }

    // 清空代课记录
    if (urlPath === '/api/substitutes' && req.method === 'DELETE') {
      writeJsonFile(SUBSTITUTES_FILE, []);
      res.writeHead(200);
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 未知 API 路由
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'API not found' }));
  } catch (error) {
    console.error('API Error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
}

const server = http.createServer(async (req, res) => {
  let urlPath = req.url.split('?')[0];
  
  // 处理 API 请求
  if (urlPath.startsWith('/api/')) {
    await handleApi(req, res, urlPath);
    return;
  }
  
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(ROOT, urlPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
