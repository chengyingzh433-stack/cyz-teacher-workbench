import fs from 'node:fs/promises';
import path from 'node:path';
async function walk(dir) {
  const results = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    results.push(...(e.isDirectory() ? await walk(p) : [p]));
  }
  return results;
}
const files = await walk('src');
const errors = [];
for (const file of files.filter((x) => /\.tsx?$/.test(x))) {
  const text = await fs.readFile(file, 'utf8');
  if (/src\/(ui|scene)\//.test(file) && /from ['"].*(persistence|dexie)/.test(text))
    errors.push(file + ': UI/scene must not import persistence');
  if (
    /\bfetch\(/.test(text) &&
    path.relative('src', file).split(path.sep).join('/') !== 'modules/assistant/provider.ts'
  )
    errors.push(file + ': network requests belong in the model adapter');
  if (/dangerouslySetInnerHTML|eval\(|new Function\(|XMLHttpRequest|localStorage/.test(text))
    errors.push(file + ': unsafe or unsupported runtime API');
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Module boundaries: ${files.length} files checked`);
