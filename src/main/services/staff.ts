import type { Ctx } from '../core/context';
import type { DentistDTO, StaffDTO } from '../../shared/types';
import { conflict, notFound, validation } from '../errors';
import { audit, requirePermission } from '../core/context';
import { nowISO } from '../../shared/currency';
import { optDate, optString, optOneOf, reqInt, reqString } from '../core/validate';
import { BLOOD_GROUPS, GENDERS } from '../../shared/clinical';

/* ------------------------------- Staff -------------------------------- */

function staffDTO(r: any, salaryVisible: boolean): StaffDTO {
  return {
    id: r.id, name: r.name, bengaliName: r.bengali_name, gender: r.gender, age: r.age,
    phone: r.phone, emergencyContact: r.emergency_contact, emergencyPhone: r.emergency_phone,
    bloodGroup: r.blood_group, idNumber: r.id_number, designation: r.designation,
    department: r.department, salaryPaisa: salaryVisible ? r.salary_paisa : null,
    joiningDate: r.joining_date, status: r.status, address: r.address, notes: r.notes,
    photoPath: r.photo_path,
  };
}

export function listStaff(ctx: Ctx): StaffDTO[] {
  requirePermission(ctx, 'staff.view');
  const salaryVisible = ctx.session.permissions.includes('staff.salary.view');
  const rows = ctx.db.prepare('SELECT * FROM staff WHERE deleted_at IS NULL ORDER BY name').all() as any[];
  return rows.map((r) => staffDTO(r, salaryVisible));
}

