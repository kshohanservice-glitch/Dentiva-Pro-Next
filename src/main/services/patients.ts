import type { DB } from '../db/database';
import type { Ctx, PlainCtx } from '../core/context';
import type { DuplicateCandidate, PatientDTO, PatientDetailDTO, PatientFilters, Paged } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, hasPermission, requirePermission, tx } from '../core/context';
import { nextPatientCode } from '../core/sequences';
import {
  escapeLike, optDate, optPhone, optString, oneOf, pageParams, reqDate, reqInt, reqString,
} from '../core/validate';
import { dateRangeFor, todayISO } from '../../shared/currency';
import { BLOOD_GROUPS, GENDERS } from '../../shared/clinical';

interface PatientRow {
  id: number; code: string; name: string; bengali_name: string | null; dob: string | null;
  age_years: number | null; gender: string; blood_group: string | null;
  phone: string | null; phone2: string | null; emergency_contact: string | null;
  emergency_phone: string | null; address: string | null; city: string | null;
  chief_complaint: string | null; referred_by: string | null;
  preferred_dentist_id: number | null; status: string; registration_date: string;
  created_at: string; updated_at: string;
  last_visit_at: string | null; visit_count: number;
}

const HISTORY_KINDS = ['chief', 'previous', 'allergies', 'medications', 'medical', 'dental', 'notes'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export interface PatientInput {
  code?: string | null; name: string; bengaliName?: string | null;
  dob?: string | null; ageYears?: number | null; gender: string; bloodGroup?: string | null;
  phone?: string | null; phone2?: string | null;
  emergencyContact?: string | null; emergencyPhone?: string | null;
  address?: string | null; city?: string | null;
  chiefComplaint?: string | null; referredBy?: string | null; preferredDentistId?: number | null;
  status?: string; registrationDate?: string | null; tags?: string[];
  histories?: Partial<Record<HistoryKind, string | null>>;
  forceCreate?: boolean;
}

function toDTO(row: PatientRow, tags: string[]): PatientDTO {
  return {
    id: row.id, code: row.code, name: row.name, bengaliName: row.bengali_name,
    dob: row.dob, ageYears: row.age_years, ageText: row.dob ? null : row.age_years != null ? `${row.age_years} yrs` : null,
    gender: row.gender, bloodGroup: row.blood_group, phone: row.phone, phone2: row.phone2,
    emergencyContact: row.emergency_contact, emergencyPhone: row.emergency_phone,
    address: row.address, city: row.city, chiefComplaint: row.chief_complaint,
    referredBy: row.referred_by, preferredDentistId: row.preferred_dentist_id,
    status: row.status as PatientDTO['status'], tags,
    registrationDate: row.registration_date, createdAt: row.created_at, updatedAt: row.updated_at,
    lastVisitAt: row.last_visit_at, visitCount: row.visit_count,
  };
}

function tagsOf(db: DB, patientId: number): string[] {
  return db
    .prepare('SELECT t.name FROM patient_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.patient_id = ? ORDER BY t.name')
    .all<{ name: string }>(patientId)
    .map((r) => r.name);
}

const SELECT_PATIENT = `
  SELECT p.*, 
    (SELECT MAX(datetime) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) last_visit_at,
    (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.deleted_at IS NULL) visit_count
  FROM patients p`;

export function listPatients(ctx: Ctx, filters: PatientFilters): Paged<PatientDTO> {
  requirePermission(ctx, 'patients.view');
  const { page, pageSize, offset } = pageParams(filters.page, filters.pageSize);
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];

  const range = filters.range ?? 'today';
  const { from, to } = dateRangeFor(range, filters.from, filters.to);
  if (from) { where.push('p.registration_date >= ?'); params.push(from); }
  if (to) { where.push('p.registration_date <= ?'); params.push(to); }
  if (filters.status) { where.push('p.status = ?'); params.push(filters.status); }
  if (filters.dentistId) { where.push('p.preferred_dentist_id = ?'); params.push(filters.dentistId); }
  if (filters.query && filters.query.trim()) {
    const q = `%${escapeLike(filters.query.trim().toLowerCase())}%`;
    where.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(p.bengali_name,'')) LIKE ? ESCAPE '\\' OR LOWER(p.code) LIKE ? ESCAPE '\\' OR COALESCE(p.phone,'') LIKE ? ESCAPE '\\' OR COALESCE(p.phone2,'') LIKE ? ESCAPE '\\')");
    params.push(q, q, q, q, q);
  }

  const sortMap: Record<string, string> = {
    name: 'p.name', code: 'p.code', created: 'p.registration_date',
    lastVisit: 'last_visit_at', status: 'p.status',
  };
  const sortCol = sortMap[filters.sort ?? 'created'] ?? 'p.registration_date';
  const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(
    ctx.db.prepare(`SELECT COUNT(*) c FROM patients p ${whereSql}`).get(...params as any[])!['c'],
  );
  const rows = ctx.db
    .prepare(`${SELECT_PATIENT} ${whereSql} ORDER BY ${sortCol} ${dir} NULLS LAST, p.id DESC LIMIT ? OFFSET ?`)
    .all(...params as any[], pageSize, offset) as PatientRow[];

  return { items: rows.map((r) => toDTO(r, tagsOf(ctx.db, r.id))), total, page, pageSize };
}

