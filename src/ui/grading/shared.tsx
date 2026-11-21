import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { WorkbenchStore } from '../../app/store';
import { AppError, type Snapshot } from '../../app/model';
import type { AssetFiles } from '../../modules/assets';
import { Icon } from '../Icons';

export async function applyEdit(
  store: WorkbenchStore,
  token: string,
  mutate: (s: Snapshot) => void,
  files: AssetFiles = new Map(),
) {
  await store.edit((s, current) => {
    if (current !== token) throw new AppError('STALE_PREVIEW', '工作区已变化，请重新打开后再提交，未覆盖原资料');
    mutate(s);
  }, files);
}

export function BlobImage({ blob, label }: { blob?: Blob; label: string }) {
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!blob) return setUrl('');
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!blob) return <p className="tip">没有可用图片</p>;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row between">
        <span className="tip">{label}</span>
        <div className="btn-group" role="group" aria-label="图片缩放">
          {[[1, '适配'], [1.5, '150%'], [2, '200%'], [3, '300%']].map(([v, t]) => (
            <button type="button" key={String(v)} className={zoom === v ? 'active' : ''} onClick={() => setZoom(v as number)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="img-scroll">
        {url && <img src={url} alt={label} style={{ width: `${zoom * 100}%`, maxWidth: 'none', display: 'block' }} />}
      </div>
    </div>
  );
}

export function VisualCropper({
  blob,
  naturalWidth,
  naturalHeight,
  disabled,
  onApply,
  onCancel,
}: {
  blob?: Blob;
  naturalWidth: number;
  naturalHeight: number;
  disabled?: boolean;
  onApply: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!blob) return setUrl('');
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  const rel = (e: PointerEvent<HTMLDivElement>) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  };

  const rect = (() => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r || !box || !r.width || !r.height) return null;
    const sx = naturalWidth / r.width, sy = naturalHeight / r.height;
    const x = Math.max(0, Math.round(box.x * sx)), y = Math.max(0, Math.round(box.y * sy));
    return { x, y, width: Math.min(naturalWidth - x, Math.max(1, Math.round(box.w * sx))), height: Math.min(naturalHeight - y, Math.max(1, Math.round(box.h * sy))) };
  })();

  return (
    <div className="cropper">
      <div className="cropper-bar row between">
        <span className="row"><Icon name="crop" size={14} /><strong>在图上拖框选定保留区域</strong></span>
        <div className="row">
          {rect && <span className="tip num">{rect.width} × {rect.height} px</span>}
          <button type="button" className="sm" onClick={onCancel}>退出</button>
          <button type="button" className="sm primary" disabled={disabled || !rect || rect.width < 8 || rect.height < 8} onClick={() => rect && onApply(rect)}>确认裁剪</button>
        </div>
      </div>
      <div
        className="cropper-stage"
        onPointerDown={(e) => {
          if (disabled) return;
          const pt = rel(e);
          if (!pt) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          origin.current = pt;
          setBox({ x: pt.x, y: pt.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!origin.current) return;
          const pt = rel(e);
          if (pt) setBox({ x: Math.min(origin.current.x, pt.x), y: Math.min(origin.current.y, pt.y), w: Math.abs(pt.x - origin.current.x), h: Math.abs(pt.y - origin.current.y) });
        }}
        onPointerUp={() => { origin.current = null; }}
        onPointerCancel={() => { origin.current = null; }}
      >
        <div className="cropper-wrap">
          {url && <img ref={imgRef} src={url} alt="待裁剪答卷" draggable={false} />}
          {box && box.w > 2 && box.h > 2 && <div className="cropper-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        </div>
      </div>
    </div>
  );
}

export function useDraftWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
