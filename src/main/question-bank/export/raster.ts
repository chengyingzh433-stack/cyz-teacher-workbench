import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import pptxgen from 'pptxgenjs';
import { parseDocument } from 'htmlparser2';
import { AppError } from '../../../shared/types';
import {
  extractDocumentPlainText,
  hasEditableContent,
  type EditableDocument,
  type WordExportOptions,
} from '../../../shared/qbank/editable';
import {
  normalizeWordOptions,
  readExportSnapshot,
  writeExportAtomic,
  type SnapshotQuestion,
  type SourceImage,
} from './docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let activeRasterExport = false;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const dataImageUrl = (image: SourceImage): string =>
  `data:image/${image.type === 'jpg' ? 'jpeg' : 'png'};base64,${image.bytes.toString('base64')}`;

export function resolveChineseFontPath(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'resources', 'fonts', 'NotoSansSC-Regular.ttf'),
    path.join(process.resourcesPath || '', 'fonts', 'NotoSansSC-Regular.ttf'),
    path.resolve(__dirname, '../../../resources/fonts/NotoSansSC-Regular.ttf'),
    path.resolve(__dirname, '../../resources/fonts/NotoSansSC-Regular.ttf'),
    path.resolve(process.cwd(), 'resources/fonts/NotoSansSC-Regular.ttf'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new AppError('FONT_MISSING', '导出所需中文字体 NotoSansSC-Regular.ttf 缺失');
}

