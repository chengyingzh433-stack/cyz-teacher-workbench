import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { app, shell } from 'electron';
import type { UpdateState } from '../shared/types';
import {
  applyMirrorPrefix,
  compareSemver,
  GITHUB_RELEASES_API,
  GITHUB_RELEASES_PAGE,
  parseSha256Sums,
  selectPlatformAsset,
  type ReleaseAssetInfo,
} from '../shared/updater-utils';

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
    size?: number;
  }>;
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
  });
}

function findAppBundleInDir(dir: string, depth = 0): string | null {
  if (depth > 3 || !fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory() && ent.name.endsWith('.app')) {
      return path.join(dir, ent.name);
    }
  }
  for (const ent of entries) {
    if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== '__MACOSX') {
      const nested = findAppBundleInDir(path.join(dir, ent.name), depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function isWritableDir(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export class AppUpdater {
  private state: UpdateState;
  private selectedAssetUrl: string | null = null;
  private sha256AssetUrl: string | null = null;
  private activeDownload = false;

  constructor(
    private userDataDir: string,
    private currentVersion: string,
    private getMirrorUrl: () => string,
    private onStateChange: (state: UpdateState) => void,
    private onRequestQuit: () => void,
  ) {
    this.state = {
      phase: 'idle',
      currentVersion,
      latestVersion: null,
      releaseName: null,
      releaseNotes: '',
      releaseUrl: GITHUB_RELEASES_PAGE,
      publishedAt: null,
      assetName: null,
      assetSize: 0,
      downloadedBytes: 0,
      progressPct: 0,
      sha256Verified: false,
      stagedAppPath: null,
      downloadedFilePath: null,
      canAutoInstall: this.computeCanAutoInstall(),
      checkedAt: null,
      error: null,
    };
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  private setState(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    this.onStateChange(this.getState());
  }

  private resolveTargetMacAppPath(): string | null {
    if (process.platform !== 'darwin' || !app.isPackaged) return null;
    // process.execPath is .../cyz的教师工作台.app/Contents/MacOS/cyz的教师工作台
    const bundle = path.resolve(process.execPath, '../../..');
    if (!bundle.endsWith('.app')) return null;
    return bundle;
  }

  private computeCanAutoInstall(): boolean {
    if (process.platform === 'darwin') {
      const target = this.resolveTargetMacAppPath();
      return Boolean(target && isWritableDir(path.dirname(target)));
    }
    if (process.platform === 'win32') {
      return app.isPackaged && isWritableDir(path.dirname(process.execPath));
    }
    return false;
  }

  private getApiUrl(): string {
    const envUrl = process.env.CYZ_UPDATE_API_URL?.trim();
    if (envUrl && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(envUrl)) {
      return envUrl;
    }
    return GITHUB_RELEASES_API;
  }

  async checkForUpdates(opts?: { silent?: boolean }): Promise<UpdateState> {
    if (this.activeDownload) return this.getState();
    const silent = Boolean(opts?.silent);
    if (!silent) {
      this.setState({ phase: 'checking', error: null });
    }
    try {
      const apiUrl = this.getApiUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let resp: Response;
      try {
        resp = await fetch(apiUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': `cyz-teacher-workbench/${this.currentVersion}`,
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (resp.status === 404) {
        this.setState({
          phase: 'up-to-date',
          latestVersion: this.currentVersion,
          checkedAt: new Date().toISOString(),
          error: null,
        });
        return this.getState();
      }
      if (!resp.ok) {
        throw new Error(`检查更新接口返回 HTTP ${resp.status}`);
      }

      const data = (await resp.json()) as GitHubReleasePayload;
      const latestVersion = (data.tag_name || '').trim().replace(/^v/i, '');
      if (!latestVersion) {
        throw new Error('发布接口未包含有效版本号');
      }

      const assets: ReleaseAssetInfo[] = (data.assets || [])
        .filter((a) => a.name && a.browser_download_url)
        .map((a) => ({
          name: String(a.name),
          browserDownloadUrl: String(a.browser_download_url),
          size: Number(a.size || 0),
        }));

      const picked = selectPlatformAsset(assets, process.platform, process.arch);
      const shaAsset = assets.find((a) => /^sha256sums?(\.txt)?$/i.test(a.name));
      this.selectedAssetUrl = picked?.browserDownloadUrl || null;
      this.sha256AssetUrl = shaAsset?.browserDownloadUrl || null;

      const checkedAt = new Date().toISOString();
      const isNewer = compareSemver(latestVersion, this.currentVersion) > 0;
      const releaseUrl = data.html_url || GITHUB_RELEASES_PAGE;

      if (!isNewer) {
        this.setState({
          phase: 'up-to-date',
          latestVersion,
          releaseName: data.name || `v${latestVersion}`,
          releaseNotes: data.body || '',
          releaseUrl,
          publishedAt: data.published_at || null,
          assetName: picked?.name || null,
          assetSize: picked?.size || 0,
          checkedAt,
          error: null,
        });
        return this.getState();
      }

      // Reuse already-staged update if user downloaded it earlier in this version
      const versionDir = path.join(this.userDataDir, 'updates', latestVersion);
      const stagedCandidate = findAppBundleInDir(path.join(versionDir, 'staged'));
      const downloadedCandidate = picked ? path.join(versionDir, picked.name) : null;
      const alreadyReady =
        process.platform === 'darwin'
          ? Boolean(stagedCandidate && fs.existsSync(stagedCandidate))
          : Boolean(downloadedCandidate && fs.existsSync(downloadedCandidate));

      this.setState({
        phase: alreadyReady ? 'ready' : 'available',
        latestVersion,
        releaseName: data.name || `v${latestVersion}`,
        releaseNotes: data.body || '',
        releaseUrl,
        publishedAt: data.published_at || null,
        assetName: picked?.name || null,
        assetSize: picked?.size || 0,
        downloadedBytes: alreadyReady ? picked?.size || 0 : 0,
        progressPct: alreadyReady ? 100 : 0,
        stagedAppPath: alreadyReady ? stagedCandidate : null,
        downloadedFilePath: alreadyReady ? downloadedCandidate : null,
        canAutoInstall: this.computeCanAutoInstall(),
        checkedAt,
        error: null,
      });
      return this.getState();
    } catch (err) {
      if (silent) {
        return this.getState();
      }
      const msg =
        err instanceof Error
          ? err.name === 'AbortError'
            ? '连接 GitHub 检查更新超时，请稍后重试或检查网络'
            : err.message
          : String(err);
      this.setState({
        phase: 'error',
        checkedAt: new Date().toISOString(),
        error: msg,
      });
      return this.getState();
    }
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (this.activeDownload) return this.getState();
    if (!this.state.latestVersion || !this.selectedAssetUrl || !this.state.assetName) {
      throw new Error('当前没有可下载的平台安装包，请先检查更新或前往发布页手动下载');
    }

    this.activeDownload = true;
    const versionDir = path.join(this.userDataDir, 'updates', this.state.latestVersion);
    fs.mkdirSync(versionDir, { recursive: true });
    const safeAssetName = path.basename(this.state.assetName);
    const destPath = path.join(versionDir, safeAssetName);
    const partPath = `${destPath}.part`;

    this.setState({
      phase: 'downloading',
      downloadedBytes: 0,
      progressPct: 0,
      sha256Verified: false,
      stagedAppPath: null,
      downloadedFilePath: null,
      error: null,
    });

    try {
      const mirror = this.getMirrorUrl();
      const downloadUrl = applyMirrorPrefix(this.selectedAssetUrl, mirror);
      const resp = await fetch(downloadUrl, {
        headers: { 'User-Agent': `cyz-teacher-workbench/${this.currentVersion}` },
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`下载更新包失败（HTTP ${resp.status}）`);
      }
      const totalBytes = Number(resp.headers.get('content-length') || 0) || this.state.assetSize;
      const writer = fs.createWriteStream(partPath);
      const reader = resp.body.getReader();
      let received = 0;
      let lastEmit = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            if (!writer.write(Buffer.from(value))) {
              await new Promise<void>((res) => writer.once('drain', res));
            }
            const now = Date.now();
            if (now - lastEmit > 140) {
              lastEmit = now;
              const pct = totalBytes > 0 ? Math.min(99, Math.round((received / totalBytes) * 100)) : 0;
              this.setState({
                assetSize: totalBytes || received,
                downloadedBytes: received,
                progressPct: pct,
              });
            }
          }
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
          writer.end();
        });
      }

      fs.renameSync(partPath, destPath);
      this.setState({
        phase: 'verifying',
        assetSize: totalBytes || received,
        downloadedBytes: received,
        progressPct: 100,
      });

      // Mandatory SHA-256 verification when SHA256SUMS.txt is published with the release
      let sha256Verified = false;
      if (this.sha256AssetUrl) {
        const sumUrl = applyMirrorPrefix(this.sha256AssetUrl, mirror);
        const sumResp = await fetch(sumUrl, {
          headers: { 'User-Agent': `cyz-teacher-workbench/${this.currentVersion}` },
        });
        if (!sumResp.ok) {
          throw new Error(`无法拉取校验文件 SHA256SUMS.txt（HTTP ${sumResp.status}）`);
        }
        const sumMap = parseSha256Sums(await sumResp.text());
        const expected = sumMap.get(safeAssetName);
        if (expected) {
          const actual = await sha256File(destPath);
          if (actual !== expected) {
            try {
              fs.unlinkSync(destPath);
            } catch {
              // ignore
            }
            throw new Error('更新包 SHA-256 校验不匹配，已自动删除损坏文件，请重新下载');
          }
          sha256Verified = true;
        }
      }

      let stagedAppPath: string | null = null;
      if (process.platform === 'darwin') {
        stagedAppPath = this.stageMacBundle(destPath, versionDir);
      }

      this.setState({
        phase: 'ready',
        sha256Verified,
        stagedAppPath,
        downloadedFilePath: destPath,
        canAutoInstall: this.computeCanAutoInstall(),
        error: null,
      });
      return this.getState();
    } catch (err) {
      try {
        if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      } catch {
        // ignore
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.setState({ phase: 'error', error: msg });
      return this.getState();
    } finally {
      this.activeDownload = false;
    }
  }

  private stageMacBundle(archivePath: string, versionDir: string): string {
    const stageDir = path.join(versionDir, 'staged');
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });

    if (/\.zip$/i.test(archivePath)) {
      execFileSync('/usr/bin/ditto', ['-x', '-k', archivePath, stageDir], { timeout: 60000 });
    } else if (/\.dmg$/i.test(archivePath)) {
      const mountDir = path.join(versionDir, 'mnt');
      fs.rmSync(mountDir, { recursive: true, force: true });
      fs.mkdirSync(mountDir, { recursive: true });
      execFileSync(
        '/usr/bin/hdiutil',
        ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, archivePath],
        { timeout: 60000 },
      );
      try {
        const mountedApp = findAppBundleInDir(mountDir, 0);
        if (!mountedApp) throw new Error('DMG 镜像中未找到 .app 安装包');
        execFileSync('/usr/bin/ditto', [mountedApp, path.join(stageDir, path.basename(mountedApp))], {
          timeout: 60000,
        });
      } finally {
        try {
          execFileSync('/usr/bin/hdiutil', ['detach', mountDir, '-force'], { timeout: 15000 });
        } catch {
          // ignore detach race
        }
        fs.rmSync(mountDir, { recursive: true, force: true });
      }
    } else {
      throw new Error('不支持的 macOS 更新包格式');
    }

    const appBundle = findAppBundleInDir(stageDir, 0);
    if (!appBundle) throw new Error('解压更新包后未找到 .app 主程序');
    const plistPath = path.join(appBundle, 'Contents', 'Info.plist');
    if (!fs.existsSync(plistPath)) throw new Error('更新包缺少 Info.plist，已中止安装');
    let plistText = fs.readFileSync(plistPath, 'utf8');
    if (plistText.startsWith('bplist')) {
      plistText = execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', plistPath], {
        encoding: 'utf8',
        timeout: 10000,
      });
    }
    if (!plistText.includes('com.cyz.teacher-workbench')) {
      throw new Error('更新包应用标识不匹配，已中止安装');
    }
    return appBundle;
  }

  async installAndRestart(): Promise<{ mode: 'relaunching' | 'opened-installer' }> {
    if (this.state.phase !== 'ready') {
      throw new Error('请先下载并校验更新包');
    }

    if (process.platform === 'darwin' && this.state.canAutoInstall && this.state.stagedAppPath) {
      const targetApp = this.resolveTargetMacAppPath();
      if (targetApp && fs.existsSync(this.state.stagedAppPath)) {
        const updatesRoot = path.join(this.userDataDir, 'updates');
        const scriptPath = path.join(updatesRoot, 'apply-update.sh');
        const versionDir = path.dirname(path.dirname(this.state.stagedAppPath));
        const scriptBody = [
          '#!/bin/sh',
          'PID="$1"',
          'STAGED="$2"',
          'TARGET="$3"',
          'CLEANUP_DIR="$4"',
          'BACKUP="${TARGET}.cyz-old"',
          'i=0',
          'while kill -0 "$PID" 2>/dev/null && [ "$i" -lt 80 ]; do',
          '  sleep 0.25',
          '  i=$((i + 1))',
          'done',
          'rm -rf "$BACKUP"',
          'if mv "$TARGET" "$BACKUP"; then',
          '  if mv "$STAGED" "$TARGET"; then',
          '    xattr -cr "$TARGET" 2>/dev/null || true',
          '    rm -rf "$BACKUP"',
          '    open -a "$TARGET"',
          '    rm -rf "$CLEANUP_DIR" 2>/dev/null || true',
          '    exit 0',
          '  else',
          '    mv "$BACKUP" "$TARGET" 2>/dev/null || true',
          '    open -a "$TARGET"',
          '    exit 1',
          '  fi',
          'fi',
          'exit 1',
          '',
        ].join('\n');
        fs.writeFileSync(scriptPath, scriptBody, { mode: 0o755 });
        this.setState({ phase: 'installing' });
        const child = spawn(
          '/bin/sh',
          [scriptPath, String(process.pid), this.state.stagedAppPath, targetApp, versionDir],
          { detached: true, stdio: 'ignore' },
        );
        child.unref();
        setTimeout(() => this.onRequestQuit(), 180);
        return { mode: 'relaunching' };
      }
    }

    // Windows NSIS Setup .exe: launch verified installer directly and quit current process
    if (
      process.platform === 'win32' &&
      this.state.downloadedFilePath &&
      /\.exe$/i.test(this.state.downloadedFilePath) &&
      fs.existsSync(this.state.downloadedFilePath)
    ) {
      this.setState({ phase: 'installing' });
      const child = spawn(this.state.downloadedFilePath, [], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      setTimeout(() => this.onRequestQuit(), 200);
      return { mode: 'relaunching' };
    }

    // Fallback (dev mode, Windows green zip, or read-only directory): reveal or open downloaded file
    if (this.state.downloadedFilePath && fs.existsSync(this.state.downloadedFilePath)) {
      if (process.platform === 'darwin' && /\.dmg$/i.test(this.state.downloadedFilePath)) {
        await shell.openPath(this.state.downloadedFilePath);
      } else {
        shell.showItemInFolder(this.state.downloadedFilePath);
      }
      return { mode: 'opened-installer' };
    }
    throw new Error('未找到已下载的更新安装包');
  }

  openDownloadedItem() {
    if (this.state.downloadedFilePath && fs.existsSync(this.state.downloadedFilePath)) {
      shell.showItemInFolder(this.state.downloadedFilePath);
    }
  }
}
