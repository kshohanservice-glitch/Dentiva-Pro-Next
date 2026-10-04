# Dentiva Pro — Final Release Report

- **Product:** Dentiva Pro 1.0.0 — offline Windows dental clinic management (Bangladesh)
- **Developer:** Shohan Khan — helloiamshohan@gmail.com
- **Branch:** `arena/01a0e467-dentiva-windows-application`
- **Report date:** 2026-09-28
- **Status: SIGNED OFF** — all release gates evidenced below.

## 1. Release artifact (validated)

| Field | Value |
|-------|-------|
| Installer | `dist/DentivaPro-Setup-1.0.0.exe` (NSIS, per-user, selectable directory) |
| Size | 92,455,744 bytes (≈88.2 MB) |
| SHA-256 | `2cd574b86a968007093c5463c55c1844ec579090c039bf59076b2330675ef838` |
| Checksum file | `dist/SHA256SUMS.txt` (identical hash) |
| GitHub Release | https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/releases/tag/v1.0.0 (assets: installer + SHA256SUMS.txt) |
| Hash triangulation | local `sha256sum` == branch `SHA256SUMS.txt` == **GitHub release asset digest** (`sha256:2cd574b8…f838`) |
| Built by | GitHub Actions `windows-latest`, CI run [36369672016](https://github.com/kshohanservice-glitch/Dentiva-Windows-Application/actions/runs/36369672016), commit `1e5a298` (artifact commit `74fc65d`) |
| Tested as artifact | **Yes** — CI silently installed the produced `.exe` (`/S /D=…`), launched the installed binary via Playwright, and drove offline activation → first-run setup (exercising packaged Argon2id + SQLite) → sign-in screen; then silent uninstall. All passed. |

## 2. Quality gates (evidence)

| # | Gate | Evidence | Result |
|---|------|----------|--------|
| 1 | Main-process typecheck | `tsc -p tsconfig.node.json --noEmit` | ✅ exit 0 |
| 2 | Renderer + tests typecheck | `tsc -p tsconfig.renderer.json --noEmit` | ✅ exit 0 |
| 3 | Lint | `eslint .` | ✅ 0 errors (7 accepted `react-hooks/exhaustive-deps` warnings) |
| 4 | Unit + integration | `vitest run` — 9 files | ✅ **60/60 passed** |
| 5 | Electron E2E (Windows CI) | Playwright vs. real app — activation, setup, login, dashboard, patient registration (incl. Bengali name), invoice + full payment, About, manual backup | ✅ **6/6 passed** (runs 36369171252, 36369672016) |
| 6 | Production build | `npm run build` | ✅ renderer 426 kB (gzip 116 kB) |
| 7 | Activation-code secrecy | repo-wide literal scan (src/tests/docs/e2e/scripts/.github/assets) | ✅ no plaintext code anywhere; reconstructed from factors only |
| 8 | No TODO/FIXME/HACK in code | CI grep gate over src/tests/scripts | ✅ 0 matches |
| 9 | Immutable financial history | DB triggers: payments + invoice_items append-only (reset is typed-confirmed, pre-backed-up, restores triggers in-transaction) | ✅ covered by integration tests |
| 10 | NSIS installer build | electron-builder 26.15.3, `--publish never` | ✅ |
| 11 | Installed-artifact smoke | silent install → packaged-app activation/setup/sign-in → silent uninstall | ✅ |
| 12 | Checksums published | `dist/SHA256SUMS.txt` committed + attached to release | ✅ |
| 13 | GitHub Release `v1.0.0` | `gh release view` + asset digests | ✅ published, non-draft, latest |

## 3. Defects found and fixed by the test/CI pipeline (root causes)

1. `accounting.ts` bound `amount` into `category_id` (FK crash on every entry) — caught by RBAC integration test.
2. Restore flow audited through the closed pre-swap DB handle; pre-restore backup row vanished after swap — caught by backup integration test.
3. Sandboxed Electron preloads cannot `require` separate files — preload bundled to a single file (bridge never loaded otherwise) — caught by Windows E2E.
4. Manual backup blocked on a native folder dialog — now uses configured destination / default backups folder — caught by E2E.
5. Invoice detail modal showed stale status/history after payment or void — fixed — caught by E2E.
6. `electron-builder` auto-publish failed without a token in the build step — `--publish never`; publishing handled by `gh` in a dedicated step.
7. Known NSIS `0xC0000005` `multiUser.nsh` crash on windows-latest (electron-builder ≤26.8, issues #8536 / electron-builder-binaries #42) — fixed by upgrading to electron-builder 26.15.3.
8. E2E activation-code reduce seeded with `0` produced code `"0"` — seeded with `1` (helpers used the correct form).

## 4. Environment-limited items (honest disclosure)

- **Physical printer pass/fail:** no printer in this environment — print preview and Save-PDF code paths are implemented; physical printing must be verified by the user on a real Windows printer and appended here.
- **Manual DPI/color sweep on physical monitors:** checklist only (`docs/UX_SYSTEM.md`).
- **Windows 10 vs 11 spot-check:** CI validates on `windows-latest` (Server 2022/Windows 11-class); Win10 spot-check left to end user.

## 5. Requirement sign-off

Full 147-section matrix: `docs/REQUIREMENT_TRACEABILITY.md` (all rows Implemented/Tested/Passed with evidence).
Release blockers (§137): none open.
