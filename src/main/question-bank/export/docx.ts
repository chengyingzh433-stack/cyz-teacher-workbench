import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AlignmentType,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { AppError } from '../../../shared/types';
import {
  DEFAULT_WORD_OPTIONS,
  hasEditableContent,
  type ContentSource,
  type EditableDocument,
  type QuestionContentDTO,
  type WordExportOptions,
} from '../../../shared/qbank/editable';
import { listQuestionAssets, readImageDimensions, resolveSafeQbankPath } from '../assets';
import { getPaperSetDetail } from '../basket';
import { getQuestionContent } from '../content';
import { wordMath } from './word-math';

const MM_TO_TWIPS = 1440 / 25.4;
const MM_TO_PX = 96 / 25.4;
const BODY_FONT = {
  ascii: 'Times New Roman',
  hAnsi: 'Times New Roman',
  eastAsia: '宋体',
  cs: 'Times New Roman',
};

export interface SourceImage {
  bytes: Buffer;
  name: string;
  width: number;
  height: number;
  type: 'png' | 'jpg';
}

export interface SnapshotQuestion {
  id: number;
  number: string;
  groupHeader: string | null;
  content: QuestionContentDTO | null;
  original: SourceImage | null;
  answerOriginal: SourceImage | null;
  assets: Map<string, SourceImage>;
}

export function normalizeWordOptions(input?: Partial<WordExportOptions>): WordExportOptions {
  const merged: WordExportOptions = { ...DEFAULT_WORD_OPTIONS, ...(input || {}) };
  return {
    contentSource:
      merged.contentSource === 'original' || merged.contentSource === 'saved'
        ? merged.contentSource
        : 'latest',
    title: (merged.title || '高三物理练习卷').trim().slice(0, 180) || '高三物理练习卷',
    subtitle: (merged.subtitle || '').trim().slice(0, 300),
    answerMode:
      merged.answerMode === 'inline' || merged.answerMode === 'append' ? merged.answerMode : 'none',
    fontSize: Math.max(8, Math.min(24, Number(merged.fontSize) || 12)),
    marginMm: Math.max(10, Math.min(35, Number(merged.marginMm) || 20)),
    questionSpacing: Math.max(0, Math.min(60, Number(merged.questionSpacing) || 12)),
    questionStartNewPage: Boolean(merged.questionStartNewPage),
  };
}

function readSafeImage(vaultPath: string, relPath: string, name: string): SourceImage {
  const abs = resolveSafeQbankPath(vaultPath, relPath);
  if (!fs.existsSync(abs)) {
    throw new AppError('NOT_FOUND', `导出所需图片不存在：${name}`);
  }
  const bytes = fs.readFileSync(abs);
  const { width, height } = readImageDimensions(bytes);
  const isJpg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  return {
    bytes,
    name: name || path.basename(abs),
    width: Math.max(1, width),
    height: Math.max(1, height),
    type: isJpg ? 'jpg' : 'png',
  };
}

export function resolvePartMode(
  content: QuestionContentDTO | null,
  part: 'question' | 'answer',
  source: ContentSource,
): 'editable' | 'original' {
  const body = part === 'question' ? content?.questionBody : content?.answerBody;
  if (source === 'original') return 'original';
  if (source === 'latest') return hasEditableContent(body) ? 'editable' : 'original';
  return (part === 'question' ? content?.questionMode : content?.answerMode) === 'editable' &&
    hasEditableContent(body)
    ? 'editable'
    : 'original';
}

export function readExportSnapshot(
  db: DatabaseSync,
  vaultPath: string,
  setId: number,
  includeAnswers: boolean,
  source: ContentSource = 'latest',
): SnapshotQuestion[] {
  const detail = getPaperSetDetail(db, setId);
  if (!detail.items.length) {
    throw new AppError('VALIDATION', '组卷篮为空，请先加入至少一道题目');
  }

  return detail.items.map((item, idx) => {
    const number = item.displayNumber.trim() || String(idx + 1);
    const saved = getQuestionContent(db, item.questionId);
    const qMode = resolvePartMode(saved, 'question', source);
    const aMode = includeAnswers ? resolvePartMode(saved, 'answer', source) : 'editable';
    const content = saved
      ? { ...saved, questionMode: qMode, answerMode: aMode }
      : null;

    const assets = new Map<string, SourceImage>();
    if (qMode === 'editable' || (includeAnswers && aMode === 'editable')) {
      const owned = new Map(listQuestionAssets(db, item.questionId).map((a) => [a.id, a]));
      const docs = [
        qMode === 'editable' ? content?.questionBody : undefined,
        includeAnswers && aMode === 'editable' ? content?.answerBody : undefined,
      ];
      for (const doc of docs) {
        for (const block of doc?.content ?? []) {
          if (block.type !== 'image' || assets.has(block.attrs.assetId)) continue;
          const asset = owned.get(block.attrs.assetId);
          if (asset) {
            assets.set(asset.id, readSafeImage(vaultPath, asset.relPath, asset.name));
          }
        }
      }
    }

    const original =
      qMode === 'original' && item.question.imageRelPath
        ? readSafeImage(vaultPath, item.question.imageRelPath, `q_${item.questionId}.png`)
        : null;
    const answerOriginal =
      includeAnswers && aMode === 'original' && item.question.answerImageRelPath
        ? readSafeImage(vaultPath, item.question.answerImageRelPath, `a_${item.questionId}.png`)
        : null;

    return {
      id: item.questionId,
      number,
      groupHeader: item.groupHeader.trim() || null,
      content,
      original,
      answerOriginal,
      assets,
    };
  });
}

