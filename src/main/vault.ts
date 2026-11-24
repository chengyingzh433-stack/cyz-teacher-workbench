import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AppError,
  DEFAULT_PINNED_SPACES,
  type AppPreferences,
  type PinnableSpace,
  type VaultInfo,
} from '../shared/types';
import { openVaultDatabase, VAULT_SCHEMA_VERSION } from './db';
import { computePhotosUsage } from './photo-store';
import { computeQbankUsage, getQbankDir, openQbankDatabase } from './question-bank/db';

const VALID_PINNABLE = new Set<PinnableSpace>(DEFAULT_PINNED_SPACES);

function sanitizePinnedSpaces(raw: unknown): PinnableSpace[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PINNED_SPACES];
  const seen = new Set<PinnableSpace>();
  const out: PinnableSpace[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && VALID_PINNABLE.has(item as PinnableSpace) && !seen.has(item as PinnableSpace)) {
      seen.add(item as PinnableSpace);
      out.push(item as PinnableSpace);
    }
  }
  return out;
}

interface VaultManifest {
  name: string;
  schemaVersion: number;
  createdAt: string;
}

export class VaultManager {
  private db: DatabaseSync | null = null;
  private qbankDb: DatabaseSync | null = null;
  private vaultPath = '';
  private lockPath = '';
  private prefsPath: string;
  private prefs: AppPreferences;

  constructor(private userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.prefsPath = path.join(userDataDir, 'preferences.json');
    this.prefs = this.loadPrefs();
  }

  static defaultVaultPath(): string {
    return path.join(os.homedir(), 'Documents', 'cyz教师工作台');
  }

  private loadPrefs(): AppPreferences {
    const fallback: AppPreferences = {
      themeId: 'studio-light',
      vaultPath: VaultManager.defaultVaultPath(),
      sidebarCollapsed: false,
      recentVaults: [],
      pinnedSpaces: [...DEFAULT_PINNED_SPACES],
      updateMirrorUrl: '',
    };
    try {
      if (!fs.existsSync(this.prefsPath)) return fallback;
      const parsed = JSON.parse(fs.readFileSync(this.prefsPath, 'utf8')) as Partial<AppPreferences>;
      return {
        themeId: typeof parsed.themeId === 'string' && parsed.themeId ? parsed.themeId : fallback.themeId,
        vaultPath:
          typeof parsed.vaultPath === 'string' && parsed.vaultPath ? parsed.vaultPath : fallback.vaultPath,
        sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
        recentVaults: Array.isArray(parsed.recentVaults)
          ? parsed.recentVaults.filter((x): x is string => typeof x === 'string').slice(0, 8)
          : [],
        pinnedSpaces:
          parsed.pinnedSpaces !== undefined ? sanitizePinnedSpaces(parsed.pinnedSpaces) : [...DEFAULT_PINNED_SPACES],
        updateMirrorUrl:
          typeof parsed.updateMirrorUrl === 'string' ? parsed.updateMirrorUrl.trim().slice(0, 240) : '',
      };
    } catch {
      return fallback;
    }
  }

