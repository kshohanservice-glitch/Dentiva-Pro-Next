import { useMemo, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ErrorState, Spinner, useToast } from '../components/primitives';
import { DataTable, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt, isoDate } from '../format';
import type { ReportResult } from '../../shared/types';

import { REPORT_DEFS, type ReportDef } from '../../shared/reports';

export function ReportsPage() {
  const { can } = useApp();
  const toast = useToast();
  const [selected, setSelected] = useState<ReportDef>(REPORT_DEFS[0]);
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  const visible = useMemo(() => REPORT_DEFS.filter((r) => can(r.permission) || can('finance.view')), [can]);

  const params = (): Record<string, any> => {
    const p: Record<string, any> = {};
    if (selected.needsRange) { p.from = from; p.to = to; }
    return p;
  };

  const run = async (def: ReportDef = selected) => {
    setRunning(true);
    setError(null);
    try {
      const res = await api['reports/run']({ name: def.name, params: params() });
      setResult(res);
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api['reports/export']({ name: selected.name, params: params() });
      if ('cancelled' in res) return;
      toast.success('Export complete', `${res.rows} rows → ${res.path}`);
    } catch (err) {
      toast.fromError(err, 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const printReport = async (mode: 'print' | 'pdf') => {
    try {
      const reportParams: Record<string, string> = {};
      if (selected.needsRange) {
        reportParams.from = from;
        reportParams.to = to;
      }
      const res = await api[mode === 'print' ? 'reports/print' : 'reports/save-pdf']({
        type: 'report',
        id: 0,
        reportName: selected.name,
        params: reportParams,
      });
      if (res.ok) toast.success(mode === 'print' ? 'Print preview opened' : 'PDF window ready', 'Confirm inside the preview window.');
    } catch (err) {
      toast.fromError(err, 'Preview failed');
    }
  };

  const columns: Column<Record<string, string | number>>[] = (result?.columns ?? []).map((c) => ({
    key: c.key,
    label: c.label,
    align: c.align,
    sortValue: (row) => row[c.key],
  }));

  const groups = ['Finance', 'Clinical', 'Operations', 'Inventory'] as const;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Generated from local data · export CSV or print on clinic letterhead</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()} disabled={!result}>Export CSV</Button>
          <Button variant="secondary" onClick={() => void printReport('pdf')} disabled={!result}>Save PDF</Button>
          <Button variant="primary" icon={Icon.print} onClick={() => void printReport('print')} disabled={!result}>Print</Button>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '280px 1fr', alignItems: 'start' }}>
        <Card title="Report library">
          <div className="col" style={{ gap: 14 }}>
            {groups.map((g) => {
              const items = visible.filter((r) => r.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g}>
                  <div className="xsmall muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{g}</div>
                  <div className="col" style={{ gap: 4 }}>
                    {items.map((r) => (
                      <button
                        key={r.name}
                        type="button"
                        className={`btn btn-sm ${selected.name === r.name ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                        onClick={() => { setSelected(r); setResult(null); setError(null); }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="col gap-4">
          <Card>
            <div className="report-head">
              <div>
                <h3 style={{ margin: 0 }}>{selected.label}</h3>
                <div className="xsmall muted mono">{selected.name}</div>
              </div>
              <div className="row gap-2 wrap">
                {selected.needsRange && (
                  <>
                    <label className="row gap-2 xsmall">From
                      <input className="input" style={{ width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </label>
                    <label className="row gap-2 xsmall">To
                      <input className="input" style={{ width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                    </label>
                  </>
                )}
                <Button variant="primary" loading={running} onClick={() => void run()}>Run report</Button>
              </div>
            </div>

            {error != null && <ErrorState error={error} onRetry={() => void run()} />}
            {running && <Spinner label="Generating report…" />}
            {!running && error == null && !result && (
              <div className="empty-state">
                <div className="glyph">▦</div>
                <h4>Select a report and press Run</h4>
                <p>Results stay on this computer. Use CSV export for spreadsheets or print for meetings.</p>
              </div>
            )}

            {result && !running && (
              <>
                <div className="report-head">
                  <div>
                    <strong>{result.title}</strong>
                    <div className="xsmall muted">{result.scope} · generated {new Date(result.generatedAt).toLocaleString()}</div>
                  </div>
                  <Badge tone="brand">{result.rows.length} rows</Badge>
                </div>
                <DataTable
                  columns={columns}
                  rows={result.rows.map((r, i) => ({ ...r, __k: i }))}
                  rowKey={(r) => (r as any).__k}
                />
                {result.totals && (
                  <div className="report-totals">
                    <div className="report-total">
                      <span>Total</span>
                      <span>
                        {Object.entries(result.totals).map(([k, v]) => (
                          <span key={k} style={{ marginLeft: 16 }}>
                            {k}: <strong>{typeof v === 'number' && k.includes('paisa') ? bdt(v) : String(v)}</strong>
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