interface Layout {
  options: WordExportOptions;
  widthPx: number;
  heightPx: number;
}

const paragraphDefaults = (): Pick<IParagraphOptions, 'spacing' | 'widowControl'> => ({
  spacing: { after: 100, line: 276 },
  widowControl: true,
});

function imageParagraphs(
  image: SourceImage,
  widthPercent: number,
  align: 'left' | 'center' | 'right',
  caption: string,
  layout: Layout,
  location: string,
): Paragraph[] {
  const availableHeight = Math.max(96, layout.heightPx - (caption ? 120 : 80) - layout.options.fontSize * 2);
  const scale = Math.min((layout.widthPx * widthPercent) / 100 / image.width, availableHeight / image.height);
  const alignment =
    align === 'left' ? AlignmentType.LEFT : align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER;
  const result = [
    new Paragraph({
      ...paragraphDefaults(),
      alignment,
      keepNext: Boolean(caption),
      children: [
        new ImageRun({
          type: image.type,
          data: image.bytes,
          transformation: {
            width: Math.max(1, Math.round(image.width * scale)),
            height: Math.max(1, Math.round(image.height * scale)),
          },
          altText: { title: location, description: caption || location, name: image.name },
        }),
      ],
    }),
  ];
  if (caption) {
    result.push(
      new Paragraph({
        ...paragraphDefaults(),
        alignment,
        children: [
          new TextRun({
            text: caption,
            size: Math.max(16, (layout.options.fontSize - 1) * 2),
            color: '555555',
          }),
        ],
      }),
    );
  }
  return result;
}

async function editableParagraphs(
  document: EditableDocument,
  question: SnapshotQuestion,
  layout: Layout,
  location: string,
): Promise<Paragraph[]> {
  const result: Paragraph[] = [];
  let mathIndex = 0;
  for (const block of document.content) {
    if (block.type === 'image') {
      const asset = question.assets.get(block.attrs.assetId);
      if (!asset) continue;
      result.push(
        ...imageParagraphs(
          asset,
          block.attrs.widthPercent,
          block.attrs.align,
          block.attrs.caption,
          layout,
          location,
        ),
      );
      continue;
    }
    const children: ParagraphChild[] = [];
    for (const inline of block.content ?? []) {
      if (inline.type === 'text') {
        children.push(
          new TextRun({
            text: inline.text,
            bold: inline.marks?.some((m) => m.type === 'bold'),
            italics: inline.marks?.some((m) => m.type === 'italic'),
          }),
        );
      } else if (inline.type === 'hardBreak') {
        children.push(new TextRun({ break: 1 }));
      } else {
        children.push(await wordMath(inline.attrs.latex, `${location}第 ${++mathIndex} 个`));
      }
    }
    result.push(new Paragraph({ ...paragraphDefaults(), children }));
  }
  return result;
}

async function questionBody(
  question: SnapshotQuestion,
  answer: boolean,
  layout: Layout,
): Promise<Paragraph[]> {
  const location = `第 ${question.number} 题${answer ? '答案' : ''}`;
  const content = question.content;
  const editable = content && (answer ? content.answerMode : content.questionMode) === 'editable';
  if (editable) {
    const body = answer ? content.answerBody : content.questionBody;
    if (!hasEditableContent(body)) {
      if (answer) {
        return [
          new Paragraph({
            ...paragraphDefaults(),
            children: [new TextRun({ text: '（暂无答案）', color: '777777' })],
          }),
        ];
      }
      throw new AppError('VALIDATION', `${location}内容为空，请补充后再导出`);
    }
    return editableParagraphs(body, question, layout, location);
  }
  const original = answer ? question.answerOriginal : question.original;
  if (!original) {
    if (answer) {
      return [
        new Paragraph({
          ...paragraphDefaults(),
          children: [new TextRun({ text: '（暂无答案）', color: '777777' })],
        }),
      ];
    }
    throw new AppError('VALIDATION', `${location}没有可导出的原图或可编辑正文`);
  }
  return imageParagraphs(original, 100, 'left', '', layout, location);
}

