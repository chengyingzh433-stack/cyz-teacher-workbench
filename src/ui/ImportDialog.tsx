import { useMemo, useState } from 'react';
import { parseTable, previewImport, type ImportPreview, type Mapping } from '../modules/roster/import';
import type { WorkbenchStore } from '../app/store';
import { ErrorText } from './Modal';
import { Badge, Dropzone, Stepper } from './Primitives';
import { Icon } from './Icons';

function detectRoster(text: string): { delimiter: ',' | '\t'; header: boolean; mapping: Mapping } {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  const delimiter: ',' | '\t' = tabs >= commas && tabs > 0 ? '\t' : commas > 0 ? ',' : '\t';
  let cells: string[] = [];
  try { cells = parseTable(text, delimiter)[0]?.cells || []; } catch {}
  const norm = cells.map((c) => c.trim().toLowerCase());
  const find = (re: RegExp) => norm.findIndex((c) => re.test(c));
  const name = find(/^(学生)?姓名$|^名字$|^name$/);
  const rosterNo = find(/^(学号|班内编号|编号|考号|座号|序号|no\.?|id)$/);
  const gender = find(/^(档案)?性别$|^gender$|^sex$/);
  if (name >= 0 || rosterNo >= 0 || gender >= 0) {
    return { delimiter, header: true, mapping: { name: name >= 0 ? name : 0, rosterNo, gender } };
  }
  return {
    delimiter,
    header: false,
    mapping: { name: 0, rosterNo: cells.length >= 2 ? 1 : -1, gender: cells.length >= 3 ? 2 : -1 },
  };
}

