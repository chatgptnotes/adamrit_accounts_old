import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TallyScreen } from './tally/TallyChrome';
import { useTallyReport } from './tally/useTallyReport';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Download, Upload, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const escapeXml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// ledgers.nature has a legacy CHECK constraint allowing only 'Dr'/'Cr'
const toDrCr = (nature: string | null | undefined): string | null =>
  nature === 'Debit' || nature === 'Dr' ? 'Dr' : nature === 'Credit' || nature === 'Cr' ? 'Cr' : null;

const codeFromName = (name: string): string =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

const downloadFile = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// Tally voucher-type names for this app's voucher categories.
const TALLY_VCH_TYPE: Record<string, string> = {
  PAYMENT: 'Payment',
  RECEIPT: 'Receipt',
  CONTRA: 'Contra',
  JOURNAL: 'Journal',
  SALES: 'Sales',
  PURCHASE: 'Purchase',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
};

// Tally import date format: YYYYMMDD
const tallyDate = (iso: string): string => iso.replace(/-/g, '');

interface ParsedGroup {
  name: string;
  parent: string;
}
interface ParsedLedger {
  name: string;
  parent: string;
  opening: number;
}

// Extract <NAME> from a Tally master element (attribute or child tag).
const masterName = (el: Element): string =>
  el.getAttribute('NAME') || el.getElementsByTagName('NAME')[0]?.textContent?.trim() || '';

const childText = (el: Element, tag: string): string =>
  el.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

