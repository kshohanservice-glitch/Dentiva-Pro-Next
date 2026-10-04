/**
 * Phase A static-audit findings (docs/V1.1_ISSUE_REGISTER.md ISS-020+).
 *
 * ISS-020 (P1): The Reports page offers 14 report names; the reports service
 * implemented a different, disjoint set of keys — every report launched from
 * the UI threw `Unknown report`. Root cause: UI/service contract was never
 * aligned and no test referenced `runReport` at all.
 *
 * This file locks the contract: every name the renderer offers must resolve
 * and execute at the service layer (the single source of truth is now
 * src/shared/reports.ts, imported by BOTH sides).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupEnv, createTestEnv, ownerCtx, sessionWith, type TestEnv } from '../helpers';
import { runReport, reportCsv, REPORT_NAMES } from '../../src/main/services/reports';
import { createPatient } from '../../src/main/services/patients';
import { UI_REPORT_NAMES } from '../../src/shared/reports';
import type { Ctx } from '../../src/main/core/context';

let env: TestEnv;

beforeEach(() => {
  env = createTestEnv('phase-a-findings');
});

afterEach(() => {
  cleanupEnv(env);
});

describe('ISS-020 report contract: UI names must run', () => {
  it('every report name the renderer offers resolves in the service', () => {
    for (const name of UI_REPORT_NAMES) {
      expect(REPORT_NAMES, `service must register report "${name}"`).toContain(name);
    }
  });

  it('runs every UI report end-to-end (owner, full-year range)', () => {
    const ctx = ownerCtx(env);
    const params = { from: '2026-01-01', to: '2026-12-31' };
    for (const name of UI_REPORT_NAMES) {
      let result: ReturnType<typeof runReport> | undefined;
      expect(() => {
        result = runReport(ctx, name, params);
      }, `report "${name}" must execute`).not.toThrow();
      expect(result, name).toBeTruthy();
      expect(result!.title.length, `${name} title`).toBeGreaterThan(0);
      expect(Array.isArray(result!.rows), `${name} rows`).toBe(true);
      expect(result!.generatedAt, `${name} generatedAt`).toBeTruthy();
    }
  });

  it('CSV export runs for every UI report name', () => {
    const ctx = ownerCtx(env);
    for (const name of UI_REPORT_NAMES) {
      expect(() => reportCsv(ctx, name, { from: '2026-01-01', to: '2026-12-31' }), `csv "${name}"`).not.toThrow();
    }
  });

  it('unknown names still fail fast with a clear error', () => {
    const ctx = ownerCtx(env);
    expect(() => runReport(ctx, 'not_a_real_report')).toThrow(/Unknown report/);
  });

  it('report permissions are enforced at the service layer (UI-only gating is not enough)', () => {
    // A viewer with NO permissions at all must be denied every report.
    const viewer = { db: env.db, paths: env.paths, session: sessionWith([]) };
    for (const name of UI_REPORT_NAMES) {
      expect(() => runReport(viewer, name, { from: '2026-01-01', to: '2026-12-31' }), `perm "${name}"`).toThrow();
    }
  });
});

describe('ISS-020 payment report robustness', () => {
  it('payments report handles an unbounded range without SQL errors', () => {
    const ctx = ownerCtx(env);
    // range 'all' resolves to no date bounds — the By-method query used to
    // concatenate `AND type=...` onto an empty WHERE clause (syntax error).
    expect(() => runReport(ctx, 'collection_report', { range: 'all' })).not.toThrow();
    expect(() => runReport(ctx, 'payment_methods', { range: 'all' })).not.toThrow();
  });
});

/*
 * ---------------------------------------------------------------------------
 * ISS-021 (P2): queue ↔ appointment state-sync gaps (the reverse direction of
 * ISS-016, plus unguarded appointment-status writes from queue actions).
 * ---------------------------------------------------------------------------
 */
import { createAppointment, cancelAppointment, markNoShow, arriveAppointment, updateAppointment } from '../../src/main/services/appointments';
import { addQueueEntry, performQueueAction } from '../../src/main/services/queue';
import { todayISO } from '../../src/shared/currency';

function seedDentist(t: TestEnv): number {
  const now = new Date().toISOString();
  const info = t.db
    .prepare("INSERT INTO dentists (name, qualifications, active, created_at, updated_at) VALUES ('Dr Sync', NULL, 1, ?, ?)")
    .run(now, now);
  return Number(info.lastInsertRowid);
}

