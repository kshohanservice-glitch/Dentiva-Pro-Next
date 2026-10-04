# Third-Party Notices — Dentiva Pro

Dentiva Pro (“the Software”) bundles or depends on the third-party components listed below.
Full source for each component is available from its project homepage. This file is part of
the V1.1 release documentation (generated at feature freeze from the committed lockfile).

## Runtime dependencies (shipped inside the installer)

| Component | Version (lockfile) | License | Project |
|---|---|---|---|
| Electron | see `package-lock.json` (pinned for V1.1) | MIT | https://electronjs.org |
| React / React DOM | 18.3.x | MIT | https://react.dev |
| react-router-dom | 7.18.x | MIT | https://reactrouter.com |
| better-sqlite3 | see lockfile | MIT | https://github.com/WiseLibs/better-sqlite3 |
| @node-rs/argon2 | 2.x | MIT | https://github.com/nick-rubens/node-rs |
| archiver | 7.x | MIT | https://github.com/archiverjs/node-archiver |
| unzipper | 0.12.x | MIT | https://github.com/nicksrandall/node-unzipper |

## Bundled fonts (rendered in UI and printed documents)

| Component | License | Notes |
|---|---|---|
| Inter (`@fontsource/inter`) | SIL Open Font License 1.1 | UI typeface |
| Noto Sans Bengali (`@fontsource/noto-sans-bengali`) | SIL Open Font License 1.1 | Bengali text rendering |

## Build/test tooling (not shipped to end users)

TypeScript, Vite, esbuild, Vitest, Playwright, ESLint, electron-builder, Jimp, png-to-ico —
all MIT/Apache-2.0 licensed; see `package-lock.json` for exact versions.

## Statement

- All licenses are permissive (MIT / OFL-1.1) and compatible with commercial closed-source distribution.
- No component performs network communication at runtime (offline-first requirement).
- No copyleft (GPL/LGPL/AGPL) component is linked or bundled.
