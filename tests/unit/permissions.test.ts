import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  BUILTIN_ROLES,
  DEFAULT_ROLE_KEYS,
  PERMISSION_GROUPS,
  isPermissionKey,
} from '../../src/shared/permissions';

describe('permission catalog', () => {
  it('has no duplicate permission keys', () => {
    const set = new Set(ALL_PERMISSIONS);
    expect(set.size).toBe(ALL_PERMISSIONS.length);
  });

  it('covers every declared group', () => {
    const groups = new Set(ALL_PERMISSIONS.map((p) => p.split('.')[0]));
    for (const g of groups) {
      expect(PERMISSION_GROUPS).toHaveProperty(g);
    }
  });

  it('validates keys with isPermissionKey', () => {
    expect(isPermissionKey('patients.view')).toBe(true);
    expect(isPermissionKey('patients.teleport')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });

  it('every built-in role grants only known permissions', () => {
    for (const [key, role] of Object.entries(BUILTIN_ROLES)) {
      expect(role.name, key).toBeTruthy();
      expect(role.permissions.length, key).toBeGreaterThan(0);
      for (const p of role.permissions) {
        expect(isPermissionKey(p), `${key} → ${p}`).toBe(true);
      }
      const unique = new Set(role.permissions);
      expect(unique.size, `${key} duplicate grants`).toBe(role.permissions.length);
    }
  });

  it('owner has everything; default roles exist', () => {
    expect(BUILTIN_ROLES.owner.permissions.length).toBe(ALL_PERMISSIONS.length);
    for (const r of DEFAULT_ROLE_KEYS) {
      expect(BUILTIN_ROLES, r).toHaveProperty(r);
    }
  });

  it('financial permissions are distinct from view-only ones', () => {
    // Service-layer financial gates must exist as their own keys so a
    // receptionist with billing.view cannot post payments.
    expect(isPermissionKey('billing.payment.create')).toBe(true);
    expect(isPermissionKey('billing.invoice.void')).toBe(true);
    expect(isPermissionKey('accounting.manage')).toBe(true);
    expect(isPermissionKey('finance.view')).toBe(true);
    expect(isPermissionKey('staff.salary.view')).toBe(true);
    const receptionist = BUILTIN_ROLES.receptionist.permissions;
    // Receptionists may record payments at the desk by design, but never
    // refunds or accounting entries.
    expect(receptionist).toContain('billing.payment.create');
    expect(receptionist).not.toContain('billing.payment.refund');
    expect(receptionist).not.toContain('accounting.manage');
    expect(receptionist).not.toContain('backup.restore');
  });
});
