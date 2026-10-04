import type { Ctx } from '../core/context';
import type { AuditEntry, Paged } from '../../shared/types';
import type { PermissionKey } from '../../shared/permissions';
import type { RoleDTO, UserDTO } from '../../shared/types';
import { conflict, forbidden, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { hashPassword } from '../core/passwords';
import { loadPermissions } from './auth';
import { nowISO } from '../../shared/currency';
import { optString, pageParams, reqPassword, reqString, reqUsername, oneOf, escapeLike } from '../core/validate';
import { isPermissionKey, BUILTIN_ROLES } from '../../shared/permissions';

function minPasswordLengthOf(ctx: Ctx): number {
  try {
    const row = ctx.db.prepare("SELECT value_json FROM settings WHERE key = 'security'").get<{ value_json: string }>();
    const parsed = row ? JSON.parse(row.value_json) : {};
    const n = Number(parsed?.minPasswordLength);
    return Number.isFinite(n) ? Math.min(64, Math.max(8, Math.round(n))) : 8;
  } catch {
    return 8;
  }
}

/* ------------------------------- Users -------------------------------- */

function userDTO(r: any, permissions?: PermissionKey[]): UserDTO {
  return {
    id: r.id, username: r.username, displayName: r.display_name,
    roleId: r.role_id, roleName: r.role_name, status: r.status,
    staffId: r.staff_id, lastLoginAt: r.last_login_at, createdAt: r.created_at,
    mustChangePassword: !!r.must_change_password, permissions,
  };
}

const SELECT_USER = `
  SELECT u.*, r.name role_name FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.deleted_at IS NULL ORDER BY u.username`;

export async function listUsers(ctx: Ctx): Promise<UserDTO[]> {
  requirePermission(ctx, 'users.manage');
  const rows = ctx.db.prepare(SELECT_USER).all() as any[];
  return rows.map((r) => userDTO(r, loadPermissions(ctx.db, r.id, r.role_id)));
}

export interface UserSaveInput {
  id?: number; username: string; displayName: string; password?: string;
  roleId: number; status?: string; staffId?: number | null; permissions?: PermissionKey[];
}

export async function saveUser(ctx: Ctx, input: UserSaveInput): Promise<UserDTO> {
  requirePermission(ctx, 'users.manage');
  const username = reqUsername(input?.username);
  const displayName = reqString(input?.displayName, 'Display name', { max: 120 });
  const roleId = reqIntSafe(input?.roleId);
  const status = oneOf(input?.status ?? 'active', ['active', 'locked', 'disabled'] as const, 'Status');
  const role = ctx.db.prepare('SELECT id, key FROM roles WHERE id = ?').get(roleId) as { key: string } | undefined;
  if (!role) throw validation('Select a valid role.');

  // Owner-account protection: only an actor whose own role is "owner" may
  // assign the owner role or modify a user that holds it. Prevents a
  // same-privilege administrator from demoting/disabling the clinic owner.
  const isOwnerActor = ctx.session.roleKey === 'owner';
  const targetIsOwner = input.id
    ? (() => {
        const t = ctx.db
          .prepare('SELECT r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.deleted_at IS NULL')
          .get(input.id) as { key: string } | undefined;
        return t?.key === 'owner';
      })()
    : false;
  if (!isOwnerActor && (role.key === 'owner' || targetIsOwner)) {
    throw forbidden('Only the Owner can assign or modify Owner accounts.');
  }

  const minPwLen = minPasswordLengthOf(ctx);

  if (input.id) {
    const existing = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(input.id) as any;
    if (!existing) throw notFound('User not found.');
    const dup = ctx.db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, input.id);
    if (dup) throw conflict(`Username "${username}" is already taken.`);
    const newHash = input.password ? await hashPassword(reqPassword(input.password, minPwLen)) : null;

    tx(ctx.db, () => {
      ctx.db
        .prepare('UPDATE users SET username = ?, display_name = ?, role_id = ?, status = ?, staff_id = ?, updated_at = ? WHERE id = ?')
        .run(username, displayName, roleId, status, input.staffId ?? null, nowISO(), input.id);
      if (newHash) {
        ctx.db
          .prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
          .run(newHash, input.id);
      }
      if (input.permissions && ctx.session.permissions.includes('roles.manage')) {
        ctx.db.prepare('DELETE FROM user_permission_overrides WHERE user_id = ?').run(input.id);
        for (const p of input.permissions) {
          if (!isPermissionKey(p)) throw validation(`Unknown permission "${p}".`);
          const inRole = ctx.db.prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_key = ?').get(roleId, p);
          if (!inRole) {
            ctx.db.prepare('INSERT INTO user_permission_overrides (user_id, permission_key, is_grant) VALUES (?, ?, 1)').run(input.id, p);
          }
        }
      }
      audit(ctx, {
        action: 'user.update', entityType: 'user', entityId: input.id,
        summary: `Updated user ${username}`, before: { status: existing.status, roleId: existing.role_id },
        after: { status, roleId },
      });
    });
    const row = ctx.db.prepare(SELECT_USER.replace('WHERE u.deleted_at IS NULL ORDER BY u.username', 'WHERE u.id = ?')).get(input.id) as any;
    return userDTO(row, loadPermissions(ctx.db, input.id, roleId));
  }

  if (!input.password) throw validation('Password is required for a new user.');
  const passwordHash = await hashPassword(reqPassword(input.password, minPwLen));

  const id = tx(ctx.db, () => {
    try {
      const info = ctx.db
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role_id, staff_id, status, must_change_password, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(username, displayName, passwordHash, roleId, input.staffId ?? null, status, nowISO(), nowISO());
      const userId = Number(info.lastInsertRowid);
      audit(ctx, { action: 'user.create', entityType: 'user', entityId: userId, summary: `Created user ${username} (${input.roleId})` });
      return userId;
    } catch (e: any) {
      if (String(e?.message ?? '').includes('UNIQUE')) throw conflict(`Username "${username}" is already taken.`);
      throw e;
    }
  });
  const row = ctx.db.prepare(SELECT_USER.replace('WHERE u.deleted_at IS NULL ORDER BY u.username', 'WHERE u.id = ?')).get(id) as any;
  return userDTO(row, loadPermissions(ctx.db, id, roleId));
}

