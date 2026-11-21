import { useEffect, useRef, useState } from 'react';
import { downloadBackup, inspectBackupFile, type BackupPreview } from '../modules/backup';
import type { AssetFiles, WorkspaceBundle } from '../modules/assets';
import type { AnswerAsset } from '../modules/grading/model';
import type { WorkbenchStore } from '../app/store';
import { ErrorText } from './Modal';
import { Badge, Dropzone } from './Primitives';
import { Icon } from './Icons';

function AttachmentPreview({ assets, files }: { assets: AnswerAsset[]; files: AssetFiles }) {
  const [selected, setSelected] = useState('');
  const asset = assets.find((a) => a.id === selected) || assets[0];
  const blob = asset ? files.get(asset.hash) : undefined;
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return setUrl('');
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  if (!asset) return null;
  return (
    <details className="subtle" style={{ marginTop: 8 }}>
      <summary>查看备份中的图片（{assets.length} 张）</summary>
      <div className="col" style={{ marginTop: 8 }}>
        <select value={asset.id} onChange={(e) => setSelected(e.target.value)}>
          {assets.map((entry, i) => (
            <option key={entry.id} value={entry.id}>第 {i + 1} 张 · {entry.role === 'answer' ? '答卷' : '参考图'} · {entry.originalId ? '已调整' : '原图'}</option>
          ))}
        </select>
        <span className="tip">{asset.width} × {asset.height} · {(asset.bytes / 1024).toFixed(1)} KiB</span>
        {url && <img src={url} alt="备份图片预览" style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 6 }} />}
      </div>
    </details>
  );
}

