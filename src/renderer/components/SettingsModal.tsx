import { useEffect, useState } from 'react';
import {
  Check,
  FolderOpen,
  HardDrive,
  Palette,
  Sparkles,
} from 'lucide-react';
import type { VaultInfo } from '../../shared/types';
import { listThemes } from '../themes';
import { AiSettingsTab } from './AiSettingsTab';
import { Badge, Button, Card, Modal } from './ui/primitives';

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
  onChangeTheme,
  onVaultChanged,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: 'theme' | 'ai' | 'vault';
  themeId: string;
  vaultInfo: VaultInfo | null;
  onChangeTheme: (id: string) => void;
  onVaultChanged: (info: VaultInfo) => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [tab, setTab] = useState<'theme' | 'ai' | 'vault'>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, open]);

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
            ['vault', '本地资料库（Vault）', HardDrive],
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
            </div>
          </Card>
          <Card className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold">cyz 的教师工作台</span>
              <Badge tone="accent">v{window.workbenchApi.appVersion}</Badge>
              <Badge tone="neutral">
                {window.workbenchApi.platform === 'darwin' ? 'macOS 桌面端' : 'Windows 桌面端'}
              </Badge>
              <Badge tone="neutral">资料库 Schema v{vaultInfo.schemaVersion}</Badge>
            </div>
            <span className="text-[11.5px] text-[var(--ink-muted)]">
              Electron + 原生 SQLite 离线资料库
            </span>
          </Card>

          <p className="text-xs text-[var(--ink-muted)] leading-relaxed">
            提示：本资料库由 <code>workbench.sqlite</code>、<code>photos/</code> 与 <code>question-bank/</code>（物理题库独立子库与素材）组成，可直接拷入 U 盘或放进 iCloud / 坚果云同步。API 密钥独立加密保存在本机系统钥匙串中，同步资料库绝不会泄露密钥。
          </p>
        </div>
      )}
    </Modal>
  );
}
