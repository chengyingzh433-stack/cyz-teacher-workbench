import crypto from 'node:crypto';
import type {
  EditableBlock,
  EditableDocument,
  EditableInline,
  QuestionAssetDTO,
} from '../../../shared/qbank/editable';
import type { QbankOcrIssue } from '../../../shared/qbank/types';
import { wordMath } from '../export/word-math';

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: MdNode[];
  ordered?: boolean;
  start?: number;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const safeText = (value: string): string =>
  [...value]
    .filter((char) => {
      const cp = char.codePointAt(0)!;
      return (
        (cp >= 32 || cp === 9 || cp === 10 || cp === 13) &&
        !(cp >= 0xd800 && cp <= 0xdfff) &&
        cp !== 0xfffe &&
        cp !== 0xffff
      );
    })
    .join('');

function normalizeDelimiters(source: string, tree: MdNode): string {
  const codeRanges: Array<[number, number]> = [];
  const visit = (node: MdNode): void => {
    if ((node.type === 'code' || node.type === 'inlineCode') && node.position) {
      codeRanges.push([node.position.start.offset!, node.position.end.offset!]);
    } else {
      node.children?.forEach(visit);
    }
  };
  visit(tree);
  codeRanges.sort((a, b) => a[0] - b[0]);

  let result = '';
  let index = 0;
  let range = 0;
  while (index < source.length) {
    if (codeRanges[range]?.[0] === index) {
      result += source.slice(index, codeRanges[range][1]);
      index = codeRanges[range++][1];
      continue;
    }
    if (source[index] === '\\' && source[index + 1] === '\\') {
      result += '\\\\';
      index += 2;
      continue;
    }
    const opening = source.slice(index, index + 2);
    if (opening === '\\(' || opening === '\\[') {
      const closing = opening === '\\(' ? '\\)' : '\\]';
      const end = source.indexOf(closing, index + 2);
      if (end !== -1 && !codeRanges.some(([start, stop]) => start < end + 2 && stop > index)) {
        const body = source.slice(index + 2, end);
        const longestRun = [...body.matchAll(/\$+/g)].reduce(
          (len, match) => Math.max(len, match[0].length),
          0,
        );
        const delim = '$'.repeat(Math.max(opening === '\\[' ? 2 : 1, longestRun + 1));
        result +=
          opening === '\\['
            ? `\n\n${delim}\n${body}\n${delim}\n\n`
            : `${delim} ${body.replace(/[\r\n]/g, ' ')} ${delim}`;
        index = end + 2;
        continue;
      }
    }
    result += source[index++];
  }
  return result;
}

