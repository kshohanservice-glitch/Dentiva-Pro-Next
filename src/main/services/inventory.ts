import type { Ctx } from '../core/context';
import type { InventoryBatchDTO, InventoryItemDTO, InventoryTxnType, StockInput } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission, tx } from '../core/context';
import { nowISO, todayISO } from '../../shared/currency';
import { escapeLike, optDate, optString, reqInt, reqString } from '../core/validate';

function daysUntil(date: string): number {
  const d = new Date(`${date}T00:00:00`).getTime();
  return Math.ceil((d - Date.now()) / 86400000);
}

interface ItemRow {
  id: number; code: string; name: string; category: string | null; unit: string;
  min_level: number; location: string | null; active: number;
  qty_available: number; nearest_expiry: string | null;
}

function itemDTO(r: ItemRow): InventoryItemDTO {
  return {
    id: r.id, code: r.code, name: r.name, categoryName: r.category, unit: r.unit,
    minLevel: r.min_level, location: r.location, active: !!r.active,
    qtyAvailable: r.qty_available ?? 0,
    lowStock: (r.qty_available ?? 0) <= r.min_level,
    nearestExpiry: r.nearest_expiry,
  };
}

function batchDTO(r: any): InventoryBatchDTO {
  return {
    id: r.id, itemId: r.item_id, itemName: r.item_name, batchNo: r.batch_no,
    expiryDate: r.expiry_date, qtyInitial: r.qty_initial, qtyAvailable: r.qty_available,
    purchasePricePaisa: r.purchase_price_paisa, supplierName: r.supplier_name,
    purchasedAt: r.purchased_at,
    expired: !!r.expiry_date && daysUntil(r.expiry_date) < 0 && r.qty_available > 0,
    nearExpiry: !!r.expiry_date && daysUntil(r.expiry_date) >= 0 && daysUntil(r.expiry_date) <= 30 && r.qty_available > 0,
  };
}

const SELECT_ITEM = `
  SELECT i.*, COALESCE((SELECT SUM(b.qty_available) FROM inventory_batches b WHERE b.item_id = i.id), 0) qty_available,
    (SELECT MIN(b.expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_available > 0 AND b.expiry_date IS NOT NULL) nearest_expiry
  FROM inventory_items i`;

function getItemById(ctx: Ctx, id: number): InventoryItemDTO {
  const row = ctx.db.prepare(`${SELECT_ITEM} WHERE i.id = ? AND i.deleted_at IS NULL`).get(id) as ItemRow | undefined;
  if (!row) throw notFound('Inventory item not found.');
  return itemDTO(row);
}

