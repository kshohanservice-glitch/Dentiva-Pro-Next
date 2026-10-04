import type { Ctx } from '../core/context';
import type { SearchHit } from '../../shared/types';
import { escapeLike } from '../core/validate';
const LIMIT = 8;

export function globalSearch(ctx: Ctx, rawQuery: string): SearchHit[] {
  const query = String(rawQuery ?? '').trim();
  if (query.length < 2) return [];
  const q = `%${escapeLike(query.toLowerCase())}%`;
  const hits: SearchHit[] = [];
  const perms = ctx.session.permissions;

  if (perms.includes('patients.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT id, code, name, phone FROM patients
         WHERE deleted_at IS NULL AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(bengali_name,'')) LIKE ? ESCAPE '\\' OR LOWER(code) LIKE ? ESCAPE '\\' OR COALESCE(phone,'') LIKE ? ESCAPE '\\')
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(q, q, q, q, LIMIT) as any[]) {
      hits.push({ kind: 'patient', id: r.id, title: r.name, subtitle: r.code, meta: r.phone ?? undefined });
    }
  }

  if (perms.includes('appointments.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT a.id, a.date, a.time, a.status, p.name FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.deleted_at IS NULL AND (LOWER(p.name) LIKE ? ESCAPE '\\' OR a.date LIKE ? ESCAPE '\\')
         ORDER BY a.date DESC, a.time DESC LIMIT ?`,
      )
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'appointment', id: r.id, title: `Appointment — ${r.name}`, subtitle: `${r.date} ${r.time}`, meta: r.status });
    }
  }

  if (perms.includes('billing.invoice.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT i.id, i.number, i.date, i.total_paisa, p.name FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE i.deleted_at IS NULL AND (LOWER(i.number) LIKE ? ESCAPE '\\' OR LOWER(p.name) LIKE ? ESCAPE '\\')
         ORDER BY i.date DESC LIMIT ?`,
      )
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'invoice', id: r.id, title: `Invoice ${r.number}`, subtitle: r.name, meta: r.date });
    }
  }

  if (perms.includes('billing.payment.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT pay.id, pay.paid_at, pay.amount_paisa, pay.method, p.name FROM payments pay JOIN patients p ON p.id = pay.patient_id
         WHERE LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(pay.reference,'')) LIKE ? ESCAPE '\\'
         ORDER BY pay.paid_at DESC LIMIT ?`,
      )
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'payment', id: r.id, title: `Payment ${(r.amount_paisa / 100).toFixed(2)} ৳`, subtitle: r.name, meta: `${r.paid_at.slice(0, 10)} · ${r.method}` });
    }
  }

  if (perms.includes('clinical.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT rx.id, rx.number, rx.date, p.name FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id
         WHERE rx.deleted_at IS NULL AND (LOWER(rx.number) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(rx.diagnosis,'')) LIKE ? ESCAPE '\\' OR LOWER(p.name) LIKE ? ESCAPE '\\')
         ORDER BY rx.date DESC LIMIT ?`,
      )
      .all(q, q, q, LIMIT) as any[]) {
      hits.push({ kind: 'prescription', id: r.id, title: `Prescription ${r.number}`, subtitle: r.name, meta: r.date });
    }
    for (const r of ctx.db
      .prepare(
        `SELECT v.id, v.datetime, v.diagnosis, p.name FROM visits v JOIN patients p ON p.id = v.patient_id
         WHERE v.deleted_at IS NULL AND (LOWER(COALESCE(v.diagnosis,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(v.chief_complaint,'')) LIKE ? ESCAPE '\\')
         ORDER BY v.datetime DESC LIMIT ?`,
      )
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'visit', id: r.id, title: `Visit — ${r.diagnosis ?? 'consultation'}`, subtitle: r.name, meta: r.datetime.slice(0, 10) });
    }
  }

  if (perms.includes('treatments.view')) {
    for (const r of ctx.db
      .prepare(`SELECT id, code, name FROM treatments WHERE LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(code) LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'treatment', id: r.id, title: r.name, subtitle: r.code });
    }
  }

  if (perms.includes('staff.view')) {
    for (const r of ctx.db
      .prepare(`SELECT id, name, designation FROM staff WHERE deleted_at IS NULL AND LOWER(name) LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
      .all(q, LIMIT) as any[]) {
      hits.push({ kind: 'staff', id: r.id, title: r.name, subtitle: r.designation ?? 'Staff' });
    }
  }
  if (perms.includes('patients.view') || perms.includes('staff.manage')) {
    for (const r of ctx.db
      .prepare(`SELECT id, name, qualifications FROM dentists WHERE deleted_at IS NULL AND LOWER(name) LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`)
      .all(q, LIMIT) as any[]) {
      hits.push({ kind: 'dentist', id: r.id, title: r.name, subtitle: r.qualifications ?? 'Dentist' });
    }
  }

  if (perms.includes('inventory.view')) {
    for (const r of ctx.db
      .prepare(`SELECT id, code, name FROM inventory_items WHERE deleted_at IS NULL AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(code) LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?`)
      .all(q, q, LIMIT) as any[]) {
      hits.push({ kind: 'inventory', id: r.id, title: r.name, subtitle: r.code });
    }
  }

  if (perms.includes('accounting.view')) {
    for (const r of ctx.db
      .prepare(
        `SELECT e.id, e.date, e.amount_paisa, c.name FROM expenses e JOIN account_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL AND (LOWER(COALESCE(e.note,'')) LIKE ? ESCAPE '\\' OR LOWER(c.name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(e.reference,'')) LIKE ? ESCAPE '\\')
         ORDER BY e.date DESC LIMIT ?`,
      )
      .all(q, q, q, LIMIT) as any[]) {
      hits.push({ kind: 'expense', id: r.id, title: `${c(r)} ${(r.amount_paisa / 100).toFixed(2)} ৳`, subtitle: r.date, meta: r.name });
    }
  }

  return hits;
}

function c(r: any): string {
  return String(r.name ?? 'Expense');
}