function safeMathMarkup(markup: string): string {
  const allowed = new Set(['span', 'svg', 'path', 'g', 'line', 'rect', 'use']);
  type Node = ReturnType<typeof parseDocument>['children'][number];
  const visit = (node: Node): string => {
    if (node.type === 'text') return escapeHtml(node.data);
    if (!('children' in node)) return '';
    if (!('name' in node) || !allowed.has(node.name.toLowerCase())) {
      return node.children.map(visit).join('');
    }
    const attrs = Object.entries(node.attribs)
      .filter(
        ([name, value]) =>
          /^(class|style|viewbox|preserveAspectRatio|d|width|height|fill|stroke|xmlns|transform|x|y|x1|y1|x2|y2|stroke-width|aria-hidden)$/i.test(
            name,
          ) && !/(?:url\s*\(|javascript:|@import|expression\s*\()/i.test(value),
      )
      .map(([name, value]) => ` ${name === 'viewbox' ? 'viewBox' : name}="${escapeHtml(value)}"`)
      .join('');
    return `<${node.name}${attrs}>${node.children.map(visit).join('')}</${node.name}>`;
  };
  return parseDocument(markup, { lowerCaseAttributeNames: false }).children.map(visit).join('');
}

async function documentHtml(doc: EditableDocument, question: SnapshotQuestion): Promise<string> {
  const { convertLatexToMarkup, validateLatex } = await import('mathlive');
  return doc.content
    .map((block) => {
      if (block.type === 'image') {
        const img = question.assets.get(block.attrs.assetId);
        if (!img) return '';
        return `<figure style="text-align:${block.attrs.align}"><img style="width:${block.attrs.widthPercent}%;height:auto" src="${dataImageUrl(img)}">${block.attrs.caption ? `<figcaption>${escapeHtml(block.attrs.caption)}</figcaption>` : ''}</figure>`;
      }
      const html = (block.content ?? [])
        .map((node) => {
          if (node.type === 'hardBreak') return '<br>';
          if (node.type === 'inlineMath') {
            if (validateLatex(node.attrs.latex).length) {
              return `<code>${escapeHtml(node.attrs.latex)}</code>`;
            }
            return `<span class="math-atom">${safeMathMarkup(convertLatexToMarkup(node.attrs.latex))}</span>`;
          }
          let val = escapeHtml(node.text);
          if (node.marks?.some((m) => m.type === 'bold')) val = `<strong>${val}</strong>`;
          if (node.marks?.some((m) => m.type === 'italic')) val = `<em>${val}</em>`;
          return val;
        })
        .join('');
      return `<p>${html || '<br>'}</p>`;
    })
    .join('');
}

async function partHtml(question: SnapshotQuestion, answer: boolean): Promise<string> {
  const content = question.content;
  if (content && (answer ? content.answerMode : content.questionMode) === 'editable') {
    const body = answer ? content.answerBody : content.questionBody;
    if (!hasEditableContent(body)) {
      return answer ? '<p class="muted">（暂无参考答案）</p>' : '<p class="muted">（空白题目）</p>';
    }
    return documentHtml(body, question);
  }
  const original = answer ? question.answerOriginal : question.original;
  if (original) return `<figure class="original"><img src="${dataImageUrl(original)}"></figure>`;
  return answer ? '<p class="muted">（暂无参考答案）</p>' : '<p class="muted">（暂无题目内容）</p>';
}

function buildFontStyles(): string {
  const require = createRequire(import.meta.url);
  const staticPath = require.resolve('mathlive/static.css');
  const mathDir = path.dirname(staticPath);
  const inlineUrls = (css: string): string =>
    css.replace(/url\(([^)]+)\)/g, (_all, raw: string) => {
      const cleaned = raw.replace(/["']/g, '').split('?')[0];
      if (cleaned.startsWith('data:')) return _all;
      const name = path.basename(cleaned);
      const file = path.join(mathDir, 'fonts', name);
      if (!fs.existsSync(file)) return _all;
      return `url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')})`;
    });
  const staticCss = inlineUrls(fs.readFileSync(staticPath, 'utf8'));
  const chineseFont = resolveChineseFontPath();
  return `${staticCss}\n@font-face{font-family:ExportChinese;src:url(data:font/ttf;base64,${fs.readFileSync(chineseFont).toString('base64')})}`;
}

const PAGINATION_SCRIPT = `
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(async img => { await img.decode().catch(() => {}); }));
  const flow = document.getElementById('flow');
  const viewport = document.getElementById('viewport');
  const bounds = flow.getBoundingClientRect();
  const capacity = viewport.clientHeight;
  const bands = [];
  const add = r => { if (r.height > 0 && r.width > 0) bands.push([r.top - bounds.top, r.bottom - bounds.top]); };
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement && node.parentElement.closest('.math-atom')) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const rect of range.getClientRects()) add(rect);
  }
  for (const node of flow.querySelectorAll('.math-atom, figure')) {
    const rect = node.getBoundingClientRect();
    if (node.matches('.math-atom') || rect.height <= capacity) add(rect);
  }
  const sections = [...flow.querySelectorAll('.question-section')].map(el => ({
    start: el.offsetTop, end: el.offsetTop + el.offsetHeight, label: el.dataset.label,
    newPage: el.dataset.newPage === 'true'
  }));
  const forced = sections.filter(s => s.newPage).map(s => s.start);
  const pages = []; let offset = 0; const height = Math.max(1, flow.scrollHeight);
  while (offset < height) {
    if (pages.length >= 200) break;
    let end = Math.min(height, offset + capacity);
    const force = forced.find(y => y > offset + 1 && y < end);
    if (force !== undefined) end = force;
    let adjusted = true;
    while (adjusted) {
      adjusted = false;
      for (const [top, bottom] of bands) {
        if (top < end - 0.1 && bottom > end + 0.1 && top > offset + 1) { end = top; adjusted = true; }
      }
    }
    if (end - offset < 2) end = Math.min(height, offset + capacity);
    const section = sections.find(s => s.start < offset - 1 && s.end > offset + 1);
    pages.push({ offset, height: end - offset, continuation: section ? section.label + '（续）' : '' });
    offset = end;
  }
  return pages;
})()`;

/** Electron offscreen high-fidelity raster renderer (supports full MathLive equations + Chinese + figures). */
async function renderElectronRaster(
  format: 'pdf' | 'pptx',
  questions: SnapshotQuestion[],
  options: WordExportOptions,
): Promise<Buffer> {
  const { BrowserWindow } = await import('electron');
  if (activeRasterExport) throw new AppError('BUSY', '已有 PDF/PPTX 导出正在进行，请稍候');
  activeRasterExport = true;
  let win: InstanceType<typeof BrowserWindow> | undefined;
  let tempDir: string | undefined;

  try {
    const width = format === 'pdf' ? 1200 : 1600;
    const height = format === 'pdf' ? 1697 : 900;
    const unit = format === 'pdf' ? width / 595.28 : width / 720;
    const margin = Math.round(format === 'pdf' ? (width * options.marginMm) / 210 : (width * options.marginMm) / 297);
    const fontSize = options.fontSize * unit;
    const headerHeight = Math.ceil(fontSize * 2.7);
    const footerHeight = Math.ceil(fontSize * 1.5);
    const capacity = height - margin * 2 - headerHeight - footerHeight;

    const sections: string[] = [];
    for (const [index, q] of questions.entries()) {
      sections.push(
        `<section class="question-section" data-label="第 ${escapeHtml(q.number)} 题" data-new-page="${index > 0 && (format === 'pptx' || options.questionStartNewPage)}">${q.groupHeader ? `<h2>${escapeHtml(q.groupHeader)}</h2>` : ''}<p class="question-number">${escapeHtml(q.number)}.</p>${await partHtml(q, false)}${options.answerMode === 'inline' ? `<h3>参考答案</h3>${await partHtml(q, true)}` : ''}</section>`,
      );
    }
    if (options.answerMode === 'append') {
      for (const [index, q] of questions.entries()) {
        sections.push(
          `<section class="question-section" data-label="第 ${escapeHtml(q.number)} 题答案" data-new-page="${index === 0 || format === 'pptx'}">${index === 0 ? '<h2>参考答案</h2>' : ''}<p class="question-number">${escapeHtml(q.number)}.</p>${await partHtml(q, true)}</section>`,
        );
      }
    }

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cyz-qbank-export-'));
    const htmlPath = path.join(tempDir, 'document.html');
    await fsp.writeFile(
      htmlPath,
      `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${buildFontStyles()}
      *{box-sizing:border-box}html,body{margin:0;background:white;color:#111;overflow:hidden}body{width:${width}px;height:${height}px;font:${fontSize}px/1.65 ExportChinese,'Times New Roman',serif;padding:${margin}px}
      #header{height:${headerHeight}px;overflow:hidden;font-size:${fontSize * 0.9}px;line-height:1.4}#header strong{font-size:${fontSize * 1.15}px}#continuation{float:right}#viewport{height:${capacity}px;overflow:hidden;position:relative}#flow{position:relative;display:flow-root;transform-origin:top left}#footer{height:${footerHeight}px;text-align:center;font-size:${fontSize * 0.7}px;line-height:2}
      .question-section{position:relative;display:flow-root;padding-bottom:${options.questionSpacing * unit}px}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 .5em}h2,h3{font-size:1.1em;margin:0 0 .5em}.question-number{font-weight:bold;margin:0 0 .25em}figure{margin:0 0 .5em}figure img{max-width:100%;height:auto;vertical-align:top}figure.original img{width:100%;max-height:none}figcaption{font-size:.85em;line-height:1.4}.math-atom{display:inline-block;white-space:nowrap}.muted{color:#666}
      </style></head><body><div id="header"><span id="continuation"></span><strong>${escapeHtml(options.title)}</strong>${options.subtitle ? `<br>${escapeHtml(options.subtitle)}` : ''}</div><div id="viewport"><div id="flow">${sections.join('')}</div></div><div id="footer"></div></body></html>`,
      'utf8',
    );

    win = new BrowserWindow({
      show: false,
      width,
      height,
      useContentSize: true,
      enableLargerThanScreen: true,
      focusable: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        partition: `qbank-export-${Date.now()}`,
      },
    });
    const web = win.webContents;
    const localUrl = pathToFileURL(htmlPath).href;
    web.session.webRequest.onBeforeRequest((details, cb) =>
      cb({ cancel: details.url !== localUrl && !details.url.startsWith('data:') }),
    );
    win.setContentSize(width, height);
    await win.loadFile(htmlPath);

    const pages = (await web.executeJavaScript(PAGINATION_SCRIPT)) as Array<{
      offset: number;
      height: number;
      continuation: string;
    }>;

    const pdf = format === 'pdf' ? await PDFDocument.create() : null;
    const ppt = format === 'pptx' ? new pptxgen() : null;
    if (ppt) {
      ppt.layout = 'LAYOUT_WIDE';
      ppt.title = options.title;
      ppt.author = 'cyz的教师工作台 · 物理题库';
    }

    for (const [index, page] of pages.entries()) {
      await web.executeJavaScript(
        `document.getElementById('flow').style.transform='translateY(-${page.offset}px)';document.getElementById('viewport').style.height='${page.height}px';document.getElementById('footer').style.position='absolute';document.getElementById('footer').style.bottom='${margin}px';document.getElementById('footer').style.left='${margin}px';document.getElementById('footer').style.right='${margin}px';document.getElementById('footer').textContent='${index + 1} / ${pages.length}';document.getElementById('continuation').textContent=${JSON.stringify(page.continuation)};new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      const image = await web.capturePage({ x: 0, y: 0, width, height }, { stayHidden: true, stayAwake: true });
      const png = image.toPNG();
      if (pdf) {
        const pic = await pdf.embedPng(png);
        pdf.addPage([595.28, 841.89]).drawImage(pic, { x: 0, y: 0, width: 595.28, height: 841.89 });
      }
      if (ppt) {
        ppt.addSlide().addImage({
          data: `data:image/png;base64,${png.toString('base64')}`,
          x: 0,
          y: 0,
          w: 13.333333,
          h: 7.5,
        });
      }
    }

    return pdf
      ? Buffer.from(await pdf.save())
      : ((await ppt!.write({ outputType: 'nodebuffer' })) as Buffer);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    activeRasterExport = false;
  }
}

/** Pure-Node vector PDF fallback (used by headless unit tests without Electron BrowserWindow). */
export async function composeNodePdfBuffer(
  questions: SnapshotQuestion[],
  rawOptions?: Partial<WordExportOptions>,
): Promise<Buffer> {
  const options = normalizeWordOptions(rawOptions);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(resolveChineseFontPath());
  const font = await pdf.embedFont(fontBytes, { subset: true });

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = (options.marginMm / 25.4) * 72;
  const maxW = pageW - margin * 2;
  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) {
      page = pdf.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  const drawWrapped = (text: string, size: number) => {
    const chars = [...text];
    let line = '';
    for (const ch of chars) {
      if (ch === '\n') {
        ensureSpace(size * 1.5);
        page.drawText(line, { x: margin, y: y - size, size, font, color: rgb(0.08, 0.08, 0.08) });
        y -= size * 1.55;
        line = '';
        continue;
      }
      const next = line + ch;
      if (font.widthOfTextAtSize(next, size) > maxW && line) {
        ensureSpace(size * 1.5);
        page.drawText(line, { x: margin, y: y - size, size, font, color: rgb(0.08, 0.08, 0.08) });
        y -= size * 1.55;
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) {
      ensureSpace(size * 1.5);
      page.drawText(line, { x: margin, y: y - size, size, font, color: rgb(0.08, 0.08, 0.08) });
      y -= size * 1.55;
    }
  };

  drawWrapped(options.title, 18);
  if (options.subtitle) drawWrapped(options.subtitle, 11);
  y -= 8;

  for (const q of questions) {
    if (q.groupHeader) drawWrapped(q.groupHeader, options.fontSize + 1);
    const bodyText = extractDocumentPlainText(q.content?.questionBody) || '（图片题目）';
    drawWrapped(`${q.number}. ${bodyText}`, options.fontSize);
    for (const img of q.assets.values()) {
      const embedded = img.type === 'jpg' ? await pdf.embedJpg(img.bytes) : await pdf.embedPng(img.bytes);
      const scale = Math.min((maxW * 0.5) / img.width, 220 / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ensureSpace(h + 12);
      page.drawImage(embedded, { x: margin, y: y - h, width: w, height: h });
      y -= h + 10;
    }
    y -= options.questionSpacing;
  }

  return Buffer.from(await pdf.save());
}

/** Pure-Node PPTX fallback (used by headless unit tests without Electron BrowserWindow). */
export async function composeNodePptxBuffer(
  questions: SnapshotQuestion[],
  rawOptions?: Partial<WordExportOptions>,
): Promise<Buffer> {
  const options = normalizeWordOptions(rawOptions);
  const ppt = new pptxgen();
  ppt.layout = 'LAYOUT_WIDE';
  ppt.title = options.title;
  ppt.author = 'cyz的教师工作台 · 物理题库';

  for (const q of questions) {
    const slide = ppt.addSlide();
    slide.addText(`${options.title} · 第 ${q.number} 题`, {
      x: 0.5,
      y: 0.3,
      w: 12.3,
      h: 0.5,
      fontSize: 18,
      bold: true,
    });
    const text = extractDocumentPlainText(q.content?.questionBody) || '（图片题目）';
    slide.addText(text, { x: 0.5, y: 0.95, w: 12.3, h: 3.0, fontSize: 14, valign: 'top' });
    const firstImg = q.assets.values().next().value as SourceImage | undefined;
    if (firstImg) {
      const aspect = firstImg.width / Math.max(1, firstImg.height);
      const h = 2.6;
      const w = Math.min(8, h * aspect);
      slide.addImage({
        data: dataImageUrl(firstImg),
        x: 0.5,
        y: 4.1,
        w,
        h,
      });
    }
  }
  return (await ppt.write({ outputType: 'nodebuffer' })) as Buffer;
}

export async function exportBasketPdfToPath(
  db: DatabaseSync,
  vaultPath: string,
  setId: number,
  options: Partial<WordExportOptions>,
  destPath: string,
): Promise<string> {
  const norm = normalizeWordOptions(options);
  const questions = readExportSnapshot(db, vaultPath, setId, norm.answerMode !== 'none', norm.contentSource);
  const buffer = process.versions.electron
    ? await renderElectronRaster('pdf', questions, norm)
    : await composeNodePdfBuffer(questions, norm);
  const finalPath = path.extname(destPath).toLowerCase() === '.pdf' ? destPath : `${destPath}.pdf`;
  await writeExportAtomic(finalPath, buffer);
  return finalPath;
}

export async function exportBasketPptxToPath(
  db: DatabaseSync,
  vaultPath: string,
  setId: number,
  options: Partial<WordExportOptions>,
  destPath: string,
): Promise<string> {
  const norm = normalizeWordOptions(options);
  const questions = readExportSnapshot(db, vaultPath, setId, norm.answerMode !== 'none', norm.contentSource);
  const buffer = process.versions.electron
    ? await renderElectronRaster('pptx', questions, norm)
    : await composeNodePptxBuffer(questions, norm);
  const finalPath = path.extname(destPath).toLowerCase() === '.pptx' ? destPath : `${destPath}.pptx`;
  await writeExportAtomic(finalPath, buffer);
  return finalPath;
}
