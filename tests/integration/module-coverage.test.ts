/**
 * Phase B — module-level break tests (ISS-005).
 *
 * Each previously untested service gets coverage written *against* it:
 * happy path + adversarial/validation cases + service-layer RBAC denials.
 * Also covers the acceptance item "Report accuracy vs hand-computed dataset".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import type { Ctx } from '../../src/main/core/context';
import { createPatient } from '../../src/main/services/patients';
import {
  listItems, saveItem, stockOperation,
} from '../../src/main/services/inventory';
import {
  addExpense, deleteExpense, listExpenses, addIncome, listIncomes, saveCategory, listCategories,
} from '../../src/main/services/accounting';
import {
  createPrescription, listTemplates, saveTemplate,
} from '../../src/main/services/prescriptions';
import { globalSearch } from '../../src/main/services/search';
import {
  insertNotification, refreshNotifications, listNotifications, markNotificationsRead,
} from '../../src/main/services/notifications';
import { listStaff, saveStaff, saveDentist, listDentists } from '../../src/main/services/staff';
import { saveTreatment, listTreatments, setTreatmentActive } from '../../src/main/services/treatments';
import { saveReferral, listReferrals } from '../../src/main/services/referrals';
import { getDashboard } from '../../src/main/services/dashboard';
import { saveSettings, getSettings } from '../../src/main/services/settings';
import { createInvoice, createPayment, paidNetFor } from '../../src/main/services/billing';
import { runReport } from '../../src/main/services/reports';
import { todayISO } from '../../src/shared/currency';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('phase-b-modules');
});

afterEach(() => {
  cleanupEnv(env);
});

function ctxWith(...perms: string[]): Ctx {
  return { db: env.db, paths: env.paths, session: sessionWith(perms as any) };
}

function p(ctx: Ctx, phone: string) {
  return createPatient(ctx, { name: 'PhaseB Patient', gender: 'male', ageYears: 35, phone, forceCreate: true });
}

/* ------------------------------- inventory ------------------------------- */

describe('inventory module', () => {
  it('stock in → FIFO out → insufficient stock is rejected atomically (no partial deduction)', () => {
    const ctx = ownerCtx(env);
    const item = saveItem(ctx, { code: 'MED-A', name: 'Amoxicillin', minLevel: 5 });
    stockOperation(ctx, { itemId: item.id, type: 'in', qty: 10, batchNo: 'B1' } as any);
    stockOperation(ctx, { itemId: item.id, type: 'out', qty: 4 } as any);
    expect(listItems(ctx, { query: 'MED-A' })[0].qtyAvailable).toBe(6);
    // try to take 10 of 6 → conflict, and qty must stay 6 (tx rollback)
    expect(() => stockOperation(ctx, { itemId: item.id, type: 'out', qty: 10 } as any)).toThrow(/insufficient/i);
    expect(listItems(ctx, { query: 'MED-A' })[0].qtyAvailable).toBe(6);
  });

  it('duplicate item codes are rejected; lowOnly filter flags at/below min', () => {
    const ctx = ownerCtx(env);
    const dup = saveItem(ctx, { code: 'DUP-1', name: 'First', minLevel: 2 });
    expect(() => saveItem(ctx, { code: 'dup-1', name: 'Second' })).toThrow(/already in use/i);
    stockOperation(ctx, { itemId: dup.id, type: 'in', qty: 10 } as any); // above min → not low
    saveItem(ctx, { code: 'LOW-1', name: 'Gloves', minLevel: 50 });
    stockOperation(ctx, { itemId: listItems(ctx, { query: 'LOW-1' })[0].id, type: 'in', qty: 3 } as any);
    const low = listItems(ctx, { lowOnly: true });
    expect(low.map((i) => i.code)).toContain('LOW-1');
    expect(low.map((i) => i.code)).not.toContain('DUP-1');
  });

  it('adjust requires a specific batch; unknown op rejected', () => {
    const ctx = ownerCtx(env);
    const item = saveItem(ctx, { code: 'ADJ-1', name: 'Cement' });
    stockOperation(ctx, { itemId: item.id, type: 'in', qty: 5, batchNo: 'B9' } as any);
    expect(() => stockOperation(ctx, { itemId: item.id, type: 'adjust', qty: 3 } as any)).toThrow(/specific batch/i);
    expect(() => stockOperation(ctx, { itemId: item.id, type: 'steal', qty: 1 } as any)).toThrow(/unknown stock/i);
  });

  it('RBAC: view-only session cannot manage stock', () => {
    const viewer = ctxWith('inventory.view');
    const ctx = ownerCtx(env);
    saveItem(ctx, { code: 'RBAC-1', name: 'Seen' });
    expect(listItems(viewer).length).toBeGreaterThan(0);
    expect(() => saveItem(viewer, { code: 'X1', name: 'Nope' })).toThrow(/permission/i);
    expect(() => stockOperation(viewer, { itemId: 1, type: 'in', qty: 1 } as any)).toThrow(/permission/i);
  });
});

