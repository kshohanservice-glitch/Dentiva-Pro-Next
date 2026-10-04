/**
 * Phase B — RBAC persona matrix (§34) + persona audits (§9).
 *
 * Two layers:
 *  1. Static matrix invariants: each builtin role MUST NOT carry critical
 *     permission classes (financial/salary/user-management/destructive/audit/
 *     backup) unless the persona is supposed to hold them.
 *  2. Live service-layer probes: for each persona, forbidden calls THROW at
 *     the service layer (UI hiding is bypassable) and allowed calls work.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import type { Ctx } from '../../src/main/core/context';
import { BUILTIN_ROLES, ALL_PERMISSIONS, type PermissionKey } from '../../src/shared/permissions';
import { createPatient } from '../../src/main/services/patients';
import { createVisit } from '../../src/main/services/visits';
import { setChart } from '../../src/main/services/chart';
import { createPrescription } from '../../src/main/services/prescriptions';
import { createInvoice, createPayment } from '../../src/main/services/billing';
import { addExpense } from '../../src/main/services/accounting';
import { saveItem, stockOperation } from '../../src/main/services/inventory';
import { saveTreatment, setTreatmentActive } from '../../src/main/services/treatments';
import { saveStaff } from '../../src/main/services/staff';
import { saveSettings, resetBusiness } from '../../src/main/services/settings';
import { listAudit, saveRole, removeRole, saveUser } from '../../src/main/services/users';
import { createAppointment, cancelAppointment } from '../../src/main/services/appointments';
import { addQueueEntry } from '../../src/main/services/queue';
import { runReport } from '../../src/main/services/reports';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('rbac-personas');
});

afterEach(() => {
  cleanupEnv(env);
});

function persona(roleKey: string): Ctx {
  const role = BUILTIN_ROLES[roleKey];
  expect(role, `builtin role ${roleKey}`).toBeTruthy();
  return {
    db: env.db,
    paths: env.paths,
    session: sessionWith([...role.permissions] as PermissionKey[], {
      roleKey,
      userId: 1,
      username: roleKey,
    }),
  };
}

/** Permission classes each persona must NOT hold (§34 matrix invariants). */
const DENY: Record<string, string[]> = {
  dentist: [
    'finance.view', 'accounting.view', 'accounting.manage', 'users.manage', 'roles.manage',
    'backup.create', 'backup.restore', 'audit.view', 'staff.salary.view', 'settings.manage',
    'billing.invoice.create', 'billing.payment.create', 'billing.payment.refund',
    'billing.invoice.void', 'data.delete', 'patients.delete', 'appointments.override',
    'inventory.manage', 'treatments.manage', 'staff.manage',
  ],
  assistant: [
    'finance.view', 'accounting.view', 'accounting.manage', 'users.manage', 'roles.manage',
    'backup.create', 'backup.restore', 'audit.view', 'staff.salary.view', 'settings.manage',
    'billing.invoice.view', 'billing.invoice.create', 'billing.payment.view', 'billing.payment.create',
    'clinical.prescription.create', 'clinical.visit.edit', 'patients.sensitive',
    'appointments.override', 'inventory.manage', 'data.delete', 'patients.delete',
  ],
  receptionist: [
    'clinical.visit.create', 'clinical.chart.edit', 'clinical.prescription.create',
    'clinical.referral.manage', 'accounting.view', 'accounting.manage', 'users.manage',
    'roles.manage', 'backup.create', 'backup.restore', 'audit.view', 'staff.salary.view',
    'staff.manage', 'settings.manage', 'billing.invoice.void', 'billing.payment.refund',
    'treatments.manage', 'inventory.manage', 'patients.delete', 'data.delete',
  ],
  accountant: [
    'clinical.view', 'clinical.visit.create', 'clinical.chart.edit', 'clinical.prescription.create',
    'patients.create', 'patients.edit', 'patients.delete', 'patients.sensitive',
    'users.manage', 'roles.manage', 'backup.create', 'backup.restore', 'audit.view',
    'staff.salary.view', 'staff.manage', 'settings.manage', 'billing.invoice.create',
    'billing.invoice.edit', 'treatments.manage', 'inventory.manage', 'data.delete',
    'appointments.manage', 'queue.manage',
  ],
  inventory_manager: [
    'finance.view', 'accounting.manage', 'billing.invoice.view', 'billing.payment.view',
    'billing.payment.create', 'users.manage', 'roles.manage', 'backup.create', 'backup.restore',
    'audit.view', 'staff.salary.view', 'staff.manage', 'settings.manage',
    'clinical.view', 'clinical.visit.create', 'clinical.chart.edit', 'clinical.prescription.create',
    'appointments.view', 'appointments.manage', 'queue.view', 'queue.manage',
    'patients.create', 'patients.edit', 'data.delete',
  ],
  // administrator: operational powers by design; owner-only behaviours are
  // probed live below (resetBusiness role guard) — see ISS-010 for owner account.
  administrator: [],
};

