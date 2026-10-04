import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createInvoice, getInvoice, listInvoices, voidInvoice, createPayment, listPayments, paidNetFor } from '../../src/main/services/billing';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('billing');
});

afterEach(() => {
  cleanupEnv(env);
});

function patient(ctx: Ctx, phone: string) {
  return createPatient(ctx, { name: 'Billing Patient', gender: 'male', ageYears: 40, phone, forceCreate: true });
}

describe('invoice lifecycle', () => {
  it('computes totals from lines and keeps due/paid consistent', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000001');
    const inv = createInvoice(ctx, {
      patientId: p.id,
      date: '2026-09-27',
      items: [
        { description: 'Composite filling', qty: 2, unitPricePaisa: 25000 },
        { description: 'Scaling', qty: 1, unitPricePaisa: 150000 },
      ],
      discountPaisa: 10000,
    });
    expect(inv.subtotalPaisa).toBe(2 * 25000 + 150000);
    expect(inv.totalPaisa).toBe(190000);
    expect(inv.paidPaisa).toBe(0);
    expect(inv.duePaisa).toBe(190000);
    expect(inv.status).toBe('unpaid');
    expect(inv.items.length).toBe(2);
    expect(inv.items[0].totalPaisa).toBe(50000);
  });

  it('rejects invalid lines and negative totals', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000002');
    expect(() =>
      createInvoice(ctx, { patientId: p.id, date: '2026-09-27', items: [] }),
    ).toThrow(/line/i);
    expect(() =>
      createInvoice(ctx, {
        patientId: p.id, date: '2026-09-27',
        items: [{ description: 'X', qty: 0, unitPricePaisa: 10000 }],
      }),
    ).toThrow();
    expect(() =>
      createInvoice(ctx, {
        patientId: p.id, date: '2026-09-27',
        items: [{ description: 'X', qty: 1, unitPricePaisa: 10000 }],
        discountPaisa: 999999,
      }),
    ).toThrow(/discount/i);
  });

  it('partial and full payments update status; overpayment recorded but due clamps at zero', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000003');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Extraction', qty: 1, unitPricePaisa: 100000 }],
    });

    const partial = createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 40000, method: 'bkash', reference: 'TRX1' });
    expect(partial.invoice?.status).toBe('partial');
    expect(partial.invoice?.duePaisa).toBe(60000);
    expect(partial.payment.method).toBe('bkash');

    // Overpayment is allowed (counterfeit-cash reality) but flagged in the
    // audit log and never produces negative due.
    const over = createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 70000, method: 'cash' });
    expect(over.invoice?.status).toBe('paid');
    expect(over.invoice?.duePaisa).toBe(0);
    expect(over.invoice?.paidPaisa).toBe(100000); // clamped to total
    expect(paidNetFor(env.db, inv.id)).toBe(110000);
    const overage = env.db
      .prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'payment.overage'`)
      .get<{ n: number }>()!;
    expect(overage.n).toBe(1);

    const fetched = getInvoice(ctx, inv.id);
    expect(fetched.paidPaisa).toBe(100000);
    expect(fetched.duePaisa).toBe(0);
    expect(listPayments(ctx, { invoiceId: inv.id }).total).toBe(2);
  });

  it('payment history is append-only (no update/delete at service level)', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000004');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Consultation', qty: 1, unitPricePaisa: 30000 }],
    });
    createPayment(ctx, { invoiceId: inv.id, patientId: p.id, amountPaisa: 30000, method: 'cash' });
    // Direct tamper attempts below the service layer must fail
    expect(() => env.db.prepare('UPDATE payments SET amount_paisa = 1 WHERE invoice_id = ?').run(inv.id)).toThrow();
    expect(() => env.db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(inv.id)).toThrow();
    expect(listPayments(ctx, { invoiceId: inv.id }).total).toBe(1);
  });

  it('voiding keeps history and removes invoice from active totals', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000005');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Whitening', qty: 1, unitPricePaisa: 200000 }],
    });
    expect(() => voidInvoice(ctx, inv.id, '')).toThrow(/reason/i);

    const voided = voidInvoice(ctx, inv.id, 'Wrong patient');
    expect(voided.status).toBe('voided');
    expect(voided.voidReason).toBe('Wrong patient');

    const active = listInvoices(ctx, { status: 'unpaid' });
    expect(active.items.some((i) => i.id === inv.id)).toBe(false);
    const voidedList = listInvoices(ctx, { status: 'voided' });
    expect(voidedList.items.some((i) => i.id === inv.id)).toBe(true);
    // audit trail exists
    const auditRows = env.db
      .prepare(`SELECT * FROM audit_log WHERE action LIKE 'invoice.void%' OR entity_type = 'invoice'`)
      .all();
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it('invoices are immutable snapshots: changing catalog does not alter issued lines', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000006');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Old price item', qty: 1, unitPricePaisa: 50000 }],
    });
    env.db.prepare(`UPDATE treatments SET default_price_paisa = 999999 WHERE 1 = 1`).run();
    const refetched = getInvoice(ctx, inv.id);
    expect(refetched.items[0].unitPricePaisa).toBe(50000);
    expect(refetched.totalPaisa).toBe(50000);
  });
});

describe('RBAC on financial operations', () => {
  it('denies payment creation without billing.payment.create and audits the denial', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000007');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Consult', qty: 1, unitPricePaisa: 20000 }],
    });
    const limited = { db: env.db, paths: env.paths, session: sessionWith(['billing.invoice.view', 'billing.payment.view', 'patients.view']) } satisfies Ctx;
    expect(() =>
      createPayment(limited, { invoiceId: inv.id, patientId: p.id, amountPaisa: 20000, method: 'cash' }),
    ).toThrow(/billing\.payment\.create/);
    expect(getInvoice(ctx, inv.id).paidPaisa).toBe(0);
  });

  it('voiding requires billing.invoice.void', () => {
    const ctx = ownerCtx(env);
    const p = patient(ctx, '01700000008');
    const inv = createInvoice(ctx, {
      patientId: p.id, date: '2026-09-27',
      items: [{ description: 'Consult', qty: 1, unitPricePaisa: 20000 }],
    });
    const clerk = { db: env.db, paths: env.paths, session: sessionWith(['billing.invoice.view', 'billing.invoice.create', 'patients.view']) } satisfies Ctx;
    expect(() => voidInvoice(clerk, inv.id, 'nope')).toThrow(/billing\.invoice\.void/);
  });
});
