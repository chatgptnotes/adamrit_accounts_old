import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from 'use-debounce';
import { ChevronRight, MessageSquare, Search, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClaimDetail } from '@/components/remark/ClaimDetail';
import { CLAIM_COLUMNS, type ClaimRemark } from '@/components/remark/types';

// Excel headers drift between exports — "Card Id" one week, "Card ID" the next,
// with stray spaces. Matching on a stripped-down key means a header only has to
// be recognisable, not identical.
const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const readRow = (row: Record<string, unknown>) => {
  const byKey = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => byKey.set(normalizeKey(key), value));
  return (...keys: string[]) => {
    for (const key of keys) {
      const value = byKey.get(key);
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
    return null;
  };
};

const Remark = () => {
  const { hospitalConfig } = useAuth();
  const queryClient = useQueryClient();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 250);
  // The claim being worked on. Held by id, not by object, so the detail view
  // re-reads from the list after a save instead of showing a stale copy.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['esic-claim-remarks', hospitalConfig.name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('esic_claim_remarks' as any)
        .select(CLAIM_COLUMNS)
        .eq('hospital_name', hospitalConfig.name)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ClaimRemark[];
    },
  });

  // A claim with no remark has nothing to answer, so it stays out of the
  // worklist. It is still stored — if a later export fills the remark in, the
  // claim appears on its own.
  const openRemarks = rows.filter(row => (row.l2_remark || '').trim() !== '');

  const term = debouncedSearch.trim().toLowerCase();
  const visible = term
    ? openRemarks.filter(row =>
        `${row.patient_name || ''} ${row.claim_id} ${row.uhid || ''} ${row.card_id || ''}`
          .toLowerCase()
          .includes(term),
      )
    : openRemarks;

  const selected = selectedId ? rows.find(row => row.id === selectedId) || null : null;

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      const records = parsed
        .map(row => {
          const get = readRow(row);
          const claimId = get('claimid');
          if (!claimId) return null;
          const amount = get('approvedamount');
          return {
            hospital_name: hospitalConfig.name,
            claim_id: claimId,
            hospital: get('hospital'),
            card_id: get('cardid'),
            uhid: get('uhidno', 'uhid'),
            beneficiary_name: get('nameofbeneficiary', 'beneficiaryname'),
            patient_name: get('patientname'),
            admission_type: get('inopd'),
            process_stage: get('processstage'),
            approved_amount: amount && !Number.isNaN(Number(amount)) ? Number(amount) : null,
            l2_remark: get('l2remark', 'remark'),
            // justification is deliberately absent: an upsert only touches the
            // columns it is given, so replies written here survive a re-import.
          };
        })
        .filter(Boolean);

      if (records.length === 0) {
        toast.error('No rows with a Claim ID were found in that file');
        return;
      }

      // The portal's export repeats a claim on more than one line. Postgres
      // refuses an upsert whose batch names the same conflict key twice — "ON
      // CONFLICT DO UPDATE command cannot affect row a second time" — and that
      // rejects the whole file, not the offending rows. Collapse them here,
      // keeping the last line for each claim, which is the one the sheet ends
      // up asserting.
      const byClaim = new Map<string, (typeof records)[number]>();
      records.forEach(record => byClaim.set(record!.claim_id, record));
      const unique = Array.from(byClaim.values());
      const collapsed = records.length - unique.length;

      const { error } = await supabase
        .from('esic_claim_remarks' as any)
        .upsert(unique as any, { onConflict: 'hospital_name,claim_id' });
      if (error) throw error;

      toast.success(
        `Imported ${unique.length} claim${unique.length === 1 ? '' : 's'}` +
          (collapsed > 0 ? ` — ${collapsed} repeated line${collapsed === 1 ? '' : 's'} collapsed` : ''),
      );
      queryClient.invalidateQueries({ queryKey: ['esic-claim-remarks', hospitalConfig.name] });
    } catch (error: any) {
      console.error('Remark import failed:', error);
      toast.error(`Import failed: ${error?.message || 'unknown error'}`);
    } finally {
      setImporting(false);
    }
  };

  if (selected) {
    return (
      <div className="p-4 md:p-6">
        <ClaimDetail claim={selected} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Remark</h1>
        </div>
        <div>
          <input
            ref={importInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleImport}
            className="hidden"
          />
          <Button variant="outline" disabled={importing} onClick={() => importInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {importing ? 'Importing…' : 'Import Excel'}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by patient name, claim ID, UHID or card ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border divide-y">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          // A failed read and an empty worklist are not the same thing, and
          // saying "no remarks" to both sends someone hunting for missing data
          // when the query is what broke.
          <div className="py-10 text-center text-sm text-destructive">
            Could not load remarks: {(error as Error).message}
          </div>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {openRemarks.length === 0
              ? 'No remarks yet. Import the ESIC scrutiny sheet to get started.'
              : `No claim matches "${search.trim()}".`}
          </div>
        ) : (
          visible.map(row => {
            const answered = (row.justification || '').trim() !== '';
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{row.patient_name || 'Unnamed patient'}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    Claim {row.claim_id}
                    {row.uhid ? ` · ${row.uhid}` : ''}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    answered
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'
                  }`}
                >
                  {answered ? 'Answered' : 'Needs a reply'}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })
        )}
      </div>

      {!isLoading && !error && openRemarks.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {visible.length} of {openRemarks.length} claims carrying a scrutiny remark.
          Claims with no remark are stored but not listed.
        </p>
      )}
    </div>
  );
};

export default Remark;
