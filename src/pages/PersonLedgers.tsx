import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ArrowLeft, Loader2, Search } from 'lucide-react';

/**
 * One person, every ledger they hold.
 *
 * Phase 3 of the plan of 20 August. Read-only, deliberately: it moves no money
 * and merges no ledger. Each company still balances alone — this only shows
 * that four rows called "Arpit Kinarkar" in four companies are one man, which
 * is the thing that was impossible before and let MLE-1470 through.
 *
 * Vendors are here on the same footing as staff, at Dr M's decision (20 Aug):
 * NAG DRUG AGENCIES appears in four companies exactly as a member of staff does.
 */

interface PersonSummary {
  person_id: string;
  full_name: string;
  party_kind: 'person' | 'vendor';
  is_staff: boolean;
  person_mobile: string | null;
  ledger_count: number;
  company_count: number;
  ledgers_without_a_company: number;
  total_balance: number | null;
  entry_count: number | null;
  companies: string | null;
}

interface PersonAccount {
  person_id: string;
  account_id: string;
  account_name: string;
  account_group: string | null;
  ledger_mobile: string | null;
  role: string | null;
  company_name: string | null;
  balance: number | null;
  entry_count: number | null;
}

const money = (n: number | null | undefined) =>
  `₹${Math.abs(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Dr for a debit balance, Cr for a credit one — as every other screen prints it. */
const side = (n: number | null | undefined) => ((Number(n) || 0) >= 0 ? 'Dr' : 'Cr');

type Kind = 'all' | 'person' | 'vendor';

const PersonLedgers: React.FC = () => {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [multiOnly, setMultiOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: people = [], isLoading, error } = useQuery({
    queryKey: ['person-summary'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('v_person_summary')
        .select('*')
        .order('ledger_count', { ascending: false })
        .limit(5000);
      if (err) throw new Error(err.message);
      return (data ?? []) as PersonSummary[];
    },
  });

  // Every ledger of the person whose row is open. Fetched only when one is.
  const { data: accounts = [], isLoading: loadingAccounts } = useQuery({
    queryKey: ['person-accounts', openId],
    enabled: !!openId,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('v_person_accounts')
        .select('*')
        .eq('person_id', openId)
        .order('company_name');
      if (err) throw new Error(err.message);
      return (data ?? []) as PersonAccount[];
    },
  });

  const rows = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return people.filter((p) => {
      if (kind !== 'all' && p.party_kind !== kind) return false;
      if (multiOnly && (p.company_count ?? 0) < 2) return false;
      if (!needle) return true;
      return (
        p.full_name.toLowerCase().includes(needle) ||
        (p.companies ?? '').toLowerCase().includes(needle) ||
        (p.person_mobile ?? '').includes(needle)
      );
    });
  }, [people, term, kind, multiOnly]);

  const counts = useMemo(
    () => ({
      people: people.filter((p) => p.party_kind === 'person').length,
      vendors: people.filter((p) => p.party_kind === 'vendor').length,
      multi: people.filter((p) => (p.company_count ?? 0) > 1).length,
    }),
    [people],
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2">
        <div className="flex items-center space-x-3">
          <button
            onClick={() => navigate('/ledger-statement')}
            className="flex items-center rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </button>
          <h1 className="text-xl font-bold text-white">People and Vendors — every ledger, all six companies</h1>
        </div>
      </div>

      <div className="border-b border-gray-300 bg-gray-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded border border-gray-300 bg-white px-2 py-1">
            <Search className="mr-1 h-4 w-4 text-gray-500" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search a name, a company or a mobile…"
              className="w-72 text-sm outline-none"
            />
          </div>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none"
          >
            <option value="all">Everyone</option>
            <option value="person">Staff and consultants</option>
            <option value="vendor">Vendors</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={multiOnly} onChange={(e) => setMultiOnly(e.target.checked)} />
            In more than one company
          </label>
          <span className="ml-auto text-sm text-gray-600">
            {counts.people} people · {counts.vendors} vendors · {counts.multi} in more than one company
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        <p className="mb-3 max-w-4xl rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          Nothing here has been merged. Every ledger stays in its own company with its own balance —
          this only shows which of them belong to the same person. Click a name to see them.
        </p>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-gray-600">
            <Loader2 className="mr-2 h-6 w-6 animate-spin text-blue-600" />
            Loading…
          </div>
        ) : error ? (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {(error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-500">Nobody matches that.</div>
        ) : (
          <div className="overflow-x-auto rounded border border-gray-300 bg-white">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-blue-100">
                <tr>
                  <th className="border-b-2 border-gray-300 px-3 py-2 text-left font-semibold text-blue-700">Name</th>
                  <th className="border-b-2 border-gray-300 px-3 py-2 text-left font-semibold text-blue-700">Kind</th>
                  <th className="border-b-2 border-gray-300 px-3 py-2 text-left font-semibold text-blue-700">Companies</th>
                  <th className="w-20 border-b-2 border-gray-300 px-3 py-2 text-right font-semibold text-blue-700">Ledgers</th>
                  <th className="w-28 border-b-2 border-gray-300 px-3 py-2 text-left font-semibold text-blue-700">Mobile</th>
                  <th className="w-40 border-b-2 border-gray-300 px-3 py-2 text-right font-semibold text-blue-700">
                    Total across all
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((p) => {
                  const open = openId === p.person_id;
                  return (
                    <React.Fragment key={p.person_id}>
                      <tr
                        onClick={() => setOpenId(open ? null : p.person_id)}
                        className={`cursor-pointer border-b border-gray-200 ${open ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="px-3 py-1.5 font-medium text-gray-900">{p.full_name}</td>
                        <td className="px-3 py-1.5">
                          {p.party_kind === 'vendor' ? (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Vendor</span>
                          ) : p.is_staff ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                              Staff — no cuts
                            </span>
                          ) : (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">Consultant</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-700">
                          {p.companies || <span className="text-red-600">no company</span>}
                          {(p.ledgers_without_a_company ?? 0) > 0 && (
                            <span className="ml-2 text-xs text-red-600">
                              +{p.ledgers_without_a_company} with no company
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{p.ledger_count}</td>
                        <td className="px-3 py-1.5 text-gray-700">
                          {p.person_mobile || <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold">
                          {money(p.total_balance)} <span className="text-xs font-normal">{side(p.total_balance)}</span>
                        </td>
                      </tr>

                      {open && (
                        <tr className="border-b-2 border-blue-200 bg-blue-50/50">
                          <td colSpan={6} className="px-6 py-3">
                            {loadingAccounts ? (
                              <span className="text-sm text-gray-600">Loading their ledgers…</span>
                            ) : (
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="text-xs uppercase tracking-wide text-gray-500">
                                    <th className="px-2 py-1 text-left font-medium">Company</th>
                                    <th className="px-2 py-1 text-left font-medium">Ledger</th>
                                    <th className="px-2 py-1 text-left font-medium">Group</th>
                                    <th className="px-2 py-1 text-right font-medium">Entries</th>
                                    <th className="px-2 py-1 text-right font-medium">Balance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {accounts.map((a) => (
                                    <tr key={a.account_id} className="border-t border-blue-100">
                                      <td className="px-2 py-1">
                                        {a.company_name || <span className="text-red-600">no company</span>}
                                      </td>
                                      <td className="px-2 py-1 font-medium">{a.account_name}</td>
                                      <td className="px-2 py-1 text-gray-600">{a.account_group}</td>
                                      <td className="px-2 py-1 text-right font-mono text-gray-600">
                                        {a.entry_count ?? 0}
                                      </td>
                                      <td className="px-2 py-1 text-right font-mono">
                                        {money(a.balance)} <span className="text-xs">{side(a.balance)}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 500 && (
              <div className="border-t border-gray-200 px-3 py-2 text-sm text-gray-600">
                Showing the first 500 of {rows.length}. Narrow the search to see the rest.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PersonLedgers;
