import { z } from 'zod';
import {
  AppError,
  legacySnapshotSchema,
  migrateV1,
  snapshotSchema,
  validate,
  type Snapshot,
} from '../../app/model';
import { LIMITS, sha256, validateBundle, type AssetFiles, type WorkspaceBundle } from '../assets';
import { hasGrading, hashSchema } from '../grading/model';
import { packZip, unpackZip } from './zip';
import { correctKnownCharacters } from '../characters';
const envelope = z.object({
  format: z.literal('cyz-teacher-workbench'),
  formatVersion: z.literal(1),
  appVersion: z.string().max(100),
  exportedAt: z.string().datetime({ offset: true }),
  workspace: legacySnapshotSchema.shape.workspace,
  data: legacySnapshotSchema.shape.data,
});
export type BackupPreview = {
  snapshot: Snapshot;
  repairs: string[];
  token: string;
  exportedAt: string;
  files?: AssetFiles;
};
export function encodeBackup(s: Snapshot): string {
  const clean = validate(s);
  if (hasGrading(clean.data.grading) || clean.data.gradebook.imports.length)
    throw new AppError('BACKUP_FORMAT', '当前工作区包含考试数据，请导出完整 ZIP 备份');
  const { grading: _grading, gradebook: _gradebook, ...legacyData } = clean.data;
  const text = JSON.stringify(
    {
      format: 'cyz-teacher-workbench',
      formatVersion: 1,
      appVersion: '0.5.2-physics-mean',
      exportedAt: new Date().toISOString(),
      workspace: clean.workspace,
      data: legacyData,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(text).length > LIMITS.metadataBytes)
    throw new AppError('INVALID_BACKUP', 'JSON 备份超过 20 MiB');
  return text;
}
export function inspectBackup(text: string, token: string): BackupPreview {
  if (new TextEncoder().encode(text).length > 20 * 1024 ** 2)
    throw new AppError('INVALID_BACKUP', '备份超过 20 MiB，请选择其他文件');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_BACKUP', '不是有效的 JSON 备份');
  }
  if (typeof raw === 'object' && raw && 'formatVersion' in raw && raw.formatVersion !== 1)
    throw new AppError('UNSUPPORTED_VERSION', '不支持这个备份版本，请使用兼容版本；当前资料未改变');
  const parsed = envelope.safeParse(raw);
  if (!parsed.success)
    throw new AppError(
      'INVALID_BACKUP',
      '备份格式或字段不正确；仅支持本项目的 cyz-teacher-workbench v1 备份',
    );
  if (
    typeof raw === 'object' &&
    raw &&
    'data' in raw &&
    raw.data &&
    typeof raw.data === 'object' &&
    ('grading' in raw.data || 'gradebook' in raw.data)
  )
    throw new AppError('INVALID_BACKUP', 'v1 JSON 中不能包含成绩单或阅卷字段，请使用完整 ZIP 备份');
  const snapshot = migrateV1({ workspace: parsed.data.workspace, data: parsed.data.data });
  const repairs = correctKnownCharacters(snapshot);
  return { snapshot, repairs, token, exportedAt: parsed.data.exportedAt };
}
export function backupFilename(date = new Date()) {
  return `cyz教师工作台-${date.toISOString().replace(/[:.]/g, '-')}.cyz.json`;
}
const fullEnvelope = z
  .object({
    format: z.literal('cyz-teacher-workbench'),
    formatVersion: z.literal(2),
    appVersion: z.string().max(100),
    exportedAt: z.string().datetime({ offset: true }),
    workspace: snapshotSchema.shape.workspace,
    data: snapshotSchema.shape.data,
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal('cyz-workspace-assets'),
    formatVersion: z.literal(1),
    workspaceHash: hashSchema,
    assets: z
      .array(
        z
          .object({
            hash: hashSchema,
            path: z.string().max(80),
            mime: z.enum(['image/png', 'image/jpeg']),
            bytes: z.number().int().positive().max(LIMITS.assetBytes),
          })
          .strict(),
      )
      .max(LIMITS.assets),
  })
  .strict();
