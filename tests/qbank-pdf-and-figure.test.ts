import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFigureWidthPercent } from '../src/shared/qbank/editable';
import { extractSelectionText, type PdfTextGlyph } from '../src/shared/qbank/pdf-selection';
import { convertMarkdownToDoc } from '../src/main/question-bank/ocr/markdown-to-doc';

test('PDF 框选提字：消除中文标点前后多余空格，保留英文单词与换行', () => {
  const glyphs: PdfTextGlyph[] = [
    { text: '一', x: 0.10, y: 0.10, end: false, run: 0 },
    { text: '、', x: 0.11, y: 0.10, end: false, run: 1 },
    { text: '物', x: 0.12, y: 0.10, end: false, run: 2 },
    { text: '块', x: 0.13, y: 0.10, end: false, run: 2 },
    { text: '（', x: 0.14, y: 0.10, end: false, run: 3 },
    { text: '质', x: 0.15, y: 0.10, end: false, run: 4 },
    { text: '量', x: 0.16, y: 0.10, end: false, run: 4 },
    { text: '）', x: 0.17, y: 0.10, end: false, run: 5 },
    { text: '，', x: 0.18, y: 0.10, end: false, run: 6 },
    { text: '受', x: 0.19, y: 0.10, end: false, run: 7 },
    { text: '力', x: 0.20, y: 0.10, end: false, run: 7 },
    { text: '。', x: 0.21, y: 0.10, end: false, run: 8 },
    // Next line with ASCII runs
    { text: 'A', x: 0.10, y: 0.14, end: false, run: 9 },
    { text: '.', x: 0.11, y: 0.14, end: false, run: 10 },
    { text: '10', x: 0.14, y: 0.14, end: false, run: 11 },
    { text: 'm/s', x: 0.16, y: 0.14, end: false, run: 12 },
  ];

  const text = extractSelectionText(glyphs, { x: 0.05, y: 0.05, width: 0.5, height: 0.2 });
  assert.equal(text, '一、物块（质量），受力。\nA. 10 m/s');
});

test('小图自适应默认宽比：防止 189×224 等小型物理题图默认铺满 100% 失真', () => {
  const smallPortrait = defaultFigureWidthPercent(189, 224, null);
  assert.ok(smallPortrait >= 20 && smallPortrait <= 40, `Expected 20-40%, got ${smallPortrait}%`);

  const smallCropped = defaultFigureWidthPercent(189, 224, 0.25);
  assert.ok(smallCropped >= 20 && smallCropped <= 40, `Expected 20-40%, got ${smallCropped}%`);

  const wideBanner = defaultFigureWidthPercent(1200, 400, 0.85);
  assert.equal(wideBanner, 70, 'Wide diagram should cap cleanly at 70%');

  assert.equal(smallPortrait % 5, 0, 'Width percentage should snap to 5% increments');
});

test('OCR Markdown 转 EditableDocument：支持 $...$、$$...$$ 与 \\(...\\) 公式解析', async () => {
  const md = [
    '质量为 $m$ 的物体受力满足 \\(F = ma\\)，其动能为：',
    '',
    '$$E_k = \\frac{1}{2}mv^2$$',
  ].join('\n');

  const { document, issues } = await convertMarkdownToDoc(md);
  assert.equal(issues.length, 0);
  const mathLatex = document.content.flatMap((b) =>
    b.type === 'paragraph'
      ? (b.content || []).filter((n) => n.type === 'inlineMath').map((n) => n.attrs.latex)
      : [],
  );
  assert.deepEqual(mathLatex, ['m', 'F = ma', 'E_k = \\frac{1}{2}mv^2']);
});