describe('RBAC matrix §34: role permission invariants', () => {
  it('every builtin role is a subset of the permission catalog', () => {
    const catalog = new Set<string>(ALL_PERMISSIONS);
    for (const [key, role] of Object.entries(BUILTIN_ROLES)) {
      for (const p of role.permissions) {
        expect(catalog.has(p), `${key} grants unknown permission ${p}`).toBe(true);
      }
    }
  });

  it('personas do not carry forbidden permission classes', () => {
    for (const [roleKey, forbidden] of Object.entries(DENY)) {
      const held = new Set<string>(BUILTIN_ROLES[roleKey].permissions);
      for (const p of forbidden) {
        expect(held.has(p), `${roleKey} must not hold ${p}`).toBe(false);
      }
    }
  });

  it('owner holds the entire catalog; administrator covers operational criticals', () => {
    expect(BUILTIN_ROLES.owner.permissions).toHaveLength(ALL_PERMISSIONS.length);
    const admin = new Set<string>(BUILTIN_ROLES.administrator.permissions);
    for (const p of ['users.manage', 'roles.manage', 'backup.restore', 'data.delete', 'audit.view', 'finance.view', 'settings.manage']) {
      expect(admin.has(p), `administrator needs ${p}`).toBe(true);
    }
  });
});

/* ---------------------- live service-layer probes ------------------------ */

interface Fixtures {
  patient: { id: number };
  dentistId: number;
  treatment: { id: number };
  item: { id: number };
  invoice: { id: number };
  catId: number;
  appt: { id: number };
}

function fixtures(): Fixtures {
  const owner = ownerCtx(env);
  const patient = createPatient(owner, {
    name: 'Persona Patient', gender: 'female', ageYears: 28, phone: '01755550001', forceCreate: true,
  });
  const now = new Date().toISOString();
  const dentistId = Number(env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Persona', NULL, 1, ?, ?)")
    .run(now, now).lastInsertRowid);
  const treatment = saveTreatment(owner, { code: 'PSN', name: 'Persona treatment', defaultPricePaisa: 50000 });
  const item = saveItem(owner, { code: 'PSN-1', name: 'Persona item', minLevel: 1 });
  const invoice = createInvoice(owner, {
    patientId: patient.id, date: '2026-09-20',
    items: [{ description: 'Consult', qty: 1, unitPricePaisa: 100000 }],
  });
  const catId = Number(env.db
    .prepare("INSERT INTO account_categories (kind, name) VALUES ('expense', 'Persona cat')")
    .run().lastInsertRowid);
  const appt = createAppointment(owner, {
    patientId: patient.id, dentistId, date: '2026-09-25', time: '09:00', durationMin: 30, type: 'consultation',
  });
  return { patient, dentistId, treatment, item, invoice, catId, appt };
}

function dentistRoleId(): number {
  return Number((env.db.prepare("SELECT id FROM roles WHERE key = 'dentist'").get() as any).id);
}

function denyUserPayload() {
  return { username: 'x', displayName: 'X', roleId: dentistRoleId(), password: 'longenoughPW1' } as any;
}

