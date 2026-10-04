import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, ConfirmDialog, Modal, Pagination, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt, formatDate } from '../format';
import { InvoiceFormModal } from './Patients';
import type { InvoiceDTO, PaymentDTO } from '../../shared/types';

const STATUS_TONE = {
  paid: 'success', partial: 'warning', unpaid: 'info', voided: 'danger', draft: 'neutral',
} as const;

function PaymentModal(props: { invoice: InvoiceDTO; onClose: () => void; onPaid: (invoice: InvoiceDTO) => void }) {
  const { values, set, errors, validate } = usePaymentForm();
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const due = props.invoice.duePaisa;

  React.useEffect(() => {
    set('amountPaisa', due);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.invoice.id]);

  const submit = async () => {
    const ok = validate((v) => ({
      amountPaisa: v.amountPaisa <= 0 ? 'Enter the amount received.' : v.amountPaisa > due ? `Amount exceeds due (${bdt(due)}).` : '',
      method: !v.method ? 'Select a payment method.' : '',
    }));
    if (!ok) return;
    setPending(true);
    try {
      const res = await api['payments/create']({
        invoiceId: props.invoice.id,
        patientId: props.invoice.patientId,
        amountPaisa: values.amountPaisa,
        method: values.method as PaymentDTO['method'],
        reference: values.reference || null,
        note: values.note || null,
      });
      toast.success('Payment recorded', `${bdt(res.payment.amountPaisa)} · balance ${bdt(res.invoice?.duePaisa ?? 0)}`);
      props.onPaid(res.invoice ?? props.invoice);
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Payment failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`Receive payment — ${props.invoice.number}`}
      onClose={props.onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>Due: <strong className="num">{bdt(due)}</strong></span>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Record payment</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Amount (৳)" required error={errors.amountPaisa}>
          {(id) => (
            <Input
              id={id} type="number" min={0} step="0.01" autoFocus
              value={String(values.amountPaisa / 100)}
              onChange={(v) => set('amountPaisa', Math.max(0, Math.round((Number(v) || 0) * 100)))}
              invalid={!!errors.amountPaisa}
            />
          )}
        </Field>
        <Field label="Quick amount">
          {() => (
            <div className="row gap-2">
              <Button size="sm" variant="secondary" onClick={() => set('amountPaisa', due)}>Full {bdt(due)}</Button>
              <Button size="sm" variant="ghost" onClick={() => set('amountPaisa', Math.round(due / 2))}>Half</Button>
            </div>
          )}
        </Field>
        <Field label="Method" required error={errors.method}>
          {(id) => (
            <Select
              id={id}
              value={values.method}
              onChange={(v) => set('method', v)}
              placeholder="Select method…"
              options={['cash', 'bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'other'].map((m) => ({ value: m, label: m.toUpperCase() }))}
            />
          )}
        </Field>
        <Field label="Reference" hint="TrxID / cheque no. (optional)">
          {(id) => <Input id={id} value={values.reference} onChange={(v) => set('reference', v)} />}
        </Field>
        <Field label="Note" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={values.note} onChange={(v) => set('note', v)} />}
        </Field>
      </div>
      <p className="xsmall muted mt-4">Payments are append-only. Corrections are made with refund entries — history is never edited.</p>
    </Modal>
  );
}

function usePaymentForm() {
  const [values, setValues] = useState({ amountPaisa: 0, method: '', reference: '', note: '' });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]): void => {
    setValues((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const validate = (fn: (v: typeof values) => { [k: string]: string }): boolean => {
    const errs: { [k: string]: string } = {};
    for (const [k, val] of Object.entries(fn(values))) if (val) errs[k] = val;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
  return { values, set, errors, validate };
}

function InvoiceDetailModal(props: { invoice: InvoiceDTO; onClose: () => void; onChanged: () => void }) {
  // Local copy so payments/voids immediately reflect in this open modal.
  const [invoice, setInvoice] = useState(props.invoice);
  const { can } = useApp();
  const toast = useToast();
  const [payOpen, setPayOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [removeAttachmentId, setRemoveAttachmentId] = useState<number | null>(null);
  const { data: pays, reload: reloadPays } = useAsync(() => api['payments/list']({ invoiceId: invoice.id, pageSize: 200 }), [invoice.id]);
  const { data: attachments, reload: reloadAtt } = useAsync(() => api['attachments/list']({ entityType: 'invoice', entityId: invoice.id }), [invoice.id]);

  const doPrint = async (kind: 'invoice' | 'receipt') => {
    try {
      await api['reports/print']({ type: kind, id: invoice.id });
    } catch (err) {
      toast.fromError(err, 'Print preview failed');
    }
  };

  const doPdf = async () => {
    try {
      const res = await api['reports/save-pdf']({ type: 'invoice', id: invoice.id });
      if (res.ok) toast.success('PDF window ready', 'Use “Save PDF” in the preview window.');
    } catch (err) {
      toast.fromError(err, 'PDF failed');
    }
  };

  const addAttachment = async () => {
    try {
      const res = await api['attachments/add']({ entityType: 'invoice', entityId: invoice.id });
      if ('cancelled' in res) return;
      reloadAtt();
    } catch (err) {
      toast.fromError(err);
    }
  };

  return (
    <Modal
      title={`Invoice ${invoice.number}`}
      onClose={props.onClose}
      width="wide"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Close</Button>
          {can('data.delete') && <Button variant="ghost" onClick={() => setDeleteOpen(true)}>Delete</Button>}
          <Button variant="secondary" onClick={() => void doPdf()}>Save as PDF</Button>
          <Button variant="secondary" onClick={() => void doPrint('receipt')} disabled={(pays?.items.length ?? 0) === 0}>Print receipt</Button>
          <Button variant="primary" icon={Icon.print} onClick={() => void doPrint('invoice')}>Print invoice</Button>
        </>
      }
    >
      <div className="kv-list mb-4">
        <div className="kv"><span className="k">Patient</span><span className="v">{invoice.patientName} ({invoice.patientCode})</span></div>
        <div className="kv"><span className="k">Date</span><span className="v">{formatDate(invoice.date)}</span></div>
        <div className="kv"><span className="k">Status</span><span className="v"><Badge tone={STATUS_TONE[invoice.status]}>{invoice.status}</Badge></span></div>
        {invoice.voidReason && <div className="kv"><span className="k">Void reason</span><span className="v">{invoice.voidReason}</span></div>}
      </div>

      <table className="table compact">
        <thead>
          <tr><th>Description</th><th className="align-right">Qty</th><th className="align-right">Unit</th><th className="align-right">Total</th></tr>
        </thead>
        <tbody>
          {invoice.items.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="align-right num">{l.qty}</td>
              <td className="align-right num">{bdt(l.unitPricePaisa)}</td>
              <td className="align-right num">{bdt(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={3} className="align-right muted">Subtotal</td><td className="align-right num">{bdt(invoice.subtotalPaisa)}</td></tr>
          {invoice.discountPaisa > 0 && <tr><td colSpan={3} className="align-right muted">Discount</td><td className="align-right num">−{bdt(invoice.discountPaisa)}</td></tr>}
          <tr><td colSpan={3} className="align-right muted"><strong>Total</strong></td><td className="align-right num"><strong>{bdt(invoice.totalPaisa)}</strong></td></tr>
          <tr><td colSpan={3} className="align-right muted">Paid</td><td className="align-right num">{bdt(invoice.paidPaisa)}</td></tr>
          <tr><td colSpan={3} className="align-right muted"><strong>Due</strong></td><td className="align-right num danger-text"><strong>{bdt(invoice.duePaisa)}</strong></td></tr>
        </tfoot>
      </table>

      <div className="row gap-2 wrap mt-4">
        {can('billing.payment.create') && invoice.status !== 'paid' && invoice.status !== 'voided' && (
          <Button variant="primary" onClick={() => setPayOpen(true)}>Receive payment</Button>
        )}
        {can('billing.invoice.void') && invoice.status !== 'voided' && invoice.status !== 'paid' && (
          <Button variant="danger" onClick={() => setVoidOpen(true)}>Void invoice</Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => void addAttachment()}>Attach file</Button>
      </div>

      <div className="divider" />
      <h4 className="small" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)' }}>Payment history</h4>
      {(pays?.items.length ?? 0) === 0 ? (
        <p className="small muted">No payments recorded yet.</p>
      ) : (
        <div className="list">
          {pays!.items.map((p) => (
            <div className="list-row" key={p.id}>
              <span className="flex-1">
                <strong className="num">{bdt(p.amountPaisa)}</strong> <Badge tone={p.type === 'refund' ? 'danger' : 'neutral'}>{p.type}</Badge>
                <div className="xsmall muted">{new Date(p.paidAt).toLocaleString()} · {p.method} {p.reference ? `· ${p.reference}` : ''} · by {p.receivedByName}</div>
              </span>
            </div>
          ))}
        </div>
      )}

      {(attachments ?? []).length > 0 && (
        <>
          <div className="divider" />
          <div className="list">
            {attachments!.map((a) => (
              <div className="list-row" key={a.id}>
                <span className="flex-1 small">{a.originalName}</span>
                <Button size="sm" variant="ghost" onClick={() => void api['attachments/open'](a.id).catch(() => undefined)}>Open</Button>
                <Button size="sm" variant="ghost" onClick={() => void api['attachments/export'](a.id).catch((err) => toast.fromError(err, 'Could not save attachment'))}>Save a copy</Button>
                {can('billing.invoice.edit') && (
                  <Button size="sm" variant="ghost" onClick={() => setRemoveAttachmentId(a.id)}>Remove</Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {deleteOpen && (
        <ConfirmDialog
          title="Delete invoice?"
          body={`Invoice ${invoice.number} will be hidden from invoice records. Invoices with payment history cannot be deleted.`}
          confirmLabel="Delete invoice"
          danger
          onCancel={() => setDeleteOpen(false)}
          onConfirm={async () => {
            try {
              await api['invoices/delete'](invoice.id);
              toast.success('Invoice deleted', invoice.number);
              setDeleteOpen(false);
              props.onChanged();
              props.onClose();
            } catch (err) {
              toast.fromError(err, 'Could not delete invoice');
            }
          }}
        />
      )}

      {removeAttachmentId != null && <ConfirmDialog
        title="Remove attachment?"
        body="The attachment will be removed from this invoice record and its stored file will be deleted when possible."
        confirmLabel="Remove attachment"
        danger
        onCancel={() => setRemoveAttachmentId(null)}
        onConfirm={() => {
          const attachmentId = removeAttachmentId;
          setRemoveAttachmentId(null);
          if (attachmentId == null) return;
          void api['attachments/remove'](attachmentId)
            .then(() => { toast.success('Attachment removed'); reloadAtt(); })
            .catch((err) => toast.fromError(err, 'Could not remove attachment'));
        }}
      />}

      {payOpen && <PaymentModal invoice={invoice} onClose={() => setPayOpen(false)} onPaid={(fresh) => { setInvoice(fresh); props.onChanged(); reloadAtt(); reloadPays(); }} />}

      {voidOpen && (
        <Modal
          title="Void invoice"
          onClose={() => setVoidOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={voidReason.trim().length < 5}
                onClick={async () => {
                  try {
                    const fresh = await api['invoices/void']({ id: invoice.id, reason: voidReason.trim() });
                    setInvoice(fresh);
                    toast.success('Invoice voided', invoice.number);
                    setVoidOpen(false);
                    props.onChanged();
                    props.onClose();
                  } catch (err) {
                    toast.fromError(err, 'Void failed');
                  }
                }}
              >
                Void invoice
              </Button>
            </>
          }
        >
          <p className="small">Voiding keeps the invoice and its history but excludes it from totals. A reason is required and is recorded in the audit log.</p>
          <Field label="Reason" required>
            {(id) => <Textarea id={id} rows={3} value={voidReason} onChange={setVoidReason} placeholder="e.g. issued for the wrong patient" />}
          </Field>
        </Modal>
      )}
    </Modal>
  );
}

export function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useApp();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(params.get('new') === '1');
  const [detail, setDetail] = useState<InvoiceDTO | null>(null);

  const filter = { status: status || undefined, range: range === 'all' ? undefined : range, page, pageSize: 25 };
  const { data, loading, error, reload } = useAsync(() => api['invoices/list'](filter), [status, range, page]);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
    const invId = params.get('invoice');
    if (invId) {
      void api['invoices/get'](Number(invId)).then(setDetail).catch(() => undefined);
      params.delete('invoice');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = (data?.items ?? []).filter((inv) =>
    !query || inv.number.toLowerCase().includes(query.toLowerCase()) || inv.patientName.toLowerCase().includes(query.toLowerCase()),
  );

  const columns: Column<InvoiceDTO>[] = [
    { key: 'number', label: 'Invoice', render: (inv) => <span className="mono strong">{inv.number}</span> },
    { key: 'date', label: 'Date', sortValue: (inv) => inv.date, render: (inv) => formatDate(inv.date) },
    { key: 'patient', label: 'Patient', render: (inv) => (<div><strong>{inv.patientName}</strong><div className="xsmall muted mono">{inv.patientCode}</div></div>) },
    { key: 'total', label: 'Total', align: 'right', sortValue: (inv) => inv.totalPaisa, render: (inv) => <span className="num">{bdt(inv.totalPaisa)}</span> },
    { key: 'paid', label: 'Paid', align: 'right', render: (inv) => <span className="num success-text">{bdt(inv.paidPaisa)}</span> },
    { key: 'due', label: 'Due', align: 'right', sortValue: (inv) => inv.duePaisa, render: (inv) => <span className={`num ${inv.duePaisa > 0 ? 'danger-text strong' : 'muted'}`}>{bdt(inv.duePaisa)}</span> },
    { key: 'status', label: 'Status', render: (inv) => <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (inv) => (
        <div className="row gap-2 end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setDetail(inv)}>Open</Button>
          {can('billing.invoice.view') && (
            <Button size="sm" variant="ghost" onClick={() => void api['reports/print']({ type: 'invoice', id: inv.id }).catch((err) => toast.fromError(err))}>Print</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{data?.total ?? 0} invoices · immutable history with void &amp; audit trail</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
          {can('billing.invoice.create') && (
            <Button variant="primary" icon={Icon.plus} onClick={() => setCreateOpen(true)}>New invoice</Button>
          )}
        </div>
      </div>

      <TableToolbar>
        <div style={{ minWidth: 240, flex: '1 1 240px' }}>
          <Input value={query} onChange={setQuery} placeholder="Search invoice number or patient…" />
        </div>
        <Select
          value={range}
          onChange={(v) => { setRange(v); setPage(1); }}
          options={[
            { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
            { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '365', label: 'Last year' },
          ]}
        />
        <Select
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          placeholder="Any status"
          options={[
            { value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partial' },
            { value: 'paid', label: 'Paid' }, { value: 'voided', label: 'Voided' }, { value: 'draft', label: 'Draft' },
          ]}
        />
      </TableToolbar>

      <Card pad={false}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(inv) => inv.id}
          loading={loading}
          error={error}
          onRetry={reload}
          onRowClick={(inv) => setDetail(inv)}
          empty={{
            title: query ? 'No matching invoices' : 'No invoices yet',
            body: query ? 'Try another invoice number or patient name.' : 'Create an invoice for a patient visit.',
            action: can('billing.invoice.create') ? <Button variant="primary" onClick={() => setCreateOpen(true)}>New invoice</Button> : undefined,
          }}
          initialSort={{ key: 'date', dir: 'desc' }}
        />
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      {createOpen && <InvoiceFormModal patientId={0} onClose={() => setCreateOpen(false)} onSaved={(id) => { setCreateOpen(false); reload(); void api['invoices/get'](id).then(setDetail).catch(() => undefined); }} />}
      {detail && <InvoiceDetailModal invoice={detail} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

/* =============================== Payments ============================== */

export function PaymentsPage() {
  const { can } = useApp();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState('');
  const [range, setRange] = useState('all');
  const [refundTarget, setRefundTarget] = useState<PaymentDTO | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundPending, setRefundPending] = useState(false);

  const filter = { method: method || undefined, range: range === 'all' ? undefined : range, page, pageSize: 25 };
  const { data, loading, error, reload } = useAsync(() => api['payments/list'](filter), [method, range, page]);

  const totalIn = (data?.items ?? []).filter((p) => p.type === 'payment').reduce((s, p) => s + p.amountPaisa, 0);
  const totalRef = (data?.items ?? []).filter((p) => p.type === 'refund').reduce((s, p) => s + p.amountPaisa, 0);

  const columns: Column<PaymentDTO>[] = [
    { key: 'paidAt', label: 'Date', sortValue: (p) => p.paidAt, render: (p) => new Date(p.paidAt).toLocaleString() },
    {
      key: 'patient', label: 'Patient',
      render: (p) => (<div><strong>{p.patientName}</strong><div className="xsmall muted mono">{p.invoiceNumber ?? 'no invoice'}</div></div>),
    },
    {
      key: 'amount', label: 'Amount', align: 'right', sortValue: (p) => p.amountPaisa,
      render: (p) => <span className={`num ${p.type === 'refund' ? 'danger-text' : 'success-text'}`}>{p.type === 'refund' ? '−' : ''}{bdt(p.amountPaisa)}</span>,
    },
    { key: 'method', label: 'Method', render: (p) => <Badge tone="neutral">{p.method}</Badge> },
    { key: 'reference', label: 'Reference', render: (p) => <span className="mono">{p.reference ?? '—'}</span> },
    { key: 'receivedBy', label: 'Received by', render: (p) => p.receivedByName },
    { key: 'type', label: 'Type', render: (p) => <Badge tone={p.type === 'refund' ? 'danger' : 'success'}>{p.type}</Badge> },
    {
      key: 'actions', label: '', align: 'right',
      render: (p) =>
        can('billing.payment.refund') && p.type === 'payment' ? (
          <Button size="sm" variant="ghost" onClick={() => { setRefundTarget(p); setRefundAmount(String(p.amountPaisa / 100)); setRefundReason(''); }}>Refund</Button>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">Append-only ledger · corrections via explicit refunds</p>
        </div>
        <div className="page-actions">
          <div className="text-right">
            <div className="xsmall muted">In view</div>
            <div className="strong num success-text">{bdt(totalIn)}</div>
            {totalRef > 0 && <div className="xsmall danger-text num">refunds {bdt(totalRef)}</div>}
          </div>
          <Button variant="ghost" icon={Icon.refresh} onClick={reload}>Refresh</Button>
        </div>
      </div>

      <TableToolbar>
        <Select
          value={range}
          onChange={(v) => { setRange(v); setPage(1); }}
          options={[
            { value: 'all', label: 'All time' }, { value: 'today', label: 'Today' },
            { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' },
          ]}
        />
        <Select
          value={method}
          onChange={(v) => { setMethod(v); setPage(1); }}
          placeholder="Any method"
          options={['cash', 'bkash', 'nagad', 'rocket', 'upay', 'card', 'bank', 'other'].map((m) => ({ value: m, label: m.toUpperCase() }))}
        />
      </TableToolbar>

      <Card pad={false}>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.id}
          loading={loading}
          error={error}
          onRetry={reload}
          empty={{ title: 'No payments in this range', body: 'Payments recorded against invoices appear here.' }}
          initialSort={{ key: 'paidAt', dir: 'desc' }}
        />
        {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>

      {refundTarget && (
        <Modal
          title={`Refund payment — ${refundTarget.invoiceNumber ?? 'no invoice'}`}
          onClose={() => setRefundTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRefundTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={refundPending}
                disabled={!refundAmount || Number(refundAmount) <= 0 || refundReason.trim().length < 5}
                onClick={async () => {
                  setRefundPending(true);
                  try {
                    const res = await api['payments/create']({
                      invoiceId: refundTarget.invoiceId,
                      patientId: refundTarget.patientId,
                      amountPaisa: Math.round(Number(refundAmount) * 100),
                      method: refundTarget.method,
                      note: `Refund: ${refundReason}`,
                      type: 'refund',
                    });
                    toast.success('Refund recorded', bdt(res.payment.amountPaisa));
                    setRefundTarget(null);
                    reload();
                  } catch (err) {
                    toast.fromError(err, 'Refund failed');
                  } finally {
                    setRefundPending(false);
                  }
                }}
              >
                Record refund
              </Button>
            </>
          }
        >
          <p className="small">
            Refunding <strong className="num">{bdt(refundTarget.amountPaisa)}</strong> received via {refundTarget.method} on{' '}
            {new Date(refundTarget.paidAt).toLocaleString()}. The original payment row stays untouched.
          </p>
          <div className="form-grid mt-4">
            <Field label="Refund amount (৳)" required>
              {(id) => <Input id={id} type="number" min={0} step="0.01" value={refundAmount} onChange={setRefundAmount} />}
            </Field>
            <Field label="Reason" required>
              {(id) => <Input id={id} value={refundReason} onChange={setRefundReason} placeholder="Why is this being refunded?" />}
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
