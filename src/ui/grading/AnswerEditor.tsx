import { useState } from 'react';
import type { WorkbenchStore } from '../../app/store';
import { activeMembers } from '../../app/model';
import { latestSubmission, saveSubmission, type Item } from '../../modules/grading';
import { prepareBatch, checkPreparationBudget, transformAsset, type PreparedAsset } from '../../modules/assets/prepare';
import type { AnswerAsset } from '../../modules/grading/model';
import { Modal, ErrorText } from '../Modal';
import { Badge, Dropzone } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, BlobImage, VisualCropper, useDraftWarning } from './shared';

export function AnswerEditor({ store, item, classId, close }: { store: WorkbenchStore; item: Item; classId: string; close: () => void }) {
  const [base] = useState(() => store.getState());
  const [token] = useState(store.token());
  const snapshot = base.snapshot!, g = snapshot.data.grading;

  const [member, setMember] = useState('');
  const [text, setText] = useState('');
  const [expected, setExpected] = useState('1');
  const [complete, setComplete] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [pending, setPending] = useState<PreparedAsset[]>([]);
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState({ x: '0', y: '0', width: '', height: '' });

  const previous = member ? latestSubmission(g, item.id, member) : undefined;
  const all = [...g.assets, ...pending.map((p) => p.asset)];
  const asset = all.find((a) => a.id === pages[index]);
  const blob = asset ? pending.find((p) => p.asset.id === asset.id)?.blob || base.files.get(asset.hash) : undefined;

  useDraftWarning(dirty);
  const changed = () => { setDirty(true); setComplete(false); };
  const leave = () => { if (!busy && (!dirty || window.confirm('答卷整理尚未保存，确定放弃？'))) close(); };

  function selectMember(value: string) {
    if (dirty && !window.confirm('切换学生会放弃当前未保存的整理，继续？')) return;
    const prior = latestSubmission(g, item.id, value);
    setMember(value); setPages(prior?.assetIds || []); setText(prior?.text || '');
    setExpected(String(prior?.expectedPages ?? 1)); setPending([]);
    setComplete(false); setDirty(false); setIndex(0); setCropping(false); setError('');
  }

  async function transform(change: AnswerAsset['transforms'][number]) {
    if (!asset || !blob) return;
    setBusy(true); setError('');
    try {
      const derived = await transformAsset({ asset, blob }, change);
      checkPreparationBudget([...all, derived.asset]);
      setPending([...pending, derived]);
      setPages(pages.map((p, i) => (i === index ? derived.asset.id : p)));
      setCropping(false); changed();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError('');
    try {
      if (!/^\d{1,3}$/.test(expected) || Number(expected) > 100) throw new Error('预期页数须为 0—100 的整数');
      const keep = new Set(pages);
      for (const page of pages) { const a = all.find((x) => x.id === page); if (a?.originalId) keep.add(a.originalId); }
      const additions = pending.filter((p) => keep.has(p.asset.id));
      await applyEdit(
        store,
        token,
        (s) => saveSubmission(s, { itemId: item.id, membershipId: member, text, assetIds: pages, expectedPages: Number(expected), complete, previousId: previous?.id || null }, additions.map((p) => p.asset)),
        new Map(additions.map((p) => [p.asset.hash, p.blob])),
      );
      setDirty(false); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title={`上传与整理答卷 · 第 ${item.label} 题`}
      subtitle="选定学生并拖入照片，支持旋转和鼠标框选裁剪"
      wide
      onClose={leave}
      footer={
        <div className="row between" style={{ width: '100%' }}>
          <span className="tip">{pages.length ? `已上传 ${pages.length} 页` : '支持照片或纯文字转录'}</span>
          <div className="row">
            <button type="button" onClick={leave}>取消</button>
            <button type="button" className="primary" disabled={!member || busy} onClick={() => void save()}>
              {busy ? '保存中…' : complete ? '保存并标记为可评分' : '暂存为待处理'}
            </button>
          </div>
        </div>
      }
    >
      <fieldset disabled={busy} className="fields col">
        <label className="tight">
          选择对应学生
          <select value={member} onChange={(e) => selectMember(e.target.value)}>
            <option value="">— 请选择本班学生 —</option>
            {activeMembers(snapshot, classId).map((m) => (
              <option value={m.id} key={m.id}>{m.rosterNo || '无编号'} · {snapshot.data.students.find((s) => s.id === m.studentId)?.name}</option>
            ))}
          </select>
        </label>

        {previous && <div className="alert tone-info">已有作答 v{previous.version}，本次将保存为 v{previous.version + 1}（旧版本保留）。</div>}

        <Dropzone
          accept="image/jpeg,image/png"
          multiple
          disabled={!member || busy}
          title={member ? '拖入答卷照片（JPG / PNG，支持多页）' : '请先选定学生后再上传'}
          hint="按选择顺序排列；损坏文件会自动拦截"
          onFiles={async (files) => {
            if (!files.length) return;
            setBusy(true); setError('');
            try {
              if (pages.length + files.length > 100) throw new Error('一份作答最多 100 页');
              const batch = await prepareBatch(files, 'answer', all);
              setPending([...pending, ...batch]); setPages([...pages, ...batch.map((p) => p.asset.id)]); changed();
            } catch (err) { setError('本批图片未加入：' + (err as Error).message); }
            finally { setBusy(false); }
          }}
        />

        {pages.length > 0 && (
          <div className="soft-card col">
            <div className="row between">
              <div className="row">
                {pages.map((p, i) => (
                  <button type="button" key={p} className={`pill ${i === index ? 'active' : ''}`} onClick={() => { setIndex(i); setCropping(false); }}>第 {i + 1} 页</button>
                ))}
              </div>
              <div className="row">
                <button type="button" className="sm" disabled={index === 0} onClick={() => { const n = [...pages]; [n[index - 1], n[index]] = [n[index], n[index - 1]]; setPages(n); setIndex(index - 1); changed(); }}><Icon name="chevronLeft" size={14} />前移</button>
                <button type="button" className="sm" disabled={index === pages.length - 1} onClick={() => { const n = [...pages]; [n[index + 1], n[index]] = [n[index], n[index + 1]]; setPages(n); setIndex(index + 1); changed(); }}>后移<Icon name="chevronRight" size={14} /></button>
                <button type="button" className="sm ghost-danger" onClick={() => { setPages(pages.filter((_, i) => i !== index)); setIndex(0); setCropping(false); changed(); }}><Icon name="trash" size={14} /></button>
              </div>
            </div>

            {asset && (
              <div className="row between">
                <Badge>{asset.originalId ? '已调整' : '原图'} · {asset.width}×{asset.height}</Badge>
                <div className="row">
                  <button type="button" className="sm" onClick={() => void transform({ kind: 'rotate', degrees: 90 })}><Icon name="rotate" size={13} />旋转 90°</button>
                  <button type="button" className={`sm ${cropping ? 'primary' : ''}`} onClick={() => setCropping((v) => !v)}><Icon name="crop" size={13} />{cropping ? '退出裁剪' : '鼠标框选裁剪'}</button>
                </div>
              </div>
            )}

            {cropping && asset ? (
              <VisualCropper blob={blob} naturalWidth={asset.width} naturalHeight={asset.height} disabled={busy} onCancel={() => setCropping(false)} onApply={(r) => void transform({ kind: 'crop', ...r })} />
            ) : <BlobImage blob={blob} label={`第 ${index + 1} 页预览`} />}

            {asset && (
              <div className="row">
                <details className="subtle" style={{ flex: 1 }}>
                  <summary>进阶：精确像素裁剪</summary>
                  <div className="row" style={{ marginTop: 6 }}>
                    {(['x', 'y', 'width', 'height'] as const).map((k) => (
                      <label className="compact-input" key={k}>{{ x: 'x', y: 'y', width: '宽', height: '高' }[k]}<input type="number" min={0} value={crop[k]} onChange={(e) => setCrop({ ...crop, [k]: e.target.value })} /></label>
                    ))}
                    <button type="button" className="sm" onClick={() => void transform({ kind: 'crop', x: Number(crop.x), y: Number(crop.y), width: Number(crop.width), height: Number(crop.height) })}>应用</button>
                  </div>
                </details>
                {asset.originalId && (
                  <details className="subtle" style={{ flex: 1 }}>
                    <summary>查看拍摄原图</summary>
                    <BlobImage blob={(() => { const o = all.find((a) => a.id === asset.originalId); return o ? pending.find((p) => p.asset.id === o.id)?.blob || base.files.get(o.hash) : undefined; })()} label="拍摄原图" />
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {new Set(pages.map((p) => all.find((a) => a.id === p)?.hash)).size < pages.length && (
          <div className="alert tone-warning">检测到内容完全相同的页面，请确认是否重复上传。</div>
        )}

        <div className="form-row">
          <label className="tight" style={{ flex: 3 }}>文字作答 / 转录（选填）<textarea rows={2} value={text} maxLength={20000} onChange={(e) => { setText(e.target.value); changed(); }} /></label>
          <label className="tight" style={{ maxWidth: 160 }}>预期页数(纯文填0)<input type="number" min={0} max={100} value={expected} onChange={(e) => { setExpected(e.target.value); changed(); }} /></label>
        </div>

        <label className="confirm-box">
          <input type="checkbox" checked={complete} onChange={(e) => { setComplete(e.target.checked); setDirty(true); }} />
          <span>已核对学生、题号、页序和清晰度，这份答卷完整可以进入评分</span>
        </label>
        <ErrorText message={error} />
      </fieldset>
    </Modal>
  );
}