// Parse a Tally masters XML export into groups + ledgers.
const parseTallyMastersXml = (xml: string): { groups: ParsedGroup[]; ledgers: ParsedLedger[] } => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Not a valid XML file');
  }
  const groups: ParsedGroup[] = [];
  for (const el of Array.from(doc.getElementsByTagName('GROUP'))) {
    const name = masterName(el);
    if (name) groups.push({ name, parent: childText(el, 'PARENT') });
  }
  const ledgers: ParsedLedger[] = [];
  for (const el of Array.from(doc.getElementsByTagName('LEDGER'))) {
    const name = masterName(el);
    if (!name) continue;
    const opening = parseFloat(childText(el, 'OPENINGBALANCE')) || 0;
    ledgers.push({ name, parent: childText(el, 'PARENT'), opening });
  }
  return { groups, ledgers };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TallyImportExport: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [parsed, setParsed] = useState<{ groups: ParsedGroup[]; ledgers: ParsedLedger[]; fileName: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportingMasters, setExportingMasters] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [exportingVouchers, setExportingVouchers] = useState(false);

  const report = useTallyReport({
    from: today,
    to: today,
    // A transfer utility has no report columns to compare
    supportsColumns: false,
    filterFields: ['Particulars'],
    views: [
      { label: 'Tally Live (Gateway)', target: 'tally-live' },
      { label: 'Chart of Accounts', target: 'chart-of-accounts' },
      { label: 'Day Book', target: 'day-book' },
      { label: 'Statistics', target: 'statistics' },
    ],
  });

  // ------ Masters: Tally XML file → preview ------
  const handleFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const result = parseTallyMastersXml(text);
      if (result.groups.length === 0 && result.ledgers.length === 0) {
        toast.error('No GROUP or LEDGER masters found in this file. Export masters from Tally as XML.');
        return;
      }
      setParsed({ ...result, fileName: file.name });
    } catch (err: any) {
      console.error('Failed to parse Tally XML:', err);
      toast.error(err?.message || 'Could not read this file');
    }
  };

  // ------ Masters: preview → database ------
  const runImport = async (): Promise<void> => {
    if (!parsed) return;
    setImporting(true);
    try {
      // Existing groups (name → row) for dedupe + parent resolution
      const { data: existingGroups, error: gErr } = await (supabase as any)
        .from('ledger_groups')
        .select('id, name, group_type, nature');
      if (gErr) throw gErr;
      const groupByName = new Map<string, { id: string; group_type: string; nature: string | null }>(
        (existingGroups ?? []).map((g: any) => [g.name.toLowerCase(), g]),
      );

      // Insert new groups, resolving parents in passes (parents may appear later in the file).
      let pendingGroups = parsed.groups.filter((g) => !groupByName.has(g.name.toLowerCase()));
      // De-duplicate within the file itself
      pendingGroups = pendingGroups.filter(
        (g, i) => pendingGroups.findIndex((o) => o.name.toLowerCase() === g.name.toLowerCase()) === i,
      );
      let insertedGroups = 0;
      let unresolvedParents = 0;
      for (let pass = 0; pass < 10 && pendingGroups.length > 0; pass++) {
        const ready = pendingGroups.filter((g) => !g.parent || groupByName.has(g.parent.toLowerCase()));
        const batch = ready.length > 0 ? ready : pendingGroups; // final pass: force with defaults
        if (ready.length === 0) unresolvedParents += batch.length;
        for (const g of batch) {
          const parent = g.parent ? groupByName.get(g.parent.toLowerCase()) : undefined;
          const { data, error } = await (supabase as any)
            .from('ledger_groups')
            .insert({
              name: g.name,
              parent_group_id: parent?.id ?? null,
              group_type: parent?.group_type ?? 'Assets',
              nature: parent?.nature ?? 'Debit',
              is_predefined: false,
            })
            .select('id, group_type, nature')
            .single();
          if (error) {
            if (error.code === '23505') continue; // raced/duplicate — treat as existing
            throw error;
          }
          groupByName.set(g.name.toLowerCase(), data);
          insertedGroups++;
        }
        const batchNames = new Set(batch.map((b) => b.name.toLowerCase()));
        pendingGroups = pendingGroups.filter((g) => !batchNames.has(g.name.toLowerCase()));
      }

      // Existing ledgers for dedupe
      const { data: existingLedgers, error: lErr } = await (supabase as any).from('ledgers').select('name');
      if (lErr) throw lErr;
      const ledgerNames = new Set((existingLedgers ?? []).map((l: any) => l.name.toLowerCase()));

      let insertedLedgers = 0;
      let skippedLedgers = 0;
      const newLedgers = parsed.ledgers.filter((l) => {
        if (ledgerNames.has(l.name.toLowerCase())) {
          skippedLedgers++;
          return false;
        }
        ledgerNames.add(l.name.toLowerCase());
        return true;
      });
      // Chunked inserts
      for (let i = 0; i < newLedgers.length; i += 200) {
        const chunk = newLedgers.slice(i, i + 200).map((l) => {
          const group = groupByName.get(l.parent.toLowerCase());
          return {
            code: codeFromName(l.name) || `L_${i}`,
            name: l.name,
            group_id: (group as any)?.id ?? null,
            group_name: l.parent || null,
            nature: toDrCr((group as any)?.nature),
            opening_balance: l.opening,
            current_balance: l.opening,
            is_active: true,
          };
        });
        const { error } = await (supabase as any).from('ledgers').insert(chunk);
        if (error) throw error;
        insertedLedgers += chunk.length;
      }

      queryClient.invalidateQueries({ queryKey: ['ledger_groups'] });
      queryClient.invalidateQueries({ queryKey: ['ledgers_master'] });
      toast.success(
        `Imported ${insertedGroups} groups and ${insertedLedgers} ledgers` +
          (skippedLedgers ? ` (${skippedLedgers} ledgers already existed)` : '') +
          (unresolvedParents ? ` — ${unresolvedParents} groups had unknown parents` : ''),
      );
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      console.error('Tally masters import failed:', err);
      toast.error('Import failed — please try again');
    } finally {
      setImporting(false);
    }
  };

  // ------ Masters: Adamrit → Tally XML file ------
  const exportMasters = async (): Promise<void> => {
    setExportingMasters(true);
    try {
      const [{ data: groups, error: gErr }, { data: ledgers, error: lErr }] = await Promise.all([
        (supabase as any).from('ledger_groups').select('name, parent_group_id, is_predefined, id').order('name'),
        (supabase as any).from('ledgers').select('name, group_name, opening_balance').eq('is_active', true).order('name'),
      ]);
      if (gErr) throw gErr;
      if (lErr) throw lErr;
      const nameById = new Map<string, string>((groups ?? []).map((g: any) => [g.id, g.name]));
      // Tally already has its predefined groups — export only custom ones.
      const customGroups = (groups ?? []).filter((g: any) => !g.is_predefined);

      const messages: string[] = [];
      for (const g of customGroups) {
        const parent = g.parent_group_id ? nameById.get(g.parent_group_id) ?? '' : '';
        messages.push(
          `  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n` +
            `   <GROUP NAME="${escapeXml(g.name)}" ACTION="Create">\n` +
            `    <NAME>${escapeXml(g.name)}</NAME>\n` +
            (parent ? `    <PARENT>${escapeXml(parent)}</PARENT>\n` : '') +
            `   </GROUP>\n` +
            `  </TALLYMESSAGE>`,
        );
      }
      for (const l of ledgers ?? []) {
        messages.push(
          `  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n` +
            `   <LEDGER NAME="${escapeXml(l.name)}" ACTION="Create">\n` +
            `    <NAME>${escapeXml(l.name)}</NAME>\n` +
            (l.group_name ? `    <PARENT>${escapeXml(l.group_name)}</PARENT>\n` : '') +
            `    <OPENINGBALANCE>${Number(l.opening_balance) || 0}</OPENINGBALANCE>\n` +
            `   </LEDGER>\n` +
            `  </TALLYMESSAGE>`,
        );
      }
      if (messages.length === 0) {
        toast.info('Nothing to export — no custom groups or ledgers yet');
        return;
      }
      const xml =
        `<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n` +
        `   <REQUESTDESC>\n    <REPORTNAME>All Masters</REPORTNAME>\n   </REQUESTDESC>\n   <REQUESTDATA>\n` +
        messages.join('\n') +
        `\n   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n`;
      downloadFile(`adamrit-masters-${today}.xml`, xml);
      toast.success(`Downloaded ${customGroups.length} groups and ${(ledgers ?? []).length} ledgers for Tally import`);
    } catch (err) {
      console.error('Masters export failed:', err);
      toast.error('Export failed — please try again');
    } finally {
      setExportingMasters(false);
    }
  };

  // ------ Transactions: Adamrit → Tally XML file ------
  const exportVouchers = async (): Promise<void> => {
    setExportingVouchers(true);
    try {
      const messages: string[] = [];

      // 1. Accounting module vouchers (posted) with entries + account names
      const { data: vouchers, error: vErr } = await (supabase as any)
        .from('vouchers')
        .select(
          'voucher_number, voucher_date, narration, status, voucher_types(voucher_category), voucher_entries(debit_amount, credit_amount, entry_order, chart_of_accounts(account_name))',
        )
        .eq('status', 'AUTHORISED')
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date');
      if (vErr) throw vErr;

      for (const v of vouchers ?? []) {
        const category = (v.voucher_types?.voucher_category || 'JOURNAL').toUpperCase();
        const vchType = TALLY_VCH_TYPE[category] || 'Journal';
        const entries = [...(v.voucher_entries ?? [])].sort(
          (a: any, b: any) => (a.entry_order || 0) - (b.entry_order || 0),
        );
        const entryXml = entries
          .map((e: any) => {
            const name = e.chart_of_accounts?.account_name || '';
            const debit = Number(e.debit_amount) || 0;
            const credit = Number(e.credit_amount) || 0;
            const isDebit = debit > 0;
            const amount = isDebit ? -debit : credit; // Tally: debit negative, credit positive
            return (
              `    <ALLLEDGERENTRIES.LIST>\n` +
              `     <LEDGERNAME>${escapeXml(name)}</LEDGERNAME>\n` +
              `     <ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>\n` +
              `     <AMOUNT>${amount.toFixed(2)}</AMOUNT>\n` +
              `    </ALLLEDGERENTRIES.LIST>`
            );
          })
          .join('\n');
        messages.push(
          `  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n` +
            `   <VOUCHER VCHTYPE="${escapeXml(vchType)}" ACTION="Create">\n` +
            `    <DATE>${tallyDate(v.voucher_date)}</DATE>\n` +
            `    <VOUCHERTYPENAME>${escapeXml(vchType)}</VOUCHERTYPENAME>\n` +
            `    <VOUCHERNUMBER>${escapeXml(v.voucher_number)}</VOUCHERNUMBER>\n` +
            `    <NARRATION>${escapeXml(v.narration || '')}</NARRATION>\n` +
            entryXml +
            `\n   </VOUCHER>\n` +
            `  </TALLYMESSAGE>`,
        );
      }

      // 2. Standalone payment vouchers (+ their particulars lines)
      const { data: pvs, error: pErr } = await (supabase as any)
        .from('payment_vouchers')
        .select('id, voucher_no, voucher_date, person_name, amount, purpose, narration, account_ledger_name, payment_voucher_lines(ledger_name, amount, line_order)')
        .eq('hospital_type', hospitalConfig.name)
        .gte('voucher_date', fromDate)
        .lte('voucher_date', toDate)
        .order('voucher_date');
      if (pErr) throw pErr;

      for (const v of pvs ?? []) {
        const account = v.account_ledger_name || 'Cash';
        const lines: any[] =
          v.payment_voucher_lines?.length > 0
            ? [...v.payment_voucher_lines].sort((a: any, b: any) => (a.line_order || 0) - (b.line_order || 0))
            : [{ ledger_name: v.person_name, amount: v.amount }];
        const entryXml = [
          ...lines.map(
            (l: any) =>
              `    <ALLLEDGERENTRIES.LIST>\n` +
              `     <LEDGERNAME>${escapeXml(l.ledger_name)}</LEDGERNAME>\n` +
              `     <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>\n` +
              `     <AMOUNT>${(-(Number(l.amount) || 0)).toFixed(2)}</AMOUNT>\n` +
              `    </ALLLEDGERENTRIES.LIST>`,
          ),
          `    <ALLLEDGERENTRIES.LIST>\n` +
            `     <LEDGERNAME>${escapeXml(account)}</LEDGERNAME>\n` +
            `     <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>\n` +
            `     <AMOUNT>${(Number(v.amount) || 0).toFixed(2)}</AMOUNT>\n` +
            `    </ALLLEDGERENTRIES.LIST>`,
        ].join('\n');
        messages.push(
          `  <TALLYMESSAGE xmlns:UDF="TallyUDF">\n` +
            `   <VOUCHER VCHTYPE="Payment" ACTION="Create">\n` +
            `    <DATE>${tallyDate(v.voucher_date)}</DATE>\n` +
            `    <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>\n` +
            `    <VOUCHERNUMBER>${escapeXml(v.voucher_no)}</VOUCHERNUMBER>\n` +
            `    <NARRATION>${escapeXml(v.narration || v.purpose || '')}</NARRATION>\n` +
            entryXml +
            `\n   </VOUCHER>\n` +
            `  </TALLYMESSAGE>`,
        );
      }

      if (messages.length === 0) {
        toast.info('No vouchers found in this date range');
        return;
      }
      const xml =
        `<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n` +
        `   <REQUESTDESC>\n    <REPORTNAME>Vouchers</REPORTNAME>\n   </REQUESTDESC>\n   <REQUESTDATA>\n` +
        messages.join('\n') +
        `\n   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>\n`;
      downloadFile(`adamrit-vouchers-${fromDate}${fromDate !== toDate ? `-to-${toDate}` : ''}.xml`, xml);
      toast.success(`Downloaded ${messages.length} voucher(s) for Tally import`);
    } catch (err) {
      console.error('Voucher export failed:', err);
      toast.error('Export failed — please try again');
    } finally {
      setExportingVouchers(false);
    }
  };

  return (
    <>
    <TallyScreen title="Import / Export — Tally Data" rail={report.rail}>
    <div className="p-2">
    <div className="space-y-6">
      {/* ----- Masters ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">
          Masters — Groups &amp; Ledgers
        </div>
        <div className="grid grid-cols-1 divide-y bg-[#fffefb] md:grid-cols-2 md:divide-x md:divide-y-0">
          {/* Import */}
          <div className="p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Upload className="h-4 w-4 text-blue-700" /> Import from Tally → Adamrit
            </div>
            <p className="mb-3 text-xs text-gray-500">
              In Tally: <b>Gateway of Tally → Display More Reports → List of Accounts → Export (Alt+E)</b>, choose{' '}
              <b>XML</b> format, then upload the file here. New groups and ledgers are added; existing names are
              skipped.
            </p>
            <Input
              ref={fileRef}
              type="file"
              accept=".xml,text/xml"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
              className="max-w-sm text-xs"
            />
            {parsed && (
              <div className="mt-3 rounded border bg-[#eef3fa] p-3 text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-blue-700" />
                  <span className="font-medium">{parsed.fileName}</span>
                </div>
                <div className="text-xs text-gray-600">
                  Found <b>{parsed.groups.length}</b> groups and <b>{parsed.ledgers.length}</b> ledgers.
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="h-7 bg-[#16437e] text-xs hover:bg-[#0f3363]" onClick={runImport} disabled={importing}>
                    {importing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Import into Adamrit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={importing}
                    onClick={() => {
                      setParsed(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
          {/* Export */}
          <div className="p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Download className="h-4 w-4 text-blue-700" /> Export from Adamrit → Tally
            </div>
            <p className="mb-3 text-xs text-gray-500">
              Downloads your custom groups and all active ledgers as a Tally XML file. In Tally:{' '}
              <b>Gateway of Tally → Import Data → Masters</b> and select the file.
            </p>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportMasters} disabled={exportingMasters}>
              {exportingMasters ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
              Download Masters XML
            </Button>
          </div>
        </div>
      </div>

      {/* ----- Transactions ----- */}
      <div className="overflow-hidden rounded-md border shadow-sm">
        <div className="bg-[#16437e] px-3 py-1.5 text-sm font-semibold text-white">Transactions — Vouchers</div>
        <div className="bg-[#fffefb] p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            <Download className="h-4 w-4 text-blue-700" /> Export from Adamrit → Tally
          </div>
          <p className="mb-3 text-xs text-gray-500">
            Downloads posted accounting vouchers and payment vouchers in the date range as one Tally XML file. In
            Tally: <b>Gateway of Tally → Import Data → Vouchers</b> and select the file. Ledger names must already
            exist in Tally (import masters first if needed).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="tx-from" className="text-xs">From</Label>
              <Input id="tx-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-40 text-xs" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tx-to" className="text-xs">To</Label>
              <Input id="tx-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-40 text-xs" />
            </div>
            <Button size="sm" className="h-8 bg-[#16437e] text-xs hover:bg-[#0f3363]" onClick={exportVouchers} disabled={exportingVouchers}>
              {exportingVouchers ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
              Download Vouchers XML
            </Button>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            To bring Tally's day book into Adamrit, use the live sync on the <b>Tally Integration</b> page (requires
            the Tally gateway to be reachable).
          </p>
        </div>
      </div>
    </div>
    </div>
    </TallyScreen>

    {report.popups}
    </>
  );
};

export default TallyImportExport;
