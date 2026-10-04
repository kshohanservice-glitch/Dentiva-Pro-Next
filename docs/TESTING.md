# Dentiva Pro — Testing Strategy

## Layers

### 1. Unit tests (Vitest, headless CI)
- Validation helpers (phone/bangladesh formats, dates, age, required fields)
- Money math: invoice totals, discounts, partial/over/zero payments, refund math,
  inventory qty ledger, expiry math
- Permission matrix: role × permission (all built-in roles), override application
- Currency formatting (BDT ৳), sequences, duplicate-detection scoring
- Activation verifier (obfuscated fixture; never plaintext)
- Filename sanitization / path traversal attempts

### 2. Integration tests (Vitest + real SQLite temp DB, full service layer)
- Migrations up from zero; integrity_check; FK enforcement; audit immutability triggers
- Patient CRUD + duplicate detection + soft delete/archive
- Visit workflow; tooth condition supersede-history replay
- Prescription create/list/print-view model
- Appointment double-booking & override; queue state machine
- Invoice + payment workflows: paid/partial/due/overpayment/refund/void, invariants
- Inventory: stock in/out/damage/expire/return, negative-stock rejection, low/expiry alerts
- Accounting: expense/income entries, report aggregation
- RBAC at service boundary: unauthorized call ⇒ throws PermissionError (not UI-level)
- Backup→restore roundtrip; corrupt backup rejection; pre-restore behavior
- Search respects permissions; dashboard aggregates redaction
- Audit: sensitive actions recorded; UPDATE/DELETE rejected by DB

### 3. E2E tests (Playwright _electron)
- First-run setup wizard → login → lock/logout → dashboard
- Patient create → profile tabs → visit → chart edit → prescription
- Appointment → queue call/complete
- Invoice → payment → due shows correctly
- Settings edit; backup manual; unauthorized user cannot open restricted page
- Window resize at 1280×720 min size; keyboard shortcut smoke

### 4. Non-functional QA (manual + scripted where feasible)
- Performance fixture: seeded 20k patients / 60k visits / 100k invoices — measure search,
  profile open, dashboard, reports (results recorded in FINAL_RELEASE_REPORT)
- Stress: rapid navigation/search/lock loops (scripted in integration tests)
- Print matrix: prescription/invoice × A4/A5/thermal × en/bn × long content (render
  fixtures + layout assertions; physical printer pass/fail recorded honestly as
  environment-limited if no printer available)
- DPI: screenshots at 100–200% emulation
- Install/uninstall clean-machine: Windows VM/runner checks (CI windows-latest + manual checklist)

## Commands

- `npm run lint` — ESLint (no unused/dead code rules)
- `npm run typecheck` — `tsc --noEmit` (all projects)
- `npm test` — unit + integration (Vitest run)
- `npm run test:e2e` — Playwright Electron suite (needs display / xvfb on Linux)
- `npm run build` — production renderer+main build
- `npm run dist` — electron-builder NSIS artifact

## Release gate rules

- All unit+integration green; E2E green on release commit (Windows runner or local).
- No flaky-pass: failing tests fixed at root cause, never skipped or deleted.
- Coverage of service layer modules reported (informational, not a vanity gate).

## Honesty policy

Tests assert real behavior (transactions, files, checksums) — not mocked "success".
Physical-printer validation is tracked as an explicit checklist item; if the release
environment has no printer, the release report states it as an environmental limitation
with the print-render fixtures as evidence — never as "printer tested".
