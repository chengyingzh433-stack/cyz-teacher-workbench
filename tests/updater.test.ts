import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMirrorPrefix,
  compareSemver,
  parseSha256Sums,
  selectPlatformAsset,
  type ReleaseAssetInfo,
} from '../src/shared/updater-utils';

test('Updater semver 比较：正确处理 v 前缀、主次修订号与预发布版本', () => {
  assert.equal(compareSemver('1.4.0', '1.3.1'), 1);
  assert.equal(compareSemver('v1.4.0', '1.4.0'), 0);
  assert.equal(compareSemver('1.3.9', '1.4.0'), -1);
  assert.equal(compareSemver('1.10.0', '1.9.9'), 1);
  assert.equal(compareSemver('1.4.0', '1.4.0-beta.1'), 1);
  assert.equal(compareSemver('1.4.0-beta.2', '1.4.0-beta.1'), 1);
});

test('Updater SHA256SUMS 解析：支持标准空格与星号格式并规范文件名', () => {
  const hashA = 'a'.repeat(64);
  const hashB = 'B'.repeat(64);
  const map = parseSha256Sums(
    `# comment\n${hashA}  release/cyz-1.4.0-arm64-mac.zip\n${hashB} *cyz-1.4.0-x64-win.zip\ninvalid line`,
  );
  assert.equal(map.get('cyz-1.4.0-arm64-mac.zip'), hashA);
  assert.equal(map.get('cyz-1.4.0-x64-win.zip'), hashB.toLowerCase());
  assert.equal(map.get('missing.zip'), undefined);
});

test('Updater 平台包选择：macOS arm64 优先选 arm64 zip，其次 arm64 dmg；Windows 优先选 x64 setup.exe，其次 zip', () => {
  const assets: ReleaseAssetInfo[] = [
    { name: 'SHA256SUMS.txt', browserDownloadUrl: 'https://github.com/r/SHA256SUMS.txt', size: 200 },
    { name: 'cyz-1.4.0-arm64.dmg.blockmap', browserDownloadUrl: 'https://github.com/r/bm', size: 100 },
    { name: 'cyz-1.4.0-arm64.dmg', browserDownloadUrl: 'https://github.com/r/arm64.dmg', size: 150 },
    { name: 'cyz-1.4.0-arm64-mac.zip', browserDownloadUrl: 'https://github.com/r/arm64-mac.zip', size: 145 },
    { name: 'cyz-1.4.0-x64.dmg', browserDownloadUrl: 'https://github.com/r/x64.dmg', size: 152 },
    { name: 'cyz-1.4.0-win-x64.zip', browserDownloadUrl: 'https://github.com/r/win-x64.zip', size: 140 },
    { name: 'cyz-1.4.0-win-x64-setup.exe', browserDownloadUrl: 'https://github.com/r/win-x64-setup.exe', size: 142 },
  ];
  assert.equal(selectPlatformAsset(assets, 'darwin', 'arm64')?.name, 'cyz-1.4.0-arm64-mac.zip');
  assert.equal(selectPlatformAsset(assets, 'darwin', 'x64')?.name, 'cyz-1.4.0-x64.dmg');
  assert.equal(selectPlatformAsset(assets, 'win32', 'x64')?.name, 'cyz-1.4.0-win-x64-setup.exe');
  assert.equal(
    selectPlatformAsset(assets.filter((a) => !a.name.endsWith('.exe')), 'win32', 'x64')?.name,
    'cyz-1.4.0-win-x64.zip',
  );
});

test('Updater 镜像前缀：仅对 HTTPS GitHub 下载链接生效，绝不污染 localhost 或非 HTTPS', () => {
  assert.equal(
    applyMirrorPrefix('https://github.com/a/b/releases/download/v1.4.0/app.zip', 'https://ghfast.top'),
    'https://ghfast.top/https://github.com/a/b/releases/download/v1.4.0/app.zip',
  );
  assert.equal(
    applyMirrorPrefix('http://127.0.0.1:9999/app.zip', 'https://ghfast.top/'),
    'http://127.0.0.1:9999/app.zip',
  );
  assert.equal(
    applyMirrorPrefix('https://github.com/a/b/app.zip', 'http://insecure.example.com'),
    'https://github.com/a/b/app.zip',
  );
});
