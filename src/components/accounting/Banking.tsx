import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { amountInWords } from '@/lib/amountInWords';
import { fetchActiveAccounts } from '@/lib/fetchAccounts';
import { useAccountingCompany } from './AccountingCompanyContext';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const esc = (t: string): string =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Banking — Tally's banking utilities: cheque printing and payment advice,
 * using the bank ledgers from the chart and Indian amount-in-words.
 */
const Banking: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const [bankId, setBankId] = useState('');
  const { selectedCompanyId } = useAccountingCompany();
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [chequeNo, setChequeNo] = useState('');
  const [chequeDate, setChequeDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [acPayee, setAcPayee] = useState(true);
  const [narration, setNarration] = useState('');

  const { data: banks = [] } = useQuery({
    queryKey: ['banking_banks', selectedCompanyId],
    enabled: !!selectedCompanyId,
    // Every 112x ledger is shared (company_id IS NULL), so this returns the
    // same banks for every company today. Passed for uniformity, not as a fix.
    queryFn: () => fetchActiveAccounts<Account>({ columns: 'id, account_code, account_name', codePrefixes: ['112'], companyId: selectedCompanyId }),
  });

  const bank = banks.find((b) => b.id === bankId) || null;
  const amt = Number(amount) || 0;

  const openPrint = (title: string, body: string): void => {
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) {
      toast.error('Popup blocked — allow popups to print');
      return;
    }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8" /><title>${esc(title)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 10mm; }
  @page { size: A4 landscape; margin: 8mm; }
</style></head><body>${body}
<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`);
    win.document.close();
  };

  const printCheque = (): void => {
    if (!payee.trim() || amt <= 0) {
      toast.error('Enter the payee and a valid amount');
      return;
    }
    const d = chequeDate.replace(/-/g, '');
    const dateBoxes = `${d.slice(6, 8)}${d.slice(4, 6)}${d.slice(0, 4)}`
      .split('')
      .map(
        (c) =>
          `<span style="display:inline-block;width:7mm;height:8mm;border:1px solid #333;text-align:center;line-height:8mm;margin-left:1mm;font-family:monospace">${c}</span>`,
      )
      .join('');
    const body = `
  <div style="width:202mm;height:92mm;border:1px dashed #999;position:relative;padding:6mm;box-sizing:border-box">
    ${acPayee ? `<div style="position:absolute;left:14mm;top:2mm;transform:rotate(-18deg);border-top:2px solid #000;border-bottom:2px solid #000;padding:1mm 4mm;font-size:11px;font-weight:bold">A/C PAYEE ONLY</div>` : ''}
    <div style="position:absolute;right:6mm;top:5mm">${dateBoxes}</div>
    <div style="margin-top:16mm;font-size:15px">Pay <span style="font-weight:bold;border-bottom:1px solid #333;display:inline-block;min-width:150mm;padding:0 2mm">${esc(payee)}</span></div>
    <div style="margin-top:4mm;font-size:13px">Rupees <span style="border-bottom:1px solid #333;display:inline-block;min-width:130mm;padding:0 2mm;font-style:italic">${esc(amountInWords(amt).replace('Rupees ', ''))}</span>
      <span style="border:1.5px solid #000;padding:2mm 4mm;font-size:16px;font-weight:bold;margin-left:4mm">₹ ${fmt(amt)}</span>
    </div>
    <div style="position:absolute;left:6mm;bottom:8mm;font-size:11px;color:#333">
      ${esc(bank?.account_name ?? '')}${chequeNo ? ` · Cheque No. ${esc(chequeNo)}` : ''}
    </div>
    <div style="position:absolute;right:8mm;bottom:8mm;text-align:center;font-size:11px">
      <div style="border-top:1px solid #333;padding-top:2mm;width:60mm">For ${esc(hospitalConfig.name)} Hospital<br/>Authorised Signatory</div>
    </div>
  </div>
  <div style="margin-top:6mm;font-size:11px;color:#666">Print on the pre-printed cheque leaf; alignment is approximate — adjust printer scaling if needed.</div>`;
    openPrint(`Cheque — ${payee}`, body);
  };

  const printAdvice = (): void => {
    if (!payee.trim() || amt <= 0) {
      toast.error('Enter the payee and a valid amount');
      return;
    }
    const body = `
  <div style="max-width:180mm">
    <div style="text-align:center;font-size:16px;font-weight:bold">${esc(hospitalConfig.name)} Hospital</div>
    <div style="text-align:center;letter-spacing:2px;margin:2mm 0 8mm">PAYMENT ADVICE</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="border:1px solid #444;padding:6px;width:35%;background:#eef">Date</td><td style="border:1px solid #444;padding:6px">${esc(chequeDate)}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Paid to</td><td style="border:1px solid #444;padding:6px;font-weight:bold">${esc(payee)}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Amount</td><td style="border:1px solid #444;padding:6px;font-weight:bold">₹ ${fmt(amt)}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Amount in words</td><td style="border:1px solid #444;padding:6px;font-style:italic">${esc(amountInWords(amt))}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Drawn on</td><td style="border:1px solid #444;padding:6px">${esc(bank?.account_name ?? '-')}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Cheque / Ref No.</td><td style="border:1px solid #444;padding:6px">${esc(chequeNo || '-')}</td></tr>
      <tr><td style="border:1px solid #444;padding:6px;background:#eef">Towards</td><td style="border:1px solid #444;padding:6px">${esc(narration || '-')}</td></tr>
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:24mm;font-size:12px">
      <div style="border-top:1px solid #444;padding-top:2mm;width:50mm;text-align:center">Received By</div>
      <div style="border-top:1px solid #444;padding-top:2mm;width:50mm;text-align:center">Authorised Signatory</div>
    </div>
  </div>`;
    openPrint(`Payment Advice — ${payee}`, body);
  };

  const report = useTallyReport({
    // A cheque form has no amount column to compare, so Tally's column keys
    // do not apply here.
    supportsColumns: false,
    filterFields: ['Payee'],
    views: [
      { label: 'Bank Reconciliation', target: 'bank-reconciliation' },
      { label: 'Cheque Register', target: 'cheque-register' },
      { label: 'Cash/Bank Book', target: 'cash-bank-book' },
      { label: 'Cash/Bank Summary', target: 'cash-bank-summary' },
      { label: 'Bills Payable', target: 'bills-payable' },
    ],
    screenKeys: [
      { hotkey: 'C', label: 'Print Cheque', onClick: printCheque },
      { hotkey: 'V', label: 'Payment Advice', onClick: printAdvice },
    ],
  });

  const field = (label: string, node: React.ReactNode) => (
    <div className="flex items-center gap-2">
      <span className="w-40 shrink-0">{label}</span>
      <span>:</span>
      {node}
    </div>
  );

  return (
    <>
    <TallyScreen title="Banking" rail={report.rail}>
      <div className="px-3 pb-4 pt-2 text-[13px]">
        <div className="mx-auto max-w-2xl space-y-1.5">
          <div className="border-b border-black pb-0.5 font-semibold tracking-[0.2em]">Cheque / Payment Details</div>
          {field(
            'Bank',
            <select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className="w-full max-w-md border-b border-dashed border-gray-400 bg-transparent px-1 font-semibold focus:outline-none"
            >
              <option value="">Select bank ledger…</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.account_name}
                </option>
              ))}
            </select>,
          )}
          {field(
            'Pay to',
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="w-full max-w-md border-b border-dashed border-gray-400 bg-[#fdf6d8] px-1 focus:outline-none"
            />,
          )}
          {field(
            'Amount (₹)',
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-44 border-b border-dashed border-gray-400 bg-transparent px-1 text-right font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />,
          )}
          {amt > 0 && <div className="pl-44 text-[11px] italic text-gray-600">{amountInWords(amt)}</div>}
          {field(
            'Cheque No.',
            <input
              value={chequeNo}
              onChange={(e) => setChequeNo(e.target.value)}
              className="w-44 border-b border-dashed border-gray-400 bg-transparent px-1 font-mono focus:outline-none"
            />,
          )}
          {field(
            'Date',
            <input
              type="date"
              value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)}
              className="w-44 border-b border-dashed border-gray-400 bg-transparent px-1 focus:outline-none"
            />,
          )}
          {field(
            'A/C Payee crossing',
            <button
              type="button"
              onClick={() => setAcPayee((v) => !v)}
              className="min-w-[44px] border-b border-dashed border-gray-400 px-2 text-left font-semibold hover:bg-[#fdf6d8]"
            >
              {acPayee ? 'Yes' : 'No'}
            </button>,
          )}
          {field(
            'Towards (advice)',
            <input
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              className="w-full max-w-md border-b border-dashed border-gray-400 bg-transparent px-1 focus:outline-none"
            />,
          )}

          <div className="flex gap-2 pt-3">
            <button type="button" onClick={printCheque} className="border border-[#9db8d8] bg-white px-3 py-0.5 hover:bg-[#fdf6d8]">
              <span className="font-semibold text-[#1d5aa8]">
                <span className="underline">C</span>:
              </span>{' '}
              Print Cheque
            </button>
            <button type="button" onClick={printAdvice} className="border border-[#9db8d8] bg-white px-3 py-0.5 hover:bg-[#fdf6d8]">
              <span className="font-semibold text-[#1d5aa8]">
                <span className="underline">V</span>:
              </span>{' '}
              Payment Advice
            </button>
          </div>
          <div className="pt-2 text-[11px] italic text-gray-500">
            Record the payment itself as a Payment voucher (F5) — Banking prints the instruments.
          </div>
        </div>
      </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default Banking;
