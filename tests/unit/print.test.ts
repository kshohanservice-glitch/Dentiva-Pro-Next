/**
 * Phase B — print pipeline unit tests (CSS page geometry).
 * Electron is mocked: only pure helpers are exercised here; the window/print
 * paths are covered by the packaged E2E (print window opens with content).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  dialog: {},
  app: { getAppPath: () => '/app' },
}));

import { buildPrintHash, marginsMmToPrintMargins, mmToInches, profilePageCss } from '../../src/main/print';
import type { PrintProfile } from '../../src/shared/types';

function profile(patch: Partial<PrintProfile>): PrintProfile {
  return {
    id: 'p', name: 'Test', documentType: 'prescription', printerName: '',
    paperSize: 'a4', widthMm: 80, heightMm: 200, orientation: 'portrait',
    margins: { top: 10, right: 8, bottom: 10, left: 8 }, scale: 100, copies: 1,
    ...patch,
  };
}

describe('profilePageCss (@page geometry)', () => {
  it('A4 portrait → 210×297 mm with profile margins', () => {
    const css = profilePageCss(profile({ paperSize: 'a4' }));
    expect(css).toContain('size: 210mm 297mm');
    expect(css).toContain('margin: 10mm 8mm 10mm 8mm');
  });

  it('A4 landscape swaps to 297×210 mm', () => {
    const css = profilePageCss(profile({ paperSize: 'a4', orientation: 'landscape' }));
    expect(css).toContain('size: 297mm 210mm');
  });

  it('A5 portrait → 148×210 mm; landscape swaps', () => {
    expect(profilePageCss(profile({ paperSize: 'a5' }))).toContain('size: 148mm 210mm');
    expect(profilePageCss(profile({ paperSize: 'a5', orientation: 'landscape' }))).toContain('size: 210mm 148mm');
  });

  it('thermal/custom uses explicit width/height (80mm roll)', () => {
    const css = profilePageCss(profile({ paperSize: 'thermal', widthMm: 80, heightMm: 200 }));
    expect(css).toContain('size: 80mm 200mm');
  });

  it('custom margins flow through verbatim', () => {
    const css = profilePageCss(profile({
      paperSize: 'custom', widthMm: 100, heightMm: 150,
      margins: { top: 5, right: 5, bottom: 5, left: 5 },
    }));
    expect(css).toContain('size: 100mm 150mm');
    expect(css).toContain('margin: 5mm 5mm 5mm 5mm');
  });

  it('converts mm to inches for Electron printToPDF (ISS-036)', () => {
    // 25.4mm === 1 inch; A4 210x297mm === ~8.2677x11.6929 inches
    expect(mmToInches(25.4)).toBeCloseTo(1, 5);
    expect(mmToInches(210)).toBeCloseTo(8.2677, 3);
    expect(mmToInches(297)).toBeCloseTo(11.6929, 3);
  });

  it('converts custom margins in mm to 96-DPI pixels for Electron print (ISS-036)', () => {
    const m = marginsMmToPrintMargins({ top: 12.7, right: 25.4, bottom: 12.7, left: 25.4 });
    expect(m).toEqual({
      marginType: 'custom',
      top: 48,
      right: 96,
      bottom: 48,
      left: 96,
    });
  });

  it('builds print window hash with report name, profile, and date range params (ISS-011)', () => {
    const hash = buildPrintHash({
      type: 'report',
      id: 0,
      reportName: 'daily_collection',
      profileId: 'inv-a4',
      params: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(hash).toBe('#print/report/0?report=daily_collection&profile=inv-a4&from=2026-09-01&to=2026-09-30');
  });
});