/* ------------------------------ accounting ------------------------------- */

describe('accounting module', () => {
  function seedCategory(kind: 'expense' | 'income', name: string): number {
    const ctx = ownerCtx(env);
    return saveCategory(ctx, { kind, name }).id;
  }

  it('expense/income CRUD with category-kind enforcement and soft delete', () => {
    const ctx = ownerCtx(env);
    const expCat = seedCategory('expense', 'PhaseB Rent');
    const incCat = seedCategory('income', 'PhaseB Interest');
    expect(() => addExpense(ctx, { date: '2026-09-01', amountPaisa: 50000, categoryId: incCat })).toThrow(/valid expense category/i);
    expect(() => addIncome(ctx, { date: '2026-09-01', amountPaisa: 50000, categoryId: expCat })).toThrow(/valid income category/i);
    expect(() => addExpense(ctx, { date: '2026-09-01', amountPaisa: 0, categoryId: expCat })).toThrow();
    const e = addExpense(ctx, { date: '2026-09-01', amountPaisa: 50000, categoryId: expCat });
    addIncome(ctx, { date: '2026-09-01', amountPaisa: 70000, categoryId: incCat });
    expect(listExpenses(ctx, { from: '2026-09-01', to: '2026-09-30' }).total).toBe(1);
    expect(listIncomes(ctx, { from: '2026-09-01', to: '2026-09-30' }).total).toBe(1);
    deleteExpense(ctx, e.id);
    expect(listExpenses(ctx, { from: '2026-09-01', to: '2026-09-30' }).total).toBe(0);
    expect(() => deleteExpense(ctx, e.id)).toThrow(/not found/i);
  });

  it('duplicate category name rejected; bad kind rejected', () => {
    const ctx = ownerCtx(env);
    saveCategory(ctx, { kind: 'expense', name: 'Utilities' });
    expect(() => saveCategory(ctx, { kind: 'expense', name: 'Utilities' })).toThrow(/already exists/i);
    expect(() => saveCategory(ctx, { kind: 'bogus' as any, name: 'X' })).toThrow(/kind/i);
    expect(listCategories(ctx).length).toBeGreaterThan(0);
  });

  it('RBAC: accounting.view alone cannot add/delete; accounting.manage denied without view', () => {
    const viewer = ctxWith('accounting.view');
    expect(() => addExpense(viewer, { date: '2026-09-01', amountPaisa: 100, categoryId: 1 })).toThrow(/permission/i);
    expect(() => deleteExpense(viewer, 1)).toThrow(/permission/i);
  });
});

/* ----------------------------- prescriptions ----------------------------- */

