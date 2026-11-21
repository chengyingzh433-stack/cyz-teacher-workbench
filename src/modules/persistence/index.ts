import Dexie, { type Table, type Transaction } from 'dexie';
import {
  AppError,
  copy,
  id,
  migrateV1,
  validate,
  type Snapshot,
  type ClassRecord,
  type Student,
  type Membership,
  type SeatPlan,
} from '../../app/model';
import { checkBundleShape, validateBundle, type AssetFiles, type WorkspaceBundle } from '../assets';

export type Stamp = { epoch: string; revision: number };
export type Loaded = { snapshot: Snapshot; stamp: Stamp; files?: AssetFiles } | null;
export type CommitAssets = { files: AssetFiles; previousFiles: AssetFiles };
export interface Adapter {
  level: 'browser' | 'memory';
  load(): Promise<Loaded>;
  commit(
    next: Snapshot,
    expected: Stamp | null,
    previous: Snapshot,
    replace?: boolean,
    assets?: CommitAssets,
  ): Promise<Stamp>;
  recovery(): Promise<Snapshot | null>;
  recoveryBundle?(): Promise<WorkspaceBundle | null>;
  close(): void;
}
type Meta = Stamp & {
  key: string;
  structureVersion: number;
  workspace: Snapshot['workspace'];
  activeGeneration?: string;
  recoveryGeneration?: string | null;
};
type Generation = { id: string; snapshot: Snapshot; ready: boolean; createdAt: string };
type AssetRow = { generation: string; hash: string; blob: Blob };
class Database extends Dexie {
  meta!: Table<Meta, string>;
  classes!: Table<ClassRecord, string>;
  students!: Table<Student, string>;
  memberships!: Table<Membership, string>;
  seatPlans!: Table<SeatPlan, string>;
  settings!: Table<{ key: string; teacher: Snapshot['data']['settings']['teacher'] }, string>;
  recovery!: Table<{ key: string; snapshot: Snapshot }, string>;
  generations!: Table<Generation, string>;
  assetBlobs!: Table<AssetRow, [string, string]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: '&key',
      classes: '&id',
      students: '&id',
      memberships: '&id,classId,studentId',
      seatPlans: '&id,classId',
      settings: '&key',
      recovery: '&key',
    });
    this.version(2)
      .stores({ generations: '&id', assetBlobs: '[generation+hash],generation' })
      .upgrade(async (tx) => {
        const meta = await tx.table<Meta>('meta').get('main');
        if (!meta) {
          for (const name of [
            'classes',
            'students',
            'memberships',
            'seatPlans',
            'settings',
            'recovery',
          ]) {
            if (await tx.table(name).count())
              throw new AppError('CACHE_READ_FAILED', '旧缓存缺少版本信息，已中止升级并保留原资料');
          }
          return;
        }
        if (meta.structureVersion !== 1 || !validStamp(meta))
          throw new AppError('UNSUPPORTED_VERSION', '旧数据库版本或版本信息无效，未执行迁移');
        const [classes, students, memberships, seatPlans, settings, recovery] = await Promise.all([
          tx.table('classes').toArray(),
          tx.table('students').toArray(),
          tx.table('memberships').toArray(),
          tx.table('seatPlans').toArray(),
          tx.table('settings').get('business'),
          tx.table('recovery').get('latest'),
        ]);
        const snapshot = migrateV1({
          workspace: meta.workspace,
          data: { classes, students, memberships, seatPlans, settings },
        });
        const activeGeneration = id(),
          recoveryGeneration = recovery ? id() : null;
        await tx.table('generations').put({
          id: activeGeneration,
          snapshot,
          ready: true,
          createdAt: new Date().toISOString(),
        });
        if (recoveryGeneration)
          await tx.table('generations').put({
            id: recoveryGeneration,
            snapshot: migrateV1(recovery.snapshot),
            ready: true,
            createdAt: new Date().toISOString(),
          });
        await tx
          .table('meta')
          .put({ ...meta, structureVersion: 2, activeGeneration, recoveryGeneration });
        // The upgrade transaction retains IDs, epoch/revision, and validates all data before clearing old stores.
        for (const name of [
          'classes',
          'students',
          'memberships',
          'seatPlans',
          'settings',
          'recovery',
        ])
          await tx.table(name).clear();
      });
    this.on('versionchange', () => this.close());
  }
}
function validStamp(meta: Meta) {
  return (
    typeof meta.epoch === 'string' &&
    meta.epoch.length > 0 &&
    Number.isSafeInteger(meta.revision) &&
    meta.revision >= 1
  );
}
function assertMeta(meta: Meta): asserts meta is Meta & { activeGeneration: string } {
  if (
    meta.structureVersion !== 2 ||
    !validStamp(meta) ||
    !meta.activeGeneration ||
    (meta.recoveryGeneration !== null && typeof meta.recoveryGeneration !== 'string')
  )
    throw new AppError(
      'UNSUPPORTED_VERSION',
      '本地结构版本不支持或版本信息损坏，请保留资料并使用兼容版本',
    );
}
function assertExpected(meta: Meta | undefined, expected: Stamp | null) {
  if (meta) assertMeta(meta);
  if (
    (meta?.epoch ?? null) !== (expected?.epoch ?? null) ||
    (meta?.revision ?? 0) !== (expected?.revision ?? 0)
  )
    throw new AppError('CONFLICT', '另一个窗口已更新资料，请先导出本窗口内容，再重新读取');
}
export const DATABASE_NAME = 'cyz-teacher-workbench-independent-v1';
export class BrowserAdapter implements Adapter {
  level = 'browser' as const;
  readonly db: Database;
  constructor(
    name = DATABASE_NAME,
    private beforeCommit?: (tx: Transaction) => void,
  ) {
    this.db = new Database(name);
  }
  async open() {
    if (this.db.isOpen()) return;
    await new Promise<void>((resolve, reject) => {
      let abandoned = false;
      const fail = (error: AppError) => {
        abandoned = true;
        reject(error);
      };
      const blocked = () =>
        fail(new AppError('CACHE_READ_FAILED', '数据库升级被其他窗口阻塞，请关闭其他窗口后重试'));
      this.db.on('blocked', blocked);
      const timer = setTimeout(() => {
        this.db.close();
        fail(new AppError('CACHE_READ_FAILED', '读取超时，请关闭其他窗口后重试'));
      }, 8000);
      this.db
        .open()
        .then(() => {
          if (abandoned) this.db.close();
          else resolve();
        }, reject)
        .finally(() => {
          clearTimeout(timer);
          this.db.on('blocked').unsubscribe(blocked);
        });
    });
  }
  private async assertNoLegacyRows() {
    for (const table of [
      this.db.classes,
      this.db.students,
      this.db.memberships,
      this.db.seatPlans,
      this.db.settings,
      this.db.recovery,
    ]) {
      if (await table.count())
        throw new AppError('CACHE_READ_FAILED', '迁移后仍存在未归入工作区的旧资料，未执行覆盖');
    }
  }
  private async readGeneration(generationId: string): Promise<WorkspaceBundle> {
    const generation = await this.db.generations.get(generationId);
    if (!generation?.ready) throw new AppError('CACHE_READ_FAILED', '工作区版本缺失或暂存尚未完成');
    const rows = await this.db.assetBlobs.where('generation').equals(generationId).toArray();
    return checkBundleShape({
      snapshot: generation.snapshot,
      files: new Map(rows.map((a) => [a.hash, a.blob])),
    });
  }
  async load(): Promise<Loaded> {
    await this.open();
    const loaded = await this.db.transaction('r', this.db.tables, async () => {
      await this.assertNoLegacyRows();
      const meta = await this.db.meta.get('main');
      if (!meta) {
        if ((await this.db.generations.count()) || (await this.db.assetBlobs.count()))
          throw new AppError('CACHE_READ_FAILED', '缓存缺少主版本信息，保留已有暂存资料');
        return null;
      }
      assertMeta(meta);
      return {
        ...(await this.readGeneration(meta.activeGeneration)),
        stamp: { epoch: meta.epoch, revision: meta.revision },
      };
    });
    // Hashing and image decoding must stay outside IndexedDB transaction lifetimes.
    return loaded ? { ...(await validateBundle(loaded)), stamp: loaded.stamp } : null;
  }
  private async stage(bundle: WorkspaceBundle, generationId: string) {
    await this.db.generations.add({
      id: generationId,
      snapshot: bundle.snapshot,
      ready: false,
      createdAt: new Date().toISOString(),
    });
    const entries = [...bundle.files];
    for (let i = 0; i < entries.length; i += 4) {
      await this.db.assetBlobs.bulkPut(
        entries.slice(i, i + 4).map(([hash, blob]) => ({ generation: generationId, hash, blob })),
      );
    }
    await this.db.transaction('rw', [this.db.generations, this.db.assetBlobs], async () => {
      const rows = await this.db.assetBlobs.where('generation').equals(generationId).toArray();
      checkBundleShape({
        snapshot: bundle.snapshot,
        files: new Map(rows.map((a) => [a.hash, a.blob])),
      });
      await this.db.generations.update(generationId, { ready: true });
    });
  }
  private async removeGeneration(generationId: string) {
    await this.db.assetBlobs.where('generation').equals(generationId).delete();
    await this.db.generations.delete(generationId);
  }
  async commit(
    nextInput: Snapshot,
    expected: Stamp | null,
    previous: Snapshot,
    replace = false,
    assets: CommitAssets = { files: new Map(), previousFiles: new Map() },
  ): Promise<Stamp> {
    const next = await validateBundle({ snapshot: nextInput, files: assets.files });
    const point = replace
      ? await validateBundle({ snapshot: previous, files: assets.previousFiles })
      : null;
    await this.open();
    // Early CAS avoids costly staging after an already-known conflict. The final CAS remains authoritative.
    await this.db.transaction('r', this.db.tables, async () => {
      await this.assertNoLegacyRows();
      const meta = await this.db.meta.get('main');
      assertExpected(meta, expected);
      if (meta?.activeGeneration) await this.readGeneration(meta.activeGeneration);
      if (!meta && ((await this.db.generations.count()) || (await this.db.assetBlobs.count())))
        throw new AppError('CACHE_READ_FAILED', '缓存已有孤立资料，未创建空工作区覆盖');
    });
    const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
    const needed = [next, point]
      .filter((x): x is WorkspaceBundle => !!x)
      .reduce(
        (sum, b) =>
          sum +
          new TextEncoder().encode(JSON.stringify(b.snapshot)).length +
          [...b.files.values()].reduce((n, f) => n + f.size, 0),
        0,
      );
    if (
      estimate?.quota !== undefined &&
      estimate.usage !== undefined &&
      estimate.quota - estimate.usage < needed * 1.2
    )
      throw new AppError(
        'CACHE_QUOTA',
        '浏览器预计可用空间不足以暂存完整资料和恢复点，请先导出备份',
      );
    const nextId = id(),
      pointId = point ? id() : null;
    try {
      await this.stage(next, nextId);
      if (point && pointId) await this.stage(point, pointId);
      return await this.db.transaction('rw', this.db.tables, async (tx) => {
        const meta = await this.db.meta.get('main');
        assertExpected(meta, expected);
        if (meta?.activeGeneration) await this.readGeneration(meta.activeGeneration);
        await this.assertNoLegacyRows();
        await this.readGeneration(nextId);
        if (pointId) await this.readGeneration(pointId);
        const stamp = {
          epoch: replace || !meta ? id() : meta.epoch,
          revision: replace || !meta ? 1 : meta.revision + 1,
        };
        if (!Number.isSafeInteger(stamp.revision))
          throw new AppError('UNSUPPORTED_VERSION', '工作区版本计数已超限');
        const recoveryGeneration = replace ? pointId : meta?.recoveryGeneration || null;
        await this.db.meta.put({
          key: 'main',
          structureVersion: 2,
          workspace: next.snapshot.workspace,
          activeGeneration: nextId,
          recoveryGeneration,
          ...stamp,
        });
        for (const obsolete of new Set([meta?.activeGeneration, meta?.recoveryGeneration])) {
          if (obsolete && obsolete !== recoveryGeneration && obsolete !== nextId)
            await this.removeGeneration(obsolete);
        }
        this.beforeCommit?.(tx);
        return stamp;
      });
    } catch (error) {
      // Only remove this operation's private staged rows; never touch another window's staging.
      await this.db
        .transaction('rw', [this.db.meta, this.db.generations, this.db.assetBlobs], async () => {
          const meta = await this.db.meta.get('main');
          for (const staged of [nextId, pointId])
            if (staged && staged !== meta?.activeGeneration && staged !== meta?.recoveryGeneration)
              await this.removeGeneration(staged);
        })
        .catch(() => {
          /* Interrupted cleanup cannot turn a failed commit into success. */
        });
      throw error;
    }
  }
  async recoveryBundle(): Promise<WorkspaceBundle | null> {
    await this.open();
    const bundle = await this.db.transaction('r', this.db.tables, async () => {
      const meta = await this.db.meta.get('main');
      if (!meta) return null;
      assertMeta(meta);
      return meta.recoveryGeneration ? this.readGeneration(meta.recoveryGeneration) : null;
    });
    return bundle ? validateBundle(bundle) : null;
  }
  async recovery(): Promise<Snapshot | null> {
    return (await this.recoveryBundle())?.snapshot || null;
  }
  close() {
    this.db.close();
  }
}
export class MemoryAdapter implements Adapter {
  level = 'memory' as const;
  private current: Loaded = null;
  private point: WorkspaceBundle | null = null;
  async load() {
    return copy(this.current);
  }
  async commit(
    next: Snapshot,
    expected: Stamp | null,
    previous: Snapshot,
    replace = false,
    assets: CommitAssets = { files: new Map(), previousFiles: new Map() },
  ) {
    const clean = await validateBundle({ snapshot: next, files: assets.files });
    const point = replace
      ? await validateBundle({ snapshot: previous, files: assets.previousFiles })
      : null;
    if (
      (this.current?.stamp.epoch ?? null) !== (expected?.epoch ?? null) ||
      (this.current?.stamp.revision ?? 0) !== (expected?.revision ?? 0)
    )
      throw new AppError('CONFLICT', '临时会话版本冲突');
    const stamp = {
      epoch: replace || !expected ? id() : expected.epoch,
      revision: replace || !expected ? 1 : expected.revision + 1,
    };
    if (point) this.point = copy(point);
    this.current = { ...copy(clean), stamp };
    return stamp;
  }
  async recoveryBundle() {
    return copy(this.point);
  }
  async recovery() {
    return copy(this.point?.snapshot || null);
  }
  close() {}
}
