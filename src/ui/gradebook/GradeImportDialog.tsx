import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchStore } from '../../app/store';
import { AssistantToolSession } from '../../modules/assistant/tools';
import { readGradeTable } from '../../modules/gradebook/reader';
import { gradeSourceRows, inferMapping, sourceClasses, type TableMapping } from '../../modules/gradebook/recognize';
import type { TableBook } from '../../modules/gradebook/table';
import type { GradePreview, ImportInput } from '../../modules/gradebook/service';
import { Modal, ErrorText } from '../Modal';
import { Dropzone, Stepper } from '../Primitives';
import { Icon } from '../Icons';
import { useDraftWarning } from '../grading/shared';
import { MappingStep, ReviewStep } from './GradeImportSteps';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function GradeImportDialog({
  store,
  classId,
  initialMode = 'file',
  initialReviseExamId = '',
  close,
  onImported,
}: {
  store: WorkbenchStore;
  classId: string;
  initialMode?: 'file' | 'paste';
  initialReviseExamId?: string;
  close: () => void;
  onImported: (id: string) => void;
}) {
  const [session] = useState(() => new AssistantToolSession(store));
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [sourceMode, setSourceMode] = useState<'file' | 'paste'>(initialMode);
  const [book, setBook] = useState<TableBook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState('');
  const [paste, setPaste] = useState('');
  const [encoding, setEncoding] = useState('utf-8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const s = store.getState().snapshot!;
  const className = s.data.classes.find((c) => c.id === classId)?.name || '';
  const members = s.data.memberships.filter((m) => m.classId === classId && m.status === 'active');
  const students = useMemo(() => new Map(s.data.students.map((x) => [x.id, x])), [s.data.students]);
  const prior = useMemo(
    () => s.data.gradebook.imports.filter((x) => x.classId === classId).filter((x, _, all) => !all.some((p) => p.examId === x.examId && p.version > x.version)),
    [s.data.gradebook.imports, classId],
  );
  const reviseExam = prior.find((p) => p.examId === initialReviseExamId);

  const [input, setInput] = useState<ImportInput>({
    title: reviseExam?.title || '',
    date: reviseExam?.date || today(),
    examId: reviseExam?.examId || '',
    reason: '',
    mapping: { headerStart: 0, headerEnd: 0, sourceClass: '', columns: [] },
    bindings: {},
    excluded: {},
    includedRows: [],
    corrections: {},
    acceptFormulas: false,
  });
  const [preview, setPreview] = useState<GradePreview | null>(null);
  const [proposalId, setProposalId] = useState('');
  const [stale, setStale] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [problemsOnly, setProblemsOnly] = useState(false);

  useDraftWarning(!!book);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); session.dispose(); };
  }, [session]);

  const change = (patch: Partial<ImportInput>) => { setInput((p) => ({ ...p, ...patch })); setStale(true); setConfirmed(false); setError(''); };
  const changeMapping = (mapping: TableMapping) => {
    change({ mapping, bindings: {}, excluded: {}, includedRows: [], corrections: {} });
    setPreview(null); setPage(0);
  };

  function switchExamTarget(nextExamId: string) {
    if (!nextExamId) return change({ examId: '', reason: '', title: file ? file.name.replace(/\.[^.]+$/, '').slice(0, 120) : input.title });
    const target = prior.find((p) => p.examId === nextExamId);
    change({ examId: nextExamId, title: target?.title || input.title, date: target?.date || input.date });
  }

  async function chooseSheet(nextBook: TableBook, index: number, nextHash: string, nextFile: File) {
    const source = nextBook.sheets[index];
    if (!source) throw new Error('工作表不存在');
    const key = session.registerSource({ file: nextFile.name, hash: nextHash, sheet: source });
    const mapping = (await session.invoke('table.suggest_mapping', { sourceId: key })) as TableMapping;
    if (!alive.current) return;
    setSourceId(key); setSheetIndex(index); setPreview(null); setProposalId(''); setPage(0);
    change({ mapping, bindings: {}, excluded: {}, includedRows: [], corrections: {}, acceptFormulas: false });
  }

  async function load(nextFile: File, enc = encoding) {
    setBusy(true); setError(''); setBook(null); setPreview(null); setSourceId('');
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const parsed = await readGradeTable(nextFile, enc, abort.signal);
      if (!alive.current || abort.signal.aborted) return;
      const best = parsed.book.sheets
        .map((sh, index) => ({ index, score: inferMapping(sh).columns.reduce((v, c) => v + (c.role === 'name' ? 20 : c.role === 'score' || c.role === 'total' ? 2 : 0), 0) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best) throw new Error('文件没有可读取的工作表');
      setBook(parsed.book); setFile(nextFile); setHash(parsed.hash);
      change({
        title: reviseExam ? reviseExam.title : nextFile.name.replace(/\.[^.]+$/, '').slice(0, 120),
        date: reviseExam ? reviseExam.date : input.date,
        examId: reviseExam ? reviseExam.examId : input.examId,
      });
      await chooseSheet(parsed.book, best.index, parsed.hash, nextFile);
      if (alive.current) setStep(1);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { if (alive.current) setBusy(false); }
  }

  async function generate(goReview = false) {
    setBusy(true); setError('');
    try {
      const res = (await session.invoke('grades.preview', { sourceId, classId, input })) as { proposalId: string };
      setProposalId(res.proposalId); setPreview(session.getPreview(res.proposalId));
      setStale(false); setConfirmed(false); setPage(0);
      if (goReview) setStep(2);
    } catch (e) { setError((e as Error).message); setStale(true); }
    finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setError('');
    try {
      const receipt = (await session.invoke('workspace.commit', { proposalId }, session.authorize(proposalId))) as { resultId: string };
      onImported(receipt.resultId);
      close();
    } catch (e) { setError((e as Error).message); setStale(true); setConfirmed(false); setStep(2); }
    finally { if (alive.current) setBusy(false); }
  }

  function leave() {
    if (busy) return controller.current?.abort();
    if (!book || window.confirm('尚未导入的预览将关闭，原班级资料不变。确定关闭？')) close();
  }

  const sheet = book?.sheets[sheetIndex];
  const hasFormulas = useMemo(() => !!sheet?.rows.some((r) => r.some((c) => !!c.formula)), [sheet]);
  const classes = useMemo(() => (sheet ? sourceClasses(gradeSourceRows(sheet, input.mapping), input.includedRows) : []), [sheet, input.mapping, input.includedRows]);
  const selected = preview?.rows.filter((r) => !r.excluded) || [];
  const invalid = selected.filter((r) => r.errors.length).length;
  const newCount = selected.filter((r) => !r.membershipId).length;

  const footer = (
    <div className="row between" style={{ width: '100%' }}>
      {step === 0 ? (
        <>
          <span className="tip">目标：{className} · 原文件只在本机读取</span>
          <div className="row">
            {busy && controller.current && !controller.current.signal.aborted && <button type="button" onClick={() => controller.current?.abort()}>取消读取</button>}
            <button type="button" onClick={leave}>取消</button>
            {sheet && <button type="button" className="primary" onClick={() => setStep(1)}>继续当前文件<Icon name="chevronRight" size={15} /></button>}
          </div>
        </>
      ) : step === 1 ? (
        <>
          <button type="button" disabled={busy} onClick={() => setStep(0)}><Icon name="chevronLeft" size={15} />重选文件</button>
          <div className="row">
            {classes.length > 1 && !input.mapping.sourceClass && <span className="text-warn" style={{ fontSize: 12 }}>请先选定「来源班级」</span>}
            <button type="button" className="primary" disabled={busy || !sheet} onClick={() => void generate(true)}>
              {busy ? '生成核对表…' : '下一步：核对学生与分数'}<Icon name="chevronRight" size={15} />
            </button>
          </div>
        </>
      ) : step === 2 ? (
        <>
          <button type="button" disabled={busy} onClick={() => setStep(1)}><Icon name="chevronLeft" size={15} />调表头与列</button>
          <div className="row">
            {stale ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void generate(false)}>
                <Icon name="refresh" size={14} />{busy ? '核对中…' : '刷新核对结果'}
              </button>
            ) : invalid > 0 || (preview?.errors.length || 0) > 0 ? (
              <button type="button" className="warn-btn" onClick={() => { setProblemsOnly(true); setPage(0); }}>
                <Icon name="alert" size={14} />还有 {invalid || preview?.errors.length} 处待处理（点击筛选）
              </button>
            ) : (
              <button type="button" className="primary" disabled={busy || !preview || !selected.length} onClick={() => setStep(3)}>
                核对无误，去确认入库<Icon name="chevronRight" size={15} />
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <button type="button" disabled={busy} onClick={() => setStep(2)}><Icon name="chevronLeft" size={15} />返回核对</button>
          <button type="button" className="primary" disabled={!confirmed || stale || busy || invalid > 0 || !!preview?.errors.length} onClick={() => void commit()}>
            {busy ? '写入中…' : input.examId ? '确认保存新修订版本' : '确认写入成绩册'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <Modal title={reviseExam ? `修订成绩单 · ${reviseExam.title}` : '导入考试成绩单'} subtitle={`目标班级：${className}`} extraWide footer={footer} onClose={leave}>
      <Stepper
        current={step}
        onSelect={(i) => !busy && setStep(i as 0 | 1 | 2 | 3)}
        steps={[
          { label: '放入成绩表', hint: 'Excel / 粘贴' },
          { label: '表头与列', hint: '考试名 · 科目' },
          { label: '核对人名与分', hint: '纠错与绑定' },
          { label: '确认入库', hint: '汇总检查' },
        ]}
      />
      <fieldset className="fields" disabled={busy}>
        {step === 0 && (
          <div className="col">
            <div className="seg" role="tablist" aria-label="成绩表来源">
              <button type="button" role="tab" aria-selected={sourceMode === 'file'} onClick={() => setSourceMode('file')}>上传 Excel / CSV（推荐）</button>
              <button type="button" role="tab" aria-selected={sourceMode === 'paste'} onClick={() => setSourceMode('paste')}>直接粘贴表格</button>
            </div>
            {sourceMode === 'file' ? (
              <>
                <Dropzone accept=".xlsx,.xls,.csv,.tsv,.txt" disabled={busy} fileName={file?.name} title="拖入 Excel (.xlsx/.xls) 或 CSV 成绩单，或点击浏览" hint="支持多行合并表头、多工作表、多班合表；最大 12 MiB / 5000 行" onFiles={(f) => f[0] && void load(f[0])} />
                <details className="subtle">
                  <summary>CSV 中文乱码？点此切换文件编码（Excel 无需修改）</summary>
                  <label className="tight" style={{ marginTop: 8, maxWidth: 280 }}>
                    文本编码
                    <select value={encoding} onChange={(e) => { setEncoding(e.target.value); if (file && !/\.xlsx?$/i.test(file.name)) void load(file, e.target.value); }}>
                      <option value="utf-8">UTF-8（默认）</option>
                      <option value="gb18030">GB18030 / GBK（中文 WPS / Excel CSV）</option>
                      <option value="utf-16le">UTF-16 LE</option>
                    </select>
                  </label>
                </details>
              </>
            ) : (
              <div className="col">
                <label className="tight">
                  从 Excel / WPS 复制成绩表后粘贴到下方：
                  <textarea aria-label="粘贴成绩表" rows={8} placeholder={'姓名\t学号\t物理\t数学\n陈雨桐\t001\t92\t88'} value={paste} onChange={(e) => setPaste(e.target.value)} />
                </label>
                <div>
                  <button type="button" className="primary" disabled={!paste.trim() || busy} onClick={() => void load(new File([paste], '粘贴成绩单.tsv', { type: 'text/tab-separated-values' }), 'utf-8')}>
                    {busy ? '识别中…' : '识别粘贴内容并继续'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 1 && book && sheet && (
          <MappingStep
            book={book}
            sheet={sheet}
            sheetIndex={sheetIndex}
            prior={prior}
            classes={classes}
            hasFormulas={hasFormulas}
            input={input}
            onSheet={(i) => void chooseSheet(book, i, hash, file!).catch((e) => setError((e as Error).message))}
            onExamTarget={switchExamTarget}
            onChange={change}
            onMapping={changeMapping}
          />
        )}

        {step === 2 && preview && (
          <ReviewStep
            preview={preview}
            input={input}
            members={members}
            students={students}
            stale={stale}
            problemsOnly={problemsOnly}
            page={page}
            onProblemsOnly={setProblemsOnly}
            onPage={setPage}
            onChange={change}
          />
        )}

        {step === 3 && preview && (
          <div className="soft-card col" style={{ padding: 18 }}>
            <h3>即将写入成绩册，请做最后核对</h3>
            <dl className="grid-2 summary-dl">
              <div><dt>目标班级</dt><dd>{className}</dd></div>
              <div><dt>考试名称与日期</dt><dd>{input.title}（{input.date}）</dd></div>
              <div><dt>写入方式</dt><dd>{input.examId ? '追加新修订版本（旧版保留）' : '建立新考试记录'}</dd></div>
              <div><dt>纳入学生</dt><dd><strong>{selected.length} 人</strong>{newCount > 0 ? `（含新增名单 ${newCount} 人）` : ''}</dd></div>
              <div><dt>分析列</dt><dd>{preview.columns.map((c) => c.label).join('、')}</dd></div>
              <div><dt>排除与更正</dt><dd>排除 {preview.rows.length - selected.length} 行 · 手改 {Object.keys(input.corrections).length} 格</dd></div>
            </dl>
            {newCount > 0 && <div className="alert tone-info">有 {newCount} 位学生不在当前花名册中，导入后将自动加入名单（不猜性别、不打乱现有座位）。</div>}
            <label className="confirm-box">
              <input type="checkbox" checked={confirmed} disabled={stale || !!preview.errors.length || !!invalid} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>我已核对目标班级、考试名称、学生身份与分数列，确认写入以上成绩</span>
            </label>
          </div>
        )}
      </fieldset>
      <ErrorText message={error} />
    </Modal>
  );
}
