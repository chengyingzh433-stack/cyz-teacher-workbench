import { useEffect, useMemo, useRef, useState } from 'react';
import { Node, mergeAttributes, type JSONContent } from '@tiptap/core';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { convertLatexToMarkup } from 'mathlive';
import 'mathlive/fonts.css';
import 'mathlive/static.css';
import { Bold, ImagePlus, Italic, Sigma, Trash2 } from 'lucide-react';
import {
  defaultFigureWidthPercent,
  emptyDocument,
  normalizeEditableDocument,
  qbankAssetUrl,
  type EditableBlock,
  type EditableDocument,
  type EditableInline,
  type ImageAlignment,
  type QuestionAssetDTO,
} from '../../../shared/qbank/editable';
import { Button, Input, Modal } from '../../components/ui/primitives';

const PHYSICS_MATH_SNIPPETS: Array<{ label: string; latex: string }> = [
  { label: '分式', latex: '\\frac{a}{b}' },
  { label: '根号', latex: '\\sqrt{2gh}' },
  { label: '牛顿第二', latex: 'F = ma' },
  { label: '加速度', latex: 'a = \\frac{\\Delta v}{\\Delta t}' },
  { label: '动能', latex: 'E_k = \\frac{1}{2}mv^2' },
  { label: '库仑力', latex: 'F = k\\frac{q_1 q_2}{r^2}' },
  { label: '洛伦兹力', latex: 'F = qvB' },
  { label: '科学计数', latex: '\\times 10^{}' },
  { label: '角度 θ', latex: '\\theta' },
  { label: '矢量', latex: '\\vec{v}_0' },
  { label: '欧姆', latex: '\\Omega' },
  { label: '单位 m/s²', latex: '\\mathrm{m/s^2}' },
];

function renderSafeLatexHtml(latex: string): string {
  try {
    return convertLatexToMarkup(latex || '\\square');
  } catch {
    return `<code>${latex}</code>`;
  }
}

function toEditableDocument(json: JSONContent): EditableDocument {
  const blocks: EditableBlock[] = [];
  for (const node of json.content || []) {
    if (node.type === 'image') {
      const attrs = node.attrs || {};
      if (typeof attrs.assetId === 'string' && attrs.assetId) {
        blocks.push({
          type: 'image',
          attrs: {
            assetId: attrs.assetId,
            widthPercent: Math.max(20, Math.min(100, Number(attrs.widthPercent) || 50)),
            align: (['left', 'center', 'right'].includes(String(attrs.align))
              ? attrs.align
              : 'center') as ImageAlignment,
            caption: String(attrs.caption || ''),
          },
        });
      }
      continue;
    }
    const content: EditableInline[] = [];
    for (const child of node.content || []) {
      if (child.type === 'text' && typeof child.text === 'string') {
        const marks = (child.marks || [])
          .filter((m) => m.type === 'bold' || m.type === 'italic')
          .map((m) => ({ type: m.type as 'bold' | 'italic' }));
        content.push(marks.length ? { type: 'text', text: child.text, marks } : { type: 'text', text: child.text });
      } else if (child.type === 'inlineMath') {
        const latex = String(child.attrs?.latex || '').trim();
        if (latex) content.push({ type: 'inlineMath', attrs: { latex } });
      } else if (child.type === 'hardBreak') {
        content.push({ type: 'hardBreak' });
      }
    }
    blocks.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
  }
  return blocks.length ? { type: 'doc', content: blocks } : emptyDocument();
}

