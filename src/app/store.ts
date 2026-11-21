import { AppError, copy, emptyWorkspace, validate, type Snapshot } from './model';
import { BrowserAdapter, MemoryAdapter, type Adapter, type Stamp } from '../modules/persistence';
import type { BackupPreview } from '../modules/backup';
import {
  checkBundleShape,
  validateBundle,
  type AssetFiles,
  type WorkspaceBundle,
} from '../modules/assets';
import { assertGradebookTransition } from '../modules/gradebook/model';
import { assertGradingTransition } from '../modules/grading/model';
function storageMessage(error: unknown, operation: 'read' | 'write') {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error && error.name === 'QuotaExceededError')
    return '浏览器可用空间不足，请先导出备份，再处理存储空间';
  if (error instanceof Error && error.name === 'SecurityError')
    return '此浏览器环境不允许访问本地存储';
  return operation === 'read'
    ? '浏览器资料暂时无法读取，请重试或使用备份恢复'
    : '写入事务未完成，当前更改尚未写入浏览器';
}
export type SaveState = 'loading' | 'saved' | 'saving' | 'unsaved' | 'conflict' | 'load-error';
export type StoreState = {
  snapshot: Snapshot | null;
  status: SaveState;
  message: string;
  stamp: Stamp | null;
  sequence: number;
  busy: boolean;
  level: 'browser' | 'memory';
  files: AssetFiles;
};
export class WorkbenchStore {
  private state: StoreState = {
    snapshot: null,
    status: 'loading',
    message: '正在读取浏览器资料',
    stamp: null,
    sequence: 0,
    busy: false,
    level: 'browser',
    files: new Map(),
  };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private adapter: Adapter = new BrowserAdapter()) {}
  getState = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((x) => x());
  }
  token = () =>
    `${this.state.stamp?.epoch || '-'}:${this.state.stamp?.revision || 0}:${this.state.sequence}`;
  private ordered<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  load = () =>
    this.ordered(async () => {
      this.set({ status: 'loading', busy: true });
      try {
        const loaded = await this.adapter.load();
        this.set({
          snapshot: loaded?.snapshot || emptyWorkspace(),
          files: loaded?.files || new Map(),
          stamp: loaded?.stamp || null,
          sequence: this.state.sequence + 1,
          status: loaded && this.adapter.level === 'browser' ? 'saved' : 'unsaved',
          message: loaded ? '' : '新工作区，尚无浏览器保存记录',
          level: this.adapter.level,
        });
      } catch (error) {
        this.set({
          status: 'load-error',
          message: `读取失败：${storageMessage(error, 'read')}。原缓存未被覆盖。`,
        });
      } finally {
        this.set({ busy: false });
      }
    });
  startSession = () =>
    this.ordered(async () => {
      this.adapter.close();
      this.adapter = new MemoryAdapter();
      this.set({
        snapshot: this.state.snapshot || emptyWorkspace(),
        stamp: null,
        sequence: this.state.sequence + 1,
        status: 'unsaved',
        level: 'memory',
        message: '临时会话未保存，请导出独立备份；关闭后不能保证找回',
      });
    });
  private failure(error: unknown) {
    const conflict = error instanceof AppError && error.code === 'CONFLICT';
    this.set({
      status: conflict ? 'conflict' : 'unsaved',
      message: `${storageMessage(error, 'write')}${conflict ? '' : '；当前内容仍可导出备份'}`,
    });
  }
  edit = (
    mutate: (s: Snapshot, token: string) => Snapshot | void,
    addedFiles: AssetFiles = new Map(),
  ) =>
    this.ordered(async () => {
      if (
        !this.state.snapshot ||
        this.state.status === 'load-error' ||
        this.state.status === 'loading'
      )
        throw new AppError('CACHE_READ_FAILED', '请先恢复读取或明确开始临时会话');
      const old = this.state.snapshot;
      const candidate = copy(old);
      const result = mutate(candidate, this.token());
      const next = validate(result || candidate);
      try {
        assertGradingTransition(old.data.grading, next.data.grading);
        assertGradebookTransition(old.data.gradebook, next.data.gradebook);
      } catch (error) {
        throw new AppError('VALIDATION', (error as Error).message);
      }
      const files = new Map(this.state.files);
      for (const [hash, blob] of addedFiles) files.set(hash, blob);
      const required = new Set(next.data.grading.assets.map((a) => a.hash));
      for (const hash of files.keys()) if (!required.has(hash)) files.delete(hash);
      await validateBundle({ snapshot: next, files });
      if (JSON.stringify(next) === JSON.stringify(old)) return false;
      const conflict = this.state.status === 'conflict';
      this.set({
        snapshot: next,
        files,
        sequence: this.state.sequence + 1,
        status: conflict ? 'conflict' : 'saving',
        busy: true,
      });
      try {
        if (conflict) return true;
        const stamp = await this.adapter.commit(next, this.state.stamp, old, false, {
          files,
          previousFiles: new Map(),
        });
        this.set({
          stamp,
          status: this.adapter.level === 'browser' ? 'saved' : 'unsaved',
          message: this.adapter.level === 'browser' ? '' : '当前为临时会话，请导出备份',
        });
      } catch (error) {
        this.failure(error);
      } finally {
        this.set({ busy: false });
      }
      return true;
    });
  retry = () =>
    this.ordered(async () => {
      if (
        !this.state.snapshot ||
        this.state.status === 'conflict' ||
        this.state.status === 'load-error'
      )
        throw new AppError('CONFLICT', '请先导出当前内容，再重新读取');
      this.set({ status: 'saving', busy: true });
      try {
        const stamp = await this.adapter.commit(
          this.state.snapshot,
          this.state.stamp,
          this.state.snapshot,
          false,
          { files: this.state.files, previousFiles: this.state.files },
        );
        this.set({
          stamp,
          status: this.adapter.level === 'browser' ? 'saved' : 'unsaved',
          message: this.adapter.level === 'browser' ? '' : '临时会话仍未持久保存',
        });
      } catch (error) {
        this.failure(error);
      } finally {
        this.set({ busy: false });
      }
    });
  restore = (preview: BackupPreview, sessionOnly = false) =>
    this.ordered(async () => {
      if (preview.token !== this.token())
        throw new AppError('STALE_PREVIEW', '恢复预览已过期，请重新读取备份');
      if (!this.state.snapshot || this.state.status === 'load-error')
        throw new AppError('CACHE_READ_FAILED', '先重试读取，或明确开始临时会话后再恢复');
      if (this.adapter.level === 'memory' && !sessionOnly)
        throw new AppError('CACHE_UNAVAILABLE', '当前存储不可用，请明确选择仅在会话中恢复');
      if (this.state.status === 'conflict')
        throw new AppError('CONFLICT', '请先导出本窗口内容，再重新读取');
      const previous = copy(this.state.snapshot);
      const previousStatus = this.state.status;
      this.set({ status: 'saving', busy: true });
      try {
        const files = new Map(preview.files || []);
        const candidate = checkBundleShape({ snapshot: preview.snapshot, files });
        const stamp = await this.adapter.commit(
          candidate.snapshot,
          this.state.stamp,
          previous,
          true,
          { files, previousFiles: this.state.files },
        );
        this.set({
          snapshot: copy(candidate.snapshot),
          files,
          stamp,
          sequence: this.state.sequence + 1,
          status: this.adapter.level === 'browser' ? 'saved' : 'unsaved',
          message: this.adapter.level === 'browser' ? '' : '仅在当前会话恢复，未持久保存',
        });
      } catch (error) {
        this.set({
          status:
            error instanceof AppError && error.code === 'CONFLICT' ? 'conflict' : previousStatus,
          message: `恢复未应用，当前资料与旧缓存保留：${storageMessage(error, 'write')}`,
        });
        throw error instanceof AppError
          ? error
          : new AppError('CACHE_WRITE_FAILED', storageMessage(error, 'write'));
      } finally {
        this.set({ busy: false });
      }
    });
  recovery = () => this.adapter.recovery();
  recoveryBundle = async (): Promise<WorkspaceBundle | null> => {
    if (this.adapter.recoveryBundle) return this.adapter.recoveryBundle();
    const snapshot = await this.adapter.recovery();
    return snapshot ? checkBundleShape({ snapshot, files: new Map() }) : null;
  };
  close = () => this.adapter.close();
}
