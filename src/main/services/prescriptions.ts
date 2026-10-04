import type { Ctx } from '../core/context';
import type { Paged, PrescriptionDTO, PrescriptionItemDTO } from '../../shared/types';
import { notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nextPrescriptionNumber } from '../core/sequences';
import { optString, pageParams, reqDate, reqInt, reqString, oneOf } from '../core/validate';
import { nowISO, todayISO } from '../../shared/currency';

interface ItemRow {
  id?: number; seq: number; medicine_name: string; generic: string | null; form: string | null;
  strength: string | null; dosage: string | null; frequency: string | null;
  morning: number; afternoon: number; night: number; timing: string;
  duration: string | null; qty: string | null; instruction: string | null;
  instruction_bn: string | null; note: string | null;
}

interface RxRow {
  id: number; number: string; patient_id: number; patient_name: string; patient_code: string;
  visit_id: number | null; dentist_id: number; dentist_name: string; date: string;
  c_c: string | null; o_e: string | null; r_e: string | null; diagnosis: string | null;
  treatment: string | null; advice: string | null; follow_up: string | null; created_at: string;
}

function toItemDTO(r: ItemRow): PrescriptionItemDTO {
  return {
    id: r.id, seq: r.seq, medicineName: r.medicine_name, generic: r.generic, form: r.form,
    strength: r.strength, dosage: r.dosage, frequency: r.frequency,
    morning: !!r.morning, afternoon: !!r.afternoon, night: !!r.night,
    timing: r.timing as PrescriptionItemDTO['timing'], duration: r.duration, qty: r.qty,
    instruction: r.instruction, instructionBn: r.instruction_bn, note: r.note,
  };
}

const SELECT_RX = `
  SELECT rx.*, p.name patient_name, p.code patient_code, d.name dentist_name
  FROM prescriptions rx
  JOIN patients p ON p.id = rx.patient_id
  JOIN dentists d ON d.id = rx.dentist_id`;

function hydrate(ctx: Ctx, row: RxRow): PrescriptionDTO {
  const items = ctx.db
    .prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY seq')
    .all(row.id) as ItemRow[];
  return {
    id: row.id, number: row.number, patientId: row.patient_id, patientName: row.patient_name,
    patientCode: row.patient_code, visitId: row.visit_id, dentistId: row.dentist_id,
    dentistName: row.dentist_name, date: row.date, cC: row.c_c, oE: row.o_e, rE: row.r_e,
    diagnosis: row.diagnosis, treatment: row.treatment, advice: row.advice,
    followUp: row.follow_up, items: items.map(toItemDTO), createdAt: row.created_at,
  };
}

