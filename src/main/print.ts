import { BrowserWindow, dialog, app, type WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { PrintProfile } from '../shared/types';
import { AppError } from './errors';

export interface PrintDocRef {
  type: import('../shared/ipc').PrintDocKind;
  id: number;
  reportName?: string;
  profileId?: string;
  params?: Record<string, string>;
}

let printWindow: BrowserWindow | null = null;

export function resolveWindowIcon(): string | undefined {
  const candidates = process.platform === 'win32'
    ? ['icon.ico', 'icon.png']
    : ['icon.png', 'icon.ico'];
  for (const name of candidates) {
    const p = path.join(app.getAppPath(), 'build', name);
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return undefined;
}

function appHtml(): string {
  return path.join(app.getAppPath(), 'dist', 'renderer', 'index.html');
}

export function buildPrintHash(doc: PrintDocRef): string {
  const sp = new URLSearchParams();
  if (doc.reportName) sp.set('report', doc.reportName);
  if (doc.profileId) sp.set('profile', doc.profileId);
  if (doc.params) {
    for (const [k, v] of Object.entries(doc.params)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
  }
  const qs = sp.toString();
  return `#print/${doc.type}/${doc.id}${qs ? `?${qs}` : ''}`;
}

export function openPrintWindow(doc: PrintDocRef): void {
  const hash = buildPrintHash(doc);
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.focus();
    void printWindow.loadFile(appHtml(), { hash: hash.slice(1) });
    return;
  }
  printWindow = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 720,
    minHeight: 540,
    title: 'Print — Dentiva Pro',
    autoHideMenuBar: true,
    show: false,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  printWindow.once('ready-to-show', () => printWindow?.show());
  printWindow.on('closed', () => { printWindow = null; });
  void printWindow.loadFile(appHtml(), { hash: hash.slice(1) });
}

export function closePrintWindow(): void {
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.destroy();
  }
}

export function getPrintContents(): WebContents {
  if (printWindow && !printWindow.isDestroyed()) return printWindow.webContents;
  throw new AppError('INTERNAL', 'Print window is not open.');
}

/** Convert millimetres to inches (Electron printToPDF uses inches). */
export function mmToInches(mm: number): number {
  return Math.max(0, Number(((Number(mm) || 0) / 25.4).toFixed(4)));
}

/** Convert millimetres to 96-DPI CSS pixels for Electron webContents.print custom margins. */
export function marginsMmToPrintMargins(
  marginsMm?: { top: number; right: number; bottom: number; left: number },
): { marginType: 'custom'; top: number; right: number; bottom: number; left: number } {
  const m = marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
  const toPx = (mm: number) => Math.max(0, Math.round(((Number(mm) || 0) * 96) / 25.4));
  return {
    marginType: 'custom',
    top: toPx(m.top),
    right: toPx(m.right),
    bottom: toPx(m.bottom),
    left: toPx(m.left),
  };
}

export interface PrintExecuteOptions {
  printerName?: string | null;
  silent?: boolean;
  copies?: number;
  landscape?: boolean;
  color?: boolean;
  duplex?: 'simplex' | 'shortEdge' | 'longEdge';
  widthMm?: number;
  heightMm?: number;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  scale?: number;
}

export type PrintResult = { ok: true } | { ok: false; cancelled?: boolean; error: string };

export async function executePrint(opts: PrintExecuteOptions): Promise<PrintResult> {
  const wc = getPrintContents();
  try {
    const ok = await new Promise<boolean>((resolve, reject) => {
      wc.print(
        {
          silent: Boolean(opts.silent && opts.printerName),
          printBackground: true,
          deviceName: opts.printerName ?? '',
          copies: Math.max(1, Math.min(99, Number(opts.copies) || 1)),
          landscape: !!opts.landscape,
          color: opts.color !== false,
          duplexMode: opts.duplex,
          margins: marginsMmToPrintMargins(opts.marginsMm),
          pagesPerSheet: 1,
          scaleFactor: opts.scale ? Math.max(25, Math.min(200, Math.round(opts.scale))) : 100,
          ...(opts.widthMm && opts.heightMm
            ? { pageSize: {
                width: Math.max(353, Math.round(Number(opts.widthMm) * 1000)),
                height: Math.max(353, Math.round(Number(opts.heightMm) * 1000)),
              } }
            : {}),
        },
        (success, failureReason) => {
          if (success) resolve(true);
          else if (failureReason === 'cancelled' || failureReason === 'Print job canceled') resolve(false);
          else reject(new Error(failureReason || 'Print failed'));
        },
      );
    });
    if (!ok) return { ok: false, cancelled: true, error: 'Print job was cancelled.' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Print failed.' };
  }
}

export interface PdfOptions {
  suggestedName: string;
  widthMm: number;
  heightMm: number;
  landscape?: boolean;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  scale?: number;
}

export type PdfResult = { ok: true; path: string } | { ok: false; cancelled?: boolean; error: string };

export async function saveAsPdf(opts: PdfOptions): Promise<PdfResult> {
  const win = BrowserWindow.getFocusedWindow() ?? printWindow;
  if (!win || win.isDestroyed()) return { ok: false, error: 'Print window is not open.' };
  const save = await dialog.showSaveDialog(win, {
    title: 'Save as PDF',
    defaultPath: `${opts.suggestedName}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, cancelled: true, error: 'Save cancelled.' };

  try {
    // Electron printToPDF uses inches (1 inch = 25.4 mm) for pageSize and margins.
    const m = opts.marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
    const widthIn = Math.max(1.5, mmToInches(opts.widthMm || 210));
    const heightIn = Math.max(2.0, mmToInches(opts.heightMm || 297));
    const data = await win.webContents.printToPDF({
      pageSize: { width: widthIn, height: heightIn },
      landscape: Boolean(opts.landscape),
      scale: opts.scale ? Math.max(0.25, Math.min(2, opts.scale / 100)) : undefined,
      margins: {
        top: mmToInches(m.top),
        right: mmToInches(m.right),
        bottom: mmToInches(m.bottom),
        left: mmToInches(m.left),
      },
      printBackground: true,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(save.filePath, data);
    const stat = fs.statSync(save.filePath);
    if (stat.size <= 0) throw new Error('PDF file was not written.');
    return { ok: true, path: save.filePath };
  } catch (e: any) {
    try { if (fs.existsSync(save.filePath)) fs.rmSync(save.filePath, { force: true }); } catch { /* best effort */ }
    return { ok: false, error: e?.message ?? 'PDF generation failed.' };
  }
}

export interface PrinterInfo {
  name: string; displayName: string; description: string; options: Record<string, string>;
}

export async function listPrinters(from: WebContents): Promise<PrinterInfo[]> {
  try {
    // Electron ≥43: PrinterInfo exposes name/displayName/description/options —
    // status/isDefault were removed from the API (Chromium print backend change).
    const printers = await from.getPrintersAsync();
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: (p as { description?: string }).description ?? '',
      options: (p.options ?? {}) as Record<string, string>,
    }));
  } catch {
    return [];
  }
}

export function profilePageCss(profile: PrintProfile): string {
  const portrait = profile.orientation !== 'landscape';
  const w = profile.paperSize === 'a4' ? 210 : profile.paperSize === 'a5' ? 148 : profile.widthMm;
  const h = profile.paperSize === 'a4' ? 297 : profile.paperSize === 'a5' ? 210 : profile.heightMm;
  const width = portrait ? w : h;
  const height = portrait ? h : w;
  const m = profile.margins;
  return `@page { size: ${width}mm ${height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
}