export function saveStaff(ctx: Ctx, raw: Partial<StaffDTO>): StaffDTO {
  requirePermission(ctx, 'staff.manage');
  const name = reqString(raw?.name, 'Staff name', { max: 160 });
  const gender = raw?.gender ? optOneOf(raw.gender, [...GENDERS] as string[], 'Gender') : null;
  const salaryVisible = ctx.session.permissions.includes('staff.salary.view');
  if (raw.salaryPaisa != null && !salaryVisible) throw validation('You do not have permission to set salaries.');
  const salary = raw.salaryPaisa != null ? reqInt(raw.salaryPaisa, 'Salary', { min: 0, max: 100_000_000_00 }) : null;
  const now = nowISO();

  if (raw.id) {
    const existing = ctx.db.prepare('SELECT * FROM staff WHERE id = ? AND deleted_at IS NULL').get(raw.id) as any;
    if (!existing) throw notFound('Staff member not found.');
    ctx.db
      .prepare(
        `UPDATE staff SET name = ?, bengali_name = ?, gender = ?, age = ?, address = ?, phone = ?,
           emergency_contact = ?, emergency_phone = ?, blood_group = ?, id_number = ?, designation = ?,
           department = ?, salary_paisa = ?, joining_date = ?, status = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name, optString(raw.bengaliName, 'Bengali name', { max: 160 }), gender,
        raw.age != null ? reqInt(raw.age, 'Age', { min: 0, max: 130 }) : null,
        optString(raw.address, 'Address', { max: 400 }), optString(raw.phone, 'Phone', { max: 40 }),
        optString(raw.emergencyContact, 'Emergency contact', { max: 160 }),
        optString(raw.emergencyPhone, 'Emergency phone', { max: 40 }),
        raw.bloodGroup ? optOneOf(raw.bloodGroup, [...BLOOD_GROUPS] as string[], 'Blood group') : null,
        optString(raw.idNumber, 'ID number', { max: 80 }),
        optString(raw.designation, 'Designation', { max: 120 }),
        optString(raw.department, 'Department', { max: 120 }),
        salary ?? existing.salary_paisa,
        optDate(raw.joiningDate, 'Joining date'),
        optOneOf(raw.status, ['active', 'inactive'] as const, 'Status') ?? existing.status,
        optString(raw.notes, 'Notes', { max: 4000 }),
        now, raw.id,
      );
    audit(ctx, { action: 'staff.update', entityType: 'staff', entityId: raw.id, summary: `Updated staff ${name}` });
    return listStaff(ctx).find((s) => s.id === raw.id)!;
  }

  const info = ctx.db
    .prepare(
      `INSERT INTO staff (name, bengali_name, gender, age, address, phone, emergency_contact, emergency_phone,
         blood_group, id_number, designation, department, salary_paisa, joining_date, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name, optString(raw.bengaliName, 'Bengali name', { max: 160 }), gender,
      raw.age != null ? reqInt(raw.age, 'Age', { min: 0, max: 130 }) : null,
      optString(raw.address, 'Address', { max: 400 }), optString(raw.phone, 'Phone', { max: 40 }),
      optString(raw.emergencyContact, 'Emergency contact', { max: 160 }),
      optString(raw.emergencyPhone, 'Emergency phone', { max: 40 }),
      raw.bloodGroup ? optOneOf(raw.bloodGroup, [...BLOOD_GROUPS] as string[], 'Blood group') : null,
      optString(raw.idNumber, 'ID number', { max: 80 }),
      optString(raw.designation, 'Designation', { max: 120 }),
      optString(raw.department, 'Department', { max: 120 }),
      salary, optDate(raw.joiningDate, 'Joining date'),
      optOneOf(raw.status, ['active', 'inactive'] as const, 'Status') ?? 'active',
      optString(raw.notes, 'Notes', { max: 4000 }),
      now, now,
    );
  const id = Number(info.lastInsertRowid);
  audit(ctx, { action: 'staff.create', entityType: 'staff', entityId: id, summary: `Added staff ${name}` });
  return listStaff(ctx).find((s) => s.id === id)!;
}

/* ------------------------------ Dentists ------------------------------ */

function dentistDTO(r: any): DentistDTO {
  return {
    id: r.id, name: r.name, qualifications: r.qualifications, designations: r.designations,
    regNo: r.reg_no, phone: r.phone, email: r.email, signaturePath: r.signature_path,
    photoPath: r.photo_path, schedule: r.schedule, active: !!r.active,
  };
}

export function listDentists(ctx: Ctx, includeInactive = false): DentistDTO[] {
  requirePermission(ctx, 'patients.view');
  const rows = ctx.db
    .prepare(`SELECT * FROM dentists WHERE deleted_at IS NULL ${includeInactive ? '' : 'AND active = 1'} ORDER BY name`)
    .all() as any[];
  return rows.map(dentistDTO);
}

export function saveDentist(ctx: Ctx, raw: Partial<DentistDTO>): DentistDTO {
  requirePermission(ctx, 'staff.manage');
  const name = reqString(raw?.name, 'Dentist name', { max: 160 });
  const now = nowISO();

  if (raw.id) {
    const existing = ctx.db.prepare('SELECT * FROM dentists WHERE id = ? AND deleted_at IS NULL').get(raw.id) as any;
    if (!existing) throw notFound('Dentist not found.');
    ctx.db
      .prepare(
        `UPDATE dentists SET name = ?, qualifications = ?, designations = ?, reg_no = ?, phone = ?, email = ?,
           schedule = ?, active = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        name, optString(raw.qualifications, 'Qualifications', { max: 240 }),
        optString(raw.designations, 'Designations', { max: 240 }),
        optString(raw.regNo, 'Registration', { max: 80 }),
        optString(raw.phone, 'Phone', { max: 40 }), optString(raw.email, 'Email', { max: 160 }),
        optString(raw.schedule, 'Schedule', { max: 2000 }),
        raw.active === false ? 0 : 1, now, raw.id,
      );
    audit(ctx, { action: 'dentist.update', entityType: 'dentist', entityId: raw.id, summary: `Updated dentist ${name}` });
    return listDentists(ctx, true).find((d) => d.id === raw.id)!;
  }

  const info = ctx.db
    .prepare(
      `INSERT INTO dentists (name, qualifications, designations, reg_no, phone, email, schedule, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      name, optString(raw.qualifications, 'Qualifications', { max: 240 }),
      optString(raw.designations, 'Designations', { max: 240 }),
      optString(raw.regNo, 'Registration', { max: 80 }),
      optString(raw.phone, 'Phone', { max: 40 }), optString(raw.email, 'Email', { max: 160 }),
      optString(raw.schedule, 'Schedule', { max: 2000 }), now, now,
    );
  const id = Number(info.lastInsertRowid);
  audit(ctx, { action: 'dentist.create', entityType: 'dentist', entityId: id, summary: `Added dentist ${name}` });
  return listDentists(ctx, true).find((d) => d.id === id)!;
}

export function assertDentistExists(ctx: Ctx, dentistId: number): void {
  const row = ctx.db.prepare('SELECT id FROM dentists WHERE id = ? AND active = 1').get(dentistId);
  if (!row) throw conflict('Selected dentist does not exist.');
}
