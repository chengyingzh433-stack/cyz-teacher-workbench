import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../shared/types';

const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function savePhotoToVault(
  vaultPath: string,
  examId: string,
  bytes: Uint8Array,
  mime: string,
): { hash: string; relPath: string; bytes: number; mime: string } {
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new AppError('ASSET_LIMIT', '单张图片大小须大于 0 且不超过 16 MB');
  }
  const ext = MIME_TO_EXT[mime.toLowerCase()];
  if (!ext) {
    throw new AppError('INVALID_ASSET', '仅支持 PNG / JPEG / WebP 图片');
  }
  const safeExam = examId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeExam) throw new AppError('INVALID_ASSET', '考试 ID 无效');

  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const relPath = `photos/${safeExam}/${hash}.${ext}`;
  const fullPath = resolveSafePhotoPath(vaultPath, relPath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, bytes);
  }
  return { hash, relPath, bytes: bytes.byteLength, mime: mime.toLowerCase() };
}

export function resolveSafePhotoPath(vaultPath: string, relPath: string): string {
  const photosRoot = path.resolve(vaultPath, 'photos');
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized.startsWith('photos/') || normalized.includes('..')) {
    throw new AppError('SECURITY', '非法附件路径');
  }
  const resolved = path.resolve(vaultPath, normalized);
  if (!resolved.startsWith(photosRoot + path.sep)) {
    throw new AppError('SECURITY', '附件路径越界');
  }
  return resolved;
}

export function computePhotosUsage(vaultPath: string): { count: number; bytes: number } {
  const photosRoot = path.join(vaultPath, 'photos');
  if (!fs.existsSync(photosRoot)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        count++;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(photosRoot);
  return { count, bytes };
}

/** Delete photo files on disk that are no longer referenced by any row in photo_assets. */
export function gcOrphanPhotos(vaultPath: string, activeRelPaths: Set<string>): number {
  const photosRoot = path.join(vaultPath, 'photos');
  if (!fs.existsSync(photosRoot)) return 0;
  let freed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          // ignore
        }
      } else if (entry.isFile()) {
        const rel = path.relative(vaultPath, full).split(path.sep).join('/');
        if (!activeRelPaths.has(rel)) {
          try {
            const st = fs.statSync(full);
            fs.unlinkSync(full);
            freed += st.size;
          } catch {
            // ignore busy file
          }
        }
      }
    }
  };
  walk(photosRoot);
  return freed;
}
