/**
 * Pre-Visit Draft Dialog — front-desk reviews + edits + approves the SMS / email
 * draft before it's sent. Phase 0: every send needs human approval.
 *
 * Hidden behind feature flag VITE_BRAIN_PATIENT_PREVISIT.
 */

import { useEffect, useState } from 'react';
import { invokePatientPreVisit, brainFlags, type PreVisitDraft } from '@/lib/brain';

interface Props {
    appointmentId: string;
    open: boolean;
    onClose: () => void;
    onApproved?: (draft: PreVisitDraft) => void;
}

export default function PreVisitDraftDialog({ appointmentId, open, onClose, onApproved }: Props) {
    const [draft, setDraft] = useState<PreVisitDraft | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [smsEdited, setSmsEdited] = useState('');
    const [emailEdited, setEmailEdited] = useState('');

    useEffect(() => {
        if (!open || !brainFlags.patientPrevisit) return;
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null);
            try {
                const r = await invokePatientPreVisit({ appointment_id: appointmentId });
                if (cancelled) return;
                setDraft(r); setSmsEdited(r.sms); setEmailEdited(r.email_body);
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [open, appointmentId]);

    if (!open) return null;
    if (!brainFlags.patientPrevisit) {
        return (
            <DialogShell onClose={onClose}>
                <p className="p-4 text-sm">Pre-visit agent is disabled.</p>
            </DialogShell>
        );
    }

    return (
        <DialogShell onClose={onClose}>
            <div className="border-b px-4 py-3">
                <h3 className="font-semibold">Pre-visit instructions — review before send</h3>
                <p className="text-xs text-muted-foreground">{draft?.disclaimer ?? 'AI-generated draft.'}</p>
            </div>

            {loading && <div className="p-6 text-center text-sm text-muted-foreground">Drafting…</div>}
            {error && <div className="m-4 rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            {draft && (
                <div className="space-y-4 p-4">
                    <div>
                        <label className="text-xs font-medium">SMS ({smsEdited.length}/320)</label>
                        <textarea
                            value={smsEdited}
                            onChange={e => setSmsEdited(e.target.value.slice(0, 320))}
                            rows={3}
                            className="mt-1 w-full rounded border p-2 text-sm"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium">Email subject</label>
                        <input value={draft.email_subject} readOnly className="mt-1 w-full rounded border bg-muted/30 p-2 text-sm" />
                    </div>
                    <div>
                        <label className="text-xs font-medium">Email body</label>
                        <textarea
                            value={emailEdited}
                            onChange={e => setEmailEdited(e.target.value)}
                            rows={12}
                            className="mt-1 w-full rounded border p-2 text-sm font-mono"
                        />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Language: {draft.language} · Confidence: {(draft.confidence * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-end gap-2 border-t pt-3">
                        <button onClick={onClose} className="rounded border px-4 py-2 text-sm">Cancel</button>
                        <button
                            onClick={() => onApproved?.({ ...draft, sms: smsEdited, email_body: emailEdited })}
                            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
                        >
                            Approve &amp; send
                        </button>
                    </div>
                </div>
            )}
        </DialogShell>
    );
}

function DialogShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div className="w-full max-w-xl rounded-lg bg-background shadow-xl" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}