export function getPatient(ctx: Ctx, id: number): PatientDetailDTO {
  requirePermission(ctx, 'patients.view');
  const row = ctx.db.prepare(`${SELECT_PATIENT} WHERE p.id = ? AND p.deleted_at IS NULL`).get(id) as PatientRow | undefined;
  if (!row) throw notFound('Patient not found.');
  const histories: Record<string, string | null> = {};
  const hRows = ctx.db
    .prepare('SELECT kind, content FROM patient_histories WHERE patient_id = ?')
    .all<{ kind: string; content: string }>(id);
  for (const h of hRows) histories[h.kind] = h.content;

  const dentist = row.preferred_dentist_id
    ? ctx.db.prepare('SELECT name FROM dentists WHERE id = ?').get<{ name: string }>(row.preferred_dentist_id)
    : undefined;

  return {
    ...toDTO(row, tagsOf(ctx.db, id)),
    previousProblems: histories.previous ?? null,
    allergies: histories.allergies ?? null,
    medications: histories.medications ?? null,
    medicalHistory: histories.medical ?? null,
    dentalHistory: histories.dental ?? null,
    notes: histories.notes ?? null,
    preferredDentistName: dentist?.name ?? null,
  };
}

function computeAge(dob: string): number {
  const birth = new Date(`${dob}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

export function findDuplicates(db: DB, input: Partial<PatientInput> & { id?: number }): DuplicateCandidate[] {
  const results = new Map<number, DuplicateCandidate>();
  const consider = (row: { id: number; code: string; name: string; phone: string | null }, reason: string, score: number) => {
    if (input.id && row.id === input.id) return;
    const existing = results.get(row.id);
    if (!existing || existing.score < score) results.set(row.id, { ...row, reason, score });
  };

  if (input.phone) {
    const rows = db
      .prepare('SELECT id, code, name, phone FROM patients WHERE deleted_at IS NULL AND (phone = ? OR phone2 = ?)')
      .all<{ id: number; code: string; name: string; phone: string | null }>(input.phone, input.phone);
    for (const r of rows) consider(r, 'Same phone number', 90);
  }
  if (input.name && (input.dob || input.phone)) {
    const rows = db
      .prepare('SELECT id, code, name, phone, dob FROM patients WHERE deleted_at IS NULL AND LOWER(name) = LOWER(?)')
      .all<{ id: number; code: string; name: string; phone: string | null; dob: string | null }>(input.name);
    for (const r of rows) {
      if (input.dob && r.dob === input.dob) consider(r, 'Same name and date of birth', 95);
      else if (input.phone && r.phone === input.phone) consider(r, 'Same name and phone', 90);
      else consider(r, 'Same name', 60);
    }
  }
  if (input.code) {
    const r = db.prepare('SELECT id, code, name, phone FROM patients WHERE code = ?').get<{ id: number; code: string; name: string; phone: string | null }>(input.code);
    if (r) consider(r, 'Same patient code', 100);
  }
  return [...results.values()].sort((a, b) => b.score - a.score);
}

export function checkDuplicates(ctx: Ctx, input: Partial<PatientInput>): DuplicateCandidate[] {
  requirePermission(ctx, 'patients.view');
  return findDuplicates(ctx.db, input);
}

export function createPatient(ctx: Ctx, raw: unknown): PatientDTO {
  requirePermission(ctx, 'patients.create');
  const input = raw as PatientInput;
  const name = reqString(input?.name, 'Patient name', { min: 2, max: 160 });
  const gender = oneOf(input?.gender ?? 'other', [...GENDERS, 'unknown'] as string[], 'Gender');
  const blood = input?.bloodGroup ? oneOf(input.bloodGroup, BLOOD_GROUPS, 'Blood group') : null;

  const dob = optDate(input?.dob, 'Date of birth');
  let ageYears = input?.ageYears != null && input.ageYears !== ('' as any) ? reqInt(input.ageYears, 'Age', { min: 0, max: 130 }) : null;
  if (dob) ageYears = computeAge(dob);
  if (!dob && ageYears === null) throw validation('Either date of birth or age is required.');

  const phone = optPhone(input?.phone, 'Phone');
  const phone2 = optPhone(input?.phone2, 'Alternate phone');
  if (!phone && !phone2) throw validation('At least one phone number is required for a patient.');

  const manualCode = input?.code ? reqString(input.code, 'Patient code', { max: 40 }) : null;

  const candidates = findDuplicates(ctx.db, { ...input, name });
  const strong = candidates.filter((c) => c.score >= 90);
  if (strong.length > 0 && !input.forceCreate) {
    throw conflict('A similar patient already exists. Review the possible duplicates, then confirm to create anyway.');
  }

  const now = new Date().toISOString();
  const registrationDate = input?.registrationDate ? reqDate(input.registrationDate, 'Registration date') : todayISO();

  const id = tx(ctx.db, () => {
    if (manualCode) {
      const dup = ctx.db.prepare('SELECT 1 FROM patients WHERE code = ?').get(manualCode);
      if (dup) throw conflict(`Patient code "${manualCode}" is already in use.`);
    }
    const code = manualCode ?? nextPatientCode(ctx.db);
    const info = ctx.db
      .prepare(
        `INSERT INTO patients (code, name, bengali_name, dob, age_years, gender, blood_group, phone, phone2,
           emergency_contact, emergency_phone, address, city, chief_complaint, referred_by,
           preferred_dentist_id, status, registration_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code, name, optString(input.bengaliName, 'Bengali name', { max: 160 }), dob, ageYears, gender, blood,
        phone, phone2,
        optString(input.emergencyContact, 'Emergency contact', { max: 160 }),
        optPhone(input.emergencyPhone, 'Emergency phone'),
        optString(input.address, 'Address', { max: 500 }),
        optString(input.city, 'City', { max: 100 }),
        optString(input.chiefComplaint, 'Chief complaint', { max: 1000 }),
        optString(input.referredBy, 'Referred by', { max: 200 }),
        input.preferredDentistId != null ? reqInt(input.preferredDentistId, 'Preferred dentist') : null,
        oneOf(input.status ?? 'active', ['active', 'archived', 'blocked'] as const, 'Status'),
        registrationDate, now, now,
      );
    const patientId = Number(info.lastInsertRowid);

    // History notes
    if (input.histories) {
      for (const kind of HISTORY_KINDS) {
        const content = optString(input.histories[kind], 'Notes');
        if (content) {
          ctx.db.prepare('INSERT INTO patient_histories (patient_id, kind, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
            .run(patientId, kind, content, now, ctx.session.userId);
        }
      }
    }
    // Tags
    if (Array.isArray(input.tags)) {
      for (const t of input.tags.slice(0, 20)) {
        const tagName = optString(t, 'Tag', { max: 40 });
        if (!tagName) continue;
        ctx.db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(tagName);
        const tagRow = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get<{ id: number }>(tagName)!;
        ctx.db.prepare('INSERT OR IGNORE INTO patient_tags (patient_id, tag_id) VALUES (?, ?)').run(patientId, tagRow.id);
      }
    }
    audit(ctx, { action: 'patient.create', entityType: 'patient', entityId: patientId, summary: `Registered patient ${name} (${code})`, after: { name, code, phone } });
    return patientId;
  });

  return getPatient(ctx, id);
}

