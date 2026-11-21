import { build } from 'esbuild';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
const escapeScript = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const catalog = JSON.parse(await fs.readFile('assets/catalog.json', 'utf8'));
export async function assets() {
  const values = {};
  for (const a of catalog.assets.filter((x) => x.bundled)) {
    const bytes = await fs.readFile('assets/' + a.path);
    const png = PNG.sync.read(bytes);
    if (
      crypto.createHash('sha256').update(bytes).digest('hex') !== a.sha256 ||
      png.width !== a.width ||
      png.height !== a.height
    )
      throw new Error('Asset mismatch: ' + a.path);
    values[a.path] = 'data:image/png;base64,' + bytes.toString('base64');
  }
  return values;
}
export async function licenses() {
  let result =
    'cyz的教师工作台 — 第三方依赖声明\n应用代码按本项目规格独立编写。美术来源见 assets/README.md；第三方角色不称为原创。\n';
  const dependencies = ['react', 'react-dom', 'scheduler', 'dexie', 'zod', 'uuid', 'xlsx'];
  for (const name of dependencies) {
    const p = JSON.parse(await fs.readFile(`node_modules/${name}/package.json`, 'utf8'));
    const files = await fs.readdir(`node_modules/${name}`);
    const file = files.find((n) => /^licen[sc]e(\.|$)/i.test(n));
    if (!file) throw new Error('Missing license: ' + name);
    result +=
      `\n--- ${name} ${p.version} (${p.license}) ---\n` +
      (await fs.readFile(`node_modules/${name}/${file}`, 'utf8'));
  }
  return result;
}
export async function bundleHtml(entry, options = {}) {
  const worker = await build({
    entryPoints: ['src/modules/gradebook/parse.worker.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'edge110', 'safari16.4'],
    minify: true,
    legalComments: 'inline',
  });
  const workerCode = worker.outputFiles[0].text;
  new vm.Script(workerCode); // Syntax check only; never execute the parser during a build.
  const workerCheck = {
    bytes: Buffer.byteLength(workerCode),
    sha256: crypto.createHash('sha256').update(workerCode).digest('hex'),
    syntaxParsed: true,
  };
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: '.dev/bundle',
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'edge110', 'safari16.4'],
    jsx: 'automatic',
    minify: !options.debug,
    legalComments: 'inline',
    define: {
      'process.env.NODE_ENV': '"production"',
      __GRADEBOOK_WORKER__: JSON.stringify(workerCode),
    },
    metafile: true,
  });
  const js = result.outputFiles.find((x) => x.path.endsWith('.js')).text;
  const css = result.outputFiles.find((x) => x.path.endsWith('.css'))?.text || '';
  const registry = await assets();
  const notice = await licenses();
  const csp = options.test
    ? ''
    : "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src 'none'; connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; worker-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'\">";
  const html = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp}<title>${options.title || 'cyz的教师工作台'}</title><link rel="icon" href="data:,"><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><noscript>请使用启用 JavaScript 的浏览器打开。</noscript><script>window.__CYZ_ASSETS__=${escapeScript(JSON.stringify(registry))};</script><script>${escapeScript(js)}</script><script type="text/plain" id="third-party-notices">${escapeScript(notice)}</script></body></html>`;
  return { html, metafile: result.metafile, workerCheck };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await bundleHtml('src/app/main.tsx');
  await fs.mkdir('dist', { recursive: true });
  await fs.mkdir('.dev', { recursive: true });
  await fs.writeFile('dist/index.html', result.html);
  await fs.writeFile(
    '.dev/gradebook-worker-check.json',
    JSON.stringify(result.workerCheck, null, 2),
  );
  await fs.writeFile('.dev/build-metafile.json', JSON.stringify(result.metafile, null, 2));
  await fs.writeFile('THIRD_PARTY_NOTICES.txt', await licenses());
  console.log(`Built dist/index.html: ${Buffer.byteLength(result.html).toLocaleString()} bytes`);
}
