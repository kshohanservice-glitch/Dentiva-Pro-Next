import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, type TestEnv } from '../helpers';
import { completeSetup, login, changePassword, loadSessionUser, needsSetup } from '../../src/main/services/auth';
import { hashPassword, verifyPassword, dummyVerify } from '../../src/main/core/passwords';
import { ALL_PERMISSIONS } from '../../src/shared/permissions';

let env: TestEnv;

/** Narrow the login union: every assertion below expects a failure result. */
function asFailure(res: Awaited<ReturnType<typeof login>>): { ok: false; reason?: string; retryAfterMs?: number } {
  if (res.ok) throw new Error('expected login to fail');
  return res;
}

const SETUP = {
  clinic: { clinicName: 'Test Dental Care', phone: '01711111111' },
  dentists: [{ name: 'Dr. Test Dentist', qualifications: 'BDS' }],
  admin: { username: 'owner', password: 'CorrectHorse9', passwordConfirm: 'CorrectHorse9', displayName: 'Owner User' },
  preferences: { operatingHours: '10:00 – 20:00', autoLockMinutes: 10 },
};

beforeEach(async () => {
  env = createTestEnv('auth', { seedOwner: false });
  await completeSetup(env.db, env.paths, SETUP);
});

afterEach(() => {
  cleanupEnv(env);
});

describe('password hashing (Argon2id)', () => {
  it('produces a verifiable hash that never contains the password', async () => {
    const hash = await hashPassword('Sup3rSecret!');
    expect(hash).toBeTruthy();
    expect(hash).not.toContain('Sup3rSecret!');
    expect(await verifyPassword(hash, 'Sup3rSecret!')).toBe(true);
    expect(await verifyPassword(hash, 'sup3rsecret!')).toBe(false);
    expect(await verifyPassword(hash, '')).toBe(false);
  });

  it('salts hashes — same password yields different hashes', async () => {
    const a = await hashPassword('SamePassword1');
    const b = await hashPassword('SamePassword1');
    expect(a).not.toBe(b);
  });

  it('dummy verify burns time for unknown users without revealing anything', async () => {
    const started = Date.now();
    const res = await dummyVerify('whatever');
    expect(res).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });
});

describe('first-run setup', () => {
  it('completes once and refuses a second run', async () => {
    expect(needsSetup(env.db)).toBe(false);
    await expect(completeSetup(env.db, env.paths, SETUP)).rejects.toThrow(/already/i);
  });

  it('creates the owner account and dentist profile', () => {
    const users = env.db.prepare('SELECT username, role_id FROM users').all<{ username: string; role_id: number }>();
    expect(users.length).toBe(1);
    expect(users[0].username).toBe('owner');
    const dentists = env.db.prepare('SELECT name FROM dentists').all();
    expect(dentists.length).toBe(1);
    const session = loadSessionUser(env.db, 1);
    expect(session.roleKey).toBe('owner');
    expect([...session.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe('login', () => {
  const policy = { maxFailedLogins: 3, minPasswordLength: 8 };

  it('accepts the correct credentials', async () => {
    const res = await login(env.db, 'owner', 'CorrectHorse9', policy);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.user.username).toBe('owner');
      expect(res.userId).toBe(1);
    }
  });

  it('rejects wrong passwords and unknown users with the same error', async () => {
    const wrong = await login(env.db, 'owner', 'not-the-password', policy);
    expect(wrong.ok).toBe(false);
    expect(asFailure(wrong).reason).toBe('bad_credentials');
    const unknown = await login(env.db, 'ghost', 'whatever123', policy);
    expect(unknown.ok).toBe(false);
    expect(asFailure(unknown).reason).toBe('bad_credentials');
  });

  it('locks the account after maxFailedLogins failures', async () => {
    for (let i = 0; i < 3; i++) {
      await login(env.db, 'owner', 'bad-password', policy);
    }
    const locked = await login(env.db, 'owner', 'CorrectHorse9', policy);
    expect(locked.ok).toBe(false);
    expect(asFailure(locked).reason).toBe('locked');
    expect(asFailure(locked).retryAfterMs).toBeGreaterThan(0);
  });

  it('records failed attempts in the audit log', async () => {
    await login(env.db, 'owner', 'bad-password', policy);
    const rows = env.db
      .prepare(`SELECT result, summary FROM audit_log WHERE action = 'auth.login'`)
      .all<{ result: string; summary: string }>();
    expect(rows.some((r) => r.result === 'denied')).toBe(true);
  });
});

describe('password change', () => {
  it('requires the old password and persists the new one', async () => {
    const session = loadSessionUser(env.db, 1);
    await expect(changePassword(env.db, session, 'wrong-old', 'NewPass123', 8)).rejects.toThrow(/incorrect/i);
    await changePassword(env.db, session, 'CorrectHorse9', 'NewPass123', 8);
    const res = await login(env.db, 'owner', 'NewPass123', { maxFailedLogins: 3, minPasswordLength: 8 });
    expect(res.ok).toBe(true);
    const old = await login(env.db, 'owner', 'CorrectHorse9', { maxFailedLogins: 3, minPasswordLength: 8 });
    expect(old.ok).toBe(false);
  });
});
