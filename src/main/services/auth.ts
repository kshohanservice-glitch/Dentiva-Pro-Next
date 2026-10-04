import type { DB } from '../db/database';
import type { PermissionKey } from '../../shared/permissions';
import type { SessionUser } from '../../shared/types';
import type { LoginResult } from '../../shared/ipc';
import type { AppPaths } from '../paths';
import { authError, validation, conflict } from '../errors';
import { audit, tx } from '../core/context';
import { dummyVerify, hashPassword, verifyPassword } from '../core/passwords';
import { reqPassword, reqString, reqUsername, optString } from '../core/validate';

interface UserRow {
  id: number; username: string; display_name: string; password_hash: string;
  role_id: number; staff_id: number | null; status: string;
  failed_attempts: number; locked_until: string | null;
}

export function countUsers(db: DB): number {
  return Number(db.prepare('SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL').get<{ c: number }>()!.c);
}

export function needsSetup(db: DB): boolean {
  return countUsers(db) === 0;
}

export function loadPermissions(db: DB, userId: number, roleId: number): PermissionKey[] {
  const rolePerms = db
    .prepare('SELECT permission_key FROM role_permissions WHERE role_id = ?')
    .all<{ permission_key: string }>(roleId)
    .map((r) => r.permission_key);
  const overrides = db
    .prepare('SELECT permission_key, is_grant FROM user_permission_overrides WHERE user_id = ?')
    .all<{ permission_key: string; is_grant: number }>(userId);
  const set = new Set<string>(rolePerms);
  for (const o of overrides) {
    if (o.is_grant) set.add(o.permission_key);
    else set.delete(o.permission_key);
  }
  return [...set] as PermissionKey[];
}

export function loadSessionUser(db: DB, userId: number): SessionUser {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role_id, u.staff_id, r.name role_name, r.key role_key
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
    )
    .get<{ id: number; username: string; display_name: string; role_id: number; staff_id: number | null; role_name: string; role_key: string }>(userId);
  if (!row) throw authError('User account not found.');
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    roleName: row.role_name,
    roleKey: row.role_key,
    staffId: row.staff_id,
    permissions: loadPermissions(db, row.id, row.role_id),
  };
}

export interface SecurityPolicy { maxFailedLogins: number; minPasswordLength: number }

export async function login(db: DB, username: string, password: string, policy: SecurityPolicy): Promise<LoginResult & { userId?: number }> {
  const uname = String(username ?? '').trim().toLowerCase();
  const pass = String(password ?? '');
  if (!uname || !pass) return { ok: false, reason: 'bad_credentials' };

  const row = db
    .prepare(
      `SELECT id, username, display_name, password_hash, role_id, staff_id, status, failed_attempts, locked_until
       FROM users WHERE username = ? AND deleted_at IS NULL`,
    )
    .get(uname) as UserRow | undefined;

  if (!row) {
    await dummyVerify(pass);
    audit({ db }, { action: 'auth.login', entityType: 'user', entityId: null, summary: `Failed login for unknown user "${uname}"`, result: 'denied' });
    return { ok: false, reason: 'bad_credentials' };
  }

  const now = Date.now();
  if (row.locked_until && new Date(row.locked_until).getTime() > now) {
    await dummyVerify(pass);
    return { ok: false, reason: 'locked', retryAfterMs: new Date(row.locked_until).getTime() - now };
  }
  if (row.status === 'disabled') {
    await dummyVerify(pass);
    audit({ db }, { action: 'auth.login', entityType: 'user', entityId: row.id, summary: `Login blocked: account disabled (${row.username})`, result: 'denied' });
    return { ok: false, reason: 'disabled' };
  }

  const valid = await verifyPassword(row.password_hash, pass);
  if (!valid) {
    const failures = row.failed_attempts + 1;
    const lockedUntil =
      failures >= policy.maxFailedLogins ? new Date(now + 5 * 60 * 1000).toISOString() : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?')
      .run(failures, lockedUntil, new Date().toISOString(), row.id);
    audit({ db }, {
      action: 'auth.login', entityType: 'user', entityId: row.id,
      summary: `Failed login for "${row.username}" (attempt ${failures})${lockedUntil ? ' — account temporarily locked' : ''}`,
      result: 'denied',
    });
    if (lockedUntil) return { ok: false, reason: 'locked', retryAfterMs: 5 * 60 * 1000 };
    return { ok: false, reason: 'bad_credentials' };
  }

  if (row.status === 'locked') {
    audit({ db }, { action: 'auth.login', entityType: 'user', entityId: row.id, summary: `Login blocked: account locked (${row.username})`, result: 'denied' });
    return { ok: false, reason: 'disabled' };
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?')
    .run(new Date().toISOString(), new Date().toISOString(), row.id);

  const sessionUser = loadSessionUser(db, row.id);
  const ctx = { db, session: sessionUser };
  audit(ctx, { action: 'auth.login', entityType: 'user', entityId: row.id, summary: `Signed in as ${row.username}` });
  return { ok: true, user: sessionUser, userId: row.id };
}

export async function changePassword(db: DB, session: SessionUser, oldPassword: string, newPassword: string, minLen: number): Promise<void> {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get<{ password_hash: string }>(session.userId);
  if (!row) throw authError('User account not found.');
  const valid = await verifyPassword(row.password_hash, String(oldPassword ?? ''));
  if (!valid) throw validation('Current password is incorrect.');
  const pass = reqPassword(newPassword, minLen);
  const hash = await hashPassword(pass);
  tx(db, () => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .run(hash, new Date().toISOString(), session.userId);
    audit({ db, session }, { action: 'auth.change_password', entityType: 'user', entityId: session.userId, summary: 'Password changed' });
  });
}

