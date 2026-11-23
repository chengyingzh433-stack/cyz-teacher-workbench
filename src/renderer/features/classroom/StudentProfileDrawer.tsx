import { useCallback, useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import {
  Award,
  CheckCircle2,
  Clock,
  Edit3,
  FileImage,
  MapPin,
  MessageSquareHeart,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import type {
  HomeroomCommStatus,
  HomeroomCommType,
  StudentCommRecord,
  StudentGrowthProfile,
  StudentMember,
} from '../../../shared/types';
import {
  HOMEROOM_CHECK_KINDS,
  HOMEROOM_COMM_STATUSES,
  HOMEROOM_COMM_TYPES,
} from '../../../shared/homeroom-materials';
import { formatScore } from '../../../shared/score-policy';
import { resolveDisplayCharacter } from '../../../shared/characters';
import { getTheme } from '../../themes';
import {
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  Modal,
  Select,
  Textarea,
} from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';
import { Avatar } from './SpriteArt';

export function StudentProfileDrawer({
  membershipId,
  themeId,
  readonly,
  onClose,
  onEditStudent,
  onJumpToExam,
  onHomeroomChanged,
  onNotify,
}: {
  membershipId: string | null;
  themeId: string;
  readonly: boolean;
  onClose: () => void;
  onEditStudent: (member: StudentMember) => void;
  onJumpToExam: (examId: string) => void;
  onHomeroomChanged?: () => void;
  onNotify?: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [profile, setProfile] = useState<StudentGrowthProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'academics' | 'homeroom'>('academics');

  // Inline comm form state inside student drawer
  const [formOpen, setFormOpen] = useState(false);
  const [editingComm, setEditingComm] = useState<StudentCommRecord | null>(null);
  const [cType, setCType] = useState<HomeroomCommType>('即时电话');
  const [cReason, setCReason] = useState('');
  const [cPerf, setCPerf] = useState('');
  const [cFeedback, setCFeedback] = useState('');
  const [cPlan, setCPlan] = useState('');
  const [cFollow, setCFollow] = useState('');
  const [cStatus, setCStatus] = useState<HomeroomCommStatus>('待跟进');
  const [savingComm, setSavingComm] = useState(false);

  const loadProfile = useCallback(async (mid: string) => {
    setLoading(true);
    try {
      const res = await window.workbenchApi.roster.getGrowthProfile(mid);
      setProfile(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!membershipId) {
      setProfile(null);
      setFormOpen(false);
      setEditingComm(null);
      return;
    }
    setActiveTab('academics');
    setFormOpen(false);
    setEditingComm(null);
    void loadProfile(membershipId);
  }, [membershipId, loadProfile]);

  function openCommForm(rec: StudentCommRecord | null) {
    setEditingComm(rec);
    setCType(rec?.commType || '即时电话');
    setCReason(rec?.reason || '');
    setCPerf(rec?.studentPerf || '');
    setCFeedback(rec?.parentFeedback || '');
    setCPlan(rec?.actionPlan || '');
    setCFollow(rec?.followUpDate || '');
    setCStatus(rec?.status || '待跟进');
    setFormOpen(true);
  }

  async function submitComm() {
    if (!profile) return;
    setSavingComm(true);
    try {
      await window.workbenchApi.homeroom.saveComm({
        classId: profile.member.classId,
        id: editingComm?.id,
        membershipId: profile.member.membershipId,
        studentName: profile.member.name,
        commType: cType,
        reason: cReason,
        studentPerf: cPerf,
        parentFeedback: cFeedback,
        actionPlan: cPlan,
        followUpDate: cFollow,
        status: cStatus,
      });
      setFormOpen(false);
      setEditingComm(null);
      await loadProfile(profile.member.membershipId);
      onHomeroomChanged?.();
      onNotify?.(editingComm ? '已更新家校沟通记录' : `已为「${profile.member.name}」新增家校沟通记录`);
    } catch (e) {
      onNotify?.((e as Error).message, 'err');
    } finally {
      setSavingComm(false);
    }
  }

  const theme = getTheme(themeId);
  const chartOption: echarts.EChartsOption | null = useMemo(() => {
    if (!profile || !profile.examHistory.length) return null;
    const p = theme.chartPalette;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
      },
      legend: {
        top: 0,
        right: 4,
        textStyle: { color: p.muted, fontSize: 11 },
      },
      grid: { top: 32, right: 20, bottom: 26, left: 36 },
      xAxis: {
        type: 'category',
        data: profile.examHistory.map((e) => e.examTitle.slice(0, 10)),
        axisLabel: { color: p.muted, fontSize: 11 },
        axisLine: { lineStyle: { color: p.grid } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: p.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: p.grid, type: 'dashed' } },
      },
      series: [
        {
          name: '个人得分',
          type: 'line',
          smooth: true,
          symbolSize: 8,
          data: profile.examHistory.map((e) => (e.units !== null ? Number((e.units / 100).toFixed(2)) : null)),
          itemStyle: { color: p.primary },
          lineStyle: { width: 2.5, color: p.primary },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${p.primary}33` },
                { offset: 1, color: `${p.primary}00` },
              ],
            },
          },
        },
        {
          name: '班级均分',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: profile.examHistory.map((e) =>
            e.classMeanUnits !== null ? Number((e.classMeanUnits / 100).toFixed(2)) : null,
          ),
          lineStyle: { width: 1.5, type: 'dashed', color: p.muted },
          itemStyle: { color: p.muted },
        },
      ],
    };
  }, [profile, theme]);

  const char = profile
    ? resolveDisplayCharacter(profile.member.gender, profile.member.characterId)
    : null;

  return (
    <>
      <Drawer
        open={Boolean(membershipId)}
        onOpenChange={(open) => !open && onClose()}
        title={profile ? `${profile.member.name} · 成长档案` : '学生档案'}
        subtitle={
          profile
            ? `编号 ${profile.member.rosterNo || '未填'} · ${
                profile.member.gender === 'male'
                  ? '男'
                  : profile.member.gender === 'female'
                    ? '女'
                    : '未填性别'
              }`
            : '正在读取…'
        }
      >
        {loading || !profile ? (
          <div className="py-12 text-center text-[var(--ink-muted)] text-sm">正在加载学生资料…</div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Hero Identity Card */}
            <Card className="p-4 flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <Avatar
                  gender={profile.member.gender}
                  characterId={profile.member.characterId}
                  size={68}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-[var(--ink-primary)]">
                    {profile.member.name}
                  </h3>
                  {char && <Badge tone="accent">{char.name}</Badge>}
                  {profile.comms.some((c) => c.status === '待跟进') && (
                    <Badge tone="warn">
                      待跟进 {profile.comms.filter((c) => c.status === '待跟进').length}
                    </Badge>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-2 flex-wrap text-xs text-[var(--ink-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {profile.seat
                      ? `${profile.seat.planName} · 第 ${profile.seat.row + 1} 行第 ${profile.seat.col + 1} 列`
                      : '暂未安排座位'}
                  </span>
                </div>
                {!readonly && (
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <Button
                      size="xs"
                      onClick={() => {
                        const m = profile.member;
                        onClose();
                        onEditStudent(m);
                      }}
                    >
                      <Edit3 className="w-3.5 h-3.5" /> 编辑资料
                    </Button>
                    <Button
                      size="xs"
                      variant="soft"
                      onClick={() => {
                        setActiveTab('homeroom');
                        openCommForm(null);
                      }}
                    >
                      <MessageSquareHeart className="w-3.5 h-3.5" /> 记一次家校沟通
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            {/* Drawer Mode Switcher */}
            <div className="inline-flex p-1 rounded-xl bg-[var(--bg-muted)] gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('academics')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'academics'
                    ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" /> 学业与答卷 ({profile.examHistory.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('homeroom')}
                className={`flex-1 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                  activeTab === 'homeroom'
                    ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
                }`}
              >
                <MessageSquareHeart className="w-3.5 h-3.5" /> 家校与日常 ({profile.comms.length})
              </button>
            </div>

            {activeTab === 'academics' ? (
              <>
                {/* Exam Trend Curve */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-[var(--accent)]" /> 历次考试成绩轨迹
                    </h4>
                    <Badge>{profile.examHistory.length} 场记录</Badge>
                  </div>
                  {chartOption ? (
                    <Card className="p-3">
                      <EChart option={chartOption} height={210} />
                      <div className="mt-3 divide-y divide-[var(--border-subtle)]">
                        {profile.examHistory
                          .slice()
                          .reverse()
                          .map((pt) => (
                            <button
                              key={pt.examId}
                              type="button"
                              onClick={() => {
                                onClose();
                                onJumpToExam(pt.examId);
                              }}
                              className="w-full py-2 px-1 flex items-center justify-between gap-2 text-left hover:bg-[var(--bg-hover)] rounded-lg transition-colors cursor-pointer"
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium truncate">{pt.examTitle}</div>
                                <div className="text-[11.5px] text-[var(--ink-muted)]">
                                  {pt.examDate} · {pt.columnLabel}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                                <span className="text-[14px] font-bold text-[var(--accent)]">
                                  {pt.units !== null ? `${formatScore(pt.units)} 分` : pt.status === 'absent' ? '缺考' : '未录'}
                                </span>
                                {pt.rank !== null && (
                                  <Badge tone="info">
                                    <Award className="w-3 h-3" /> #{pt.rank}/{pt.totalScored}
                                  </Badge>
                                )}
                              </div>
                            </button>
                          ))}
                      </div>
                    </Card>
                  ) : (
                    <Card className="p-6 text-center text-[13px] text-[var(--ink-muted)]">
                      本班还没有该生的考试记录。在「统一考试中心」导入成绩单或完成阅卷后，这里将自动绘出成长曲线。
                    </Card>
                  )}
                </div>

                {/* Recent Handwritten Submissions */}
                {profile.recentSubmissions.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
                      <FileImage className="w-4 h-4 text-[var(--accent)]" /> 近期手写答卷
                    </h4>
                    <div className="grid grid-cols-2 gap-2.5">
                      {profile.recentSubmissions.map((sub) => (
                        <Card key={sub.submissionId} className="p-2.5 flex flex-col gap-2">
                          {sub.assetRelPaths[0] && (
                            <button
                              type="button"
                              onClick={() => setPreviewImg(`workbench-asset://vault/${sub.assetRelPaths[0]}`)}
                              className="h-24 rounded-lg overflow-hidden bg-[var(--grading-canvas)] flex items-center justify-center cursor-pointer"
                            >
                              <img
                                src={`workbench-asset://vault/${sub.assetRelPaths[0]}`}
                                alt="答卷缩略图"
                                className="w-full h-full object-cover"
                              />
                            </button>
                          )}
                          <div className="flex items-center justify-between gap-1 text-xs">
                            <span className="truncate font-medium">
                              {sub.examTitle} · 第 {sub.itemLabel} 题
                            </span>
                            <Badge tone={sub.scoreUnits !== null ? 'ok' : 'neutral'}>
                              {sub.scoreUnits !== null
                                ? `${formatScore(sub.scoreUnits)}/${formatScore(sub.maxUnits)}`
                                : '待评'}
                            </Badge>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Daily Routine Check Summary */}
                <Card className="p-3.5">
                  <div className="text-[12.5px] font-semibold text-[var(--ink-secondary)] mb-2.5">
                    日常点检记录汇总（来自教室座位点检）
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      ['考勤异常', profile.dailySummary.attendanceAnomalies, 'warn'],
                      ['作业缺交', profile.dailySummary.homeworkMissing, 'danger'],
                      ['回执未交', profile.dailySummary.receiptMissing, 'warn'],
                      ['违纪记录', profile.dailySummary.disciplineCount, 'danger'],
                    ].map(([label, val]) => (
                      <div
                        key={String(label)}
                        className="rounded-lg bg-[var(--bg-muted)]/70 py-2 px-1"
                      >
                        <div className="text-[11px] text-[var(--ink-muted)]">{label}</div>
                        <div
                          className={`text-[18px] font-bold tabular-nums mt-0.5 ${
                            Number(val) > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'
                          }`}
                        >
                          {val}
                        </div>
                      </div>
                    ))}
                  </div>
                  {profile.dailySummary.recentBatches.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {profile.dailySummary.recentBatches.map((b) => (
                        <Badge key={b.id} tone={b.kind === 'homework' || b.kind === 'discipline' ? 'danger' : 'warn'}>
                          {b.checkDate} · {HOMEROOM_CHECK_KINDS[b.kind].anomalyLabel}（{b.title}）
                        </Badge>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Parent-Teacher Communications Timeline */}
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-semibold flex items-center gap-1.5">
                    <MessageSquareHeart className="w-4 h-4 text-[var(--accent)]" /> 家校沟通与谈心台账
                  </h4>
                  {!readonly && (
                    <Button size="xs" variant="primary" onClick={() => openCommForm(null)}>
                      <Plus className="w-3.5 h-3.5" /> 新增记录
                    </Button>
                  )}
                </div>

                {formOpen && !readonly && (
                  <Card className="p-3.5 flex flex-col gap-2.5 border-[var(--accent)]/40">
                    <div className="text-[13px] font-semibold">
                      {editingComm ? '编辑家校沟通记录' : `新增「${profile.member.name}」家校沟通记录`}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                        沟通类型
                        <Select
                          value={cType}
                          onValueChange={(v) => setCType(v as HomeroomCommType)}
                          className="w-full"
                          options={HOMEROOM_COMM_TYPES.map((t) => ({ value: t, label: t }))}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                        跟进状态
                        <Select
                          value={cStatus}
                          onValueChange={(v) => setCStatus(v as HomeroomCommStatus)}
                          className="w-full"
                          options={HOMEROOM_COMM_STATUSES.map((s) => ({ value: s, label: s }))}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                        沟通事由
                        <Input
                          value={cReason}
                          onChange={(e) => setCReason(e.target.value)}
                          placeholder="成绩变化、作业、情绪等"
                          className="h-8 text-xs"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                        后续跟进日期
                        <input
                          type="date"
                          value={cFollow}
                          onChange={(e) => setCFollow(e.target.value)}
                          className="h-8 px-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-strong)] text-xs text-[var(--ink-primary)]"
                        />
                      </label>
                    </div>
                    <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                      学生表现
                      <Textarea
                        rows={2}
                        value={cPerf}
                        onChange={(e) => setCPerf(e.target.value)}
                        className="text-xs"
                        placeholder="近期在校学习、纪律、情绪表现…"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                      家长反馈
                      <Textarea
                        rows={2}
                        value={cFeedback}
                        onChange={(e) => setCFeedback(e.target.value)}
                        className="text-xs"
                        placeholder="家长在家观察到的情况与态度…"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-[var(--ink-muted)]">
                      共商整改方案
                      <Textarea
                        rows={2}
                        value={cPlan}
                        onChange={(e) => setCPlan(e.target.value)}
                        className="text-xs"
                        placeholder="家校双方约定的下一步行动…"
                      />
                    </label>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button size="xs" onClick={() => setFormOpen(false)}>
                        取消
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        disabled={savingComm}
                        onClick={() => void submitComm()}
                      >
                        {savingComm ? '保存中…' : '保存记录'}
                      </Button>
                    </div>
                  </Card>
                )}

                {profile.comms.length > 0 ? (
                  <div className="flex flex-col gap-2.5">
                    {profile.comms.map((c) => (
                      <Card key={c.id} className="p-3.5 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <Badge tone={c.status === '待跟进' ? 'warn' : 'ok'}>{c.status}</Badge>
                            <Badge tone="info">{c.commType}</Badge>
                          </div>
                          <div className="text-[11.5px] text-[var(--ink-muted)] tabular-nums flex items-center gap-2">
                            <span>{c.commDate}</span>
                            {c.followUpDate && (
                              <span className="inline-flex items-center gap-0.5 text-[var(--warn)]">
                                <Clock className="w-3 h-3" /> 跟进 {c.followUpDate}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[12.5px] leading-relaxed flex flex-col gap-1 text-[var(--ink-primary)]">
                          {c.reason && (
                            <div>
                              <span className="font-semibold text-[var(--ink-secondary)]">事由：</span>
                              {c.reason}
                            </div>
                          )}
                          {c.studentPerf && (
                            <div>
                              <span className="font-semibold text-[var(--ink-secondary)]">表现：</span>
                              {c.studentPerf}
                            </div>
                          )}
                          {c.parentFeedback && (
                            <div>
                              <span className="font-semibold text-[var(--ink-secondary)]">反馈：</span>
                              {c.parentFeedback}
                            </div>
                          )}
                          {c.actionPlan && (
                            <div>
                              <span className="font-semibold text-[var(--ink-secondary)]">方案：</span>
                              {c.actionPlan}
                            </div>
                          )}
                        </div>
                        {!readonly && (
                          <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--border-subtle)]">
                            <Button
                              size="xs"
                              variant="soft"
                              onClick={async () => {
                                await window.workbenchApi.homeroom.toggleCommStatus(c.id);
                                await loadProfile(profile.member.membershipId);
                                onHomeroomChanged?.();
                              }}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {c.status === '待跟进' ? '标记已办结' : '改为待跟进'}
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => openCommForm(c)}>
                              <Edit3 className="w-3.5 h-3.5" /> 编辑
                            </Button>
                            <Button
                              size="xs"
                              variant="danger-ghost"
                              onClick={async () => {
                                await window.workbenchApi.homeroom.deleteComm(c.id);
                                await loadProfile(profile.member.membershipId);
                                onHomeroomChanged?.();
                                onNotify?.('已删除该条沟通记录');
                              }}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> 删除
                            </Button>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="p-6 text-center text-[13px] text-[var(--ink-muted)]">
                    暂无该生的家校沟通或谈心记录。点击上方「新增记录」即可留存完整四联档案。
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={Boolean(previewImg)}
        onOpenChange={(o) => !o && setPreviewImg(null)}
        title="手写答卷原图预览"
        size="lg"
      >
        {previewImg && (
          <div className="rounded-xl bg-[var(--grading-canvas)] p-3 flex justify-center">
            <img src={previewImg} alt="答卷原图" className="max-h-[70vh] object-contain rounded" />
          </div>
        )}
      </Modal>
    </>
  );
}