export function RichMathEditor({
  value,
  assets,
  questionId,
  onChange,
  onAssetUploaded,
  onNotify,
}: {
  value: EditableDocument;
  assets: QuestionAssetDTO[];
  questionId: number;
  onChange: (doc: EditableDocument) => void;
  onAssetUploaded: (asset: QuestionAssetDTO) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [mathModal, setMathModal] = useState<{
    open: boolean;
    latex: string;
    onApply: (latex: string) => void;
  }>({ open: false, latex: '', onApply: () => {} });

  const assetsMapRef = useRef<Map<string, QuestionAssetDTO>>(new Map());
  assetsMapRef.current = new Map(assets.map((a) => [a.id, a]));

  const onEditMathRef = useRef<(initial: string, apply: (next: string) => void) => void>(() => {});
  onEditMathRef.current = (initial, apply) => {
    setMathModal({ open: true, latex: initial, onApply: apply });
  };

  const extensions = useMemo(() => {
    const InlineMathNode = Node.create({
      name: 'inlineMath',
      group: 'inline',
      inline: true,
      atom: true,
      addAttributes() {
        return { latex: { default: '' } };
      },
      parseHTML() {
        return [{ tag: 'span[data-inline-math]' }];
      },
      renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes({ 'data-inline-math': '1' }, HTMLAttributes)];
      },
      addNodeView() {
        return ReactNodeViewRenderer((props: NodeViewProps) => {
          const latex = String(props.node.attrs.latex || '');
          return (
            <NodeViewWrapper as="span" className="inline-block align-middle mx-0.5">
              <button
                type="button"
                data-math-chip="1"
                onClick={() =>
                  onEditMathRef.current(latex, (next) => {
                    if (!next.trim()) props.deleteNode();
                    else props.updateAttributes({ latex: next.trim() });
                  })
                }
                title="点击编辑公式"
                className="px-1.5 py-0.5 rounded-md bg-[var(--accent-soft)]/70 border border-[var(--accent)]/35 hover:border-[var(--accent)] cursor-pointer inline-flex items-center text-[var(--ink-primary)]"
                dangerouslySetInnerHTML={{ __html: renderSafeLatexHtml(latex) }}
              />
            </NodeViewWrapper>
          );
        });
      },
    });

    const QuestionImageNode = Node.create({
      name: 'image',
      group: 'block',
      atom: true,
      addAttributes() {
        return {
          assetId: { default: '' },
          widthPercent: { default: 50 },
          align: { default: 'center' },
          caption: { default: '' },
        };
      },
      parseHTML() {
        return [{ tag: 'figure[data-qbank-image]' }];
      },
      renderHTML({ HTMLAttributes }) {
        return ['figure', mergeAttributes({ 'data-qbank-image': '1' }, HTMLAttributes)];
      },
      addNodeView() {
        return ReactNodeViewRenderer((props: NodeViewProps) => {
          const assetId = String(props.node.attrs.assetId || '');
          const widthPercent = Number(props.node.attrs.widthPercent || 50);
          const align = String(props.node.attrs.align || 'center') as ImageAlignment;
          const caption = String(props.node.attrs.caption || '');
          const asset = assetsMapRef.current.get(assetId);
          return (
            <NodeViewWrapper className="my-2">
              <div className="p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-muted)]/40 flex flex-col gap-2">
                <div
                  className={`flex ${
                    align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center'
                  }`}
                >
                  {asset ? (
                    <img
                      src={qbankAssetUrl(asset.relPath)}
                      alt={caption || asset.name}
                      style={{ width: `${widthPercent}%` }}
                      className="max-h-72 object-contain rounded-lg bg-white p-1 border border-[var(--border-subtle)]"
                    />
                  ) : (
                    <div className="text-xs text-[var(--danger)] py-4">配图未找到 ({assetId})</div>
                  )}
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px]">
                  <div className="flex items-center gap-1">
                    <span className="text-[var(--ink-muted)]">宽:</span>
                    {[25, 40, 55, 70, 100].map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => props.updateAttributes({ widthPercent: w })}
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          widthPercent === w
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                            : 'bg-[var(--bg-surface)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                        }`}
                      >
                        {w}%
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => props.updateAttributes({ align: a })}
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          align === a
                            ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                            : 'bg-[var(--bg-surface)] text-[var(--ink-secondary)]'
                        }`}
                      >
                        {a === 'left' ? '左' : a === 'right' ? '右' : '中'}
                      </button>
                    ))}
                    <input
                      value={caption}
                      onChange={(e) => props.updateAttributes({ caption: e.target.value })}
                      placeholder="图注（可选）"
                      className="w-28 h-6 px-1.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => props.deleteNode()}
                      className="p-1 rounded text-[var(--danger)] hover:bg-[var(--danger-soft)] cursor-pointer"
                      title="删除配图"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </NodeViewWrapper>
          );
        });
      },
    });

    return [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
      }),
      InlineMathNode,
      QuestionImageNode,
    ];
  }, []);

  const lastSerializedRef = useRef('');

  const editor = useEditor({
    extensions,
    content: normalizeEditableDocument(value),
    editorProps: {
      attributes: {
        class:
          'min-h-[180px] p-3.5 focus:outline-none text-[14px] leading-relaxed text-[var(--ink-primary)]',
      },
    },
    onUpdate({ editor: ed }) {
      const next = toEditableDocument(ed.getJSON());
      lastSerializedRef.current = JSON.stringify(next);
      onChange(next);
    },
  });

  // Sync external document loads (switching question, adopting OCR, restoring revision)
  useEffect(() => {
    if (!editor) return;
    const norm = normalizeEditableDocument(value);
    const serialized = JSON.stringify(norm);
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    editor.commands.setContent(norm, { emitUpdate: false });
  }, [editor, value]);

  async function handleUploadImage(files: FileList | null) {
    if (!files?.length || !editor) return;
    try {
      const file = files[0];
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const asset = await window.workbenchApi.qbank.content.saveAsset(questionId, bytes, file.name);
      onAssetUploaded(asset);
      const widthPercent = defaultFigureWidthPercent(asset.widthPx, asset.heightPx);
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'image',
          attrs: { assetId: asset.id, widthPercent, align: 'center', caption: '' },
        })
        .run();
      onNotify(`已插入配图「${asset.name}」（自动比例 ${widthPercent}%）`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="px-2.5 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-muted)]/60 flex items-center flex-wrap gap-1.5">
        <Button
          size="xs"
          variant={editor?.isActive('bold') ? 'soft' : 'ghost'}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="加粗"
        >
          <Bold className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="xs"
          variant={editor?.isActive('italic') ? 'soft' : 'ghost'}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="斜体"
        >
          <Italic className="w-3.5 h-3.5" />
        </Button>
        <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />
        <Button
          size="xs"
          variant="soft"
          onClick={() =>
            setMathModal({
              open: true,
              latex: '',
              onApply: (latex) => {
                const clean = latex.trim();
                if (!clean || !editor) return;
                const { state } = editor;
                const sel = state.selection;
                const isImageSel =
                  'node' in sel &&
                  (sel as { node?: { type?: { name?: string } } }).node?.type?.name === 'image';
                if (isImageSel) {
                  editor
                    .chain()
                    .insertContentAt(sel.to, {
                      type: 'paragraph',
                      content: [{ type: 'inlineMath', attrs: { latex: clean } }],
                    })
                    .focus()
                    .run();
                } else {
                  const lastIsImage = state.doc.lastChild?.type.name === 'image';
                  if (!editor.isFocused && lastIsImage) {
                    editor
                      .chain()
                      .insertContentAt(state.doc.content.size, {
                        type: 'paragraph',
                        content: [{ type: 'inlineMath', attrs: { latex: clean } }],
                      })
                      .focus()
                      .run();
                  } else {
                    editor
                      .chain()
                      .focus(sel.from)
                      .insertContent({ type: 'inlineMath', attrs: { latex: clean } })
                      .run();
                  }
                }
              },
            })
          }
        >
          <Sigma className="w-3.5 h-3.5" /> 插入公式
        </Button>
        <label className="inline-flex items-center gap-1 h-7 px-2 rounded-lg text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer">
          <ImagePlus className="w-3.5 h-3.5" /> 插入配图
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void handleUploadImage(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <span className="ml-auto text-[11px] text-[var(--ink-muted)]">
          点击公式胶囊可随时修改 LaTeX · 导出 Word 自动转原生可编辑公式
        </span>
      </div>

      {/* TipTap Editor Surface */}
      <div className="flex-1 overflow-y-auto max-h-[420px]">
        <EditorContent editor={editor} />
      </div>

      {/* Formula Editor Modal with Live MathLive Preview */}
      <Modal
        open={mathModal.open}
        onOpenChange={(o) => setMathModal((prev) => ({ ...prev, open: o }))}
        title="物理公式编辑器（LaTeX + MathLive 实时预览）"
        subtitle="支持快捷物理常用符号，导出 Word 时将转为原生 Office 公式（OMML）"
        size="md"
        footer={
          <>
            <Button onClick={() => setMathModal((prev) => ({ ...prev, open: false }))}>取消</Button>
            <Button
              variant="primary"
              onClick={() => {
                mathModal.onApply(mathModal.latex);
                setMathModal((prev) => ({ ...prev, open: false }));
              }}
            >
              确定插入
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] min-h-[72px] flex items-center justify-center text-lg overflow-x-auto">
            {mathModal.latex.trim() ? (
              <span
                dangerouslySetInnerHTML={{ __html: renderSafeLatexHtml(mathModal.latex) }}
              />
            ) : (
              <span className="text-xs text-[var(--ink-muted)]">实时公式预览区（例如 F = ma）</span>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs font-medium">
            LaTeX 公式表达式
            <Input
              autoFocus
              value={mathModal.latex}
              onChange={(e) => setMathModal((prev) => ({ ...prev, latex: e.target.value }))}
              placeholder="例如：F = ma 或 v^2 - v_0^2 = 2ax"
              className="font-mono text-xs"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-[var(--ink-muted)]">高中物理常用公式快捷填充</span>
            <div className="flex flex-wrap gap-1.5">
              {PHYSICS_MATH_SNIPPETS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() =>
                    setMathModal((prev) => ({
                      ...prev,
                      latex: prev.latex ? `${prev.latex} ${s.latex}` : s.latex,
                    }))
                  }
                  className="px-2 py-1 rounded-lg text-[11.5px] bg-[var(--bg-muted)] hover:bg-[var(--bg-hover)] text-[var(--ink-secondary)] cursor-pointer"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
