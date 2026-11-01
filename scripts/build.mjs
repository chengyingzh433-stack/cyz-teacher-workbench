import { embedPixelAssets } from './asset-bundle.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const js = await build({
  entryPoints: ['src/main.js'],
  plugins: [embedPixelAssets],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'inline'
});
const css = await build({
  entryPoints: ['src/styles/app.css'],
  bundle: true,
  write: false,
  minify: true,
  legalComments: 'inline'
});
let html = await readFile('index.html', 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>/g, '');
html = html.replace(
  '</head>',
  () => '<style>' + css.outputFiles[0].text.replace(/<\/style/gi, '<\\/style') + '</style>\n</head>'
);
html = html.replace(
  /<script type="module" src="[^\"]+"><\/script>/,
  () =>
    '<!-- Modified edition: modular architecture and Teacher Studio interface. Original author: @赛博老爸. See LICENSE. -->\n<script>' +
    js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') +
    '</script>'
);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
await copyFile('LICENSE', 'dist/LICENSE');
console.log('Built dist/index.html — 可独立打开的单文件版本（保留非商业许可）。');
