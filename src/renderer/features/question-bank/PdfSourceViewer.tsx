import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { renderAsync as renderDocxAsync } from 'docx-preview';
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  FileText,
  ImagePlus,
  Type,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { qbankAssetUrl } from '../../../shared/qbank/editable';
import type { IntakeSourceDTO, QbankOcrCrop } from '../../../shared/qbank/types';
import { Badge, Button } from '../../components/ui/primitives';
import { extractSelectionText, pdfTextGlyphs, type PdfTextGlyph } from './pdfSelectionText';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ViewerToolMode = 'text' | 'figure' | 'original';

export function PdfSourceViewer({
  source,
  onExtractedText,
  onCroppedImage,
}: {
  source: IntakeSourceDTO;
  onExtractedText: (text: string) => void;
  onCroppedImage: (payload: {
    bytes: number[];
    cropWidthRatio: number;
    asOriginal: boolean;
  }) => Promise<void>;
}) {
  const [tool, setTool] = useState<ViewerToolMode>('text');
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(source.pageCount || 1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const glyphsRef = useRef<PdfTextGlyph[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const docxHostRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragBoxRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastExtractedRef = useRef('');

  const assetSrc = qbankAssetUrl(source.relPath);

  // Reset state whenever source switches
  useEffect(() => {
    setPageNum(1);
    setStatusHint(null);
    setDragBox(null);
    lastExtractedRef.current = '';
    glyphsRef.current = [];
    if (source.kind !== 'pdf') {
      pdfDocRef.current?.destroy().catch(() => {});
      pdfDocRef.current = null;
      setPageCount(1);
    }
  }, [source.id, source.kind]);

  // Load PDF document
  useEffect(() => {
    if (source.kind !== 'pdf') return;
    let cancelled = false;
    setLoading(true);
    setStatusHint(null);
    (async () => {
      try {
        const resp = await fetch(assetSrc);
        if (!resp.ok) throw new Error(`无法加载 PDF（HTTP ${resp.status}）`);
        const data = new Uint8Array(await resp.arrayBuffer());
        const doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        pdfDocRef.current?.destroy().catch(() => {});
        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        setPageNum(1);
      } catch (err) {
        if (!cancelled) setStatusHint(err instanceof Error ? err.message : 'PDF 加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source.id, source.kind, assetSrc]);

  // Render active PDF page + compute normalized glyphs
  useEffect(() => {
    if (source.kind !== 'pdf' || !pdfDocRef.current || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    setStatusHint(null);
    (async () => {
      try {
        const page = await pdfDocRef.current!.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        const ctx = canvas.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) return;
        glyphsRef.current = await pdfTextGlyphs(page, viewport);
      } catch (err) {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') {
          setStatusHint('页面渲染失败，请切换缩放或重试');
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [source.id, source.kind, pageNum, scale, pageCount]);

  // Render DOCX preview
  useEffect(() => {
    if (source.kind !== 'docx' || !docxHostRef.current) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const resp = await fetch(assetSrc);
        const buf = await resp.arrayBuffer();
        if (cancelled || !docxHostRef.current) return;
        docxHostRef.current.innerHTML = '';
        await renderDocxAsync(buf, docxHostRef.current, undefined, { inWrapper: false });
      } catch {
        if (!cancelled) setStatusHint('DOCX 预览失败，请检查文件格式');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source.id, source.kind, assetSrc]);

  async function finalizeSelection(box: { x: number; y: number; w: number; h: number }, surfaceW: number, surfaceH: number) {
    if (box.w < 10 || box.h < 10 || surfaceW <= 0 || surfaceH <= 0) return;
    const normCrop: QbankOcrCrop = {
      x: Math.max(0, Math.min(1, box.x / surfaceW)),
      y: Math.max(0, Math.min(1, box.y / surfaceH)),
      width: Math.max(0.01, Math.min(1, box.w / surfaceW)),
      height: Math.max(0.01, Math.min(1, box.h / surfaceH)),
    };

    if (tool === 'text' && source.kind === 'pdf') {
      const text = extractSelectionText(glyphsRef.current, normCrop);
      if (!text) {
        setStatusHint('选区内未提取到可选中文本（若是扫描版 PDF，请切到「框选裁图」或截原图后用 AI 转写）');
        return;
      }
      if (text === lastExtractedRef.current) {
        setStatusHint('与刚才提取的文字相同，已避免重复追加；若需再添请换一处选区');
        return;
      }
      lastExtractedRef.current = text;
      setStatusHint(`已提取 ${text.length} 字并追加到当前草稿`);
      onExtractedText(text);
      return;
    }

    // Crop PNG from canvas or image
    const out = document.createElement('canvas');
    if (source.kind === 'pdf' && canvasRef.current) {
      const src = canvasRef.current;
      const sx = Math.round(normCrop.x * src.width);
      const sy = Math.round(normCrop.y * src.height);
      const sw = Math.max(12, Math.round(normCrop.width * src.width));
      const sh = Math.max(12, Math.round(normCrop.height * src.height));
      out.width = sw;
      out.height = sh;
      out.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    } else if (source.kind === 'image' && imgRef.current) {
      const img = imgRef.current;
      const sx = Math.round(normCrop.x * img.naturalWidth);
      const sy = Math.round(normCrop.y * img.naturalHeight);
      const sw = Math.max(12, Math.round(normCrop.width * img.naturalWidth));
      const sh = Math.max(12, Math.round(normCrop.height * img.naturalHeight));
      out.width = sw;
      out.height = sh;
      out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    } else {
      return;
    }

    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    if (!blob) return;
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const asOriginal = tool === 'original';
    await onCroppedImage({ bytes, cropWidthRatio: normCrop.width, asOriginal });
    setStatusHint(
      asOriginal
        ? `已截取原题图快照（${out.width}×${out.height}），入库后支持原图对照与 AI 转写`
        : `已裁剪配图（${out.width}×${out.height}）并按小图自适应比例加入草稿`,
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Viewer Toolbar */}
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]/50 flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] gap-0.5">
          {source.kind === 'pdf' && (
            <button
              type="button"
              onClick={() => {
                setTool('text');
                setStatusHint(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
                tool === 'text'
                  ? 'bg-[var(--bg-surface)] text-[var(--accent)] shadow-sm'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
              }`}
            >
              <Type className="w-3.5 h-3.5" /> 框选提字
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setTool('figure');
              setStatusHint(null);
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
              tool === 'figure'
                ? 'bg-[var(--bg-surface)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            <ImagePlus className="w-3.5 h-3.5" /> 框选配图
          </button>
          <button
            type="button"
            onClick={() => {
              setTool('original');
              setStatusHint(null);
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 cursor-pointer ${
              tool === 'original'
                ? 'bg-[var(--bg-surface)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            <Crop className="w-3.5 h-3.5" /> 截原题快照
          </button>
        </div>

        {source.kind === 'pdf' && (
          <div className="flex items-center gap-1.5 text-xs">
            <Button
              size="xs"
              disabled={pageNum <= 1}
              onClick={() => {
                setPageNum((p) => Math.max(1, p - 1));
                setDragBox(null);
                setStatusHint(null);
              }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="tabular-nums px-1 font-medium">
              第 {pageNum} / {pageCount} 页
            </span>
            <Button
              size="xs"
              disabled={pageNum >= pageCount}
              onClick={() => {
                setPageNum((p) => Math.min(pageCount, p + 1));
                setDragBox(null);
                setStatusHint(null);
              }}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
            <div className="w-px h-4 bg-[var(--border-subtle)] mx-1" />
            <Button size="xs" onClick={() => setScale((s) => Math.max(0.7, Number((s - 0.15).toFixed(2))))}>
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
            <Button size="xs" onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.15).toFixed(2))))}>
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {source.kind === 'docx' && (
          <Button
            size="xs"
            variant="soft"
            onClick={() => {
              const sel = window.getSelection()?.toString().trim();
              if (!sel) {
                setStatusHint('请先在下方 Word 文档中用鼠标划选一段文字，再点此按钮导入草稿');
                return;
              }
              onExtractedText(sel);
              setStatusHint(`已从 Word 选区导入 ${sel.length} 字`);
            }}
          >
            <FileText className="w-3.5 h-3.5" /> 导入选中文字
          </Button>
        )}
      </div>

      {/* Scrollable Page Surface */}
      <div className="flex-1 overflow-auto p-4 bg-[var(--bg-muted)]/60 flex flex-col items-start">
        {loading && (
          <div className="py-12 mx-auto text-xs text-[var(--ink-muted)]">正在渲染试卷源文件…</div>
        )}

        {source.kind === 'pdf' && (
          <div
            data-qbank-pdf-surface="1"
            className="relative mx-auto inline-block shadow-md bg-white select-none cursor-crosshair shrink-0"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              dragStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
              const next = { x: dragStartRef.current.x, y: dragStartRef.current.y, w: 0, h: 0 };
              dragBoxRef.current = next;
              setDragBox(next);
              setStatusHint(null);
            }}
            onPointerMove={(e) => {
              if (!dragStartRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
              const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
              const sx = dragStartRef.current.x;
              const sy = dragStartRef.current.y;
              const next = {
                x: Math.min(sx, cx),
                y: Math.min(sy, cy),
                w: Math.abs(cx - sx),
                h: Math.abs(cy - sy),
              };
              dragBoxRef.current = next;
              setDragBox(next);
            }}
            onPointerUp={(e) => {
              const finalBox = dragBoxRef.current;
              dragStartRef.current = null;
              dragBoxRef.current = null;
              setDragBox(null);
              if (!finalBox) return;
              const rect = e.currentTarget.getBoundingClientRect();
              void finalizeSelection(finalBox, rect.width, rect.height);
            }}
          >
            <canvas ref={canvasRef} className="block" />
            {dragBox && dragBox.w > 3 && (
              <div
                className="absolute border-2 border-[var(--accent)] bg-[var(--accent)]/15 pointer-events-none"
                style={{
                  left: dragBox.x,
                  top: dragBox.y,
                  width: dragBox.w,
                  height: dragBox.h,
                }}
              />
            )}
          </div>
        )}

        {source.kind === 'image' && (
          <div
            className="relative inline-block shadow-md bg-white select-none cursor-crosshair"
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              dragStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
              const next = { x: dragStartRef.current.x, y: dragStartRef.current.y, w: 0, h: 0 };
              dragBoxRef.current = next;
              setDragBox(next);
              setStatusHint(null);
            }}
            onPointerMove={(e) => {
              if (!dragStartRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
              const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
              const sx = dragStartRef.current.x;
              const sy = dragStartRef.current.y;
              const next = {
                x: Math.min(sx, cx),
                y: Math.min(sy, cy),
                w: Math.abs(cx - sx),
                h: Math.abs(cy - sy),
              };
              dragBoxRef.current = next;
              setDragBox(next);
            }}
            onPointerUp={(e) => {
              const finalBox = dragBoxRef.current;
              dragStartRef.current = null;
              dragBoxRef.current = null;
              setDragBox(null);
              if (!finalBox) return;
              const rect = e.currentTarget.getBoundingClientRect();
              void finalizeSelection(finalBox, rect.width, rect.height);
            }}
          >
            <img ref={imgRef} src={assetSrc} alt={source.name} draggable={false} className="max-w-full block" />
            {dragBox && dragBox.w > 3 && (
              <div
                className="absolute border-2 border-[var(--accent)] bg-[var(--accent)]/15 pointer-events-none"
                style={{ left: dragBox.x, top: dragBox.y, width: dragBox.w, height: dragBox.h }}
              />
            )}
          </div>
        )}

        {source.kind === 'docx' && (
          <div
            ref={docxHostRef}
            className="w-full max-w-3xl bg-white text-black p-6 rounded-xl shadow-sm select-text"
          />
        )}
      </div>

      {/* Status / Feedback Bar ALWAYS Below Canvas (prevents mid-drag canvas layout jump!) */}
      <div className="px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11.5px] text-[var(--ink-secondary)] flex items-center justify-between gap-2 shrink-0 min-h-[30px]">
        <span className="truncate">
          {statusHint ||
            (source.kind === 'pdf'
              ? '提示：在试卷页面上直接按住鼠标拖拽框选即可提取文字、裁剪配图或保存原题图快照'
              : source.kind === 'docx'
                ? '提示：划选 Word 文本后点击上方「导入选中文字」加入右侧草稿'
                : '提示：按住鼠标在图片上拖拽框选即可裁剪配图或原题图')}
        </span>
        <Badge tone="neutral">{source.kind.toUpperCase()}</Badge>
      </div>
    </div>
  );
}