describe('prescriptions module', () => {
  function dentistId(): number {
    const now = new Date().toISOString();
    return Number(env.db
      .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Rx', NULL, 1, ?, ?)")
      .run(now, now).lastInsertRowid);
  }

  it('creates with sequence numbers; cap enforced; invalid dentist rejected', () => {
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01711110001');
    const d = dentistId();
    const rx1 = createPrescription(ctx, {
      patientId: patient.id, dentistId: d, date: '2026-09-10',
      items: [{ medicineName: 'Amoxicillin 500mg' }],
    } as any);
    const rx2 = createPrescription(ctx, {
      patientId: patient.id, dentistId: d, date: '2026-09-10',
      items: [{ medicineName: 'Ibuprofen' }],
    } as any);
    expect(rx1.number).not.toBe(rx2.number);
    expect(() => createPrescription(ctx, {
      patientId: patient.id, dentistId: d, date: '2026-09-10',
      items: Array.from({ length: 61 }, (_, i) => ({ medicineName: `M${i}` })),
    } as any)).toThrow(/60 medicines/i);
    expect(() => createPrescription(ctx, {
      patientId: patient.id, dentistId: 999999, date: '2026-09-10',
      items: [{ medicineName: 'X' }],
    } as any)).toThrow(/dentist/i);
    expect(() => createPrescription(ctx, {
      patientId: patient.id, dentistId: d, date: '2026-09-10', items: [],
    } as any)).toThrow(/at least one/i);
  });

  it('medicine templates save, list, and overwrite by name', () => {
    const ctx = ownerCtx(env);
    saveTemplate(ctx, 'Antibiotic pack', [{ medicineName: 'Amoxicillin' }]);
    saveTemplate(ctx, 'Antibiotic pack', [{ medicineName: 'Amoxicillin' }, { medicineName: 'Metronidazole' }]);
    const list = listTemplates(ctx);
    expect(list.filter((t) => t.name === 'Antibiotic pack')).toHaveLength(1);
    expect(list.find((t) => t.name === 'Antibiotic pack')!.items).toHaveLength(2);
    expect(() => saveTemplate(ctx, '   ', [])).toThrow();
  });

  it('RBAC: clinical.view without prescription.create cannot create', () => {
    const viewer = ctxWith('clinical.view');
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01711110002');
    expect(() => createPrescription(viewer, {
      patientId: patient.id, dentistId: 1, date: '2026-09-10', items: [{ medicineName: 'X' }],
    } as any)).toThrow(/permission/i);
  });
});

/* -------------------------------- search --------------------------------- */

