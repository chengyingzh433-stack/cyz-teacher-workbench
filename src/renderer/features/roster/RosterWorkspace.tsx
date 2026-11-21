import { useMemo, useState } from 'react';
import { Edit3, Plus, RotateCcw, Search, Upload, UserMinus } from 'lucide-react';
import type { ClassRecord, Gender, StudentMember } from '../../../shared/types';
import { characterPool } from '../../../shared/characters';
import { parseDelimitedText, previewRosterImport } from '../../../shared/roster-parse';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dropzone,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui/primitives';
import { Avatar } from '../classroom/SpriteArt';

export function RosterWorkspace({
  cls,
  members,
  allMembers,
  onRefresh,
  onOpenProfile,
  onNotify,
}: {
  cls: ClassRecord;
  members: StudentMember[];
  allMembers: StudentMember[];
  onRefresh: () => Promise<void>;
  onOpenProfile: (membershipId: string) => void;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [search, setSearch] = useState('');
  const [genderFilter, setGenderFilter] = useState<'all' | Gender>('all');

  // Edit / Add Student Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<StudentMember | null>(null);
  const [fName, setFName] = useState('');
  const [fNo, setFNo] = useState('');
  const [fGender, setFGender] = useState<Gender>('unspecified');
  const [fCharId, setFCharId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Remove confirmation
  const [removing, setRemoving] = useState<StudentMember | null>(null);

  // Batch import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStep, setImportStep] = useState<0 | 1>(0);
  const [delimiter, setDelimiter] = useState<',' | '\t'>('\t');
  const [hasHeader, setHasHeader] = useState(true);
  const [colName, setColName] = useState('0');
  const [colNo, setColNo] = useState('1');
  const [colGender, setColGender] = useState('2');
  const [excludedLines, setExcludedLines] = useState<Set<number>>(new Set());
  const [updateLines, setUpdateLines] = useState<Set<number>>(new Set());

  const readonly = cls.status === 'archived';
  const removedList = useMemo(
    () => allMembers.filter((m) => m.status === 'removed'),
    [allMembers],
  );

  const displayed = useMemo(() => {
    const base = showRemoved ? removedList : members;
    const q = search.trim();
    return base.filter((m) => {
      if (!showRemoved && genderFilter !== 'all' && m.gender !== genderFilter) return false;
      if (q && !m.name.includes(q) && !m.rosterNo.includes(q)) return false;
      return true;
    });
  }, [showRemoved, removedList, members, search, genderFilter]);

  const charUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members) {
      if (m.characterId && m.membershipId !== editing?.membershipId) {
        map.set(m.characterId, (map.get(m.characterId) || 0) + 1);
      }
    }
    return map;
  }, [members, editing]);

  function openStudentModal(member: StudentMember | null) {
    setEditing(member);
    setFName(member?.name || '');
    setFNo(member?.rosterNo || '');
    setFGender(member?.gender || 'unspecified');
    setFCharId(member?.characterId || null);
    setEditOpen(true);
  }

  async function saveStudent() {
    if (!fName.trim()) return;
    setSaving(true);
    try {
      await window.workbenchApi.roster.saveStudent(
        cls.id,
        {
          name: fName.trim(),
          rosterNo: fNo.trim(),
          gender: fGender,
          characterId: fGender === 'unspecified' ? null : fCharId,
        },
        editing?.membershipId,
      );
      await onRefresh();
      setEditOpen(false);
      onNotify(editing ? `已更新「${fName.trim()}」的档案` : `已添加学生「${fName.trim()}」`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  // Batch Import Parsing
  const parsedRaw = useMemo(() => {
    if (!importText.trim()) return [];
    try {
      return parseDelimitedText(importText, delimiter);
    } catch {
      return [];
    }
  }, [importText, delimiter]);

  const previewRows = useMemo(() => {
    if (!parsedRaw.length) return [];
    try {
      return previewRosterImport(
        allMembers,
        parsedRaw,
        { name: Number(colName), rosterNo: Number(colNo), gender: Number(colGender) },
        hasHeader,
      );
    } catch {
      return [];
    }
  }, [parsedRaw, allMembers, colName, colNo, colGender, hasHeader]);

  const maxCols = useMemo(
    () => Math.max(0, ...parsedRaw.slice(0, 20).map((r) => r.cells.length)),
    [parsedRaw],
  );

  function autoDetectMapping(text: string) {
    const det: ',' | '\t' = text.includes('\t') ? '\t' : ',';
    setDelimiter(det);
    try {
      const rows = parseDelimitedText(text, det);
      if (!rows.length) return;
      const first = rows[0].cells.map((x) => x.trim());
      const looksHeader = first.some((x) => /姓名|名字|学号|编号|性别/.test(x));
      setHasHeader(looksHeader);
      if (looksHeader) {
        const ni = first.findIndex((x) => /姓名|名字|name/i.test(x));
        const idI = first.findIndex((x) => /学号|编号|考号|no|id/i.test(x));
        const gi = first.findIndex((x) => /性别|gender/i.test(x));
        setColName(String(ni >= 0 ? ni : 0));
        setColNo(String(idI));
        setColGender(String(gi));
      } else {
        setColName('0');
        setColNo(first.length > 1 ? '1' : '-1');
        setColGender(first.length > 2 ? '2' : '-1');
      }
    } catch {
      // ignore
    }
  }

  async function commitBatchImport() {
    const valid = previewRows.filter((r) => !excludedLines.has(r.line));
    const bad = valid.filter((r) => r.errors.length > 0);
    if (bad.length) {
      onNotify(`仍有 ${bad.length} 行错误，请先点「排除全部错行」`, 'err');
      return;
    }
    const payload = valid
      .filter((r) => !r.matchMembershipId || updateLines.has(r.line))
      .map((r) => ({
        name: r.name,
        rosterNo: r.rosterNo,
        gender: r.gender,
        updateMembershipId: r.matchMembershipId,
      }));
    if (!payload.length) {
      onNotify('没有可提交的新增或更新学生', 'err');
      return;
    }
    setSaving(true);
    try {
      const res = await window.workbenchApi.roster.batchImport(cls.id, payload);
      await onRefresh();
      setImportOpen(false);
      setImportText('');
      setImportStep(0);
      onNotify(`批量导入完成：新增 ${res.added} 人，更新 ${res.updated} 人`);
    } catch (e) {
      onNotify((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-3 min-h-0">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 shrink-0">
        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-muted)] gap-1">
          <button
            type="button"
            onClick={() => setShowRemoved(false)}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
              !showRemoved
                ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            在读名单 ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setShowRemoved(true)}
            className={`px-3 py-1 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
              showRemoved
                ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            已移出 ({removedList.length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" disabled={readonly} onClick={() => openStudentModal(null)}>
            <Plus className="w-4 h-4" /> 添加学生
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={readonly}
            onClick={() => {
              setImportStep(0);
              setExcludedLines(new Set());
              setUpdateLines(new Set());
              setImportOpen(true);
            }}
          >
            <Upload className="w-4 h-4" /> 批量导入名单
          </Button>
        </div>
      </div>

      {/* Filter & Search Row */}
      <div className="flex items-center flex-wrap gap-2 shrink-0">
        <div className="relative w-60">
          <Search className="w-4 h-4 text-[var(--ink-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索姓名或学号…"
            className="pl-9 h-8"
          />
        </div>
        {!showRemoved && (
          <div className="flex items-center gap-1.5">
            {(
              [
                ['all', `全部 ${members.length}`],
                ['male', `男 ${members.filter((m) => m.gender === 'male').length}`],
                ['female', `女 ${members.filter((m) => m.gender === 'female').length}`],
                ['unspecified', `待填性别 ${members.filter((m) => m.gender === 'unspecified').length}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setGenderFilter(k)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                  genderFilter === k
                    ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--ink-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      <Card className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[var(--bg-sidebar)] text-[12px] text-[var(--ink-muted)]">
              <tr>
                <th className="py-2.5 px-4 font-semibold">学生（点击看成长档案）</th>
                <th className="py-2.5 px-4 font-semibold">班内学号</th>
                <th className="py-2.5 px-4 font-semibold">性别</th>
                <th className="py-2.5 px-4 font-semibold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] text-[13.5px]">
              {displayed.map((m) => (
                <tr key={m.membershipId} className="hover:bg-[var(--bg-hover)]/60 transition-colors">
                  <td className="py-2 px-4">
                    <button
                      type="button"
                      onClick={() => onOpenProfile(m.membershipId)}
                      className="flex items-center gap-2.5 hover:text-[var(--accent)] font-medium cursor-pointer"
                    >
                      <Avatar gender={m.gender} characterId={m.characterId} size={34} />
                      <span>{m.name}</span>
                    </button>
                  </td>
                  <td className="py-2 px-4 tabular-nums text-[var(--ink-secondary)]">
                    {m.rosterNo || '—'}
                  </td>
                  <td className="py-2 px-4">
                    <Badge tone={m.gender === 'male' ? 'info' : m.gender === 'female' ? 'accent' : 'warn'}>
                      {m.gender === 'male' ? '男' : m.gender === 'female' ? '女' : '待补全'}
                    </Badge>
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      {showRemoved ? (
                        <Button
                          size="xs"
                          disabled={readonly}
                          onClick={async () => {
                            await window.workbenchApi.roster.setStatus(m.membershipId, 'active');
                            await onRefresh();
                            onNotify(`已恢复「${m.name}」到在读名单`);
                          }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> 恢复在读
                        </Button>
                      ) : (
                        <>
                          <Button size="xs" variant="ghost" disabled={readonly} onClick={() => openStudentModal(m)}>
                            <Edit3 className="w-3.5 h-3.5" /> 编辑
                          </Button>
                          <Button
                            size="xs"
                            variant="danger-ghost"
                            disabled={readonly}
                            onClick={() => setRemoving(m)}
                          >
                            <UserMinus className="w-3.5 h-3.5" /> 移出
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!displayed.length && (
            <div className="py-16 text-center text-[var(--ink-muted)] text-sm">
              {showRemoved ? '暂无已移出学生' : '暂无匹配学生，可点击右上角「批量导入名单」'}
            </div>
          )}
        </div>
      </Card>

      {/* Add / Edit Student Modal with 29-Character Picker */}
      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title={editing ? `编辑学生 · ${editing.name}` : '添加学生'}
        size="lg"
        footer={
          <>
            <Button onClick={() => setEditOpen(false)}>取消</Button>
            <Button variant="primary" disabled={!fName.trim() || saving} onClick={() => void saveStudent()}>
              {saving ? '保存中…' : '保存档案'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              姓名 *
              <Input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="学生姓名" autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              班内编号 / 学号
              <Input value={fNo} onChange={(e) => setFNo(e.target.value)} placeholder="如 260301" />
            </label>
            <div className="flex flex-col gap-1.5 text-[13px] font-medium">
              性别（决定匹配角色池）
              <Select
                value={fGender}
                onValueChange={(v) => {
                  const g = v as Gender;
                  setFGender(g);
                  if (g === 'unspecified') setFCharId(null);
                  else {
                    const p = characterPool(g);
                    if (!p.some((c) => c.id === fCharId)) setFCharId(p[0]?.id || null);
                  }
                }}
                className="w-full h-9"
                options={[
                  { value: 'male', label: '男（9 个角色）' },
                  { value: 'female', label: '女（20 个角色）' },
                  { value: 'unspecified', label: '暂不填写（中性占位）' },
                ]}
              />
            </div>
          </div>

          {fGender !== 'unspecified' && (
            <div>
              <div className="text-[13px] font-medium mb-2">选择教室像素形象</div>
              <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto p-1">
                {characterPool(fGender).map((ch) => {
                  const used = charUsage.get(ch.id) || 0;
                  const active = fCharId === ch.id;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setFCharId(ch.id)}
                      className={`relative flex flex-col items-center gap-1 p-2 rounded-xl border transition-all cursor-pointer ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] ring-2 ring-[var(--accent)]/25'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-muted)]/50 hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      <span
                        className={`absolute top-1 right-1 text-[10px] px-1.5 rounded-full ${
                          used === 0 ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : 'bg-[var(--bg-muted)] text-[var(--ink-muted)]'
                        }`}
                      >
                        {used === 0 ? '未用' : `${used}人`}
                      </span>
                      <Avatar gender={fGender} characterId={ch.id} size={46} />
                      <span className="text-[11.5px] font-medium text-center leading-tight">{ch.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 2-Step Batch Import Modal */}
      <Modal
        open={importOpen}
        onOpenChange={setImportOpen}
        title="批量导入学生名单"
        subtitle="直接从 Excel / WPS 复制姓名与学号粘贴，或拖入 UTF-8 CSV 文件"
        size="lg"
        footer={
          importStep === 0 ? (
            <>
              <Button onClick={() => setImportOpen(false)}>取消</Button>
              <Button
                variant="primary"
                disabled={!parsedRaw.length}
                onClick={() => {
                  setExcludedLines(new Set());
                  setUpdateLines(new Set(previewRows.filter((r) => r.matchMembershipId).map((r) => r.line)));
                  setImportStep(1);
                }}
              >
                下一步：预览与核对 ({Math.max(0, parsedRaw.length - (hasHeader ? 1 : 0))} 人)
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setImportStep(0)}>上一步</Button>
              <Button variant="primary" disabled={saving} onClick={() => void commitBatchImport()}>
                {saving ? '写入中…' : '确认导入名单'}
              </Button>
            </>
          )
        }
      >
        {importStep === 0 ? (
          <div className="flex flex-col gap-3">
            <Dropzone
              accept=".csv,.tsv,.txt"
              title="拖入 CSV / TSV 名单文件"
              hint="支持逗号或制表符分隔，或在下方直接粘贴"
              onFiles={async (files) => {
                const txt = await files[0].text();
                setImportText(txt);
                autoDetectMapping(txt);
              }}
            />
            <Textarea
              rows={8}
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                autoDetectMapping(e.target.value);
              }}
              placeholder={'姓名\t学号\t性别\n林知行\t260301\t男\n沈清禾\t260302\t女'}
            />
            {maxCols > 0 && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  ['姓名列', colName, setColName, false],
                  ['学号/编号列', colNo, setColNo, true],
                  ['性别列', colGender, setColGender, true],
                ].map(([label, val, setter, allowNone]) => (
                  <div key={String(label)} className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--ink-muted)]">{String(label)}</span>
                    <Select
                      value={String(val)}
                      onValueChange={setter as (v: string) => void}
                      className="w-full"
                      options={[
                        ...(allowNone ? [{ value: '-1', label: '无此列' }] : []),
                        ...Array.from({ length: maxCols }, (_, i) => ({
                          value: String(i),
                          label: `第 ${i + 1} 列（${parsedRaw[0]?.cells[i]?.slice(0, 12) || '空'}）`,
                        })),
                      ]}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="accent">共 {previewRows.length} 行</Badge>
                <Badge tone="danger">
                  错误 {previewRows.filter((r) => !excludedLines.has(r.line) && r.errors.length).length} 行
                </Badge>
              </div>
              <Button
                size="xs"
                onClick={() =>
                  setExcludedLines(
                    new Set(previewRows.filter((r) => r.errors.length).map((r) => r.line)),
                  )
                }
              >
                一键排除全部错行
              </Button>
            </div>
            <div className="max-h-80 overflow-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-left text-[12.5px] border-collapse">
                <thead className="sticky top-0 bg-[var(--bg-sidebar)] text-[var(--ink-muted)]">
                  <tr>
                    <th className="p-2">行</th>
                    <th className="p-2">姓名</th>
                    <th className="p-2">编号</th>
                    <th className="p-2">性别</th>
                    <th className="p-2">状态</th>
                    <th className="p-2">处理</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {previewRows.map((r) => {
                    const ex = excludedLines.has(r.line);
                    return (
                      <tr key={r.line} className={ex ? 'opacity-45' : r.errors.length ? 'bg-[var(--danger-soft)]/50' : ''}>
                        <td className="p-2 tabular-nums">{r.line}</td>
                        <td className="p-2 font-medium">{r.name || '—'}</td>
                        <td className="p-2 tabular-nums">{r.rosterNo || '—'}</td>
                        <td className="p-2">{r.gender === 'male' ? '男' : r.gender === 'female' ? '女' : '未填'}</td>
                        <td className="p-2">
                          {r.errors.length ? (
                            <span className="text-[var(--danger)]">{r.errors.join('；')}</span>
                          ) : r.matchMembershipId ? (
                            <span className="text-[var(--info)]">已有编号（{r.changes.join('，') || '无变更'}）</span>
                          ) : (
                            <span className="text-[var(--ok)]">新增</span>
                          )}
                        </td>
                        <td className="p-2">
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              const next = new Set(excludedLines);
                              if (ex) next.delete(r.line);
                              else next.add(r.line);
                              setExcludedLines(next);
                            }}
                          >
                            {ex ? '恢复' : '排除'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="移出本班在读名单"
        description={`将「${removing?.name || ''}」移出在读名单并清空座位？历次考试成绩与档案均完整保留，随时可在「已移出」中恢复。`}
        confirmLabel="确认移出"
        danger
        onConfirm={async () => {
          if (!removing) return;
          await window.workbenchApi.roster.setStatus(removing.membershipId, 'removed');
          setRemoving(null);
          await onRefresh();
          onNotify(`已移出「${removing.name}」`);
        }}
      />
    </div>
  );
}