export function BackupDialog({ store, done, notify }: { store: WorkbenchStore; done: () => void; notify: (s: string) => void }) {
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const req = useRef(0);
  useEffect(() => () => { req.current++; }, []);

  const state = store.getState();

  async function exportBundle(bundle: WorkspaceBundle, full = false) {
    setBusy(true); setError('');
    try {
      await downloadBackup(bundle.snapshot, bundle.files, full);
      notify('备份文件已开始下载，请在浏览器下载列表确认。');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function inspect(files: File[]) {
    const file = files[0];
    if (!file) return;
    const seq = ++req.current;
    const token = store.token();
    setPreview(null); setConfirmed(false); setPicked(file.name); setBusy(true); setError('');
    try {
      const next = await inspectBackupFile(file, token);
      if (req.current !== seq) return;
      if (store.token() !== token) throw new Error('读取期间工作区已变化，请重选备份');
      setPreview(next);
    } catch (e) { if (req.current === seq) setError((e as Error).message); }
    finally { if (req.current === seq) setBusy(false); }
  }

  async function loadRecovery() {
    const seq = ++req.current;
    const token = store.token();
    setBusy(true); setPreview(null); setConfirmed(false); setError('');
    try {
      const point = await store.recoveryBundle();
      if (!point) throw new Error('暂无替换前恢复点（执行过恢复操作后才会生成）');
      if (req.current !== seq) return;
      if (store.token() !== token) throw new Error('读取期间工作区已变化，请重试');
      setPicked('最近一次替换前自动留存的恢复点');
      setPreview({ ...point, repairs: [], token, exportedAt: '替换前恢复点' });
    } catch (e) { if (req.current === seq) setError((e as Error).message); }
    finally { if (req.current === seq) setBusy(false); }
  }

  return (
    <div className="col">
      <section className="soft-card col">
        <div className="row"><Icon name="shield" size={18} className="text-ok" /><h3>备份当前全部资料</h3></div>
        <p className="tip">日常编辑自动保存在本机浏览器；换电脑、清缓存或升级新版前，请先导出独立存档。</p>
        <div className="col" style={{ alignItems: 'flex-start', gap: 6 }}>
          <button
            type="button"
            className="primary"
            disabled={!state.snapshot || busy}
            onClick={() => { const cur = store.getState(); if (cur.snapshot) void exportBundle({ snapshot: cur.snapshot, files: cur.files }, true); }}
          >
            <Icon name="download" size={15} />{busy ? '打包中…' : '一键导出完整备份（推荐 ZIP）'}
          </button>
          <button
            type="button"
            className="text-btn"
            disabled={!state.snapshot || busy}
            onClick={() => { const cur = store.getState(); if (cur.snapshot) void exportBundle({ snapshot: cur.snapshot, files: cur.files }, false); }}
          >
            导出常规格式（纯班级数据时为 JSON）
          </button>
        </div>
      </section>

      <section className="soft-card col">
        <div className="row"><Icon name="refresh" size={17} /><h3>从备份文件恢复</h3></div>
        <p className="tip">先预览确认再替换；覆盖前系统会自动保留一份可一键回退的恢复点。</p>
        <Dropzone accept=".json,.zip,application/json,application/zip" disabled={busy} fileName={picked} title="拖入 .cyz-backup.zip 或 .cyz.json" hint="原文件不改动" onFiles={(f) => void inspect(f)} />
        <button type="button" className="text-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void loadRecovery()}>
          想反悔？读取最近一次恢复前的自动恢复点
        </button>

        {preview && (
          <div className="card col" style={{ padding: 14, borderColor: '#b9d5c8' }}>
            <div className="row between"><strong>恢复预览</strong><Badge tone="info">{preview.exportedAt}</Badge></div>
            <div className="compare-grid">
              <div><small className="muted">当前工作区</small><strong>{state.snapshot?.data.classes.length || 0} 个班</strong><small>{state.snapshot?.data.students.length || 0} 名学生</small></div>
              <span className="muted">→</span>
              <div className="incoming"><small>即将恢复为</small><strong>{preview.snapshot.data.classes.length} 个班</strong><small>{preview.snapshot.data.students.length} 名学生 · {preview.snapshot.data.seatPlans.length} 套座位</small></div>
            </div>
            <div className="row">
              <Badge>成绩册 {preview.snapshot.data.gradebook.imports.length} 份</Badge>
              <Badge>阅卷 {preview.snapshot.data.grading.exams.length} 场</Badge>
              <Badge>图片 {preview.files?.size || 0} 张</Badge>
            </div>
            <AttachmentPreview assets={preview.snapshot.data.grading.assets} files={preview.files || new Map()} />
            {preview.repairs.length > 0 && (
              <div className="alert tone-warning col">
                <strong>恢复时将自动修复 {preview.repairs.length} 项角色兼容：</strong>
                <ul className="compact-list">{preview.repairs.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </div>
            )}
            <div className="alert tone-warning">恢复将完整替换当前工作区（不会合并），请先确认已备份当前内容。</div>
            <label className="confirm-box">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{state.level === 'memory' ? '我确认仅在本次会话恢复' : '我已核对预览内容，确认替换工作区'}</span>
            </label>
            <div className="dialog-actions" style={{ marginTop: 6 }}>
              <button type="button" disabled={busy} onClick={() => void exportBundle({ snapshot: preview.snapshot, files: preview.files || new Map() })}>另存预览</button>
              <button type="button" disabled={busy} onClick={() => { req.current++; setPreview(null); setPicked(''); setConfirmed(false); }}>取消</button>
              <button
                type="button"
                className="primary"
                disabled={!confirmed || busy || !state.snapshot || state.status === 'load-error'}
                onClick={async () => {
                  setBusy(true); setError('');
                  try { await store.restore(preview, state.level === 'memory'); done(); }
                  catch (e) { setError((e as Error).message); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? '恢复中…' : state.level === 'memory' ? '恢复到本次会话' : '确认应用恢复'}
              </button>
            </div>
          </div>
        )}
      </section>

      <ErrorText message={error} />

      <details className="subtle">
        <summary>常见问题：为什么资料没显示？怎么升级新版？</summary>
        <div className="col tip" style={{ marginTop: 8 }}>
          <p>请固定将 <code>index.html</code> 放在同一路径并用同一浏览器打开。清理缓存、无痕模式或移动改名会使旧缓存不可见，拖入备份文件即可恢复。</p>
          <p>升级流程：旧版一键导出备份 → 双击新版 HTML → 拖入备份恢复。请保留程序生成的 ZIP 原文件，勿用其他工具重压缩（上限 128 MiB / 附件 96 MiB / 单图 12 MiB）。</p>
        </div>
      </details>
    </div>
  );
}
