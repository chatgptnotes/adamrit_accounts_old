/**
 * Pharmacy Reorder Panel — shows the AI-generated reorder suggestions.
 *
 * UX rules (per Be AI-First Phase 0 — until trust ≥ 9/10):
 *   - Pharmacist must explicitly approve each item before any PO is created.
 *   - Show the math (on-hand, daily sales, days of cover, lead time).
 *   - Schedule-H notes are surfaced as banners, never buried.
 *
 * Hidden behind feature flag VITE_BRAIN_PHARMACY.
 */

import { useState } from 'react';
import { invokePharmacyReorder, brainFlags, type PharmacyReorderItem, type PharmacyReorderResponse } from '@/lib/brain';

export default function PharmacyReorderPanel() {
    const [data, setData] = useState<PharmacyReorderResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [approved, setApproved] = useState<Set<string>>(new Set());

    if (!brainFlags.pharmacy) {
        return (
            <div className="p-4 text-sm text-muted-foreground">
                Pharmacy reorder agent is disabled. Set <code>VITE_BRAIN_PHARMACY=true</code> to enable.
            </div>
        );
    }

    async function runScan() {
        setLoading(true);
        setError(null);
        try {
            const res = await invokePharmacyReorder({});
            setData(res);
            setApproved(new Set());
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    }

    function toggle(id: string) {
        setApproved(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    }

    return (
        <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold">AI Reorder Suggestions</h2>
                    <p className="text-sm text-muted-foreground">Auto-generated from inventory + last 90 days of sales. Pharmacist approves before PO.</p>
                </div>
                <button
                    onClick={runScan}
                    disabled={loading}
                    className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                    {loading ? 'Scanning…' : 'Run scan'}
                </button>
            </div>

            {error && (
                <div className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {data?.notes && data.notes.length > 0 && (
                <div className="rounded border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950/20">
                    <div className="mb-1 font-semibold text-amber-900 dark:text-amber-200">Flags ({data.notes.length})</div>
                    <ul className="list-disc pl-5 text-amber-900 dark:text-amber-200">
                        {data.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                </div>
            )}

            {data?.items && data.items.length > 0 && (
                <div className="overflow-x-auto rounded border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left">
                            <tr>
                                <th className="px-3 py-2">Approve</th>
                                <th className="px-3 py-2">Medicine</th>
                                <th className="px-3 py-2 text-right">On hand</th>
                                <th className="px-3 py-2 text-right">Daily sales</th>
                                <th className="px-3 py-2 text-right">Days cover</th>
                                <th className="px-3 py-2 text-right">Suggested qty</th>
                                <th className="px-3 py-2">Supplier</th>
                                <th className="px-3 py-2">Stockout</th>
                                <th className="px-3 py-2 text-right">Conf</th>
                                <th className="px-3 py-2">Rationale</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((it: PharmacyReorderItem) => (
                                <tr key={it.medicine_id} className="border-t">
                                    <td className="px-3 py-2">
                                        <input type="checkbox" checked={approved.has(it.medicine_id)} onChange={() => toggle(it.medicine_id)} />
                                    </td>
                                    <td className="px-3 py-2 font-medium">{it.medicine_name}</td>
                                    <td className="px-3 py-2 text-right">{it.on_hand}</td>
                                    <td className="px-3 py-2 text-right">{it.avg_daily_sales.toFixed(1)}</td>
                                    <td className="px-3 py-2 text-right">{it.days_of_cover.toFixed(1)}</td>
                                    <td className="px-3 py-2 text-right font-semibold">{it.suggested_qty}</td>
                                    <td className="px-3 py-2">{it.supplier ?? <em className="text-muted-foreground">TBC</em>}</td>
                                    <td className="px-3 py-2">{it.expected_stockout ?? '—'}</td>
                                    <td className="px-3 py-2 text-right">{(it.confidence * 100).toFixed(0)}%</td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">{it.rationale}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-sm">
                        <span>{approved.size} of {data.items.length} approved</span>
                        <button
                            disabled={approved.size === 0}
                            className="rounded bg-primary px-4 py-1 text-primary-foreground disabled:opacity-50"
                            onClick={() => alert('Wire to existing pharmacy-billing-service.ts createPurchaseOrder() — not implemented in v1 pilot.')}
                        >
                            Generate PO ({approved.size})
                        </button>
                    </div>
                </div>
            )}

            {data && data.items.length === 0 && (
                <div className="rounded border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    No reorder suggestions. All items have adequate cover.
                </div>
            )}
        </div>
    );
}
