# Dentiva Pro — Requirement Traceability (Specification → Implementation → Tests)

Statuses: **Planned** → **Implemented** → **Tested** → **Passed** / **Blocked**.
Every numbered requirement of the Master Specification is accounted for.

| § | Requirement | Implementation | Tests | Status |
|---|---|---|---|---|
| 0 | Full plan before coding | docs/* (ARCHITECTURE, DATABASE, SECURITY, PRINTING, BACKUP_RESTORE, TESTING, RELEASE, UX_SYSTEM) | — | Passed |
| 1–3 | Plan-first / continuous execution / BUILD_STATE protocol | docs/BUILD_STATE.md maintained | — | Passed |
| 4 | Repo inspection/init | git history, structure, CI | — | Passed |
| 5 | Stack selection + ADR | docs/ARCHITECTURE.md ADR-001 | — | Passed |
| 6 | Offline-first | no network code (runtime), CSP connect-src none, bundled fonts | code audit + integration | Implemented |
| 7 | No paid API + audits | docs/DEPENDENCY_AUDIT.md (all deps offline-runtime) | dependency review | Implemented |
| 8–9 | Product identity, icon | assets/icon-source.png → build/icon.ico (16–256) | `npm run icons` verified | Passed |
| 10–13 | Design philosophy/design system/colors/typography | renderer/styles tokens, components library | visual QA checklist | Planned |
| 14 | Responsive desktop layout | shell min 1180×680, responsive grids | E2E resize | Planned |
| 15 | Global shell (header/sidebar) | AppShell component | E2E (nav asserted) | Tested |
| 16 | Dashboard widgets + permission-aware | Dashboard page + dashboard service | **E2E passed** (backup-now flow) | Passed |
| 17–19 | Patient mgmt/registration/list | Patients module (service + pages) | **integration + E2E passed** (register incl. Bengali, search) | Passed |
| 20–21 | Profile header/actions/tabs | PatientProfile (13 tabs) | E2E | Planned |
| 22–23 | Clinical timeline / visit history | timeline service + Visits tab | **integration passed** | Tested |
| 24 | Dental chart | ToothChart component + chart service (history-preserving) | **integration passed** (supersede history) | Tested |
| 25 | Treatment catalog | Treatments module | integration | Planned |
| 26 | Referrals | Referrals tab + module | integration | Planned |
| 27 | Appointments | Appointments module, conflict/override logic | integration | Planned |
| 28 | Queue | Queue module + state machine | integration + E2E | Planned |
| 29–31 | Prescriptions + clinical sections + print design | Prescriptions module + print templates | integration + print fixtures | Planned |
| 32–34 | Print formats / preview / printer profiles | print subsystem (docs/PRINTING.md) | print matrix tests | Planned |
| 35–36 | Invoice + formats | Billing module | **integration + E2E passed** (create invoice, totals) | Passed |
| 37–38 | Payments + reporting | Payments module + reports | **integration + E2E passed** (full payment on real UI) | Passed |
| 39–40 | Inventory + alerts | Inventory module | integration | Planned |
| 41–42 | Accounting + reports | Accounting module | integration | Planned |
| 43–44 | Staff / dentist management | Staff & Dentists modules | integration | Planned |
| 45–46 | User mgmt + granular RBAC | users/roles services, permission catalog | **integration passed** (unit matrix + service gates) | Passed |
| 47 | Financial enforcement in service layer | requirePermission in every financial service path | **integration passed** (direct-call denial audited) | Passed |
| 48 | Audit log | audit service + insert-only triggers | **integration passed** (append-only DB triggers) | Passed |
| 49 | Global search | search service (permission-filtered) | integration + E2E | Planned |
| 50 | Notification center | notifications service (deduped) | integration | Planned |
| 51 | Attachments | attachment service (sanitize, hash, permission) | integration (traversal, sizes) | Planned |
| 52–54 | Backup/auto/restore | backup engine (docs/BACKUP_RESTORE.md) | **integration + E2E passed** (manual backup on dashboard) | Passed |
| 55 | Destructive safeguards | ConfirmDialog typed-confirm flows | integration + E2E | Planned |
| 56 | Settings | Settings module (validated) | integration | Planned |
| 57–58 | Auto-lock / manual lock | main-process timer + lock overlay | integration + E2E | Planned |
| 59 | First-run setup wizard | SetupWizard flow | **integration + E2E passed** (full wizard on real app) | Passed |
| 60 | Activation (hashed, offline) | activation service (derived verifier, safeStorage state) | **integration + packaged-artifact smoke passed**; repo-wide literal scan | Passed |
| 61 | Auth security | auth service (Argon2id, lockout, no plaintext) | **integration + E2E passed** (login on real app) | Passed |
| 62–63 | DB architecture/relationships | schema migration 001 (docs/DATABASE.md) | **integration passed** (FK/WAL/pragmas/integrity) | Passed |
| 64 | Historical immutability | snapshots + superseded rows + audit triggers | **integration passed** | Tested |
| 65 | Unlimited records | no LIMIT-by-design; indexed pagination | perf fixture (20k patients) | Planned |
| 66 | Transactions | better-sqlite3 transactions in services | integration (rollback) | Planned |
| 67–70 | Error/loading/empty states | error boundary + EmptyState/ErrorState components | visual QA | Planned |
| 71 | Keyboard shortcuts | shortcut registry | unit + E2E | Planned |
| 72–73 | Accessibility / high-DPI | focus/contrast/aria; DPI QA checklist | visual QA | Planned |
| 74–75 | Performance / stress | perf tests + indexes | perf fixture results | Planned |
| 76–78 | File/backup/restore failure handling | validators + failure matrix | integration | Planned |
| 79–81 | Printing engine / Bengali print / PDF | print subsystem | print matrix + Bengali fixture | Planned |
| 82 | About | About page (version, schema, notices, developer info) | **E2E passed** (Shohan Khan + email) | Passed |
| 83–84 | Export / import decision | CSV export (permissioned); import documented as not shipped | integration | Planned |
| 85–86 | No fake functionality / dead code | lint rules + code audit + manual sweep | lint/audit | Planned |
| 87 | No TODO/FIXME/HACK | grep gate in CI | CI gate | Planned |
| 88 | Security audit | docs/SECURITY.md + audit pass | security QA tests | Planned |
| 89–90 | License audit / migrations | DEPENDENCY_AUDIT + migration system | npm audit + migration tests | Planned |
| 91 | Settings data safety | validated/dangerous-settings confirmations | integration | Planned |
| 92–93 | Business deletion / deletion policy | protected reset flow; void/archive semantics | integration | Planned |
| 94–96 | Installer / clean machine / uninstall | NSIS via electron-builder 26.15.3 | **CI silent-install + packaged smoke + uninstall passed** | Passed |
| 97 | Windows integration | dialogs/printers/DPI checklists | manual + E2E | Planned |
| 98 | Crash recovery | WAL + startup integrity check + crash log | integration | Planned |
| 99–100 | Release build / version freeze | production build config | build gate | Planned |
| 101–103 | GitHub Actions / PR flow / release | .github/workflows/ci.yml (verify/e2e/package/release) | **CI green (run 36369672016); Release v1.0.0 published** | Passed |
| 104 | Artifact validation | silent install + packaged activation/setup/sign-in + SHA-256 triangulation | **FINAL_RELEASE_REPORT §1** | Passed |
| 105 | Automated testing | tests/unit, tests/integration, tests/e2e | **vitest 60/60 + Windows E2E 6/6 + installed-artifact smoke** | Passed |
| 106–120 | Visual/button/form/search/financial/inventory/appointment/chart/attachment/backup/security/perf/stress/print/data-consistency QA | QA docs + tests as mapped above | suite + QA log | Planned |
| 121–122 | No silent failure / logging | result-verified operations; rotating redacted logs | integration | Planned |
| 123–124 | Privacy / clinical safety | redaction, no auto-diagnosis | review | Planned |
| 125–126 | i18n / currency | English UI, bn content support, ৳ BDT formatting | **unit passed**; Bengali patient name entered in E2E | Passed |
| 127 | Reporting | reports (printable/CSV) | integration | Planned |
| 128–133 | Global UX/nav/modals/tables/long content/final UX audit | design system + QA checklist | visual QA | Planned |
| 134–135 | Final code/requirement audit | audit docs + this matrix | audit pass | Planned |
| 136 | Acceptance checklist | docs/ACCEPTANCE_CHECKLIST.md | signed off in release report | Planned |
| 137 | Release blockers policy | enforced in FINAL_RELEASE_REPORT | — | Planned |
| 138 | Final release report | docs/FINAL_RELEASE_REPORT.md | — | Planned |
| 139 | Quality gate | all 17 gates evidenced | — | Planned |
| 140 | Must-not-do list | enforced by audits (secrets scan, fake-UI sweep) | CI secrets/TODO gates | Planned |
| 141 | Documentation set | docs/* | review | Planned |
| 142–144 | Completeness review / second recheck / second QA | documented audit passes | — | Planned |
| 145 | Release freeze | tag + lockfile freeze | — | Planned |
| 146 | Final output report | FINAL_RELEASE_REPORT.md + summary to user | — | Planned |
