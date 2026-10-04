import type { Ctx } from '../core/context';
import type { AppointmentDTO, AppointmentInput, QueueEntryDTO } from '../../shared/types';
import { conflict, forbidden, notFound } from '../errors';
import { audit, hasPermission, requirePermission, tx } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { optString, reqDate, reqInt, reqString, reqTime, oneOf } from '../core/validate';

interface ApptRow {
  id: number; patient_id: number; patient_name: string; patient_code: string; phone: string | null;
  dentist_id: number | null; dentist_name: string | null; date: string; time: string;
  duration_min: number; type: string; status: string; notes: string | null;
  created_by: number; created_at: string; visit_id: number | null;
  queue_no: number | null;
}

const SELECT_APPT = `
  SELECT a.*, p.name patient_name, p.code patient_code, p.phone phone, d.name dentist_name,
    (SELECT q.queue_no FROM queue_entries q WHERE q.appointment_id = a.id AND q.status != 'cancelled') queue_no
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  LEFT JOIN dentists d ON d.id = a.dentist_id`;

function toDTO(r: ApptRow): AppointmentDTO {
  return {
    id: r.id, patientId: r.patient_id, patientName: r.patient_name, patientCode: r.patient_code,
    phone: r.phone, dentistId: r.dentist_id, dentistName: r.dentist_name,
    date: r.date, time: r.time, durationMin: r.duration_min, type: r.type,
    status: r.status as AppointmentDTO['status'], notes: r.notes, createdBy: r.created_by,
    createdAt: r.created_at, visitId: r.visit_id, queueNo: r.queue_no,
  };
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const ACTIVE_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_queue', 'in_treatment'];

function findConflict(ctx: Ctx, dentistId: number, date: string, time: string, durationMin: number, excludeId?: number): { id: number; time: string; patientName: string } | null {
  const start = minutesOf(time);
  const end = start + durationMin;
  const rows = ctx.db
    .prepare(
      `SELECT id, time, duration_min, patient_id FROM appointments
       WHERE dentist_id = ? AND date = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
         AND deleted_at IS NULL ${excludeId ? 'AND id != ?' : ''}`,
    )
    .all(...(excludeId ? [dentistId, date, ...ACTIVE_STATUSES, excludeId] : [dentistId, date, ...ACTIVE_STATUSES])) as
    { id: number; time: string; duration_min: number; patient_id: number }[];
  for (const r of rows) {
    const s = minutesOf(r.time);
    const e = s + r.duration_min;
    if (start < e && end > s) {
      const patientName = (ctx.db.prepare('SELECT name FROM patients WHERE id = ?').get<{ name: string }>(r.patient_id)?.name) ?? '';
      return { id: r.id, time: r.time, patientName };
    }
  }
  return null;
}

export function listAppointments(ctx: Ctx, filter: { from: string; to: string; dentistId?: number; status?: string }): AppointmentDTO[] {
  requirePermission(ctx, 'appointments.view');
  const from = reqDate(filter?.from, 'From date');
  const to = reqDate(filter?.to, 'To date');
  const where = ['a.date >= ?', 'a.date <= ?', 'a.deleted_at IS NULL'];
  const params: unknown[] = [from, to];
  if (filter.dentistId) { where.push('a.dentist_id = ?'); params.push(filter.dentistId); }
  if (filter.status && filter.status !== 'all') { where.push('a.status = ?'); params.push(filter.status); }
  const rows = ctx.db
    .prepare(`${SELECT_APPT} WHERE ${where.join(' AND ')} ORDER BY a.date, a.time`)
    .all(...params as any[]) as ApptRow[];
  return rows.map(toDTO);
}

export function createAppointment(ctx: Ctx, raw: AppointmentInput): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const patientId = reqInt(raw?.patientId, 'Patient', { min: 1 });
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');
  const date = reqDate(raw?.date, 'Date');
  const time = reqTime(raw?.time, 'Time');
  const durationMin = reqInt(raw?.durationMin ?? 30, 'Duration', { min: 5, max: 720 });
  const dentistId = raw?.dentistId != null ? reqInt(raw.dentistId, 'Dentist', { min: 1 }) : null;
  const type = reqString(raw?.type ?? 'consultation', 'Appointment type', { max: 80 });
  const status = raw?.status ? oneOf(raw.status, ['scheduled', 'confirmed'] as const, 'Status') : 'scheduled';

  let conflictInfo: { id: number; time: string; patientName: string } | null = null;
  if (dentistId != null) conflictInfo = findConflict(ctx, dentistId, date, time, durationMin);
  if (conflictInfo && !raw.allowConflict) {
    const canOverride = hasPermission(ctx, 'appointments.override');
    throw conflict(
      canOverride
        ? `Time slot overlaps an existing appointment for this dentist (${conflictInfo.time}, ${conflictInfo.patientName}). Enable "Override conflict" to book anyway.`
        : `Time slot overlaps an existing appointment for this dentist (${conflictInfo.time}, ${conflictInfo.patientName}). Choose another time.`,
    );
  }
  if (conflictInfo && raw.allowConflict && !hasPermission(ctx, 'appointments.override')) {
    throw forbidden('Overriding appointment conflicts requires additional permission.');
  }

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare(
        `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        patientId, dentistId, date, time, durationMin, type, status,
        optString(raw.notes, 'Notes', { max: 4000 }),
        ctx.session.userId, nowISO(), nowISO(),
      );
    const apptId = Number(info.lastInsertRowid);
    audit(ctx, {
      action: 'appointment.create', entityType: 'appointment', entityId: apptId,
      summary: `Appointment ${date} ${time} (${type})`, after: { dentistId, conflictOverridden: !!conflictInfo && !!raw.allowConflict },
    });
    return apptId;
  });
  return getOne(ctx, id);
}

function getOne(ctx: Ctx, id: number): AppointmentDTO {
  const row = ctx.db.prepare(`${SELECT_APPT} WHERE a.id = ?`).get(id) as ApptRow | undefined;
  if (!row) throw notFound('Appointment not found.');
  return toDTO(row);
}

export interface AppointmentUpdate extends Omit<Partial<AppointmentInput>, 'status'> {
  status?: string;
  reschedule?: { date: string; time: string; durationMin?: number };
}

export function updateAppointment(ctx: Ctx, id: number, input: AppointmentUpdate): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as any | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (existing.status === 'completed') throw conflict('Completed appointments cannot be edited.');

  if (input.reschedule) {
    const date = reqDate(input.reschedule.date, 'New date');
    const time = reqTime(input.reschedule.time, 'New time');
    const duration = reqInt(input.reschedule.durationMin ?? existing.duration_min, 'Duration', { min: 5, max: 720 });
    const dentistId = existing.dentist_id as number | null;
    if (dentistId != null) {
      const c = findConflict(ctx, dentistId, date, time, duration, id);
      if (c && !input.allowConflict) {
        throw conflict(`New slot overlaps an existing appointment (${c.time}, ${c.patientName}).`);
      }
      if (c && input.allowConflict && !hasPermission(ctx, 'appointments.override')) {
        throw forbidden('Overriding appointment conflicts requires additional permission.');
      }
    }
    const newId = tx(ctx.db, () => {
      const info = ctx.db
        .prepare(
          `INSERT INTO appointments (patient_id, dentist_id, date, time, duration_min, type, status, notes, reminder,
             rescheduled_from_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          existing.patient_id, dentistId, date, time, duration, existing.type, existing.notes, existing.reminder,
          id, ctx.session.userId, nowISO(), nowISO(),
        );
      ctx.db.prepare("UPDATE appointments SET status = 'rescheduled', updated_at = ? WHERE id = ?").run(nowISO(), id);
      audit(ctx, { action: 'appointment.reschedule', entityType: 'appointment', entityId: id, summary: `Rescheduled to ${date} ${time}`, before: { date: existing.date, time: existing.time }, after: { date, time } });
      return Number(info.lastInsertRowid);
    });
    return getOne(ctx, newId);
  }

  const status = input.status ? oneOf(input.status, ['scheduled', 'confirmed', 'in_treatment', 'completed', 'in_queue', 'arrived'] as const, 'Status') : existing.status;
  const dentistId = input.dentistId !== undefined ? (input.dentistId != null ? reqInt(input.dentistId, 'Dentist') : null) : existing.dentist_id;
  const date = input.date ? reqDate(input.date, 'Date') : existing.date;
  const time = input.time ? reqTime(input.time, 'Time') : existing.time;
  const duration = input.durationMin != null ? reqInt(input.durationMin, 'Duration', { min: 5, max: 720 }) : existing.duration_min;

  if ((date !== existing.date || time !== existing.time || dentistId !== existing.dentist_id || duration !== existing.duration_min) && dentistId != null) {
    const c = findConflict(ctx, dentistId, date, time, duration, id);
    if (c && !input.allowConflict) throw conflict(`Time slot overlaps an existing appointment (${c.time}, ${c.patientName}).`);
    if (c && input.allowConflict && !hasPermission(ctx, 'appointments.override')) throw forbidden('Overriding appointment conflicts requires additional permission.');
  }

  tx(ctx.db, () => {
    ctx.db
      .prepare('UPDATE appointments SET dentist_id = ?, date = ?, time = ?, duration_min = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(dentistId, date, time, duration, status,
        input.notes !== undefined ? optString(input.notes, 'Notes', { max: 4000 }) : existing.notes,
        nowISO(), id);
    audit(ctx, { action: 'appointment.update', entityType: 'appointment', entityId: id, summary: `Updated appointment → ${date} ${time} (${status})` });
  });
  return getOne(ctx, id);
}

