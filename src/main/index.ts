import { app, BrowserWindow, dialog, Menu, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getPaths, isDev } from './paths';
import { logger } from './logger';
import { openDatabase, schemaVersionOf, type DB } from './db/database';
import { setDb } from './app';
import { SessionManager } from './core/session';
import { ActivationStore, weakCipher, type Cipher } from './core/activation';
import { createBackupService, type DbHolder } from './services/backup';
import { insertNotification, refreshNotifications } from './services/notifications';
import { registerRouter } from './ipc/router';
import { resolveWindowIcon } from './print';
import { IPC } from '../shared/ipc';
import { isDemoBuild } from './build-mode';
import { seedDemoDatabase, DEMO_PASSWORD, DEMO_USERNAME } from './demo';

const APP_VERSION = ((): string => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')).version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

let mainWindow: BrowserWindow | null = null;

function buildCipher(): Cipher {
  if (safeStorage.isEncryptionAvailable()) {
    return { encrypt: (b) => safeStorage.encryptString(b.toString('utf8')), decrypt: (b) => Buffer.from(safeStorage.decryptString(b), 'utf8') };
  }
  logger.warn('OS secure storage unavailable — using reduced-strength activation container.');
  return weakCipher;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f8fa',
    title: 'Dentiva Pro',
    autoHideMenuBar: true,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));

  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}

function fatal(title: string, message: string): void {
  dialog.showErrorBox(`Dentiva Pro — ${title}`, message);
  app.exit(1);
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(null);
  const demoBuild = isDemoBuild();
  const paths = getPaths();

  // --- Database open with integrity guard -------------------------------
  let db: DB;
  try {
    ({ db } = openDatabase(paths.dbFile));
  } catch (err: any) {
    logger.error('Database failed to open', { error: err?.message });
    fatal(
      'Database problem',
      `Dentiva Pro could not open its database.\n\n${err?.message ?? err}\n\n` +
        `Your data files are located at:\n${paths.dataDir}\n\n` +
        `Restore a backup from ${paths.backupsDir} if the file is damaged.`,
    );
    return;
  }
  setDb(db);

  if (demoBuild) await seedDemoDatabase(db);

  const holder: DbHolder = {
    get: () => {
      try { return db; } catch { throw new Error('Database unavailable'); }
    },
    set: (next) => { db = next; setDb(next); },
  };

  // --- Session (auth + auto-lock) ---------------------------------------
  const readSecurityPolicy = () => {
    try {
      const row = holder.get().prepare("SELECT value_json FROM settings WHERE key = 'security'").get<{ value_json: string }>();
      const sec = row ? JSON.parse(row.value_json) : {};
      return { maxFailedLogins: sec.maxFailedLogins ?? 5, minPasswordLength: sec.minPasswordLength ?? 8 };
    } catch {
      return { maxFailedLogins: 5, minPasswordLength: 8 };
    }
  };

  const session_ = new SessionManager({
    db: () => holder.get(),
    securityPolicy: readSecurityPolicy,
    onLock: () => {
      // Close print windows (they may contain patient data) and notify shell
      for (const w of BrowserWindow.getAllWindows()) {
        if (w !== mainWindow && !w.isDestroyed()) w.close();
      }
      mainWindow?.webContents.send(IPC.onLock);
    },
  });
  session_.setAutoLockProvider(() => {
    try {
      const row = holder.get().prepare("SELECT value_json FROM settings WHERE key = 'security'").get<{ value_json: string }>();
      const sec = row ? JSON.parse(row.value_json) : {};
      return sec.autoLockMinutes ?? 10;
    } catch {
      return 10;
    }
  });
  session_.start();
  if (demoBuild) {
    const result = await session_.signIn(DEMO_USERNAME, DEMO_PASSWORD);
    if (!result.ok) throw new Error('Demo account could not be initialized.');
  }

  // --- Activation --------------------------------------------------------
  const activation = new ActivationStore(path.join(paths.activationDir, 'state.bin'), buildCipher());

  // --- Backup service ----------------------------------------------------
  const backup = createBackupService({
    paths,
    holder,
    appVersion: APP_VERSION,
    notify: (n) => {
      try {
        insertNotification(holder.get(), n);
      } catch (e) {
        logger.warn('Could not persist notification', { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });

  registerRouter({
    paths: () => paths,
    session: session_,
    activation,
    backup,
    securityPolicy: readSecurityPolicy,
    appVersion: APP_VERSION,
    schemaVersion: () => schemaVersionOf(holder.get()),
    demo: demoBuild,
    refreshNotifications: () => {
      if (demoBuild) return;
      try {
        const row = holder.get().prepare("SELECT value_json FROM settings WHERE key = 'notifications'").get<{ value_json: string }>();
        const prefs = row ? JSON.parse(row.value_json) : {};
        refreshNotifications(holder.get(), {
          lowStock: prefs.lowStock !== false,
          dues: prefs.dues !== false,
          backup: prefs.backup !== false,
          appointments: prefs.appointments !== false,
        });
      } catch (e) {
        logger.warn('Notification refresh failed', { error: e instanceof Error ? e.message : String(e) });
      }
    },
  });

  createWindow();

  // Crash containment: log, surface a friendly dialog, exit non-zero once.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') });
    dialog.showErrorBox('Dentiva Pro — unexpected error', `An unexpected error occurred:\n${err.message}\n\nYour saved data is unaffected. The application will close.`);
    app.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { error: reason instanceof Error ? reason.message : String(reason) });
  });

  // Post-ready maintenance: automatic backup + notification refresh (non-blocking)
  if (demoBuild) return;
  setTimeout(() => {
    void (async () => {
      try {
        await backup.autoBackupIfDue({ db: holder.get(), paths });
      } catch (e) {
        logger.warn('Auto-backup check failed', { error: e instanceof Error ? e.message : String(e) });
      }
      try {
        const row = holder.get().prepare("SELECT value_json FROM settings WHERE key = 'notifications'").get<{ value_json: string }>();
        const prefs = row ? JSON.parse(row.value_json) : {};
        refreshNotifications(holder.get(), {
          lowStock: prefs.lowStock !== false, dues: prefs.dues !== false,
          backup: prefs.backup !== false, appointments: prefs.appointments !== false,
        });
      } catch { /* non-fatal */ }
    })();
  }, 2500);
}

/* --------------------------- app lifecycle --------------------------- */

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
    if (isDev()) {
      // Development data lives in .dentiva-data (see paths.ts); nothing else special.
    }
    // Deny any remote navigation / permission requests (offline-first product)
    app.on('web-contents-created', (_e, contents) => {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-attach-webview', (event) => event.preventDefault());
      contents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
    });
    void boot();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
