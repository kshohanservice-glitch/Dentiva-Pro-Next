import React, { useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, Modal, Pagination, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt, isoDate } from '../format';
import type { ExpenseDTO, IncomeDTO } from '../../shared/types';

function EntryModal(props: {
  kind: 'expense' | 'income';
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState({
    date: isoDate(new Date()), categoryId: '', amount: '', method: 'cash' as string, reference: '', note: '',
  });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const { data: categories } = useAsync(() => api['accounting/categories'](), [props.open]);
  const cats = (categories ?? []).filter((c) => c.kind === props.kind);

  React.useEffect(() => {
    if (props.open) {
      setValues({ date: isoDate(new Date()), categoryId: '', amount: '', method: 'cash', reference: '', note: '' });
      setErrors({});
    }
  }, [props.open]);

  if (!props.open) return null;

  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]): void => setValues((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const errs: { [k: string]: string } = {};
    if (!values.date) errs.date = 'Date required.';
    if (!values.categoryId) errs.categoryId = `Select a ${props.kind} category.`;
    const paisa = Math.round((Number(values.amount) || 0) * 100);
    if (paisa <= 0) errs.amount = 'Amount must be above zero.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    try {
      const input = {
        date: values.date,
        categoryId: Number(values.categoryId),
        amountPaisa: paisa,
        method: values.method,
        reference: values.reference || null,
        note: values.note || null,
      };
      if (props.kind === 'expense') await api['accounting/add-expense'](input);
      else await api['accounting/add-income'](input);
      toast.success(`${props.kind === 'expense' ? 'Expense' : 'Income'} recorded`, bdt(paisa));
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Save failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={props.kind === 'expense' ? 'Record expense' : 'Record other income'}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save entry</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Date" required error={errors.date}>
          {(id) => <Input id={id} type="date" value={values.date} onChange={(v) => set('date', v)} invalid={!!errors.date} />}
        </Field>
        <Field label="Category" required error={errors.categoryId}>
          {(id) => (
            <Select id={id} value={values.categoryId} onChange={(v) => set('categoryId', v)} placeholder="Select…" invalid={!!errors.categoryId}
              options={cats.map((c) => ({ value: String(c.id), label: c.name }))} />
          )}
        </Field>
        <Field label="Amount (৳)" required error={errors.amount}>
          {(id) => <Input id={id} type="number" min={0} step="0.01" value={values.amount} onChange={(v) => set('amount', v)} invalid={!!errors.amount} autoFocus />}
        </Field>
        <Field label="Method">
          {(id) => (
            <Select id={id} value={values.method} onChange={(v) => set('method', v)}
              options={['cash', 'bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'other'].map((m) => ({ value: m, label: m.toUpperCase() }))} />
          )}
        </Field>
        <Field label="Reference">
          {(id) => <Input id={id} value={values.reference} onChange={(v) => set('reference', v)} placeholder="voucher / TrxID" />}
        </Field>
        <Field label="Note" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.note} onChange={(v) => set('note', v)} />}
        </Field>
      </div>
      <p className="xsmall muted mt-4">Entries are immutable — corrections are made by adding a contra entry with a note.</p>
    </Modal>
  );
}

