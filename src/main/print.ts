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

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface PrintGeometry {
  widthMm: number;
  heightMm: number;
  marginsMm: { top: number; right: number; bottom: number; left: number };
}

export function normalizePrintGeometry(opts: {
  widthMm?: number;
  heightMm?: number;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
}): PrintGeometry {
  const widthMm = clampNumber(opts.widthMm, 210, 10, 1000);
  const heightMm = clampNumber(opts.heightMm, 297, 10, 1500);
  const raw = opts.marginsMm ?? { top: 10, right: 10, bottom: 10, left: 10 };
  const maxHorizontal = Math.max(0, widthMm - 2);
  const maxVertical = Math.max(0, heightMm - 2);
  const left = clampNumber(raw.left, 10, 0, maxHorizontal);
  const right = clampNumber(raw.right, 10, 0, maxHorizontal - left);
  const top = clampNumber(raw.top, 10, 0, maxVertical);
  const bottom = clampNumber(raw.bottom, 10, 0, maxVertical - top);
  return { widthMm, heightMm, marginsMm: { top, right, bottom, left } };
}

/** Convert millimetres to inches (Electron printToPDF uses inches). */
export function mmToInches(mm: number): number {
  return Math.max(0, Number(((Number(mm) || 0) / 25.4).toFixed(4)));
}

/**
 * Kept for legacy callers. The Next print renderer owns document margins via
 * CSS @page so new callers should prefer marginType:none in native printing.
 */
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

async function waitForPrintReady(wc: WebContents): Promise<void> {
  await wc.executeJavaScript(`(async () => {
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const images = Array.from(document.images);
      await Promise.all(images.map(async (img) => {
        try {
          if (!img.complete) await new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          });
          if (typeof img.decode === 'function') await img.decode().catch(() => {});
        } catch {}
      }));
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    } catch {}
    return true;
  })()`, true);
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
  const geometry = normalizePrintGeometry(opts);
  try {
    await waitForPrintReady(wc);
    const physicalWidth = opts.landscape ? geometry.heightMm : geometry.widthMm;
    const physicalHeight = opts.landscape ? geometry.widthMm : geometry.heightMm;
    const ok = await new Promise<boolean>((resolve, reject) => {
      wc.print(
        {
          silent: Boolean(opts.silent && opts.printerName),
          printBackground: true,
          deviceName: opts.printerName ?? '',
          copies: Math.max(1, Math.min(99, Number(opts.copies) || 1)),
          landscape: false,
          color: opts.color !== false,
          duplexMode: opts.duplex,
          // Margins are rendered by the document's @page rule. Applying them
          // again here would shrink/shift the document a second time.
          margins: { marginType: 'none' },
          pagesPerSheet: 1,
          scaleFactor: opts.scale ? Math.max(25, Math.min(200, Math.round(opts.scale))) : 100,
          pageSize: {
            width: Math.max(353, Math.round(physicalWidth * 1000)),
            height: Math.max(353, Math.round(physicalHeight * 1000)),
          },
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
    const geometry = normalizePrintGeometry(opts);
    await waitForPrintReady(win.webContents);
    const physicalWidth = opts.landscape ? geometry.heightMm : geometry.widthMm;
    const physicalHeight = opts.landscape ? geometry.widthMm : geometry.heightMm;
    const data = await win.webContents.printToPDF({
      pageSize: { width: mmToInches(physicalWidth), height: mmToInches(physicalHeight) },
      // The renderer's @page rule is the single source of truth for margins.
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      scale: opts.scale ? Math.max(0.25, Math.min(2, opts.scale / 100)) : 1,
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: true,
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