export function updatePatient(ctx: Ctx, id: number, raw: unknown): PatientDTO {
  requirePermission(ctx, 'patients.edit');
  const input = raw as PatientInput;
  const existing = ctx.db.prepare('SELECT * FROM patients WHERE id = ? AND deleted_at IS NULL').get(id) as PatientRow | undefined;
  if (!existing) throw notFound('Patient not found.');

  const name = reqString(input?.name, 'Patient name', { min: 2, max: 160 });
  const gender = oneOf(input?.gender ?? existing.gender, [...GENDERS, 'unknown'] as string[], 'Gender');
  const blood = input?.bloodGroup ? oneOf(input.bloodGroup, BLOOD_GROUPS, 'Blood group') : existing.blood_group;

  const dob = input?.dob !== undefined ? optDate(input.dob, 'Date of birth') : existing.dob;
  let ageYears = existing.age_years;
  if (dob) ageYears = computeAge(dob);
  else if (input?.ageYears !== undefined && input.ageYears !== null && input.ageYears !== ('' as any)) {
    ageYears = reqInt(input.ageYears, 'Age', { min: 0, max: 130 });
  }
  if (!dob && ageYears === null) throw validation('Either date of birth or age is required.');

  const phone = input?.phone !== undefined ? optPhone(input.phone, 'Phone') : existing.phone;
  const phone2 = input?.phone2 !== undefined ? optPhone(input.phone2, 'Alternate phone') : existing.phone2;
  if (!phone && !phone2) throw validation('At least one phone number is required for a patient.');

  tx(ctx.db, () => {
    ctx.db
      .prepare(
        `UPDATE patients SET name = ?, bengali_name = ?, dob = ?, age_years = ?, gender = ?, blood_group = ?,
           phone = ?, phone2 = ?, emergency_contact = ?, emergency_phone = ?, address = ?, city = ?,
           chief_complaint = ?, referred_by = ?, preferred_dentist_id = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name,
        input.bengaliName !== undefined ? optString(input.bengaliName, 'Bengali name', { max: 160 }) : existing.bengali_name,
        dob, ageYears, gender, blood,
        phone, phone2,
        input.emergencyContact !== undefined ? optString(input.emergencyContact, 'Emergency contact', { max: 160 }) : existing.emergency_contact,
        input.emergencyPhone !== undefined ? optPhone(input.emergencyPhone, 'Emergency phone') : existing.emergency_phone,
        input.address !== undefined ? optString(input.address, 'Address', { max: 500 }) : existing.address,
        input.city !== undefined ? optString(input.city, 'City', { max: 100 }) : existing.city,
        input.chiefComplaint !== undefined ? optString(input.chiefComplaint, 'Chief complaint', { max: 1000 }) : existing.chief_complaint,
        input.referredBy !== undefined ? optString(input.referredBy, 'Referred by', { max: 200 }) : existing.referred_by,
        input.preferredDentistId !== undefined
          ? input.preferredDentistId != null ? reqInt(input.preferredDentistId, 'Preferred dentist') : null
          : existing.preferred_dentist_id,
        oneOf(input.status ?? existing.status, ['active', 'archived', 'blocked'] as const, 'Status'),
        new Date().toISOString(),
        id,
      );

    if (input.histories) {
      for (const kind of HISTORY_KINDS) {
        if (!(kind in input.histories)) continue;
        const content = optString(input.histories[kind], 'Notes');
        if (content) {
          ctx.db.prepare(
            `INSERT INTO patient_histories (patient_id, kind, content, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(patient_id, kind) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          ).run(id, kind, content, new Date().toISOString(), ctx.session.userId);
        } else {
          ctx.db.prepare('DELETE FROM patient_histories WHERE patient_id = ? AND kind = ?').run(id, kind);
        }
      }
    }
    if (Array.isArray(input.tags)) {
      ctx.db.prepare('DELETE FROM patient_tags WHERE patient_id = ?').run(id);
      for (const t of input.tags.slice(0, 20)) {
        const tagName = optString(t, 'Tag', { max: 40 });
        if (!tagName) continue;
        ctx.db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(tagName);
        const tagRow = ctx.db.prepare('SELECT id FROM tags WHERE name = ?').get<{ id: number }>(tagName)!;
        ctx.db.prepare('INSERT OR IGNORE INTO patient_tags (patient_id, tag_id) VALUES (?, ?)').run(id, tagRow.id);
      }
    }
    audit(ctx, {
      action: 'patient.update', entityType: 'patient', entityId: id,
      summary: `Updated patient ${name} (${existing.code})`,
      before: { name: existing.name, phone: existing.phone, status: existing.status },
      after: { name, phone, status: input.status ?? existing.status },
    });
  });
  return getPatient(ctx, id);
}