export interface SetupInputInternal {
  clinic: { clinicName: string; address?: string | null; phone?: string | null; email?: string | null; logoPath?: string | null };
  dentists: { name: string; qualifications?: string | null; designations?: string | null; phone?: string | null; email?: string | null; regNo?: string | null }[];
  admin: { username: string; password: string; passwordConfirm: string; displayName?: string };
  preferences: { operatingHours?: string | null; autoLockMinutes?: number; backupDestination?: string | null };
}

/** First-run setup: creates owner account, clinic settings and dentist profiles. */
export async function completeSetup(db: DB, paths: AppPaths, input: SetupInputInternal): Promise<void> {
  if (!needsSetup(db)) {
    throw conflict('Setup has already been completed.');
  }
  const clinicName = reqString(input?.clinic?.clinicName, 'Clinic name', { max: 160 });
  const dentists = Array.isArray(input?.dentists) ? input.dentists : [];
  if (dentists.length === 0) throw validation('At least one dentist is required.');
  for (const d of dentists) reqString(d?.name, 'Dentist name', { max: 120 });

  const username = reqUsername(input?.admin?.username);
  const password = reqPassword(input?.admin?.password);
  if (input.admin.passwordConfirm !== input.admin.password) {
    throw validation('Password confirmation does not match.');
  }
  const displayName = optString(input?.admin?.displayName, 'Display name', { max: 120 }) ?? username;
  const autoLock = input?.preferences?.autoLockMinutes;
  if (autoLock !== undefined && autoLock !== null && ![5, 10, 15, 30].includes(Number(autoLock))) {
    throw validation('Auto-lock must be 5, 10, 15, 30 minutes, or disabled.');
  }

  const passwordHash = await hashPassword(password);

  tx(db, () => {
    if (countUsers(db) !== 0) throw conflict('Setup has already been completed.');

    const ownerRole = db.prepare("SELECT id FROM roles WHERE key = 'owner'").get<{ id: number }>()!;
    const now = new Date().toISOString();

    // Clinic settings
    const clinicRow = db.prepare("SELECT value_json FROM settings WHERE key = 'clinic'").get<{ value_json: string }>();
    const clinic = clinicRow ? JSON.parse(clinicRow.value_json) : {};
    clinic.clinicName = clinicName;
    clinic.address = optString(input.clinic?.address, 'Address', { max: 400 });
    clinic.phone = optString(input.clinic?.phone, 'Phone', { max: 40 });
    clinic.email = optString(input.clinic?.email, 'Email', { max: 160 });
    if (input.clinic?.logoPath) clinic.logoPath = input.clinic.logoPath;
    db.prepare('UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?')
      .run(JSON.stringify(clinic), now, 'clinic');

    if (input.preferences?.operatingHours !== undefined) {
      clinic.operatingHours = optString(input.preferences.operatingHours, 'Operating hours', { max: 120 });
      db.prepare('UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?')
        .run(JSON.stringify(clinic), now, 'clinic');
    }
    if (autoLock !== undefined && autoLock !== null) {
      const secRow = db.prepare("SELECT value_json FROM settings WHERE key = 'security'").get<{ value_json: string }>();
      const sec = secRow ? JSON.parse(secRow.value_json) : {};
      sec.autoLockMinutes = Number(autoLock);
      db.prepare('UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?')
        .run(JSON.stringify(sec), now, 'security');
    }
    if (input.preferences?.backupDestination) {
      const bRow = db.prepare("SELECT value_json FROM settings WHERE key = 'backup'").get<{ value_json: string }>();
      const b = bRow ? JSON.parse(bRow.value_json) : {};
      b.destination = input.preferences.backupDestination;
      db.prepare('UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?')
        .run(JSON.stringify(b), now, 'backup');
    }

    for (const d of dentists) {
      db.prepare(
        `INSERT INTO dentists (name, qualifications, designations, reg_no, phone, email, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).run(
        reqString(d.name, 'Dentist name', { max: 120 }),
        optString(d.qualifications, 'Qualifications', { max: 240 }),
        optString(d.designations, 'Designations', { max: 240 }),
        optString(d.regNo, 'Registration number', { max: 80 }),
        optString(d.phone, 'Phone', { max: 40 }),
        optString(d.email, 'Email', { max: 160 }),
        now, now,
      );
    }

    db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role_id, status, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 0, ?, ?)`,
    ).run(username, displayName, passwordHash, ownerRole.id, now, now);

    void paths;
  });
}
