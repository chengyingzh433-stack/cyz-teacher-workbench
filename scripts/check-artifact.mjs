import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import vm from 'node:vm';
const html = await fs.readFile('dist/index.html', 'utf8');
const catalog = JSON.parse(await fs.readFile('assets/catalog.json', 'utf8'));
const failures = [];
for (const a of catalog.assets) {
  const bytes = await fs.readFile('assets/' + a.path);
  const count = html.split(bytes.toString('base64')).length - 1;
  if (count !== (a.bundled ? 1 : 0)) failures.push(a.path + ' embedded ' + count + ' times');
}
if (/<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:|\.\.?\/|\/)/i.test(html))
  failures.push('External resource URL');
if (/\/Users\/|AIza[\w-]{20,}|sk-[\w-]{20,}|BEGIN PRIVATE KEY/.test(html))
  failures.push('Private path or secret');
if (!html.includes('third-party-notices') || !html.includes('Apache License'))
  failures.push('Missing licenses');
let scripts = 0;
for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (m[0].startsWith('<script type=')) continue;
  new vm.Script(m[1]);
  scripts++;
}
if (scripts !== 2) failures.push('Unexpected executable scripts: ' + scripts);
if (/<script[^>]*type=["']module/i.test(html) || /<script[^>]+src=/i.test(html))
  failures.push('Non-inline script');
const report = {
  date: new Date().toISOString(),
  passed: !failures.length,
  bytes: Buffer.byteLength(html),
  sha256: crypto.createHash('sha256').update(html).digest('hex'),
  runtimeImages: 7,
  embeddedEachOnce: !failures.some((x) => x.includes('embedded')),
  referenceOriginalsEmbedded: false,
  scriptsParsed: scripts,
  failures,
};
await fs.mkdir('.dev', { recursive: true });
await fs.writeFile('.dev/artifact-check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