/** Archive (soft) — clinical history is preserved; not a hard delete. */
export function deletePatient(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'patients.delete');
  const row = ctx.db.prepare('SELECT name, code FROM patients WHERE id = ? AND deleted_at IS NULL').get(id) as { name: string; code: string } | undefined;
  if (!row) throw notFound('Patient not found.');
  tx(ctx.db, () => {
    const now = new Date().toISOString();
    ctx.db.prepare('UPDATE patients SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(now, 'archived', now, id);
    audit(ctx, {
      action: 'patient.delete', entityType: 'patient', entityId: id,
      summary: `Deleted patient ${row.name} (${row.code}) — clinical and billing history preserved`,
    });
  });
  return { ok: true };
}

export function archivePatient(ctx: Ctx, id: number): { ok: boolean } {
  requirePermission(ctx, 'patients.delete');
  const row = ctx.db.prepare('SELECT name, code, status FROM patients WHERE id = ? AND deleted_at IS NULL').get(id) as { name: string; code: string; status: string } | undefined;
  if (!row) throw notFound('Patient not found.');
  const nextStatus = row.status === 'archived' ? 'active' : 'archived';
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE patients SET status = ?, updated_at = ? WHERE id = ?')
      .run(nextStatus, new Date().toISOString(), id);
    audit(ctx, {
      action: nextStatus === 'archived' ? 'patient.archive' : 'patient.restore',
      entityType: 'patient', entityId: id,
      summary: `${nextStatus === 'archived' ? 'Archived' : 'Restored'} patient ${row.name} (${row.code})`,
    });
  });
  return { ok: true };
}

