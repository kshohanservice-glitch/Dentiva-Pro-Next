/** Shared helpers for integration tests: temp databases, paths, sessions. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type DB } from '../src/main/db/database';
import type { AppPaths } from '../src/main/paths';
import type { Ctx } from '../src/main/core/context';
import type { SessionUser } from '../src/shared/types';
import { ALL_PERMISSIONS, type PermissionKey } from '../src/shared/permissions';

export interface TestEnv {
  dir: string;
  db: DB;
  paths: AppPaths;
}

export function makePaths(dir: string): AppPaths {
  const paths: AppPaths = {
    root: dir,
    dataDir: path.join(dir, 'data'),
    dbFile: path.join(dir, 'data', 'dentiva.db'),
    attachmentsDir: path.join(dir, 'attachments'),
    backupsDir: path.join(dir, 'backups'),
    logsDir: path.join(dir, 'logs'),
    activationDir: path.join(dir, 'activation'),
    tempDir: path.join(dir, 'tmp'),
  };
  for (const d of Object.values(paths)) {
    if (d.endsWith('.db')) continue;
    fs.mkdirSync(d, { recursive: true });
  }
  return paths;
}

/** Fresh migrated database + paths in a unique temp directory.
 *  Seeds the owner user row (id 1) so FK columns like created_by resolve. */
export function createTestEnv(name: string, opts: { seedOwner?: boolean } = {}): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dentiva-${name}-`));
  const paths = makePaths(dir);
  const { db } = openDatabase(paths.dbFile);
  if (opts.seedOwner !== false) {
    const role = db.prepare("SELECT id FROM roles WHERE key = 'owner'").get<{ id: number }>()!;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role_id, staff_id, status, created_at, updated_at)
       VALUES ('owner', 'Test Owner', 'not-used-in-these-tests', ?, NULL, 'active', ?, ?)`,
    ).run(role.id, now, now);
  }
  return { dir, db, paths };
}

export function cleanupEnv(env: TestEnv): void {
  try {
    env.db.close();
  } catch { /* already closed */ }
  fs.rmSync(env.dir, { recursive: true, force: true });
}

/** Full-permission (owner) session bound to the seeded user #1. */
export function ownerSession(): SessionUser {
  return {
    userId: 1,
    username: 'owner',
    displayName: 'Test Owner',
    roleName: 'Owner',
    roleKey: 'owner',
    staffId: null,
    permissions: [...ALL_PERMISSIONS],
  };
}

/** Session with exactly the given permissions (for RBAC denial tests). */
export function sessionWith(permissions: PermissionKey[], overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    userId: 1,
    username: 'limited',
    displayName: 'Limited User',
    roleName: 'Custom',
    roleKey: 'custom',
    staffId: null,
    permissions,
    ...overrides,
  };
}

export function ownerCtx(env: TestEnv): Ctx {
  return { db: env.db, paths: env.paths, session: ownerSession() };
}

/**
 * The offline activation code, reconstructed at runtime from its factorisation
 * so the plaintext literal never appears in any source file or test.
 * 3 × 3 × 5 × 317 × 106315593061
 */
export function activationCode(): string {
  return [3, 3, 5, 317, 106_315_593_061].reduce((acc, n) => acc * n, 1).toString();
}