export function ImportDialog({
  store,
  classId,
  submit,
}: {
  store: WorkbenchStore;
  classId: string;
  submit: (preview: ImportPreview, excluded: number[], updates: number[]) => Promise<void>;
}) {
  const [step, setStep] = useState<0 | 1>(0);
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [delimiter, setDelimiter] = useState<',' | '\t'>('\t');
  const [header, setHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({ name: 0, rosterNo: 1, gender: 2 });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [updates, setUpdates] = useState<number[]>([]);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const columns = useMemo(() => {
    try { return parseTable(text, delimiter)[0]?.cells || []; } catch { return []; }
  }, [text, delimiter]);

  const invalidate = () => { setPreview(null); setExcluded([]); setUpdates([]); };
  const toggle = (list: number[], line: number) => (list.includes(line) ? list.filter((x) => x !== line) : [...list, line]);

  function applyText(next: string) {
    setText(next); invalidate(); setError('');
    if (next.trim()) {
      const d = detectRoster(next);
      setDelimiter(d.delimiter); setHeader(d.header); setMapping(d.mapping);
    }
  }

  async function onFile(files: File[]) {
    const file = files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 ** 2) throw new Error('文件超过 5 MiB');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setFileName(file.name); applyText(content); setDelimiter(',');
    } catch (e) { setError(`读取失败：${(e as Error).message}，请使用 UTF-8 编码 CSV`); }
  }

  function goPreview() {
    try {
      if (!text.trim()) throw new Error('请先粘贴名单或选择 CSV 文件');
      setPreview(previewImport(store.getState().snapshot!, classId, parseTable(text, delimiter), mapping, header, store.token()));
      setExcluded([]); setUpdates([]); setOnlyIssues(false); setError(''); setStep(1);
    } catch (e) { setError((e as Error).message); }
  }

  const stats = useMemo(() => {
    if (!preview) return { total: 0, active: 0, add: 0, matched: 0, unresolved: 0, errs: 0 };
    const active = preview.rows.filter((r) => !excluded.includes(r.line));
    return {
      total: preview.rows.length,
      active: active.length,
      add: active.filter((r) => !r.errors.length && !r.match).length,
      matched: active.filter((r) => !r.errors.length && r.match).length,
      unresolved: active.filter((r) => !r.errors.length && r.match && !updates.includes(r.line)).length,
      errs: active.filter((r) => r.errors.length > 0).length,
    };
  }, [preview, excluded, updates]);

  const shown = preview ? (onlyIssues ? preview.rows.filter((r) => r.errors.length || r.match) : preview.rows) : [];
  const colName = (i: number) => (i < 0 ? '不提供' : `第${i + 1}列${columns[i] ? `(${columns[i].slice(0, 10)})` : ''}`);

  return (
    <div className="col">
      <Stepper current={step} onSelect={(s) => setStep(s as 0 | 1)} steps={[{ label: '放入名单', hint: '粘贴或选 CSV' }, { label: '核对并导入', hint: '检查姓名学号' }]} />

      {step === 0 ? (
        <div className="col">
          <div className="seg" role="tablist" aria-label="名单来源">
            <button type="button" role="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')}>直接粘贴表格（推荐）</button>
            <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => setMode('file')}>上传 UTF-8 CSV</button>
          </div>

          {mode === 'file' ? (
            <Dropzone accept=".csv,text/csv" title="拖入 CSV 名单文件或点击浏览" hint="UTF-8 编码，保留前导零，最大 5 MiB" fileName={fileName} onFiles={(f) => void onFile(f)} />
          ) : (
            <label className="tight">
              从 Excel / WPS 复制姓名、编号、性别后粘贴到下方：
              <textarea rows={6} value={text} placeholder={'姓名\t编号\t性别\n陈雨桐\t001\t女'} onChange={(e) => applyText(e.target.value)} />
            </label>
          )}

          {text.trim() && (
            <div className="soft-card col">
              <div className="row between">
                <span className="row" style={{ fontSize: 13 }}>
                  <Icon name="checkCircle" size={15} className="text-ok" />
                  <strong>自动识别：</strong>姓名 {colName(mapping.name)} · 编号 {colName(mapping.rosterNo)} · 性别 {colName(mapping.gender)}
                </span>
                <label className="check"><input type="checkbox" checked={header} onChange={(e) => { setHeader(e.target.checked); invalidate(); }} />首行是标题</label>
              </div>
              <details className="subtle">
                <summary>识别不对？点此手动调整列与分隔符</summary>
                <div className="form-row" style={{ marginTop: 8 }}>
                  <label className="tight">
                    分隔符
                    <select value={delimiter} onChange={(e) => { setDelimiter(e.target.value as ',' | '\t'); invalidate(); }}>
                      <option value={'\t'}>制表符（粘贴表格）</option>
                      <option value=",">逗号（CSV）</option>
                    </select>
                  </label>
                  {(['name', 'rosterNo', 'gender'] as const).map((field, i) => (
                    <label className="tight" key={field}>
                      {['姓名列', '编号列', '性别列'][i]}
                      <select value={mapping[field]} onChange={(e) => { setMapping({ ...mapping, [field]: Number(e.target.value) }); invalidate(); }}>
                        <option value={-1}>不提供</option>
                        {Array.from({ length: Math.max(3, columns.length) }, (_, n) => (
                          <option key={n} value={n}>第 {n + 1} 列{columns[n] ? ` · ${columns[n].slice(0, 18)}` : ''}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            </div>
          )}

          <p className="tip">编号保留前导零；未填编号的同名学生分别独立新增，不会覆盖。</p>
          <ErrorText message={error} />
          <div className="row between" style={{ marginTop: 4 }}>
            <span className="tip">{text.trim() ? `检测到 ${columns.length || 1} 列` : '等待放入名单'}</span>
            <button type="button" className="primary" disabled={!text.trim()} onClick={goPreview}>下一步：核对名单</button>
          </div>
        </div>
      ) : preview && (
        <div className="col">
          <div className="row">
            <Badge>共 {stats.total} 行</Badge>
            <Badge tone="success">新增 {stats.add} 人</Badge>
            {stats.matched > 0 && <Badge tone="info">匹配已有 {stats.matched} 人</Badge>}
            {stats.errs > 0 && <Badge tone="danger">错误 {stats.errs} 行</Badge>}
            {excluded.length > 0 && <Badge>已排除 {excluded.length} 行</Badge>}
          </div>

          <div className="row between">
            <label className="check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />只看有问题或重复编号的行</label>
            <div className="row">
              {stats.errs > 0 && (
                <button type="button" className="sm" onClick={() => setExcluded((p) => [...new Set([...p, ...preview.rows.filter((r) => r.errors.length).map((r) => r.line)])])}>
                  一键排除全部错行 ({stats.errs})
                </button>
              )}
              {stats.unresolved > 0 && (
                <button type="button" className="sm" onClick={() => setUpdates((p) => [...new Set([...p, ...preview.rows.filter((r) => !r.errors.length && r.match && !excluded.includes(r.line)).map((r) => r.line)])])}>
                  全部勾选更新
                </button>
              )}
            </div>
          </div>

          <div className="table-scroll bordered" style={{ maxHeight: 300 }}>
            <table>
              <thead><tr><th style={{ width: 68 }}>行号</th><th>姓名 / 编号 / 性别</th><th>动作</th><th style={{ width: 84 }}>排除</th></tr></thead>
              <tbody>
                {shown.map((row) => {
                  const isEx = excluded.includes(row.line);
                  return (
                    <tr key={row.line} className={isEx ? 'row-muted' : row.errors.length ? 'row-err' : row.match ? 'row-info' : ''}>
                      <td className="num">第{row.line}行</td>
                      <td>
                        <strong>{row.input.name || '（空）'}</strong>
                        <div className="tip">{row.input.rosterNo || '无编号'} · {row.input.gender === 'male' ? '男' : row.input.gender === 'female' ? '女' : '未填性别'}</div>
                      </td>
                      <td>
                        {row.errors.length ? (
                          <span className="row text-danger" style={{ fontSize: 12.5 }}><Icon name="alert" size={14} />{row.errors.join('；')}</span>
                        ) : row.match ? (
                          <div>
                            <label className="check"><input type="checkbox" disabled={isEx} checked={updates.includes(row.line)} onChange={() => setUpdates(toggle(updates, row.line))} />确认更新已有学生</label>
                            <small className="muted">{row.changes.join('；') || '字段一致'}</small>
                          </div>
                        ) : <Badge tone="success">新增学生</Badge>}
                      </td>
                      <td>
                        <label className="check"><input aria-label={`排除第 ${row.line} 行`} type="checkbox" checked={isEx} onChange={() => setExcluded(toggle(excluded, row.line))} />排除</label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shown.length && <p className="empty-box">当前筛选下没有需要处理的行。</p>}
          </div>

          <ErrorText message={error} />
          <div className="row between" style={{ marginTop: 4 }}>
            <button type="button" disabled={busy} onClick={() => setStep(0)}><Icon name="chevronLeft" size={15} />返回修改</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !stats.active || stats.errs > 0 || stats.unresolved > 0}
              onClick={async () => {
                setBusy(true); setError('');
                try { await submit(preview, excluded, updates); }
                catch (e) { setError((e as Error).message); }
                finally { setBusy(false); }
              }}
            >
              {busy ? '导入中…' : `确认导入 ${stats.active} 名学生`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
