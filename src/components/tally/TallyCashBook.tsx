
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  Banknote, Loader2, Printer, Calendar,
  ArrowDownLeft, ArrowUpRight, Filter, ChevronLeft, ChevronRight
} from 'lucide-react'

const PAGE_SIZE = 50

function formatCurrency(val) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(val || 0)
}

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function TallyCashBook({ serverUrl, companyName, companyId }) {
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingBalance, setOpeningBalance] = useState(0)

  // Date range: default to full current month (day-by-day sequence)
  const now = new Date()
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const defaultTo = (() => {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  })()
  const [dateFrom, setDateFrom] = useState(defaultFrom)
  const [dateTo, setDateTo] = useState(defaultTo)
  const [typeFilter, setTypeFilter] = useState('All')
  const [page, setPage] = useState(0)

  const VOUCHER_TYPES = ['All', 'Sales', 'Receipt', 'Payment', 'Journal', 'Contra']

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Get opening balance for Cash ledger
      const { data: cashLedger } = await supabase
        .from('tally_ledgers')
        .select('opening_balance, closing_balance')
        .eq('company_id', companyId)
        .or('name.ilike.%cash%,parent_group.ilike.%cash-in-hand%,parent_group.ilike.%cash in hand%')
        .limit(1)
        .single()

      if (cashLedger) {
        setOpeningBalance(cashLedger.opening_balance || 0)
      }

      // Fetch vouchers involving cash ledgers
      let query = supabase
        .from('tally_vouchers')
        .select('*')
        .eq('company_id', companyId)
        .order('date', { ascending: true })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)
      if (typeFilter !== 'All') query = query.eq('voucher_type', typeFilter)

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load cash book')
        setVouchers([])
      } else {
        // Filter vouchers that have cash-related ledger entries
        const cashVouchers = (data || []).filter(v => {
          const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
          return entries.some(e => {
            const name = (e.ledger || '').toLowerCase()
            return name.includes('cash') || name === 'cash'
          })
        })
        setVouchers(cashVouchers)
      }
    } catch (err) {
      toast.error('Failed to load cash book data')
    }
    setLoading(false)
  }, [dateFrom, dateTo, typeFilter, companyId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(0)
  }, [dateFrom, dateTo, typeFilter, companyId])

  // Realtime: when a new voucher is mirrored into tally_vouchers after a push,
  // merge it into state immediately so it appears without a manual refresh.
  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`tally_vouchers_live_${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tally_vouchers', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const v = payload.new as any
          // Apply the same cash-ledger filter used by fetchData
          const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
          const isCash = entries.some((e: any) => {
            const name = (e.ledger || '').toLowerCase()
            return name.includes('cash') || name === 'cash'
          })
          if (!isCash) return

          setVouchers((prev) => {
            // Skip if already present (e.g. triggered twice)
            if (prev.some((r: any) => r.id === v.id)) return prev
            const updated = [...prev, v]
            // Keep ascending date order (day-by-day sequence)
            updated.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            return updated
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId])

  // Compute running balances and totals
  const { rows, totalCashIn, totalCashOut, closingBalance } = useMemo(() => {
    let runningBalance = Math.abs(openingBalance)
    let cashIn = 0
    let cashOut = 0
    const computed = vouchers.map(v => {
      const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
      let received = 0
      let paid = 0

      for (const e of entries) {
        const name = (e.ledger || '').toLowerCase()
        if (name.includes('cash') || name === 'cash') {
          if (e.is_debit) received += Math.abs(e.amount || 0)
          else paid += Math.abs(e.amount || 0)
        }
      }

      cashIn += received
      cashOut += paid
      runningBalance = runningBalance + received - paid

      // Determine "against" party - prefer party_ledger if not cash, else first non-cash ledger entry
      const nonCashParty = (v.party_ledger && !(v.party_ledger || '').toLowerCase().includes('cash'))
        ? v.party_ledger
        : null
      const against = nonCashParty
        || (entries.find(e => {
            const n = (e.ledger || '').toLowerCase()
            return !n.includes('cash')
          }))?.ledger
        || null

      return {
        ...v,
        received,
        paid,
        runningBalance,
        againstLedger: against || '-',
      }
    })

    return {
      rows: computed,
      totalCashIn: cashIn,
      totalCashOut: cashOut,
      closingBalance: Math.abs(openingBalance) + cashIn - cashOut,
    }
  }, [vouchers, openingBalance])

  const paginatedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  function handlePrint() {
    window.print()
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500">Opening Balance</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(Math.abs(openingBalance))}</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-xs text-green-700">Total Cash In</p>
          <p className="text-lg font-bold text-green-800 mt-1">{formatCurrency(totalCashIn)}</p>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4">
          <p className="text-xs text-red-700">Total Cash Out</p>
          <p className="text-lg font-bold text-red-800 mt-1">{formatCurrency(totalCashOut)}</p>
        </div>
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
          <p className="text-xs text-blue-700">Net Cash</p>
          <p className="text-lg font-bold text-blue-800 mt-1">{formatCurrency(totalCashIn - totalCashOut)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500">Closing Balance</p>
          <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(closingBalance)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Voucher Type</label>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {VOUCHER_TYPES.map(t => (
                <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>
      </div>

      {/* Cash Book Table */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-green-600" />
            Cash Book
            <span className="text-xs font-normal text-gray-500">({rows.length} entries)</span>
          </h3>
          {loading && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Date</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Voucher No</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Type</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Party</th>
                <th className="text-right py-2.5 px-3 text-green-700 font-medium">Received (Dr)</th>
                <th className="text-right py-2.5 px-3 text-red-700 font-medium">Paid (Cr)</th>
                <th className="text-right py-2.5 px-3 text-gray-600 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening Balance Row */}
              <tr className="bg-blue-50 border-b border-blue-100">
                <td colSpan={4} className="py-2 px-3 font-medium text-blue-800">Opening Balance</td>
                <td className="py-2 px-3" />
                <td className="py-2 px-3" />
                <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(Math.abs(openingBalance))}</td>
              </tr>

              {!loading && paginatedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-500">
                    No cash transactions found for the selected period.
                  </td>
                </tr>
              )}

              {paginatedRows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-b border-gray-100 hover:bg-gray-50 ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  } ${row.is_cancelled ? 'opacity-50 line-through' : ''}`}
                >
                  <td className="py-2 px-3 text-gray-900 whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="py-2 px-3 text-gray-900 font-mono text-xs">{row.voucher_number || '-'}</td>
                  <td className="py-2 px-3">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                      {row.voucher_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-gray-900 max-w-[200px] truncate">
                    {row.againstLedger && row.againstLedger !== '-' ? row.againstLedger : (row.party_ledger || '-')}
                  </td>
                  <td className="py-2 px-3 text-right text-green-700 font-medium whitespace-nowrap">
                    {row.received > 0 ? formatCurrency(row.received) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-red-600 font-medium whitespace-nowrap">
                    {row.paid > 0 ? formatCurrency(row.paid) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-900 font-medium whitespace-nowrap">
                    {formatCurrency(row.runningBalance)}
                  </td>
                </tr>
              ))}

              {/* Closing Balance Row */}
              {rows.length > 0 && (
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={4} className="py-2 px-3 font-bold text-blue-800">Closing Balance</td>
                  <td className="py-2 px-3 text-right font-bold text-green-700">{formatCurrency(totalCashIn)}</td>
                  <td className="py-2 px-3 text-right font-bold text-red-600">{formatCurrency(totalCashOut)}</td>
                  <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(closingBalance)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </p>
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
          </div>
        )}
      </div>
    </div>
  )
}
