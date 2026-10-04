import React, { useEffect, useMemo, useState } from 'react';
import { formatDate } from '../format';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { Button, ErrorState, Spinner, useToast } from '../components/primitives';
import { Icon } from '../components/shell';
import type { PrintProfile } from '../../shared/types';

const DEFAULT_PRINT_PROFILES: PrintProfile[] = [
  { id: 'rx-a4', name: 'Prescription A4', documentType: 'prescription', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
  { id: 'rx-a5', name: 'Prescription A5', documentType: 'prescription', printerName: '', paperSize: 'a5', widthMm: 148, heightMm: 210, orientation: 'portrait', margins: { top: 8, right: 8, bottom: 8, left: 8 }, scale: 100, copies: 1 },
  { id: 'inv-a4', name: 'Invoice A4', documentType: 'invoice', printerName: '', paperSize: 'a4', widthMm: 210, heightMm: 297, orientation: 'portrait', margins: { top: 12, right: 12, bottom: 12, left: 12 }, scale: 100, copies: 1 },
  { id: 'inv-thermal', name: 'Receipt Thermal 80mm', documentType: 'receipt', printerName: '', paperSize: 'thermal', widthMm: 80, heightMm: 200, orientation: 'portrait', margins: { top: 4, right: 4, bottom: 4, left: 4 }, scale: 100, copies: 1 },
];

const PAPER_DIMS_MM: Record<string, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  thermal: { widthMm: 80, heightMm: 200 },
  custom: { widthMm: 210, heightMm: 297 },
};

interface PrintParams { [k: string]: string }

function useQuery(): PrintParams {
  const { search } = useLocation();
  return useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
}

/* Print payloads are validated against main-process print document kinds. */
interface PrintState {
  kind: string;
  title: string;
  doc: React.ReactNode;
  data: any;
}

