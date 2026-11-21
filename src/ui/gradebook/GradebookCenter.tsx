import { useMemo, useState } from 'react';
import type { WorkbenchStore, StoreState } from '../../app/store';
import { analyzeGrades, cellLabels, columnValues, formatScore, totalDifferences } from '../../modules/gradebook/analysis';
import { exportGradebookCsv, exportGradebookHtml } from '../../modules/gradebook/export';
import { downloadReport } from '../../modules/assessment/export';
import type { AssistantConnection } from '../../modules/assistant/provider';
import { GradeImportDialog } from './GradeImportDialog';
import { PhysicsMeanQuery } from './PhysicsMeanQuery';
import { ErrorText, Modal } from '../Modal';
import { Badge, EmptyCard, Pager } from '../Primitives';
import { Icon } from '../Icons';

type SortField = 'source' | 'rank' | 'selected' | 'computed' | 'number';

function bandOf(value: number, maxUnits: number | null, mode: 'auto' | '10' | '5') {
  if (mode === 'auto' && maxUnits !== null) {
    const p = (value * 100) / maxUnits;
    return p < 60 ? '不足 60%' : p < 70 ? '60%—不足 70%' : p < 80 ? '70%—不足 80%' : p < 90 ? '80%—不足 90%' : '90%—100%';
  }
  const pts = mode === '5' ? 5 : 10;
  const lo = Math.floor(value / (pts * 100)) * pts;
  return `${lo}—不足 ${lo + pts} 分`;
}

