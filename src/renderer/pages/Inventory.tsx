import { useEffect, useState } from 'react';
import { api, useAsync } from '../api';
import { useApp } from '../state/app-context';
import { Badge, Button, Card, EmptyState, Modal, Tabs, useToast } from '../components/primitives';
import { Field, Input, Select, Textarea } from '../components/forms';
import { DataTable, TableToolbar, type Column } from '../components/table';
import { Icon } from '../components/shell';
import { bdt, daysUntil } from '../format';
import type { InventoryBatchDTO, InventoryItemDTO, InventoryTxnType } from '../../shared/types';

function ItemModal(props: { open: boolean; initial?: InventoryItemDTO | null; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState({ code: '', name: '', categoryName: '', unit: 'pcs', minLevel: '0', location: '', active: true });
  const [errors, setErrors] = useState<{ [k: string]: string }>({});
  const [pending, setPending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!props.open) return;
    setErrors({});
    setValues({
      code: props.initial?.code ?? '',
      name: props.initial?.name ?? '',
      categoryName: props.initial?.categoryName ?? '',
      unit: props.initial?.unit ?? 'pcs',
      minLevel: String(props.initial?.minLevel ?? 0),
      location: props.initial?.location ?? '',
      active: props.initial ? props.initial.active : true,
    });
  }, [props.open, props.initial]);

  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]): void => setValues((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    const errs: { [k: string]: string } = {};
    if (values.name.trim().length < 2) errs.name = 'Item name is required.';
    if (values.unit.trim().length === 0) errs.unit = 'Unit is required (pcs, ml, gm…).';
    if (Number(values.minLevel) < 0) errs.minLevel = 'Minimum level cannot be negative.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    try {
      await api['inventory/save-item']({
        id: props.initial?.id,
        code: values.code || undefined,
        name: values.name.trim(),
        categoryName: values.categoryName || null,
        unit: values.unit,
        minLevel: Number(values.minLevel) || 0,
        location: values.location || null,
        active: values.active,
      } as any);
      toast.success(props.initial ? 'Item updated' : 'Item created', values.name);
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
      title={props.initial ? `Edit item — ${props.initial.name}` : 'New inventory item'}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Name" required error={errors.name} className="span-2">
          {(id) => <Input id={id} value={values.name} onChange={(v) => set('name', v)} invalid={!!errors.name} placeholder="e.g. Composite resin A2" />}
        </Field>
        <Field label="Code">
          {(id) => <Input id={id} value={values.code} onChange={(v) => set('code', v)} placeholder="auto if blank" />}
        </Field>
        <Field label="Category">
          {(id) => <Input id={id} value={values.categoryName} onChange={(v) => set('categoryName', v)} placeholder="e.g. Consumables" />}
        </Field>
        <Field label="Unit" required error={errors.unit}>
          {(id) => <Input id={id} value={values.unit} onChange={(v) => set('unit', v)} placeholder="pcs / ml / gm / box" invalid={!!errors.unit} />}
        </Field>
        <Field label="Minimum level" error={errors.minLevel} hint="Low-stock alert threshold">
          {(id) => <Input id={id} type="number" min={0} value={values.minLevel} onChange={(v) => set('minLevel', v)} />}
        </Field>
        <Field label="Storage location">
          {(id) => <Input id={id} value={values.location} onChange={(v) => set('location', v)} placeholder="e.g. Cabinet B" />}
        </Field>
        <Field label="Status">
          {(id) => (
            <label className="checkbox">
              <input id={id} type="checkbox" checked={values.active} onChange={(e) => set('active', e.target.checked)} />
              <span>Active (tracked in stock)</span>
            </label>
          )}
        </Field>
      </div>
    </Modal>
  );
}