export async function resetPassword(ctx: Ctx, userId: number, newPassword: string): Promise<{ ok: boolean }> {
  requirePermission(ctx, 'users.manage');
  const row = ctx.db
    .prepare('SELECT u.id, r.key role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.deleted_at IS NULL')
    .get(userId) as { id: number; role_key: string } | undefined;
  if (!row) throw notFound('User not found.');
  if (row.role_key === 'owner' && ctx.session.roleKey !== 'owner') {
    audit(ctx, {
      action: 'user.reset_password',
      entityType: 'user',
      entityId: userId,
      summary: 'Denied reset of owner password by non-owner',
      result: 'denied',
      reason: 'Only the Owner can reset an Owner account password.',
    });
    throw forbidden('Only the Owner can assign or modify Owner accounts.');
  }
  const hash = await hashPassword(reqPassword(newPassword, minPasswordLengthOf(ctx)));
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
      .run(hash, nowISO(), userId);
    audit(ctx, { action: 'user.reset_password', entityType: 'user', entityId: userId, summary: 'Password reset by administrator' });
  });
  return { ok: true };
}

function reqIntSafe(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw validation('Select a valid role.');
  return n;
}

/* -------------------------------- Roles -------------------------------- */

function roleDTO(ctx: Ctx, r: any): RoleDTO {
  const permissions = ctx.db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all<{ permission_key: string }>(r.id)
    .map((x) => x.permission_key) as PermissionKey[];
  const userCount = Number(ctx.db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ? AND deleted_at IS NULL').get<{ c: number }>(r.id)!.c);
  return { id: r.id, key: r.key, name: r.name, description: r.description, builtin: !!r.builtin, permissions, userCount };
}

export function listRoles(ctx: Ctx): RoleDTO[] {
  requirePermission(ctx, 'users.manage');
  const rows = ctx.db.prepare('SELECT * FROM roles ORDER BY builtin DESC, name').all() as any[];
  return rows.map((r) => roleDTO(ctx, r));
}

export function saveRole(ctx: Ctx, input: { id?: number; key?: string; name: string; description?: string; permissions: PermissionKey[] }): RoleDTO {
  requirePermission(ctx, 'roles.manage');
  const name = reqString(input?.name, 'Role name', { max: 60 });
  const perms = Array.isArray(input?.permissions) ? input.permissions : [];
  for (const p of perms) {
    if (!isPermissionKey(p)) throw validation(`Unknown permission "${p}".`);
  }

  if (input.id) {
    const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(input.id) as any;
    if (!existing) throw notFound('Role not found.');
    if (existing.builtin) {
      const allowed = new Set(BUILTIN_ROLES[existing.key]?.permissions ?? []);
      for (const p of perms) if (!allowed.has(p)) throw validation(`Built-in role "${existing.name}" cannot be granted "${p}".`);
      if (perms.length === 0) throw validation('Built-in roles must keep at least their standard permissions.');
    }
    tx(ctx.db, () => {
      ctx.db.prepare('UPDATE roles SET name = ?, description = ? WHERE id = ?')
        .run(name, optString(input.description, 'Description', { max: 400 }), input.id);
      if (existing.builtin) {
        // Built-ins: only allow tightening? Keep grants as designed — restore standard set.
        const std = BUILTIN_ROLES[existing.key]?.permissions ?? perms;
        ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(input.id);
        const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
        for (const p of std) ins.run(input.id, p);
      } else {
        ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(input.id);
        const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
        for (const p of perms) ins.run(input.id, p);
      }
      audit(ctx, { action: 'role.update', entityType: 'role', entityId: input.id, summary: `Updated role ${name}`, after: { permissions: perms.length } });
    });
    const row = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(input.id) as any;
    return roleDTO(ctx, row);
  }

  const key = reqString(input.key ?? name.toLowerCase().replace(/\W+/g, '_'), 'Role key', { max: 60 }).toLowerCase();
  const dup = ctx.db.prepare('SELECT id FROM roles WHERE key = ? OR name = ?').get(key, name);
  if (dup) throw conflict(`A role named "${name}" already exists.`);
  const id = tx(ctx.db, () => {
    const info = ctx.db.prepare('INSERT INTO roles (key, name, description, builtin, created_at) VALUES (?, ?, ?, 0, ?)')
      .run(key, name, optString(input.description, 'Description', { max: 400 }), nowISO());
    const roleId = Number(info.lastInsertRowid);
    const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const p of perms) ins.run(roleId, p);
    audit(ctx, { action: 'role.create', entityType: 'role', entityId: roleId, summary: `Created role ${name}`, after: { permissions: perms } });
    return roleId;
  });
  const row = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  return roleDTO(ctx, row);
}