export async function composeDocxBuffer(
  questions: SnapshotQuestion[],
  rawOptions?: Partial<WordExportOptions>,
): Promise<Buffer> {
  const options = normalizeWordOptions(rawOptions);
  const layout: Layout = {
    options,
    widthPx: (210 - options.marginMm * 2) * MM_TO_PX,
    heightPx: (297 - options.marginMm * 2) * MM_TO_PX,
  };
  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { after: 180 },
      children: [new TextRun({ text: options.title, bold: true, size: 36 })],
    }),
  ];
  if (options.subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { after: 240 },
        children: [new TextRun({ text: options.subtitle, size: 22 })],
      }),
    );
  }

  for (const [index, question] of questions.entries()) {
    const newPage = options.questionStartNewPage && index > 0;
    if (question.groupHeader) {
      children.push(
        new Paragraph({
          ...paragraphDefaults(),
          keepNext: true,
          pageBreakBefore: newPage,
          spacing: { before: 160, after: 120 },
          children: [
            new TextRun({
              text: question.groupHeader,
              bold: true,
              size: (options.fontSize + 2) * 2,
            }),
          ],
        }),
      );
    }
    children.push(
      new Paragraph({
        ...paragraphDefaults(),
        keepNext: true,
        pageBreakBefore: newPage && !question.groupHeader,
        children: [new TextRun({ text: `${question.number}.`, bold: true })],
      }),
    );
    children.push(...(await questionBody(question, false, layout)));
    if (options.answerMode === 'inline') {
      children.push(
        new Paragraph({
          ...paragraphDefaults(),
          keepNext: true,
          children: [new TextRun({ text: '参考答案', bold: true })],
        }),
      );
      children.push(...(await questionBody(question, true, layout)));
    }
    if (options.questionSpacing > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 0, after: Math.round(options.questionSpacing * 20), line: 20 },
          children: [new TextRun({ text: '', size: 2 })],
        }),
      );
    }
  }

  if (options.answerMode === 'append') {
    children.push(
      new Paragraph({
        pageBreakBefore: true,
        keepNext: true,
        spacing: { after: 240 },
        children: [new TextRun({ text: '参考答案', size: 32, bold: true })],
      }),
    );
    for (const question of questions) {
      children.push(
        new Paragraph({
          ...paragraphDefaults(),
          keepNext: true,
          spacing: { before: 160, after: 100 },
          children: [new TextRun({ text: `${question.number}.`, bold: true })],
        }),
      );
      children.push(...(await questionBody(question, true, layout)));
    }
  }

  const margin = Math.round(options.marginMm * MM_TO_TWIPS);
  const document = new Document({
    creator: 'cyz的教师工作台 · 物理题库',
    title: options.title,
    description: '由物理题库导出的可编辑组卷',
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: options.fontSize * 2 },
          paragraph: paragraphDefaults(),
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: Math.round(210 * MM_TO_TWIPS),
              height: Math.round(297 * MM_TO_TWIPS),
            },
            margin: { top: margin, bottom: margin, left: margin, right: margin },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}

export async function writeExportAtomic(filePath: string, data: Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.qbank-export-${crypto.randomUUID()}.tmp`);
  try {
    const file = await fsp.open(temp, 'wx', 0o600);
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await fsp.rename(temp, filePath);
  } finally {
    await fsp.rm(temp, { force: true }).catch(() => {});
  }
}

export function sanitizeExportFilename(title: string): string {
  return (
    [...title.replace(/[\\/:*?"<>|\r\n]/g, '_')]
      .slice(0, 60)
      .join('')
      .replace(/[. ]+$/, '') || '物理试卷'
  );
}

export async function exportBasketDocxToPath(
  db: DatabaseSync,
  vaultPath: string,
  setId: number,
  options: Partial<WordExportOptions>,
  destPath: string,
): Promise<string> {
  const norm = normalizeWordOptions(options);
  const questions = readExportSnapshot(db, vaultPath, setId, norm.answerMode !== 'none', norm.contentSource);
  const buffer = await composeDocxBuffer(questions, norm);
  const finalPath = path.extname(destPath).toLowerCase() === '.docx' ? destPath : `${destPath}.docx`;
  await writeExportAtomic(finalPath, buffer);
  return finalPath;
}
