# Dentiva Pro — Database Design

Engine: **SQLite** (via better-sqlite3), WAL journal mode, `foreign_keys=ON`,
`synchronous=NORMAL`, `busy_timeout=5000`. Forward-only migrations tracked by
`PRAGMA user_version`; each migration runs in a transaction and is applied at startup.

Justification: SQLite is the industry-standard embedded DB for offline desktop apps —
zero-config, single-file backup, transactional, proven durability, no service process,
no record-count limits beyond storage.

## Conventions

- PKs: `INTEGER PRIMARY KEY AUTOINCREMENT` unless a stable business key is better.
- Timestamps: `TEXT` ISO-8601 UTC (`2026-09-27T12:00:00.000Z`); dates `TEXT` `YYYY-MM-DD`.
- Money: stored as **integer paisa** (`amount_paisa INTEGER`) to avoid float drift;
  presented as BDT (৳) with 2 decimals. (Bangladeshi Taka has no minor unit in practice;
  paisa fields keep future-proof precision.)
- Soft delete: `deleted_at TEXT NULL` for patients/staff/items where reversible archive is
  required; financial/clinical rows are **never** hard-deleted by application code.
- All FKs declared; `ON DELETE RESTRICT` for anything referenced by history,
  `CASCADE` only for pure child-of-child rows.

## Entity map (tables)

### Identity & access
- `users` — username (unique, lowercased), password_hash (Argon2id PHC string), role_id,
  staff_id?, status(active/locked/disabled), failed_attempts, locked_until, last_login_at,
  created_at, must_change_password.
- `roles` — name (unique), builtin flag, description.
- `permissions` — static catalog seeded from code (`key TEXT PRIMARY KEY`, group, label).
- `role_permissions` — role_id, permission_key.
- `user_roles`? — single role per user (v1) + `user_permission_overrides` (grant/revoke)
  for per-user exceptions.
- `sessions_meta` — last user activity timestamps for audit (live session is in-memory).

### Clinic & settings
- `settings` — key PRIMARY KEY, value_json, updated_at, updated_by.
- `dentists` — profile: name, bengali_name?, qualifications, designations, reg_no, phone,
  email, signature_path, photo_path, schedule_json, active, sort.
- `staff` — personal record incl. salary_paisa (permission-gated), attachments via table.

### Patients & clinical
- `patients` — code (unique), name, bengali_name, dob?, age_years?, gender, blood_group,
  phone, phone2, emergency_contact, emergency_phone, address, city, notes-ish fields split:
- `patient_histories` — patient_id, kind('medical'|'dental'|'chief'|'medications'|'allergies'),
  content, updated_at, updated_by. (Keeps main table narrow for fast list scans.)
- `tags` / `patient_tags`.
- `visits` — patient_id, dentist_id, datetime, chief_complaint, history, examination,
  diagnosis, treatment_plan, advice, notes, follow_up_date, status, invoice_id?, created_by.
- `visit_treatments` — visit_id, treatment_id, qty, unit_price_paisa **snapshot**, discount.
- `teeth` — static (seeded): code (FDI), dentition(adult/pediatric), arch, quadrant, position, label.
- `tooth_conditions` — patient_id, tooth_code, condition_key, severity?, visit_id,
  note, recorded_at, recorded_by, `superseded_at` NULL (current) — history preserved:
  closing old row when a new observation supersedes it.
- `chart_events` — audit of chart editing sessions (patient_id, visit_id?, actor, at).
- `referrals` — patient_id, direction(in/out), person, clinic, specialty, reason, date,
  status, follow_up, note, document_path.

### Catalog
- `treatments` — code, name, bengali_name, category, description, default_price_paisa,
  duration_min, active.

### Appointments & queue
- `appointments` — patient_id, dentist_id, date, time, duration_min, type, status,
  notes, reminder, created_by, created_at, rescheduled_from_id?, visit_id?.
  Index: (dentist_id, date, time), (patient_id, date).
- `queue_entries` — queue_no (per-day sequence), appointment_id?, patient_id, dentist_id,
  arrived_at, priority, status(waiting/called/in_treatment/paused/completed/cancelled),
  started_at?, finished_at?, transferred_to?.