export function cancelAppointment(ctx: Ctx, id: number, reason?: string): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as { status: string } | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (existing.status === 'completed') throw conflict('Completed appointments cannot be cancelled.');
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE appointments SET status = 'cancelled', notes = COALESCE(notes, '') || ?, updated_at = ? WHERE id = ?")
      .run(reason ? ` [Cancelled: ${reason}]` : '', nowISO(), id);
    ctx.db.prepare("UPDATE queue_entries SET status = 'cancelled' WHERE appointment_id = ? AND status IN ('waiting','called','paused','in_treatment')").run(id);
    audit(ctx, { action: 'appointment.cancel', entityType: 'appointment', entityId: id, summary: 'Appointment cancelled', reason });
  });
  return getOne(ctx, id);
}

export function markNoShow(ctx: Ctx, id: number): AppointmentDTO {
  requirePermission(ctx, 'appointments.manage');
  const existing = ctx.db.prepare('SELECT status FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as { status: string } | undefined;
  if (!existing) throw notFound('Appointment not found.');
  if (['completed', 'cancelled', 'no_show'].includes(existing.status)) {
    throw conflict(`Cannot mark a ${existing.status.replace('_', ' ')} appointment as no-show.`);
  }
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE appointments SET status = 'no_show', updated_at = ? WHERE id = ?").run(nowISO(), id);
    // Keep the queue truthful: a no-show patient must leave the active queue,
    // otherwise queue actions could later overwrite the terminal status (ISS-021).
    ctx.db.prepare("UPDATE queue_entries SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE appointment_id = ? AND status IN ('waiting','called','paused','in_treatment')")
      .run(nowISO(), id);
    audit(ctx, { action: 'appointment.no_show', entityType: 'appointment', entityId: id, summary: 'Marked as no-show' });
  });
  return getOne(ctx, id);
}

