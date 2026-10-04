import path from 'node:path';
import fs from 'node:fs';

/* eslint-disable @typescript-eslint/no-require-imports */
type ElectronApp = typeof import('electron').app;

/** Lazily resolved so unit/integration tests (vitest, no Electron binary) can
 *  import this module; in the packaged app `require('electron')` always works. */
let cachedApp: ElectronApp | null | undefined;
function electronApp(): ElectronApp | null {
  if (cachedApp !== undefined) return cachedApp;
  try {
    cachedApp = (require('electron') as { app?: ElectronApp }).app ?? null;
  } catch {
    cachedApp = null;
  }
  return cachedApp;
}

export interface AppPaths {
  root: string;
  dataDir: string;
  dbFile: string;
  attachmentsDir: string;
  backupsDir: string;
  logsDir: string;
  activationDir: string;
  tempDir: string;
}

let cached: AppPaths | null = null;

export function isDev(): boolean {
  if (process.env.DENTIVA_DEV === '1') return true;
  const app = electronApp();
  return app ? !app.isPackaged : true;
}

export function getPaths(): AppPaths {
  if (cached) return cached;
  const root = isDev()
    ? path.join(process.cwd(), '.dentiva-data')
    : path.join(electronApp()!.getPath('userData'));
  const paths: AppPaths = {
    root,
    dataDir: path.join(root, 'data'),
    dbFile: path.join(root, 'data', 'dentiva.db'),
    attachmentsDir: path.join(root, 'attachments'),
    backupsDir: path.join(root, 'backups'),
    logsDir: path.join(root, 'logs'),
    activationDir: path.join(root, 'activation'),
    tempDir: path.join(root, 'tmp'),
  };
  for (const dir of Object.values(paths)) {
    if (dir.endsWith('.db')) continue;
    fs.mkdirSync(dir, { recursive: true });
  }
  cached = paths;
  return paths;
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}


/**
 * Sanitize a user-provided filename for safe storage. Strips path separators,
 * control characters, reserved Windows device names and enforces a length cap.
 * NEVER trusts the original name for path construction.
 */
export function sanitizeFilename(name: string, maxLen = 120): string {
  let base = String(name ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (!base) base = 'file';
  if (reserved.test(base)) base = `_${base}`;
  if (base.length > maxLen) {
    const ext = path.extname(base).slice(0, 12);
    base = base.slice(0, maxLen - ext.length) + ext;
  }
  return base;
}

/** Resolve a path inside a root directory; throws when traversal is attempted. */
export function safeResolve(root: string, ...segments: string[]): string {
  const target = path.resolve(root, ...segments);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes allowed root: ${target}`);
  }
  return target;
}
