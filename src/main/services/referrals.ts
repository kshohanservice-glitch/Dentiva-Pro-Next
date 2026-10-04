import type { Ctx } from '../core/context';
import { notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nowISO } from '../../shared/currency';
import { oneOf, optDate, optString, reqDate, reqString } from '../core/validate';

export function listReferrals(ctx: Ctx, patientId: number): any[] {
  requirePermission(ctx, 'clinical.view');
  return ctx.db
    .prepare(
      `SELECT r.*, u.display_name created_by_name FROM referrals r JOIN users u ON u.id = r.created_by
       WHERE r.patient_id = ? ORDER BY r.date DESC`,
    )
    .all(patientId) as any[];
}

export function saveReferral(ctx: Ctx, input: any): any {
  requirePermission(ctx, 'clinical.referral.manage');
  const patientId = Number(input?.patientId);
  if (!patientId) throw validation('Patient is required.');
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');

  const direction = oneOf(input.direction ?? 'out', ['in', 'out'] as const, 'Direction');
  const date = reqDate(input.date, 'Referral date');
  const status = oneOf(input.status ?? 'open', ['open', 'completed', 'cancelled'] as const, 'Status');

  if (input.id) {
    const existing = ctx.db.prepare('SELECT id FROM referrals WHERE id = ?').get(input.id);
    if (!existing) throw notFound('Referral not found.');
    tx(ctx.db, () => {
      ctx.db
        .prepare(
          `UPDATE referrals SET direction = ?, person = ?, clinic = ?, specialty = ?, reason = ?,
             date = ?, status = ?, follow_up = ?, note = ? WHERE id = ?`,
        )
        .run(
          direction,
          optString(input.person, 'Person', { max: 200 }),
          optString(input.clinic, 'Clinic', { max: 200 }),
          optString(input.specialty, 'Specialty', { max: 120 }),
          optString(input.reason, 'Reason', { max: 2000 }),
          date, status,
          optDate(input.followUp, 'Follow-up date'),
          optString(input.note, 'Note', { max: 4000 }),
          input.id,
        );
      audit(ctx, { action: 'referral.update', entityType: 'referral', entityId: input.id, summary: `Updated referral for patient #${patientId}` });
    });
    return ctx.db.prepare('SELECT * FROM referrals WHERE id = ?').get(input.id);
  }

  const id = tx(ctx.db, () => {
    const info = ctx.db
      .prepare(
        `INSERT INTO referrals (patient_id, direction, person, clinic, specialty, reason, date, status, follow_up, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        patientId, direction,
        optString(input.person, 'Person', { max: 200 }),
        optString(input.clinic, 'Clinic', { max: 200 }),
        optString(input.specialty, 'Specialty', { max: 120 }),
        optString(input.reason, 'Reason', { max: 2000 }),
        date, status,
        optDate(input.followUp, 'Follow-up date'),
        optString(input.note, 'Note', { max: 4000 }),
        ctx.session.userId, nowISO(),
      );
    const rid = Number(info.lastInsertRowid);
    audit(ctx, { action: 'referral.create', entityType: 'referral', entityId: rid, summary: `Referral ${direction} for patient #${patientId}` });
    return rid;
  });
  return ctx.db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
}

export { reqString };
