import type { Ctx } from '../core/context';
import type { QueueEntryDTO } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { reqInt } from '../core/validate';
import { toQueueDTO } from './appointments';

const SELECT_QUEUE = `
  SELECT q.*, p.name patient_name, p.code patient_code
  FROM queue_entries q JOIN patients p ON p.id = q.patient_id`;

function loadRow(ctx: Ctx, id: number): any {
  const row = ctx.db.prepare(`${SELECT_QUEUE} WHERE q.id = ?`).get(id);
  if (!row) throw notFound('Queue entry not found.');
  return row;
}

export function listQueue(ctx: Ctx, day: string): QueueEntryDTO[] {
  requirePermission(ctx, 'queue.view');
  const rows = ctx.db
    .prepare(
      `${SELECT_QUEUE} WHERE q.day = ?
       ORDER BY (q.status IN ('completed','cancelled')) ASC,
         COALESCE(q.reorder_index, 1000000) ASC, q.priority DESC, q.arrived_at ASC`,
    )
    .all(day) as any[];
  return rows.map((r) => toQueueDTO(ctx, r));
}

export function addQueueEntry(ctx: Ctx, input: { patientId: number; dentistId?: number | null; priority?: number; appointmentId?: number }): QueueEntryDTO {
  requirePermission(ctx, 'queue.manage');
  const patientId = reqInt(input?.patientId, 'Patient', { min: 1 });
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');
  const day = todayISO();

  const row = tx(ctx.db, () => {
    const existing = ctx.db
      .prepare("SELECT * FROM queue_entries WHERE day = ? AND patient_id = ? AND status IN ('waiting','called','in_treatment','paused')")
      .get(day, patientId) as any;
    if (existing) throw conflict(`Patient is already in today's queue (#${existing.queue_no}).`);

    const maxNo = Number(ctx.db.prepare('SELECT COALESCE(MAX(queue_no), 0) m FROM queue_entries WHERE day = ?').get<{ m: number }>(day)!.m);
    const info = ctx.db
      .prepare(
        `INSERT INTO queue_entries (day, queue_no, patient_id, appointment_id, dentist_id, arrived_at, status, priority, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?)`,
      )
      .run(
        day, maxNo + 1, patientId,
        input.appointmentId ?? null,
        input.dentistId ?? null,
        nowISO(),
        Math.max(0, Math.min(5, Number(input.priority) || 0)),
        ctx.session.userId,
      );
    const created = loadRow(ctx, Number(info.lastInsertRowid));
    audit(ctx, { action: 'queue.add', entityType: 'queue', entityId: created.id, summary: `Added to queue #${created.queue_no}` });
    return created;
  });
  return toQueueDTO(ctx, row);
}

const ALLOWED_ACTIONS = ['call', 'call_next', 'start', 'pause', 'resume', 'complete', 'cancel', 'transfer', 'priority'] as const;
export type QueueAction = (typeof ALLOWED_ACTIONS)[number];

