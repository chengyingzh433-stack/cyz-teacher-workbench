import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import type { ExamSummary, ScoreStatus, StudentMember } from '../../../shared/types';
import type { TableBook, TableMapping, ColumnRole } from '../../../shared/gradebook/table';
import {
  blankCell,
  gradeSourceRows,
  inferMapping,
  mappedColumns,
  normalizeName,
  scoreValue,
  sourceClasses,
} from '../../../shared/gradebook/recognize';
import { parsePoints } from '../../../shared/score-policy';
import {
  Badge,
  Button,
  Dropzone,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui/primitives';

type RowMatchKind = 'active' | 'removed' | 'ambiguous' | 'new';

const normalizeExamTitle = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export function GradeImportModal({
  open,
  onOpenChange,
  classId,
  className,
  members,
  allMembers,
  exams,
  existingExam,
  onImported,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  className: string;
  members: StudentMember[];
  allMembers?: StudentMember[];
  exams: ExamSummary[];
  existingExam?: ExamSummary | null;
  onImported: (examId: string) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const rosterPool = allMembers ?? members;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [book, setBook] = useState<TableBook | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<TableMapping | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [excludedLines, setExcludedLines] = useState<Set<number>>(new Set());
  const [skipNewLines, setSkipNewLines] = useState<Set<number>>(new Set());
  const [manualMatch, setManualMatch] = useState<Record<number, string>>({});
  const [targetMode, setTargetMode] = useState<'new' | 'overwrite'>(
    existingExam ? 'overwrite' : 'new',
  );
  const [targetExamId, setTargetExamId] = useState(existingExam?.id || '');
  const [examTitle, setExamTitle] = useState(existingExam?.title || '');
  const [examDate, setExamDate] = useState(
    existingExam?.examDate || new Date().toISOString().slice(0, 10),
  );
  const [newStudentsConfirmed, setNewStudentsConfirmed] = useState(false);
  const [autoSeatNew, setAutoSeatNew] = useState(true);
  const [rowFilter, setRowFilter] = useState<'all' | 'new' | 'error'>('all');
  const [busy, setBusy] = useState(false);

  // Clean reset whenever modal opens or class/existingExam changes
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setFileName('');
    setPasteText('');
    setBook(null);
    setSheetIdx(0);
    setMapping(null);
    setCorrections({});
    setExcludedLines(new Set());
    setSkipNewLines(new Set());
    setManualMatch({});
    setTargetMode(existingExam ? 'overwrite' : 'new');
    setTargetExamId(existingExam?.id || exams[0]?.id || '');
    setExamTitle(existingExam?.title || '');
    setExamDate(existingExam?.examDate || new Date().toISOString().slice(0, 10));
    setNewStudentsConfirmed(false);
    setAutoSeatNew(true);
    setRowFilter('all');
  }, [open, classId, existingExam?.id]);

  const sheet = book?.sheets[sheetIdx] || null;

  async function loadBytes(bytes: Uint8Array, name: string) {
    setBusy(true);
    try {
      const res = await window.workbenchApi.exams.parseWorkbook({
        bytes: Array.from(bytes),
        fileName: name,
      });
      setFileName(name);
      setBook(res.book);
      setSheetIdx(0);
      setMapping(res.inferred);
      setCorrections({});
      setExcludedLines(new Set());
      setSkipNewLines(new Set());
      setManualMatch({});
      setNewStudentsConfirmed(false);
      setRowFilter('all');
      if (!existingExam) {
        const inferredTitle = name.replace(/\.(xlsx|xls|csv|tsv|txt)$/i, '').trim();
        setExamTitle(inferredTitle);
        const dup = exams.find(
          (e) => normalizeExamTitle(e.title) === normalizeExamTitle(inferredTitle),
        );
        if (dup) {
          setTargetMode('overwrite');
          setTargetExamId(dup.id);
          setExamDate(dup.examDate);
        } else {
          setTargetMode('new');
        }
      }
      setStep(1);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  const rawRows = useMemo(
    () => (sheet && mapping ? gradeSourceRows(sheet, mapping) : []),
    [sheet, mapping],
  );
  const detectedClasses = useMemo(() => sourceClasses(rawRows), [rawRows]);
  const scoreCols = useMemo(
    () => (mapping ? mapping.columns.filter((c) => c.role === 'score' || c.role === 'total') : []),
    [mapping],
  );

  // Detect same-name exam when in "new" mode
  const sameTitleExam = useMemo(() => {
    const t = normalizeExamTitle(examTitle);
    if (!t) return null;
    return exams.find((e) => normalizeExamTitle(e.title) === t) || null;
  }, [exams, examTitle]);

  const selectedOverwriteExam = useMemo(
    () => exams.find((e) => e.id === targetExamId) || null,
    [exams, targetExamId],
  );

  // Build preview rows with student identity matching + score validation
  const previewRows = useMemo(() => {
    if (!sheet || !mapping) return [];
    const activeByNo = new Map(
      rosterPool
        .filter((m) => m.status === 'active' && m.rosterNo)
        .map((m) => [m.rosterNo, m]),
    );
    const removedByNo = new Map(
      rosterPool
        .filter((m) => m.status === 'removed' && m.rosterNo)
        .map((m) => [m.rosterNo, m]),
    );
    const activeByName = new Map<string, StudentMember[]>();
    const removedByName = new Map<string, StudentMember[]>();
    const byId = new Map(rosterPool.map((m) => [m.membershipId, m]));

    for (const m of rosterPool) {
      const n = normalizeName(m.name);
      if (!n) continue;
      const bucket = m.status === 'active' ? activeByName : removedByName;
      const arr = bucket.get(n) || [];
      arr.push(m);
      bucket.set(n, arr);
    }

    return rawRows.map((r) => {
      const autoReason =
        r.automaticExclusion ||
        (detectedClasses.length > 1 && mapping.sourceClass && r.sourceClass !== mapping.sourceClass
          ? '其他来源班级'
          : '');
      const excluded = Boolean(autoReason) || excludedLines.has(r.line);

      let matched: StudentMember | undefined;
      let matchKind: RowMatchKind = 'new';
      let candidates: StudentMember[] = [];

      const override = manualMatch[r.line];
      if (override === '__new__') {
        matchKind = 'new';
      } else if (override && byId.has(override)) {
        matched = byId.get(override);
        matchKind = matched?.status === 'removed' ? 'removed' : 'active';
      } else {
        if (r.number && activeByNo.has(r.number)) {
          matched = activeByNo.get(r.number);
          matchKind = 'active';
        } else if (r.name) {
          const list = activeByName.get(normalizeName(r.name)) || [];
          if (list.length === 1) {
            matched = list[0];
            matchKind = 'active';
          } else if (list.length > 1) {
            matchKind = 'ambiguous';
            candidates = list;
          }
        }
        if (!matched && matchKind === 'new') {
          if (r.number && removedByNo.has(r.number)) {
            matched = removedByNo.get(r.number);
            matchKind = 'removed';
          } else if (r.name) {
            const rList = removedByName.get(normalizeName(r.name)) || [];
            if (rList.length === 1) {
              matched = rList[0];
              matchKind = 'removed';
            }
          }
        }
      }

      const skippedAsNew = matchKind === 'new' && skipNewLines.has(r.line);
      const effectiveExcluded = excluded || skippedAsNew;

      const cells = scoreCols.map((col) => {
        const rawCell = sheet.rows[r.rowIndex]?.[col.index] || blankCell;
        const corrKey = `${r.line}:${col.index}`;
        const corrected = corrections[corrKey];
        const parsed = scoreValue(rawCell, corrected);
        return {
          colIndex: col.index,
          colKey: `col_${col.index}`,
          status: parsed.status,
          units: parsed.units,
          rawText: rawCell.text,
          correctedText: corrected ?? null,
          fromFormula: rawCell.formula,
          error: parsed.error || '',
        };
      });

      const rowErrors = [
        ...(!r.name && !r.number ? ['缺少姓名和学号'] : []),
        ...(matchKind === 'ambiguous' ? ['本班存在重名学生，请选择关联哪位同学或新建'] : []),
        ...cells.filter((c) => c.error).map((c) => c.error),
      ];

      return {
        ...r,
        autoReason,
        excluded: effectiveExcluded,
        baseExcluded: excluded,
        skippedAsNew,
        matched,
        matchKind,
        candidates,
        cells,
        errors: rowErrors,
      };
    });
  }, [
    sheet,
    mapping,
    rawRows,
    rosterPool,
    detectedClasses,
    excludedLines,
    skipNewLines,
    manualMatch,
    scoreCols,
    corrections,
  ]);

  const activeRows = previewRows.filter((r) => !r.excluded);
  const matchedActiveRows = activeRows.filter((r) => r.matchKind === 'active');
  const restoredRows = activeRows.filter((r) => r.matchKind === 'removed');
  const toCreateRows = activeRows.filter((r) => r.matchKind === 'new');
  const allUnmatchedNotExcluded = previewRows.filter(
    (r) => !r.baseExcluded && r.matchKind === 'new',
  );
  const errorRows = activeRows.filter((r) => r.errors.length > 0);
  const needClassPick = detectedClasses.length > 1 && !mapping?.sourceClass;
  const needNewStudentConfirm = toCreateRows.length > 0 && !newStudentsConfirmed;

  const displayedRows = useMemo(() => {
    if (rowFilter === 'new') return previewRows.filter((r) => !r.baseExcluded && r.matchKind === 'new');
    if (rowFilter === 'error') return previewRows.filter((r) => !r.excluded && r.errors.length > 0);
    return previewRows;
  }, [previewRows, rowFilter]);

  async function commit() {
    if (!mapping || !sheet) return;
    if (needClassPick) {
      onNotify('该表包含多个班级，请先在第 2 步选择要导入的来源班级', 'err');
      return;
    }
    if (errorRows.length > 0) {
      onNotify(`还有 ${errorRows.length} 行异常，请更正、选择关联学生或排除后再提交`, 'err');
      return;
    }
    if (!activeRows.length) {
      onNotify('没有可导入的有效学生行', 'err');
      return;
    }
    if (needNewStudentConfirm) {
      onNotify(`请先勾选确认以上 ${toCreateRows.length} 名新学生属于「${className}」`, 'err');
      return;
    }
    if (targetMode === 'overwrite' && !selectedOverwriteExam) {
      onNotify('请选择要覆盖更新的已有考试', 'err');
      return;
    }

    setBusy(true);
    try {
      const cols = scoreCols.map((c) => {
        let maxUnits: number | null = null;
        if (c.max.trim()) {
          try {
            maxUnits = parsePoints(c.max.trim());
          } catch {
            maxUnits = null;
          }
        }
        return {
          key: `col_${c.index}`,
          label: c.label,
          role: c.role as 'score' | 'total',
          maxUnits,
        };
      });

      const resolvedExamId = targetMode === 'overwrite' ? selectedOverwriteExam?.id : undefined;
      const resolvedTitle =
        targetMode === 'overwrite'
          ? selectedOverwriteExam!.title
          : examTitle.trim() || fileName || '未命名考试';
      const resolvedDate =
        targetMode === 'overwrite'
          ? examDate.trim() || selectedOverwriteExam!.examDate
          : examDate.trim() || new Date().toISOString().slice(0, 10);

      const summary = await window.workbenchApi.exams.commitImport({
        classId,
        examId: resolvedExamId,
        title: resolvedTitle,
        examDate: resolvedDate,
        sourceFile: fileName || '粘贴导入',
        autoSeatNewStudents: autoSeatNew && (toCreateRows.length > 0 || restoredRows.length > 0),
        columns: cols,
        rows: activeRows.map((r) => ({
          membershipId: r.matched?.membershipId,
          restoreIfRemoved: r.matchKind === 'removed',
          updateRosterNo: r.matched && !r.matched.rosterNo && r.number ? r.number : undefined,
          createStudent: r.matched
            ? undefined
            : { name: r.name || r.number, rosterNo: r.number, gender: r.gender },
          cells: r.cells.map((c) => ({
            columnKey: c.colKey,
            status: c.status as ScoreStatus,
            units: c.units,
            rawText: c.rawText,
            correctedText: c.correctedText,
            fromFormula: c.fromFormula,
          })),
        })),
      });
      await onImported(summary.id);
      onOpenChange(false);
      setStep(0);
      setBook(null);
      const actionLabel = resolvedExamId ? '已覆盖更新' : '已导入';
      const newPart = toCreateRows.length
        ? `，新建 ${toCreateRows.length} 名本班学生${autoSeatNew ? '并自动入座空位' : ''}`
        : '';
      onNotify(`${actionLabel}「${summary.title}」（${activeRows.length} 人${newPart}）`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={existingExam ? `导入 / 覆盖成绩至「${existingExam.title}」` : '导入 Excel / CSV 成绩单'}
      subtitle="已有姓名自动录入并支持同考覆盖；花名册无此人时由你确认是否本班后自动新建"
      size="xl"
      footer={
        step === 0 ? (
          <>
            <Button onClick={() => onOpenChange(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!pasteText.trim() || busy}
              onClick={() => {
                const bytes = new TextEncoder().encode(pasteText);
                void loadBytes(bytes, pasteText.includes('\t') ? '粘贴成绩.tsv' : '粘贴成绩.csv');
              }}
            >
              解析粘贴内容
            </Button>
          </>
        ) : step === 1 ? (
          <>
            <Button onClick={() => setStep(0)}>重新选文件</Button>
            <Button
              variant="primary"
              disabled={!scoreCols.length || needClassPick}
              onClick={() => setStep(2)}
            >
              下一步：核对本班名单与写入方式 ({activeRows.length} 人)
            </Button>
          </>
        ) : (
          <div className="w-full flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-[var(--warn)] font-medium">
              {needNewStudentConfirm
                ? `请先勾选确认 ${toCreateRows.length} 名新学生属于「${className}」`
                : errorRows.length > 0
                  ? `还有 ${errorRows.length} 行异常待处理`
                  : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setStep(1)}>上一步调整列</Button>
              <Button
                variant="primary"
                disabled={busy || errorRows.length > 0 || !activeRows.length || needNewStudentConfirm}
                onClick={() => void commit()}
              >
                {busy
                  ? '正在写入数据库…'
                  : targetMode === 'overwrite'
                    ? `确认覆盖更新考试 (${activeRows.length} 人)`
                    : `确认写入新考试 (${activeRows.length} 人)`}
              </Button>
            </div>
          </div>
        )
      }
    >
      {/* Prominent Target Class Banner (prevents accidental cross-class import) */}
      <div className="mb-3 px-3.5 py-2 rounded-xl bg-[var(--accent-soft)]/55 border border-[var(--accent)]/30 flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span>
            当前目标班级：
            <strong className="text-[13px] text-[var(--accent)] mx-1">{className}</strong>
          </span>
          <Badge tone="neutral">现有在读花名册 {members.length} 人</Badge>
        </div>
        <span className="text-[var(--ink-muted)]">
          如不是要导入的班级，请先关闭弹窗并在左侧切换班级
        </span>
      </div>

      {/* Stepper Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border-subtle)] text-xs">
        {['1. 选择 Excel / 粘贴', '2. 确认表头、班级与科目列', '3. 核对学生归属与写入方式'].map(
          (t, i) => (
            <div
              key={t}
              className={`px-3 py-1.5 rounded-full font-medium ${
                step === i
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
                  : step > i
                    ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
                    : 'bg-[var(--bg-muted)] text-[var(--ink-muted)]'
              }`}
            >
              {t}
            </div>
          ),
        )}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Dropzone
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            title="拖入学校 Excel (.xlsx/.xls) 或 CSV 成绩单"
            hint="无需提前手录花名册：表格里有本班新姓名时，第 3 步确认归属本班即可自动新建学生"
            fileName={fileName}
            disabled={busy}
            onFiles={async (files) => {
              const f = files[0];
              const buf = new Uint8Array(await f.arrayBuffer());
              await loadBytes(buf, f.name);
            }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--ink-muted)]">
              或者直接从 Excel / WPS 复制表格粘贴到下方：
            </span>
            <Textarea
              rows={7}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'姓名\t学号\t物理\t总分\n林知行\t260301\t92\t586\n沈清禾\t260302\t88\t572'}
            />
          </div>
        </div>
      )}

      {step === 1 && sheet && mapping && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center flex-wrap gap-3">
            {book && book.sheets.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--ink-muted)]">工作表</span>
                <Select
                  value={String(sheetIdx)}
                  onValueChange={(v) => {
                    const idx = Number(v);
                    setSheetIdx(idx);
                    setMapping(inferMapping(book.sheets[idx]));
                  }}
                  options={book.sheets.map((s, i) => ({ value: String(i), label: s.name }))}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--ink-muted)]">表头结束行</span>
              <Select
                value={String(mapping.headerEnd)}
                onValueChange={(v) => {
                  const end = Number(v);
                  const start = Math.min(mapping.headerStart, end);
                  setMapping({
                    ...mapping,
                    headerStart: start,
                    headerEnd: end,
                    columns: mappedColumns(sheet, start, end),
                  });
                }}
                options={sheet.rows.slice(0, 12).map((row, idx) => ({
                  value: String(idx),
                  label: `第 ${idx + 1} 行：${row.slice(0, 4).map((c) => c.text).filter(Boolean).join(' / ').slice(0, 26) || '空行'}`,
                }))}
              />
            </div>

            {detectedClasses.length > 1 && (
              <div className="flex items-center gap-2">
                <Badge tone="warn">检测到 {detectedClasses.length} 个班级</Badge>
                <Select
                  value={mapping.sourceClass}
                  onValueChange={(v) => setMapping({ ...mapping, sourceClass: v })}
                  placeholder="请选择只导入哪个班 *"
                  options={detectedClasses.map((c) => ({ value: c, label: c }))}
                />
              </div>
            )}
          </div>

          {/* Column Mapping Cards */}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
            {mapping.columns.map((col, idx) => (
              <div key={col.index} className="px-3 py-2 flex items-center gap-3 text-[13px]">
                <span className="w-8 text-xs text-[var(--ink-muted)] tabular-nums">
                  列 {col.index + 1}
                </span>
                <Input
                  value={col.label}
                  onChange={(e) => {
                    const cols = [...mapping.columns];
                    cols[idx] = { ...col, label: e.target.value };
                    setMapping({ ...mapping, columns: cols });
                  }}
                  className="h-8 w-44"
                />
                <Select
                  value={col.role}
                  onValueChange={(v) => {
                    const cols = [...mapping.columns];
                    cols[idx] = { ...col, role: v as ColumnRole };
                    setMapping({ ...mapping, columns: cols });
                  }}
                  options={[
                    { value: 'score', label: '科目成绩' },
                    { value: 'total', label: '原表总分' },
                    { value: 'name', label: '学生姓名' },
                    { value: 'number', label: '学号 / 编号' },
                    { value: 'class', label: '班级列' },
                    { value: 'gender', label: '性别（建人用）' },
                    { value: 'ignore', label: '忽略（年排/备注等）' },
                  ]}
                  className="w-40"
                />
                {(col.role === 'score' || col.role === 'total') && (
                  <Input
                    value={col.max}
                    onChange={(e) => {
                      const cols = [...mapping.columns];
                      cols[idx] = { ...col, max: e.target.value };
                      setMapping({ ...mapping, columns: cols });
                    }}
                    placeholder="满分(如100)"
                    className="h-8 w-28"
                  />
                )}
                <span className="text-xs text-[var(--ink-muted)] truncate flex-1">
                  示例：
                  {sheet.rows
                    .slice(mapping.headerEnd + 1, mapping.headerEnd + 4)
                    .map((r) => r[col.index]?.text)
                    .filter(Boolean)
                    .join('、') || '空'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3.5">
          {/* Exam Target Mode: Create New vs Overwrite Existing */}
          <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col gap-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] text-xs">
                <button
                  type="button"
                  onClick={() => setTargetMode('new')}
                  className={`px-3 py-1 rounded-md cursor-pointer transition-colors ${
                    targetMode === 'new'
                      ? 'bg-[var(--bg-surface)] font-semibold shadow-sm text-[var(--ink-primary)]'
                      : 'text-[var(--ink-muted)]'
                  }`}
                >
                  新建一场考试
                </button>
                <button
                  type="button"
                  disabled={!exams.length}
                  onClick={() => {
                    setTargetMode('overwrite');
                    if (!targetExamId && exams[0]) {
                      setTargetExamId(exams[0].id);
                      setExamDate(exams[0].examDate);
                    }
                  }}
                  className={`px-3 py-1 rounded-md cursor-pointer transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                    targetMode === 'overwrite'
                      ? 'bg-[var(--bg-surface)] font-semibold shadow-sm text-[var(--accent)]'
                      : 'text-[var(--ink-muted)]'
                  }`}
                >
                  覆盖 / 更新已有考试 ({exams.length})
                </button>
              </div>
              {targetMode === 'overwrite' && (
                <span className="text-[11.5px] text-[var(--ink-muted)] flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 text-[var(--accent)]" />
                  同学生同科目自动覆盖最新分数，新科目自动追加列
                </span>
              )}
            </div>

            {targetMode === 'new' ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                    考试名称 *
                    <Input value={examTitle} onChange={(e) => setExamTitle(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                    考试日期
                    <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
                  </label>
                </div>
                {sameTitleExam && (
                  <div className="px-3 py-2 rounded-lg bg-[var(--warn-soft)]/70 border border-[var(--warn)]/35 flex items-center justify-between gap-2 text-xs">
                    <span>
                      检测到本班已有同名考试 <strong>「{sameTitleExam.title}」</strong>（{sameTitleExam.examDate}），可直接覆盖更新原数据而不产生重复考试
                    </span>
                    <Button
                      size="xs"
                      variant="primary"
                      onClick={() => {
                        setTargetMode('overwrite');
                        setTargetExamId(sameTitleExam.id);
                        setExamDate(sameTitleExam.examDate);
                      }}
                    >
                      切换为覆盖该场考试
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 text-[12.5px] font-medium">
                  选择要覆盖更新的考试 *
                  <Select
                    value={targetExamId}
                    onValueChange={(id) => {
                      setTargetExamId(id);
                      const found = exams.find((e) => e.id === id);
                      if (found) setExamDate(found.examDate);
                    }}
                    options={exams.map((ex) => ({
                      value: ex.id,
                      label: ex.title,
                      hint: `${ex.examDate} · ${ex.scoredStudents}人已录`,
                    }))}
                  />
                </div>
                <label className="flex flex-col gap-1 text-[12.5px] font-medium">
                  考试日期
                  <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          {/* Unmatched / New Student Confirmation Card */}
          {allUnmatchedNotExcluded.length > 0 && (
            <div
              className={`p-3 rounded-xl border flex flex-col gap-2.5 ${
                toCreateRows.length > 0 && !newStudentsConfirmed
                  ? 'border-[var(--warn)] bg-[var(--warn-soft)]/50'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/55'
              }`}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <UserPlus className="w-4 h-4 text-[var(--warn)] shrink-0" />
                  <span>
                    发现 {allUnmatchedNotExcluded.length} 名学生不在「{className}」现有花名册中
                    {toCreateRows.length < allUnmatchedNotExcluded.length && (
                      <span className="text-xs font-normal text-[var(--ink-muted)] ml-1.5">
                        （已选新建 {toCreateRows.length} 人，跳过{' '}
                        {allUnmatchedNotExcluded.length - toCreateRows.length} 人）
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSkipNewLines(new Set())}
                  >
                    全部新建
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setSkipNewLines(new Set(allUnmatchedNotExcluded.map((r) => r.line)))
                    }
                  >
                    全部跳过不导入
                  </Button>
                </div>
              </div>

              {toCreateRows.length > 0 && (
                <>
                  <div className="flex items-center flex-wrap gap-1.5 text-xs">
                    {toCreateRows.slice(0, 14).map((r) => (
                      <span
                        key={r.line}
                        className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--ink-primary)]"
                      >
                        {r.name || r.number}
                        {r.number && r.name ? ` (${r.number})` : ''}
                      </span>
                    ))}
                    {toCreateRows.length > 14 && (
                      <span className="text-[var(--ink-muted)]">
                        等共 {toCreateRows.length} 人
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5 pt-1 border-t border-[var(--border-subtle)]">
                    <label className="inline-flex items-center gap-2 text-[12.5px] font-medium cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newStudentsConfirmed}
                        onChange={(e) => setNewStudentsConfirmed(e.target.checked)}
                        className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                      />
                      <span>
                        确认以上 <strong>{toCreateRows.length}</strong> 名新学生属于{' '}
                        <strong className="text-[var(--accent)]">「{className}」</strong>
                        ，并在写入成绩时自动新建到本班花名册
                      </span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-[var(--ink-secondary)] cursor-pointer select-none pl-6">
                      <input
                        type="checkbox"
                        checked={autoSeatNew}
                        onChange={(e) => setAutoSeatNew(e.target.checked)}
                        className="w-3.5 h-3.5 accent-[var(--accent)] cursor-pointer"
                      />
                      <span>
                        同步为新建学生在「互动教室」按顺序填入空座（仅填空位，不打乱已排好的老座位）
                      </span>
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Summary Badges & Filter */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge tone="accent">
                <FileSpreadsheet className="w-3.5 h-3.5" /> 将写入 {activeRows.length} 人
              </Badge>
              <Badge tone="ok">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已有花名册 {matchedActiveRows.length} 人
              </Badge>
              {restoredRows.length > 0 && (
                <Badge tone="warn">
                  <UserCheck className="w-3.5 h-3.5" /> 恢复已移出 {restoredRows.length} 人
                </Badge>
              )}
              {toCreateRows.length > 0 && (
                <Badge tone={newStudentsConfirmed ? 'info' : 'warn'}>
                  <UserPlus className="w-3.5 h-3.5" /> 新建学生 {toCreateRows.length} 人
                </Badge>
              )}
              {errorRows.length > 0 && (
                <Badge tone="danger">
                  <AlertTriangle className="w-3.5 h-3.5" /> 异常 {errorRows.length} 行
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="inline-flex p-0.5 rounded-lg bg-[var(--bg-muted)] text-[11.5px]">
                {(
                  [
                    ['all', `全部 (${previewRows.length})`],
                    ['new', `仅新学生 (${allUnmatchedNotExcluded.length})`],
                    ['error', `仅异常 (${errorRows.length})`],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRowFilter(k)}
                    className={`px-2 py-0.5 rounded-md cursor-pointer ${
                      rowFilter === k
                        ? 'bg-[var(--bg-surface)] font-semibold shadow-sm'
                        : 'text-[var(--ink-muted)]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {errorRows.length > 0 && (
                <Button
                  size="xs"
                  onClick={() =>
                    setExcludedLines(new Set([...excludedLines, ...errorRows.map((r) => r.line)]))
                  }
                >
                  排除全部异常行
                </Button>
              )}
            </div>
          </div>

          {/* Preview Table */}
          <div className="max-h-60 overflow-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left text-[12.5px] border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[var(--ink-muted)] z-10">
                <tr>
                  <th className="p-2">行</th>
                  <th className="p-2">姓名 / 编号</th>
                  <th className="p-2">花名册匹配 / 归属确认</th>
                  {scoreCols.map((c) => (
                    <th key={c.index} className="p-2">
                      {c.label}
                    </th>
                  ))}
                  <th className="p-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {displayedRows.slice(0, 200).map((r) => (
                  <tr
                    key={r.line}
                    className={
                      r.excluded
                        ? 'opacity-45'
                        : r.errors.length
                          ? 'bg-[var(--danger-soft)]/50'
                          : r.matchKind === 'new'
                            ? 'bg-[var(--warn-soft)]/25'
                            : ''
                    }
                  >
                    <td className="p-2 tabular-nums">{r.line}</td>
                    <td className="p-2">
                      <span className="font-medium">{r.name || '—'}</span>
                      {r.number && (
                        <span className="ml-1.5 text-[var(--ink-muted)]">{r.number}</span>
                      )}
                      {r.gender !== 'unspecified' && (
                        <span className="ml-1 text-[11px] text-[var(--ink-muted)]">
                          ({r.gender === 'male' ? '男' : '女'})
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      {r.matchKind === 'active' && r.matched ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          <Badge tone="ok">{r.matched.name}</Badge>
                          {!r.matched.rosterNo && r.number && (
                            <span className="text-[11px] text-[var(--ink-muted)]">补录学号</span>
                          )}
                        </div>
                      ) : r.matchKind === 'removed' && r.matched ? (
                        <Badge tone="warn">恢复已移出：{r.matched.name}</Badge>
                      ) : r.matchKind === 'ambiguous' ? (
                        <select
                          aria-label={`选择 ${r.name} 对应学生`}
                          value={manualMatch[r.line] || ''}
                          onChange={(e) =>
                            setManualMatch({ ...manualMatch, [r.line]: e.target.value })
                          }
                          className="h-7 px-2 rounded-md border border-[var(--warn)] bg-[var(--bg-surface)] text-xs"
                        >
                          <option value="">重名！请选择具体同学…</option>
                          {r.candidates.map((c) => (
                            <option key={c.membershipId} value={c.membershipId}>
                              关联：{c.name} ({c.rosterNo || '无学号'})
                            </option>
                          ))}
                          <option value="__new__">作为另一名新同学新建</option>
                        </select>
                      ) : r.skippedAsNew ? (
                        <Badge tone="neutral">已跳过（非本班）</Badge>
                      ) : (
                        <Badge tone="warn">新学生 · 待确认新建</Badge>
                      )}
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.colIndex} className="p-2 tabular-nums">
                        {c.error ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] text-[var(--danger)]">{c.error}</span>
                            <input
                              placeholder="手填分数"
                              value={corrections[`${r.line}:${c.colIndex}`] || ''}
                              onChange={(e) =>
                                setCorrections({
                                  ...corrections,
                                  [`${r.line}:${c.colIndex}`]: e.target.value,
                                })
                              }
                              className="w-20 h-6 px-1.5 rounded border border-[var(--danger)] bg-[var(--bg-surface)] text-xs"
                            />
                          </div>
                        ) : c.units !== null ? (
                          c.units / 100
                        ) : (
                          <span className="text-[var(--ink-muted)]">{c.status}</span>
                        )}
                      </td>
                    ))}
                    <td className="p-2">
                      {r.autoReason ? (
                        <span className="text-xs text-[var(--ink-muted)]">{r.autoReason}</span>
                      ) : r.matchKind === 'new' && !r.baseExcluded ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            const next = new Set(skipNewLines);
                            if (next.has(r.line)) next.delete(r.line);
                            else next.add(r.line);
                            setSkipNewLines(next);
                          }}
                        >
                          {r.skippedAsNew ? '改为新建' : '跳过'}
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            const next = new Set(excludedLines);
                            if (next.has(r.line)) next.delete(r.line);
                            else next.add(r.line);
                            setExcludedLines(next);
                          }}
                        >
                          {r.excluded ? '恢复' : '排除'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
