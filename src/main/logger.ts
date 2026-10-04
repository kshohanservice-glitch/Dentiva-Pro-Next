import fs from 'node:fs';
import path from 'node:path';
import { getPaths } from './paths';

type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACT_KEY = /(password|passphrase|token|secret|activation|credential|otp)/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ROTATED = 5;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

class Logger {
  private stream: fs.WriteStream | null = null;
  private file = '';
  private bytes = 0;
  private enabled = true;

  constructor() {
    try {
      const dir = getPaths().logsDir;
      this.file = path.join(dir, `app-${new Date().toISOString().slice(0, 10)}.log`);
      this.bytes = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
      this.stream = fs.createWriteStream(this.file, { flags: 'a' });
      this.rotateIfNeeded();
      this.cleanupOld();
    } catch {
      this.enabled = false; // logging must never crash the app
    }
  }

  private rotateIfNeeded(): void {
    if (this.bytes < MAX_FILE_BYTES) return;
    try {
      this.stream?.end();
      const rotated = this.file.replace(/\.log$/, `-1.log`);
      if (fs.existsSync(rotated)) fs.rmSync(rotated, { force: true });
      if (fs.existsSync(this.file)) fs.renameSync(this.file, rotated);
      this.bytes = 0;
      this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    } catch {
      /* best effort */
    }
  }

  private cleanupOld(): void {
    try {
      const dir = getPaths().logsDir;
      const files = fs.readdirSync(dir)
        .filter((f) => f.startsWith('app-') && f.endsWith('.log'))
        .sort()
        .reverse();
      for (const f of files.slice(MAX_ROTATED)) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    } catch {
      /* best effort */
    }
  }

  private write(level: Level, msg: string, meta?: Record<string, unknown>): void {
    const line =
      `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}` +
      (meta ? ` ${JSON.stringify(redact(meta))}` : '');
    if (level === 'error' || level === 'warn') console.warn(line);
    if (!this.enabled || !this.stream) return;
    this.bytes += line.length + 1;
    this.stream.write(line + '\n');
    this.rotateIfNeeded();
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    if (process.env.DENTIVA_DEV === '1') this.write('debug', msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>): void { this.write('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.write('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.write('error', msg, meta); }
}

export const logger = new Logger();