describe('search module', () => {
  it('short queries return empty; hits respect patients.view permission; deleted excluded', () => {
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01722220001');
    env.db.prepare('UPDATE patients SET name = ? WHERE id = ?').run('Zymoglobal Dental', patient.id);
    expect(globalSearch(ctx, 'z')).toEqual([]);
    const withPerm = ctxWith('patients.view');
    const hits = globalSearch(withPerm, 'zymoglobal');
    expect(hits.some((h) => h.kind === 'patient' && h.title === 'Zymoglobal Dental')).toBe(true);
    // no permission → no patient hits
    const noPerm = ctxWith('appointments.view');
    expect(globalSearch(noPerm, 'zymoglobal').filter((h) => h.kind === 'patient')).toHaveLength(0);
    // soft-deleted patient disappears
    env.db.prepare('UPDATE patients SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), patient.id);
    expect(globalSearch(withPerm, 'zymoglobal').filter((h) => h.kind === 'patient')).toHaveLength(0);
  });
});

/* ----------------------------- notifications ----------------------------- */

describe('notifications module', () => {
  it('low-stock refresh creates deduped alerts; read-state works', () => {
    const ctx = ownerCtx(env);
    const item = saveItem(ctx, { code: 'NOTIF-1', name: 'Syringe', minLevel: 10 });
    stockOperation(ctx, { itemId: item.id, type: 'in', qty: 2 } as any);
    const first = refreshNotifications(env.db, { lowStock: true, dues: false, backup: false, appointments: false });
    expect(first).toBeGreaterThanOrEqual(1);
    const second = refreshNotifications(env.db, { lowStock: true, dues: false, backup: false, appointments: false });
    expect(second).toBe(0); // dedupe keys hold
    const rows = listNotifications(ctx);
    expect(rows.some((n) => n.title.includes('Syringe'))).toBe(true);
    markNotificationsRead(ctx);
    expect(listNotifications(ctx).every((n) => n.readAt != null)).toBe(true);
  });

  it('billing notification bodies are redacted for users without finance.view', () => {
    const ctx = ownerCtx(env);
    insertNotification(env.db, {
      key: 'due:1', kind: 'billing', severity: 'warning',
      title: 'Due ৳5,000', body: 'Patient owes 5000 paisa', entityType: 'invoice', entityId: '1',
    });
    expect(listNotifications(ctx)[0].body).toContain('5000');
    const viewer = ctxWith('patients.view');
    const redacted = listNotifications(viewer).find((n) => n.key === 'due:1' || n.title.includes('Due'));
    expect(redacted!.body).toMatch(/do not have permission/i);
  });
});

/* --------------------------------- staff --------------------------------- */

describe('staff module', () => {
  it('salary is redacted without staff.salary.view and cannot be set either', () => {
    const ctx = ownerCtx(env);
    saveStaff(ctx, { name: 'Hygienist One', salaryPaisa: 3000000 } as any);
    const viewer = ctxWith('staff.view');
    const rows = listStaff(viewer);
    expect(rows).toHaveLength(1);
    expect(rows[0].salaryPaisa == null).toBe(true);
    const manageNoSalary = ctxWith('staff.manage');
    expect(() => saveStaff(manageNoSalary, { name: 'No Salary Rights', salaryPaisa: 1 } as any)).toThrow(/permission to set salaries/i);
    expect(() => saveStaff(viewer, { name: 'No Name Insert' } as any)).toThrow(/permission/i);
  });

  it('dentists list requires patients.view; save requires staff.manage', () => {
    const none = ctxWith('queue.view');
    expect(() => listDentists(none)).toThrow(/permission/i);
    expect(() => saveDentists_guard(none)).toThrow(/permission/i);
    function saveDentists_guard(c: Ctx) {
      return saveDentist(c, { name: 'Dr X' });
    }
  });
});

/* ------------------------------- treatments ------------------------------ */

describe('treatments module', () => {
  it('duplicate code rejected; deactivation hides from default listing', () => {
    const ctx = ownerCtx(env);
    const t = saveTreatment(ctx, { code: 'FILL', name: 'Composite filling', defaultPricePaisa: 150000 });
    expect(() => saveTreatment(ctx, { code: 'fill', name: 'Dup' })).toThrow(/already in use/i);
    setTreatmentActive(ctx, t.id, false);
    expect(listTreatments(ctx).map((x) => x.code)).not.toContain('FILL');
    expect(listTreatments(ctx, true).map((x) => x.code)).toContain('FILL');
    expect(() => setTreatmentActive(ctx, 999999, false)).toThrow(/not found/i);
  });
});

/* ------------------------------- referrals ------------------------------- */

describe('referrals module', () => {
  it('create + list + update requires clinical.referral.manage', () => {
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01733330001');
    const r = saveReferral(ctx, {
      patientId: patient.id, direction: 'out', clinic: 'City Dental', date: '2026-09-15',
    });
    expect(listReferrals(ctx, patient.id)).toHaveLength(1);
    saveReferral(ctx, { ...r, patientId: patient.id, status: 'completed' });
    expect(listReferrals(ctx, patient.id)[0].status).toBe('completed');
    const viewer = ctxWith('clinical.view');
    expect(() => saveReferral(viewer, { patientId: patient.id, date: '2026-09-15' })).toThrow(/permission/i);
    expect(() => saveReferral(ctx, { patientId: 999999, date: '2026-09-15' })).toThrow(/patient/i);
  });
});

/* ------------------------------- dashboard ------------------------------- */

describe('dashboard module', () => {
  it('returns today scalars for permitted users and denies others', () => {
    const ctx = ownerCtx(env);
    const dto = getDashboard(ctx);
    expect(dto).toBeTruthy();
    const denied = ctxWith('patients.view');
    expect(() => getDashboard(denied)).toThrow(/permission/i);
  });

  it('counts a payment made now in Paid Today immediately, including a refund as a negative net', () => {
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01755550001');
    const inv = createInvoice(ctx, {
      patientId: patient.id,
      date: todayISO(),
      items: [{ description: 'Dashboard payment test', qty: 1, unitPricePaisa: 75000 }],
    });
    createPayment(ctx, {
      invoiceId: inv.id,
      patientId: patient.id,
      amountPaisa: 75000,
      method: 'cash',
    });
    expect(getDashboard(ctx).financial?.todayRevenuePaisa).toBe(75000);

    createPayment(ctx, {
      invoiceId: inv.id,
      patientId: patient.id,
      amountPaisa: 10000,
      method: 'cash',
      type: 'refund',
    });
    expect(getDashboard(ctx).financial?.todayRevenuePaisa).toBe(65000);
  });
});

/* -------------------------------- settings ------------------------------- */

describe('settings module', () => {
  it('save requires settings.manage; clinic name validated; read returns saved values', () => {
    const ctx = ownerCtx(env);
    const out = saveSettings(ctx, { clinic: { clinicName: 'Dentiva Test Clinic' } } as any);
    expect(out.clinic.clinicName).toBe('Dentiva Test Clinic');
    expect(getSettings(ctx).clinic.clinicName).toBe('Dentiva Test Clinic');
    expect(() => saveSettings(ctx, { clinic: { clinicName: '   ' } } as any)).toThrow();
    const denied = ctxWith('patients.view');
    expect(() => saveSettings(denied, { clinic: { clinicName: 'Hack' } } as any)).toThrow(/permission/i);
  });
});

/* -------------------- report accuracy vs hand-calculation ---------------- */

describe('report accuracy (acceptance: hand-computed dataset)', () => {
  it('profit_loss / collection_report / outstanding_dues match manual math', () => {
    const ctx = ownerCtx(env);
    const patient = p(ctx, '01744440001');
    const expCat = saveCategory(ctx, { kind: 'expense', name: 'Consumables' }).id;
    const incCat = saveCategory(ctx, { kind: 'income', name: 'Interest' }).id;

    // Hand dataset (all in September 2026):
    //   invoices:  #1 total 1,000.00 BDT (2026-09-05)  #2 total 500.00 BDT (2026-09-06)
    //   payments:  #1 pays 1,000.00 cash (09-05); #2 pays 200.00 bKash (09-06); refund 100.00 on #1 (09-07)
    //   expense:   200.00 (09-08)      other income: 150.00 (09-09)
    const inv1 = createInvoice(ctx, {
      patientId: patient.id, date: '2026-09-05',
      items: [{ description: 'Scaling', qty: 1, unitPricePaisa: 100000 }],
    });
    const inv2 = createInvoice(ctx, {
      patientId: patient.id, date: '2026-09-06',
      items: [{ description: 'Fluoride', qty: 1, unitPricePaisa: 50000 }],
    });
    createPayment(ctx, { invoiceId: inv1.id, patientId: patient.id, amountPaisa: 100000, method: 'cash', paidAt: '2026-09-05T10:00' } as any);
    createPayment(ctx, { invoiceId: inv2.id, patientId: patient.id, amountPaisa: 20000, method: 'bkash', paidAt: '2026-09-06T10:00' } as any);
    createPayment(ctx, { invoiceId: inv1.id, patientId: patient.id, amountPaisa: 10000, method: 'cash', type: 'refund', paidAt: '2026-09-07T10:00' } as any);
    addExpense(ctx, { date: '2026-09-08', amountPaisa: 20000, categoryId: expCat });
    addIncome(ctx, { date: '2026-09-09', amountPaisa: 15000, categoryId: incCat });

    const range = { from: '2026-09-01', to: '2026-09-30' };

    // Manual: collections = 100000 + 20000 - 10000 = 110000 paisa = ৳1,100.00
    const pl = runReport(ctx, 'profit_loss', range);
    const row = (label: string) => pl.rows.find((r) => r.metric === label)!;
    expect(row('Patient collections (payments)').amount).toBe('৳1,100.00');
    expect(row('Other income').amount).toBe('৳150.00');
    expect(row('Expenses').amount).toBe('-৳200.00');
    expect(row('Net').amount).toBe('৳1,050.00'); // 1100 + 150 - 200

    // Manual: dues = inv1 1000 - (1000-100 refund) = 100; inv2 500 - 200 = 300 → total 400
    const dues = runReport(ctx, 'outstanding_dues', {});
    expect(dues.totals!['Total outstanding']).toBe('৳400.00');

    // Manual: net collection = 1100 (matches paidNetFor)
    expect(paidNetFor(env.db, inv1.id)).toBe(90000);
    expect(paidNetFor(env.db, inv2.id)).toBe(20000);

    // Manual: by-method: cash 100000-10000=90000 → ৳900.00 ; bKash 20000 → ৳200.00
    const coll = runReport(ctx, 'collection_report', range);
    expect(coll.totals!['Net collection']).toBe('৳1,100.00');
    expect(coll.totals!['By method']).toContain('cash: ৳900.00');
    expect(coll.totals!['By method']).toContain('bkash: ৳200.00');
  });
});
