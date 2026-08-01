import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  APPROACH_OPTIONS,
  draftRemarkJustification,
  type JustificationApproach,
} from '@/lib/draftRemarkJustification';
import { printClaimJustification } from '@/lib/printClaimJustification';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClaimPatientMatchCard } from './ClaimPatientMatchCard';
import type { ClaimRemark } from './types';

// Everything about one claim, and the whole answering flow: read the query,
// choose how to answer it, have the justification written, correct it, print it.

type EditableField = 'l2_remark' | 'justification';

const formatAmount = (amount: number | null) =>
  amount == null ? '—' : `₹ ${amount.toLocaleString('en-IN')}`;

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    <div className="text-sm">{value || '—'}</div>
  </div>
);

export const ClaimDetail: React.FC<{ claim: ClaimRemark; onBack: () => void }> = ({
  claim,
  onBack,
}) => {
  const { hospitalConfig } = useAuth();
  const queryClient = useQueryClient();
  const [approach, setApproach] = useState<JustificationApproach | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [doctorName, setDoctorName] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['esic-claim-remarks', hospitalConfig.name] });

  // The signature master, only once a print dialog opens.
  const { data: doctors = [], isLoading: doctorsLoading } = useQuery({
    queryKey: ['justification-signatories'],
    enabled: printOpen,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('doctor_credentials' as any)
        .select('doctor_name, qualification, registration_no, signature_url, stamp_url')
        .eq('is_active', true)
        .order('doctor_name');
      if (error) throw error;
      return (data || []) as unknown as {
        doctor_name: string;
        qualification: string | null;
        registration_no: string | null;
        signature_url: string | null;
        stamp_url: string | null;
      }[];
    },
  });

  const visibleDoctors = doctors.filter(d =>
    d.doctor_name.toLowerCase().includes(doctorSearch.trim().toLowerCase()),
  );

  const saveField = async (field: EditableField, value: string) => {
    const trimmed = value.trim();
    setEditing(null);
    if (trimmed === (claim[field] || '').trim()) return;

    const { error } = await supabase
      .from('esic_claim_remarks' as any)
      .update({ [field]: trimmed || null, updated_at: new Date().toISOString() } as any)
      .eq('id', claim.id);
    if (error) {
      console.error(`Failed to save ${field}:`, error);
      toast.error(`Could not save: ${error.message}`);
      return;
    }
    if (field === 'l2_remark' && !trimmed) {
      // Clearing the remark drops the claim out of the worklist on the next
      // refetch. Say so, or it looks as though the claim was deleted.
      toast.success('Remark cleared — this claim is no longer listed');
    } else {
      toast.success(field === 'l2_remark' ? 'Remark saved' : 'Justification saved');
    }
    refresh();
  };

  // Nothing writes a justification on its own. The approach is a decision about
  // what the hospital is asserting, so a person makes it before anything is
  // written.
  const handleGenerate = async () => {
    if (!approach) {
      toast.error('Choose how to answer first');
      return;
    }
    setGenerating(true);
    try {
      const reply = await draftRemarkJustification(claim.l2_remark || '', approach);
      const { error } = await supabase
        .from('esic_claim_remarks' as any)
        .update({ justification: reply, updated_at: new Date().toISOString() } as any)
        .eq('id', claim.id);
      if (error) throw error;
      toast.success('Justification written — read it before sending');
      refresh();
    } catch (error: any) {
      console.error('Draft failed:', error);
      toast.error(`Could not write the justification: ${error?.message || 'unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  // The seal comes from the hospital_stamps master, where the credentials page
  // uploads it — not from a filename guess.
  const resolveHospitalSeal = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from('hospital_stamps' as any)
      .select('stamp_url')
      .eq('hospital_type', hospitalConfig.name)
      .maybeSingle();
    if (error) {
      console.warn('Could not load the hospital seal:', error.message);
      return null;
    }
    return (data as { stamp_url: string | null } | null)?.stamp_url || null;
  };

  // The printed letterhead sheet in public/. Checked to exist so a hospital
  // without artwork gets a typed header rather than a broken image.
  const resolveLetterhead = async (): Promise<string | null> => {
    const url = `${window.location.origin}/${hospitalConfig.name}-letterhead.png`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok ? url : null;
    } catch {
      return null;
    }
  };

  const handlePrint = async () => {
    const picked = doctors.find(d => d.doctor_name === doctorName);
    const [letterheadUrl, hospitalSealUrl] = await Promise.all([
      resolveLetterhead(),
      resolveHospitalSeal(),
    ]);
    try {
      printClaimJustification(claim, {
        hospitalName: hospitalConfig.fullName,
        hospitalAddress: hospitalConfig.contactInfo.address,
        letterheadUrl,
        hospitalSealUrl,
        doctor: picked
          ? {
              name: picked.doctor_name,
              qualification: picked.qualification,
              registrationNo: picked.registration_no,
              signatureUrl: picked.signature_url,
              stampUrl: picked.stamp_url,
            }
          : null,
      });
      setPrintOpen(false);
    } catch (error: any) {
      toast.error(error?.message || 'Could not open the print window');
    }
  };

  // Click the text to edit it; blur saves, Escape cancels — Escape unmounts the
  // textarea before its blur handler can fire, which is what makes it a cancel.
  const editableText = (field: EditableField, placeholder: string) => {
    if (editing === field) {
      return (
        <Textarea
          autoFocus
          rows={field === 'l2_remark' ? 3 : 6}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => saveField(field, draft)}
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
          setEditing(field);
          setDraft(claim[field] || '');
        }}
        className="w-full whitespace-pre-wrap rounded border border-transparent px-2 py-1 text-left text-sm hover:border-border hover:bg-muted"
        title="Click to edit"
      >
        {claim[field] || <span className="text-muted-foreground">{placeholder}</span>}
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        All patients
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{claim.patient_name || 'Unnamed patient'}</h1>
        <p className="text-sm text-muted-foreground">Claim {claim.claim_id}</p>
      </div>

      <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-3">
        <Field label="Claim ID" value={claim.claim_id} />
        <Field label="UHID" value={claim.uhid} />
        <Field label="Card ID" value={claim.card_id} />
        <Field label="In / OPD" value={claim.admission_type} />
        <Field label="Process stage" value={claim.process_stage} />
        <Field label="Approved amount" value={formatAmount(claim.approved_amount)} />
        <div className="sm:col-span-3">
          <Field label="Hospital" value={claim.hospital} />
        </div>
      </div>

      <ClaimPatientMatchCard uhid={claim.uhid} patientName={claim.patient_name} />

      <div>
        <h2 className="mb-1 text-sm font-semibold">Remark raised by the scrutinizer</h2>
        {editableText('l2_remark', 'No remark')}
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold">How should we answer?</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {APPROACH_OPTIONS.map(option => {
            const selected = approach === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setApproach(option.id)}
                className={`rounded-md border p-3 text-left transition-colors ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/40 hover:bg-muted/50'
                }`}
              >
                <div className="text-sm font-medium">{option.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
              </button>
            );
          })}
        </div>
        <Button
          className="mt-3"
          disabled={!approach || generating || !(claim.l2_remark || '').trim()}
          onClick={handleGenerate}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {generating
            ? 'Writing…'
            : claim.justification
              ? 'Rewrite the justification'
              : 'Write the justification'}
        </Button>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Justification</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={!(claim.justification || '').trim()}
            onClick={() => {
              setPrintOpen(true);
              setDoctorName('');
              setDoctorSearch('');
            }}
          >
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
        {editableText('justification', 'Nothing written yet — choose an approach above, or click here to type it.')}
      </div>

      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Print justification</DialogTitle>
            <DialogDescription>
              {claim.patient_name || 'This claim'} — claim {claim.claim_id}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>Doctor's signature</Label>
            <Input
              placeholder="Search the doctor master…"
              value={doctorSearch}
              onChange={e => setDoctorSearch(e.target.value)}
            />
            <div className="max-h-60 divide-y overflow-y-auto rounded-md border">
              {doctorsLoading ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
              ) : visibleDoctors.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No doctor matches that name.
                </div>
              ) : (
                visibleDoctors.map(d => (
                  <button
                    key={d.doctor_name}
                    type="button"
                    onClick={() => setDoctorName(d.doctor_name)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${
                      doctorName === d.doctor_name ? 'bg-muted font-medium' : ''
                    }`}
                  >
                    {d.signature_url ? (
                      <img src={d.signature_url} alt="" className="h-10 w-20 shrink-0 object-contain" />
                    ) : (
                      <div className="flex h-10 w-20 shrink-0 items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground">
                        none
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate">{d.doctor_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.signature_url ? 'Signature on file' : 'No signature — prints a ruled space to sign'}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The doctor's signature prints only where a scan exists; their stamp goes on by
              hand. The hospital seal prints from the credentials master.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintOpen(false)}>Cancel</Button>
            <Button onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
