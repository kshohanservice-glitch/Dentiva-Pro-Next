import React, { useMemo, useState } from 'react';
import { Button, EmptyState, ErrorState, SkeletonList } from './primitives';

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  clip?: boolean;
  hideBelow?: number;
}

export function DataTable<T>(props: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: { title: string; body?: string; action?: React.ReactNode; icon?: React.ReactNode };
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  rowActions?: (row: T) => React.ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  stickyHeader?: boolean;
  maxHeight?: number | string;
  footer?: React.ReactNode;
}) {
  const [sort, setSort] = useState(props.initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return props.rows;
    const col = props.columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return props.rows;
    const sv = col.sortValue;
    const copy = [...props.rows];
    copy.sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [props.rows, sort, props.columns]);

  if (props.loading) return <SkeletonList rows={6} />;
  if (props.error) return <ErrorState error={props.error} onRetry={props.onRetry} />;
  if (props.rows.length === 0 && props.empty) {
    return <EmptyState icon={props.empty.icon} title={props.empty.title} body={props.empty.body} action={props.empty.action} />;
  }

  return (
    <>
      <div className="table-wrap" style={props.maxHeight ? { maxHeight: props.maxHeight } : undefined}>
        <table className="table">
          <thead style={props.stickyHeader === false ? { position: 'static' } : undefined}>
            <tr>
              {props.columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'align-right' : c.align === 'center' ? 'align-center' : ''} ${c.sortValue ? 'sortable' : ''}`}
                  style={{ width: c.width }}
                  onClick={() => {
                    if (!c.sortValue) return;
                    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }));
                  }}
                  scope="col"
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {props.rowActions && <th scope="col" style={{ width: 48 }} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={props.rowKey(row)}
                className={`${props.onRowClick ? 'clickable' : ''} ${props.rowClass?.(row) ?? ''}`}
                onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
                tabIndex={props.onRowClick ? 0 : undefined}
                onKeyDown={
                  props.onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') props.onRowClick!(row);
                      }
                    : undefined
                }
              >
                {props.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`${c.align === 'right' ? 'align-right' : c.align === 'center' ? 'align-center' : ''} ${c.clip ? 'cell-clip' : ''}`}
                    style={{ maxWidth: c.clip ? c.width ?? 260 : undefined }}
                  >
                    {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                  </td>
                ))}
                {props.rowActions && (
                  <td className="align-right" onClick={(e) => e.stopPropagation()}>
                    {props.rowActions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.footer}
    </>
  );
}

export function TableToolbar(props: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="table-toolbar">
      <div className="row wrap" style={{ flex: 1, gap: 'var(--sp-2)' }}>{props.children}</div>
      {props.right && <div className="row wrap">{props.right}</div>}
    </div>
  );
}

export function ExportButton(props: { onClick: () => void; pending?: boolean }) {
  return <Button variant="secondary" size="sm" loading={props.pending} onClick={props.onClick}>Export CSV</Button>;
}
