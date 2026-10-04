import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, type TestEnv } from '../helpers';
import { createPatient, listPatients, getPatient, updatePatient, archivePatient, checkDuplicates, patientTimeline } from '../../src/main/services/patients';
import { createVisit, listVisits } from '../../src/main/services/visits';
import { setChart, getChart } from '../../src/main/services/chart';
import { globalSearch } from '../../src/main/services/search';
import { nextPatientCode, nextInvoiceNumber, nextPrescriptionNumber } from '../../src/main/core/sequences';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('patients');
});

afterEach(() => {
  cleanupEnv(env);
});

describe('patient records', () => {
  it('creates with auto code, required fields enforced', () => {
    const ctx = ownerCtx(env);
    expect(() => createPatient(ctx, { name: 'X', gender: 'male', ageYears: 30, phone: '01600000001' })).toThrow(/short|at least 2/i);
    expect(() => createPatient(ctx, { name: 'Valid Name', gender: 'female', phone: '01600000002' })).toThrow(/date of birth or age/i);

    const p = createPatient(ctx, {
      name: 'Rahim Uddin', bengaliName: 'রহিম উদ্দিন', gender: 'male', ageYears: 34,
      phone: '01712345678', city: 'Dhanmondi, Dhaka',
    });
    expect(p.code).toMatch(/^P-\d+/);
    expect(p.bengaliName).toBe('রহিম উদ্দিন');
    expect(p.status).toBe('active');
    expect(p.visitCount).toBe(0);
  });

  it('rejects duplicate phone numbers unless forceCreate', () => {
    const ctx = ownerCtx(env);
    createPatient(ctx, { name: 'First Person', gender: 'male', ageYears: 25, phone: '01811111111' });
    expect(() => createPatient(ctx, { name: 'Second Person', gender: 'male', ageYears: 40, phone: '01811111111' })).toThrow(/already exists|duplicate/i);
    const forced = createPatient(ctx, { name: 'Second Person', gender: 'male', ageYears: 40, phone: '01811111111', forceCreate: true });
    expect(forced.id).toBeGreaterThan(1);
    const dupes = checkDuplicates(ctx, { name: 'Second Person', phone: '01811111111' });
    expect(dupes.length).toBeGreaterThanOrEqual(2);
  });

  it('lists with search, updates preserve identity, archive hides but keeps', () => {
    const ctx = ownerCtx(env);
    const p = createPatient(ctx, { name: 'Karim Hossain', gender: 'male', ageYears: 50, phone: '01912345678' });
    createPatient(ctx, { name: 'Jasmin Akter', gender: 'female', ageYears: 28, phone: '01622222222' });

    const found = listPatients(ctx, { query: 'Karim' });
    expect(found.total).toBe(1);
    expect(found.items[0].id).toBe(p.id);

    const updated = updatePatient(ctx, p.id, { name: 'Karim Hossain (updated)', gender: 'male', ageYears: 51 });
    expect(updated.id).toBe(p.id);
    expect(updated.code).toBe(p.code);
    expect(updated.name).toBe('Karim Hossain (updated)');

    archivePatient(ctx, p.id);
    expect(getPatient(ctx, p.id).status).toBe('archived');
    expect(listPatients(ctx, { status: 'active' }).total).toBe(1);
    expect(listPatients(ctx, { status: 'archived' }).total).toBe(1);
  });

  it('keeps a chronological timeline across visits', () => {
    const ctx = ownerCtx(env);
    const p = createPatient(ctx, { name: 'Timeline Person', gender: 'other', ageYears: 20, phone: '01511111111' });
    createVisit(ctx, { patientId: p.id, dentistId: null, datetime: '2026-09-01T10:00', chiefComplaint: 'toothache' });
    createVisit(ctx, { patientId: p.id, dentistId: null, datetime: '2026-09-15T11:00', chiefComplaint: 'check-up' });

    const visits = listVisits(ctx, { patientId: p.id });
    expect(visits.total).toBe(2);

    const timeline = patientTimeline(ctx, p.id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    expect(timeline.every((t) => typeof t.at === 'string' && t.title.length > 0)).toBe(true);
  });
});

describe('dental chart (append/supersede history)', () => {
  it('records conditions and supersedes instead of deleting', () => {
    const ctx = ownerCtx(env);
    const p = createPatient(ctx, { name: 'Chart Patient', gender: 'male', ageYears: 12, phone: '01522222222' });
    setChart(ctx, p.id, {
      changes: [
        { tooth: '16', condition: 'caries', action: 'set', severity: 'moderate' },
        { tooth: '36', condition: 'caries', action: 'set', severity: 'mild' },
      ],
    });
    let chart = getChart(ctx, p.id);
    expect(chart.current.length).toBe(2);

    // A tooth can carry multiple concurrent findings (e.g. caries + restoration)
    setChart(ctx, p.id, { changes: [{ tooth: '16', condition: 'restored', action: 'set' }] });
    chart = getChart(ctx, p.id);
    const tooth16 = chart.current.filter((c) => c.tooth === '16');
    expect(tooth16.map((c) => c.condition).sort()).toEqual(['caries', 'restored']);
    expect(chart.history.filter((h) => h.tooth === '16').length).toBe(2);

    // re-setting the same condition supersedes the old row (no duplicates)
    setChart(ctx, p.id, { changes: [{ tooth: '16', condition: 'caries', action: 'set', severity: 'severe' }] });
    chart = getChart(ctx, p.id);
    expect(chart.current.filter((c) => c.tooth === '16' && c.condition === 'caries').length).toBe(1);
    expect(chart.history.filter((h) => h.tooth === '16').length).toBe(3);

    // clear removes current observation but history remains
    setChart(ctx, p.id, { changes: [{ tooth: '36', condition: 'caries', action: 'clear' }] });
    chart = getChart(ctx, p.id);
    expect(chart.current.some((c) => c.tooth === '36')).toBe(false);
    expect(chart.history.some((h) => h.tooth === '36')).toBe(true);
    // clear of caries on 16 keeps the restored finding current
    setChart(ctx, p.id, { changes: [{ tooth: '16', condition: 'caries', action: 'clear' }] });
    chart = getChart(ctx, p.id);
    expect(chart.current.filter((c) => c.tooth === '16').map((c) => c.condition)).toEqual(['restored']);

    expect(() =>
      setChart(ctx, p.id, { changes: [{ tooth: '99', condition: 'caries', action: 'set' }] }),
    ).toThrow(/tooth|unknown/i);
  });
});

describe('global search', () => {
  it('finds patients by name, phone and code', () => {
    const ctx = ownerCtx(env);
    const p = createPatient(ctx, { name: 'Searchable Soul', gender: 'female', ageYears: 33, phone: '01377777777' });
    const byName = globalSearch(ctx, 'Searchable');
    expect(byName.some((h) => h.kind === 'patient' && h.id === p.id)).toBe(true);
    const byPhone = globalSearch(ctx, '01377777777');
    expect(byPhone.some((h) => h.id === p.id)).toBe(true);
    const byCode = globalSearch(ctx, p.code);
    expect(byCode.some((h) => h.id === p.id)).toBe(true);
    expect(globalSearch(ctx, 'zzz-no-match')).toEqual([]);
  });
});

describe('number sequences', () => {
  it('generates unique patient codes, invoice and prescription numbers', () => {
    const a = nextPatientCode(env.db);
    const b = nextPatientCode(env.db);
    expect(a).not.toBe(b);
    const inv1 = nextInvoiceNumber(env.db, '2026-09-27');
    const inv2 = nextInvoiceNumber(env.db, '2026-09-27');
    expect(inv2).not.toBe(inv1);
    expect(inv1).toContain('2026');
    const rx1 = nextPrescriptionNumber(env.db, '2026-09-27');
    expect(rx1).toBeTruthy();
  });
});
