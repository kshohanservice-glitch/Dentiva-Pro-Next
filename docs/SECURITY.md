# Dentiva Pro — Security Model

## 1. Threat model (offline desktop)

Assets: patient clinical data, financial records, user credentials, audit trail, backup files.
Attacker classes considered: curious unauthorized staff member (primary), misused UI,
tampered renderer state, direct IPC calls, stolen backup file, casual file-system access.
Out of scope (documented honestly): a determined attacker with admin rights over the
Windows machine and the binary — offline software cannot fully resist local reverse
engineering (see §6 Activation honesty).

## 2. Authentication

- Argon2id (via @node-rs/argon2, OWASP-recommended params: m=19MB? — use m=19456 KiB,
  t=2, p=1 — tune to <100ms on target) with random 16-byte salt, PHC string storage.
- Login: username+password → constant-time verify; failure counter `failed_attempts`;
  after 5 failures → temporary lock 5 minutes (`locked_until`), logged in audit as failed login.
- No plaintext password ever stored, logged, audited, or echoed in errors.
- Session lives in main process memory only; renderer receives non-sensitive profile info.
- Manual **Lock** (Ctrl+L) and **Auto-lock** (5/10/15/30 min, default 10; disable only via
  settings policy) → lock overlay requires password re-auth; cached patient/financial views
  are cleared beneath the overlay.
- Logout clears session + audit.

## 3. Authorization (RBAC)

- Granular permission keys (~70) grouped: patients, clinical, billing, payments,
  inventory, accounting, staff, users, settings, backup, audit, reports, admin.
- Built-in roles: Owner (all), Administrator, Dentist, Dental Assistant, Receptionist,
  Accountant, Inventory Manager + custom roles.
- **Enforcement point:** `requirePermission(session, key)` inside the service layer before
  any read/write. IPC handler → session lookup → permission gate → service. UI hiding is
  cosmetic only.
- Financial permission (`finance.view`, `accounting.view`, `staff.salary.view`, …) checked
  in queries too: unauthorized roles receive redacted/absent values, including through
  global search and dashboard aggregates.
- Overrides: per-user grant/revoke table applied on top of role.

## 4. Data layer protections

- Prepared statements only (no string-concat SQL) → SQLi defense.
- Audit log insert-only via SQLite triggers (UPDATE/DELETE rejected at DB level).
- Sensitive settings/activation state encrypted with Electron `safeStorage`
  (DPAPI on Windows).
- Attachments stored outside DB with generated UUID paths; original filename sanitized
  (strip path separators, control chars, reserved Windows names, length cap); path
  resolution validated to remain inside the attachments root (path-traversal defense);
  extension allowlist + MIME sniff (magic bytes) for images/PDF/docs; size limit (100 MB default).
- Backup files: validated manifest + SHA-256 checksum on restore; restore only after
  integrity_check on the extracted copy and automatic pre-restore backup.

## 5. Renderer hardening

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- CSP: `default-src 'self'; img-src 'self' data: file:; style-src 'self' 'unsafe-inline';
  font-src 'self'; connect-src 'none'` (no network at runtime).
- No `eval`, no remote content, no shell exposure via IPC; every IPC channel allowlisted.
- Error surfaces show friendly text + correlation id; stack traces only in redacted local logs.

## 6. Activation (offline) — honest design

- Mandatory code: verified **only via a derived verifier**: PBKDF2-HMAC-SHA256
  (480k iters, per-install random salt in the verifier blob) of a machine-independent
  domain-separated derivation of the code; the plaintext code appears in **no** source,
  config, asset, test fixture, log, or error string. The verifier itself is stored
  XOR-sharded/assembled at runtime (not a single obvious literal) and compared with
  `crypto.timingSafeEqual`.
- Activation state stored encrypted via safeStorage (DPAPI on Windows) + flag file.
- **Honest limitation (documented in About/SECURITY.md):** because the app is fully offline
  and the activation secret is fixed, no purely local scheme makes the secret impossible to
  recover by sufficiently capable reverse engineering. We minimize attack surface, avoid
  plaintext, and avoid perfect-secrecy claims. No phone-home, no license server.

## 7. Logging & privacy

- Rotating file logs (5 × 2 MB), automatic cleanup; redaction filter for keys matching
  password/token/secret/activation/code? (activation only).
- Notifications avoid exposing clinical/financial detail to unauthorized users.
- No telemetry; no network sockets at runtime.

## 8. Supply chain

- Dependency inventory + license audit in docs/DEPENDENCY_AUDIT.md and
  THIRD_PARTY_NOTICES.md; only permissive licenses (MIT/Apache-2.0/BSD/ISC/OFL);
  `npm audit --omit=dev` clean required for release gate.

## 9. Destructive-action safeguards

- Delete/restore/business-reset flows: permission check → explicit warning dialog →
  typed confirmation (`DELETE`, clinic name, or amount) → transactional execution →
  audit record. Pre-restore automatic backup mandatory.