  private savePrefs() {
    fs.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2), 'utf8');
  }

  getPreferences(): AppPreferences {
    return {
      ...this.prefs,
      recentVaults: [...this.prefs.recentVaults],
      pinnedSpaces: [...this.prefs.pinnedSpaces],
    };
  }

  updatePreferences(patch: Partial<AppPreferences>): AppPreferences {
    this.prefs = {
      ...this.prefs,
      ...(patch.themeId ? { themeId: patch.themeId } : {}),
      ...(patch.sidebarCollapsed !== undefined ? { sidebarCollapsed: patch.sidebarCollapsed } : {}),
      ...(patch.pinnedSpaces !== undefined ? { pinnedSpaces: sanitizePinnedSpaces(patch.pinnedSpaces) } : {}),
      ...(patch.updateMirrorUrl !== undefined
        ? { updateMirrorUrl: String(patch.updateMirrorUrl || '').trim().slice(0, 240) }
        : {}),
    };
    this.savePrefs();
    return this.getPreferences();
  }

  open(dirPath?: string): VaultInfo {
    const target = path.resolve(dirPath || this.prefs.vaultPath || VaultManager.defaultVaultPath());
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.join(target, 'photos'), { recursive: true });

    const lockFile = path.join(target, '.workbench.lock');
    if (this.vaultPath !== target) {
      this.checkAndAcquireLock(lockFile);
      this.close();
      this.lockPath = lockFile;
    }

    const manifestPath = path.join(target, 'vault.json');
    if (!fs.existsSync(manifestPath)) {
      const manifest: VaultManifest = {
        name: path.basename(target) || 'cyz教师工作台',
        schemaVersion: VAULT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    }

    const dbPath = path.join(target, 'workbench.sqlite');
    this.db = openVaultDatabase(dbPath);
    this.qbankDb = openQbankDatabase(target);
    this.vaultPath = target;

    const recent = [target, ...this.prefs.recentVaults.filter((x) => x !== target)].slice(0, 8);
    this.prefs = { ...this.prefs, vaultPath: target, recentVaults: recent };
    this.savePrefs();

    return this.getInfo();
  }

  private checkAndAcquireLock(lockFile: string) {
    if (fs.existsSync(lockFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
          pid?: number;
          host?: string;
        };
        if (raw.host === os.hostname() && typeof raw.pid === 'number' && raw.pid !== process.pid) {
          let alive = false;
          try {
            process.kill(raw.pid, 0);
            alive = true;
          } catch {
            alive = false;
          }
          if (alive) {
            throw new AppError(
              'VAULT_LOCKED',
              '该资料库正在被另一个窗口使用，请先关闭另一个窗口，避免云盘同步冲突',
            );
          }
        }
      } catch (err) {
        if (err instanceof AppError) throw err;
      }
    }
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, host: os.hostname(), openedAt: new Date().toISOString() }),
      'utf8',
    );
  }

  getDb(): DatabaseSync {
    if (!this.db) this.open();
    return this.db!;
  }

  getQbankDb(): DatabaseSync {
    if (!this.qbankDb) this.open();
    return this.qbankDb!;
  }

  getPath(): string {
    if (!this.vaultPath) this.open();
    return this.vaultPath;
  }

  getInfo(): VaultInfo {
    const dir = this.getPath();
    const manifestPath = path.join(dir, 'vault.json');
    let manifest: VaultManifest = {
      name: path.basename(dir),
      schemaVersion: VAULT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
    };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VaultManifest;
    } catch {
      // use fallback
    }
    const dbPath = path.join(dir, 'workbench.sqlite');
    const dbBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    const photos = computePhotosUsage(dir);
    const qbank = computeQbankUsage(dir, this.qbankDb);
    return {
      path: dir,
      name: manifest.name,
      schemaVersion: manifest.schemaVersion,
      createdAt: manifest.createdAt,
      dbBytes,
      photoCount: photos.count,
      photoBytes: photos.bytes,
      qbankQuestionCount: qbank.questionCount,
      qbankBytes: qbank.bytes,
    };
  }

  exportCopyTo(destDir: string): string {
    const src = this.getPath();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const target = path.join(destDir, `cyz教师工作台备份-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    for (const file of ['vault.json', 'workbench.sqlite']) {
      const f = path.join(src, file);
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(target, file));
    }
    const photosSrc = path.join(src, 'photos');
    if (fs.existsSync(photosSrc)) {
      fs.cpSync(photosSrc, path.join(target, 'photos'), { recursive: true });
    }
    const qbankSrc = getQbankDir(src);
    if (fs.existsSync(qbankSrc)) {
      fs.cpSync(qbankSrc, path.join(target, 'question-bank'), { recursive: true });
    }
    return target;
  }

  /** Safely clears all workbench data inside the active Vault folder and recreates a clean empty Vault (never touches OS Keychain / API keys). */
  resetCurrent(): VaultInfo {
    const target = this.getPath();
    this.close();
    const wipeTargets = [
      'workbench.sqlite',
      'workbench.sqlite-wal',
      'workbench.sqlite-shm',
      'vault.json',
      'photos',
      'question-bank',
    ];
    for (const rel of wipeTargets) {
      const full = path.join(target, rel);
      if (fs.existsSync(full)) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
    this.vaultPath = '';
    return this.open(target);
  }

  close() {
    if (this.qbankDb) {
      try {
        this.qbankDb.close();
      } catch {
        // ignore
      }
      this.qbankDb = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = null;
    }
    if (this.lockPath && fs.existsSync(this.lockPath)) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // ignore
      }
    }
    this.lockPath = '';
  }
}