/* ----------------------------- Timeline ------------------------------ */

interface TimelineEvent {
  at: string; type: string; title: string; summary: string;
  linkEntity: string | null; linkId: number | null; actor: string | null;
}

export function patientTimeline(ctx: Ctx, patientId: number): TimelineEvent[] {
  requirePermission(ctx, 'patients.view');
  const patient = ctx.db.prepare('SELECT id, name, code, registration_date, created_at FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');

  const events: TimelineEvent[] = [];
  const push = (e: TimelineEvent) => events.push(e);

  push({
    at: (patient as any).created_at, type: 'registration', title: 'Patient registered',
    summary: `Code ${(patient as any).code}`, linkEntity: null, linkId: null, actor: null,
  });

  for (const v of ctx.db.prepare(
    `SELECT v.id, v.datetime, v.chief_complaint, v.diagnosis, v.status, u.display_name, d.name dentist
     FROM visits v JOIN users u ON u.id = v.created_by LEFT JOIN dentists d ON d.id = v.dentist_id
     WHERE v.patient_id = ? AND v.deleted_at IS NULL ORDER BY v.datetime`,
  ).all<any>(patientId)) {
    push({
      at: v.datetime, type: 'visit', title: v.diagnosis ? `Visit — ${v.diagnosis}` : 'Visit',
      summary: v.chief_complaint || '', linkEntity: 'visit', linkId: v.id,
      actor: v.dentist || v.display_name,
    });
  }

  for (const a of ctx.db.prepare(
    `SELECT id, date, time, status, type, notes FROM appointments WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date, time`,
  ).all<any>(patientId)) {
    push({
      at: `${a.date}T${a.time}:00.000Z`, type: 'appointment', title: `Appointment (${a.status.replace('_', ' ')})`,
      summary: a.type, linkEntity: 'appointment', linkId: a.id, actor: null,
    });
  }

  for (const p of ctx.db.prepare(
    `SELECT p.id, p.number, p.date, p.diagnosis, u.display_name FROM prescriptions p JOIN users u ON u.id = p.created_by
     WHERE p.patient_id = ? AND p.deleted_at IS NULL ORDER BY p.date`,
  ).all<any>(patientId)) {
    push({
      at: `${p.date}T12:00:00.000Z`, type: 'prescription', title: `Prescription ${p.number}`,
      summary: p.diagnosis || '', linkEntity: 'prescription', linkId: p.id, actor: p.display_name,
    });
  }

  if (hasPermission(ctx, 'billing.invoice.view')) {
    for (const inv of ctx.db.prepare(
      `SELECT id, number, date, status, total_paisa FROM invoices WHERE patient_id = ? AND deleted_at IS NULL ORDER BY date`,
    ).all<any>(patientId)) {
      push({
        at: `${inv.date}T12:00:00.000Z`, type: 'invoice', title: `Invoice ${inv.number}`,
        summary: `${inv.status} · total ${(inv.total_paisa / 100).toFixed(2)}`,
        linkEntity: 'invoice', linkId: inv.id, actor: null,
      });
    }
  }
  if (hasPermission(ctx, 'billing.payment.view')) {
    for (const pay of ctx.db.prepare(
      `SELECT id, amount_paisa, paid_at, method, type, invoice_id FROM payments WHERE patient_id = ? ORDER BY paid_at`,
    ).all<any>(patientId)) {
      push({
        at: pay.paid_at, type: 'payment',
        title: pay.type === 'refund' ? 'Refund recorded' : 'Payment recorded',
        summary: `${(pay.amount_paisa / 100).toFixed(2)} BDT via ${pay.method}`,
        linkEntity: pay.invoice_id ? 'invoice' : null, linkId: pay.invoice_id, actor: null,
      });
    }
  }

  for (const r of ctx.db.prepare(
    `SELECT id, direction, person, clinic, reason, date, status FROM referrals WHERE patient_id = ? ORDER BY date`,
  ).all<any>(patientId)) {
    push({
      at: `${r.date}T12:00:00.000Z`, type: 'referral',
      title: r.direction === 'out' ? 'Referral sent' : 'Referral received',
      summary: [r.person, r.clinic, r.reason].filter(Boolean).join(' · '),
      linkEntity: 'referral', linkId: r.id, actor: null,
    });
  }

  for (const ch of ctx.db.prepare(
    `SELECT recorded_at, recorded_by, COUNT(*) n FROM tooth_conditions WHERE patient_id = ?
     GROUP BY recorded_at, recorded_by ORDER BY recorded_at`,
  ).all<any>(patientId)) {
    push({
      at: ch.recorded_at, type: 'chart', title: 'Dental chart updated',
      summary: `${ch.n} tooth record${ch.n === 1 ? '' : 's'}`, linkEntity: null, linkId: null, actor: null,
    });
  }

  if (hasPermission(ctx, 'patients.sensitive')) {
    for (const att of ctx.db.prepare(
      `SELECT id, original_name, uploaded_at FROM attachments WHERE entity_type = 'patient' AND entity_id = ? ORDER BY uploaded_at`,
    ).all<any>(patientId)) {
      push({
        at: att.uploaded_at, type: 'attachment', title: `Attachment: ${att.original_name}`,
        summary: '', linkEntity: 'attachment', linkId: att.id, actor: null,
      });
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events;
}

/* ------------------------------ Export ------------------------------- */

export function patientCsvRows(ctx: Ctx, filters: PatientFilters): { header: string[]; rows: string[][] } {
  requirePermission(ctx, 'patients.view');
  requirePermission(ctx, 'data.export');
  const paged = listPatients(ctx, { ...filters, page: 1, pageSize: 50000 });
  return {
    header: ['Code', 'Name', 'Bengali name', 'Age', 'Gender', 'Blood group', 'Phone', 'City', 'Address', 'Status', 'Registered', 'Last visit', 'Visits'],
    rows: paged.items.map((p) => [
      p.code, p.name, p.bengaliName ?? '', p.dob ?? String(p.ageYears ?? ''), p.gender, p.bloodGroup ?? '',
      p.phone ?? '', p.city ?? '', p.address ?? '', p.status, p.registrationDate, p.lastVisitAt ?? '', String(p.visitCount),
    ]),
  };
}

export function plainFindDuplicates(db: DB, input: Partial<PatientInput>): DuplicateCandidate[] {
  return findDuplicates(db, input);
}
export type { PlainCtx };
