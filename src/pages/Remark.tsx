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

// The two columns a person types into. The remark is editable because the
// portal's wording is often mangled on export and gets tidied or pasted in by
// hand — but note a re-import overwrites it, since the sheet is the authority
// on what ESIC asked. The justification is ours and the import never touches it.
type EditableField = 'l2_remark' | 'justification';

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
  // Which single cell is open for editing. Both text columns share one editor,
  // so only one cell can ever be mid-edit — there is no second draft to lose.
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null);
  const [draft, setDraft] = useState('');

  const { data: rows = [], isLoading, error } = useQuery({
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

  const saveCell = async (row: ClaimRemark, field: EditableField) => {
    const value = draft.trim();
    setEditing(null);
    if (value === (row[field] || '').trim()) return;

    const { error } = await supabase
      .from('esic_claim_remarks' as any)
      .update({ [field]: value || null, updated_at: new Date().toISOString() } as any)
      .eq('id', row.id);
    if (error) {
      console.error(`Failed to save ${field}:`, error);
      toast.error(`Could not save: ${error.message}`);
      return;
    }
    if (field === 'l2_remark' && !value) {
      // Clearing the remark drops the row out of the worklist on the next
      // refetch. Say so, or the claim looks like it was deleted.
      toast.success('Remark cleared — this claim is no longer listed');
    } else {
      toast.success(field === 'l2_remark' ? 'Remark saved' : 'Justification saved');
    }
    queryClient.invalidateQueries({ queryKey: ['esic-claim-remarks', hospitalConfig.name] });
  };

  // One cell renderer for both text columns: click the text to edit it, click
  // away or press Escape to leave. Escape unmounts the textarea before its blur
  // handler can fire, which is what makes it a cancel rather than a save.
  const renderCell = (row: ClaimRemark, field: EditableField, placeholder: string) => {
    if (editing?.id === row.id && editing.field === field) {
      return (
        <Textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => saveCell(row, field)}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(null);
          }}
          className="text-sm"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          setEditing({ id: row.id, field });
          setDraft(row[field] || '');
        }}
        className="w-full text-left text-sm whitespace-pre-wrap rounded px-2 py-1 hover:bg-muted min-h-[2rem]"
        title="Click to edit"
      >
        {row[field] || <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    );
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
            ) : error ? (
              // A failed read and a genuinely empty worklist are not the same
              // thing, and saying "no remarks yet" to both sends someone
              // hunting for missing data when the query is what broke.
              <TableRow>
                <TableCell colSpan={3} className="text-center text-destructive py-8">
                  Could not load remarks: {(error as Error).message}
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
                  <TableCell>{renderCell(row, 'l2_remark', 'Click to add a remark…')}</TableCell>
                  <TableCell>{renderCell(row, 'justification', 'Click to reply…')}</TableCell>
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
