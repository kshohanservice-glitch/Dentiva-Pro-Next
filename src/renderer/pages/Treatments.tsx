import React, { useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, Spinner, useToast } from '../components/primitives';
import { Field, Input, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt } from '../format';
import type { TreatmentDTO } from '../../shared/types';

function TreatmentModal(props: {
  open: boolean;
  initial?: TreatmentDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const state = useForm();
  const { values: v, set: sv } = state;
  const [pending, setPending] = useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (!props.open) return;
    state.setMany({
      code: props.initial?.code ?? '',
      name: props.initial?.name ?? '',
      bengaliName: props.initial?.bengaliName ?? '',
      category: props.initial?.category ?? '',
      description: props.initial?.description ?? '',
      price: String(((props.initial?.defaultPricePaisa ?? 0) / 100)),
      durationMin: String(props.initial?.durationMin ?? ''),
      active: props.initial ? props.initial.active : true,
    });
    state.setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.initial?.id]);

  const submit = async () => {
    const ok = state.validate((form) => ({
      name: form.name.trim().length < 2 ? 'Treatment name is required.' : '',
      price: Number(form.price) < 0 ? 'Price cannot be negative.' : '',
      code: form.code && !/^[A-Za-z0-9_-]{1,20}$/.test(form.code) ? 'Code: letters, numbers, dash, underscore.' : '',
    }));
    if (!ok) return;
    setPending(true);
    try {
      await api['treatments/save']({
        id: props.initial?.id,
        code: v.code || undefined,
        name: v.name.trim(),
        bengaliName: v.bengaliName || null,
        category: v.category || null,
        description: v.description || null,
        defaultPricePaisa: Math.round((Number(v.price) || 0) * 100),
        durationMin: v.durationMin ? Number(v.durationMin) : null,
        active: v.active,
      });
      toast.success(props.initial ? 'Treatment updated' : 'Treatment created', v.name);
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Save failed');
    } finally {
      setPending(false);
    }
  };

  if (!props.open) return null;
  return (
    <Modal
      title={props.initial ? `Edit treatment — ${props.initial.name}` : 'New treatment'}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required error={state.errors.name} className="span-2">
          {(id) => <Input id={id} value={v.name} onChange={(x) => sv('name', x)} invalid={!!state.errors.name} placeholder="e.g. Composite filling" />}
        </Field>
        <Field label="Code">
          {(id) => <Input id={id} value={v.code} onChange={(x) => sv('code', x)} placeholder="auto if blank" />}
        </Field>
        <Field label="নাম (Bengali)">
          {(id) => <Input id={id} value={v.bengaliName} onChange={(x) => sv('bengaliName', x)} />}
        </Field>
        <Field label="Category">
          {(id) => <Input id={id} value={v.category} onChange={(x) => sv('category', x)} placeholder="e.g. Restorative" />}
        </Field>
        <Field label="Default price (৳)" error={state.errors.price}>
          {(id) => <Input id={id} type="number" min={0} step="0.01" value={v.price} onChange={(x) => sv('price', x)} invalid={!!state.errors.price} />}
        </Field>
        <Field label="Duration (minutes)">
          {(id) => <Input id={id} type="number" min={0} value={v.durationMin} onChange={(x) => sv('durationMin', x)} />}
        </Field>
        <Field label="Description" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={v.description} onChange={(x) => sv('description', x)} />}
        </Field>
        <Field label="Status">
          {(id) => (
            <label className="checkbox">
              <input id={id} type="checkbox" checked={v.active} onChange={(e) => sv('active', e.target.checked)} />
              <span>Active (available for visits & invoices)</span>
            </label>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function useForm() {
  const [values, setValues] = useState({
    code: '', name: '', bengaliName: '', category: '', description: '', price: '0', durationMin: '', active: true,
  });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]): void => {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const setMany = (patch: Partial<typeof values>): void => setValues((p) => ({ ...p, ...patch }));
  const validate = (fn: (v: typeof values) => { [k: string]: string }): boolean => {
    const errs: { [k: string]: string } = {};
    for (const [k, val] of Object.entries(fn(values))) if (val) errs[k] = val;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
  return { values, set, setMany, errors, setErrors, validate };
}

export function TreatmentsPage() {
  const { can } = useApp();
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TreatmentDTO | null>(null);
  const [deleting, setDeleting] = useState<TreatmentDTO | null>(null);
  const toast = useToast();

  const { data, loading, error, reload } = useAsync(() => api['treatments/list'](showInactive), [showInactive]);
  const rows = (data ?? []).filter((t) =>
    !query || t.name.toLowerCase().includes(query.toLowerCase()) ||
    (t.code ?? '').toLowerCase().includes(query.toLowerCase()) ||
    (t.category ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  const toggleActive = async (t: TreatmentDTO) => {
    try {
      await api['treatments/set-active']({ id: t.id, active: !t.active });
      toast.success(t.active ? 'Treatment deactivated' : 'Treatment activated', t.name);
      reload();
    } catch (err) {
      toast.fromError(err, 'Update failed');
    }
  };

  const columns: Column<TreatmentDTO>[] = [
    { key: 'code', label: 'Code', render: (t) => <span className="mono">{t.code}</span> },
    {
      key: 'name', label: 'Treatment', sortValue: (t) => t.name,
      render: (t) => (
        <div>
          <strong>{t.name}</strong>
          {t.bengaliName && <div className="xsmall muted">{t.bengaliName}</div>}
          {t.description && <div className="xsmall muted truncate" style={{ maxWidth: 420 }}>{t.description}</div>}
        </div>
      ),
    },
    { key: 'category', label: 'Category', render: (t) => t.category ?? <span className="muted">—</span> },
    { key: 'price', label: 'Default price', align: 'right', sortValue: (t) => t.defaultPricePaisa, render: (t) => <span className="num">{bdt(t.defaultPricePaisa)}</span> },
    { key: 'duration', label: 'Duration', align: 'right', render: (t) => (t.durationMin ? `${t.durationMin} min` : '—') },
    { key: 'active', label: 'Status', render: (t) => <Badge tone={t.active ? 'success' : 'neutral'}>{t.active ? 'active' : 'inactive'}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (t) =>
        can('treatments.manage') ? (
          <div className="row gap-2 end">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(t); setModalOpen(true); }}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => void toggleActive(t)}>{t.active ? 'Deactivate' : 'Activate'}</Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Treatment catalog</h1>
          <p className="page-subtitle">{data?.length ?? 0} treatments · prices feed invoices and reports</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('treatments.manage') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => { setEditing(null); setModalOpen(true); }}>New treatment</Button>
          )}
        </div>
      </div>

      <TableToolbar
        right={
          <label className="checkbox">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span>Show inactive</span>
          </label>
        }
      >
        <div style={{ minWidth: 260, flex: '1 1 260px' }}>
          <Input value={query} onChange={setQuery} placeholder="Search name, code or category…" />
        </div>
      </TableToolbar>

      <Card pad={false}>
        {loading && !data ? (
          <Spinner label="Loading treatments…" />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={query ? `No treatments match “${query}”` : 'No treatments yet'}
            body={query ? 'Clear the search or add this treatment to the catalog.' : 'Build the catalog your clinic bills against.'}
            action={can('treatments.manage') ? <Button variant="primary" onClick={() => setModalOpen(true)}>New treatment</Button> : undefined}
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(t) => t.id} initialSort={{ key: 'name', dir: 'asc' }} />
        )}
      </Card>

      <TreatmentModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSaved={reload}
      />

      {deleting && (
        <ConfirmDialog
          title="Deactivate treatment?"
          body={`${deleting.name} will no longer appear when building invoices. Existing invoices are unaffected.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={async () => {
            try {
              await api['treatments/set-active']({ id: deleting.id, active: false });
              setDeleting(null);
              reload();
            } catch (err) {
              toast.fromError(err);
            }
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
