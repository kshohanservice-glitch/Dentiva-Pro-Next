# Dentiva Pro — Printing & PDF Architecture

Printing is a first-class subsystem: one document model → renderer templates → Chromium
print engine (interactive print dialog or printToPDF).

## Pipeline

1. **Document data** (invoice/prescription/report view-model) prepared by service layer
   with permission checks.
2. Renderer opens a dedicated **print window** (offscreen-hidden BrowserWindow, one per job)
   at route `/print/<doc>/<id>?profile=<printerProfileId>` with all fonts/assets local.
3. Print window waits for `document.fonts.ready` + layout, then:
   - **Interactive print:** `webContents.print({ silent, deviceName, copies, margins })`
     using a printer from `getPrintersAsync()` (Windows printer list — includes network,
     wireless and Bluetooth printers exposed by Windows, plus "Microsoft Print to PDF").
   - **Save as PDF:** dialog → `webContents.printToPDF({ pageSize, margins, printBackground })`
     → file write with result verification.
4. Success reported only after the API callback/PDF write confirms; failures surface real errors.

## Paper formats

| Profile | Page geometry |
|---|---|
| A4 | 210 × 297 mm |
| A5 | 148 × 210 mm |
| Thermal / mini | custom width (58/80 mm configurable) × auto height |
| Custom | user-defined width × height (mm) |

Implemented with per-template `@page { size: W H; margin: … }` CSS injected from the
selected **printer profile**; layout **reflows** (flex/grid + container-driven), it is not
simply scaled — thermal templates use a single-column compact variant of the same document
model (invoice total block, line items, footer), prescriptions fall back to A5-class layout
for widths < 110 mm.

## Printer profiles (stored in settings)

Fields: name, documentType (prescription|invoice|report|receipt), printerName (or
`default`), paperSize (a4|a5|thermal|custom), widthMm, heightMm, orientation, marginsMm
{t,r,b,l}, scale (fit/100%), copies, color. Seeded defaults: Prescription-A4, Prescription-A5,
Invoice-A4, Invoice-A5, Receipt-Thermal80.

## Document templates

- **Prescription:** clinic header (logo, name, address, phones) / patient row
  (name, code, sex/age, date) / two-column clinical body (left: C/C, O/E, R/E, Diagnosis,
  Treatment, Advice — labels **configurable in Settings**; right: numbered medicine table)
  / footer message + visiting hours / **reserved blank signature area** (≥25 mm height,
  no content rendered inside).
- **Invoice:** clinic header only (no signature), invoice meta, line table, totals block,
  paid/due/status, payment method summary, footer note.
- **Reports:** consistent header/scope/footer for all printable reports (patient list,
  payments, dues, income/expense, inventory, audit…).

## Bengali & fonts

- Bundled local fonts (OFL): Noto Sans Bengali (Bengali), Noto Sans (Latin fallback) —
  no CDN. Font stack order guarantees mixed en/bn runs shape correctly.
- Verified by render tests capturing print-window screenshots/PDF text extraction
  containing Bengali glyphs (tests/printing).

## Page-break & multipage rules

- `break-inside: avoid` on rows/blocks, repeating header via template re-render logic,
  footer with page numbers via `@page` margin boxes where supported; overflow verified
  with long-content fixtures (50+ medicines, 80+ invoice lines, long Bengali names).

## Preview

Print preview = the actual print window in preview mode (same DOM as output → parity),
with controls: printer, paper, orientation, margins, copies, scale/fit, range (where
supported by driver), plus Save-as-PDF. Preview renders exactly what will print
(same CSS media) — WYSIWYG by construction.

## Failure handling

- No printer → friendly error + Save-as-PDF fallback offered.
- Print cancel (user cancels dialog) → status "cancelled", not "printed".
- PDF write failure (locked/disk full) → actual error, file not claimed saved.
