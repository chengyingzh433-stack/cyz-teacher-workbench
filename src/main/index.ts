import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, net, protocol, safeStorage } from 'electron';
import { getThemeWindowMeta } from '../shared/theme-meta';
import { VaultManager } from './vault';
import { AiKeychainStore } from './keychain';
import { MainAiProxy } from './ai-proxy';
import { ZhixueCompanionManager } from './zhixue-view';
import { AppUpdater } from './updater';
import { resolveSafePhotoPath } from './photo-store';
import { resolveSafeQbankPath } from './question-bank/assets';
import { registerIpcHandlers } from './ipc-handlers';

declare const __APP_VERSION__: string;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Must be registered before app.whenReady()
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'workbench-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let vault: VaultManager | null = null;
let zhixue: ZhixueCompanionManager | null = null;

function resolveSpritesDir(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'resources', 'sprites'),
    path.join(app.getAppPath(), 'resources', 'sprites'),
    path.resolve(__dirname, '../../resources/sprites'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[1];
}

function isWindows11Build(): boolean {
  if (process.platform !== 'win32') return false;
  const parts = os.release().split('.');
  const build = Number(parts[2] || 0);
  return Number.isFinite(build) && build >= 22621;
}

function applyWindowTheme(win: BrowserWindow | null, themeId: string) {
  if (!win || win.isDestroyed()) return;
  const meta = getThemeWindowMeta(themeId);
  const isGlass = meta.windowMaterial !== 'opaque';

  // Sync native OS appearance (controls macOS vibrancy light/dark tint + native menus/scrollbars)
  nativeTheme.themeSource = meta.isDark ? 'dark' : 'light';

  if (process.platform === 'darwin') {
    if (isGlass) {
      win.setBackgroundColor('#00000000');
      win.setVibrancy('under-window');
    } else {
      win.setVibrancy(null);
      win.setBackgroundColor(meta.windowBg);
    }
    return;
  }

  if (process.platform === 'win32') {
    if (isGlass && isWindows11Build()) {
      try {
        win.setBackgroundColor('#00000000');
        win.setBackgroundMaterial('acrylic');
        return;
      } catch {
        // Gracefully fall back to CSS frosted glass backdrop
      }
    }
    try {
      win.setBackgroundMaterial('none');
    } catch {
      // Ignore on Win10
    }
    win.setBackgroundColor(meta.windowBg);
    return;
  }

  win.setBackgroundColor(meta.windowBg);
}

function createWindow(initialThemeId: string) {
  const isMac = process.platform === 'darwin';
  const meta = getThemeWindowMeta(initialThemeId);
  const isGlass = meta.windowMaterial !== 'opaque';
  nativeTheme.themeSource = meta.isDark ? 'dark' : 'light';

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'cyz的教师工作台',
    backgroundColor: isGlass && (isMac || isWindows11Build()) ? '#00000000' : meta.windowBg,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 15 },
          visualEffectState: 'active',
          vibrancy: isGlass ? 'under-window' : undefined,
        }
      : {}),
    ...(process.platform === 'win32' && isGlass && isWindows11Build()
      ? { backgroundMaterial: 'acrylic' as const }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    applyWindowTheme(mainWindow, vault?.getPreferences().themeId || initialThemeId);
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    zhixue?.destroy();
    mainWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    vault = new VaultManager(userData);
    try {
      vault.open();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      dialog.showErrorBox('无法打开本地资料库', msg);
      app.quit();
      return;
    }

    const keychain = new AiKeychainStore(userData, safeStorage);
    const aiProxy = new MainAiProxy(keychain);
    zhixue = new ZhixueCompanionManager(
      () => mainWindow,
      (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('zhixue:state', state);
        }
      },
      userData,
      () => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('zhixue:escape');
        }
      },
    );

    // Custom safe protocol for local Vault photos + WebP sprite sheets
    const spritesDir = resolveSpritesDir();
    protocol.handle('workbench-asset', (req) => {
      try {
        const u = new URL(req.url);
        if (u.hostname === 'sprite') {
          const name = path.basename(decodeURIComponent(u.pathname));
          const webpPath = path.join(spritesDir, name);
          if (fs.existsSync(webpPath)) return net.fetch(pathToFileURL(webpPath).toString());
          return new Response('Sprite not found', { status: 404 });
        }
        if (u.hostname === 'vault' && vault) {
          const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
          const abs = resolveSafePhotoPath(vault.getPath(), relPath);
          if (!fs.existsSync(abs)) return new Response('Photo not found', { status: 404 });
          return net.fetch(pathToFileURL(abs).toString());
        }
        if (u.hostname === 'question-bank' && vault) {
          const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
          const abs = resolveSafeQbankPath(vault.getPath(), relPath);
          if (!fs.existsSync(abs)) return new Response('Question bank asset not found', { status: 404 });
          return net.fetch(pathToFileURL(abs).toString());
        }
        return new Response('Forbidden', { status: 403 });
      } catch {
        return new Response('Invalid asset URL', { status: 400 });
      }
    });

    const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : app.getVersion();
    const updater = new AppUpdater(
      userData,
      appVersion,
      () => vault?.getPreferences().updateMirrorUrl || '',
      (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('updater:status', state);
        }
      },
      () => app.quit(),
    );

    registerIpcHandlers({
      vault,
      keychain,
      aiProxy,
      zhixue,
      updater,
      getWindow: () => mainWindow,
      onThemeChanged: (themeId) => applyWindowTheme(mainWindow, themeId),
    });

    createWindow(vault.getPreferences().themeId);

    // Silent background update check after window settles (only in packaged builds or explicit E2E update endpoint)
    if ((app.isPackaged || process.env.CYZ_UPDATE_API_URL) && process.env.CYZ_DISABLE_STARTUP_UPDATE !== '1') {
      setTimeout(() => {
        void updater.checkForUpdates({ silent: true });
      }, 4500);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(vault?.getPreferences().themeId || 'studio-light');
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    zhixue?.destroy();
    vault?.close();
  });
}