describe('persona live probes (service layer, not UI)', () => {
  it('receptionist: front-desk allowed, clinical/financial-admin/backup denied', async () => {
    const f = fixtures();
    const r = persona('receptionist');
    // allowed
    expect(() => createInvoice(r, {
      patientId: f.patient.id, date: '2026-09-21',
      items: [{ description: 'X', qty: 1, unitPricePaisa: 10000 }],
    })).not.toThrow();
    expect(() => createPayment(r, {
      invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 10000, method: 'cash',
    })).not.toThrow();
    expect(() => addQueueEntry(r, { patientId: f.patient.id })).not.toThrow();
    // denied
    expect(() => createVisit(r, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-21T10:00' } as any)).toThrow(/permission/i);
    expect(() => setChart(r, f.patient.id, { changes: [{ tooth: '11', condition: 'caries', action: 'set' }] })).toThrow(/permission/i);
    expect(() => createPrescription(r, { patientId: f.patient.id, dentistId: f.dentistId, date: '2026-09-21', items: [{ medicineName: 'M' }] } as any)).toThrow(/permission/i);
    expect(() => addExpense(r, { date: '2026-09-21', amountPaisa: 100, categoryId: f.catId })).toThrow(/permission/i);
    expect(() => createPayment(r, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 100, method: 'cash', type: 'refund' } as any)).toThrow(/permission/i);
    expect(() => saveItem(r, { code: 'NO', name: 'No' })).toThrow(/permission/i);
    expect(() => saveStaff(r, { name: 'No' })).toThrow(/permission/i);
    expect(() => saveSettings(r, { clinic: { clinicName: 'H' } } as any)).toThrow(/permission/i);
    expect(() => listAudit(r)).toThrow(/permission/i);
    await expect(saveUser(r, denyUserPayload())).rejects.toThrow(/permission/i);
    expect(() => saveRole(r, { key: 'rogue', name: 'Rogue', permissions: [] } as any)).toThrow(/permission/i);
    expect(() => runReport(r, 'profit_loss', { from: '2026-09-01', to: '2026-09-30' })).toThrow(/permission/i);
    await expect(resetBusiness(r, { typedConfirm: 'x', password: 'x' }, async () => 'b.dpv')).rejects.toThrow(/permission|Owner/i);
  });

  it('dentist: clinical allowed, money/admin/backup denied', async () => {
    const f = fixtures();
    const d = persona('dentist');
    expect(() => createVisit(d, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-22T10:00' } as any)).not.toThrow();
    expect(() => setChart(d, f.patient.id, { changes: [{ tooth: '21', condition: 'caries', action: 'set' }] })).not.toThrow();
    expect(() => createPrescription(d, { patientId: f.patient.id, dentistId: f.dentistId, date: '2026-09-22', items: [{ medicineName: 'M' }] } as any)).not.toThrow();
    expect(() => createPayment(d, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 5000, method: 'cash' })).toThrow(/permission/i);
    expect(() => addExpense(d, { date: '2026-09-22', amountPaisa: 100, categoryId: f.catId })).toThrow(/permission/i);
    expect(() => saveItem(d, { code: 'NO', name: 'No' })).toThrow(/permission/i);
    expect(() => saveSettings(d, { clinic: { clinicName: 'H' } } as any)).toThrow(/permission/i);
    expect(() => listAudit(d)).toThrow(/permission/i);
    await expect(saveUser(d, denyUserPayload())).rejects.toThrow(/permission/i);
    await expect(resetBusiness(d, { typedConfirm: 'x', password: 'x' }, async () => 'b.dpv')).rejects.toThrow(/permission|Owner/i);
  });

  it('accountant: money allowed, clinical/admin denied', async () => {
    const f = fixtures();
    const a = persona('accountant');
    expect(() => addExpense(a, { date: '2026-09-23', amountPaisa: 25000, categoryId: f.catId })).not.toThrow();
    expect(() => createPayment(a, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 20000, method: 'bank' })).not.toThrow();
    expect(() => createPayment(a, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 5000, method: 'cash', type: 'refund' } as any)).not.toThrow();
    expect(() => createVisit(a, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-23T10:00' } as any)).toThrow(/permission/i);
    expect(() => createPrescription(a, { patientId: f.patient.id, dentistId: f.dentistId, date: '2026-09-23', items: [{ medicineName: 'M' }] } as any)).toThrow(/permission/i);
    expect(() => createPatient(a, { name: 'No', gender: 'male', ageYears: 30, phone: '01700000000', forceCreate: true })).toThrow(/permission/i);
    expect(() => saveItem(a, { code: 'NO', name: 'No' })).toThrow(/permission/i);
    await expect(saveUser(a, denyUserPayload())).rejects.toThrow(/permission/i);
    expect(() => listAudit(a)).toThrow(/permission/i);
    expect(() => saveSettings(a, { clinic: { clinicName: 'H' } } as any)).toThrow(/permission/i);
  });

  it('inventory manager: stock allowed, clinical/money/admin denied', async () => {
    const f = fixtures();
    const m = persona('inventory_manager');
    expect(() => saveItem(m, { code: 'NEW-1', name: 'New stock' })).not.toThrow();
    expect(() => stockOperation(m, { itemId: f.item.id, type: 'in', qty: 5 } as any)).not.toThrow();
    expect(() => createVisit(m, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-24T10:00' } as any)).toThrow(/permission/i);
    expect(() => createPayment(m, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 100, method: 'cash' })).toThrow(/permission/i);
    expect(() => addExpense(m, { date: '2026-09-24', amountPaisa: 100, categoryId: f.catId })).toThrow(/permission/i);
    await expect(saveUser(m, denyUserPayload())).rejects.toThrow(/permission/i);
    expect(() => listAudit(m)).toThrow(/permission/i);
  });

  it('assistant: flow allowed, prescriptions-create/money/admin denied', async () => {
    const f = fixtures();
    const s = persona('assistant');
    expect(() => createVisit(s, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-24T11:00' } as any)).not.toThrow();
    expect(() => createPrescription(s, { patientId: f.patient.id, dentistId: f.dentistId, date: '2026-09-24', items: [{ medicineName: 'M' }] } as any)).toThrow(/permission/i);
    expect(() => createPayment(s, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 100, method: 'cash' })).toThrow(/permission/i);
    expect(() => stockOperation(s, { itemId: f.item.id, type: 'out', qty: 1 } as any)).toThrow(/permission/i);
    await expect(saveUser(s, denyUserPayload())).rejects.toThrow(/permission/i);
    expect(() => saveSettings(s, { clinic: { clinicName: 'H' } } as any)).toThrow(/permission/i);
  });

  it('administrator: operational powers allowed, owner-only reset denied', async () => {
    const f = fixtures();
    const adm = persona('administrator');
    expect(() => createPayment(adm, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 1000, method: 'cash' })).not.toThrow();
    expect(() => saveSettings(adm, { clinic: { clinicName: 'Admin Clinic' } } as any)).not.toThrow();
    expect(listAudit(adm).items.length).toBeGreaterThanOrEqual(0);
    await expect(saveUser(adm, { username: 'newstaff', displayName: 'New', roleId: dentistRoleId(), password: 'longenoughPW1' } as any)).resolves.toBeTruthy();
    // reset business is owner-ROLE-only: denied even with data.delete
    await expect(resetBusiness(adm, { typedConfirm: 'x', password: 'x' }, async () => 'b.dpv')).rejects.toThrow(/Owner/i);
  });

  it('unauthorized (no permissions) is denied on every destructive/financial/backup/audit path', async () => {
    const f = fixtures();
    const nobody: Ctx = { db: env.db, paths: env.paths, session: sessionWith([]) };
    const denials: Array<[string, () => unknown]> = [
      ['invoice', () => createInvoice(nobody, { patientId: f.patient.id, date: '2026-09-25', items: [] })],
      ['payment', () => createPayment(nobody, { invoiceId: f.invoice.id, patientId: f.patient.id, amountPaisa: 100, method: 'cash' })],
      ['expense', () => addExpense(nobody, { date: '2026-09-25', amountPaisa: 100, categoryId: f.catId })],
      ['visit', () => createVisit(nobody, { patientId: f.patient.id, dentistId: f.dentistId, datetime: '2026-09-25T10:00' } as any)],
      ['rx', () => createPrescription(nobody, { patientId: f.patient.id, dentistId: f.dentistId, date: '2026-09-25', items: [{ medicineName: 'M' }] } as any)],
      ['stock', () => stockOperation(nobody, { itemId: f.item.id, type: 'out', qty: 1 } as any)],
      ['treatment', () => setTreatmentActive(nobody, f.treatment.id, false)],
      ['staff', () => saveStaff(nobody, { name: 'X' })],
      ['settings', () => saveSettings(nobody, { clinic: { clinicName: 'X' } } as any)],
      ['audit', () => listAudit(nobody)],
      ['role', () => saveRole(nobody, { key: 'r', name: 'R', permissions: [] } as any)],
      ['role-delete', () => removeRole(nobody, dentistRoleId())],
      ['appointment', () => cancelAppointment(nobody, f.appt.id)],
      ['report', () => runReport(nobody, 'daily_summary', {})],
    ];
    for (const [name, call] of denials) {
      expect(call, `unauthorized must be denied on ${name}`).toThrow(/permission/i);
    }
    await expect(saveUser(nobody, denyUserPayload()), 'unauthorized saveUser').rejects.toThrow(/permission/i);
    await expect(
      resetBusiness(nobody, { typedConfirm: 'x', password: 'x' }, async () => 'b.dpv'),
      'unauthorized reset',
    ).rejects.toThrow(/permission/i);
  });
});