export function performQueueAction(ctx: Ctx, id: number | null, action: QueueAction, payload?: { dentistId?: number; priority?: number }): QueueEntryDTO {
  requirePermission(ctx, 'queue.manage');
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) throw validation('Unknown queue action.');

  if (action === 'call_next') {
    if (id != null) {
      return performQueueAction(ctx, id, 'call', payload);
    }
    const next = ctx.db
      .prepare(
        `SELECT q.* FROM queue_entries q
         WHERE q.day = ? AND q.status = 'waiting'
         ORDER BY COALESCE(q.reorder_index, 1000000) ASC, q.priority DESC, q.arrived_at ASC LIMIT 1`,
      )
      .get(todayISO()) as any;
    if (!next) throw conflict('No patients are waiting in the queue.');
    return performQueueAction(ctx, next.id, 'call', payload);
  }

  if (id == null) throw validation('Queue entry is required.');
  const entry = loadRow(ctx, id);

  const update = (sets: Record<string, unknown>): void => {
    const keys = Object.keys(sets);
    ctx.db
      .prepare(`UPDATE queue_entries SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => sets[k] as any), id);
  };

  tx(ctx.db, () => {
    switch (action) {
      case 'call': {
        if (!['waiting', 'paused'].includes(entry.status)) throw conflict(`Cannot call a ${entry.status.replace('_', ' ')} patient.`);
        update({ status: 'called' });
        if (entry.appointment_id) ctx.db.prepare("UPDATE appointments SET status = 'in_queue', updated_at = ? WHERE id = ? AND status IN ('scheduled','confirmed','arrived')").run(nowISO(), entry.appointment_id);
        break;
      }
      case 'start': {
        if (!['called', 'waiting', 'paused'].includes(entry.status)) throw conflict(`Cannot start treatment from "${entry.status}".`);
        if (entry.dentist_id) {
          const busy = ctx.db
            .prepare("SELECT queue_no FROM queue_entries WHERE day = ? AND dentist_id = ? AND status = 'in_treatment' AND id != ?")
            .get(entry.day, entry.dentist_id, id) as { queue_no: number } | undefined;
          if (busy) throw conflict(`This dentist is already with queue #${busy.queue_no}. Complete or transfer that patient first.`);
        }
        update({ status: 'in_treatment', started_at: entry.started_at ?? nowISO() });
        if (entry.appointment_id) ctx.db.prepare("UPDATE appointments SET status = 'in_treatment', updated_at = ? WHERE id = ? AND status NOT IN ('completed','cancelled','no_show','rescheduled')").run(nowISO(), entry.appointment_id);
        break;
      }
      case 'pause': {
        if (!['waiting', 'called', 'in_treatment'].includes(entry.status)) throw conflict(`Cannot pause a ${entry.status.replace('_', ' ')} entry.`);
        update({ status: 'paused' });
        break;
      }
      case 'resume': {
        if (entry.status !== 'paused') throw conflict('Only paused entries can be resumed.');
        update({ status: entry.started_at ? 'in_treatment' : 'called' });
        break;
      }
      case 'complete': {
        if (['completed', 'cancelled'].includes(entry.status)) throw conflict('Entry already finished.');
        update({ status: 'completed', finished_at: nowISO() });
        if (entry.appointment_id) ctx.db.prepare("UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ? AND status NOT IN ('completed','cancelled','no_show','rescheduled')").run(nowISO(), entry.appointment_id);
        break;
      }
      case 'cancel': {
        if (['completed', 'cancelled'].includes(entry.status)) throw conflict('Entry already finished.');
        update({ status: 'cancelled', finished_at: nowISO() });
        // Keep the linked appointment truthful — don't strand it in in_queue/in_treatment.
        if (entry.appointment_id) {
          ctx.db
            .prepare("UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('in_queue','in_treatment','arrived','confirmed','scheduled')")
            .run(nowISO(), entry.appointment_id);
        }
        break;
      }
      case 'transfer': {
        const dentistId = reqInt(payload?.dentistId, 'Target dentist', { min: 1 });
        const dentist = ctx.db.prepare('SELECT id FROM dentists WHERE id = ? AND active = 1').get(dentistId);
        if (!dentist) throw validation('Target dentist not found.');
        update({ dentist_id: dentistId, transferred_to: dentistId, status: entry.status === 'in_treatment' ? 'called' : entry.status });
        break;
      }
      case 'priority': {
        const priority = Math.max(0, Math.min(5, Number(payload?.priority) || 0));
        update({ priority });
        break;
      }
      default:
        throw validation('Unknown queue action.');
    }
    audit(ctx, { action: `queue.${action}`, entityType: 'queue', entityId: id, summary: `Queue #${entry.queue_no}: ${action}` });
  });

  return toQueueDTO(ctx, loadRow(ctx, id));
}

export function reorderQueue(ctx: Ctx, orderedIds: number[]): { ok: true } {
  requirePermission(ctx, 'queue.manage');
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) throw validation('Order list is required.');
  if (orderedIds.length > 500) throw validation('Too many entries.');
  tx(ctx.db, () => {
    const stmt = ctx.db.prepare('UPDATE queue_entries SET reorder_index = ? WHERE id = ? AND day = ?');
    orderedIds.forEach((qid, idx) => stmt.run(idx, qid, todayISO()));
    audit(ctx, { action: 'queue.reorder', entityType: 'queue', entityId: null, summary: `Reordered queue (${orderedIds.length} entries)` });
  });
  return { ok: true };
}
