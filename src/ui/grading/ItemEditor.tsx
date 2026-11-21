import { useState } from 'react';
import { id } from '../../app/model';
import type { WorkbenchStore } from '../../app/store';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { saveItem, type Item } from '../../modules/grading';
import { blobToDataUrl, breakdownReferenceAnswer } from '../../modules/grading/ai-engine';
import { parsePoints, points, type Rubric } from '../../modules/grading/score-policy';
import { prepareBatch, type PreparedAsset } from '../../modules/assets/prepare';
import { Modal, ErrorText } from '../Modal';
import { Badge, Dropzone } from '../Primitives';
import { Icon } from '../Icons';
import { applyEdit, BlobImage, useDraftWarning } from './shared';

const safeUnits = (v: string) => { try { return parsePoints(v); } catch { return 0; } };

export function ItemEditor({
  store,
  examId,
  item,
  rubric,
  connection,
  openSettings,
  close,
}: {
  store: WorkbenchStore;
  examId: string;
  item?: Item;
  rubric?: Rubric;
  connection: AssistantConnection;
  openSettings: (tab?: 'general' | 'grading') => void;
  close: () => void;
}) {
  const [token] = useState(store.token());
  const [label, setLabel] = useState(item?.label || '');
  const [prompt, setPrompt] = useState(item?.prompt || '');
  const [answer, setAnswer] = useState(rubric?.referenceAnswer || '');
  const [units, setUnits] = useState(item?.scoringUnits.map((u) => ({ ...u, max: points(u.maxUnits) })) || [{ id: id(), label: '第 1 小题', maxUnits: 200, max: '2' }]);
  const [criteria, setCriteria] = useState(rubric?.criteria.map((c) => ({ ...c, max: points(c.maxUnits), step: points(c.stepUnits), group: c.exclusiveGroup || '' })) || []);
  const [refs, setRefs] = useState(item?.referenceAssetIds || []);
  const [pending, setPending] = useState<PreparedAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  useDraftWarning(dirty);
  const changed = () => setDirty(true);
  const leave = () => { if (!busy && !aiBusy && (!dirty || window.confirm('当前题目编辑尚未保存，确定放弃？'))) close(); };

  async function aiBreakdown() {
    setAiBusy(true);
    setError('');
    setAiNote('');
    try {
      const state = store.getState();
      const blobs: Blob[] = [];
      for (const refId of refs.slice(0, 4)) {
        const b =
          pending.find((p) => p.asset.id === refId)?.blob ||
          state.files.get(state.snapshot!.data.grading.assets.find((a) => a.id === refId)?.hash || '');
        if (b) blobs.push(b);
      }
      const refDataUrls = await Promise.all(blobs.map((b) => blobToDataUrl(b)));
      const res = await breakdownReferenceAnswer(connection, {
        prompt,
        referenceAnswer: answer,
        referenceImages: refDataUrls,
        totalScoreHint: totalUnits > 0 ? points(totalUnits) : undefined,
      });
      if (res.referenceAnswer && !answer.trim()) setAnswer(res.referenceAnswer);
      const unitMap = new Map<string, { id: string; label: string; maxUnits: number; max: string }>();
      const nextCriteria = res.criteria.map((c) => {
        let u = unitMap.get(c.unitLabel);
        if (!u) {
          u = { id: id(), label: c.unitLabel, maxUnits: 0, max: '0' };
          unitMap.set(c.unitLabel, u);
        }
        const mu = parsePoints(c.maxScore);
        const su = parsePoints(c.stepScore);
        return {
          id: id(),
          scoringUnitId: u.id,
          description: c.description,
          max: points(mu),
          step: points(su),
          group: c.exclusiveGroup,
          maxUnits: mu,
          stepUnits: su,
          exclusiveGroup: c.exclusiveGroup || null,
        };
      });
      // Compute exact unit max from criteria so scores match deterministically
      const nextUnits = [...unitMap.values()].map((u) => {
        const groups = new Map<string, number>();
        let sum = 0;
        for (const c of nextCriteria.filter((x) => x.scoringUnitId === u.id)) {
          if (c.group) groups.set(c.group, Math.max(groups.get(c.group) || 0, c.maxUnits));
          else sum += c.maxUnits;
        }
        for (const v of groups.values()) sum += v;
        return { ...u, maxUnits: sum, max: points(sum) };
      });
      setUnits(nextUnits);
      setCriteria(nextCriteria);
      changed();
      setAiNote(`已根据参考答案自动拆出 ${nextUnits.length} 个小题、${nextCriteria.length} 条得分点，请核对微调后保存。`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  function unitSum(uid: string) {
    const groups = new Map<string, number>();
    let total = 0;
    for (const c of criteria.filter((x) => x.scoringUnitId === uid)) {
      const v = safeUnits(c.max);
      if (c.group.trim()) groups.set(c.group.trim(), Math.max(groups.get(c.group.trim()) || 0, v));
      else total += v;
    }
    for (const v of groups.values()) total += v;
    return total;
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      const scoringUnits = units.map((u) => ({ id: u.id, label: u.label, maxUnits: parsePoints(u.max) }));
      const input = {
        item: { label, prompt, maxUnits: scoringUnits.reduce((s, u) => s + u.maxUnits, 0), scoringUnits, referenceAssetIds: refs },
        rubric: {
          referenceAnswer: answer,
          criteria: criteria.map((c) => ({ id: c.id, scoringUnitId: c.scoringUnitId, description: c.description, maxUnits: parsePoints(c.max), stepUnits: parsePoints(c.step), exclusiveGroup: c.group.trim() || null })),
        },
      };
      await applyEdit(
        store,
        token,
        (s) => saveItem(s, examId, input, item?.id || null, pending.filter((p) => refs.includes(p.asset.id)).map((p) => p.asset)),
        new Map(pending.filter((p) => refs.includes(p.asset.id)).map((p) => [p.asset.hash, p.blob])),
      );
      setDirty(false); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const totalUnits = units.reduce((s, u) => s + safeUnits(u.max), 0);

  return (
    <Modal
      title={item ? `编辑第 ${item.label} 题` : '添加试题与评分细则'}
      subtitle="在每个小题卡片内直接添加评分点，系统自动核对分值匹配"
      wide
      onClose={leave}
      footer={
        <div className="row between" style={{ width: '100%' }}>
          <span className="tip">全题满分 <strong>{points(totalUnits)} 分</strong> · {units.length} 小题 · {criteria.length} 评分点</span>
          <div className="row">
            <button type="button" onClick={leave}>取消</button>
            <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '保存细则草案'}</button>
          </div>
        </div>
      }
    >
      <fieldset disabled={busy || aiBusy} className="fields col" onChange={changed}>
        <div className="form-row">
          <label className="tight" style={{ maxWidth: 180 }}>题号<input required placeholder="如：14" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} /></label>
          <label className="tight" style={{ flex: 2 }}>题干（选填）<textarea rows={2} value={prompt} maxLength={20000} onChange={(e) => setPrompt(e.target.value)} /></label>
        </div>
        <label className="tight">
          <span className="row between" style={{ width: '100%' }}>
            <span>参考答案 / 可接受解法</span>
            <span className="row" style={{ gap: 6 }}>
              <button type="button" className="sm" onClick={() => openSettings('grading')}>
                <Icon name="settings" size={12} />模型设置
              </button>
              <button
                type="button"
                className="sm primary"
                disabled={aiBusy || (!answer.trim() && !refs.length)}
                onClick={() => void aiBreakdown()}
              >
                <Icon name="sparkles" size={13} />
                {aiBusy ? 'AI 拆解中…' : 'AI 一键拆解得分点'}
              </button>
            </span>
          </span>
          <textarea rows={3} placeholder="粘贴标准答案文字，或先在下方上传参考答案照片，再点右上角「AI 一键拆解得分点」" value={answer} maxLength={20000} onChange={(e) => setAnswer(e.target.value)} />
        </label>
        {aiNote && <div role="status" className="alert tone-success"><Icon name="checkCircle" size={15} /><span>{aiNote}</span></div>}

        <div className="row between" style={{ marginTop: 6 }}>
          <h3>小题与评分点</h3>
          <button type="button" className="sm" disabled={units.length >= 100} onClick={() => { changed(); setUnits([...units, { id: id(), label: `第 ${units.length + 1} 小题`, max: '2', maxUnits: 200 }]); }}>
            <Icon name="plus" size={13} />添加小题
          </button>
        </div>

        {units.map((u) => {
          const target = safeUnits(u.max), sub = criteria.filter((c) => c.scoringUnitId === u.id), sum = unitSum(u.id);
          const ok = sub.length > 0 && sum === target;
          return (
            <section className="soft-card col" key={u.id}>
              <div className="row between">
                <div className="row" style={{ flex: 1 }}>
                  <input aria-label="小题名称" style={{ width: 150 }} value={u.label} maxLength={120} onChange={(e) => setUnits(units.map((x) => (x.id === u.id ? { ...x, label: e.target.value } : x)))} />
                  <label className="compact-input">满分<input inputMode="decimal" value={u.max} onChange={(e) => setUnits(units.map((x) => (x.id === u.id ? { ...x, max: e.target.value } : x)))} /></label>
                </div>
                <div className="row">
                  <Badge tone={ok ? 'success' : sub.length ? 'warning' : 'neutral'}>
                    {!sub.length ? '待加评分点' : ok ? `分值匹配 (${points(sum)})` : `已配 ${points(sum)} / 需 ${points(target)}`}
                  </Badge>
                  <button type="button" className="sm ghost-danger" disabled={units.length === 1} onClick={() => { changed(); setUnits(units.filter((x) => x.id !== u.id)); setCriteria(criteria.filter((c) => c.scoringUnitId !== u.id)); }}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </div>
              {sub.map((c, idx) => (
                <div className="card col" style={{ padding: 10 }} key={c.id}>
                  <div className="row">
                    <strong style={{ fontSize: 12, color: 'var(--accent)' }}>评分点 {idx + 1}</strong>
                    <label className="compact-input">上限<input inputMode="decimal" value={c.max} onChange={(e) => setCriteria(criteria.map((x) => (x.id === c.id ? { ...x, max: e.target.value } : x)))} /></label>
                    <label className="compact-input">步长<input inputMode="decimal" value={c.step} onChange={(e) => setCriteria(criteria.map((x) => (x.id === c.id ? { ...x, step: e.target.value } : x)))} /></label>
                    <label className="compact-input" style={{ flex: 1 }}>互斥组<input style={{ width: '100%' }} placeholder="多解法二选一填同组名" value={c.group} maxLength={120} onChange={(e) => setCriteria(criteria.map((x) => (x.id === c.id ? { ...x, group: e.target.value } : x)))} /></label>
                    <button type="button" className="sm ghost-danger" onClick={() => { changed(); setCriteria(criteria.filter((x) => x.id !== c.id)); }}>移除</button>
                  </div>
                  <textarea rows={2} required placeholder="写明给分条件、等价表达或例外…" value={c.description} maxLength={20000} onChange={(e) => setCriteria(criteria.map((x) => (x.id === c.id ? { ...x, description: e.target.value } : x)))} />
                </div>
              ))}
              <div>
                <button type="button" className="sm" disabled={criteria.length >= 500} onClick={() => {
                  changed();
                  const rem = Math.max(0, target - sum);
                  setCriteria([...criteria, { id: id(), scoringUnitId: u.id, description: '', max: rem ? points(rem) : '1', step: '0.5', group: '', maxUnits: rem || 100, stepUnits: 50, exclusiveGroup: null }]);
                }}>
                  <Icon name="plus" size={13} />为「{u.label}」添加评分点
                </button>
              </div>
            </section>
          );
        })}

        <Dropzone
          accept="image/jpeg,image/png"
          multiple
          disabled={busy}
          title="拖入题目配图或参考答案图片（JPG/PNG，选填）"
          hint="最多 100 张，会与学生答卷分开标注"
          onFiles={async (files) => {
            if (!files.length) return;
            setBusy(true); setError('');
            try {
              if (refs.length + files.length > 100) throw new Error('参考图最多 100 张');
              const batch = await prepareBatch(files, 'reference', [...store.getState().snapshot!.data.grading.assets, ...pending.map((p) => p.asset)]);
              setPending([...pending, ...batch]); setRefs([...refs, ...batch.map((p) => p.asset.id)]); changed();
            } catch (err) { setError((err as Error).message); }
            finally { setBusy(false); }
          }}
        />
        {refs.map((ref, i) => (
          <div className="row between" key={ref}>
            <details className="subtle" style={{ flex: 1 }}>
              <summary>参考图 {i + 1}</summary>
              <BlobImage blob={pending.find((p) => p.asset.id === ref)?.blob || store.getState().files.get(store.getState().snapshot!.data.grading.assets.find((a) => a.id === ref)?.hash || '')} label={`参考图 ${i + 1}`} />
            </details>
            <button type="button" className="sm ghost-danger" onClick={() => { changed(); setRefs(refs.filter((x) => x !== ref)); }}>移除</button>
          </div>
        ))}
        <ErrorText message={error} />
      </fieldset>
    </Modal>
  );
}
