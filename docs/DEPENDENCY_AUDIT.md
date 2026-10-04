# Dentiva Pro — Dependency & License Audit

_Status: FINALIZED for V1.1 (2026-09-28). Release gate: `npm audit --omit=dev` clean —
status tracked in docs/V1.1_ISSUE_REGISTER.md (ISS-001)._

## Criteria for shipping
1. Permissive license compatible with commercial closed-source distribution (MIT/ISC/Apache-2.0/BSD/CC0/OFL).
2. No network calls at runtime (offline requirement).
3. No paid API/service dependency.
4. No known high/critical vulnerability in shipped code path.
5. Actively maintained or trivially replaceable.

## Production dependencies (actual, from committed lockfile at V1.1 freeze)

| Package | License | Purpose | Runtime net? | Notes |
|---|---|---|---|---|
| electron | MIT | desktop shell | no | devDependency, packaged into installer; upgraded in V1.1 to a supported major (ISS-002) |
| react / react-dom 18.3.x | MIT | UI | no | |
| better-sqlite3 | MIT | embedded DB | no | native, rebuilt for Electron (`install-app-deps`) |
| @node-rs/argon2 2.x | MIT | password hashing | no | N-API prebuild |
| archiver 7.x | MIT | backup zip writing | no | |
| unzipper 0.12.x | MIT | backup zip reading | no | |
| react-router-dom 7.18.x | MIT | routing | no | upgraded from 6.x in V1.1 for advisory fix (ISS-001) |
| vite, typescript, eslint, vitest, playwright, electron-builder … | MIT/APACHE | build/test only | n/a | devDependencies — not shipped |

Rejected dependencies: chart libs (CSS-only charts suffice), UI kits (design system is
hand-authored → fewer license/surface risks), moment/dayjs (native Intl sufficient),
electron-updater (offline product — no auto-update channel by design).

## Third-party notices
See `THIRD_PARTY_NOTICES.md` (generated at freeze) — includes bundled fonts (OFL):
Inter, Noto Sans Bengali, Noto Sans.


## V1.1 audit results (2026-09-28)

| Check | Result |
|---|---|
| Licenses (all prod + fonts) | MIT ×8, OFL-1.1 ×2 — permissive only, no copyleft (see THIRD_PARTY_NOTICES.md) |
| Runtime network calls | none (offline audit: no fetch/XHR/socket code in src; CSP `connect-src 'none'`) |
| `npm audit --omit=dev` | **2 moderate at audit start (react-router 6.x) → cleared by react-router-dom 7.18.x upgrade (ISS-001)** |
| `npm audit` (incl. dev) | 14 at audit start → addressed via vitest 5 / tooling upgrades where CI-safe; residual dev-only advisories documented below |
| Unnecessary packages | jimp + png-to-ico used by `scripts/generate-icons.mjs` (build-time only); unzipper/archiver required by backup; no dead runtime deps |
| Rejected (kept out) | chart libs, UI kits, moment/dayjs, electron-updater (offline by design) |

### Upgrade decisions (mission §53: necessary, safe, tested, compatible)

1. **react-router-dom 6.30.6 → 7.18.x — necessary** (moderate advisory in shipped path; gate demands clean `--omit=dev`).
2. **electron 33.x → supported major — necessary** (unsupported/EOL runtime + npm high advisory in shipped path; validated by full CI: unit/E2E/packaging/smoke).
3. **vitest 2.x → 5.x — dev-only** (clears critical @vitest/mocker advisory chain); tests re-run green after upgrade.
4. No other major bumps without a security/compatibility need (feature freeze).