### Prescriptions
- `prescriptions` — patient_id, visit_id?, dentist_id, date, c_c, o_e, r_e, diagnosis,
  treatment, advice, follow_up, footer_override?, created_by, number (sequential per year).
- `prescription_items` — prescription_id, seq, medicine_name, generic, form, strength,
  dosage, frequency, morning, afternoon, night, timing(before/after/na), duration,
  qty, instruction, instruction_bn, note.
- `medicine_templates` — name, items_json (staff-defined quick templates).

### Billing
- `invoices` — number (unique, yearly sequence), patient_id, date, status
  (draft|unpaid|partial|paid|voided), subtotal_paisa, discount_paisa, total_paisa,
  note, created_by, voided_at?, void_reason?, visit_id?.
- `invoice_items` — invoice_id, description **snapshot**, treatment_id?, qty,
  unit_price_paisa **snapshot**, discount_paisa, total_paisa.
- `payments` — invoice_id?, patient_id, amount_paisa, method(cash|bank|card|bkash|nagad|
  rocket|upay|other), reference, received_by, paid_at, note, type(payment|refund).
- Invoice `paid/due` are **derived** (`SUM(payments) − refunds`), never denormalized
  without reconciliation; invariant: `total = min(paid, total) + due`.

### Inventory
- `suppliers`.
- `inventory_items` — code, name, category_id, unit, min_level, location, active.
- `inventory_batches` — item_id, batch_no, expiry_date, qty_initial, qty_available,
  purchase_price_paisa, supplier_id?, purchased_at.
  Constraint: `qty_available >= 0` (checked + trigger).
- `inventory_txns` — batch_id, type(in|out|adjust|damage|expire|return), qty, ref,
  actor, at, note. All stock changes are ledger rows; qty_available updated in same txn.

### Accounting
- `expense_categories` (seeded + custom), `expenses` — date, category_id, amount_paisa,
  method, reference, note, attachment_path, entered_by.
- `incomes` — date, category_id(labelled 'Treatment revenue' by default), amount_paisa, …
  (payments auto-post a ledger summary view; explicit `incomes` only for non-invoice income.)

### Attachments
- `attachments` — entity_type(patient|visit|staff|invoice|referral|…), entity_id,
  stored_name, original_name, mime, size, sha256, uploaded_by, uploaded_at, note.

### Ops
- `audit_log` — id, at, user_id, username, action, entity_type, entity_id, summary,
  before_json?, after_json?, result(success|denied|error), reason?, ip_info?.
  **Insert-only:** triggers raise on UPDATE/DELETE.
- `notifications` — key (dedupe), kind, severity, title, body, entity refs, created_at,
  read_at. Deduped by key per day to prevent spam.
- `backups` — filename, path, created_at, size, schema_version, kind(manual|auto|pre_restore),
  status(ok|failed), error?, checksum.
- `invoice_number_seq` / per-year counters table `sequences(name, year, last_value)`.

## Migration policy

- Forward-only numbered migrations in code (`001_init.ts`, …).
- Startup: run pending inside transaction; for any future destructive migration take an
  automatic pre-migration backup first.
- `PRAGMA integrity_check` on startup (quick_check) — failure routes to recovery flow.

## Indexes (principal)

- patients: `(code)`, `(name)`, `(phone)`, `(created_at)`, `(deleted_at)`
- visits: `(patient_id, datetime)`, `(dentist_id, datetime)`
- appointments: `(date, dentist_id, time)`, `(patient_id, date)`, `(status, date)`
- queue: `(status, arrived_at)`
- invoices: `(patient_id, date)`, `(number)`, `(status, date)`
- payments: `(paid_at)`, `(patient_id, paid_at)`, `(invoice_id)`
- audit_log: `(at)`, `(user_id, at)`, `(entity_type, entity_id)`
- tooth_conditions: `(patient_id, tooth_code, superseded_at)`
- inventory batches: `(item_id)`, `(expiry_date)`

## Historical immutability rules

1. Catalog price changes never touch old invoices (price snapshot columns).
2. Patient field edits do not rewrite visits (visit rows carry their own captured text).
3. Tooth conditions append/supersede; old rows keep `superseded_at` → full per-visit history.
4. Payments never edited: corrections = refund rows + new payment rows.
5. Invoice lines immutable after issue: corrections = void + reissue.
