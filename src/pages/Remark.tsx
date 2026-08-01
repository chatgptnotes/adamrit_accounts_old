import React, { useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// The ESIC portal's scrutiny export, reduced to the three things a person
// actually works with: who the patient is, what ESIC asked for, and what we
// answered. Everything else the sheet carries is stored but not shown.
interface ClaimRemark {
  id: string;
  claim_id: string;
  patient_name: string | null;
  l2_remark: string | null;
  justification: string | null;
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['esic-claim-remarks', hospitalConfig.name],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('esic_claim_remarks' as any)
        .select('id, claim_id, patient_name, l2_remark, justification')
        .eq('hospital_name', hospitalConfig.name)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ClaimRemark[];
    },
  });

  // A claim with no remark has nothing to answer, so it stays out of the
  // worklist. It is still stored — if a later export fills the remark in, the
  // row appears on its own.
  const openRemarks = rows.filter(row => (row.l2_remark || '').trim() !== '');

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
            // columns it is given, so replies typed here survive a re-import.
          };
        })
        .filter(Boolean);

      if (records.length === 0) {
        toast.error('No rows with a Claim ID were found in that file');
        return;
      }

      const { error } = await supabase
        .from('esic_claim_remarks' as any)
        .upsert(records as any, { onConflict: 'hospital_name,claim_id' });
      if (error) throw error;

      toast.success(`Imported ${records.length} claim${records.length === 1 ? '' : 's'}`);
      queryClient.invalidateQueries({ queryKey: ['esic-claim-remarks', hospitalConfig.name] });
    } catch (error: any) {
      console.error('Remark import failed:', error);
      toast.error(`Import failed: ${error?.message || 'unknown error'}`);
    } finally {
      setImporting(false);
    }
  };

  const saveJustification = async (row: ClaimRemark) => {
    const value = draft.trim();
    setEditingId(null);
    if (value === (row.justification || '').trim()) return;

    const { error } = await supabase
      .from('esic_claim_remarks' as any)
      .update({ justification: value || null, updated_at: new Date().toISOString() } as any)
      .eq('id', row.id);
    if (error) {
      console.error('Failed to save justification:', error);
      toast.error(`Could not save: ${error.message}`);
      return;
    }
    toast.success('Justification saved');
    queryClient.invalidateQueries({ queryKey: ['esic-claim-remarks', hospitalConfig.name] });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
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
            <Upload className="h-4 w-4 mr-2" />
            {importing ? 'Importing…' : 'Import Excel'}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Claims carrying an ESIC scrutiny remark. Re-importing the sheet refreshes the
        remarks and keeps every justification already written here.
      </p>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[220px]">Patient Name</TableHead>
              <TableHead>Remark</TableHead>
              <TableHead className="w-[32%]">Justification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : openRemarks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                  No remarks yet. Import the ESIC scrutiny sheet to get started.
                </TableCell>
              </TableRow>
            ) : (
              openRemarks.map(row => (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="font-medium">{row.patient_name || '—'}</TableCell>
                  <TableCell className="text-sm whitespace-pre-wrap">{row.l2_remark}</TableCell>
                  <TableCell>
                    {editingId === row.id ? (
                      <Textarea
                        autoFocus
                        rows={3}
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => saveJustification(row)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="text-sm"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(row.id);
                          setDraft(row.justification || '');
                        }}
                        className="w-full text-left text-sm whitespace-pre-wrap rounded px-2 py-1 hover:bg-muted min-h-[2rem]"
                        title="Click to write a justification"
                      >
                        {row.justification || <span className="text-muted-foreground">Click to reply…</span>}
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default Remark;
