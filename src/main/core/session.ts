import type { DB } from '../db/database';
import type { SessionUser } from '../../shared/types';
import { authError } from '../errors';
import { audit } from './context';
import { loadSessionUser, login as svcLogin, type SecurityPolicy } from '../services/auth';
import { verifyPassword } from './passwords';

export interface SessionManagerDeps {
  db: () => DB;
  securityPolicy: () => SecurityPolicy;
  onLock: () => void;
}

/**
 * Main-process authority for authentication state, lock state and idle auto-lock.
 * The renderer never decides whether it is authenticated.
 */
export class SessionManager {
  private user: SessionUser | null = null;
  private locked = false;
  private lastActivity = Date.now();
  private timer: NodeJS.Timeout | null = null;
  private autoLockProvider: () => number | null = () => 10;

  constructor(private readonly deps: SessionManagerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkIdle(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setAutoLockProvider(fn: () => number | null): void {
    this.autoLockProvider = fn;
  }

  private checkIdle(): void {
    if (!this.user || this.locked) return;
    const minutes = this.autoLockProvider();
    if (minutes === null || minutes <= 0) return;
    if (Date.now() - this.lastActivity > minutes * 60_000) {
      this.lock();
    }
  }

  async signIn(username: string, password: string): Promise<ReturnType<typeof svcLogin>> {
    const result = await svcLogin(this.deps.db(), username, password, this.deps.securityPolicy());
    if (result.ok) {
      this.user = result.user;
      this.locked = false;
      this.touch();
    }
    return result;
  }

  signOut(): void {
    this.user = null;
    this.locked = false;
  }

  lock(): void {
    if (!this.user) return;
    if (this.locked) return;
    this.locked = true;
    this.deps.onLock();
  }

  async unlock(password: string): Promise<boolean> {
    if (!this.user) return false;
    const row = this.deps.db()
      .prepare('SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL')
      .get<{ password_hash: string }>(this.user.userId);
    if (!row) return false;
    const ok = await verifyPassword(row.password_hash, String(password ?? ''));
    if (ok) {
      this.locked = false;
      this.touch();
      return true;
    }
    if (this.user) {
      audit({ db: this.deps.db(), session: this.user }, {
        action: 'auth.unlock', entityType: 'user', entityId: this.user.userId,
        summary: `Failed unlock attempt for "${this.user.username}"`, result: 'denied',
      });
    }
    return false;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Throws when there is no live, unlocked session — used by every protected IPC handler. */
  require(): SessionUser {
    if (!this.user) throw authError('Please sign in to continue.');
    if (this.locked) throw authError('Application is locked.');
    const fresh = loadSessionUser(this.deps.db(), this.user.userId);
    this.user = fresh;
    return fresh;
  }

  current(): SessionUser | null {
    if (!this.user || this.locked) return null;
    return this.user;
  }
}
