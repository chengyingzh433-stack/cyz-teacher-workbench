import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const port = Number(process.env.CYZ_PORT || 4173);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/__test_results') {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 500000) {
        res.writeHead(413).end();
        return;
      }
    }
    try {
      const value = JSON.parse(text);
      await fs.mkdir('.dev', { recursive: true });
      await fs.writeFile('.dev/browser-results.json', JSON.stringify(value, null, 2));
      res.end('recorded');
    } catch {
      res.writeHead(400).end();
    }
    return;
  }
  let requested = decodeURIComponent(url.pathname);
  if (requested === '/') requested = '/dist/index.html';
  if (requested === '/tests') requested = '/.dev/browser-tests.html';
  if (requested === '/failures') requested = '/.dev/failure-ui.html';
  if (requested === '/art') requested = '/.dev/art-audit.html';
  const file = path.resolve(root, '.' + requested);
  if (
    !file.startsWith(root + '/') ||
    requested.includes('node_modules') ||
    !['.html', '.js', '.css', '.json', '.png'].includes(path.extname(file))
  ) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
      }[path.extname(file)],
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
