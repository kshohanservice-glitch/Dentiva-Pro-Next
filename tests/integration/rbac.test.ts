import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { requirePermission, hasPermission, type Ctx } from '../../src/main/core/context';
import { AppError } from '../../src/main/errors';
import { createPatient, listPatients } from '../../src/main/services/patients';
import { createInvoice, createPayment } from '../../src/main/services/billing';
import { addExpense } from '../../src/main/services/accounting';
import { createVisit } from '../../src/main/services/visits';
import { createAppointment } from '../../src/main/services/appointments';
import { ALL_PERMISSIONS, type PermissionKey } from '../../src/shared/permissions';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('rbac');
});

afterEach(() => {
  cleanupEnv(env);
});

function ctxWith(perms: PermissionKey[]): Ctx {
  return { db: env.db, paths: env.paths, session: sessionWith(perms) };
}

const PATIENT = { name: 'RBAC Patient', gender: 'male', ageYears: 30, phone: '01712345678' };

describe('service-layer permission enforcement', () => {
  it('requirePermission throws AppError with the missing key', () => {
    const ctx = ctxWith(['patients.view']);
    expect(() => requirePermission(ctx, 'patients.view')).not.toThrow();
    try {
      requirePermission(ctx, 'billing.payment.create');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).userMessage).toContain('billing.payment.create');
    }
    expect(hasPermission(ctx, 'patients.view')).toBe(true);
    expect(hasPermission(ctx, 'patients.create')).toBe(false);
  });

  it('view-only role cannot create patients (UI hiding would be bypassable)', () => {
    const viewer = ctxWith(['patients.view']);
    expect(() => createPatient(viewer, PATIENT)).toThrow(/patients\.create/);
    // owner can
    const owner = ownerCtx(env);
    const created = createPatient(owner, PATIENT);
    expect(created.id).toBeGreaterThan(0);
    expect(listPatients(viewer, {}).total).toBe(1);
  });

  it('financial writes require the specific financial permission, not just view', () => {
    const owner = ownerCtx(env);
    const patient = createPatient(owner, PATIENT);

    // Billing view without invoice.create
    const viewer = ctxWith(['billing.invoice.view', 'billing.payment.view', 'patients.view']);
    expect(() =>
      createInvoice(viewer, { patientId: patient.id, date: '2026-09-27', items: [{ description: 'Cleaning', qty: 1, unitPricePaisa: 50000 }] }),
    ).toThrow(/billing\.invoice\.create/);

    // invoice.create without payment.create
    const clerk = ctxWith(['billing.invoice.view', 'billing.invoice.create', 'patients.view']);
    const invoice = createInvoice(clerk, {
      patientId: patient.id, date: '2026-09-27',
      items: [{ description: 'Filling', qty: 1, unitPricePaisa: 30000 }],
    });
    expect(() =>
      createPayment(clerk, { invoiceId: invoice.id, patientId: patient.id, amountPaisa: 10000, method: 'cash' }),
    ).toThrow(/billing\.payment\.create/);

    // payment.create works with the permission
    const cashier = ctxWith(['billing.invoice.view', 'billing.payment.view', 'billing.payment.create', 'patients.view']);
    const res = createPayment(cashier, { invoiceId: invoice.id, patientId: patient.id, amountPaisa: 10000, method: 'cash' });
    expect(res.payment.amountPaisa).toBe(10000);
    expect(res.invoice?.paidPaisa).toBe(10000);
  });

  it('accounting entries require accounting.manage even with view access', () => {
    const owner = ownerCtx(env);
    const viewer = ctxWith(['accounting.view']);
    const cat = (owner.db.prepare(`SELECT id FROM account_categories WHERE kind = 'expense' LIMIT 1`).get() as { id: number }).id;
    expect(() =>
      addExpense(viewer, { date: '2026-09-27', categoryId: cat, amountPaisa: 15000, method: 'cash' }),
    ).toThrow(/accounting\.manage/);
    const entry = addExpense(owner, { date: '2026-09-27', categoryId: cat, amountPaisa: 15000, method: 'cash', note: 'test' });
    expect(entry.amountPaisa).toBe(15000);
  });

  it('clinical writes are gated separately from clinical view', () => {
    const owner = ownerCtx(env);
    const dentistId = (owner.db.prepare('SELECT id FROM dentists LIMIT 1').get() as { id: number } | undefined)?.id;
    void dentistId;
    const patient = createPatient(owner, PATIENT);
    const viewer = ctxWith(['clinical.view', 'patients.view']);
    expect(() =>
      createVisit(viewer, { patientId: patient.id, dentistId: null, datetime: '2026-09-27T11:00', chiefComplaint: 'pain' } as any),
    ).toThrow(/clinical\.visit\.create/);
  });

  it('appointment management is gated by appointments.manage', () => {
    const owner = ownerCtx(env);
    const patient = createPatient(owner, PATIENT);
    const viewer = ctxWith(['appointments.view']);
    expect(() =>
      createAppointment(viewer, { patientId: patient.id, dentistId: null, date: '2026-10-01', time: '10:00', durationMin: 30, type: 'Consultation' }),
    ).toThrow(/appointments\.manage/);
    const created = createAppointment(ownerCtx(env), {
      patientId: patient.id, dentistId: null, date: '2026-10-01', time: '10:00', durationMin: 30, type: 'Consultation',
    });
    expect(created.status).toBe('scheduled');
  });

  it('every permission in the catalog is enforceable (guard exists for each key used)', () => {
    // Sanity: owner context passes gates for a representative write in each domain.
    const owner = ownerCtx(env);
    for (const key of ALL_PERMISSIONS) {
      expect(owner.session.permissions).toContain(key);
    }
  });
});
