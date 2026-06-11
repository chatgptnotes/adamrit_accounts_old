// VPS Claude token-spend status page. Reads the read-only /api/vps-claude-usage
// relay, which fans out to each sidecar's bearer-protected GET /usage. Shows the
// real per-call token counts the sidecar logs — broken down per sidecar, per
// model, per feature/page, and across today / this-month / all-time.
//
// On a Max subscription you are NOT billed per token; total_cost_usd is the
// notional what-it-would-cost-on-the-API figure. The token counts are what burn
// the rate limit — that's the number to watch.

import { useEffect, useState, useCallback } from 'react';

interface Totals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
}

interface SidecarStatus {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  sidecar?: string;
  log_path?: string;
  first_call?: string | null;
  last_call?: string | null;
  all_time?: Totals;
  today?: Totals;
  this_month?: Totals;
  by_model?: Record<string, Totals>;
  by_feature?: Record<string, Totals>;
}

interface UsageResponse {
  generated_at: string;
  combined: { all_time: Totals; today: Totals; this_month: Totals };
  sidecars: SidecarStatus[];
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('en-IN');
const usd = (n: number | undefined) => `$${(n ?? 0).toFixed(4)}`;

function TotalsCard({ title, t }: { title: string; t?: Totals }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, minWidth: 220 }}>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{fmt(t?.total_tokens)}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>total tokens · {fmt(t?.calls)} calls</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>
        <div>In: <b>{fmt(t?.input_tokens)}</b></div>
        <div>Out: <b>{fmt(t?.output_tokens)}</b></div>
        <div>Cache write: <b>{fmt(t?.cache_creation_input_tokens)}</b></div>
        <div>Cache read: <b>{fmt(t?.cache_read_input_tokens)}</b></div>
        <div style={{ marginTop: 6, color: '#0f766e' }}>Notional cost: <b>{usd(t?.total_cost_usd)}</b></div>
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows?: Record<string, Totals> }) {
  const entries = Object.entries(rows || {}).sort((a, b) => (b[1].total_tokens) - (a[1].total_tokens));
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, marginBottom: 8 }}>{title}</h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#64748b' }}>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0' }}>Name</th>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>Calls</th>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>In</th>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>Out</th>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>Total tokens</th>
            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e2e8f0', textAlign: 'right' }}>Notional $</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, t]) => (
            <tr key={name}>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9' }}>{name}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{fmt(t.calls)}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{fmt(t.input_tokens)}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{fmt(t.output_tokens)}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 600 }}>{fmt(t.total_tokens)}</td>
              <td style={{ padding: '6px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{usd(t.total_cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VpsClaudeUsage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vps-claude-usage');
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text}`);
      setData(JSON.parse(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>VPS Claude — Token Spend</h1>
        <button onClick={load} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #cbd5e1', cursor: 'pointer', background: '#fff' }}>
          Refresh
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>
        Real per-call token counts logged by the sidecar(s). On a Max subscription the cost is notional — tokens are what burn the rate limit.
      </p>

      {loading && <p>Loading…</p>}
      {error && <pre style={{ color: '#b91c1c', whiteSpace: 'pre-wrap', background: '#fef2f2', padding: 12, borderRadius: 6 }}>{error}</pre>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 16 }}>
            <TotalsCard title="Today (UTC)" t={data.combined.today} />
            <TotalsCard title="This month" t={data.combined.this_month} />
            <TotalsCard title="All time" t={data.combined.all_time} />
          </div>

          {data.sidecars.map((s) => (
            <div key={s.url} style={{ marginTop: 32, paddingTop: 16, borderTop: '2px solid #e2e8f0' }}>
              <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>
                {s.sidecar || s.url}{' '}
                <span style={{ fontSize: 12, fontWeight: 400, color: s.ok ? '#16a34a' : '#dc2626' }}>
                  {s.ok ? '● online' : `● unreachable${s.status ? ` (${s.status})` : ''}`}
                </span>
              </h2>
              {!s.ok && <pre style={{ color: '#b91c1c', fontSize: 12 }}>{s.error}</pre>}
              {s.ok && (
                <>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {s.first_call ? `first call ${new Date(s.first_call).toLocaleString()}` : 'no calls yet'}
                    {s.last_call ? ` · last call ${new Date(s.last_call).toLocaleString()}` : ''}
                    {s.log_path ? ` · log ${s.log_path}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                    <TotalsCard title="Today" t={s.today} />
                    <TotalsCard title="This month" t={s.this_month} />
                    <TotalsCard title="All time" t={s.all_time} />
                  </div>
                  <BreakdownTable title="By model" rows={s.by_model} />
                  <BreakdownTable title="By feature / page" rows={s.by_feature} />
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
