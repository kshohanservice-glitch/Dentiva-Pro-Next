# Dentiva Pro — Architecture & ADR-001 Technology Stack Selection

## 1. Selected stack

| Layer | Choice |
|---|---|
| Desktop shell | Electron (Chromium + Node.js main process) |
| UI | React 18 + TypeScript, Vite build |
| Styling | Hand-authored CSS design system (CSS variables/tokens, no UI framework) |
| State | Lightweight typed store (React context + reducers) with a small global store for session/app state |
| Database | SQLite via `better-sqlite3` (WAL, FK ON, synchronous transactions) |
| Password hashing | Argon2id via `@node-rs/argon2` (N-API prebuilt, memory-hard) |
| PDF/print | Chromium print engine: `webContents.print()` (Windows printer enumeration incl. network/BT/USB printers exposed by Windows) and `webContents.printToPDF()` (Save as PDF) |
| Packaging | `electron-builder` → NSIS Windows installer (`DentivaPro-Setup-x.y.z.exe`) |
| Tests | Vitest (unit + integration against real SQLite), Playwright `_electron` (E2E) |
| CI | GitHub Actions: Linux job (lint/typecheck/unit/integration), Windows job (build/package/E2E), release job |

## 2. Why Electron (ADR-001)

### Requirements driving the decision

Windows desktop deployment, fully offline operation, local embedded DB, native file
dialogs, printer enumeration, PDF output, Bengali Unicode, high-DPI, premium responsive
UI, installer generation, reproducible CI builds, and a codebase that must be testable in
automated CI (including on non-Windows runners for the majority of the logic).

### Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Tauri (Rust + web UI)** | Requires Rust toolchain + Windows cross toolchain for the release target; smaller ecosystem for Windows printer/dialog parity; higher per-platform risk for a feature-frozen 1.0. No Rust toolchain exists in the build environment; long build chains would jeopardize release gates. |
| **.NET WPF / WinUI 3** | Strong Windows-native choice, but: no .NET SDK/design tooling in this environment; WPF XAML testing/CI on Linux runners is limited; premium cross-resolution UI velocity is lower; web stack gives better design-system leverage for the mandated premium look. Windows-only framework makes the bulk of tests unrunnable in CI's Linux matrix. |
| **Electron** | ✅ Selected. One codebase; main-process Node has mature SQLite/Argon2/backup/print libraries; `printToPDF` + `print` cover the mandated print flows; NSIS installers can be produced by `electron-builder` on Windows CI runners (clean-machine reproducible); the entire service layer is unit/integration-testable headless in CI; Chromium guarantees Bengali Unicode rendering with bundled fonts. |

### Trade-offs accepted

- **Memory footprint** (~150–250 MB) vs. native WPF (~80 MB): mitigated by lazy route
  loading, virtualized tables, WAL DB, and avoiding chart/UI libraries.
- **Bundle size** (~120 MB installer incl. Chromium): acceptable for desktop clinic software distributed on USB/local install.
- **Chromium in-app printing** delegates final paper geometry partly to the Windows driver;
  mitigated with `@page` CSS per profile + preview parity testing (docs/PRINTING.md).

### Security considerations

- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  strict CSP (no remote scripts, no `eval`), and a narrow `contextBridge` API.
- All business rules and permission checks live in the main process service layer — the
  renderer cannot bypass RBAC by manipulating UI state or calling IPC directly without a
  valid session + permission (docs/SECURITY.md).

### Performance considerations

- `better-sqlite3` synchronous API removes IPC round-trips per row; prepared statements;
  composite indexes; paginated/virtualized lists; WAL for concurrent reads.
- Dashboard/reports query only indexed date ranges; heavy exports stream to disk.

### Maintainability / offline / packaging / testing

- Strict TypeScript across main/preload/renderer; no runtime code generation.
- Zero network calls at runtime: fonts, icons and all assets are bundled; no telemetry.
- `electron-builder` NSIS target with proper shortcuts/uninstall; GitHub Actions Windows
  runner produces the release `.exe`.
- Vitest runs the real service layer against temp SQLite DBs → high-fidelity tests.

## 3. High-level architecture

```
┌────────────────────────────────────────────────────────────┐
│ Renderer (sandboxed, CSP-restricted)                       │
│  React app · design system · pages · local UI state        │
└──────────────┬─────────────────────────────────────────────┘
               │ contextBridge (typed API, no Node access)
┌──────────────▼─────────────────────────────────────────────┐
│ Preload: validates channel names, serializes payloads      │
└──────────────┬─────────────────────────────────────────────┘
┌──────────────▼─────────────────────────────────────────────┐
│ Main process                                               │
│  IPC router → session + RBAC guard → Service layer         │
│     (patients, visits, chart, prescriptions, appts, queue, │
│      billing, inventory, accounting, staff, users, backup, │
│      settings, audit, search, notifications, reports)      │
│        → Repositories (SQL) → SQLite (WAL)                 │
│  Cross-cutting: logger (rotating, redacting), audit,       │
│  activation state (DPAPI/safeStorage), auto-lock timer,    │
│  printer/print windows, backup engine, file storage        │
└────────────────────────────────────────────────────────────┘
```

## 4. Process boundaries

- **Single instance lock** — second launch focuses the first window.
- **Startup checks** — DB `quick_check` integrity probe; on failure, surface recovery UI
  (choose backup) instead of opening a corrupt DB.
- **Auto-lock** — main-process idle timer authoritative; renderer pings activity (throttled);
  on expiry main broadcasts lock, renderer clears cached sensitive views and shows the lock
  overlay requiring password re-auth (session retained, logout optional).

## 5. Data directory layout (per-user, `%APPDATA%\DentivaPro` in production)

```
DentivaPro/
  data/dentiva.db            # SQLite main database (WAL sidecar files alongside)
  attachments/<entity>/<uuid>/<safe-filename>
  backups/DentivaPro_Backup_YYYY-MM-DD_HH-mm-ss.dpv   # .dpv = zip container
  logs/app-YYYY-MM-DD.log    # size-rotated, redacted
  activation/state.bin       # encrypted activation state (safeStorage/DPAPI)
```

## 6. Key design rules

1. **Service-layer enforcement** — every IPC handler resolves `Session → Permission → Service call`.
   No service method trusts the renderer.
2. **Transactions** — any multi-row business operation runs in one SQLite transaction;
   success is reported only after commit.
3. **Immutability of history** — clinical/financial history rows are never UPDATEd in place;
   corrections use void/adjust entities (see docs/DATABASE.md §6).
4. **Snapshots** — invoice line items and prescription/visit content store their own copies
   of names/prices at creation time.
5. **No dead UI** — every control reachable in the renderer maps to a working handler;
   unreachable features are removed, not stubbed.

## 7. Versioning

- App semver in `package.json` (1.0.0 for the frozen release).
- Independent integer **schema version** in `PRAGMA user_version`; forward-only migrations
  executed transactionally at startup; pre-migration backup for destructive steps.
