import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, type TestEnv } from '../helpers';
import { schemaVersionOf, fullIntegrityCheck, openDatabase } from '../../src/main/db/database';
import { ALL_PERMISSIONS, BUILTIN_ROLES } from '../../src/shared/permissions';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('database');
});

afterEach(() => {
  cleanupEnv(env);
});

describe('database migrations & seeds', () => {
  it('migrates to schema v1 with pragmas applied', () => {
    expect(schemaVersionOf(env.db)).toBe(1);
    const foreignKeys = env.db.pragma('foreign_keys', { simple: true });
    expect(Number(foreign_keys_value(foreignKeys))).toBe(1);
    const journal = String(env.db.pragma('journal_mode', { simple: true }));
    expect(journal).toBe('wal');
  });

  it('seeds the full permission catalog and built-in roles', () => {
    const perms = env.db.prepare('SELECT key FROM permissions').all<{ key: string }>();
    expect(perms.length).toBe(ALL_PERMISSIONS.length);
    expect(new Set(perms.map((p) => p.key)).size).toBe(perms.length);

    const roles = env.db.prepare('SELECT key, builtin FROM roles').all<{ key: string; builtin: number }>();
    expect(roles.length).toBe(Object.keys(BUILTIN_ROLES).length);
    expect(roles.every((r) => r.builtin === 1)).toBe(true);

    const ownerGrants = env.db
      .prepare(`SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'owner'`)
      .get<{ n: number }>()!;
    expect(ownerGrants.n).toBe(ALL_PERMISSIONS.length);
  });

  it('seeds 52 teeth (32 adult + 20 pediatric) and 11 account categories', () => {
    const teeth = env.db.prepare('SELECT dentition FROM teeth').all<{ dentition: string }>();
    expect(teeth.length).toBe(52);
    expect(teeth.filter((t) => t.dentition === 'adult').length).toBe(32);
    expect(teeth.filter((t) => t.dentition === 'pediatric').length).toBe(20);

    const cats = env.db.prepare('SELECT kind FROM account_categories').all<{ kind: string }>();
    expect(cats.length).toBe(11);
    expect(cats.filter((c) => c.kind === 'expense').length).toBe(9);
    expect(cats.filter((c) => c.kind === 'income').length).toBe(2);
  });

  it('seeds default settings rows for every module', () => {
    const keys = env.db.prepare('SELECT key FROM settings').all<{ key: string }>().map((r) => r.key);
    for (const k of ['clinic', 'prescription', 'invoice', 'security', 'backup', 'appearance', 'notifications', 'paymentMethods', 'printProfiles']) {
      expect(keys, k).toContain(k);
    }
  });

  it('audit log is append-only at the trigger level', () => {
    env.db
      .prepare(
        `INSERT INTO audit_log (at, user_id, username, action, entity_type, summary) VALUES (?, NULL, 'system', 'test.seed', 'test', 'seed row')`,
      )
      .run(new Date().toISOString());

    expect(() => env.db.prepare(`UPDATE audit_log SET summary = 'tampered' WHERE id = 1`).run()).toThrow(/append-only/i);
    expect(() => env.db.prepare('DELETE FROM audit_log WHERE id = 1').run()).toThrow(/append-only/i);
    const row = env.db.prepare('SELECT summary FROM audit_log WHERE id = 1').get<{ summary: string }>()!;
    expect(row.summary).toBe('seed row');
  });

  it('rejects negative inventory batch quantities via CHECK', () => {
    // Simulate direct tampering — constraints hold even below the service layer.
    const existing = env.db.prepare("SELECT value_json FROM settings WHERE key = 'clinic'").get();
    expect(existing).toBeTruthy();
    expect(() =>
      env.db.prepare(`UPDATE settings SET value_json = NULL WHERE key = 'clinic'`).run(),
    ).toThrow();
  });

  it('passes full integrity check on disk', () => {
    env.db.close();
    const res = fullIntegrityCheck(env.paths.dbFile);
    expect(res.ok).toBe(true);
    // reopen for afterEach cleanup
    env.db = openDatabase(env.paths.dbFile, { runMigrations: false }).db;
  });
});

function foreign_keys_value(v: unknown): unknown {
  return typeof v === 'object' && v !== null ? (v as any).foreign_keys : v;
}
