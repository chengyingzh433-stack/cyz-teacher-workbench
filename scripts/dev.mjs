import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 8765);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ app: 'workstation-teacher', version: '1.2.0' }));
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    // Serve application assets only. Git history, backups and local files stay private.
    if (
      relative !== 'index.html' &&
      relative !== 'dist/index.html' &&
      !relative.startsWith('src/') &&
      !relative.startsWith('assets/')
    ) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const file = path.resolve(root, relative);
    if (!file.startsWith(root) || !types[path.extname(file)] || !(await stat(file)).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] + '; charset=utf-8',
      'Content-Length': body.length
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.on('error', (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用。请检查是否已启动工作台；使用同一地址可以保留原来的浏览器数据。`
      : error.message
  );
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(
    `\ncyz的教师工作台\nLocal: http://127.0.0.1:${port}/index.html\n修改源码后刷新浏览器。按 Control+C 停止。\n`
  );
});
