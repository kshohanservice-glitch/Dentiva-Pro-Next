/**
 * Phase B — scale / stress fixture (ISS-005): hundreds of realistic synthetic
 * records; verifies paging correctness, report completeness, queue numbering
 * uniqueness and sane latencies. Synthetic data only — no production patients.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createVisit } from '../../src/main/services/visits';
import { createInvoice, createPayment } from '../../src/main/services/billing';
import { addQueueEntry, listQueue } from '../../src/main/services/queue';
import { listPatients } from '../../src/main/services/patients';
import { runReport } from '../../src/main/services/reports';
import { globalSearch } from '../../src/main/services/search';
import { todayISO } from '../../src/shared/currency';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('scale');
});

afterEach(() => {
  cleanupEnv(env);
});

const TOTAL = 300;

function seedDentist(): number {
  const now = new Date().toISOString();
  return Number(env.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Scale', NULL, 1, ?, ?)")
    .run(now, now).lastInsertRowid);
}

function seedClinic(ctx: Ctx, dentistId: number): number[] {
  const ids: number[] = [];
  for (let i = 1; i <= TOTAL; i++) {
    const p = createPatient(ctx, {
      name: `Synthetic Patient ${String(i).padStart(3, '0')}`,
      gender: i % 2 === 0 ? 'male' : 'female',
      ageYears: 18 + (i % 50),
      phone: `017${String(10000000 + i).slice(0, 8)}`,
      forceCreate: true,
    });
    ids.push(p.id);
  }
  // 100 invoices across the first 100 patients, half paid in full, quarter partial
  for (let i = 0; i < 100; i++) {
    const inv = createInvoice(ctx, {
      patientId: ids[i], date: '2026-09-10',
      items: [{ description: `Treatment ${i % 7}`, qty: 1, unitPricePaisa: (i + 1) * 10000 }],
    });
    if (i % 2 === 0) {
      createPayment(ctx, { invoiceId: inv.id, patientId: ids[i], amountPaisa: (i + 1) * 10000, method: 'cash' });
    } else if (i % 4 === 1) {
      createPayment(ctx, { invoiceId: inv.id, patientId: ids[i], amountPaisa: Math.floor(((i + 1) * 10000) / 2), method: 'bkash' });
    }
  }
  // 150 visits
  for (let i = 0; i < 150; i++) {
    createVisit(ctx, {
      patientId: ids[i % TOTAL], dentistId, datetime: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T10:00`,
      chiefComplaint: `Complaint ${i}`, status: i % 3 === 0 ? 'closed' : 'open',
    } as any);
  }
  return ids;
}

describe('scale: hundreds of synthetic records', () => {
  it('seeds 300 patients + 100 invoices + 150 visits and pages them correctly', () => {
    const ctx = ownerCtx(env);
    const dentistId = seedDentist();
    const t0 = Date.now();
    seedClinic(ctx, dentistId);
    const seedMs = Date.now() - t0;

    const page1 = listPatients(ctx, { page: 1, pageSize: 50 });
    expect(page1.total).toBe(TOTAL);
    expect(page1.items).toHaveLength(50);
    const page6 = listPatients(ctx, { page: 6, pageSize: 50 });
    expect(page6.items).toHaveLength(50);
    // pages do not overlap
    const ids = new Set([...page1.items, ...page6.items].map((p) => p.id));
    expect(ids.size).toBe(100);
    // out-of-range page is empty, not an error
    expect(listPatients(ctx, { page: 99, pageSize: 50 }).items).toHaveLength(0);

    // report over the full dataset completes and totals reconcile
    const t1 = Date.now();
    const dues = runReport(ctx, 'outstanding_dues', {});
    const reportMs = Date.now() - t1;
    expect(dues.rows.length).toBeGreaterThan(0);
    // hand-check: odd i → unpaid (i%4==1 gets half) → dues must be > 0
    expect(dues.totals!['Total outstanding']).not.toBe('৳0.00');

    // search stays usable at scale
    const t2 = Date.now();
    const hits = globalSearch(ctx, 'Synthetic Patient 042');
    const searchMs = Date.now() - t2;
    expect(hits.some((h) => h.kind === 'patient')).toBe(true);
    expect(searchMs).toBeLessThan(2000);
    expect(reportMs).toBeLessThan(5000);
    expect(seedMs).toBeLessThan(30_000);
    console.log(`[scale] seed=${seedMs}ms report=${reportMs}ms search=${searchMs}ms`);
  });

  it('queue numbering stays unique and MAX+1 holds across 120 walk-ins', () => {
    const ctx = ownerCtx(env);
    const ids = seedClinic(ctx, seedDentist());
    const day = todayISO();
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) {
      addQueueEntry(ctx, { patientId: ids[i] });
    }
    const rows = env.db
      .prepare('SELECT queue_no FROM queue_entries WHERE day = ? ORDER BY queue_no')
      .all(day) as { queue_no: number }[];
    const nos = rows.map((r) => r.queue_no);
    expect(nos).toHaveLength(120);
    expect(new Set(nos).size).toBe(120); // no duplicates from MAX+1
    expect(Math.min(...nos)).toBe(1);
    expect(Math.max(...nos)).toBe(120);
    const listed = listQueue(ctx, day);
    expect(listed).toHaveLength(120);
    console.log(`[scale] queue120 in ${Date.now() - t0}ms`);
  });
});
