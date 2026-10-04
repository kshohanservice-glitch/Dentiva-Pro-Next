# Dentiva Pro — UX / Design System Specification

**Direction:** Premium Clinical Technology — trust, cleanliness, precision, professionalism,
calm efficiency. No generic admin-dashboard look, no childish gradients, no decorative noise.

## Tokens (CSS variables in `src/renderer/styles/tokens.css`)

### Color
| Token | Value (light) | Use |
|---|---|---|
| `--brand-700` | `#0B5E7B` | primary actions, brand |
| `--brand-800` | `#084B63` | hover/pressed |
| `--brand-50` | `#E8F4F8` | primary tints |
| `--accent-600` | `#0E7C86` | teal clinical accent |
| `--surface-0/1/2` | `#F6F8FA` / `#FFFFFF` / `#EEF2F5` | backgrounds, cards, wells |
| `--text-1/2/3` | `#12242E` / `#43565F` / `#6B7C85` | headings/body/muted (AA+) |
| `--line` | `#D9E2E8` | borders |
| `--success/warning/danger/info` | `#1E7A4B` / `#B26B00` / `#B42318` / `#175CD3` | status |
| Dark theme via `[data-theme=dark]` overrides (same semantics) |

Status is **never color-only** — badges pair color + icon + label.

### Typography
- UI: `"Inter", "Segoe UI", system-ui, "Noto Sans", "Noto Sans Bengali", sans-serif` (Inter bundled locally; Bengali fallback guaranteed by bundled Noto Sans Bengali).
- Scale: 12/13/14/16/18/22/28 px; line-heights 1.35 (display) / 1.5 (body).
- Numerals: `font-variant-numeric: tabular-nums` in tables, currency, charts.
- Bengali renders via font fallback automatically; never clip (`line-height ≥ 1.45` for bn).

### Space / radius / elevation
- Space: 4 8 12 16 20 24 32 40 48.
- Radius: sm 6, md 10, lg 14, pill 999. Cards ≤14 — restrained.
- Elevation: 3 shadow levels only (`--e1..e3`); dialogs/e1, popovers/e2, modals/e3.

### Motion
- 120–180 ms ease-out; transform/opacity only; interruptible; disabled under
  `prefers-reduced-motion` and Settings → Appearance → Animations off.

## Shell
- **Header (56 px):** brand mark + Dentiva Pro · clinic name · date (and time) · global
  search (Ctrl+K) · notification bell (unread count) · user chip (name, role badge) ·
  lock button · user menu (profile, settings, about, logout).
- **Sidebar (240 px collapsible → 64 px):** grouped nav (Practice / Clinical / Billing /
  Administration) per spec §15; persists collapse state; active indicator; tooltips when
  collapsed; keyboard reachable; text never overflows (min-width 0 + ellipsis).
- **Content:** max-width fluid, 24 px gutters, sticky page header (title, breadcrumbs,
  actions).
- Min window: **1180×680** (supports mandated 1280×720 with margin); responsive grids
  `auto-fit minmax(240px, 1fr)` for KPI cards (balanced 2/3/4/6 grids — no ragged wraps).

## Components (src/renderer/components)
Button (primary/secondary/ghost/danger × sm/md; loading; icon), IconButton, Input,
Select, Textarea, DateInput, Checkbox, Radio, Switch, Badge, Chip, Tag, Tooltip, Modal
(focus trap, Esc, safe-close confirm on dirty forms), Drawer, Tabs (roving tabindex),
Card, StatCard, DataTable (sticky header, sort, page/virtualize, empty/loading/error
states, row actions, keyboard row nav), EmptyState (icon + message + CTA), ErrorState
(message + Retry), Spinner/Skeleton, Toast (success/error, ARIA live), ConfirmDialog
(plain / typed-confirm variants), Breadcrumbs, SearchBox, FilePicker, Pagination,
Avatar, AlertBanner.

## States (mandatory on every data surface)
loading (skeleton) · empty (explains next action) · error (what happened + retry) ·
populated · permission-denied (explains required role).

## Keyboard shortcuts (global, non-conflicting)
Ctrl+K search · Ctrl+N new patient · Ctrl+Shift+N new appointment · Ctrl+Shift+V visit ·
Ctrl+Shift+P prescription · Ctrl+Shift+I invoice · Ctrl+L lock · Alt+1..9 nav ·
Ctrl+S save (in forms) · Esc cancel/close. Hints in tooltips/menus; suppressed while
typing in inputs (except Ctrl+K/L).

## Accessibility
- WCAG 2.1 AA contrast, visible focus ring (2 px brand outline), semantic landmarks,
  labelled controls, `aria-live` for toasts, dialogs as `role=dialog aria-modal`,
  tables with `<th scope>`, no focus traps outside modals, 32 px min hit target (36 default).

## Print look
Document templates share the token palette in print-safe form (pure white, #0B5E7B
accents, 10–11 pt body, ruled sections) — premium stationery feel for prescriptions/invoices.
