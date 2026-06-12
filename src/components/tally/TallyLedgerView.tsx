
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  BookOpen, X, Loader2, Calendar, ChevronLeft, ChevronRight, Printer
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

export default function TallyLedgerView({ ledgerName, onClose, serverUrl, companyName, companyId }) {
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [ledgerInfo, setLedgerInfo] = useState(null)
  const [page, setPage] = useState(0)

  const now = new Date()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Fetch ledger info
  useEffect(() => {
    async function loadLedger() {
      const { data } = await supabase
        .from('tally_ledgers')
        .select('*')
        .eq('company_id', companyId)
        .eq('name', ledgerName)
        .limit(1)
        .single()
      if (data) setLedgerInfo(data)
    }
    if (ledgerName) loadLedger()
  }, [ledgerName, companyId])

  // Fetch vouchers for this ledger
  const fetchVouchers = useCallback(async () => {
    if (!ledgerName) return
    setLoading(true)
    try {
      let query = supabase
        .from('tally_vouchers')
        .select('*')
        .eq('company_id', companyId)
        .order('date', { ascending: true })

      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load transactions')
        setVouchers([])
      } else {
        // Filter vouchers that have entries for this ledger
        const name = ledgerName.toLowerCase()
        const filtered = (data || []).filter(v => {
          const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
          return entries.some(e => (e.ledger || '').toLowerCase() === name) ||
            (v.party_ledger || '').toLowerCase() === name
        })
        setVouchers(filtered)
      }
    } catch {
      toast.error('Failed to load transactions')
    }
    setLoading(false)
  }, [ledgerName, dateFrom, dateTo, companyId])

  useEffect(() => {
    fetchVouchers()
  }, [fetchVouchers])

  useEffect(() => {
    setPage(0)
  }, [dateFrom, dateTo])

  // Realtime: insert new vouchers as they are created (from Create Voucher tab or
  // auto-push) so the ledger view updates without closing and reopening.
  useEffect(() => {
    if (!companyId || !ledgerName) return
    const name = ledgerName.toLowerCase()

    const channel = supabase
      .channel(`ledger_view_${companyId}_${ledgerName}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tally_vouchers', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const v = payload.new as any
          const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
          const relevant =
            entries.some((e: any) => (e.ledger || '').toLowerCase() === name) ||
            (v.party_ledger || '').toLowerCase() === name
          if (!relevant) return

          setVouchers((prev) => {
            if (prev.some((r: any) => r.id === v.id)) return prev
            const updated = [...prev, v]
            updated.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            return updated
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [companyId, ledgerName])

  // Compute running balance with debit/credit
  const { rows, totalDebit, totalCredit } = useMemo(() => {
    const ledName = ledgerName.toLowerCase()
    let runningBalance = Math.abs(ledgerInfo?.opening_balance || 0)
    let debitSum = 0
    let creditSum = 0

    const computed = vouchers.map(v => {
      const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
      let debit = 0
      let credit = 0

      // Find the entry for this specific ledger
      for (const e of entries) {
        if ((e.ledger || '').toLowerCase() === ledName) {
          if (e.is_debit) debit += Math.abs(e.amount || 0)
          else credit += Math.abs(e.amount || 0)
        }
      }

      // If no specific entry found but party matches, use amount
      if (debit === 0 && credit === 0 && (v.party_ledger || '').toLowerCase() === ledName) {
        debit = v.amount || 0
      }

      // Determine the "against" ledger
      const against = entries.find(e => (e.ledger || '').toLowerCase() !== ledName)

      debitSum += debit
      creditSum += credit
      runningBalance = runningBalance + debit - credit

      return {
        ...v,
        debit,
        credit,
        runningBalance,
        againstLedger: against?.ledger || '-',
      }
    })

    return { rows: computed, totalDebit: debitSum, totalCredit: creditSum }
  }, [vouchers, ledgerInfo, ledgerName])

  const openingBalance = Math.abs(ledgerInfo?.opening_balance || 0)
  const closingBalance = openingBalance + totalDebit - totalCredit
  const paginatedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden mx-4 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-blue-600" />
              Ledger Account — {ledgerName}
            </h3>
            {ledgerInfo && (
              <p className="text-sm text-gray-500 mt-1">
                Group: {ledgerInfo.parent_group || '-'} | Opening: {formatCurrency(openingBalance)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
              <Printer className="h-4 w-4" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100">
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-3 p-4 border-b shrink-0">
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Opening Balance</p>
            <p className="text-base font-bold text-gray-900">{formatCurrency(openingBalance)}</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <p className="text-xs text-green-600">Total Debit</p>
            <p className="text-base font-bold text-green-800">{formatCurrency(totalDebit)}</p>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <p className="text-xs text-red-600">Total Credit</p>
            <p className="text-base font-bold text-red-800">{formatCurrency(totalCredit)}</p>
          </div>
          <div className={`p-3 rounded-lg ${closingBalance >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
            <p className="text-xs text-gray-500">Net Balance</p>
            <p className={`text-base font-bold ${closingBalance >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>
              {formatCurrency(closingBalance)}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 p-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1 border rounded text-sm" placeholder="From" />
            <span className="text-gray-400">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1 border rounded text-sm" placeholder="To" />
          </div>
          <span className="text-xs text-gray-500 ml-auto">{rows.length} transactions</span>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="border-b">
                <th className="text-left py-2.5 px-3 font-medium text-gray-600">Date</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-600">Voucher No</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-600">Type</th>
                <th className="text-left py-2.5 px-3 font-medium text-gray-600">Against Ledger</th>
                <th className="text-right py-2.5 px-3 font-medium text-green-700">Debit</th>
                <th className="text-right py-2.5 px-3 font-medium text-red-700">Credit</th>
                <th className="text-right py-2.5 px-3 font-medium text-gray-600">Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening */}
              <tr className="bg-blue-50 border-b border-blue-100">
                <td colSpan={4} className="py-2 px-3 font-medium text-blue-800">Opening Balance</td>
                <td className="py-2 px-3" />
                <td className="py-2 px-3" />
                <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(openingBalance)}</td>
              </tr>

              {loading && (
                <tr>
                  <td colSpan={7} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600 mx-auto" />
                  </td>
                </tr>
              )}

              {!loading && paginatedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">No transactions found</td>
                </tr>
              )}

              {paginatedRows.map((row, idx) => (
                <tr key={row.id} className={`border-b hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                  <td className="py-2 px-3 whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="py-2 px-3 font-mono text-xs">{row.voucher_number || '-'}</td>
                  <td className="py-2 px-3">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                      {row.voucher_type}
                    </span>
                  </td>
                  <td className="py-2 px-3 max-w-[200px] truncate">{row.againstLedger}</td>
                  <td className="py-2 px-3 text-right text-green-700 font-medium">
                    {row.debit > 0 ? formatCurrency(row.debit) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-red-600 font-medium">
                    {row.credit > 0 ? formatCurrency(row.credit) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-900 font-medium">
                    {formatCurrency(row.runningBalance)}
                  </td>
                </tr>
              ))}

              {/* Closing */}
              {rows.length > 0 && (
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={4} className="py-2 px-3 font-bold text-blue-800">Closing Balance</td>
                  <td className="py-2 px-3 text-right font-bold text-green-700">{formatCurrency(totalDebit)}</td>
                  <td className="py-2 px-3 text-right font-bold text-red-600">{formatCurrency(totalCredit)}</td>
                  <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(closingBalance)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t shrink-0">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1 rounded border hover:bg-gray-50 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-xs">Page {page + 1} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1 rounded border hover:bg-gray-50 disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
