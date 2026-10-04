import type { Ctx } from '../core/context';
import type { TreatmentDTO } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission } from '../core/context';
import { nowISO } from '../../shared/currency';
import { optString, reqInt, reqString } from '../core/validate';

interface Row {
  id: number; code: string; name: string; bengali_name: string | null; category: string | null;
  description: string | null; default_price_paisa: number; duration_min: number | null; active: number;
}

function toDTO(r: Row): TreatmentDTO {
  return {
    id: r.id, code: r.code, name: r.name, bengaliName: r.bengali_name,
    category: r.category, description: r.description,
    defaultPricePaisa: r.default_price_paisa, durationMin: r.duration_min, active: !!r.active,
  };
}

export function listTreatments(ctx: Ctx, includeInactive = false): TreatmentDTO[] {
  requirePermission(ctx, 'treatments.view');
  const rows = ctx.db
    .prepare(`SELECT * FROM treatments ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`)
    .all() as Row[];
  return rows.map(toDTO);
}

export function saveTreatment(ctx: Ctx, raw: Partial<TreatmentDTO>): TreatmentDTO {
  requirePermission(ctx, 'treatments.manage');
  const code = reqString(raw?.code, 'Treatment code', { max: 40 }).toUpperCase();
  const name = reqString(raw?.name, 'Treatment name', { max: 200 });
  const price = reqInt(raw?.defaultPricePaisa ?? 0, 'Default price', { min: 0, max: 100_000_000_00 });
  const now = nowISO();

  if (raw.id) {
    const existing = ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(raw.id) as Row | undefined;
    if (!existing) throw notFound('Treatment not found.');
    const dup = ctx.db.prepare('SELECT id FROM treatments WHERE code = ? AND id != ?').get(code, raw.id);
    if (dup) throw conflict(`Treatment code "${code}" is already in use.`);
    ctx.db
      .prepare(
        `UPDATE treatments SET code = ?, name = ?, bengali_name = ?, category = ?, description = ?,
           default_price_paisa = ?, duration_min = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        code, name,
        optString(raw.bengaliName, 'Bengali name', { max: 200 }),
        optString(raw.category, 'Category', { max: 100 }),
        optString(raw.description, 'Description', { max: 4000 }),
        price,
        raw.durationMin != null ? reqInt(raw.durationMin, 'Duration', { min: 0, max: 1440 }) : null,
        now, raw.id,
      );
    audit(ctx, {
      action: 'treatment.update', entityType: 'treatment', entityId: raw.id,
      summary: `Updated treatment ${name}`,
      before: { price: existing.default_price_paisa }, after: { price },
    });
    return toDTO(ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(raw.id) as Row);
  }

  const dup = ctx.db.prepare('SELECT id FROM treatments WHERE code = ?').get(code);
  if (dup) throw conflict(`Treatment code "${code}" is already in use.`);

  const info = ctx.db
    .prepare(
      `INSERT INTO treatments (code, name, bengali_name, category, description, default_price_paisa, duration_min, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      code, name,
      optString(raw.bengaliName, 'Bengali name', { max: 200 }),
      optString(raw.category, 'Category', { max: 100 }),
      optString(raw.description, 'Description', { max: 4000 }),
      price,
      raw.durationMin != null ? reqInt(raw.durationMin, 'Duration', { min: 0, max: 1440 }) : null,
      now, now,
    );
  const id = Number(info.lastInsertRowid);
  audit(ctx, { action: 'treatment.create', entityType: 'treatment', entityId: id, summary: `Created treatment ${name} (${code})`, after: { price } });
  return toDTO(ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id) as Row);
}

export function setTreatmentActive(ctx: Ctx, id: number, active: boolean): TreatmentDTO {
  requirePermission(ctx, 'treatments.manage');
  const row = ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw notFound('Treatment not found.');
  ctx.db.prepare('UPDATE treatments SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, nowISO(), id);
  audit(ctx, { action: active ? 'treatment.activate' : 'treatment.deactivate', entityType: 'treatment', entityId: id, summary: `${active ? 'Activated' : 'Deactivated'} treatment ${row.name}` });
  if (typeof active !== 'boolean') throw validation('Invalid state.');
  return toDTO(ctx.db.prepare('SELECT * FROM treatments WHERE id = ?').get(id) as Row);
}