export function listItems(ctx: Ctx, filter: { query?: string; lowOnly?: boolean; includeInactive?: boolean } = {}): InventoryItemDTO[] {
  requirePermission(ctx, 'inventory.view');
  const where: string[] = ['i.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!filter.includeInactive) where.push('i.active = 1');
  if (filter.query?.trim()) {
    const q = `%${escapeLike(filter.query.trim().toLowerCase())}%`;
    where.push("(LOWER(i.name) LIKE ? ESCAPE '\\' OR LOWER(i.code) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(i.category,'')) LIKE ? ESCAPE '\\')");
    params.push(q, q, q);
  }
  let rows = ctx.db.prepare(`${SELECT_ITEM} WHERE ${where.join(' AND ')} ORDER BY i.name`).all(...params as any[]) as ItemRow[];
  if (filter.lowOnly) rows = rows.filter((r) => (r.qty_available ?? 0) <= r.min_level);
  return rows.map(itemDTO);
}

const SELECT_BATCH = `
  SELECT b.*, i.name item_name, s.name supplier_name
  FROM inventory_batches b
  JOIN inventory_items i ON i.id = b.item_id
  LEFT JOIN suppliers s ON s.id = b.supplier_id`;

export function listBatches(ctx: Ctx, filter: { itemId?: number; expiringWithinDays?: number; expiredOnly?: boolean } = {}): InventoryBatchDTO[] {
  requirePermission(ctx, 'inventory.view');
  const where: string[] = ['b.qty_available > 0'];
  const params: unknown[] = [];
  if (filter.itemId) { where.push('b.item_id = ?'); params.push(filter.itemId); }
  let rows = ctx.db.prepare(`${SELECT_BATCH} WHERE ${where.join(' AND ')} ORDER BY COALESCE(b.expiry_date, '9999-12-31') ASC`).all(...params as any[]) as any[];
  if (filter.expiredOnly) rows = rows.filter((r) => r.expiry_date && daysUntil(r.expiry_date) < 0);
  else if (filter.expiringWithinDays != null) {
    const limit = filter.expiringWithinDays;
    rows = rows.filter((r) => r.expiry_date && daysUntil(r.expiry_date) >= 0 && daysUntil(r.expiry_date) <= limit);
  }
  return rows.map(batchDTO);
}

export function saveItem(ctx: Ctx, raw: Partial<InventoryItemDTO>): InventoryItemDTO {
  requirePermission(ctx, 'inventory.manage');
  const code = optString(raw?.code, 'Item code', { max: 40 })?.toUpperCase() ?? `ITM-${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const name = reqString(raw?.name, 'Item name', { max: 200 });
  const minLevel = reqInt(raw?.minLevel ?? 0, 'Minimum stock level', { min: 0, max: 1_000_000 });
  const now = nowISO();

  if (raw.id) {
    const existing = ctx.db.prepare('SELECT * FROM inventory_items WHERE id = ? AND deleted_at IS NULL').get(raw.id) as any;
    if (!existing) throw notFound('Inventory item not found.');
    const dup = ctx.db.prepare('SELECT id FROM inventory_items WHERE UPPER(code) = ? AND id != ?').get(code, raw.id);
    if (dup) throw conflict(`Item code "${code}" is already in use.`);
    ctx.db
      .prepare('UPDATE inventory_items SET code = ?, name = ?, category = ?, unit = ?, min_level = ?, location = ?, active = ?, updated_at = ? WHERE id = ?')
      .run(code, name, optString(raw.categoryName, 'Category', { max: 100 }), optString(raw.unit, 'Unit', { max: 30 }) ?? 'pcs',
        minLevel, optString(raw.location, 'Storage location', { max: 120 }),
        raw.active === false ? 0 : 1, now, raw.id);
    audit(ctx, { action: 'inventory.item_update', entityType: 'inventory_item', entityId: raw.id, summary: `Updated item ${name}` });
    return getItemById(ctx, raw.id);
  }

  const dup = ctx.db.prepare('SELECT id FROM inventory_items WHERE UPPER(code) = ?').get(code);
  if (dup) throw conflict(`Item code "${code}" is already in use.`);
  const info = ctx.db
    .prepare('INSERT INTO inventory_items (code, name, category, unit, min_level, location, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(code, name, optString(raw.categoryName, 'Category', { max: 100 }), optString(raw.unit, 'Unit', { max: 30 }) ?? 'pcs',
      minLevel, optString(raw.location, 'Storage location', { max: 120 }), now, now);
  const id = Number(info.lastInsertRowid);
  audit(ctx, { action: 'inventory.item_create', entityType: 'inventory_item', entityId: id, summary: `Created item ${name} (${code})` });
  return getItemById(ctx, id);
}

export function stockOperation(ctx: Ctx, raw: StockInput): { item: InventoryItemDTO; batches: InventoryBatchDTO[] } {
  requirePermission(ctx, 'inventory.manage');
  const itemId = reqInt(raw?.itemId, 'Item', { min: 1 });
  const item = ctx.db.prepare('SELECT id, name FROM inventory_items WHERE id = ? AND deleted_at IS NULL').get(itemId) as { id: number; name: string } | undefined;
  if (!item) throw notFound('Inventory item not found.');
  const type = raw.type as InventoryTxnType;
  if (!['in', 'out', 'adjust', 'damage', 'expire', 'return'].includes(type)) throw validation('Unknown stock operation.');
  const qty = reqInt(raw?.qty, 'Quantity', { min: 1, max: 1_000_000 });

  tx(ctx.db, () => {
    if (type === 'in') {
      const expiry = optDate(raw.expiryDate, 'Expiry date');
      const price = reqInt(raw.purchasePricePaisa ?? 0, 'Purchase price', { min: 0 });
      const supplierId = raw.supplierId ?? null;
      ctx.db
        .prepare(
          `INSERT INTO inventory_batches (item_id, batch_no, expiry_date, qty_initial, qty_available, purchase_price_paisa, supplier_id, purchased_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(itemId, optString(raw.batchNo, 'Batch number', { max: 60 }), expiry, qty, qty, price,
          supplierId, todayISO(), nowISO());
      const batchId = ctx.db.prepare('SELECT last_insert_rowid() l').get<{ l: number }>()!.l;
      ctx.db.prepare('INSERT INTO inventory_txns (item_id, batch_id, type, qty, reference, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, batchId, 'in', qty, optString(raw.reference, 'Reference', { max: 120 }), optString(raw.note, 'Note', { max: 500 }), ctx.session.userId, nowISO());
    } else {
      let batchId = raw.batchId ?? null;
      if (batchId) {
        const b = ctx.db.prepare('SELECT id, qty_available FROM inventory_batches WHERE id = ? AND item_id = ?').get(batchId, itemId) as { id: number; qty_available: number } | undefined;
        if (!b) throw notFound('Batch not found for this item.');
        if (type !== 'adjust' && b.qty_available < qty) {
          throw conflict(`Insufficient stock in batch: only ${b.qty_available} available.`);
        }
        const newQty = type === 'adjust' ? Math.max(0, qty) : b.qty_available - qty;
        ctx.db.prepare('UPDATE inventory_batches SET qty_available = ? WHERE id = ?').run(
          type === 'adjust' ? qty : newQty, batchId,
        );
      } else {
        // operate on batches FIFO
        const batches = ctx.db
          .prepare('SELECT id, qty_available FROM inventory_batches WHERE item_id = ? AND qty_available > 0 ORDER BY COALESCE(expiry_date, \'9999-12-31\'), id')
          .all(itemId) as { id: number; qty_available: number }[];
        if (type === 'adjust') throw validation('Select a specific batch for a stock adjustment.');
        let remaining = qty;
        for (const b of batches) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, b.qty_available);
          ctx.db.prepare('UPDATE inventory_batches SET qty_available = qty_available - ? WHERE id = ?').run(take, b.id);
          remaining -= take;
        }
        if (remaining > 0) throw conflict(`Insufficient stock: ${qty - remaining} available, ${qty} requested.`);
        batchId = null;
      }
      const totalForTxn = type === 'adjust' ? qty : qty;
      ctx.db.prepare('INSERT INTO inventory_txns (item_id, batch_id, type, qty, reference, note, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(itemId, batchId, type, totalForTxn, optString(raw.reference, 'Reference', { max: 120 }), optString(raw.note, 'Note', { max: 500 }), ctx.session.userId, nowISO());
    }
    audit(ctx, {
      action: `inventory.${type}`, entityType: 'inventory_item', entityId: itemId,
      summary: `${type === 'in' ? 'Stock in' : type} ${qty} × ${item.name}${raw.batchNo ? ` (batch ${raw.batchNo})` : ''}`,
      after: { qty, type, batchNo: raw.batchNo ?? null },
    });
  });

  const updated = getItemById(ctx, itemId);
  return { item: updated, batches: listBatches(ctx, { itemId }) };
}

