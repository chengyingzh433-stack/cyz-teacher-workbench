import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { TrashItem } from '../../shared/types';
import { Badge, Button, Card, ConfirmDialog, Modal } from './ui/primitives';

function fmtSize(bytes: number) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function TrashModal({
  open,
  onOpenChange,
  onChanged,
  onNotify,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
  onNotify: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setItems(await window.workbenchApi.trash.list());
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const kindLabel: Record<TrashItem['kind'], string> = {
    class: '班级',
    exam: '考试',
    submission: '答卷',
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title="回收站"
        subtitle="导错的成绩单、误删的班级或测试答卷都会暂存于此；彻底清空会同步删除硬盘上的对应照片"
        size="md"
        footer={
          items.length > 0 ? (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmEmpty(true)}>
              <Trash2 className="w-4 h-4" /> 一键清空全部 ({items.length})
            </Button>
          ) : undefined
        }
      >
        {!items.length ? (
          <div className="py-12 text-center text-sm text-[var(--ink-muted)]">回收站空空如也</div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <Card key={`${item.kind}-${item.id}`} className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone="warn">{kindLabel[item.kind]}</Badge>
                    <span className="text-[13.5px] font-medium truncate">{item.title}</span>
                  </div>
                  <div className="text-xs text-[var(--ink-muted)] mt-1">
                    {item.subtitle} · 删除于 {item.deletedAt.slice(0, 16).replace('T', ' ')}
                    {item.photoCount > 0 && ` · 含 ${item.photoCount} 张照片 (${fmtSize(item.photoBytes)})`}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await window.workbenchApi.trash.restore(item.kind, item.id);
                        await refresh();
                        await onChanged();
                        onNotify(`已恢复「${item.title}」`);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> 恢复
                  </Button>
                  <Button
                    size="xs"
                    variant="danger-ghost"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const res = await window.workbenchApi.trash.purge(item.kind, item.id);
                        await refresh();
                        await onChanged();
                        onNotify(
                          `已彻底删除「${item.title}」${res.freedBytes ? `，释放硬盘 ${fmtSize(res.freedBytes)}` : ''}`,
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    彻底删除
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="彻底清空回收站"
        description="清空后不可恢复，并会同步删除硬盘 photos/ 目录中对应的答卷照片以释放空间。确认清空？"
        confirmLabel="彻底清空"
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            const res = await window.workbenchApi.trash.emptyAll();
            setConfirmEmpty(false);
            await refresh();
            await onChanged();
            onNotify(
              `回收站已清空${res.freedBytes ? `，共释放硬盘 ${fmtSize(res.freedBytes)}` : ''}`,
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