function StockModal(props: {
  open: boolean;
  item: InventoryItemDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<InventoryTxnType>('in');
  const [qty, setQty] = useState('1');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [price, setPrice] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (props.open) { setQty('1'); setBatchNo(''); setExpiryDate(''); setPrice(''); setReference(''); setNote(''); setType('in'); }
  }, [props.open, props.item?.id]);

  const item = props.item;
  if (!props.open || !item) return null;

  const submit = async () => {
    const q = Number(qty);
    if (!q || q <= 0) { toast.warning('Enter a quantity above zero'); return; }
    setPending(true);
    try {
      await api['inventory/stock']({
        itemId: item.id,
        type,
        qty: q,
        batchNo: batchNo || null,
        expiryDate: expiryDate || null,
        purchasePricePaisa: price ? Math.round(Number(price) * 100) : undefined,
        reference: reference || null,
        note: note || null,
      });
      toast.success('Stock updated', `${type} ${q} ${item.unit} · ${item.name}`);
      props.onSaved();
      props.onClose();
    } catch (err) {
      toast.fromError(err, 'Stock update failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`Stock movement — ${item.name}`}
      onClose={props.onClose}
      footer={
        <>
          <span className="small muted" style={{ marginRight: 'auto' }}>Available: <strong className="num">{item.qtyAvailable} {item.unit}</strong></span>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>Apply</Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Movement" required>
          {(id) => (
            <Select id={id} value={type} onChange={(v) => setType(v as InventoryTxnType)}
              options={[
                { value: 'in', label: 'Stock in (purchase)' },
                { value: 'out', label: 'Stock out (usage)' },
                { value: 'adjust', label: 'Adjustment (count correction)' },
                { value: 'damage', label: 'Damage' },
                { value: 'expire', label: 'Expire' },
                { value: 'return', label: 'Return to supplier' },
              ]} />
          )}
        </Field>
        <Field label={`Quantity (${item.unit})`} required>
          {(id) => <Input id={id} type="number" min={1} value={qty} onChange={setQty} autoFocus />}
        </Field>
        {type === 'in' && (
          <>
            <Field label="Batch no.">
              {(id) => <Input id={id} value={batchNo} onChange={setBatchNo} />}
            </Field>
            <Field label="Expiry date">
              {(id) => <Input id={id} type="date" value={expiryDate} onChange={setExpiryDate} />}
            </Field>
            <Field label="Purchase price (৳ / unit)">
              {(id) => <Input id={id} type="number" min={0} step="0.01" value={price} onChange={setPrice} />}
            </Field>
          </>
        )}
        <Field label="Reference">
          {(id) => <Input id={id} value={reference} onChange={setReference} placeholder="PO / voucher no." />}
        </Field>
        <Field label="Note" className="span-2">
          {(id) => <Textarea id={id} rows={2} value={note} onChange={setNote} />
          }
        </Field>
      </div>
    </Modal>
  );
}

function SupplierModal(props: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const toast = useToast();
  useEffect(() => { if (props.open) { setName(''); setPhone(''); setAddress(''); } }, [props.open]);
  if (!props.open) return null;
  return (
    <Modal
      title="New supplier"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button
            variant="primary" loading={pending}
            onClick={async () => {
              if (name.trim().length < 2) { toast.warning('Supplier name required'); return; }
              setPending(true);
              try {
                await api['inventory/save-supplier']({ name: name.trim(), phone: phone || null, address: address || null });
                toast.success('Supplier saved', name);
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
      <div className="form-grid">
        <Field label="Supplier name" required>{(id) => <Input id={id} value={name} onChange={setName} autoFocus />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={setPhone} />}</Field>
        <Field label="Address" className="span-2">{(id) => <Textarea id={id} rows={2} value={address} onChange={setAddress} />}</Field>
      </div>
    </Modal>
  );
}

type InvTab = 'items' | 'batches' | 'suppliers';

export function InventoryPage() {
  const { can } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<InvTab>('items');
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [itemModal, setItemModal] = useState<{ open: boolean; initial: InventoryItemDTO | null }>({ open: false, initial: null });
  const [stockItem, setStockItem] = useState<InventoryItemDTO | null>(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [expiringDays, setExpiringDays] = useState('30');

  const { data: items, loading, error, reload } = useAsync(
    () => api['inventory/items']({ query: query || undefined, lowOnly: lowOnly || undefined }),
    [query, lowOnly],
  );
  const { data: batches, reload: reloadBatches } = useAsync(() => api['inventory/batches']({ expiringWithinDays: Number(expiringDays) || 30 }), [expiringDays]);
  const { data: suppliers, reload: reloadSuppliers } = useAsync(() => api['inventory/suppliers'](), []);

  const printLabels = async (onlyExpiring: boolean) => {
    try {
      await api['reports/print']({ type: 'stock-labels', id: 0, reportName: onlyExpiring ? 'expiring' : 'all' } as any);
    } catch (err) {
      toast.fromError(err, 'Print preview failed');
    }
  };

  const itemColumns: Column<InventoryItemDTO>[] = [
    { key: 'code', label: 'Code', render: (i) => <span className="mono">{i.code}</span> },
    {
      key: 'name', label: 'Item', sortValue: (i) => i.name,
      render: (i) => (
        <div>
          <strong>{i.name}</strong>
          <div className="xsmall muted">{i.categoryName ?? 'uncategorised'} · {i.location ?? 'no location'}</div>
        </div>
      ),
    },
    { key: 'qty', label: 'Available', align: 'right', sortValue: (i) => i.qtyAvailable, render: (i) => <span className="num strong">{i.qtyAvailable} {i.unit}</span> },
    {
      key: 'low', label: 'Stock state',
      render: (i) => (i.lowStock ? <Badge tone="danger">low ≤ {i.minLevel}</Badge> : <Badge tone="success">ok</Badge>),
    },
    {
      key: 'expiry', label: 'Nearest expiry',
      render: (i) => {
        const d = daysUntil(i.nearestExpiry);
        if (d === null) return <span className="muted">—</span>;
        if (d < 0) return <Badge tone="danger">expired {i.nearestExpiry}</Badge>;
        if (d <= 30) return <Badge tone="warning">{d}d left</Badge>;
        return <span className="muted">{new Date(i.nearestExpiry!).toLocaleDateString()}</span>;
      },
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (i) =>
        can('inventory.manage') ? (
          <div className="row gap-2 end" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => setStockItem(i)}>Stock</Button>
            <Button size="sm" variant="ghost" onClick={() => setItemModal({ open: true, initial: i })}>Edit</Button>
          </div>
        ) : null,
    },
  ];

  const batchColumns: Column<InventoryBatchDTO>[] = [
    { key: 'itemName', label: 'Item', sortValue: (b) => b.itemName, render: (b) => <strong>{b.itemName}</strong> },
    { key: 'batchNo', label: 'Batch', render: (b) => <span className="mono">{b.batchNo ?? '—'}</span> },
    { key: 'expiry', label: 'Expiry', sortValue: (b) => b.expiryDate ?? '', render: (b) => (b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : '—') },
    { key: 'qty', label: 'Qty left', align: 'right', render: (b) => <span className="num">{b.qtyAvailable}/{b.qtyInitial}</span> },
    { key: 'price', label: 'Cost', align: 'right', render: (b) => <span className="num">{bdt(b.purchasePricePaisa)}</span> },
    { key: 'supplier', label: 'Supplier', render: (b) => b.supplierName ?? '—' },
    {
      key: 'state', label: 'State',
      render: (b) => (b.expired ? <Badge tone="danger">expired</Badge> : b.nearExpiry ? <Badge tone="warning">near expiry</Badge> : <Badge tone="success">ok</Badge>),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">FEFO stock control · batch &amp; expiry tracking for the whole clinic</p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => void printLabels(false)}>Print labels</Button>
          <Button variant="ghost" icon={Icon.refresh} onClick={() => { reload(); reloadBatches(); }}>Refresh</Button>
          {can('inventory.manage') && <Button variant="secondary" onClick={() => setSupplierOpen(true)}>New supplier</Button>}
          {can('inventory.manage') && <Button variant="primary" icon={Icon.plus} onClick={() => setItemModal({ open: true, initial: null })}>New item</Button>}
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'items' as const, label: 'Items', count: items?.length },
          { key: 'batches' as const, label: 'Batches & expiry', count: batches?.length },
          { key: 'suppliers' as const, label: 'Suppliers', count: suppliers?.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'items' && (
          <>
            <TableToolbar
              right={
                <label className="checkbox">
                  <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
                  <span>Low stock only</span>
                </label>
              }
            >
              <div style={{ minWidth: 260, flex: '1 1 260px' }}>
                <Input value={query} onChange={setQuery} placeholder="Search items…" />
              </div>
            </TableToolbar>
            <Card pad={false}>
              <DataTable
                columns={itemColumns}
                rows={items ?? []}
                rowKey={(i) => i.id}
                loading={loading}
                error={error}
                onRetry={reload}
                empty={{
                  title: query ? `No items match “${query}”` : 'No inventory items yet',
                  body: 'Add the materials and medicines your clinic stocks.',
                  action: can('inventory.manage') ? <Button variant="primary" onClick={() => setItemModal({ open: true, initial: null })}>New item</Button> : undefined,
                }}
              />
            </Card>
          </>
        )}

        {tab === 'batches' && (
          <>
            <TableToolbar right={<Button size="sm" variant="ghost" onClick={() => void printLabels(true)}>Print expiring labels</Button>}>
              <Field label="Expiring within (days)" className="row" >
                {() => <Input type="number" min={1} value={expiringDays} onChange={setExpiringDays} style={{ width: 120 }} />}
              </Field>
            </TableToolbar>
            <Card pad={false}>
              <DataTable
                columns={batchColumns}
                rows={batches ?? []}
                rowKey={(b) => b.id}
                loading={loading}
                error={error}
                onRetry={reloadBatches}
                empty={{ title: 'No batches', body: 'Batches appear when stock is received with a batch number.' }}
              />
            </Card>
          </>
        )}

        {tab === 'suppliers' && (
          <Card
            title="Suppliers"
            actions={can('inventory.manage') ? <Button size="sm" variant="primary" onClick={() => setSupplierOpen(true)}>New supplier</Button> : undefined}
          >
            {(suppliers ?? []).length === 0 ? (
              <EmptyState title="No suppliers yet" body="Track who you purchase stock from." />
            ) : (
              <div className="list">
                {suppliers!.map((s) => (
                  <div className="list-row" key={s.id}>
                    <strong className="flex-1">{s.name}</strong>
                    <span className="mono small">{s.phone ?? ''}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <ItemModal open={itemModal.open} initial={itemModal.initial} onClose={() => setItemModal({ open: false, initial: null })} onSaved={() => { reload(); reloadBatches(); }} />
      <StockModal open={!!stockItem} item={stockItem} onClose={() => setStockItem(null)} onSaved={() => { reload(); reloadBatches(); }} />
      <SupplierModal open={supplierOpen} onClose={() => setSupplierOpen(false)} onSaved={reloadSuppliers} />
    </div>
  );
}