export function listPrescriptions(ctx: Ctx, filter: { patientId?: number; range?: string; page?: number; pageSize?: number }): Paged<PrescriptionDTO> {
  requirePermission(ctx, 'clinical.view');
  const { page, pageSize, offset } = pageParams(filter.page, filter.pageSize);
  const where: string[] = ['rx.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filter.patientId) { where.push('rx.patient_id = ?'); params.push(filter.patientId); }
  if (filter.range && filter.range !== 'all') {
    const days = filter.range === 'today' ? 1 : Number(filter.range);
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    where.push('rx.date >= ?');
    params.push(todayISO(start));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = Number(ctx.db.prepare(`SELECT COUNT(*) c FROM prescriptions rx ${whereSql}`).get(...params as any[])!['c']);
  const rows = ctx.db
    .prepare(`${SELECT_RX} ${whereSql} ORDER BY rx.date DESC, rx.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as RxRow[];
  return { items: rows.map((r) => hydrate(ctx, r)), total, page, pageSize };
}

export function getPrescription(ctx: Ctx, id: number): PrescriptionDTO {
  requirePermission(ctx, 'clinical.view');
  const row = ctx.db.prepare(`${SELECT_RX} WHERE rx.id = ? AND rx.deleted_at IS NULL`).get(id) as RxRow | undefined;
  if (!row) throw notFound('Prescription not found.');
  return hydrate(ctx, row);
}

export function deletePrescription(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'data.delete');
  const row = ctx.db.prepare('SELECT id, number, patient_id FROM prescriptions WHERE id = ? AND deleted_at IS NULL').get(id) as { id: number; number: string; patient_id: number } | undefined;
  if (!row) throw notFound('Prescription not found.');
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE prescriptions SET deleted_at = ? WHERE id = ?').run(nowISO(), id);
    audit(ctx, {
      action: 'prescription.delete', entityType: 'prescription', entityId: id,
      summary: `Prescription ${row.number} deleted manually`,
      before: { number: row.number, patientId: row.patient_id },
    });
  });
  return { ok: true };
}

export interface PrescriptionInput {
  patientId: number; visitId?: number | null; dentistId: number; date?: string;
  cC?: string | null; oE?: string | null; rE?: string | null;
  diagnosis?: string | null; treatment?: string | null; advice?: string | null; followUp?: string | null;
  items: Partial<PrescriptionItemDTO>[];
  saveAsTemplate?: string | null;
}

export function createPrescription(ctx: Ctx, raw: unknown): PrescriptionDTO {
  requirePermission(ctx, 'clinical.prescription.create');
  const input = raw as PrescriptionInput;
  const patientId = Number(input?.patientId);
  const patient = ctx.db.prepare('SELECT id, code FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId) as { id: number; code: string } | undefined;
  if (!patient) throw validation('Select a valid patient.');
  const dentistId = reqInt(input?.dentistId, 'Prescribing dentist', { min: 1 });
  const dentist = ctx.db.prepare('SELECT id FROM dentists WHERE id = ? AND active = 1').get(dentistId);
  if (!dentist) throw validation('Select a valid dentist.');

  const items = Array.isArray(input?.items) ? input.items : [];
  if (items.length === 0) throw validation('Add at least one medicine.');
  if (items.length > 60) throw validation('A prescription may contain at most 60 medicines.');
  const cleanItems = items.map((it, i) => ({
    seq: i + 1,
    medicineName: reqString(it.medicineName, `Medicine #${i + 1} name`, { max: 200 }),
    generic: optString(it.generic, 'Generic', { max: 200 }),
    form: optString(it.form, 'Dosage form', { max: 40 }),
    strength: optString(it.strength, 'Strength', { max: 60 }),
    dosage: optString(it.dosage, 'Dosage', { max: 60 }),
    frequency: optString(it.frequency, 'Frequency', { max: 80 }),
    morning: it.morning ? 1 : 0, afternoon: it.afternoon ? 1 : 0, night: it.night ? 1 : 0,
    timing: it.timing ? oneOf(it.timing, ['before', 'after', 'na'] as const, 'Food timing') : 'na',
    duration: optString(it.duration, 'Duration', { max: 60 }),
    qty: optString(it.qty, 'Quantity', { max: 40 }),
    instruction: optString(it.instruction, 'Instruction', { max: 500 }),
    instructionBn: optString(it.instructionBn, 'Bengali instruction', { max: 500 }),
    note: optString(it.note, 'Note', { max: 500 }),
  }));

  const date = input.date ? reqDate(input.date, 'Prescription date') : todayISO();
  const id = tx(ctx.db, () => {
    const number = nextPrescriptionNumber(ctx.db, date);
    const info = ctx.db
      .prepare(
        `INSERT INTO prescriptions (number, patient_id, visit_id, dentist_id, date, c_c, o_e, r_e,
           diagnosis, treatment, advice, follow_up, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        number, patientId, input.visitId ?? null, dentistId, date,
        optString(input.cC, 'C/C', { max: 20000 }),
        optString(input.oE, 'O/E', { max: 20000 }),
        optString(input.rE, 'R/E', { max: 20000 }),
        optString(input.diagnosis, 'Diagnosis', { max: 4000 }),
        optString(input.treatment, 'Treatment', { max: 20000 }),
        optString(input.advice, 'Advice', { max: 20000 }),
        optString(input.followUp, 'Follow-up', { max: 200 }),
        ctx.session.userId, nowISO(),
      );
    const rxId = Number(info.lastInsertRowid);
    const insItem = ctx.db.prepare(
      `INSERT INTO prescription_items (prescription_id, seq, medicine_name, generic, form, strength, dosage,
         frequency, morning, afternoon, night, timing, duration, qty, instruction, instruction_bn, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const it of cleanItems) {
      insItem.run(rxId, it.seq, it.medicineName, it.generic, it.form, it.strength, it.dosage,
        it.frequency, it.morning, it.afternoon, it.night, it.timing, it.duration, it.qty,
        it.instruction, it.instructionBn, it.note);
    }
    if (input.saveAsTemplate) {
      const tName = reqString(input.saveAsTemplate, 'Template name', { max: 120 });
      ctx.db.prepare(
        `INSERT INTO medicine_templates (name, items_json, created_by, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET items_json = excluded.items_json`,
      ).run(tName, JSON.stringify(cleanItems), ctx.session.userId, nowISO());
    }
    audit(ctx, { action: 'prescription.create', entityType: 'prescription', entityId: rxId, summary: `Prescription ${number} for ${patient.code}`, after: { medicines: cleanItems.length } });
    return rxId;
  });
  return getPrescription(ctx, id);
}

export function listTemplates(ctx: Ctx): { id: number; name: string; items: any[] }[] {
  requirePermission(ctx, 'clinical.prescription.create');
  return ctx.db
    .prepare('SELECT id, name, items_json FROM medicine_templates ORDER BY name')
    .all<{ id: number; name: string; items_json: string }>()
    .map((t) => ({ id: t.id, name: t.name, items: JSON.parse(t.items_json) }));
}

export function saveTemplate(ctx: Ctx, name: string, items: any[]): { id: number } {
  requirePermission(ctx, 'clinical.prescription.create');
  const tName = reqString(name, 'Template name', { max: 120 });
  if (!Array.isArray(items) || items.length === 0) throw validation('Template needs at least one medicine.');
  const info = ctx.db
    .prepare(
      `INSERT INTO medicine_templates (name, items_json, created_by, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET items_json = excluded.items_json RETURNING id`,
    )
    .get(tName, JSON.stringify(items), ctx.session.userId, nowISO()) as { id: number };
  audit(ctx, { action: 'prescription.template_save', entityType: 'medicine_template', entityId: info.id, summary: `Saved medicine template "${tName}"` });
  return { id: info.id };
}
