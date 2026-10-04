import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient } from '../../src/main/services/patients';
import { createInvoice } from '../../src/main/services/billing';
import { getSettings, saveSettings } from '../../src/main/services/settings';
import { listReferrals, saveReferral } from '../../src/main/services/referrals';

let env: TestEnv;

beforeEach(() => { env = createTestEnv('wiring-regressions'); });
afterEach(() => { cleanupEnv(env); });

describe('wiring regressions', () => {
  it('honours and advances the configured next invoice number', () => {
    const ctx = ownerCtx(env);
    const patient = createPatient(ctx, { name: 'Invoice Wiring', gender: 'female', ageYears: 28, phone: '01700000001', forceCreate: true });
    const settings = getSettings(ctx);
    saveSettings(ctx, { invoice: { ...settings.invoice, nextNumber: 'INV-2026-00421' } });
    const invoice = createInvoice(ctx, {
      patientId: patient.id,
      date: '2026-10-04',
      items: [{ description: 'Consultation', qty: 1, unitPricePaisa: 10000 }],
    });
    expect(invoice.number).toBe('INV-2026-00421');
    expect(getSettings(ctx).invoice.nextNumber).toBe('INV-2026-00422');
  });

  it('rejects a configured invoice number that is already behind existing invoices', () => {
    const ctx = ownerCtx(env);
    const patient = createPatient(ctx, { name: 'Invoice Sequence', gender: 'male', ageYears: 31, phone: '01700000002', forceCreate: true });
    createInvoice(ctx, {
      patientId: patient.id,
      date: '2026-10-04',
      items: [{ description: 'Exam', qty: 1, unitPricePaisa: 5000 }],
    });
    expect(() => saveSettings(ctx, { invoice: { ...getSettings(ctx).invoice, nextNumber: 'INV-2026-00001' } })).toThrow(/greater than the current/i);
  });

  it('referral save/list is reachable end-to-end for a patient', () => {
    const ctx = ownerCtx(env);
    const patient = createPatient(ctx, { name: 'Referral Wiring', gender: 'female', ageYears: 40, phone: '01700000003', forceCreate: true });
    const saved = saveReferral(ctx, {
      patientId: patient.id,
      direction: 'out',
      person: 'Dr. Specialist',
      clinic: 'Specialist Dental Centre',
      specialty: 'Oral Surgery',
      reason: 'Complex extraction',
      date: '2026-10-04',
      status: 'open',
      followUp: '2026-10-20',
      note: 'Please assess and advise.',
    });
    expect(saved.id).toBeGreaterThan(0);
    const rows = listReferrals(ctx, patient.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].clinic).toBe('Specialist Dental Centre');
    expect(rows[0].specialty).toBe('Oral Surgery');
  });
});
