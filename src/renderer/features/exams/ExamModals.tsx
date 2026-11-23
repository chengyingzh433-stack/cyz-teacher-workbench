import { useEffect, useState } from 'react';
import type { ExamDetail, ExamSummary, ScoreStatus } from '../../../shared/types';
import { parsePoints } from '../../../shared/score-policy';
import { Button, Input, Modal, Select } from '../../components/ui/primitives';
import type { ScoreEditDraft } from './ExamAnalyticsView';

export function ExamModals({
  classId,
  activeExam,
  detail,
  passPct,
  excPct,
  createOpen,
  onCreateOpenChange,
  onExamCreated,
  editCell,
  onEditCellChange,
  onDetailUpdated,
  exportOpen,
  onExportOpenChange,
  onNotify,
}: {
  classId: string;
  activeExam: ExamSummary | null;
  detail: ExamDetail | null;
  passPct: number;
  excPct: number;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onExamCreated: (examId: string) => Promise<void>;
  editCell: ScoreEditDraft | null;
  onEditCellChange: (draft: ScoreEditDraft | null) => void;
  onDetailUpdated: (detail: ExamDetail) => void;
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [exportIdentified, setExportIdentified] = useState(false);

  useEffect(() => {
    if (createOpen) {
      setNewTitle('');
      setNewDate(new Date().toISOString().slice(0, 10));
    }
  }, [createOpen]);

  return (
    <>
      {/* Create Blank Exam Modal */}
      <Modal
        open={createOpen}
        onOpenChange={onCreateOpenChange}
        title="新建考试"
        subtitle="建好后既可挂载手写主观题进行 AI 阅卷，也可随时追加导入 Excel 成绩单"
        size="sm"
        footer={
          <>
            <Button onClick={() => onCreateOpenChange(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!newTitle.trim()}
              onClick={async () => {
                const created = await window.workbenchApi.exams.create({
                  classId,
                  title: newTitle.trim(),
                  examDate: newDate,
                });
                onCreateOpenChange(false);
                await onExamCreated(created.id);
                onNotify(`已建立考试「${created.title}」`);
              }}
            >
              创建考试
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            考试名称 *
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="如：物理力学综合测试"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium">
            考试日期
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </label>
        </div>
      </Modal>

      {/* Inline Score Revision Modal (writes score_audit_logs!) */}
      <Modal
        open={Boolean(editCell)}
        onOpenChange={(o) => !o && onEditCellChange(null)}
        title={editCell ? `修订成绩 · ${editCell.studentName}` : ''}
        subtitle={editCell ? `科目：${editCell.columnLabel}（修改后将自动写入改分留痕日志）` : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => onEditCellChange(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!editCell || !detail) return;
                try {
                  const units = editCell.status === 'score' ? parsePoints(editCell.value) : null;
                  const updated = await window.workbenchApi.exams.updateScoreCell({
                    examId: detail.exam.id,
                    columnId: editCell.columnId,
                    membershipId: editCell.membershipId,
                    status: editCell.status,
                    units,
                    reason: editCell.reason,
                  });
                  onDetailUpdated(updated);
                  onEditCellChange(null);
                  onNotify(`已修订「${editCell.studentName}」成绩并留痕`);
                } catch (e) {
                  onNotify((e as Error).message, 'err');
                }
              }}
            >
              确认修订
            </Button>
          </>
        }
      >
        {editCell && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">状态</span>
              <Select
                value={editCell.status}
                onValueChange={(v) => onEditCellChange({ ...editCell, status: v as ScoreStatus })}
                className="w-full"
                options={[
                  { value: 'score', label: '正常得分' },
                  { value: 'absent', label: '缺考（不拉低均分）' },
                  { value: 'exempt', label: '免考（不拉低均分）' },
                  { value: 'missing', label: '未录入' },
                ]}
              />
            </div>
            {editCell.status === 'score' && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                新分值
                <Input
                  autoFocus
                  value={editCell.value}
                  onChange={(e) => onEditCellChange({ ...editCell, value: e.target.value })}
                  placeholder="如 86.5"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium">
              修订原因（记入日志）
              <Input
                value={editCell.reason}
                onChange={(e) => onEditCellChange({ ...editCell, reason: e.target.value })}
                placeholder="如：复查试卷漏加 2 分"
              />
            </label>
          </div>
        )}
      </Modal>

      {/* Export Dialog */}
      <Modal
        open={exportOpen}
        onOpenChange={onExportOpenChange}
        title="导出成绩与分析报告"
        subtitle={activeExam?.title}
        size="sm"
        footer={
          <>
            <Button
              onClick={async () => {
                if (!activeExam) return;
                const res = await window.workbenchApi.exams.exportReport({
                  examId: activeExam.id,
                  format: 'csv',
                  identified: exportIdentified,
                  passPercent: passPct,
                  excellentPercent: excPct,
                });
                if (res) {
                  onExportOpenChange(false);
                  onNotify(`已导出 CSV 至 ${res.path}`);
                }
              }}
            >
              导出 CSV
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!activeExam) return;
                const res = await window.workbenchApi.exams.exportReport({
                  examId: activeExam.id,
                  format: 'html',
                  identified: exportIdentified,
                  passPercent: passPct,
                  excellentPercent: excPct,
                });
                if (res) {
                  onExportOpenChange(false);
                  onNotify(`已导出精美 HTML 报告至 ${res.path}`);
                }
              }}
            >
              导出离线 HTML 报告
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2.5">
          {[
            [false, '匿名脱敏版（推荐教研分享）', '以“学生1、学生2…”替代姓名并隐藏学号'],
            [true, '完整实名版（限本人归档）', '保留完整姓名与班内学号'],
          ].map(([flag, title, desc]) => (
            <button
              key={String(flag)}
              type="button"
              onClick={() => setExportIdentified(Boolean(flag))}
              className={`p-3 rounded-xl border text-left cursor-pointer ${
                exportIdentified === flag
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className="text-[13px] font-semibold">{String(title)}</div>
              <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5">{String(desc)}</div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
