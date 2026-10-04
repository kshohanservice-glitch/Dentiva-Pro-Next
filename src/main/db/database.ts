import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';
import { MIGRATIONS } from './migrations';

export type DB = Database.Database;

export interface OpenResult { db: DB; schemaVersion: number }

function applyPragmas(db: DB): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 8000');
  db.pragma('temp_store = MEMORY');
}

export function migrate(db: DB): { from: number; to: number } {
  const current = Number(db.pragma('user_version', { simple: true }));
  const target = MIGRATIONS[MIGRATIONS.length - 1].version;
  if (current > target) {
    throw new AppError('INTERNAL', 'This database was created by a newer version of Dentiva Pro and cannot be opened.');
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const run = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    run();
  }
  return { from: current, to: Number(db.pragma('user_version', { simple: true })) };
}

/** Open (creating if needed), apply pragmas, run pending migrations, verify integrity. */
export function openDatabase(dbFile: string, opts: { runMigrations?: boolean } = {}): OpenResult {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  applyPragmas(db);
  if (opts.runMigrations !== false) {
    migrate(db);
    db.prepare("UPDATE teeth SET arch = 'upper' WHERE quadrant IN (5, 6) AND arch != 'upper'").run();
  }
  const integrity = db.pragma('quick_check', { simple: true });
  if (integrity !== 'ok') {
    db.close();
    throw new AppError('INTERNAL', 'Database integrity check failed. Restore a backup from the recovery screen.', { details: { integrity } });
  }
  return { db, schemaVersion: Number(db.pragma('user_version', { simple: true })) };
}

export function schemaVersionOf(db: DB): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** Full integrity check (used by restore validation). */
export function fullIntegrityCheck(dbFile: string): { ok: boolean; errors: string[] } {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const errors = rows.map((r) => r.integrity_check).filter((v) => v !== 'ok');
    return { ok: errors.length === 0, errors };
  } finally {
    db.close();
  }
}