export function GradebookCenter({
  store,
  state,
  classId,
  connection,
  openSettings,
}: {
  store: WorkbenchStore;
  state: StoreState;
  classId: string;
  connection: AssistantConnection;
  openSettings: () => void;
}) {
  const [importCfg, setImportCfg] = useState<{ open: boolean; mode: 'file' | 'paste'; reviseExamId: string }>({ open: false, mode: 'file', reviseExamId: '' });
  const [exportOpen, setExportOpen] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [chosenExam, setChosenExam] = useState('');
  const [column, setColumn] = useState('');
  const [search, setSearch] = useState('');
  const [bandFilter, setBandFilter] = useState<string | null>(null);
  const [bandMode, setBandMode] = useState<'auto' | '10' | '5'>('auto');
  const [sortBy, setSortBy] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'source', dir: 'asc' });
  const [page, setPage] = useState(0);
  const [identified, setIdentified] = useState(false);
  const [pass, setPass] = useState(60);
  const [excellent, setExcellent] = useState(85);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const s = state.snapshot!;
  const cls = s.data.classes.find((c) => c.id === classId)!;
  const batches = useMemo(() => s.data.gradebook.imports.filter((x) => x.classId === classId).slice().reverse(), [s.data.gradebook.imports, classId]);
  const batch = batches.find((x) => x.id === batchId) || batches[0];
  const selected = column === 'computed' || batch?.columns.some((c) => c.key === column)
    ? column
    : batch?.columns.find((c) => c.role === 'total')?.key || batch?.columns[0]?.key || 'computed';
  const readonly = cls.status === 'archived' || state.status === 'conflict' || state.status === 'load-error';

  const chooseExam = (id: string) => { setChosenExam(id); setBatchId(id); setColumn(''); setBandFilter(null); setPage(0); setSearch(''); setNotice(''); };

  const result = useMemo(() => {
    try { return { analysis: batch ? analyzeGrades(batch, selected, pass, excellent) : null, error: '' }; }
    catch (e) { return { analysis: null, error: (e as Error).message }; }
  }, [batch, selected, pass, excellent]);

  const sums = useMemo(() => (batch ? columnValues(batch, 'computed') : []), [batch]);
  const diffs = useMemo(() => (batch ? totalDifferences(batch) : []), [batch]);

  const distribution = useMemo(() => {
    const a = result.analysis;
    if (!a || !a.count) return [];
    const counts = new Map<string, number>();
    for (const v of a.values.filter((x): x is number => x !== null).sort((x, y) => y - x)) {
      const label = bandOf(v, a.maxUnits, bandMode);
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    return [...counts].map(([label, count]) => ({ label, count, pct: (count / a.count) * 100, bar: (count / max) * 100 }));
  }, [result.analysis, bandMode]);

  const rows = useMemo(() => {
    if (!batch) return [];
    const a = result.analysis;
    const list = batch.rows
      .map((row, index) => ({ row, index, val: a ? a.values[index] : null, rank: a ? a.ranks[index] : null, sum: sums[index] ?? null }))
      .filter(({ row, val }) => {
        if (search && !`${row.sourceName} ${row.sourceNo}`.includes(search)) return false;
        if (bandFilter && (val === null || bandOf(val, a?.maxUnits ?? null, bandMode) !== bandFilter)) return false;
        return true;
      });
    if (sortBy.field === 'source') return sortBy.dir === 'asc' ? list : [...list].reverse();
    const m = sortBy.dir === 'asc' ? 1 : -1;
    return [...list].sort((x, y) => {
      if (sortBy.field === 'number') return x.row.sourceNo.localeCompare(y.row.sourceNo, 'zh-CN', { numeric: true }) * m;
      const vx = sortBy.field === 'rank' ? x.rank : sortBy.field === 'selected' ? x.val : x.sum;
      const vy = sortBy.field === 'rank' ? y.rank : sortBy.field === 'selected' ? y.val : y.sum;
      return vx === null && vy === null ? 0 : vx === null ? 1 : vy === null ? -1 : (vx - vy) * m;
    });
  }, [batch, result.analysis, sums, search, bandFilter, bandMode, sortBy]);

  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const toggleSort = (field: SortField) => {
    setPage(0);
    setSortBy((p) => (p.field === field ? { field, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: field === 'selected' || field === 'computed' ? 'desc' : 'asc' }));
  };

  const statusLabel = state.status === 'saved' ? '已保存的工作区快照' : state.status === 'saving' ? '保存中的工作副本' : state.status === 'conflict' ? '存在版本冲突的工作副本' : '未持久保存的工作副本';

  function exportFile(format: 'csv' | 'html') {
    if (!batch) return;
    setError(''); setNotice('');
    try {
      const text = format === 'csv' ? exportGradebookCsv(batch, identified, statusLabel) : exportGradebookHtml(batch, identified, statusLabel, pass, excellent);
      if (new TextEncoder().encode(text).length > 32 * 1024 ** 2) throw new Error('报告超过 32 MiB，请拆分考试');
      downloadReport(text, format);
      setExportOpen(false);
      setNotice('成绩报告已开始下载（包含本场全部学生）。');
    } catch (e) { setError((e as Error).message); }
  }

  const a = result.analysis;

  return (
    <section className="col">
      {readonly && <div className="alert tone-warning">班级已归档或不可写，成绩单仅支持查看与导出。</div>}

      {!batch ? (
        <EmptyCard
          icon={<Icon name="sheet" size={30} />}
          title="导入第一张 Excel / CSV 成绩单"
          description="直接拖入或粘贴学校成绩表即可自动分析均分、中位数、分数段分布与名次；原文件只在本机处理。"
          actions={
            <>
              <button type="button" className="primary" disabled={readonly || state.busy} onClick={() => setImportCfg({ open: true, mode: 'file', reviseExamId: '' })}>
                <Icon name="upload" size={15} />上传 Excel / CSV
              </button>
              <button type="button" disabled={readonly || state.busy} onClick={() => setImportCfg({ open: true, mode: 'paste', reviseExamId: '' })}>
                直接粘贴表格
              </button>
            </>
          }
          footer="注：若要上传手写答卷照片并逐题打分，请点击左侧「答卷阅卷与讲评」。"
        />
      ) : (
        <>
          <div className="bar">
            <div className="row">
              <label className="inline-field">
                <span>考试版本</span>
                <select value={batch.id} onChange={(e) => chooseExam(e.target.value)}>
                  {batches.map((b) => <option key={b.id} value={b.id}>{b.date} · {b.title} · v{b.version}（{b.rows.length}人）</option>)}
                </select>
              </label>
              <label className="inline-field">
                <span>分析科目</span>
                <select value={selected} onChange={(e) => { setColumn(e.target.value); setBandFilter(null); setPage(0); }}>
                  {batch.columns.map((c) => <option key={c.key} value={c.key}>{c.label}{c.role === 'total' ? '（原表总分）' : ''}</option>)}
                  <option value="computed">所选科目合计</option>
                </select>
              </label>
            </div>
            <div className="spacer" />
            <div className="row">
              <button type="button" disabled={readonly || state.busy} onClick={() => setImportCfg({ open: true, mode: 'file', reviseExamId: batch.examId })}>
                <Icon name="edit" size={14} />修订本场
              </button>
              <button type="button" onClick={() => setExportOpen(true)}><Icon name="download" size={14} />导出报告</button>
              <button type="button" className="primary" disabled={readonly || state.busy} onClick={() => setImportCfg({ open: true, mode: 'file', reviseExamId: '' })}>
                <Icon name="upload" size={14} />导入新成绩单
              </button>
            </div>
          </div>

          {notice && <div role="status" className="alert tone-success row between"><span>{notice}</span><button type="button" className="sm" onClick={() => setNotice('')}>知道了</button></div>}
          <ErrorText message={result.error || error} />

          {a && (
            <>
              <div className="grid-6">
                <div className="kpi card"><span>有效人数</span><strong>{a.count}<small>/{batch.rows.length}人</small></strong></div>
                <div className="kpi card accent"><span>平均分</span><strong>{formatScore(a.meanUnits)}</strong></div>
                <div className="kpi card"><span>中位数</span><strong>{formatScore(a.medianUnits)}</strong></div>
                <div className="kpi card"><span>最高 / 最低</span><strong>{formatScore(a.maxObservedUnits)}<small>/{formatScore(a.minUnits)}</small></strong></div>
                <div className="kpi card">
                  <span>及格 (≥{pass}%)</span>
                  <strong>{a.pass === null ? <small>未设满分</small> : <>{((a.pass / a.count) * 100).toFixed(1)}%<small>({a.pass})</small></>}</strong>
                </div>
                <div className="kpi card">
                  <span>优秀 (≥{excellent}%)</span>
                  <strong>{a.excellent === null ? <small>未设满分</small> : <>{((a.excellent / a.count) * 100).toFixed(1)}%<small>({a.excellent})</small></>}</strong>
                </div>
              </div>

              <div className="row between">
                <div className="row">
                  <Badge>满分：{a.maxUnits !== null ? `${formatScore(a.maxUnits)} 分` : '未设'}</Badge>
                  <Badge>缺考 {a.statusCounts.absent}</Badge>
                  <Badge>免考 {a.statusCounts.exempt}</Badge>
                  <Badge>{selected === 'computed' ? '科目不全' : '未录入'} {a.statusCounts.missing}</Badge>
                  <span className="tip">缺考/免考不拉低均分，0 分有效</span>
                </div>
                {a.maxUnits !== null && (
                  <div className="row">
                    <label className="compact-input">及格%<input type="number" min={0} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} /></label>
                    <label className="compact-input">优秀%<input type="number" min={0} max={100} value={excellent} onChange={(e) => setExcellent(Number(e.target.value))} /></label>
                  </div>
                )}
              </div>

              <div className="card" style={{ padding: '14px 16px' }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <div>
                    <h3 className="row"><Icon name="chart" size={16} />分数段分布</h3>
                    <p className="tip">点击任意分数段柱条，下方表格立刻只看该分段学生</p>
                  </div>
                  <div className="seg compact" role="group" aria-label="分段方式">
                    {a.maxUnits !== null && <button type="button" className={bandMode === 'auto' ? 'active' : ''} onClick={() => { setBandMode('auto'); setBandFilter(null); }}>按百分比</button>}
                    <button type="button" className={bandMode === '10' ? 'active' : ''} onClick={() => { setBandMode('10'); setBandFilter(null); }}>每10分</button>
                    <button type="button" className={bandMode === '5' ? 'active' : ''} onClick={() => { setBandMode('5'); setBandFilter(null); }}>每5分</button>
                  </div>
                </div>
                {distribution.length ? (
                  <div className="col" style={{ gap: 5 }}>
                    {distribution.map((b) => {
                      const active = bandFilter === b.label;
                      return (
                        <button type="button" key={b.label} className={`bar-row ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => { setBandFilter(active ? null : b.label); setPage(0); }}>
                          <span>{b.label}</span>
                          <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(4, b.bar)}%` }} /></span>
                          <span className="num bar-val"><strong>{b.count}人</strong><small>{b.pct.toFixed(1)}%</small></span>
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="tip">本列暂无有效成绩。</p>}
              </div>
            </>
          )}

          <PhysicsMeanQuery
            key={JSON.stringify([batch?.id, state.sequence, connection.revision])}
            batch={batch}
            batches={batches}
            className={cls.name}
            selectExam={chooseExam}
            explicitlySelected={!!batch && chosenExam === batch.id}
            connection={connection}
            openSettings={openSettings}
          />

          {diffs.length > 0 && (
            <details className="alert tone-warning col">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>发现 {diffs.length} 处原表总分与科目合计不同（未自动改分，点击核对）</summary>
              <div className="diff-list">
                {diffs.slice(0, 100).map((d, i) => <div key={i}>原第 {d.line} 行 · {d.column}：原表 {formatScore(d.provided)} ≠ 科目合计 {formatScore(d.computed)}</div>)}
              </div>
            </details>
          )}

          <div className="card table-card">
            <div className="row between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <h3>成绩明细（{rows.length} 人）</h3>
                {bandFilter && (
                  <span className="filter-chip">
                    {bandFilter}
                    <button type="button" aria-label="清除分数段筛选" onClick={() => setBandFilter(null)}><Icon name="x" size={12} /></button>
                  </span>
                )}
              </div>
              <div className="search-box compact">
                <Icon name="search" size={14} />
                <input aria-label="查找原表姓名或编号" placeholder="搜姓名或编号…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
                {search && <button type="button" className="clear-btn" aria-label="清除搜索" onClick={() => setSearch('')}><Icon name="x" size={12} /></button>}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><button type="button" className="sort-th" onClick={() => toggleSort('number')}>学生 / 编号<Icon name="sort" size={12} /></button></th>
                    {batch.columns.map((c) => (
                      <th key={c.key} className={c.key === selected ? 'col-hi' : ''}>
                        {c.key === selected ? (
                          <button type="button" className="sort-th active" onClick={() => toggleSort('selected')}>{c.label}<Icon name="sort" size={12} /></button>
                        ) : c.label}
                      </th>
                    ))}
                    <th><button type="button" className={`sort-th ${sortBy.field === 'computed' ? 'active' : ''}`} onClick={() => toggleSort('computed')}>科目合计<Icon name="sort" size={12} /></button></th>
                    <th><button type="button" className={`sort-th ${sortBy.field === 'rank' ? 'active' : ''}`} onClick={() => toggleSort('rank')}>班内名次<Icon name="sort" size={12} /></button></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(currentPage * 50, (currentPage + 1) * 50).map(({ row, index, rank }) => (
                    <tr key={row.membershipId}>
                      <td><strong>{row.sourceName}</strong><span className="muted num" style={{ marginLeft: 7, fontSize: 12 }}>{row.sourceNo || '无编号'}</span></td>
                      {row.cells.map((c, i) => (
                        <td
                          key={i}
                          className={`num ${batch.columns[i]?.key === selected ? 'col-hi' : ''}`}
                          title={`原值：${c.raw || '空'}${c.corrected !== null ? `；更正：${c.corrected}` : ''}${c.formula ? '；公式缓存' : ''}`}
                        >
                          {c.units === null ? <span className="muted">{cellLabels[c.status]}</span> : formatScore(c.units)}
                          {c.corrected !== null && <span className="tag-edit">改</span>}
                        </td>
                      ))}
                      <td className="num">{formatScore(sums[index])}</td>
                      <td className="num">{rank !== null ? <strong>#{rank}</strong> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <p className="empty-box">当前筛选条件下没有匹配记录。</p>}
            </div>
            <Pager page={currentPage} total={rows.length} pageSize={50} onChange={setPage} />
          </div>

          <details className="card subtle" style={{ padding: '10px 14px' }}>
            <summary>来源与排除记录（{batch.source.file} / {batch.source.sheet} · 排除 {batch.excluded.length} 行）</summary>
            <div className="col tip" style={{ marginTop: 8 }}>
              <p>表头第 {batch.source.headerStart + 1}—{batch.source.headerEnd + 1} 行 · 导入时间 {batch.createdAt} · 修订说明：{batch.reason || '首次导入'}</p>
              <p>名次按本次所选项目重算（同分并列如 1、1、3）；来源摘要 <code>{batch.source.hash.slice(0, 16)}…</code></p>
              {batch.excluded.length > 0 && (
                <div className="diff-list">{batch.excluded.slice(0, 100).map((r) => <div key={r.line}>第 {r.line} 行：{r.reason}</div>)}</div>
              )}
            </div>
          </details>
        </>
      )}

      {exportOpen && batch && (
        <Modal title="导出成绩与分析报告" subtitle={`${batch.title}（v${batch.version} · ${batch.rows.length} 人）`} onClose={() => setExportOpen(false)}>
          <div className="col">
            <label className={`radio-card ${!identified ? 'selected' : ''}`}>
              <input type="radio" name="gb-priv" checked={!identified} onChange={() => setIdentified(false)} />
              <div><strong>匿名脱敏版（推荐教研分享）</strong><small>以“学生1、学生2…”替代姓名并隐藏学号</small></div>
            </label>
            <label className={`radio-card ${identified ? 'selected' : ''}`}>
              <input type="radio" name="gb-priv" checked={identified} onChange={() => setIdentified(true)} />
              <div><strong>完整实名版（限本人归档）</strong><small>含原表姓名与学号（WPS 打开 CSV 时学号前可能显示防丢零单引号）</small></div>
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => exportFile('csv')}><Icon name="sheet" size={15} />导出 CSV</button>
              <button type="button" className="primary" disabled={!!result.error} onClick={() => exportFile('html')}><Icon name="download" size={15} />导出离线 HTML 报告</button>
            </div>
          </div>
        </Modal>
      )}

      {importCfg.open && (
        <GradeImportDialog
          store={store}
          classId={classId}
          initialMode={importCfg.mode}
          initialReviseExamId={importCfg.reviseExamId}
          close={() => setImportCfg({ open: false, mode: 'file', reviseExamId: '' })}
          onImported={(id) => { setChosenExam(''); setBatchId(id); setColumn(''); setBandFilter(null); setPage(0); setNotice('成绩单已成功写入成绩册！'); }}
        />
      )}
    </section>
  );
}
