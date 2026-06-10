
import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  Search, Filter, X, Loader2,
  BookOpen, Link2, ChevronDown, ChevronLeft, ChevronRight
} from 'lucide-react'
import TallyLedgerView from './TallyLedgerView'

const PAGE_SIZE = 50

const GROUP_OPTIONS = [
  'All',
  'Sundry Debtors',
  'Sundry Creditors',
  'Cash-in-Hand',
  'Bank Accounts',
  'Direct Incomes',
  'Direct Expenses',
  'Indirect Incomes',
  'Indirect Expenses',
]


function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export default function TallyLedgers({ serverUrl, companyName, companyId }) {
  const [ledgers, setLedgers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('All')
  const [page, setPage] = useState(0)
  const [viewLedger, setViewLedger] = useState(null)

  useEffect(() => {
    fetchLedgers()
  }, [companyId])

  async function fetchLedgers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('tally_ledgers')
      .select('*')
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (error) {
      toast.error('Failed to load ledgers')
    } else {
      setLedgers(data || [])
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let result = ledgers

    if (groupFilter !== 'All') {
      result = result.filter(
        (l) => (l.parent_group || '').toLowerCase().replace(/-/g, ' ') === groupFilter.toLowerCase().replace(/-/g, ' ')
      )
    }

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (l) =>
          (l.name || '').toLowerCase().includes(q) ||
          (l.parent_group || '').toLowerCase().includes(q) ||
          (l.email || '').toLowerCase().includes(q) ||
          (l.gst_number || '').toLowerCase().includes(q) ||
          (l.pan_number || '').toLowerCase().includes(q)
      )
    }

    return result
  }, [ledgers, search, groupFilter])

  // Reset page when filters change
  useEffect(() => {
    setPage(0)
  }, [search, groupFilter])

  const paginatedRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function getMappedLabel(ledger) {
    if (!ledger.is_mapped || !ledger.adamrit_entity_type) return null
    return `${ledger.adamrit_entity_type} #${ledger.adamrit_entity_id || '?'}`
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Tally Ledgers
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {ledgers.length} total ledgers{' '}
              {filtered.length !== ledgers.length && (
                <span className="text-blue-600 font-medium">
                  ({filtered.length} shown)
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, group, email, GST, PAN..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none cursor-pointer"
            >
              {GROUP_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-500">Loading ledgers...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <BookOpen className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              {ledgers.length === 0
                ? 'No ledgers synced yet. Sync ledgers from the dashboard.'
                : 'No ledgers match your search or filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Name</th>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Group</th>
                  <th className="text-right py-3 px-4 text-gray-600 font-semibold">Opening Bal</th>
                  <th className="text-right py-3 px-4 text-gray-600 font-semibold">Closing Bal</th>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Type</th>
                  <th className="text-left py-3 px-4 text-gray-600 font-semibold">Mapped To</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((ledger, idx) => {
                  const mapped = getMappedLabel(ledger)
                  return (
                    <tr
                      key={ledger.id}
                      onClick={() => setViewLedger(ledger.name)}
                      className={`border-b border-gray-100 hover:bg-blue-50 transition-colors cursor-pointer ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-medium text-blue-700 max-w-[250px] truncate hover:underline">
                        {ledger.name}
                      </td>
                      <td className="py-2.5 px-4 text-gray-600">{ledger.parent_group || '-'}</td>
                      <td className="py-2.5 px-4 text-right text-gray-700 font-mono text-xs">
                        {formatCurrency(ledger.opening_balance)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs">
                        <span
                          className={
                            (ledger.closing_balance || 0) >= 0
                              ? 'text-green-700'
                              : 'text-red-600'
                          }
                        >
                          {formatCurrency(ledger.closing_balance)}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        {ledger.ledger_type ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            {ledger.ledger_type}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        {mapped ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <Link2 className="h-3 w-3" />
                            {mapped}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Not mapped</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} ledgers
              {groupFilter !== 'All' && <span className="text-gray-400 ml-2">Filtered by: {groupFilter}</span>}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600" />
                </button>
                <span className="px-3 py-1 text-xs text-gray-700 font-medium">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ledger Account View Modal */}
      {viewLedger && (
        <TallyLedgerView
          ledgerName={viewLedger}
          onClose={() => setViewLedger(null)}
          serverUrl={serverUrl}
          companyName={companyName}
          companyId={companyId}
        />
      )}

    </div>
  )
}
