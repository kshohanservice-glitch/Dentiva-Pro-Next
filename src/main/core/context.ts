import type { PermissionKey } from '../../shared/permissions';
import type { SessionUser } from '../../shared/types';
import { forbidden } from '../errors';
import type { DB } from '../db/database';
import type { AppPaths } from '../paths';

export interface Ctx {
  db: DB;
  paths: AppPaths;
  session: SessionUser;
}

export interface PlainCtx {
  db: DB;
  paths: AppPaths;
}

/** Service-layer permission gate. UI hiding is cosmetic — everything is checked here. */
export function requirePermission(ctx: Ctx, key: PermissionKey): void {
  if (!ctx.session.permissions.includes(key)) {
    throw forbidden(`This action requires the "${key}" permission.`);
  }
}

export function hasPermission(ctx: Ctx, key: PermissionKey): boolean {
  return ctx.session.permissions.includes(key);
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  result?: 'success' | 'denied' | 'error';
  reason?: string;
}

/**
 * Append an audit record. Audit is insert-only (enforced by DB triggers).
 * Never pass passwords/activation material here — caller responsibility; summary
 * builders must not include secrets.
 */
export function audit(ctx: { db: DB; session?: SessionUser }, input: AuditInput): void {
  const session = ctx.session;
  ctx.db
    .prepare(
      `INSERT INTO audit_log (at, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, result, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      new Date().toISOString(),
      session?.userId ?? null,
      session?.username ?? 'system',
      input.action,
      input.entityType,
      input.entityId != null ? String(input.entityId) : null,
      input.summary,
      input.before !== undefined ? JSON.stringify(input.before) : null,
      input.after !== undefined ? JSON.stringify(input.after) : null,
      input.result ?? 'success',
      input.reason ?? null,
    );
}

export function auditDenied(ctx: { db: DB; session?: SessionUser }, input: AuditInput & { reason: string }): void {
  audit(ctx, { ...input, result: 'denied' });
}

/** Transaction helper with automatic rollback on throw. */
export function tx<T>(db: DB, fn: () => T): T {
  const runner = db.transaction(fn);
  return runner();
}
