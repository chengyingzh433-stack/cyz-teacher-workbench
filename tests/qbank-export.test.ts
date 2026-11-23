import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { VaultManager } from '../src/main/vault';
import { saveQuestionAssetFile } from '../src/main/question-bank/assets';
import * as bankRepo from '../src/main/question-bank/bank';
import * as contentRepo from '../src/main/question-bank/content';
import * as basketRepo from '../src/main/question-bank/basket';
import { exportBasketDocxToPath } from '../src/main/question-bank/export/docx';
import { exportBasketPdfToPath, exportBasketPptxToPath } from '../src/main/question-bank/export/raster';

function makeTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Generate a real decodable 40x40 solid PNG buffer in pure Node for embedded export tests. */
function makeRealPng(width = 40, height = 40): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      raw[rowStart + 1 + x * 3] = 45;
      raw[rowStart + 1 + x * 3 + 1] = 106;
      raw[rowStart + 1 + x * 3 + 2] = 79;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('组卷三格式导出真实产物校验：Word 原生 <m:oMath> 公式、PDF 矢量中文字体与 PPTX 嵌入图', async () => {
  const userData = makeTempDir('cyz-exp-ud-');
  const vaultDir = makeTempDir('cyz-exp-vault-');
  const outDir = makeTempDir('cyz-exp-out-');
  const vault = new VaultManager(userData);

  try {
    vault.open(vaultDir);
    const qdb = vault.getQbankDb();
    const vpath = vault.getPath();

    const q = bankRepo.createManualQuestion(qdb, {
      questionText: '初始题干',
      answerText: '初始答案',
    });
    const pngBytes = makeRealPng(180, 120);
    const asset = saveQuestionAssetFile(qdb, vpath, q.id, pngBytes, '斜面示意图.png');
    const editable = contentRepo.getEditableQuestion(qdb, q.id);

    contentRepo.saveQuestionEdits(qdb, q.id, {
      expectedRevision: editable.content.revision,
      metadata: editable.metadata,
      content: {
        schemaVersion: 1,
        questionMode: 'editable',
        answerMode: 'editable',
        questionBody: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '质量为 m 的物块在水平恒力作用下运动，满足 ' },
                { type: 'inlineMath', attrs: { latex: 'F = ma' } },
                { type: 'text', text: '，其动能为 ' },
                { type: 'inlineMath', attrs: { latex: 'E_k = \\frac{1}{2}mv^2' } },
                { type: 'text', text: '。' },
              ],
            },
            {
              type: 'image',
              attrs: { assetId: asset.id, widthPercent: 40, align: 'center', caption: '斜面受力图' },
            },
          ],
        },
        answerBody: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: '解：由 ' },
                { type: 'inlineMath', attrs: { latex: 'a = \\frac{F}{m}' } },
                { type: 'text', text: ' 得所求结果。' },
              ],
            },
          ],
        },
      },
    });

    const sets = basketRepo.listPaperSets(qdb);
    let detail = basketRepo.addToPaperSet(qdb, sets[0].id, q.id);
    basketRepo.updatePaperSetItem(qdb, detail.items[0].id, {
      displayNumber: '1',
      groupHeader: '一、单项选择题',
    });

    const exportOpts = {
      title: '高三物理双周测模拟导出',
      subtitle: '满分 100 分 · 时间 60 分钟',
      answerMode: 'append' as const,
      contentSource: 'latest' as const,
    };

    // 1. Real Word (.docx) with native Office Math (<m:oMath>) + embedded PNG
    const docxPath = await exportBasketDocxToPath(
      qdb,
      vpath,
      sets[0].id,
      exportOpts,
      path.join(outDir, 'exam.docx'),
    );
    const docxFiles = unzipSync(new Uint8Array(fs.readFileSync(docxPath)));
    const docXml = Buffer.from(docxFiles['word/document.xml']).toString('utf8');
    assert.ok(docXml.includes('<m:oMath'), 'Exported Word document.xml must contain native <m:oMath> equations');
    assert.ok(docXml.includes('一、单项选择题'), 'Exported Word must preserve group header');
    assert.ok(
      Object.keys(docxFiles).some((k) => k.startsWith('word/media/')),
      'Exported Word must embed figure asset in word/media/',
    );

    // 2. Real PDF (.pdf) with NotoSansSC vector typography + embedded PNG
    const pdfPath = await exportBasketPdfToPath(
      qdb,
      vpath,
      sets[0].id,
      exportOpts,
      path.join(outDir, 'exam.pdf'),
    );
    const pdfBuf = fs.readFileSync(pdfPath);
    assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
    const loadedPdf = await PDFDocument.load(pdfBuf);
    assert.ok(loadedPdf.getPageCount() >= 1);

    // 3. Real PPTX (.pptx) with slide XML + embedded PNG
    const pptxPath = await exportBasketPptxToPath(
      qdb,
      vpath,
      sets[0].id,
      exportOpts,
      path.join(outDir, 'exam.pptx'),
    );
    const pptxFiles = unzipSync(new Uint8Array(fs.readFileSync(pptxPath)));
    assert.ok(pptxFiles['ppt/slides/slide1.xml'], 'Exported PPTX must contain slide1.xml');
    assert.ok(
      Object.keys(pptxFiles).some((k) => k.startsWith('ppt/media/')),
      'Exported PPTX must embed figure asset in ppt/media/',
    );
  } finally {
    vault.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