export async function encodeFullBackup(bundle: WorkspaceBundle): Promise<Blob> {
  const clean = await validateBundle(bundle);
  const workspaceBytes = new TextEncoder().encode(
    JSON.stringify({
      format: 'cyz-teacher-workbench',
      formatVersion: 2,
      appVersion: '0.5.2-physics-mean',
      exportedAt: new Date().toISOString(),
      ...clean.snapshot,
    }),
  );
  if (workspaceBytes.length > LIMITS.metadataBytes)
    throw new AppError('ASSET_LIMIT', '备份元数据超过 20 MiB');
  const records = [...new Map(clean.snapshot.data.grading.assets.map((a) => [a.hash, a])).values()];
  const manifest = {
    format: 'cyz-workspace-assets',
    formatVersion: 1,
    workspaceHash: await sha256(workspaceBytes),
    assets: records.map((a) => ({
      hash: a.hash,
      path: `assets/${a.hash}`,
      mime: a.mime,
      bytes: a.bytes,
    })),
  };
  const entries = new Map<string, Uint8Array<ArrayBuffer>>([
    ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['workspace.json', workspaceBytes],
  ]);
  for (const asset of records)
    entries.set(
      `assets/${asset.hash}`,
      new Uint8Array(await clean.files.get(asset.hash)!.arrayBuffer()),
    );
  return packZip(entries);
}
export async function inspectBackupFile(file: Blob, token: string): Promise<BackupPreview> {
  if (file.size > LIMITS.archiveBytes) throw new AppError('INVALID_BACKUP', '备份超过 128 MiB');
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(
    signature[0] === 0x50 &&
    signature[1] === 0x4b &&
    signature[2] === 3 &&
    signature[3] === 4
  )) {
    if (file.size > LIMITS.metadataBytes)
      throw new AppError('INVALID_BACKUP', 'JSON 备份超过 20 MiB');
    return inspectBackup(await file.text(), token);
  }
  try {
    const entries = unpackZip(new Uint8Array(await file.arrayBuffer()));
    const decode = (path: string) =>
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries.get(path)!));
    const raw = decode('workspace.json');
    if (raw?.formatVersion !== 2)
      throw new AppError('UNSUPPORTED_VERSION', '不支持这个完整备份版本');
    const workspace = fullEnvelope.parse(raw),
      manifest = manifestSchema.parse(decode('manifest.json'));
    if ((await sha256(entries.get('workspace.json')!)) !== manifest.workspaceHash)
      throw new AppError('INVALID_BACKUP', '工作区内容哈希与清单不一致');
    const snapshot = validate({ workspace: workspace.workspace, data: workspace.data });
    const records = new Map(snapshot.data.grading.assets.map((a) => [a.hash, a]));
    const files: AssetFiles = new Map();
    if (manifest.assets.length !== records.size || entries.size !== records.size + 2)
      throw new AppError('INVALID_BACKUP', '附件清单、工作区及 ZIP 条目数量不一致');
    for (const asset of manifest.assets) {
      const record = records.get(asset.hash),
        bytes = entries.get(asset.path);
      if (
        asset.path !== `assets/${asset.hash}` ||
        files.has(asset.hash) ||
        !record ||
        !bytes ||
        bytes.length !== asset.bytes ||
        record.bytes !== asset.bytes ||
        record.mime !== asset.mime
      )
        throw new AppError('INVALID_BACKUP', '附件清单缺项、重复或与工作区不一致');
      files.set(asset.hash, new Blob([bytes], { type: asset.mime }));
    }
    const clean = await validateBundle({ snapshot, files });
    const repairs = correctKnownCharacters(clean.snapshot);
    return { ...clean, token, repairs, exportedAt: workspace.exportedAt };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_BACKUP', '完整备份格式、版本或附件字段无效；当前资料未改变');
  }
}
export async function downloadBackup(s: Snapshot, files: AssetFiles = new Map(), full = false) {
  // Capture both metadata and immutable Blob references before the first await.
  const bundle = { snapshot: structuredClone(s), files: new Map(files) };
  const zip =
    full ||
    hasGrading(bundle.snapshot.data.grading) ||
    bundle.snapshot.data.gradebook.imports.length > 0;
  const blob = zip
    ? await encodeFullBackup(bundle)
    : new Blob([encodeBackup(bundle.snapshot)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zip ? backupFilename().replace('.cyz.json', '.cyz-backup.zip') : backupFilename();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
