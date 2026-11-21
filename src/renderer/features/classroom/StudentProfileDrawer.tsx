import { useEffect, useMemo, useState } from 'react';
import type * as echarts from 'echarts';
import { Award, Edit3, FileImage, MapPin, TrendingUp } from 'lucide-react';
import type { StudentGrowthProfile, StudentMember } from '../../../shared/types';
import { formatScore } from '../../../shared/score-policy';
import { resolveDisplayCharacter } from '../../../shared/characters';
import { getTheme } from '../../themes';
import { Badge, Button, Card, Drawer, Modal } from '../../components/ui/primitives';
import { EChart } from '../../components/ui/EChart';
import { Avatar } from './SpriteArt';

export function StudentProfileDrawer({
  membershipId,
  themeId,
  readonly,
  onClose,
  onEditStudent,
  onJumpToExam,
}: {
  membershipId: string | null;
  themeId: string;
  readonly: boolean;
  onClose: () => void;
  onEditStudent: (member: StudentMember) => void;
  onJumpToExam: (examId: string) => void;
}) {
  const [profile, setProfile] = useState<StudentGrowthProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  useEffect(() => {
    if (!membershipId) {
      setProfile(null);
      return;
    }
    let alive = true;
    setLoading(true);
    window.workbenchApi.roster
      .getGrowthProfile(membershipId)
      .then((res) => {
        if (alive) setProfile(res);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [membershipId]);

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
                  <div className="mt-3">
                    <Button
                      size="xs"
                      onClick={() => {
                        const m = profile.member;
                        onClose();
                        onEditStudent(m);
                      }}
                    >
                      <Edit3 className="w-3.5 h-3.5" /> 编辑资料与更换形象
                    </Button>
                  </div>
                )}
              </div>
            </Card>

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
