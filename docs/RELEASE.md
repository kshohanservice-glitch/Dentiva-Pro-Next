# Dentiva Pro — Release & CI Strategy

## Versioning
- Semver in `package.json`; tag `v1.0.0` triggers release pipeline.
- `schemaVersion` independent (integer, forward-only).

## GitHub Actions (`.github/workflows/ci.yml` + `release.yml`)

**ci.yml** (push/PR to main & release branch):
1. `quality` @ ubuntu-latest: npm ci → lint → typecheck → unit+integration tests
   → production build (renderer/main) → artifact smoke (main bundle exists, no dev deps in bundle).
2. `windows-package` @ windows-latest: npm ci → tests → `electron-builder --win nsis`
   → upload `dist/*.exe` + SHA256SUMS as artifacts.
3. `e2e-windows` @ windows-latest (after package): Playwright Electron E2E against built app.

**release.yml** (tag `v*`):
1. Run quality + windows package.
2. Validate artifact: file exists, size sanity, `7z l`/nsis header check, checksums.
3. Create GitHub Release with `.exe`, `SHA256SUMS.txt`, release notes
   (softprops/action-gh-release).
4. Fallback: if release upload fails → commit artifact into `dist/` on the release branch
   so the repository always contains the final `.exe`.

## PR flow
- Feature work via branch → PR → CI green → review-ready merge → tag → release.
- Final release artifact must come from CI-produced build (not an ad-hoc local binary).

## Installer (electron-builder NSIS)
- `oneClick: false`, per-user install (no admin required), custom dir, Start Menu +
  desktop shortcuts (choice), **proper uninstaller**, run-after-finish option.
- Uninstall default: **preserve** clinic data (`%APPDATA%\DentivaPro`); an explicit
  "remove all data" option in uninstaller with warning (NSIS custom page) or documented
  settings-side data reset requiring typed confirmation.
- Clean-machine verification checklist (docs/RELEASE_CHECKLIST section in FINAL_RELEASE_REPORT):
  install → activate → setup → login → core workflows → print/PDF → backup/restore → uninstall.

## Build hygiene
- `npm ci` with committed lockfile; exact dependency versions.
- No dev server in production; NODE_ENV=production; dev menu/debug overlays stripped.
- Source maps excluded from shipped app (kept as CI artifacts for support).
