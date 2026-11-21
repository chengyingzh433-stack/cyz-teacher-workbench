import { AppError, validate, type Snapshot } from '../../app/model';
import type { AnswerAsset } from '../grading/model';

export const LIMITS = {
  archiveBytes: 128 * 1024 ** 2,
  metadataBytes: 20 * 1024 ** 2,
  assetBytes: 12 * 1024 ** 2,
  totalAssetBytes: 96 * 1024 ** 2,
  assets: 500,
  imagePixels: 24000000,
  totalPixels: 240000000,
} as const;
export type AssetFiles = Map<string, Blob>;
export type WorkspaceBundle = { snapshot: Snapshot; files: AssetFiles };
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new AppError(
      'CAPABILITY',
      '当前环境不能校验 SHA-256，请使用支持安全加密接口的浏览器打开',
    );
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
function imageHeader(bytes: Uint8Array): {
  mime: AnswerAsset['mime'];
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 33 &&
    view.getUint32(0) === 0x89504e47 &&
    view.getUint32(4) === 0x0d0a1a0a &&
    view.getUint32(8) === 13 &&
    view.getUint32(12) === 0x49484452
  )
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 4 && view.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
        return {
          mime: 'image/jpeg',
          width: view.getUint16(offset + 5),
          height: view.getUint16(offset + 3),
        };
      offset += length;
    }
  }
  throw new AppError('INVALID_ASSET', '附件不是支持的 PNG/JPEG 图片或图片头已损坏');
}
type InspectedImage = {
  mime: AnswerAsset['mime'];
  width: number;
  height: number;
  bytes: number;
  hash: string;
  blob: Blob;
};
const inspected = new WeakMap<Blob, InspectedImage>();
export async function inspectImage(blob: Blob): Promise<InspectedImage> {
  const cached = inspected.get(blob);
  if (cached) return cached;
  if (blob.size === 0 || blob.size > LIMITS.assetBytes)
    throw new AppError('ASSET_LIMIT', '单张附件须大于零且不超过 12 MiB');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = imageHeader(bytes);
  if (
    !header.width ||
    !header.height ||
    header.width > 12000 ||
    header.height > 12000 ||
    header.width * header.height > LIMITS.imagePixels
  )
    throw new AppError('ASSET_LIMIT', '图片尺寸超过允许范围（最长边 12000、2400 万像素）');
  if (typeof createImageBitmap !== 'function')
    throw new AppError(
      'CAPABILITY',
      '当前浏览器不能执行附件解码校验，请使用支持 createImageBitmap 的浏览器',
    );
  const typedBlob = new Blob([bytes], { type: header.mime });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(typedBlob, { imageOrientation: 'none' });
  } catch {
    throw new AppError('INVALID_ASSET', '图片无法解码，未接受该附件');
  }
  try {
    if (bitmap.width !== header.width || bitmap.height !== header.height)
      throw new AppError('INVALID_ASSET', '图片解码尺寸与文件头不一致');
  } finally {
    bitmap.close();
  }
  const result = { ...header, bytes: bytes.length, hash: await sha256(bytes), blob: typedBlob };
  inspected.set(blob, result);
  inspected.set(typedBlob, result);
  return result;
}
export function checkBundleShape(bundle: WorkspaceBundle): WorkspaceBundle {
  const snapshot = validate(bundle.snapshot);
  const byHash = new Map<string, AnswerAsset>();
  let totalBytes = 0,
    totalPixels = 0;
  for (const asset of snapshot.data.grading.assets) {
    const prior = byHash.get(asset.hash);
    if (
      prior &&
      (prior.mime !== asset.mime ||
        prior.bytes !== asset.bytes ||
        prior.width !== asset.width ||
        prior.height !== asset.height)
    )
      throw new AppError('INVALID_ASSET', '相同内容哈希的附件元数据不一致');
    if (!prior) {
      totalBytes += asset.bytes;
      totalPixels += asset.width * asset.height;
      byHash.set(asset.hash, asset);
    }
    const blob = bundle.files.get(asset.hash);
    if (!(blob instanceof Blob) || blob.size !== asset.bytes)
      throw new AppError('MISSING_ASSET', '附件缺失或大小不符，不能生成完整备份或应用恢复');
  }
  if (bundle.files.size !== byHash.size) throw new AppError('INVALID_ASSET', '存在未登记的附件');
  if (totalBytes > LIMITS.totalAssetBytes || totalPixels > LIMITS.totalPixels)
    throw new AppError('ASSET_LIMIT', '附件合计超过 96 MiB 或 2.4 亿像素的候选版本预算');
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > LIMITS.metadataBytes)
    throw new AppError('ASSET_LIMIT', '工作区元数据超过 20 MiB');
  return { snapshot, files: new Map(bundle.files) };
}
export async function validateBundle(bundle: WorkspaceBundle): Promise<WorkspaceBundle> {
  const clean = checkBundleShape(bundle);
  const seen = new Set<string>();
  for (const asset of clean.snapshot.data.grading.assets) {
    if (seen.has(asset.hash)) continue;
    seen.add(asset.hash);
    const actual = await inspectImage(clean.files.get(asset.hash)!);
    if (
      actual.hash !== asset.hash ||
      actual.mime !== asset.mime ||
      actual.width !== asset.width ||
      actual.height !== asset.height
    )
      throw new AppError('INVALID_ASSET', '附件哈希、真实格式或尺寸与清单不一致');
    clean.files.set(asset.hash, actual.blob);
  }
  return clean;
}
