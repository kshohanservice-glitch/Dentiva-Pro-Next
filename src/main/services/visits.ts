import type { Ctx } from '../core/context';
import type { Paged, VisitDTO } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { optDate, optString, pageParams, reqDate } from '../core/validate';

interface VisitRow {
  id: number; patient_id: number; patient_name?: string; patient_code?: string;
  dentist_id: number | null; dentist_name: string | null; datetime: string;
  chief_complaint: string | null; history: string | null; examination: string | null;
  diagnosis: string | null; treatment_plan: string | null; advice: string | null;
  notes: string | null; follow_up_date: string | null; status: string;
  invoice_id: number | null; created_by: number; created_at: string;
}

function toDTO(ctx: Ctx, row: VisitRow): VisitDTO {
  const treatments = ctx.db
    .prepare('SELECT id, treatment_id, description, qty, unit_price_paisa, total_paisa FROM visit_treatments WHERE visit_id = ? ORDER BY id ASC')
    .all<{ id: number; treatment_id: number | null; description: string; qty: number; unit_price_paisa: number; total_paisa: number }>(row.id)
    .map((t) => ({
      id: t.id,
      treatmentId: t.treatment_id,
      description: t.description,
      qty: t.qty,
      unitPricePaisa: t.unit_price_paisa,
      totalPaisa: t.total_paisa,
    }));
  return {
    id: row.id, patientId: row.patient_id, patientName: row.patient_name, patientCode: row.patient_code,
    dentistId: row.dentist_id, dentistName: row.dentist_name, datetime: row.datetime,
    chiefComplaint: row.chief_complaint, diagnosis: row.diagnosis, treatmentPlan: row.treatment_plan,
    advice: row.advice, followUpDate: row.follow_up_date, status: row.status as VisitDTO['status'],
    invoiceId: row.invoice_id, createdBy: row.created_by, createdAt: row.created_at,
    examination: row.examination, history: row.history, notes: row.notes,
    treatments,
  };
}

const SELECT = `
  SELECT v.*, p.name patient_name, p.code patient_code, d.name dentist_name
  FROM visits v JOIN patients p ON p.id = v.patient_id
  LEFT JOIN dentists d ON d.id = v.dentist_id`;

export interface VisitInput {
  patientId: number; dentistId?: number | null; datetime?: string;
  chiefComplaint?: string | null; history?: string | null; examination?: string | null;
  diagnosis?: string | null; treatmentPlan?: string | null; advice?: string | null;
  notes?: string | null; followUpDate?: string | null; status?: string;
  treatments?: { treatmentId: number; qty?: number; unitPricePaisa?: number }[];
}

