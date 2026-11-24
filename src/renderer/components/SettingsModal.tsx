import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { UpdateState, VaultInfo } from '../../shared/types';
import { GITHUB_RELEASES_PAGE } from '../../shared/updater-utils';
import { listThemes } from '../themes';
import { AiSettingsTab } from './AiSettingsTab';
import { Badge, Button, Card, ConfirmDialog, Input, Modal } from './ui/primitives';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialTab = 'theme',
  themeId,
  vaultInfo,
  updateState,
  onChangeTheme,
  onVaultChanged,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: 'theme' | 'ai' | 'vault';
  themeId: string;
  vaultInfo: VaultInfo | null;
  updateState?: UpdateState | null;
  onChangeTheme: (id: string) => void;
  onVaultChanged: (info: VaultInfo) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'theme' | 'ai' | 'vault'>(initialTab);
  const [mirrorUrl, setMirrorUrl] = useState('');
  const [savingMirror, setSavingMirror] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open || tab !== 'vault') return;
    void window.workbenchApi.vault.getPreferences().then((p) => {
      setMirrorUrl(p.updateMirrorUrl || '');
    });
  }, [open, tab]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="工作台设置"
      subtitle={`当前版本 v${window.workbenchApi.appVersion} · 外观主题引擎 · 系统钥匙串 AI 连接 · 本地资料库`}
      size="lg"
    >
      <div className="flex gap-1.5 mb-4 p-1 rounded-xl bg-[var(--bg-muted)]">
        {(
          [
            ['theme', '外观与主题风格', Palette],
            ['ai', 'AI 模型与系统钥匙串', Sparkles],
            ['vault', '资料库与版本更新', HardDrive],
          ] as const
        ).map(([k, label, IconComp]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 py-1.5 px-3 rounded-lg text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
              tab === k
                ? 'bg-[var(--bg-surface)] text-[var(--ink-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'
            }`}
          >
            <IconComp className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* TAB 1: Extensible Design Token Theme Engine (7 Preset Themes) */}
      {tab === 'theme' && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {listThemes().map((t) => {
              const active = themeId === t.id;
              const isPixel = t.id === 'cozy-pixel';
              const isGlass = t.windowMaterial !== 'opaque';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeTheme(t.id)}
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex flex-col gap-2.5 ${
                    active
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]/55 ring-2 ring-[var(--accent)]/25'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  {/* Mini Desktop Workbench Mockup Preview */}
                  <div
                    className="h-24 rounded-xl overflow-hidden flex relative"
                    style={{
                      background: t.preview.canvas,
                      border: isPixel ? `2px solid ${t.preview.border}` : `1px solid ${t.preview.border}`,
                      boxShadow: isPixel ? '2px 2px 0 rgba(74,55,40,0.28)' : undefined,
                    }}
                  >
                    <div
                      className="w-[28%] h-full p-2 flex flex-col gap-1.5 border-r"
                      style={{
                        background: t.preview.sidebar,
                        borderColor: t.preview.border,
                      }}
                    >
                      <div className="flex gap-1 mb-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#ff5f57]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#febc2e]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#28c840]" />
                      </div>
                      <div
                        className="h-2.5 w-full rounded-md"
                        style={{ background: t.preview.accent, opacity: 0.85 }}
                      />
                      <div
                        className="h-1.5 w-3/4 rounded-full"
                        style={{ background: t.chartPalette.muted, opacity: 0.35 }}
                      />
                      <div
                        className="h-1.5 w-2/3 rounded-full"
                        style={{ background: t.chartPalette.muted, opacity: 0.25 }}
                      />
                    </div>
                    <div className="flex-1 p-2 flex flex-col gap-1.5">
                      <div
                        className="h-7 rounded-md flex items-center justify-center"
                        style={{
                          background: t.preview.board,
                          border: isPixel ? `1.5px solid ${t.preview.border}` : undefined,
                        }}
                      >
                        <div className="w-12 h-1 rounded-full bg-white/55" />
                      </div>
                      <div className="flex-1 flex gap-1.5">
                        <div
                          className="flex-1 rounded-lg p-1.5 flex items-end gap-1"
                          style={{
                            background: t.preview.surface,
                            border: isPixel ? `1.5px solid ${t.preview.border}` : `1px solid ${t.preview.border}`,
                          }}
                        >
                          {[45, 72, 92, 64, 80].map((h, i) => (
                            <div
                              key={i}
                              className="flex-1 rounded-t-sm"
                              style={{
                                height: `${h}%`,
                                background: i % 2 === 0 ? t.preview.accent : t.preview.secondary,
                              }}
                            />
                          ))}
                        </div>
                        <div
                          className="w-12 rounded-lg p-1.5 flex flex-col justify-center gap-1"
                          style={{
                            background: t.preview.surface,
                            border: isPixel ? `1.5px solid ${t.preview.border}` : `1px solid ${t.preview.border}`,
                          }}
                        >
                          <div className="h-2 w-7 rounded-sm" style={{ background: t.preview.accent }} />
                          <div
                            className="h-1.5 w-5 rounded-full"
                            style={{ background: t.chartPalette.muted, opacity: 0.35 }}
                          />
                        </div>
                      </div>
                    </div>
                    {isGlass && (
                      <span className="absolute top-1.5 right-1.5 text-[9.5px] px-1.5 py-0.5 rounded-full bg-black/45 text-white backdrop-blur-sm">
                        毛玻璃
                      </span>
                    )}
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13.5px] font-semibold">{t.name}</span>
                        <Badge tone={active ? 'accent' : 'neutral'}>{t.badge}</Badge>
                      </div>
                      <div className="text-[11.5px] text-[var(--ink-muted)] mt-0.5 leading-snug">
                        {t.tagline}
                      </div>
                    </div>
                    {active && (
                      <span className="w-5 h-5 rounded-full bg-[var(--accent)] text-[var(--accent-ink)] flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="p-3 rounded-xl bg-[var(--bg-muted)]/75 text-xs text-[var(--ink-secondary)] leading-relaxed">
            <strong>原生桌面材质说明：</strong>
            {window.workbenchApi.platform === 'darwin'
              ? '当前为 macOS：选择「晨雾毛玻璃」或「极光深玻」会自动启用系统原生实景磨砂透窗（vibrancy），拖动窗口可柔和折射桌面壁纸，同时全站字体、矢量教室光影与 ECharts 图表自动联动切换。'
              : '当前为 Windows：选择「晨雾毛玻璃」或「极光深玻」在 Win11 上自动开启原生 Acrylic 磨砂材质，在 Win10 上优雅回退至高通透柔光弥散毛玻璃；全站支持 ⌘K / Ctrl+K 搜索主题名称一键秒切。'}
          </div>
        </div>
      )}

      {/* TAB 2: AI Models & OS Keychain */}
      {tab === 'ai' && <AiSettingsTab open={open} onNotify={onNotify} />}

      {/* TAB 3: Obsidian-Style Local Vault */}
      {tab === 'vault' && vaultInfo && (
        <div className="flex flex-col gap-4">
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-[var(--ink-muted)]">当前本地资料库文件夹</div>
                <div className="text-[14px] font-semibold mt-0.5 break-all">{vaultInfo.path}</div>
              </div>
              <Badge tone="ok">SQLite 单文件直存</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">主库体积</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{formatBytes(vaultInfo.dbBytes)}</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">答卷照片</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">
                  {vaultInfo.photoCount} 张 · {formatBytes(vaultInfo.photoBytes)}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">物理题库</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{vaultInfo.qbankQuestionCount} 道题</div>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-muted)]">
                <div className="text-[11px] text-[var(--ink-muted)]">题库占用</div>
                <div className="text-sm font-bold tabular-nums mt-0.5">{formatBytes(vaultInfo.qbankBytes)}</div>
              </div>
            </div>
            <div className="flex items-center flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={() => void window.workbenchApi.vault.openInFinder()}>
                <FolderOpen className="w-4 h-4" /> 在访达 / 资源管理器中打开
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  const next = await window.workbenchApi.vault.chooseFolder();
                  if (next) {
                    await onVaultChanged(next);
                    onNotify(`已切换资料库至：${next.path}`);
                  }
                }}
              >
                切换 / 新建资料库位置
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const res = await window.workbenchApi.vault.exportSnapshot();
                  if (res) onNotify(`整库备份已导出至：${res.path}`);
                }}
              >
                一键导出整库备份
              </Button>
              <Button
                size="sm"
                variant="danger-ghost"
                className="ml-auto"
                onClick={() => setResetConfirmOpen(true)}
              >
                <Trash2 className="w-3.5 h-3.5" /> 清空并重置资料库
              </Button>
            </div>
          </Card>

          {/* Software Version & GitHub Releases One-Click Update Card */}
          <Card className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13.5px] font-semibold">软件版本与在线更新</span>
                <Badge tone="accent">v{window.workbenchApi.appVersion}</Badge>
                <Badge tone="neutral">
                  {window.workbenchApi.platform === 'darwin' ? 'macOS 桌面端' : 'Windows 桌面端'}
                </Badge>
                <Badge tone="neutral">资料库 Schema v{vaultInfo.schemaVersion}</Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void window.workbenchApi
                      .openExternal(updateState?.releaseUrl || GITHUB_RELEASES_PAGE)
                      .catch((e) => onNotify((e as Error).message, 'err'))
                  }
                >
                  <ExternalLink className="w-3.5 h-3.5" /> GitHub 发布页
                </Button>
                <Button
                  size="xs"
                  variant="soft"
                  disabled={
                    updateState?.phase === 'checking' ||
                    updateState?.phase === 'downloading' ||
                    updateState?.phase === 'verifying' ||
                    updateState?.phase === 'installing'
                  }
                  onClick={async () => {
                    try {
                      const next = await window.workbenchApi.updater.check(false);
                      if (next.phase === 'up-to-date') {
                        onNotify(`当前已是最新版本 v${next.currentVersion}`);
                      } else if (next.phase === 'available' || next.phase === 'ready') {
                        onNotify(`发现新版本 v${next.latestVersion}，可直接下载更新`);
                      } else if (next.phase === 'error' && next.error) {
                        onNotify(next.error, 'err');
                      }
                    } catch (e) {
                      onNotify((e as Error).message, 'err');
                    }
                  }}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${updateState?.phase === 'checking' ? 'animate-spin' : ''}`}
                  />
                  {updateState?.phase === 'checking' ? '检查中…' : '检查更新'}
                </Button>
              </div>
            </div>

            {updateState?.phase === 'up-to-date' && (
              <div className="px-3 py-2 rounded-xl bg-[var(--ok-soft)]/60 border border-[var(--ok)]/30 text-xs flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[var(--ok)] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 当前已是最新版本（v{updateState.currentVersion}）
                </span>
                {updateState.checkedAt && (
                  <span className="text-[11px] text-[var(--ink-muted)] tabular-nums">
                    刚刚检查
                  </span>
                )}
              </div>
            )}

            {updateState?.phase === 'available' && (
              <div className="p-3 rounded-xl bg-[var(--accent-soft)]/50 border border-[var(--accent)]/35 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--accent)]">
                      发现新版本 v{updateState.latestVersion}
                    </span>
                    {updateState.assetSize > 0 && (
                      <Badge tone="neutral">{formatBytes(updateState.assetSize)}</Badge>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={() =>
                      void window.workbenchApi.updater
                        .download()
                        .catch((e) => onNotify((e as Error).message, 'err'))
                    }
                  >
                    <Download className="w-3.5 h-3.5" /> 立即下载更新
                  </Button>
                </div>
                {updateState.releaseNotes && (
                  <div className="text-xs text-[var(--ink-secondary)] whitespace-pre-wrap max-h-24 overflow-y-auto bg-[var(--bg-surface)]/80 p-2 rounded-lg border border-[var(--border-subtle)]">
                    {updateState.releaseNotes}
                  </div>
                )}
              </div>
            )}

            {(updateState?.phase === 'downloading' || updateState?.phase === 'verifying') && (
              <div className="p-3 rounded-xl bg-[var(--bg-muted)]/70 flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {updateState.phase === 'verifying'
                      ? '正在校验 SHA-256 并解压准备新版本…'
                      : `正在下载 v${updateState.latestVersion}…`}
                  </span>
                  <span className="tabular-nums text-[var(--ink-muted)]">
                    {formatBytes(updateState.downloadedBytes)}
                    {updateState.assetSize > 0 ? ` / ${formatBytes(updateState.assetSize)}` : ''} ·{' '}
                    {updateState.progressPct}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden border border-[var(--border-subtle)]">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-150"
                    style={{ width: `${Math.max(4, updateState.progressPct)}%` }}
                  />
                </div>
              </div>
            )}

            {updateState?.phase === 'ready' && (
              <div className="p-3 rounded-xl bg-[var(--ok-soft)]/65 border border-[var(--ok)]/35 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <ShieldCheck className="w-4 h-4 text-[var(--ok)] shrink-0" />
                  <span className="font-semibold text-[var(--ok)]">
                    v{updateState.latestVersion} 已下载就绪
                  </span>
                  {updateState.sha256Verified && <Badge tone="ok">SHA-256 校验通过</Badge>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void window.workbenchApi.updater.openDownload()}
                  >
                    定位安装包
                  </Button>
                  <Button
                    size="xs"
                    variant="primary"
                    onClick={async () => {
                      try {
                        const res = await window.workbenchApi.updater.install();
                        if (res.mode === 'opened-installer') {
                          onNotify('已为您打开/定位更新安装包，请替换安装后重启');
                        } else {
                          onNotify('正在退出并自动替换更新，稍后将自动重新打开最新版…');
                        }
                      } catch (e) {
                        onNotify((e as Error).message, 'err');
                      }
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {updateState.canAutoInstall ? '一键更新并重启' : '打开安装包'}
                  </Button>
                </div>
              </div>
            )}

            {updateState?.phase === 'error' && updateState.error && (
              <div className="px-3 py-2 rounded-xl bg-[var(--danger-soft)]/70 border border-[var(--danger)]/35 text-xs text-[var(--danger)]">
                {updateState.error}
              </div>
            )}

            <details className="text-xs text-[var(--ink-muted)]">
              <summary className="cursor-pointer hover:text-[var(--ink-secondary)] select-none">
                高级：GitHub 国内下载加速前缀（可选）
              </summary>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={mirrorUrl}
                  onChange={(e) => setMirrorUrl(e.target.value)}
                  placeholder="留空直连 GitHub；如直连慢可填 HTTPS 加速前缀如 https://ghfast.top/"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="xs"
                  disabled={savingMirror}
                  onClick={async () => {
                    setSavingMirror(true);
                    try {
                      await window.workbenchApi.vault.updatePreferences({
                        updateMirrorUrl: mirrorUrl.trim(),
                      });
                      onNotify(mirrorUrl.trim() ? '已保存下载加速前缀' : '已恢复直连 GitHub 下载');
                    } finally {
                      setSavingMirror(false);
                    }
                  }}
                >
                  保存
                </Button>
              </div>
            </details>
          </Card>

          <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
            提示：本资料库由 <code>workbench.sqlite</code>、<code>photos/</code> 与 <code>question-bank/</code>（物理题库独立子库与素材）组成，可直接拷入 U 盘或放进 iCloud / 坚果云同步。API 密钥独立加密保存在本机系统钥匙串中，同步或重置资料库绝不会丢失密钥。
          </p>
        </div>
      )}

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="清空并重置当前资料库"
        description={`将永久清除「${vaultInfo?.path || ''}」中的所有班级、花名册、考试成绩、答卷照片与物理题库数据，重建为一个全新的空白资料库（系统钥匙串里的 AI API Key 会保留）。确定继续？`}
        confirmLabel={resetBusy ? '正在重置…' : '确认彻底清空'}
        danger
        onConfirm={async () => {
          setResetBusy(true);
          try {
            const fresh = await window.workbenchApi.vault.resetCurrent();
            await onVaultChanged(fresh);
            setResetConfirmOpen(false);
            onOpenChange(false);
            onNotify('资料库已彻底清空并重建为空白状态（AI 密钥已保留）');
          } catch (e) {
            onNotify((e as Error).message, 'err');
          } finally {
            setResetBusy(false);
          }
        }}
      />
    </Modal>
  );
}
