
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  Landmark, Loader2, Printer, ChevronDown,
  CheckCircle, Clock, XCircle, ChevronLeft, ChevronRight
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

export default function TallyBankBook({ serverUrl, companyName, companyId }) {
  const [banks, setBanks] = useState([])
  const [selectedBank, setSelectedBank] = useState('')
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingBalance, setOpeningBalance] = useState(0)
  const [page, setPage] = useState(0)

  const now = new Date()
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Load bank ledgers
  useEffect(() => {
    async function loadBanks() {
      let q1 = supabase
        .from('tally_ledgers')
        .select('name, opening_balance, closing_balance, parent_group')
        .or('parent_group.ilike.%bank account%,parent_group.ilike.%bank accounts%')
        .order('name')
      if (companyId) q1 = q1.eq('company_id', companyId)
      const { data } = await q1

      if (data && data.length > 0) {
        setBanks(data)
        setSelectedBank(data[0].name)
      }
      setLoading(false)
    }
    loadBanks()
  }, [companyId])

  // Fetch vouchers for selected bank
  const fetchVouchers = useCallback(async () => {
    if (!selectedBank) return
    setLoading(true)
    try {
      const bank = banks.find(b => b.name === selectedBank)
      setOpeningBalance(bank?.opening_balance || 0)

      let query = supabase
        .from('tally_vouchers')
        .select('*')
        .order('date', { ascending: true })
        .limit(2000)

      if (companyId) query = query.eq('company_id', companyId)
      if (dateFrom) query = query.gte('date', dateFrom)
      if (dateTo) query = query.lte('date', dateTo)

      const { data, error } = await query

      if (error) {
        toast.error('Failed to load bank book')
        setVouchers([])
      } else {
        const bankName = selectedBank.toLowerCase()
        const bankVouchers = (data || []).filter(v => {
          const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
          return entries.some(e => (e.ledger || '').toLowerCase() === bankName)
        })
        setVouchers(bankVouchers)
      }
    } catch {
      toast.error('Failed to load bank book')
    }
    setLoading(false)
  }, [selectedBank, dateFrom, dateTo, banks, companyId])

  useEffect(() => {
    if (selectedBank) fetchVouchers()
  }, [fetchVouchers])

  useEffect(() => {
    setPage(0)
  }, [selectedBank, dateFrom, dateTo])

  const { rows, totalDeposit, totalWithdrawal, closingBalance } = useMemo(() => {
    let runningBalance = Math.abs(openingBalance)
    let deposit = 0
    let withdrawal = 0
    const bankName = selectedBank.toLowerCase()

    const computed = vouchers.map(v => {
      const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
      let dep = 0
      let wd = 0

      for (const e of entries) {
        if ((e.ledger || '').toLowerCase() === bankName) {
          if (e.is_debit) dep += Math.abs(e.amount || 0)
          else wd += Math.abs(e.amount || 0)
        }
      }

      deposit += dep
      withdrawal += wd
      runningBalance = runningBalance + dep - wd

      const nonBankParty = (v.party_ledger && (v.party_ledger || '').toLowerCase() !== bankName)
        ? v.party_ledger
        : null
      const against = nonBankParty
        || (entries.find(e => (e.ledger || '').toLowerCase() !== bankName))?.ledger
        || null

      return { ...v, deposit: dep, withdrawal: wd, runningBalance, againstLedger: against || '-' }
    })

    return {
      rows: computed,
      totalDeposit: deposit,
      totalWithdrawal: withdrawal,
      closingBalance: Math.abs(openingBalance) + deposit - withdrawal,
    }
  }, [vouchers, openingBalance, selectedBank])

  const paginatedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  // Summary per bank
  const bankSummary = useMemo(() => {
    return banks.map(b => ({
      name: b.name,
      balance: Math.abs(b.closing_balance || 0),
    }))
  }, [banks])

  return (
    <div className="space-y-4">
      {/* Bank Summary Cards */}
      {bankSummary.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {bankSummary.map(b => (
            <div
              key={b.name}
              onClick={() => setSelectedBank(b.name)}
              className={`rounded-xl border p-4 cursor-pointer transition-colors ${
                selectedBank === b.name ? 'bg-blue-50 border-blue-300' : 'bg-white shadow-sm hover:bg-gray-50'
              }`}
            >
              <p className="text-xs text-gray-500 truncate">{b.name}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(b.balance)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank Account</label>
            <div className="relative">
              <select
                value={selectedBank}
                onChange={e => setSelectedBank(e.target.value)}
                className="pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer min-w-[200px]"
              >
                {banks.map(b => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
            <input
              type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
            <input
              type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>
      </div>

      {/* Bank Book Table */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Landmark className="h-4 w-4 text-blue-600" />
            Bank Book — {selectedBank || 'Select a bank'}
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
                <th className="text-right py-2.5 px-3 text-green-700 font-medium">Deposit (Dr)</th>
                <th className="text-right py-2.5 px-3 text-red-700 font-medium">Withdrawal (Cr)</th>
                <th className="text-right py-2.5 px-3 text-gray-600 font-medium">Balance</th>
                <th className="text-center py-2.5 px-3 text-gray-600 font-medium">Reconciled</th>
              </tr>
            </thead>
            <tbody>
              {/* Opening Balance */}
              <tr className="bg-blue-50 border-b border-blue-100">
                <td colSpan={4} className="py-2 px-3 font-medium text-blue-800">Opening Balance</td>
                <td className="py-2 px-3" />
                <td className="py-2 px-3" />
                <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(Math.abs(openingBalance))}</td>
                <td className="py-2 px-3" />
              </tr>

              {!loading && paginatedRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-500">
                    No bank transactions found for the selected period.
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
                    {row.deposit > 0 ? formatCurrency(row.deposit) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-red-600 font-medium whitespace-nowrap">
                    {row.withdrawal > 0 ? formatCurrency(row.withdrawal) : ''}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-900 font-medium whitespace-nowrap">
                    {formatCurrency(row.runningBalance)}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs text-yellow-600">
                      <Clock className="h-3 w-3" /> Pending
                    </span>
                  </td>
                </tr>
              ))}

              {/* Closing Balance */}
              {rows.length > 0 && (
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={4} className="py-2 px-3 font-bold text-blue-800">Closing Balance</td>
                  <td className="py-2 px-3 text-right font-bold text-green-700">{formatCurrency(totalDeposit)}</td>
                  <td className="py-2 px-3 text-right font-bold text-red-600">{formatCurrency(totalWithdrawal)}</td>
                  <td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(closingBalance)}</td>
                  <td className="py-2 px-3" />
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
