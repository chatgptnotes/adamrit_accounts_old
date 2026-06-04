/**
 * Prior Visit Drawer — read-only AI summary that opens when a doctor clicks
 * an upcoming consultation.
 *
 * UX rules (per Be AI-First Phase 0):
 *   - Display only. No "act on this" buttons.
 *   - Disclaimer footer always visible.
 *   - The doctor's "I have read this" action is logged to agent_runs.
 *
 * Hidden behind feature flag VITE_BRAIN_CLINICAL_BRIEF.
 */

import { useEffect, useState } from 'react';
import { invokeClinicalPriorVisit, brainFlags, type PriorVisitBrief } from '@/lib/brain';

interface Props {
    patientId: string;
    appointmentId: string;
    open: boolean;
    onClose: () => void;
}

export default function PriorVisitDrawer({ patientId, appointmentId, open, onClose }: Props) {
    const [brief, setBrief] = useState<PriorVisitBrief | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !brainFlags.clinicalBrief) return;
        let cancelled = false;
        async function load() {
            setLoading(true); setError(null); setBrief(null);
            try {
                const b = await invokeClinicalPriorVisit({ patient_id: patientId, appointment_id: appointmentId });
                if (!cancelled) setBrief(b);
            } catch (e) {
                if (!cancelled) setError((e as Error).message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [open, patientId, appointmentId]);

    if (!open) return null;

    if (!brainFlags.clinicalBrief) {
        return <Drawer onClose={onClose}><div className="p-4 text-sm">Clinical brief agent is disabled.</div></Drawer>;
    }

    return (
        <Drawer onClose={onClose}>
            <div className="border-b px-4 py-3">
                <h3 className="font-semibold">Patient prior-visit brief</h3>
                <p className="text-xs text-muted-foreground">Read-only summary · clinician verifies in chart</p>
            </div>

            {loading && <div className="p-6 text-center text-sm text-muted-foreground">Building brief…</div>}
            {error && <div className="m-4 rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            {brief && brief.confidence === 0 && (
                <div className="m-4 rounded border border-amber-500 bg-amber-50 p-4 text-sm dark:bg-amber-950/20">
                    {brief.disclaimer}
                </div>
            )}

            {brief && brief.confidence > 0 && (
                <div className="space-y-5 p-4">
                    <Section title="Timeline (last 5)">
                        <ul className="space-y-1.5 text-sm">
                            {brief.timeline.map((v, i) => (
                                <li key={i} className="flex gap-2">
                                    <span className="font-mono text-xs text-muted-foreground">{v.date}</span>
                                    <span className="font-medium">{v.type}</span>
                                    <span className="text-muted-foreground">· {v.doctor}</span>
                                    <span className="ml-1 flex-1">{v.summary}</span>
                                </li>
                            ))}
                        </ul>
                    </Section>

                    <Section title="Active issues">
                        <ul className="list-disc pl-5 text-sm">{brief.active_issues.map((d, i) => <li key={i}>{d}</li>)}</ul>
                    </Section>

                    <Section title="Active medications">
                        <ul className="list-disc pl-5 text-sm">
                            {brief.medication_list.map((m, i) => (
                                <li key={i}><strong>{m.name}</strong> {m.dose} <span className="text-muted-foreground">since {m.since}</span></li>
                            ))}
                        </ul>
                    </Section>

                    <Section title="New in last 30 days">
                        {brief.new_in_last_30_days.length === 0
                            ? <div className="text-sm text-muted-foreground">No new clinical events in the last 30 days.</div>
                            : <ul className="list-disc pl-5 text-sm">{brief.new_in_last_30_days.map((n, i) => <li key={i}>{n}</li>)}</ul>}
                    </Section>

                    <Section title="3 suggested questions to confirm">
                        <ol className="list-decimal pl-5 text-sm">{brief.suggested_questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
                    </Section>

                    <div className="rounded border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        ⚠ {brief.disclaimer} · Confidence {(brief.confidence * 100).toFixed(0)}%
                    </div>
                </div>
            )}
        </Drawer>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
            {children}
        </div>
    );
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
            <div className="h-full w-full max-w-lg overflow-y-auto bg-background shadow-xl" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
}