export function removeRole(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'roles.manage');
  const existing = ctx.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as any;
  if (!existing) throw notFound('Role not found.');
  if (existing.builtin) throw conflict('Built-in roles cannot be deleted.');
  const users = Number(ctx.db.prepare('SELECT COUNT(*) c FROM users WHERE role_id = ? AND deleted_at IS NULL').get<{ c: number }>(id)!.c);
  if (users > 0) throw conflict(`Role is in use by ${users} user(s). Reassign them first.`);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    audit(ctx, { action: 'role.delete', entityType: 'role', entityId: id, summary: `Deleted role ${existing.name}` });
  });
  return { ok: true };
}

/* -------------------------------- Audit -------------------------------- */

export function listAudit(ctx: Ctx, filter: { page?: number; pageSize?: number; action?: string; userId?: number; from?: string; to?: string; query?: string } = {}): Paged<AuditEntry> {
  requirePermission(ctx, 'audit.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.action) {
    if (filter.action === 'billing.') {
      where.push("(action LIKE 'billing.%' OR action LIKE 'invoice.%')");
    } else if (filter.action.endsWith('.')) {
      where.push("action LIKE ? ESCAPE '\\'");
      params.push(`${escapeLike(filter.action)}%`);
    } else {
      where.push('action = ?');
      params.push(filter.action);
    }
  }
  if (filter.userId) { where.push('user_id = ?'); params.push(filter.userId); }
  if (filter.from) { where.push('at >= ?'); params.push(`${filter.from}T00:00:00.000Z`); }
  if (filter.to) { where.push('at <= ?'); params.push(`${filter.to}T23:59:59.999Z`); }
  if (filter.query?.trim()) {
    const q = `%${escapeLike(filter.query.trim().toLowerCase())}%`;
    where.push("(LOWER(summary) LIKE ? ESCAPE '\\' OR LOWER(username) LIKE ? ESCAPE '\\' OR LOWER(action) LIKE ? ESCAPE '\\')");
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM audit_log ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`SELECT id, at, user_id, username, action, entity_type, entity_id, summary, result, reason FROM audit_log ${whereSql} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as any[];
  return {
    items: rows.map((r) => ({
      id: r.id, at: r.at, userId: r.user_id, username: r.username, action: r.action,
      entityType: r.entity_type, entityId: r.entity_id, summary: r.summary,
      result: r.result, reason: r.reason,
    })),
    total, page, pageSize,
  };
}