/** Parse AI / Doc2X Markdown with LaTeX into an EditableDocument + reviewable issues. */
export async function convertMarkdownToDoc(
  rawMarkdown: string,
  resolveImage?: (reference: string) => Promise<QuestionAssetDTO | null>,
): Promise<{ document: EditableDocument; issues: QbankOcrIssue[] }> {
  const [{ unified }, { default: remarkParse }, { default: remarkMath }, { default: remarkGfm }, { Parser }] =
    await Promise.all([
      import('unified'),
      import('remark-parse'),
      import('remark-math'),
      import('remark-gfm'),
      import('htmlparser2'),
    ]);

  const issues: QbankOcrIssue[] = [];
  const addIssue = (kind: QbankOcrIssue['kind'], message: string, original: string) => {
    if (issues.length < 50) {
      issues.push({
        id: crypto.randomUUID(),
        kind,
        message,
        original: safeText(original).slice(0, 2000),
      });
    }
  };

  const clean = safeText(rawMarkdown);
  const baseTree = unified().use(remarkParse).parse(clean) as unknown as MdNode;
  const source = normalizeDelimiters(clean, baseTree);
  const tree = unified().use(remarkParse).use(remarkMath).use(remarkGfm).parse(source) as unknown as MdNode;

  const blocks: EditableBlock[] = [];
  let pending: EditableInline[] = [];

  const original = (node: MdNode): string =>
    source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0) ||
    node.value ||
    '';

  const appendText = (value: string, marks: Array<{ type: 'bold' | 'italic' }> = []) => {
    const parts = safeText(value).split('\n');
    parts.forEach((part, idx) => {
      if (idx) pending.push({ type: 'hardBreak' });
      if (part) pending.push({ type: 'text', text: part, ...(marks.length ? { marks } : {}) });
    });
  };

  const flush = () => {
    if (pending.length) {
      blocks.push({ type: 'paragraph', content: pending });
      pending = [];
    }
  };

  const addImage = async (reference: string, label = '') => {
    flush();
    const asset = resolveImage ? await resolveImage(reference) : null;
    if (!asset) {
      addIssue('missing_image', '配图未直接获取，请从原图框选裁剪补充', reference);
      appendText(`【配图待补：${label || reference}】`);
      flush();
      return;
    }
    blocks.push({
      type: 'image',
      attrs: {
        assetId: asset.id,
        widthPercent: 55,
        align: 'center',
        caption: safeText(label).slice(0, 400),
      },
    });
  };

  const addFormula = async (latex: string) => {
    const trimmed = latex.trim();
    if (!trimmed) return;
    try {
      await wordMath(trimmed, '识别结果');
      pending.push({ type: 'inlineMath', attrs: { latex: trimmed } });
    } catch {
      addIssue('formula', '该公式含特殊宏命令，已先按原 LaTeX 保留，请核对后导出', trimmed);
      pending.push({ type: 'inlineMath', attrs: { latex: trimmed } });
    }
  };

  const parseHtml = async (value: string) => {
    const tokens: Array<{ type: 'text' | 'image'; value: string; alt?: string }> = [];
    let isTable = false;
    const parser = new Parser(
      {
        onopentag(name, attrs) {
          if (name === 'table') isTable = true;
          else if (name === 'img') tokens.push({ type: 'image', value: attrs.src ?? '', alt: attrs.alt });
          else if (name === 'br') tokens.push({ type: 'text', value: '\n' });
        },
        ontext(text) {
          tokens.push({ type: 'text', value: text });
        },
        onclosetag(name) {
          if (['p', 'div'].includes(name)) tokens.push({ type: 'text', value: '\n' });
        },
      },
      { decodeEntities: true },
    );
    parser.write(value);
    parser.end();
    if (isTable) {
      addIssue('table', '表格暂不支持结构化编辑，已保留文本内容', value);
      appendText(value);
      return;
    }
    for (const token of tokens) {
      if (token.type === 'image') await addImage(token.value, token.alt);
      else appendText(token.value);
    }
  };

  const walk = async (node: MdNode, marks: Array<{ type: 'bold' | 'italic' }> = [], depth = 0) => {
    if (depth > 48) return;
    switch (node.type) {
      case 'text':
        appendText(node.value ?? '', marks);
        break;
      case 'break':
        pending.push({ type: 'hardBreak' });
        break;
      case 'inlineMath':
        await addFormula(node.value ?? '');
        break;
      case 'math':
        flush();
        await addFormula(node.value ?? '');
        flush();
        break;
      case 'image':
        await addImage(node.url ?? '', node.alt);
        break;
      case 'html':
        await parseHtml(node.value ?? '');
        break;
      case 'strong':
      case 'emphasis': {
        const type: 'bold' | 'italic' = node.type === 'strong' ? 'bold' : 'italic';
        const next: Array<{ type: 'bold' | 'italic' }> = marks.some((m) => m.type === type)
          ? marks
          : [...marks, { type }];
        for (const child of node.children ?? []) await walk(child, next, depth + 1);
        break;
      }
      case 'paragraph':
      case 'heading':
        for (const child of node.children ?? []) {
          await walk(child, node.type === 'heading' ? [{ type: 'bold' }] : marks, depth + 1);
        }
        flush();
        break;
      case 'root':
      case 'blockquote':
      case 'listItem':
        for (const child of node.children ?? []) await walk(child, marks, depth + 1);
        flush();
        break;
      case 'list':
        for (const [idx, child] of (node.children ?? []).entries()) {
          flush();
          appendText(node.ordered ? `${(node.start ?? 1) + idx}. ` : '• ');
          await walk(child, marks, depth + 1);
        }
        break;
      case 'table':
        addIssue('table', '表格暂不支持结构化编辑，已保留原文', original(node));
        appendText(original(node));
        flush();
        break;
      case 'inlineCode':
      case 'code':
        appendText(node.value ?? '');
        if (node.type === 'code') flush();
        break;
      default:
        appendText(original(node));
        flush();
    }
  };

  await walk(tree);
  flush();

  if (!blocks.length) {
    blocks.push({
      type: 'paragraph',
      content: [{ type: 'text', text: '【未识别到有效文字，请对照原图手动补充】' }],
    });
    addIssue('conversion', '识别返回为空，请检查图片清晰度或选区', rawMarkdown);
  }
  return { document: { type: 'doc', content: blocks }, issues };
}