describe('ISS-021 queue/appointment sync completeness', () => {
  it('cancelling an appointment cancels its active queue entry in EVERY non-final state', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const appt = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '10:00', durationMin: 30, type: 'consultation' });
    arriveAppointment(ctx, appt.id);           // entry waiting, appt in_queue
    performQueueAction(ctx, appt.id ? queueIdOf(env.db, appt.id) : null, 'call');
    performQueueAction(ctx, queueIdOf(env.db, appt.id), 'pause');   // entry now paused
    cancelAppointment(ctx, appt.id, 'patient cancelled by phone');
    const entry = env.db.prepare('SELECT status FROM queue_entries WHERE appointment_id = ?').get(appt.id) as any;
    expect(entry?.status, 'paused entry must be cancelled with its appointment').toBe('cancelled');
  });

  it('marking no-show cancels the linked active queue entry (cannot later resurrect the appointment)', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const appt = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '11:00', durationMin: 30, type: 'consultation' });
    arriveAppointment(ctx, appt.id);
    markNoShow(ctx, appt.id);
    const entry = env.db.prepare('SELECT status FROM queue_entries WHERE appointment_id = ?').get(appt.id) as any;
    expect(['cancelled'].includes(entry?.status), `entry status was ${entry?.status}`).toBe(true);
    // completing the (now cancelled) entry must NOT overwrite the no_show history
    const qid = env.db.prepare('SELECT id FROM queue_entries WHERE appointment_id = ?').get(appt.id) as any;
    expect(() => performQueueAction(ctx, qid.id, 'complete')).toThrow(/finished/i);
    const apptRow = env.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt.id) as any;
    expect(apptRow.status).toBe('no_show');
  });

  it('queue actions never overwrite a terminal appointment status', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const appt = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '12:00', durationMin: 30, type: 'consultation' });
    arriveAppointment(ctx, appt.id);
    const qid = env.db.prepare('SELECT id FROM queue_entries WHERE appointment_id = ?').get(appt.id) as any;
    cancelAppointment(ctx, appt.id, 'no longer coming');
    // try every queue action that writes appointment status
    for (const action of ['call', 'start', 'complete'] as const) {
      try { performQueueAction(ctx, qid.id, action); } catch { /* conflicts are fine */ }
      const apptRow = env.db.prepare('SELECT status FROM appointments WHERE id = ?').get(appt.id) as any;
      expect(apptRow.status, `action ${action} must not resurrect a cancelled appointment`).toBe('cancelled');
    }
  });
});

function patientOf(ctx: Ctx) {
  return createPatient(ctx, { name: 'Sync Patient', gender: 'male', ageYears: 30, phone: '01799990001', forceCreate: true });
}

function queueIdOf(db: any, appointmentId: number): number {
  const row = db.prepare('SELECT id FROM queue_entries WHERE appointment_id = ?').get(appointmentId) as any;
  return row.id;
}

/*
 * ---------------------------------------------------------------------------
 * ISS-022 (P2): arriveAppointment ignores a same-day active queue entry that
 * already exists for the patient (walk-in added first) → duplicate queue rows.
 * ---------------------------------------------------------------------------
 */
describe('ISS-022 duplicate queue entries', () => {
  it('arriving on an appointment reuses an existing active walk-in entry instead of duplicating the patient', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const appt = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '14:00', durationMin: 30, type: 'consultation' });
    addQueueEntry(ctx, { patientId: p.id });   // walk-in, no appointment link
    arriveAppointment(ctx, appt.id);
    const active = env.db
      .prepare("SELECT COUNT(*) c FROM queue_entries WHERE patient_id = ? AND day = ? AND status NOT IN ('completed','cancelled')")
      .get(p.id, todayISO()) as any;
    expect(Number(active.c), 'patient must appear exactly once in today\'s active queue').toBe(1);
    // and the entry must now be linked to the appointment
    const linked = env.db
      .prepare("SELECT appointment_id FROM queue_entries WHERE patient_id = ? AND day = ? AND status NOT IN ('completed','cancelled')")
      .get(p.id, todayISO()) as any;
    expect(linked.appointment_id).toBe(appt.id);
  });
});

/*
 * ---------------------------------------------------------------------------
 * ISS-023 (P3): reschedule conflict check did not exclude the appointment's
 * own row → extending duration in place was blocked by a self-conflict.
 * ISS-024 (P2): plain update path only re-checked conflicts when date/time/
 * dentist changed — a duration-only change could silently double-book.
 * ---------------------------------------------------------------------------
 */
describe('ISS-023/024 appointment conflict checks', () => {
  it('duration-only update is conflict-checked (cannot silently overlap a neighbour)', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const a = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '15:00', durationMin: 30, type: 'consultation' });
    createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '15:30', durationMin: 30, type: 'consultation' });
    // Extending A to 60 min overlaps the 15:30 appointment → must be rejected.
    expect(() => updateAppointment(ctx, a.id, { durationMin: 60 })).toThrow(/overlap|overlaps/i);
  });

  it('rescheduling to the same slot with a longer duration is NOT blocked by the appointment itself', () => {
    const ctx = ownerCtx(env);
    const p = patientOf(ctx);
    const d = seedDentist(env);
    const a = createAppointment(ctx, { patientId: p.id, dentistId: d, date: todayISO(), time: '16:00', durationMin: 30, type: 'consultation' });
    let err: any = null;
    try {
      updateAppointment(ctx, a.id, { reschedule: { date: todayISO(), time: '16:00', durationMin: 60 } });
    } catch (e) { err = e; }
    expect(err, `self-conflict blocked a legitimate reschedule: ${err?.message}`).toBeNull();
  });
});
