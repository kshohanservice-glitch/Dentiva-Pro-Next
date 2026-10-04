# Dentiva Pro — Acceptance Checklist (spec §136 / V1.1 gates)

Source: master specification acceptance list, tracked 1:1 with the V1.1 audit
(`docs/V1.1_AUDIT_PLAN.md` §7 and `docs/V1.1_ISSUE_REGISTER.md`).
Status values: `[x]` evidenced · `[ ]` pending.

## A. Product & architecture

- [x] Architecture audit complete (V1.1 Phase A; ADR-001; docs/ARCHITECTURE.md)
- [x] Offline-first, no paid APIs, no runtime network code (code audit + CSP `connect-src 'none'`)
- [x] Product identity, icon, versioning (icon.ico 16–256; version from package.json)
- [x] Documentation set exists and references resolve (THIRD_PARTY_NOTICES.md, this file)

## B. Security & identity

- [x] Activation audit complete (integration + packaged-artifact smoke; repo literal scan; failed attempts audited — ISS-011)
- [x] Authentication audit complete (Argon2id, lockout, timing equalization, audit)
- [x] Auto/manual lock (main-process idle timer + denied IPC while locked)
- [x] No plaintext passwords/secrets in source, logs, tests, artifacts (CI + manual scans)
- [x] Security review (docs/SECURITY.md + V1.1 Phase A; CSV injection fixed ISS-009; attachment write gates ISS-018)
- [x] Audit log append-only; tamper attempts rejected at DB level (triggers)

## C. RBAC & permissions

- [x] RBAC service-layer enforcement (`requirePermission` on every service entry point)
- [x] Owner-account protection (`ISS-010`, `ISS-033` including `resetPassword` guard)
- [x] RBAC matrix fully populated from behavior for all 7 roles (`tests/integration/rbac-personas.test.ts`)
- [x] Unauthorized-persona attack suite complete (financial/salary/users/destructive/audit/backup) (`tests/integration/rbac-personas.test.ts`, `tests/integration/rbac.test.ts`)

## D. Clinical & workflow

- [x] Patient creation/duplicates/histories (integration + E2E incl. Bengali + medical/dental history fields)
- [x] Visit history immutability (closed-visit guard) + visit procedures returned for printing (`ISS-036`)
- [x] Dental chart history preserved (supersede-only design + pediatric upper arch fix `ISS-038` + severity/note validation `ISS-027`)
- [x] Prescription create validation & print layout (items, dentist, dates `ISS-013`, clinical fields `ISS-021`, age guard `ISS-028`)
- [x] Appointment lifecycle matrix (conflict, override on create & reschedule `ISS-030`, no-show guard `ISS-017`)
- [x] Queue state machine matrix incl. 120+ entries (`tests/integration/scale.test.ts`, `pause` on waiting `ISS-035`)
- [x] Prescription & document print/PDF matrix (A4/A5/thermal, `mmToInches` & `marginsMmToPrintMargins` unit conversions `ISS-036`, E2E print window verification; physical printer hardware = environment-unavailable)

## E. Financial

- [x] Total = Paid + Due invariant (`ISS-008` fix + tests; billing suite)
- [x] Refund permission + refund bound (`ISS-008`)
- [x] Append-only payments/invoice_items (DB triggers)
- [x] Historical price immutability (invoice items snapshot unit price)
- [x] Report accuracy vs hand-computed dataset (`tests/integration/module-coverage.test.ts`, `ISS-020`, `ISS-029`)
- [x] Payment method matrix incl. bKash/Nagad/Rocket/Upay (`tests/integration/billing.test.ts`, `tests/integration/module-coverage.test.ts`)

## F. Operations

- [x] Backup: checksum + integrity + unique names + truthful list (`ISS-012`, `ISS-023`, `ISS-024`)
- [x] Restore: pre-restore backup, rollback, corrupt rejection, typed `RESTORE` confirmation (`tests/integration/backup.test.ts`, `ISS-023`)
- [x] Attachments: extension/magic-byte (`.pdf/.png/.jpg/.gif/.webp/.bmp` `ISS-037`)/traversal/size defenses; read & write permissions (`ISS-018`, `ISS-037`)
- [x] Inventory negative-stock/expiry/low-stock matrix + auto-code (`tests/integration/module-coverage.test.ts`, `ISS-039`)
- [x] Accounting income/expense totals vs source (`tests/integration/module-coverage.test.ts`, `ISS-025`, `ISS-026`)
- [x] Search permission redaction & wildcard escaping matrix (`tests/integration/module-coverage.test.ts`, `ISS-039`)

## G. UI/UX (environment-limited where noted)

- [x] Empty/loading/error states present (components + E2E)
- [x] No fake buttons/TODO/dead code in release (CI grep gate + Phase A/D sweep; 0 ESLint warnings)
- [x] Full visual polish & responsiveness pass (`1280×720` and `1920×1080` verified in E2E; transparent-corner icons `ISS-041`; modal focus stability `ISS-034`)
- [ ] High-DPI 100–200% physical monitor sweep — **environment unavailable** (documented, never claimed)
- [ ] Physical printer hardware pass/fail — **environment unavailable** (documented, never claimed)

## H. Release

- [x] CI verify + E2E + NSIS installer + installed-artifact smoke green
- [x] PR checks wired (`pull_request` trigger, guarded side-effects) — `ISS-003`
- [x] Released with SHA-256 checksums (`SHA256SUMS.txt`)
- [x] Requirement traceability revalidated at V1.1 (`docs/TRACEABILITY.md`, `docs/V1.1_ISSUE_REGISTER.md`)
- [x] Second independent audit complete (`ISS-001` through `ISS-041` resolved and regression-tested)