function CategoryModal(props: { open: boolean; kind: 'expense' | 'income'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useToast();
  React.useEffect(() => { if (props.open) setName(''); }, [props.open]);
  if (!props.open) return null;
  return (
    <Modal
      title={`New ${props.kind} category`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button
            variant="primary" loading={pending}
            onClick={async () => {
              if (name.trim().length < 2) { toast.warning('Category name required'); return; }
              setPending(true);
              try {
                await api['accounting/save-category']({ kind: props.kind, name: name.trim() });
                toast.success('Category saved', name);
                props.onSaved();
                props.onClose();
              } catch (err) {
                toast.fromError(err);
              } finally {
                setPending(false);
              }
            }}
          >Save</Button>
        </>
      }
    >
      <Field label="Category name" required>{(id) => <Input id={id} value={name} onChange={setName} autoFocus placeholder="e.g. Lab charges" />}</Field>
    </Modal>
  );
}

type AccTab = 'expenses' | 'income';

export function AccountingPage() {
  const { can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<AccTab>('expenses');
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(isoDate(new Date()));
  const [entryOpen, setEntryOpen] = useState<'expense' | 'income' | null>(null);
  const [catOpen, setCatOpen] = useState<'expense' | 'income' | null>(null);
  const [deleting, setDeleting] = useState<ExpenseDTO | null>(null);

  const filter = { from, to, page, pageSize: 25 };
  const expQ = useAsync(() => api['accounting/expenses'](filter), [from, to, page]);
  const incQ = useAsync(() => api['accounting/incomes'](filter), [from, to, page]);
  const { data: categories, reload: reloadCats } = useAsync(() => api['accounting/categories'](), []);
  const active = tab === 'expenses' ? expQ : incQ;

  const totals = React.useMemo(() => {
    const expTotal = (expQ.data?.items ?? []).reduce((s, e) => s + e.amountPaisa, 0);
    const incTotal = (incQ.data?.items ?? []).reduce((s, i) => s + i.amountPaisa, 0);
    return { expTotal, incTotal, net: incTotal - expTotal };
  }, [expQ.data, incQ.data]);

  const expenseColumns: Column<ExpenseDTO>[] = [
    { key: 'date', label: 'Date', sortValue: (e) => e.date, render: (e) => new Date(e.date).toLocaleDateString() },
    { key: 'category', label: 'Category', render: (e) => e.categoryName },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (e) => e.amountPaisa, render: (e) => <span className="num danger-text">{bdt(e.amountPaisa)}</span> },
    { key: 'method', label: 'Method', render: (e) => <Badge tone="neutral">{e.method}</Badge> },
    { key: 'reference', label: 'Reference', render: (e) => <span className="mono">{e.reference ?? '—'}</span> },
    { key: 'note', label: 'Note', clip: true, render: (e) => e.note ?? '—' },
    { key: 'by', label: 'Entered by', render: (e) => e.enteredByName },
    {
      key: 'actions', label: '', align: 'right',
      render: (e) => (can('accounting.manage') ? (
        <div className="row gap-2 end" onClick={(ev) => ev.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(e)}>Delete</Button>
        </div>
      ) : null),
    },
  ];

  const incomeColumns: Column<IncomeDTO>[] = [
    { key: 'date', label: 'Date', sortValue: (i) => i.date, render: (i) => new Date(i.date).toLocaleDateString() },
    { key: 'category', label: 'Category', render: (i) => i.categoryName },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (i) => i.amountPaisa, render: (i) => <span className="num success-text">{bdt(i.amountPaisa)}</span> },
    { key: 'method', label: 'Method', render: (i) => <Badge tone="neutral">{i.method}</Badge> },
    { key: 'reference', label: 'Reference', render: (i) => <span className="mono">{i.reference ?? '—'}</span> },
    { key: 'note', label: 'Note', clip: true, render: (i) => i.note ?? '—' },
    { key: 'by', label: 'Entered by', render: (i) => i.enteredByName },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Accounting</h1>
          <p className="page-subtitle">Expenses &amp; other income · separate from patient billing</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={() => { expQ.reload(); incQ.reload(); }}>Refresh</Button>
          {can('accounting.manage') && (
            <>
              <Button variant="secondary" onClick={() => setCatOpen(tab === 'expenses' ? 'expense' : 'income')}>New category</Button>
              <Button variant="primary" icon={Icon.plus} onClick={() => setEntryOpen(tab === 'expenses' ? 'expense' : 'income')}>
                {tab === 'expenses' ? 'Record expense' : 'Record income'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid stats-grid">
        <div className="stat-card"><div className="stat-label">Expenses (30d view)</div><div className="stat-value danger-text">{bdt(totals.expTotal)}</div></div>
        <div className="stat-card"><div className="stat-label">Other income</div><div className="stat-value success-text">{bdt(totals.incTotal)}</div></div>
        <div className="stat-card"><div className="stat-label">Net (this view)</div><div className="stat-value">{bdt(totals.net)}</div></div>
        <div className="stat-card"><div className="stat-label">Categories</div><div className="stat-value">{categories?.length ?? 0}</div></div>
      </div>

      <Tabs
        tabs={[
          { key: 'expenses' as const, label: 'Expenses', count: expQ.data?.total },
          { key: 'income' as const, label: 'Other income', count: incQ.data?.total },
        ]}
        active={tab}
        onChange={(t) => { setTab(t); setPage(1); }}
      />

      <div className="mt-4">
        <TableToolbar>
          <label className="row gap-2 small">
            From
            <input className="input" style={{ width: 150 }} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          </label>
          <label className="row gap-2 small">
            To
            <input className="input" style={{ width: 150 }} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </label>
        </TableToolbar>

        <Card pad={false}>
          <DataTable
            columns={tab === 'expenses' ? expenseColumns : incomeColumns}
            rows={(active.data?.items as any[]) ?? []}
            rowKey={(r: any) => r.id}
            loading={active.loading}
            error={active.error}
            onRetry={active.reload}
            empty={{
              title: 'No entries in this range',
              body: tab === 'expenses' ? 'Track operating costs like rent, salaries and lab fees.' : 'Non-patient income entries appear here.',
              action: can('accounting.manage') ? (
                <Button variant="primary" onClick={() => setEntryOpen(tab === 'expenses' ? 'expense' : 'income')}>
                  {tab === 'expenses' ? 'Record expense' : 'Record income'}
                </Button>
              ) : undefined,
            }}
            initialSort={{ key: 'date', dir: 'desc' }}
          />
          {active.data && <Pagination page={page} pageSize={active.data.pageSize} total={active.data.total} onPage={setPage} />}
        </Card>
      </div>

      <EntryModal kind={tab === 'expenses' ? 'expense' : 'income'} open={!!entryOpen} onClose={() => setEntryOpen(null)} onSaved={() => { expQ.reload(); incQ.reload(); }} />
      {catOpen && <CategoryModal open kind={catOpen} onClose={() => setCatOpen(null)} onSaved={reloadCats} />}

      {deleting && (
        <ConfirmDialog
          title="Delete expense entry?"
          body={
            <>
              <strong>{deleting.categoryName}</strong> · {bdt(deleting.amountPaisa)} · {new Date(deleting.date).toLocaleDateString()}.
              <br />This removes the entry entirely and is recorded in the audit log. Prefer adding a contra entry for reversals.
            </>
          }
          confirmLabel="Delete permanently"
          danger
          onConfirm={async () => {
            try {
              await api['accounting/delete-expense'](deleting.id);
              toast.success('Expense deleted');
              setDeleting(null);
              expQ.reload();
            } catch (err) {
              toast.fromError(err, 'Delete failed');
            }
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
