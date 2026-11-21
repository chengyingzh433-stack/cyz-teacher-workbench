import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
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

export function GradeImportModal({
  open,
  onOpenChange,
  classId,
  members,
  existingExam,
  onImported,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  members: StudentMember[];
  existingExam?: ExamSummary | null;
  onImported: (examId: string) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [book, setBook] = useState<TableBook | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [mapping, setMapping] = useState<TableMapping | null>(null);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [excludedLines, setExcludedLines] = useState<Set<number>>(new Set());
  const [examTitle, setExamTitle] = useState(existingExam?.title || '');
  const [examDate, setExamDate] = useState(
    existingExam?.examDate || new Date().toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);

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
      if (!existingExam) {
        setExamTitle(name.replace(/\.(xlsx|xls|csv|tsv|txt)$/i, ''));
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

  // Build preview rows with student identity matching + score validation
  const previewRows = useMemo(() => {
    if (!sheet || !mapping) return [];
    const byNo = new Map(members.filter((m) => m.rosterNo).map((m) => [m.rosterNo, m]));
    const byNameCount = new Map<string, StudentMember[]>();
    for (const m of members) {
      const n = normalizeName(m.name);
      const arr = byNameCount.get(n) || [];
      arr.push(m);
      byNameCount.set(n, arr);
    }

    return rawRows.map((r) => {
      const autoReason =
        r.automaticExclusion ||
        (detectedClasses.length > 1 && mapping.sourceClass && r.sourceClass !== mapping.sourceClass
          ? '其他来源班级'
          : '');
      const excluded = Boolean(autoReason) || excludedLines.has(r.line);

      let matched: StudentMember | undefined;
      if (r.number) matched = byNo.get(r.number);
      if (!matched && r.name) {
        const list = byNameCount.get(normalizeName(r.name)) || [];
        if (list.length === 1) matched = list[0];
      }

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
        ...cells.filter((c) => c.error).map((c) => c.error),
      ];

      return {
        ...r,
        autoReason,
        excluded,
        matched,
        cells,
        errors: rowErrors,
      };
    });
  }, [sheet, mapping, rawRows, members, detectedClasses, excludedLines, scoreCols, corrections]);

  const activeRows = previewRows.filter((r) => !r.excluded);
  const errorRows = activeRows.filter((r) => r.errors.length > 0);
  const needClassPick = detectedClasses.length > 1 && !mapping?.sourceClass;

  async function commit() {
    if (!mapping || !sheet) return;
    if (needClassPick) {
      onNotify('该表包含多个班级，请先在第 2 步选择要导入的来源班级', 'err');
      return;
    }
    if (errorRows.length > 0) {
      onNotify(`还有 ${errorRows.length} 行异常（如无缓存公式），请更正或排除后再提交`, 'err');
      return;
    }
    if (!activeRows.length) {
      onNotify('没有可导入的有效学生行', 'err');
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

      const summary = await window.workbenchApi.exams.commitImport({
        classId,
        examId: existingExam?.id,
        title: examTitle.trim() || fileName || '未命名考试',
        examDate: examDate.trim() || new Date().toISOString().slice(0, 10),
        sourceFile: fileName || '粘贴导入',
        columns: cols,
        rows: activeRows.map((r) => ({
          membershipId: r.matched?.membershipId,
          createStudent: r.matched ? undefined : { name: r.name || r.number, rosterNo: r.number },
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
      onNotify(`已成功导入「${summary.title}」（${activeRows.length} 名学生）`);
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
      title={existingExam ? `导入 / 更新成绩至「${existingExam.title}」` : '导入 Excel / CSV 成绩单'}
      subtitle="支持多行表头、多班合表自动筛选、年排/汇总行自动过滤与公式缺缓存核对"
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
              下一步：核对学生与异常 ({activeRows.length} 人)
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep(1)}>上一步调整列</Button>
            <Button
              variant="primary"
              disabled={busy || errorRows.length > 0 || !activeRows.length}
              onClick={() => void commit()}
            >
              {busy ? '正在写入数据库…' : `确认写入考试中心 (${activeRows.length} 人)`}
            </Button>
          </>
        )
      }
    >
      {/* Stepper Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[var(--border-subtle)] text-xs">
        {['1. 选择 Excel / 粘贴', '2. 确认表头、班级与科目列', '3. 核对公式与确认写入'].map((t, i) => (
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
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Dropzone
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            title="拖入学校 Excel (.xlsx/.xls) 或 CSV 成绩单"
            hint="所有解析在本地桌面后台完成，原文件绝不上传云端"
            fileName={fileName}
            disabled={busy}
            onFiles={async (files) => {
              const f = files[0];
              const buf = new Uint8Array(await f.arrayBuffer());
              await loadBytes(buf, f.name);
            }}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--ink-muted)]">或者直接从 Excel / WPS 复制表格粘贴到下方：</span>
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
                <span className="w-8 text-xs text-[var(--ink-muted)] tabular-nums">列 {col.index + 1}</span>
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
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              考试名称 *
              <Input value={examTitle} onChange={(e) => setExamTitle(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-medium">
              考试日期
              <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </label>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="accent">
                <FileSpreadsheet className="w-3.5 h-3.5" /> 将导入 {activeRows.length} 人
              </Badge>
              <Badge tone="ok">
                <CheckCircle2 className="w-3.5 h-3.5" /> 匹配已有花名册{' '}
                {activeRows.filter((r) => r.matched).length} 人
              </Badge>
              <Badge tone="info">
                自动新建学生 {activeRows.filter((r) => !r.matched).length} 人
              </Badge>
              {errorRows.length > 0 && (
                <Badge tone="danger">
                  <AlertTriangle className="w-3.5 h-3.5" /> 待处理异常 {errorRows.length} 行
                </Badge>
              )}
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

          <div className="max-h-72 overflow-auto rounded-xl border border-[var(--border-subtle)]">
            <table className="w-full text-left text-[12.5px] border-collapse">
              <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[var(--ink-muted)]">
                <tr>
                  <th className="p-2">行</th>
                  <th className="p-2">姓名 / 编号</th>
                  <th className="p-2">花名册匹配</th>
                  {scoreCols.map((c) => (
                    <th key={c.index} className="p-2">
                      {c.label}
                    </th>
                  ))}
                  <th className="p-2">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {previewRows.slice(0, 120).map((r) => (
                  <tr
                    key={r.line}
                    className={
                      r.excluded
                        ? 'opacity-40'
                        : r.errors.length
                          ? 'bg-[var(--danger-soft)]/50'
                          : ''
                    }
                  >
                    <td className="p-2 tabular-nums">{r.line}</td>
                    <td className="p-2">
                      <span className="font-medium">{r.name || '—'}</span>
                      {r.number && <span className="ml-1.5 text-[var(--ink-muted)]">{r.number}</span>}
                    </td>
                    <td className="p-2">
                      {r.matched ? (
                        <Badge tone="ok">{r.matched.name}</Badge>
                      ) : (
                        <Badge tone="info">自动建档</Badge>
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
