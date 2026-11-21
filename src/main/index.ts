import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, net, protocol, safeStorage } from 'electron';
import { VaultManager } from './vault';
import { AiKeychainStore } from './keychain';
import { MainAiProxy } from './ai-proxy';
import { ZhixueCompanionManager } from './zhixue-view';
import { resolveSafePhotoPath } from './photo-store';
import { registerIpcHandlers } from './ipc-handlers';

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
    path.resolve(__dirname, '../../assets/pixel'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[1];
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'cyz的教师工作台',
    backgroundColor: '#faf9f6',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 15 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
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
    vault.open();

    const keychain = new AiKeychainStore(userData, safeStorage);
    const aiProxy = new MainAiProxy(keychain);
    zhixue = new ZhixueCompanionManager(
      () => mainWindow,
      (state) => {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('zhixue:state', state);
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
          // Fallback to PNG during dev if needed
          const pngFallback = path.resolve(
            __dirname,
            '../../assets/pixel',
            name.replace(/\.webp$/i, '.png'),
          );
          if (fs.existsSync(pngFallback)) return net.fetch(pathToFileURL(pngFallback).toString());
          return new Response('Sprite not found', { status: 404 });
        }
        if (u.hostname === 'vault' && vault) {
          const relPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
          const abs = resolveSafePhotoPath(vault.getPath(), relPath);
          if (!fs.existsSync(abs)) return new Response('Photo not found', { status: 404 });
          return net.fetch(pathToFileURL(abs).toString());
        }
        return new Response('Forbidden', { status: 403 });
      } catch {
        return new Response('Invalid asset URL', { status: 400 });
      }
    });

    registerIpcHandlers({
      vault,
      keychain,
      aiProxy,
      zhixue,
      getWindow: () => mainWindow,
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