/** Mark arrived → create/refresh same-day queue entry. */
export function arriveAppointment(ctx: Ctx, id: number): { appointment: AppointmentDTO; queue: QueueEntryDTO } {
  requirePermission(ctx, 'appointments.manage');
  requirePermission(ctx, 'queue.manage');
  const appt = ctx.db.prepare('SELECT * FROM appointments WHERE id = ? AND deleted_at IS NULL').get(id) as any | undefined;
  if (!appt) throw notFound('Appointment not found.');
  if (!['scheduled', 'confirmed'].includes(appt.status)) {
    throw conflict(`Cannot mark a ${appt.status.replace('_', ' ')} appointment as arrived.`);
  }

  const queue = tx(ctx.db, () => {
    ctx.db.prepare("UPDATE appointments SET status = 'in_queue', updated_at = ? WHERE id = ?").run(nowISO(), id);
    let entry = ctx.db.prepare("SELECT * FROM queue_entries WHERE appointment_id = ? AND status NOT IN ('completed','cancelled')").get(id) as any;
    if (!entry) {
      // The patient may already be queued today (walk-in added first) — reuse
      // that entry instead of creating a duplicate (ISS-022).
      entry = ctx.db
        .prepare("SELECT * FROM queue_entries WHERE day = ? AND patient_id = ? AND status NOT IN ('completed','cancelled')")
        .get(todayISO(), appt.patient_id) as any;
      if (entry && !entry.appointment_id) {
        ctx.db.prepare('UPDATE queue_entries SET appointment_id = ? WHERE id = ?').run(id, entry.id);
        entry = ctx.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(entry.id) as any;
      }
    }
    if (!entry) {
      const day = todayISO();
      const maxNo = Number(ctx.db.prepare('SELECT COALESCE(MAX(queue_no), 0) m FROM queue_entries WHERE day = ?').get<{ m: number }>(day)!.m);
      const info = ctx.db
        .prepare(
          `INSERT INTO queue_entries (day, queue_no, patient_id, appointment_id, dentist_id, arrived_at, status, priority, created_by)
           VALUES (?, ?, ?, ?, ?, ?, 'waiting', 0, ?)`,
        )
        .run(day, maxNo + 1, appt.patient_id, id, appt.dentist_id, nowISO(), ctx.session.userId);
      entry = ctx.db.prepare('SELECT * FROM queue_entries WHERE id = ?').get(Number(info.lastInsertRowid))!;
    }
    audit(ctx, { action: 'appointment.arrive', entityType: 'appointment', entityId: id, summary: `Patient arrived → queue #${entry.queue_no}` });
    return entry as any;
  });

  return { appointment: getOne(ctx, id), queue: toQueueDTO(ctx, queue) };
}

function toQueueDTO(ctx: Ctx, r: any): QueueEntryDTO {
  const patient = ctx.db.prepare('SELECT name, code FROM patients WHERE id = ?').get<{ name: string; code: string }>(r.patient_id)!;
  const dentist = r.dentist_id ? ctx.db.prepare('SELECT name FROM dentists WHERE id = ?').get<{ name: string }>(r.dentist_id) : null;
  const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now();
  return {
    id: r.id, queueNo: r.queue_no, patientId: r.patient_id, patientName: patient.name, patientCode: patient.code,
    appointmentId: r.appointment_id, dentistId: r.dentist_id, dentistName: dentist?.name ?? null,
    arrivedAt: r.arrived_at, waitingMin: Math.max(0, Math.round((end - new Date(r.arrived_at).getTime()) / 60000)),
    status: r.status, priority: r.priority, startedAt: r.started_at, finishedAt: r.finished_at,
  };
}

export { toQueueDTO };
