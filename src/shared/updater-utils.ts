export const UPDATE_REPO_OWNER = 'chengyingzh433-stack';
export const UPDATE_REPO_NAME = 'cyz-teacher-workbench';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases/latest`;
export const GITHUB_RELEASES_PAGE = `https://github.com/${UPDATE_REPO_OWNER}/${UPDATE_REPO_NAME}/releases`;

export interface ReleaseAssetInfo {
  name: string;
  browserDownloadUrl: string;
  size: number;
}

function parseSemver(raw: string): { core: [number, number, number]; pre: string } {
  const cleaned = raw.trim().replace(/^v/i, '');
  const [mainPart, prePart = ''] = cleaned.split('-', 2);
  const nums = mainPart.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  return {
    core: [nums[0] || 0, nums[1] || 0, nums[2] || 0],
    pre: prePart.trim().toLowerCase(),
  };
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal. Stable release beats prerelease of same core version. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre > pb.pre ? 1 : -1;
}

/** Parses SHA256SUMS.txt lines (`<64hex>  <filename>` or `<64hex> *<filename>`) into basename -> lowercase hex. */
export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const hash = m[1].toLowerCase();
    const rawName = m[2].trim();
    const baseName = rawName.split('/').pop()?.split('\\').pop() || rawName;
    map.set(rawName, hash);
    map.set(baseName, hash);
  }
  return map;
}

/** Selects the best downloadable release asset for the current OS & CPU architecture. */
export function selectPlatformAsset(
  assets: ReleaseAssetInfo[],
  platform: string,
  arch: string,
): ReleaseAssetInfo | null {
  const usable = assets.filter(
    (a) =>
      !/\.blockmap$/i.test(a.name) &&
      !/sha256/i.test(a.name) &&
      !/^latest.*\.ya?ml$/i.test(a.name),
  );
  if (!usable.length) return null;

  if (platform === 'darwin') {
    const isArm = arch === 'arm64';
    const matchesArch = (name: string) => {
      const lower = name.toLowerCase();
      if (isArm) return lower.includes('arm64') || lower.includes('universal');
      return lower.includes('x64') || lower.includes('universal') || (!lower.includes('arm64') && /\.(zip|dmg)$/i.test(lower));
    };
    const macZip = usable.find(
      (a) =>
        /\.zip$/i.test(a.name) &&
        !a.name.toLowerCase().includes('win') &&
        matchesArch(a.name),
    );
    if (macZip) return macZip;
    const macDmg = usable.find((a) => /\.dmg$/i.test(a.name) && matchesArch(a.name));
    if (macDmg) return macDmg;
    return usable.find((a) => /\.(zip|dmg)$/i.test(a.name) && !a.name.toLowerCase().includes('win')) || null;
  }

  if (platform === 'win32') {
    const winZip = usable.find(
      (a) =>
        /\.zip$/i.test(a.name) &&
        (a.name.toLowerCase().includes('win') || a.name.toLowerCase().includes('x64')) &&
        !a.name.toLowerCase().includes('mac') &&
        !a.name.toLowerCase().includes('arm64'),
    );
    if (winZip) return winZip;
    const winExe = usable.find((a) => /\.exe$/i.test(a.name));
    if (winExe) return winExe;
  }

  return null;
}

/** Optional HTTPS mirror prefix for GitHub release downloads (never applied to localhost test URLs). */
export function applyMirrorPrefix(url: string, mirrorPrefix?: string): string {
  const prefix = (mirrorPrefix || '').trim();
  if (!prefix) return url;
  if (!/^https:\/\//i.test(prefix)) return url;
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i.test(url)) {
    return url;
  }
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return `${normalized}${url}`;
}
