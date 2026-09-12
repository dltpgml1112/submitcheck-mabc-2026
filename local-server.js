// local-server.js — 정적 서빙 + /api/analyze POST를 api/analyze.js 핸들러로 라우팅 (내장 http)
// Hermes .env의 UPSTAGE_API_KEY를 process.env에만 주입 (출력·기록 없음)
const fs = require('fs');
const path = require('path');
const http = require('http');

const hermesEnvPath = 'C:/Users/lsh99/AppData/Local/hermes/.env';
if (fs.existsSync(hermesEnvPath)) {
  const envText = fs.readFileSync(hermesEnvPath, 'utf8');
  const m = envText.match(/^UPSTAGE_API_KEY=(.+)$/m);
  if (m) {
    process.env.UPSTAGE_API_KEY = m[1].trim();
  }
}

// api/analyze.js 읽기 + ESM 변환
const code = fs.readFileSync(path.join(__dirname, 'api', 'analyze.js'), 'utf8');
const converted = code
  .replace(/^export\s+default\s+async\s+function\s+(\w+)/m, 'async function $1')
  .replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');

// 핸들러 추출
let handler;
{
  const tmpModule = { exports: {} };
  const fn = new Function('module', 'exports', 'require', 'console', converted + '\nmodule.exports.handler = handler;');
  fn(tmpModule, tmpModule.exports, require, console);
  handler = tmpModule.exports.handler;
}

// 본문 파싱 헬퍼
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('유효하지 않은 JSON 본문'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;

  if (url === '/api/analyze') {
    if (method !== 'GET' && method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    try {
      let body;
      if (method === 'POST') {
        body = await parseBody(req);
      }
      const request = {
        method,
        url,
        headers: req.headers,
        json: async () => body,
        text: async () => JSON.stringify(body)
      };
      const result = await handler(request);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      if (err.message === '유효하지 않은 JSON 본문') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '유효하지 않은 JSON 본문' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  // 정적 파일
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
    return;
  }

  if (url === '/api/analyze.js' || url === '/local-server.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, url === '/api/analyze.js' ? 'api/analyze.js' : 'local-server.js'), 'utf8'));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
  console.log('UPSTAGE_API_KEY:', process.env.UPSTAGE_API_KEY ? '설정됨 (길이 ' + process.env.UPSTAGE_API_KEY.length + ')' : '미설정');
});