function credentialLines(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[\r\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function Header({ clinic, right }: { clinic: any; right?: React.ReactNode }) {
  return (
    <div className="print-header">
      <div className="head-main">
        {clinic?.logoDataUrl ? (
          <img className="logo" src={clinic.logoDataUrl} alt="" />
        ) : (
          <div className="logo">D</div>
        )}
        <div>
          <h1>{clinic?.clinicName || 'Dental Clinic'}</h1>
          <div className="muted" style={{ fontSize: 11.5 }}>
            {clinic?.address && <div>{clinic.address}</div>}
            <div>
              {clinic?.phone ? `Phone: ${clinic.phone}` : ''}
              {clinic?.phone && clinic?.email ? ' · ' : ''}
              {clinic?.email ?? ''}
            </div>
            {clinic?.website && <div>{clinic.website}</div>}
          </div>
        </div>
      </div>
      <div className="clinic-meta">{right}</div>
    </div>
  );
}

function Footer({ text }: { text?: string | null }) {
  return (
    <div className="print-footer">
      <span>{text || ''}</span>
      <span className="print-generated">Computer-generated document</span>
    </div>
  );
}

const fmtBdt = (paisa: number): string => `৳${(paisa / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function invoiceDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic, settings } = data;
  const lines: any[] = invoice.lines ?? [];
  const discount = invoice.discountPaisa ?? 0;
  const subtotal = lines.reduce((s: number, l: any) => s + l.totalPaisa, 0);
  return (
    <>
      <Header clinic={clinic} right={<>
        <div><b>Invoice</b></div>
        <div className="mono">{invoice.invoiceNumber}</div>
        <div>{formatDate(invoice.invoiceDate)}</div>
      </>} />
      <div className="doc-title">Invoice</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{invoice.patientName}</span></div>
        <div><span className="k">Phone</span><span className="v">{invoice.patientPhone || '—'}</span></div>
        <div><span className="k">Invoice No</span><span className="v mono">{invoice.invoiceNumber}</span></div>
        <div><span className="k">Date</span><span className="v">{formatDate(invoice.invoiceDate)}</span></div>
        <div><span className="k">Dentist</span><span className="v">{invoice.dentistName || '—'}</span></div>
        <div><span className="k">Status</span><span className="v">{invoice.status}</span></div>
      </div>
      <table>
        <thead>
          <tr><th style={{ width: '52%' }}>Description</th><th className="right">Qty</th><th className="right">Unit</th><th className="right">Total</th></tr>
        </thead>
        <tbody>
          {lines.map((l: any) => (
            <tr key={l.id}>
              <td>{l.description}{l.toothNumber ? ` (Tooth ${l.toothNumber})` : ''}</td>
              <td className="right mono">{l.quantity}</td>
              <td className="right mono">{fmtBdt(l.unitPricePaisa)}</td>
              <td className="right mono">{fmtBdt(l.totalPaisa)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="totals">
        <tbody>
          <tr><td className="muted">Subtotal</td><td className="right mono">{fmtBdt(subtotal)}</td></tr>
          {discount > 0 && <tr><td className="muted">Discount</td><td className="right mono">−{fmtBdt(discount)}</td></tr>}
          <tr><td className="muted">VAT</td><td className="right mono">{fmtBdt(invoice.vatPaisa ?? 0)}</td></tr>
          <tr><td className="muted">Total</td><td className="right mono">{fmtBdt(invoice.totalPaisa)}</td></tr>
          <tr><td className="muted">Paid</td><td className="right mono">{fmtBdt(invoice.paidPaisa ?? 0)}</td></tr>
          <tr className="grand"><td>Balance due</td><td className="right mono">{fmtBdt(invoice.duePaisa ?? 0)}</td></tr>
        </tbody>
      </table>
      {payments?.length > 0 && (
        <>
          <h2>Payment history</h2>
          <table className="compact">
            <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="right">Amount</th></tr></thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.id}>
                  <td>{formatDate(p.paidAt)}</td>
                  <td>{p.method}</td>
                  <td className="mono">{p.reference || '—'}</td>
                  <td className="right mono">{fmtBdt(p.amountPaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Footer text={invoice.footerNote || settings?.invoice?.footerNote || 'Thank you for your visit.'} />
    </>
  );
}

function thermalHeader(clinic: any): React.ReactNode {
  return (
    <div className="thermal-head">
      {clinic?.logoDataUrl ? <img src={clinic.logoDataUrl} alt="" /> : <div className="logo">D</div>}
      <div className="thermal-clinic">
        <strong>{clinic?.clinicName || 'Dental Clinic'}</strong>
        {clinic?.phone && <span>{clinic.phone}</span>}
        {clinic?.address && <span>{clinic.address}</span>}
      </div>
    </div>
  );
}

function thermalMeta(invoice: any): React.ReactNode {
  return (
    <div className="thermal-meta">
      <div><span className="k">Patient</span><span className="v">{invoice.patientName}</span></div>
      <div><span className="k">Invoice</span><span className="v mono">{invoice.invoiceNumber}</span></div>
      <div><span className="k">Date</span><span className="v">{formatDate(invoice.invoiceDate)}</span></div>
      <div><span className="k">Phone</span><span className="v">{invoice.patientPhone || '—'}</span></div>
    </div>
  );
}

function thermalInvoiceDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic, settings } = data;
  const lines: any[] = invoice.lines ?? [];
  const subtotal = lines.reduce((s: number, l: any) => s + l.totalPaisa, 0);
  const discount = invoice.discountPaisa ?? 0;
  return (
    <div className="thermal-invoice">
      {thermalHeader(clinic)}
      <div className="thermal-title">INVOICE</div>
      {thermalMeta(invoice)}
      <div>
        {lines.map((l: any) => (
          <div className="thermal-line" key={l.id}>
            <div className="desc">
              <strong>{l.description}</strong>
              <div className="thermal-subline">{l.quantity} × {fmtBdt(l.unitPricePaisa)}{l.toothNumber ? ' · Tooth ' + l.toothNumber : ''}</div>
            </div>
            <div className="amount">{fmtBdt(l.totalPaisa)}</div>
          </div>
        ))}
      </div>
      <div className="thermal-total">
        <div className="thermal-total-row"><span>Subtotal</span><span>{fmtBdt(subtotal)}</span></div>
        {discount > 0 && <div className="thermal-total-row"><span>Discount</span><span>−{fmtBdt(discount)}</span></div>}
        <div className="thermal-total-row"><strong>Total</strong><strong>{fmtBdt(invoice.totalPaisa)}</strong></div>
        <div className="thermal-total-row"><span>Paid</span><span>{fmtBdt(invoice.paidPaisa ?? 0)}</span></div>
        <div className="thermal-total-row"><strong>Balance due</strong><strong>{fmtBdt(invoice.duePaisa ?? 0)}</strong></div>
      </div>
      {payments?.length > 0 && (
        <div className="thermal-note">
          Last payment: {fmtBdt(payments[payments.length - 1].amountPaisa)} · {payments[payments.length - 1].method}
        </div>
      )}
      <div className="thermal-note">{invoice.footerNote || settings?.invoice?.footerNote || 'Thank you for your visit.'}</div>
      <div className="thermal-generated">Computer-generated document</div>
    </div>
  );
}

function thermalReceiptDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic } = data;
  const lastPayment = payments?.[payments.length - 1];
  return (
    <div className="thermal-receipt">
      {thermalHeader(clinic)}
      <div className="thermal-title">PAYMENT RECEIPT</div>
      {thermalMeta(invoice)}
      <div className="thermal-total">
        <div className="thermal-total-row"><span>Amount received</span><strong>{fmtBdt(lastPayment?.amountPaisa ?? 0)}</strong></div>
        <div className="thermal-total-row"><span>Method</span><span>{lastPayment?.method ?? '—'}</span></div>
        {lastPayment?.reference && <div className="thermal-total-row"><span>Reference</span><span>{lastPayment.reference}</span></div>}
        <div className="thermal-total-row"><span>Invoice total</span><span>{fmtBdt(invoice.totalPaisa)}</span></div>
        <div className="thermal-total-row"><span>Total paid</span><span>{fmtBdt(invoice.paidPaisa ?? 0)}</span></div>
        <div className="thermal-total-row"><strong>Balance due</strong><strong>{fmtBdt(invoice.duePaisa ?? 0)}</strong></div>
      </div>
      <div className="thermal-note">Payment received and recorded by computer-generated clinic records.</div>
      <div className="thermal-generated">Computer-generated document</div>
    </div>
  );
}

function receiptDoc(data: any): React.ReactNode {
  const { invoice, payments, clinic } = data;
  const lastPayment = payments?.[payments.length - 1];
  return (
    <>
      <Header clinic={clinic} right={<><div><b>Receipt</b></div><div>{formatDate(new Date())}</div></>} />
      <div className="doc-title">Payment Receipt</div>
      <div className="print-kv">
        <div><span className="k">Received from</span><span className="v">{invoice.patientName}</span></div>
        <div><span className="k">Phone</span><span className="v">{invoice.patientPhone || '—'}</span></div>
        <div><span className="k">Invoice</span><span className="v mono">{invoice.invoiceNumber}</span></div>
        <div><span className="k">Payment date</span><span className="v">{lastPayment ? formatDate(lastPayment.paidAt) : '—'}</span></div>
      </div>
      <table>
        <tbody>
          <tr><td className="muted">Amount received</td><td className="right mono"><b>{fmtBdt(lastPayment?.amountPaisa ?? 0)}</b></td></tr>
          <tr><td className="muted">Method</td><td className="right">{lastPayment?.method ?? '—'}</td></tr>
          <tr><td className="muted">Invoice total</td><td className="right mono">{fmtBdt(invoice.totalPaisa)}</td></tr>
          <tr><td className="muted">Total paid to date</td><td className="right mono">{fmtBdt(invoice.paidPaisa ?? 0)}</td></tr>
          <tr className="grand"><td>Balance due</td><td className="right mono">{fmtBdt(invoice.duePaisa ?? 0)}</td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 30 }}>
        <div className="sig-line" />
        <div className="muted small">Authorised signature</div>
      </div>
      <Footer text="This receipt confirms payment received by Dentiva Pro-managed clinic records." />
    </>
  );
}

function prescriptionDoc(data: any): React.ReactNode {
  const { rx, patient, clinic, visit, watermark, settings } = data;
  const ageGender = `${patient.ageYears != null ? `${patient.ageYears}y ` : ''}${patient.gender || ''}`.trim() || '—';
  const diagnosisText = rx.diagnosis || visit?.diagnosis || null;
  const labels = settings?.prescription?.labels ?? {};
  const sigReserved = settings?.prescription?.signatureReserved !== false;
  return (
    <>
      {watermark && <div className="print-watermark"><span>Specimen</span></div>}
      <Header clinic={clinic} right={<>
        <div><b>Prescription</b></div>
        <div className="mono">Rx {rx.rxNumber}</div>
        <div>{formatDate(rx.rxDate)}</div>
      </>} />
      {settings?.prescription?.visitingHours && <div className="muted small" style={{ marginTop: -6, marginBottom: 8 }}>{settings.prescription.visitingHours}</div>}
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{patient.name}</span></div>
        <div><span className="k">Age / Sex</span><span className="v">{ageGender}</span></div>
        <div><span className="k">Phone</span><span className="v">{patient.phone || '—'}</span></div>
        <div><span className="k">Patient ID</span><span className="v mono">{patient.patientCode}</span></div>
        {diagnosisText && <div><span className="k">{labels.diagnosis || 'Diagnosis'}</span><span className="v">{diagnosisText}</span></div>}
        {rx.cC && <div><span className="k">{labels.cc || 'C/C'}</span><span className="v">{rx.cC}</span></div>}
        {rx.oE && <div><span className="k">{labels.oe || 'O/E'}</span><span className="v">{rx.oE}</span></div>}
        {rx.rE && <div><span className="k">{labels.re || 'R/E'}</span><span className="v">{rx.rE}</span></div>}
        {rx.treatment && <div><span className="k">{labels.treatment || 'Treatment'}</span><span className="v">{rx.treatment}</span></div>}
      </div>
      <h2>Medications</h2>
      {rx.items.map((it: any, i: number) => (
        <div className="rx-line" key={i}>
          <span className="idx">{i + 1}.</span>
          <span className="drug">{it.form ? `${it.form} ` : ''}{it.medicineName}</span>
          {it.strength && <span className="muted">({it.strength})</span>}
          {it.generic && <span className="muted">[{it.generic}]</span>}
          <span>— {it.dosage}{it.frequency ? ` ${it.frequency}` : ''}{it.route ? ` (${it.route})` : ''}</span>
          <span className="muted">
            {it.duration ? `× ${it.duration}` : ''}
            {it.qty ? ` (Qty: ${it.qty})` : ''}
            {it.instruction ? ` · ${it.instruction}` : ''}
          </span>
        </div>
      ))}
      {rx.advice && <><h3>{labels.advice || 'Advice'}</h3><div>{rx.advice}</div></>}
      {rx.followUp && <><h3>{labels.followUp || 'Follow-up'}</h3><div>{formatDate(rx.followUp)}</div></>}
      {sigReserved ? (
      <div className="sig-block">
        <div className="muted small">
          {watermark ? 'Duplicate copy — valid only with signature and seal.' : 'Please complete the full course as directed.'}
        </div>
        <div>
          <div className="sig-line" />
          <div><b>{data.dentist?.name ?? rx.dentistName}</b></div>
          <div className="muted small">
            {credentialLines(data.dentist?.qualifications).map((q, i) => <div key={i}>{q}</div>)}
            {data.dentist?.regNo && <div>Reg. {data.dentist.regNo}</div>}
          </div>
        </div>
      </div>
      ) : (
        <div className="sig-compact">
          <div><b>{data.dentist?.name ?? rx.dentistName}</b></div>
          <div className="muted small">
            {credentialLines(data.dentist?.qualifications).map((q, i) => <div key={i}>{q}</div>)}
            {data.dentist?.regNo && <div>Reg. {data.dentist.regNo}</div>}
          </div>
        </div>
      )}
      <Footer text={settings?.prescription?.footerMessage || clinic?.clinicName || ''} />
    </>
  );
}

function visitSummaryDoc(data: any): React.ReactNode {
  const { patient, visit, procedures, rx, clinic } = data;
  const ageGender = `${patient.ageYears != null ? `${patient.ageYears}y ` : ''}${patient.gender || ''}`.trim() || '—';
  return (
    <>
      <Header clinic={clinic} right={<><div><b>Visit summary</b></div><div>{formatDate(visit.visitDate)}</div></>} />
      <div className="doc-title">Visit Summary</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{patient.name}</span></div>
        <div><span className="k">Patient ID</span><span className="v mono">{patient.patientCode}</span></div>
        <div><span className="k">Age / Sex</span><span className="v">{ageGender}</span></div>
        <div><span className="k">Phone</span><span className="v">{patient.phone || '—'}</span></div>
        <div><span className="k">Visit date</span><span className="v">{formatDate(visit.visitDate)}</span></div>
        <div><span className="k">Dentist</span><span className="v">{visit.dentistName || '—'}</span></div>
      </div>
      <h2>Presenting complaint</h2>
      <div>{visit.chiefComplaint || '—'}</div>
      <h2>Diagnosis</h2>
      <div>{visit.diagnosis || '—'}</div>
      <h2>Treatment done</h2>
      <div>{visit.treatmentNotes || '—'}</div>
      {procedures?.length > 0 && (
        <>
          <h2>Procedures</h2>
          <table className="compact">
            <thead><tr><th>Tooth</th><th>Procedure</th><th>Details</th></tr></thead>
            <tbody>
              {procedures.map((p: any) => (
                <tr key={p.id}><td className="mono">{p.toothNumber ?? '—'}</td><td>{p.treatmentName}</td><td>{p.notes || ''}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Prescriptions</h2>
      {rx?.length ? rx.map((r: any) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <b>{r.rxNumber}</b>: {r.items?.map((i: any) => `${i.medicineName} ${i.strength ?? ''} ${i.dosage ?? ''}`).join('; ') || '—'}
        </div>
      )) : <div className="muted">No prescriptions for this visit.</div>}
      <h2>Next appointment</h2>
      <div>{visit.nextVisitDate ? formatDate(visit.nextVisitDate) + (visit.nextVisitPurpose ? ` — ${visit.nextVisitPurpose}` : '') : 'None scheduled'}</div>
      <Footer text="Computer-generated visit summary" />
    </>
  );
}

function appointmentCardDoc(data: any): React.ReactNode {
  const { appointment, patient, clinic } = data;
  const start = new Date(`${appointment.date}T${appointment.time || '00:00'}`);
  return (
    <>
      <Header clinic={clinic} right={<div><b>Appointment card</b></div>} />
      <div className="doc-title">Appointment Card</div>
      <div className="print-kv">
        <div><span className="k">Patient</span><span className="v">{patient.name}</span></div>
        <div><span className="k">Phone</span><span className="v">{patient.phone || '—'}</span></div>
        <div><span className="k">Date</span><span className="v">{formatDate(start)}</span></div>
        <div><span className="k">Time</span><span className="v">{start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div><span className="k">Dentist</span><span className="v">{appointment.dentistName || '—'}</span></div>
        <div><span className="k">Purpose</span><span className="v">{appointment.purpose || '—'}</span></div>
      </div>
      <p className="muted">
        Please arrive 10 minutes early and bring any previous prescriptions or reports.
        If you need to reschedule, call the clinic as soon as possible.
      </p>
      <Footer text="Keep this card for your records" />
    </>
  );
}

function stockLabelDoc(data: any): React.ReactNode {
  const { items, clinic, expiryThresholdDays } = data;
  const today = Date.now();
  return (
    <>
      <div className="doc-title">Stock &amp; Expiry Labels</div>
      <table className="compact">
        <thead><tr><th>Item</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Status</th></tr></thead>
        <tbody>
          {items.map((it: any) => {
            const exp = it.expiryDate ? new Date(it.expiryDate).getTime() : null;
            const days = exp ? Math.round((exp - today) / 86_400_000) : null;
            const state = days === null ? '—' : days < 0 ? 'EXPIRED' : days <= expiryThresholdDays ? `EXPIRES IN ${days}d` : 'OK';
            return (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td className="mono">{it.batchNumber || '—'}</td>
                <td className="mono">{it.expiryDate ? formatDate(it.expiryDate) : '—'}</td>
                <td className="mono">{it.quantity}{it.unit ? ` ${it.unit}` : ''}</td>
                <td><b>{state}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Footer text={`${clinic?.clinicName ?? ''} · inventory label sheet`} />
    </>
  );
}

function emptyDoc(title: string): React.ReactNode {
  return (
    <>
      <div className="doc-title">{title}</div>
      <p className="muted">There is nothing to print for this selection.</p>
    </>
  );
}


/* -------- adapters from API DTOs to document shapes -------- */

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob).getTime();
  if (Number.isNaN(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d) / (365.25 * 86_400_000)));
}

function invToDoc(inv: any) {
  return {
    id: inv.id, invoiceNumber: inv.number, invoiceDate: inv.date, patientId: inv.patientId,
    patientName: inv.patientName, patientCode: inv.patientCode, patientPhone: null as string | null,
    dentistName: null as string | null, status: inv.status, subtotalPaisa: inv.subtotalPaisa,
    discountPaisa: inv.discountPaisa, vatPaisa: 0, totalPaisa: inv.totalPaisa,
    paidPaisa: inv.paidPaisa, duePaisa: inv.duePaisa, footerNote: inv.note,
    lines: (inv.items ?? []).map((l: any) => ({
      id: l.id, description: l.description, toothNumber: null as number | null,
      quantity: l.qty, unitPricePaisa: l.unitPricePaisa, totalPaisa: l.totalPaisa,
    })),
  };
}

function rxToDoc(rx: any) {
  return {
    id: rx.id, rxNumber: rx.number, rxDate: rx.date,
    dentistId: rx.dentistId, dentistName: rx.dentistName,
    cC: rx.cC, oE: rx.oE, rE: rx.rE, treatment: rx.treatment,
    diagnosis: rx.diagnosis, advice: rx.advice, followUp: rx.followUp,
    items: (rx.items ?? []).map((it: any, i: number) => ({
      seq: i + 1, medicineName: it.medicineName, generic: it.generic, strength: it.strength,
      form: it.form, dosage: it.dosage, frequency: it.frequency, duration: it.duration,
      qty: it.qty, instruction: it.instruction, route: null as string | null,
    })),
  };
}

function visitToDoc(v: any) {
  return {
    id: v.id, visitDate: v.datetime, chiefComplaint: v.chiefComplaint, diagnosis: v.diagnosis,
    treatmentNotes: v.treatmentPlan ?? v.notes, dentistName: v.dentistName,
    nextVisitDate: v.followUpDate, nextVisitPurpose: v.advice,
  };
}

function reportDoc(data: any): React.ReactNode {
  const r = data.report;
  return (
    <>
      <Header clinic={data.clinic} right={<>
        <div><b>Report</b></div>
        <div>{formatDate(r.generatedAt)}</div>
      </>} />
      <div className="doc-title">{r.title}</div>
      <div className="muted" style={{ marginBottom: 8 }}>{r.scope}</div>
      <table className="compact">
        <thead>
          <tr>{r.columns.map((c: any) => (
            <th key={c.key} className={c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : ''}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {r.rows.map((row: any, i: number) => (
            <tr key={i}>
              {r.columns.map((c: any) => (
                <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}>{row[c.key] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {r.totals && (
          <tfoot>
            <tr>
              {r.columns.map((c: any, i: number) => (
                <td key={c.key} className={c.align === 'right' ? 'right mono' : ''}>
                  {i === 0 ? 'Total' : (r.totals[c.key] ?? '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      <Footer text={`${r.rows.length} rows`} />
    </>
  );
}

/* ----------------------------- Print page ----------------------------- */

export function PrintPage() {
  const query = useQuery();
  // Path: #print/<kind>/<id>[?query]  (main process builds this hash)
  const parts = window.location.hash.replace(/^#\/?print\//, '').split('/');
  const kind = parts[0] ?? '';
  const id = parts[1]?.split('?')[0] ?? '';
  const [state, setState] = useState<PrintState | null>(null);
  const [profiles, setProfiles] = useState<PrintProfile[]>(DEFAULT_PRINT_PROFILES);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(query.profile ?? '');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? profiles[0] ?? DEFAULT_PRINT_PROFILES[0],
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const settingsOf = async () => {
      const s = await api['settings/get']();
      const loadedProfiles = 'printProfiles' in s && Array.isArray(s.printProfiles) && s.printProfiles.length > 0
        ? s.printProfiles
        : DEFAULT_PRINT_PROFILES;
      if (!cancelled) {
        setProfiles(loadedProfiles);
        setSelectedProfileId((cur) => {
          if (query.profile && loadedProfiles.some((p: PrintProfile) => p.id === query.profile)) return query.profile;
          if (cur && loadedProfiles.some((p: PrintProfile) => p.id === cur)) return cur;
          const byDoc = loadedProfiles.find((p: PrintProfile) =>
            (kind.startsWith('prescription') && p.documentType === 'prescription') ||
            (kind === 'invoice' && p.documentType === 'invoice') ||
            (kind === 'receipt' && p.documentType === 'receipt') ||
            (kind === 'report' && p.documentType === 'report'),
          );
          return byDoc?.id ?? loadedProfiles[0].id;
        });
      }
      return s;
    };
    const clinicOf = async (): Promise<any> => (await settingsOf()).clinic;
    const load = async (): Promise<PrintState> => {
      switch (kind) {
        case 'invoice':
        case 'receipt': {
          const [invoice, clinic, pays] = await Promise.all([
            api['invoices/get'](Number(id)),
            clinicOf(),
            api['payments/list']({ invoiceId: Number(id), pageSize: 200 }),
          ]);
          const payments = pays.items;
          const docInv = invToDoc(invoice);
          try {
            const pat = await api['patients/get'](invoice.patientId);
            docInv.patientPhone = pat.phone;
          } catch { /* archived patient */ }
          const fullSettings = await settingsOf();
          const payload = { invoice: docInv, payments, clinic, settings: fullSettings };
          if (kind === 'receipt') {
            if (payments.length === 0) throw new Error('No payments recorded on this invoice — nothing to receipt.');
            return { kind, title: `Receipt — ${invoice.number}`, doc: receiptDoc(payload), data: payload };
          }
          return { kind, title: `Invoice ${invoice.number}`, doc: invoiceDoc(payload), data: payload };
        }
        case 'prescription':
        case 'prescription-duplicate': {
          const rx0 = await api['prescriptions/get'](Number(id));
          const [patient, clinic, dentists] = await Promise.all([
            api['patients/get'](rx0.patientId),
            clinicOf(),
            api['dentists/list'](),
          ]);
          const dentist = dentists.find((d) => d.id === rx0.dentistId) ?? null;
          const data = {
            rx: rxToDoc(rx0),
            patient: {
              name: patient.name, ageYears: patient.ageYears ?? ageFromDob(patient.dob),
              gender: patient.gender, phone: patient.phone, patientCode: patient.code,
            },
            clinic, dentist, dentistName: rx0.dentistName, settings: await settingsOf(),
            visit: null,
            watermark: kind === 'prescription-duplicate',
          };
          return { kind, title: `${rx0.number}${data.watermark ? ' (duplicate)' : ''}`, doc: prescriptionDoc(data), data };
        }
        case 'visit-summary': {
          const visit0 = await api['visits/get'](Number(id));
          const [patient, clinic, rxs] = await Promise.all([
            api['patients/get'](visit0.patientId),
            clinicOf(),
            api['prescriptions/list']({ patientId: visit0.patientId, pageSize: 200 }),
          ]);
          const procedures = (visit0.treatments ?? []).map((t: any, i: number) => ({
            id: t.id ?? i,
            toothNumber: t.tooth ?? null,
            treatmentName: t.description,
            notes: `${t.qty} × ${fmtBdt(t.unitPricePaisa)} = ${fmtBdt(t.totalPaisa ?? t.qty * t.unitPricePaisa)}`,
          }));
          const data = {
            patient: {
              name: patient.name, ageYears: patient.ageYears ?? ageFromDob(patient.dob),
              gender: patient.gender, phone: patient.phone, patientCode: patient.code,
            },
            visit: visitToDoc(visit0),
            procedures,
            rx: rxs.items.filter((r) => r.visitId === visit0.id),
            clinic,
            settings: await settingsOf(),
          };
          return { kind, title: 'Visit summary', doc: visitSummaryDoc(data), data };
        }
        case 'appointment-card': {
          const [list, clinic] = await Promise.all([
            api['appointments/list']({ from: '2000-01-01', to: '2100-01-01' }),
            clinicOf(),
          ]);
          const appt = list.find((a) => a.id === Number(id));
          if (!appt) throw new Error('Appointment not found.');
          const patient = await api['patients/get'](appt.patientId);
          const data = { appointment: appt, patient: { name: patient.name, phone: patient.phone }, clinic };
          return { kind, title: `Appointment card — ${patient.name}`, doc: appointmentCardDoc(data), data };
        }
        case 'stock-labels': {
          const expiringMode = query.expiring === '1' || query.report === 'expiring';
          const [items, batches, clinic] = await Promise.all([
            api['inventory/items']({ includeInactive: false }),
            api['inventory/batches'](expiringMode ? { expiringWithinDays: 90 } : {}),
            clinicOf(),
          ]);
          const itemMap = new Map(items.map((it) => [it.id, it]));
          const rows = batches.map((b) => ({
            id: b.id, name: b.itemName, batchNumber: b.batchNo, expiryDate: b.expiryDate,
            quantity: b.qtyAvailable, unit: itemMap.get(b.itemId)?.unit ?? '',
          }));
          const data = { items: rows, clinic, expiryThresholdDays: 90 };
          return { kind, title: expiringMode ? 'Expiring stock labels' : 'Stock labels', doc: stockLabelDoc(data), data };
        }
        case 'report': {
          const reportName = query.report;
          if (!reportName) throw new Error('Missing report name.');
          const reportParams: Record<string, string> = {};
          if (query.from) reportParams.from = query.from;
          if (query.to) reportParams.to = query.to;
          const [result, clinic] = await Promise.all([
            api['reports/run']({ name: reportName, params: reportParams }),
            clinicOf(),
          ]);
          const data = { report: result, clinic };
          return { kind, title: result.title, doc: reportDoc(data), data };
        }
        default:
          return { kind, title: 'Unknown document', doc: emptyDoc('Unknown document'), data: {} };
      }
    };
    load()
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  const dims = useMemo(() => {
    const base = PAPER_DIMS_MM[activeProfile.paperSize] ?? PAPER_DIMS_MM.a4;
    return {
      widthMm: activeProfile.widthMm || base.widthMm,
      heightMm: activeProfile.heightMm || base.heightMm,
    };
  }, [activeProfile]);

  const print = async () => {
    try {
      const res = await api['print/execute']({
        printerName: activeProfile.printerName || undefined,
        copies: activeProfile.copies,
        landscape: activeProfile.orientation === 'landscape',
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        marginsMm: activeProfile.margins,
        scale: activeProfile.scale,
      });
      if (res.ok || res.cancelled) return;
    } catch {
      /* fall through to the browser-style dialog */
    }
    window.print();
  };

  const savePdf = async () => {
    try {
      const res = await api['print/pdf']({
        suggestedName: (state?.title ?? 'dentiva-document').replace(/[^A-Za-z0-9-_ ]+/g, '').trim() || 'dentiva-document',
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        landscape: activeProfile.orientation === 'landscape',
        marginsMm: activeProfile.margins,
        scale: activeProfile.scale,
      });
      if (res.ok) toast.success('PDF saved', res.path);
      else if (!res.cancelled) toast.error('PDF export failed', res.error);
    } catch (err) {
      toast.error('PDF export failed', err instanceof Error ? err.message : undefined);
    }
  };

  const docClass =
    activeProfile.paperSize === 'thermal'
      ? 'print-doc thermal80'
      : 'print-doc';
  const renderedDoc =
    activeProfile.paperSize === 'thermal' && state?.kind === 'invoice'
      ? thermalInvoiceDoc(state.data)
      : activeProfile.paperSize === 'thermal' && state?.kind === 'receipt'
        ? thermalReceiptDoc(state.data)
        : state?.doc;
  const pageW = activeProfile.orientation === 'landscape' ? dims.heightMm : dims.widthMm;
  const pageH = activeProfile.orientation === 'landscape' ? dims.widthMm : dims.heightMm;
  const profilePrintCss = '@page { size: ' + pageW + 'mm ' + pageH + 'mm; margin: ' +
    activeProfile.margins.top + 'mm ' + activeProfile.margins.right + 'mm ' +
    activeProfile.margins.bottom + 'mm ' + activeProfile.margins.left + 'mm; }';

  return (
    <div className="print-root">
      <style>{profilePrintCss}</style>
      <div className="print-toolbar">
        <div className="row gap-2">
          <Button variant="secondary" size="sm" icon={Icon.chevronL} onClick={async () => { try { await api['print/close'](); } finally { window.close(); } }}>Back</Button>
          <strong>{state?.title ?? 'Print document'}</strong>
        </div>
        <div className="row gap-2">
          <select
            className="select"
            style={{ width: 220, height: 32, fontSize: 12.5 }}
            value={activeProfile.id}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            aria-label="Print profile"
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={() => window.close()}>Close</Button>
          <Button variant="secondary" size="sm" onClick={() => void savePdf()} disabled={loading || !!error}>Save PDF</Button>
          <Button variant="primary" size="sm" icon={Icon.print} onClick={() => void print()} disabled={loading || !!error}>
            Print
          </Button>
        </div>
      </div>
      <div className="print-stage">
        {loading && <Spinner label="Loading document…" />}
        {!loading && error != null && (
          <div className="card card-pad" style={{ width: 560 }}>
            <ErrorState error={error} onRetry={() => { setState(null); setError(null); window.location.reload(); }} />
          </div>
        )}
        {!loading && error == null && <div className={docClass}>{renderedDoc}</div>}
      </div>
    </div>
  );
}