export function listSuppliers(ctx: Ctx): { id: number; name: string; phone: string | null }[] {
  requirePermission(ctx, 'inventory.view');
  return ctx.db.prepare('SELECT id, name, phone FROM suppliers ORDER BY name').all() as any;
}

export function saveSupplier(ctx: Ctx, input: { id?: number; name: string; phone?: string | null; address?: string | null }): { id: number } {
  requirePermission(ctx, 'inventory.manage');
  const name = reqString(input?.name, 'Supplier name', { max: 200 });
  if (input.id) {
    ctx.db.prepare('UPDATE suppliers SET name = ?, phone = ?, address = ? WHERE id = ?')
      .run(name, optString(input.phone, 'Phone', { max: 40 }), optString(input.address, 'Address', { max: 300 }), input.id);
    audit(ctx, { action: 'inventory.supplier_update', entityType: 'supplier', entityId: input.id, summary: `Updated supplier ${name}` });
    return { id: input.id };
  }
  const info = ctx.db.prepare('INSERT INTO suppliers (name, phone, address, created_at) VALUES (?, ?, ?, ?)')
    .run(name, optString(input.phone, 'Phone', { max: 40 }), optString(input.address, 'Address', { max: 300 }), nowISO());
  const id = Number(info.lastInsertRowid);
  audit(ctx, { action: 'inventory.supplier_create', entityType: 'supplier', entityId: id, summary: `Added supplier ${name}` });
  return { id };
}
