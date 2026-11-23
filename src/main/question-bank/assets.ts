import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../shared/types';
import type { QuestionAssetDTO } from '../../shared/qbank/editable';
import { getQbankDir } from './db';

export function getQbankProjectsDir(vaultPath: string): string {
  const dir = path.join(getQbankDir(vaultPath), 'projects');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Strict path traversal guard for `workbench-asset://question-bank/...` and disk reads. */
export function resolveSafeQbankPath(vaultPath: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, '').replace(/\\/g, '/');
  if (!clean || clean.includes('\0')) {
    throw new AppError('FORBIDDEN', '无效的题库资源路径');
  }
  const root = path.resolve(getQbankProjectsDir(vaultPath));
  const abs = path.resolve(root, clean);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new AppError('FORBIDDEN', '非法题库路径访问');
  }
  return abs;
}

/** Pure-Node image header reader (PNG / JPEG / WebP) — works in both Electron and headless Node tests. */
export function readImageDimensions(buf: Buffer): { width: number; height: number } {
  // PNG: 8-byte signature + IHDR chunk at offset 16 (4-byte width, 4-byte height)
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { width: w, height: h };
    }
    if (chunk === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: scan SOF0 / SOF2 markers
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) break;
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return { width: 800, height: 480 };
}

export function writeQbankProjectFile(
  vaultPath: string,
  relPath: string,
  bytes: Buffer | Uint8Array,
): string {
  const abs = resolveSafeQbankPath(vaultPath, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return relPath.replace(/^\/+/, '').replace(/\\/g, '/');
}

export function copyQbankProjectFile(
  vaultPath: string,
  srcRelPath: string,
  destRelPath: string,
): string {
  const srcAbs = resolveSafeQbankPath(vaultPath, srcRelPath);
  const destAbs = resolveSafeQbankPath(vaultPath, destRelPath);
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return destRelPath.replace(/^\/+/, '').replace(/\\/g, '/');
}

export function removeQbankSubdir(vaultPath: string, relDir: string) {
  try {
    const abs = resolveSafeQbankPath(vaultPath, relDir);
    if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

export function saveQuestionAssetFile(
  db: DatabaseSync,
  vaultPath: string,
  questionId: number,
  bytes: Uint8Array | Buffer,
  name: string,
): QuestionAssetDTO {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!buf.length || buf.length > 30 * 1024 * 1024) {
    throw new AppError('VALIDATION', '配图文件为空或超过 30 MB 限制');
  }
  const { width, height } = readImageDimensions(buf);
  const id = crypto.randomUUID();
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? '.jpg' : '.png';
  const relPath = `questions/${questionId}/asset_${id}${ext}`;
  writeQbankProjectFile(vaultPath, relPath, buf);
  const now = new Date().toISOString();
  const safeName = (name || '题图').trim().slice(0, 120) || '题图';
  db.prepare(
    `INSERT INTO question_assets (id, question_id, rel_path, width_px, height_px, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, questionId, relPath, width, height, safeName, now);
  return { id, questionId, relPath, widthPx: width, heightPx: height, name: safeName };
}

export function listQuestionAssets(db: DatabaseSync, questionId: number): QuestionAssetDTO[] {
  const rows = db
    .prepare(
      `SELECT id, question_id, rel_path, width_px, height_px, name
       FROM question_assets
       WHERE question_id = ?
       ORDER BY created_at ASC`,
    )
    .all(questionId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    questionId: Number(r.question_id),
    relPath: String(r.rel_path),
    widthPx: Number(r.width_px || 600),
    heightPx: Number(r.height_px || 400),
    name: String(r.name || ''),
  }));
}
