import { AppError } from '../../app/model';
import { LIMITS } from '../assets';

// Deliberately bounded ZIP profile: STORE, single disk, no encryption/descriptors/ZIP64.
// See PKWARE APPNOTE 6.3.10. Other ZIP profiles are rejected, never partially imported.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const n of bytes) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const validPath = (path: string) =>
  /^(workspace\.json|manifest\.json|assets\/[a-f0-9]{64})$/.test(path);
function invalid(message = '备份 ZIP 结构不完整或不符合本产品格式'): never {
  throw new AppError('INVALID_BACKUP', message);
}
export function packZip(entries: Map<string, Uint8Array<ArrayBuffer>>): Blob {
  if (entries.size > LIMITS.assets + 2) invalid('附件条目过多');
  const locals: BlobPart[] = [],
    central: BlobPart[] = [];
  let offset = 0,
    centralBytes = 0;
  for (const [path, bytes] of entries) {
    if (!validPath(path)) invalid('ZIP 路径不在白名单内');
    const name = encoder.encode(path),
      crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length),
      l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x800, true);
    l.setUint16(12, 33, true); // 1980-01-01, metadata carries actual export time.
    l.setUint32(14, crc, true);
    l.setUint32(18, bytes.length, true);
    l.setUint32(22, bytes.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length),
      c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    record.set(name, 46);
    locals.push(local, bytes);
    central.push(record);
    offset += local.length + bytes.length;
    centralBytes += record.length;
  }
  if (offset + centralBytes + 22 > LIMITS.archiveBytes) invalid('备份包超过 128 MiB');
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.size, true);
  e.setUint16(10, entries.size, true);
  e.setUint32(12, centralBytes, true);
  e.setUint32(16, offset, true);
  return new Blob([...locals, ...central, end], { type: 'application/zip' });
}
export function unpackZip(bytes: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
  if (bytes.length < 22 || bytes.length > LIMITS.archiveBytes)
    invalid('备份包为空、损坏或超过 128 MiB');
  const v = new DataView(bytes.buffer),
    end = bytes.length - 22;
  const u16 = (n: number) => v.getUint16(n, true),
    u32 = (n: number) => v.getUint32(n, true);
  if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)) invalid();
  const count = u16(end + 10),
    centralSize = u32(end + 12),
    centralStart = u32(end + 16);
  if (
    count !== u16(end + 8) ||
    count < 2 ||
    count > LIMITS.assets + 2 ||
    centralStart + centralSize !== end
  )
    invalid();
  const entries = new Map<string, Uint8Array<ArrayBuffer>>();
  let pos = centralStart,
    localEnd = 0,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) invalid();
    const flags = u16(pos + 8),
      method = u16(pos + 10),
      length = u32(pos + 24),
      packed = u32(pos + 20);
    const nameLength = u16(pos + 28),
      extra = u16(pos + 30),
      comment = u16(pos + 32),
      local = u32(pos + 42);
    if (
      flags !== 0x800 ||
      method !== 0 ||
      u16(pos + 6) > 20 ||
      extra ||
      comment ||
      u16(pos + 34) ||
      length !== packed
    )
      invalid('仅支持本产品生成的 STORE 备份 ZIP；不支持重新压缩、加密、分卷或 ZIP64 文件');
    if (pos + 46 + nameLength > end || local !== localEnd || local + 30 + nameLength > centralStart)
      invalid();
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (!validPath(path) || entries.has(path)) invalid('ZIP 路径非法或重复');
    const limit = path.startsWith('assets/') ? LIMITS.assetBytes : LIMITS.metadataBytes;
    if (length > limit || (total += length) > LIMITS.archiveBytes) invalid('ZIP 条目超过读取预算');
    if (
      u32(local) !== 0x04034b50 ||
      u16(local + 4) > 20 ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      u32(local + 14) !== u32(pos + 16) ||
      u32(local + 18) !== length ||
      u32(local + 22) !== length ||
      u16(local + 26) !== nameLength ||
      u16(local + 28)
    )
      invalid();
    if (decoder.decode(bytes.subarray(local + 30, local + 30 + nameLength)) !== path) invalid();
    const start = local + 30 + nameLength;
    localEnd = start + length;
    if (localEnd > centralStart) invalid();
    const data = bytes.slice(start, localEnd);
    if (crc32(data) !== u32(pos + 16)) invalid('ZIP 条目校验失败，文件可能损坏');
    entries.set(path, data);
    pos += 46 + nameLength;
  }
  if (
    pos !== end ||
    localEnd !== centralStart ||
    !entries.has('workspace.json') ||
    !entries.has('manifest.json')
  )
    invalid();
  return entries;
}