export function listVisits(ctx: Ctx, filter: { patientId?: number; range?: string; page?: number; pageSize?: number }): Paged<VisitDTO> {
  requirePermission(ctx, 'clinical.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where: string[] = ['v.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.patientId) { where.push('v.patient_id = ?'); params.push(filter.patientId); }
  if (filter.range && filter.range !== 'all') {
    const days = filter.range === 'today' ? 1 : Number(filter.range);
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    where.push('v.datetime >= ?');
    params.push(`${todayISO(start)}T00:00:00.000Z`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM visits v ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`${SELECT} ${whereSql} ORDER BY v.datetime DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as VisitRow[];
  return { items: rows.map((r) => toDTO(ctx, r)), total, page, pageSize };
}

export function getVisit(ctx: Ctx, id: number): VisitDTO {
  requirePermission(ctx, 'clinical.view');
  const row = ctx.db.prepare(`${SELECT} WHERE v.id = ? AND v.deleted_at IS NULL`).get(id) as VisitRow | undefined;
  if (!row) throw notFound('Visit not found.');
  return toDTO(ctx, row);
}

export function createVisit(ctx: Ctx, raw: unknown): VisitDTO {
  requirePermission(ctx, 'clinical.visit.create');
  const input = raw as VisitInput;
  const patientId = Number(input?.patientId);
  if (!patientId) throw validation('Patient is required.');
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');

  let datetime = new Date().toISOString();
  if (input.datetime) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?/.exec(String(input.datetime));
    if (!m) throw validation('Visit date/time must be a valid date and time.');
    const date = reqDate(m[1], 'Visit date');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(m[2])) throw validation('Visit date/time must be a valid date and time.');
    datetime = `${date}T${m[2]}:00.000Z`;
  }

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare(
        `INSERT INTO visits (patient_id, dentist_id, datetime, chief_complaint, history, examination,
           diagnosis, treatment_plan, advice, notes, follow_up_date, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        patientId,
        input.dentistId ? input.dentistId : null,
        datetime,
        optString(input.chiefComplaint, 'Chief complaint', { max: 4000 }),
        optString(input.history, 'History'),
        optString(input.examination, 'Examination'),
        optString(input.diagnosis, 'Diagnosis', { max: 4000 }),
        optString(input.treatmentPlan, 'Treatment plan'),
        optString(input.advice, 'Advice'),
        optString(input.notes, 'Notes'),
        optDate(input.followUpDate, 'Follow-up date'),
        input.status === 'closed' ? 'closed' : 'open',
        ctx.session.userId, nowISO(), nowISO(),
      );
    const visitId = Number(info.lastInsertRowid);
    if (Array.isArray(input.treatments)) {
      for (const t of input.treatments) {
        const cat = ctx.db.prepare('SELECT name, default_price_paisa FROM treatments WHERE id = ?').get<{ name: string; default_price_paisa: number }>(t.treatmentId);
        if (!cat) throw validation('One of the selected treatments no longer exists.');
        const qty = Math.max(1, Number(t.qty) || 1);
        const unit = t.unitPricePaisa != null ? Math.max(0, Math.round(t.unitPricePaisa)) : cat.default_price_paisa;
        ctx.db.prepare(
          'INSERT INTO visit_treatments (visit_id, treatment_id, description, qty, unit_price_paisa, total_paisa) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(visitId, t.treatmentId, cat.name, qty, unit, qty * unit);
      }
    }
    audit(ctx, { action: 'visit.create', entityType: 'visit', entityId: visitId, summary: `New visit for patient #${patientId}`, after: { diagnosis: input.diagnosis, datetime } });
    return visitId;
  });
  return getVisit(ctx, id);
}

export function updateVisit(ctx: Ctx, id: number, raw: unknown): VisitDTO {
  requirePermission(ctx, 'clinical.visit.edit');
  const existing = ctx.db.prepare('SELECT * FROM visits WHERE id = ? AND deleted_at IS NULL').get(id) as any | undefined;
  if (!existing) throw notFound('Visit not found.');
  if (existing.status === 'closed') {
    throw conflict('This visit is closed. Historical clinical records cannot be edited — create a new visit instead.');
  }
  const input = raw as VisitInput;

  tx(ctx.db, () => {
    ctx.db
      .prepare(
        `UPDATE visits SET dentist_id = ?, chief_complaint = ?, history = ?, examination = ?,
           diagnosis = ?, treatment_plan = ?, advice = ?, notes = ?, follow_up_date = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.dentistId !== undefined ? input.dentistId : existing.dentist_id,
        input.chiefComplaint !== undefined ? optString(input.chiefComplaint, 'Chief complaint', { max: 4000 }) : existing.chief_complaint,
        input.history !== undefined ? optString(input.history, 'History') : existing.history,
        input.examination !== undefined ? optString(input.examination, 'Examination') : existing.examination,
        input.diagnosis !== undefined ? optString(input.diagnosis, 'Diagnosis', { max: 4000 }) : existing.diagnosis,
        input.treatmentPlan !== undefined ? optString(input.treatmentPlan, 'Treatment plan') : existing.treatment_plan,
        input.advice !== undefined ? optString(input.advice, 'Advice') : existing.advice,
        input.notes !== undefined ? optString(input.notes, 'Notes') : existing.notes,
        input.followUpDate !== undefined ? optDate(input.followUpDate, 'Follow-up date') : existing.follow_up_date,
        input.status === 'closed' ? 'closed' : input.status === 'open' ? 'open' : existing.status,
        nowISO(),
        id,
      );
    audit(ctx, { action: 'visit.update', entityType: 'visit', entityId: id, summary: `Updated visit #${id}` });
  });
  return getVisit(ctx, id);
}
