export type ContentMode = 'original' | 'editable';
export type ImageAlignment = 'left' | 'center' | 'right';
export type ContentSource = 'latest' | 'original' | 'saved';

export type EditableInline =
  | { type: 'text'; text: string; marks?: Array<{ type: 'bold' | 'italic' }> }
  | { type: 'inlineMath'; attrs: { latex: string } }
  | { type: 'hardBreak' };

export type EditableBlock =
  | { type: 'paragraph'; content?: EditableInline[] }
  | {
      type: 'image';
      attrs: { assetId: string; widthPercent: number; align: ImageAlignment; caption: string };
    };

export interface EditableDocument {
  type: 'doc';
  content: EditableBlock[];
}

export interface QuestionContentInput {
  schemaVersion: 1;
  questionMode: ContentMode;
  answerMode: ContentMode;
  questionBody: EditableDocument;
  answerBody: EditableDocument;
}

export interface QuestionContentDTO extends QuestionContentInput {
  questionId: number;
  revision: number;
  updatedAt: string;
}

export interface QuestionAssetDTO {
  id: string;
  questionId: number;
  relPath: string;
  widthPx: number;
  heightPx: number;
  name: string;
}

export interface ContentRevisionDTO {
  revision: number;
  createdAt: string;
  questionMode: ContentMode;
  answerMode: ContentMode;
}

export interface WordExportOptions {
  contentSource: ContentSource;
  title: string;
  subtitle: string;
  answerMode: 'none' | 'append' | 'inline';
  fontSize: number;
  marginMm: number;
  questionSpacing: number;
  questionStartNewPage: boolean;
}

export const DEFAULT_WORD_OPTIONS: WordExportOptions = {
  contentSource: 'latest',
  title: '高三物理练习卷',
  subtitle: '',
  answerMode: 'none',
  fontSize: 12,
  marginMm: 20,
  questionSpacing: 12,
  questionStartNewPage: false,
};

export const emptyDocument = (): EditableDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph' }],
});

export const newQuestionContent = (): QuestionContentInput => ({
  schemaVersion: 1,
  questionMode: 'editable',
  answerMode: 'editable',
  questionBody: emptyDocument(),
  answerBody: emptyDocument(),
});

export function normalizeEditableDocument(
  doc: EditableDocument | null | undefined,
): EditableDocument {
  return doc?.type === 'doc' && Array.isArray(doc.content) && doc.content.length > 0
    ? doc
    : emptyDocument();
}

export function hasEditableContent(doc: EditableDocument | null | undefined): boolean {
  return (doc?.content ?? []).some(
    (block) =>
      block.type === 'image' ||
      block.content?.some((node) =>
        node.type === 'inlineMath'
          ? Boolean(node.attrs.latex.trim())
          : node.type === 'text' && Boolean(node.text.trim()),
      ),
  );
}

/** Build a safe custom-protocol URL for question-bank assets inside the active Vault. */
export function qbankAssetUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  return `workbench-asset://question-bank/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Default display width (%) for an inserted diagram/figure so small physics
 * illustrations stay proportional in the editor, Word, PDF, and 16:9 PPT slides.
 */
export function defaultFigureWidthPercent(
  widthPx: number,
  heightPx: number,
  cropWidthRatio?: number | null,
): number {
  const safeW = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 600;
  const safeH = Number.isFinite(heightPx) && heightPx > 0 ? heightPx : 400;
  const raw =
    cropWidthRatio && Number.isFinite(cropWidthRatio) && cropWidthRatio > 0 && cropWidthRatio <= 1
      ? Math.round((cropWidthRatio / 0.85) * 100)
      : Math.round((safeW / 1200) * 100);
  const aspectCap = safeH > safeW * 0.7 ? Math.round((48 * safeW) / safeH) : 70;
  const clamped = Math.max(20, Math.min(70, Math.min(raw, Math.max(20, aspectCap))));
  return Math.round(clamped / 5) * 5;
}

/** Flatten an EditableDocument into searchable plain text (preserving LaTeX tokens). */
export function extractDocumentPlainText(doc: EditableDocument | null | undefined): string {
  if (!doc?.content?.length) return '';
  const lines: string[] = [];
  for (const block of doc.content) {
    if (block.type === 'image') {
      if (block.attrs.caption?.trim()) lines.push(block.attrs.caption.trim());
      continue;
    }
    const parts: string[] = [];
    for (const node of block.content ?? []) {
      if (node.type === 'text') parts.push(node.text);
      else if (node.type === 'inlineMath') parts.push(node.attrs.latex);
      else if (node.type === 'hardBreak') parts.push('\n');
    }
    const text = parts.join('').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

export function normalizeSearchText(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function textToEditableDocument(rawText: string): EditableDocument {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const blocks: EditableBlock[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    blocks.push({ type: 'paragraph', content: [{ type: 'text', text: trimmed }] });
  }
  return blocks.length > 0 ? { type: 'doc', content: blocks } : emptyDocument();
}
