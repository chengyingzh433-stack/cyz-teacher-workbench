import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { analyze } from 'eslint-scope';
import { build } from 'esbuild';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? collect(path.join(dir, e.name)) : [path.join(dir, e.name)]
      )
    )
  ).flat();
}
const files = (await collect('src')).filter((f) => f.endsWith('.js'));
const browserGlobals = new Set(
  'fetch window document navigator location history localStorage FileReader Blob URL AbortController TextDecoder requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval Math Date JSON Object Array String Number Boolean RegExp Error Promise Map Set Infinity NaN undefined parseInt parseFloat isNaN isFinite console globalThis'.split(
    ' '
  )
);
const graph = new Map();
for (const file of files) {
  const source = await readFile(file, 'utf8');
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', ranges: true });
  const scope = analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const missing = [...new Set(scope.globalScope.through.map((r) => r.identifier.name))].filter(
    (n) => !browserGlobals.has(n)
  );
  if (missing.length) throw new Error(`${file}: 未声明的变量 ${missing.join(', ')}`);
  graph.set(
    file,
    ast.body
      .filter((n) => n.type === 'ImportDeclaration')
      .map((n) => path.normalize(path.join(path.dirname(file), n.source.value)))
  );
}
function visit(file, trail = []) {
  if (trail.includes(file)) throw new Error('循环依赖: ' + [...trail, file].join(' → '));
  for (const child of graph.get(file) || []) visit(child, [...trail, file]);
}
for (const file of files) visit(file);
for (const entry of ['src/main.js', 'src/styles/app.css']) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    logLevel: 'silent'
  });
  if (result.warnings.length) throw new Error(result.warnings.map((w) => w.text).join('\n'));
}
console.log(
  `${files.length} JavaScript modules: syntax, imports, declared variables and acyclic dependency graph OK.`
);
