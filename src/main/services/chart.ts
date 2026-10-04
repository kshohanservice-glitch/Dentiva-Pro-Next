import type { Ctx } from '../core/context';
import type { ChartState, ToothConditionDTO } from '../../shared/types';
import { notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { CONDITION_KEYS, conditionLabel } from '../../shared/clinical';
import { nowISO } from '../../shared/currency';
import { oneOf, optString } from '../core/validate';

const SEVERITIES = ['mild', 'moderate', 'severe'] as const;

interface ConditionRow {
  id: number; tooth: string; condition: string; severity: string | null;
  visit_id: number | null; note: string | null; recorded_at: string;
  recorded_by: number; superseded_at: string | null;
}

function toDTO(r: ConditionRow): ToothConditionDTO {
  return {
    id: r.id, tooth: r.tooth, condition: r.condition, label: conditionLabel(r.condition),
    severity: r.severity, visitId: r.visit_id, note: r.note,
    recordedAt: r.recorded_at, supersededAt: r.superseded_at,
  };
}

export function getChart(ctx: Ctx, patientId: number): ChartState {
  requirePermission(ctx, 'clinical.view');
  const patient = ctx.db.prepare('SELECT id FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId);
  if (!patient) throw notFound('Patient not found.');
  const rows = ctx.db
    .prepare('SELECT * FROM tooth_conditions WHERE patient_id = ? ORDER BY recorded_at DESC, id DESC')
    .all(patientId) as ConditionRow[];
  const current = rows.filter((r) => r.superseded_at === null).map(toDTO);
  return { current, history: rows.map(toDTO) };
}

export interface ChartChange {
  tooth: string;
  condition: string;
  action: 'set' | 'clear';
  note?: string | null;
  severity?: string | null;
}

export interface ChartInput {
  visitId?: number | null;
  changes: ChartChange[];
}

/**
 * Chart edits are append/supersede only: existing observations get superseded_at
 * stamped instead of being updated or deleted, so per-visit history is preserved.
 */
export function setChart(ctx: Ctx, patientId: number, input: ChartInput): ChartState {
  requirePermission(ctx, 'clinical.chart.edit');
  const patient = ctx.db.prepare('SELECT id, code FROM patients WHERE id = ? AND deleted_at IS NULL').get(patientId) as { id: number; code: string } | undefined;
  if (!patient) throw notFound('Patient not found.');
  const changes = Array.isArray(input?.changes) ? input.changes : [];
  if (changes.length === 0) throw validation('No chart changes supplied.');
  if (changes.length > 400) throw validation('Too many chart changes in one operation.');

  const validTeeth = new Set(
    ctx.db.prepare('SELECT code FROM teeth').all<{ code: string }>().map((t) => t.code),
  );

  tx(ctx.db, () => {
    const at = nowISO();
    let sets = 0;
    let clears = 0;
    for (const ch of changes) {
      if (!validTeeth.has(ch.tooth)) throw validation(`Unknown tooth "${ch.tooth}".`);
      if (!CONDITION_KEYS.includes(ch.condition)) throw validation(`Unknown condition "${ch.condition}".`);
      if (ch.action === 'set') {
        const severity = ch.severity ? oneOf(ch.severity, SEVERITIES, 'Severity') : null;
        const note = optString(ch.note, 'Chart note', { max: 500 });
        ctx.db
          .prepare('UPDATE tooth_conditions SET superseded_at = ? WHERE patient_id = ? AND tooth = ? AND condition = ? AND superseded_at IS NULL')
          .run(at, patientId, ch.tooth, ch.condition);
        ctx.db
          .prepare(
            `INSERT INTO tooth_conditions (patient_id, tooth, condition, severity, visit_id, note, recorded_at, recorded_by, superseded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .run(patientId, ch.tooth, ch.condition, severity, input.visitId ?? null, note, at, ctx.session.userId);
        sets++;
      } else {
        const info = ctx.db
          .prepare('UPDATE tooth_conditions SET superseded_at = ? WHERE patient_id = ? AND tooth = ? AND condition = ? AND superseded_at IS NULL')
          .run(at, patientId, ch.tooth, ch.condition);
        clears += info.changes;
      }
    }
    audit(ctx, {
      action: 'chart.update', entityType: 'patient', entityId: patientId,
      summary: `Dental chart updated for ${patient.code}: ${sets} set, ${cleared(clears)}`,
      after: { sets, clears, visitId: input.visitId ?? null },
    });
  });
  return getChart(ctx, patientId);
}

function cleared(n: number): string {
  return `${n} cleared`;
}
