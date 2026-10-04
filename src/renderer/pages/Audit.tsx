import { useState } from 'react';
import { api, useAsync } from '../api';
import { Badge, Button, Card, Pagination, Spinner, ErrorState, useToast } from '../components/primitives';
import { Input, Select } from '../components/forms';
import { TableToolbar } from '../components/table';
import { Icon } from '../components/shell';
import { isoDate } from '../format';
import type { AuditEntry } from '../../shared/types';

export function AuditPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filter = {
    page,
    pageSize: 50,
    action: action || undefined,
    query: query || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const { data, loading, error, reload } = useAsync(() => api['audit/list'](filter), [JSON.stringify(filter)]);

  const exportLog = async () => {
    try {
      const res = await api['reports/export']({ name: 'audit_log', params: filter as any });
      if ('cancelled' in res) return;
      toast.success('Audit exported', `${res.rows} rows → ${res.path}`);
    } catch (err) {
      toast.fromError(err, 'Export failed');
    }
  };

  const toneFor = (r: AuditEntry) => (r.result === 'success' ? 'success' : r.result === 'denied' ? 'warning' : 'danger');

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p className="page-subtitle">
            Append-only record of every significant action · database triggers reject UPDATE &amp; DELETE
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={() => void exportLog()}>Export CSV</Button>
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
        </div>
      </div>

      <div className="alert alert-info mb-4">
        <strong>Tamper-proof by design.</strong>
        <span>The audit table is insert-only at the SQLite trigger level; even a full-privilege app bug cannot erase history.</span>
      </div>

      <TableToolbar
        right={
          <Button
            variant="ghost" size="sm"
            onClick={() => { setAction(''); setQuery(''); setFrom(''); setTo(''); setPage(1); }}
          >Clear filters</Button>
        }
      >
        <div style={{ minWidth: 240, flex: '1 1 240px' }}>
          <Input value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="Search summary, entity, user…" />
        </div>
        <Select
          value={action}
          onChange={(v) => { setAction(v); setPage(1); }}
          placeholder="All actions"
          options={[
            { value: 'patient.', label: 'Patient actions' },
            { value: 'visit.', label: 'Visits' },
            { value: 'billing.', label: 'Billing' },
            { value: 'payment.', label: 'Payments' },
            { value: 'auth.', label: 'Authentication' },
            { value: 'backup.', label: 'Backup & restore' },
            { value: 'settings.', label: 'Settings' },
            { value: 'inventory.', label: 'Inventory' },
            { value: 'accounting.', label: 'Accounting' },
            { value: 'user.', label: 'User administration' },
          ]}
        />
        <input className="input" style={{ width: 150 }} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From" />
        <input className="input" style={{ width: 150 }} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To" />
      </TableToolbar>

      <Card pad={false}>
        {loading && !data ? (
          <Spinner label="Loading audit log…" />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : (data?.items.length ?? 0) === 0 ? (
          <div className="empty-state">
            <div className="glyph">☑</div>
            <h4>No audit entries match</h4>
            <p>Every login, record change, export and permission denial lands here automatically.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap" style={{ maxHeight: '62vh' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 168 }}>When</th>
                    <th style={{ width: 130 }}>User</th>
                    <th style={{ width: 170 }}>Action</th>
                    <th>Summary</th>
                    <th style={{ width: 96 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.items.map((e) => (
                    <tr key={e.id}>
                      <td className="xsmall">{new Date(e.at).toLocaleString()}</td>
                      <td className="small">{e.username ?? <span className="muted">system</span>}</td>
                      <td className="mono xsmall">{e.action}</td>
                      <td className="small">
                        {e.summary}
                        {e.entityType && (
                          <span className="xsmall muted"> · {e.entityType}{e.entityId ? `#${e.entityId}` : ''}</span>
                        )}
                        {e.reason && <div className="xsmall danger-text">{e.reason}</div>}
                      </td>
                      <td><Badge tone={toneFor(e)}>{e.result}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data!.pageSize} total={data!.total} onPage={setPage} />
          </>
        )}
      </Card>

      <p className="xsmall muted mt-4">
        Rows shown: {data?.total ?? 0} · retention follows your backup policy; audit rows are included in every backup.
        Current date context: {isoDate(new Date())}.
      </p>
    </div>
  );
}
