import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import { Banknote, Loader2, Printer, ChevronLeft, ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui/switch'

const PAGE_SIZE = 50
const VOUCHER_TYPES = ['All', 'Sales', 'Receipt', 'Payment', 'Journal', 'Contra']

const companyKey = (value: string | null | undefined) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const isCashAccount = (account: any) => `${account?.account_name || account?.ledger || ''} ${account?.account_group || ''} ${account?.account_type || ''}`.toLowerCase().includes('cash')
const signedOpening = (account: any) => (Number(account?.opening_balance) || 0) * (account?.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1)
const matchesVoucherType = (value: string | null | undefined, filter: string) => filter === 'All' || (value || '').toLowerCase().includes(filter.toLowerCase())

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val || 0)
}

function formatDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function TallyCashBook({ companyName, companyId }: { serverUrl?: string; companyName?: string; companyId?: string }) {
  const [showTally, setShowTally] = useState(true)
  const [vouchers, setVouchers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openingBalance, setOpeningBalance] = useState(0)
  const [page, setPage] = useState(0)
  const now = new Date()
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
  const [dateTo, setDateTo] = useState(() => { const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}` })
  const [typeFilter, setTypeFilter] = useState('All')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      if (showTally) {
        const { data: cashLedgers, error: ledgerError } = await (supabase as any).from('tally_ledgers').select('opening_balance, name, parent_group').eq('company_id', companyId || '')
        if (ledgerError) throw ledgerError
        const cashLedger = (cashLedgers || []).find((ledger: any) => isCashAccount({ account_name: ledger.name, account_group: ledger.parent_group }))
        setOpeningBalance(Number(cashLedger?.opening_balance) || 0)

        let query: any = (supabase as any).from('tally_vouchers').select('*').eq('company_id', companyId || '').order('date', { ascending: true }).limit(2000)
        if (dateFrom) query = query.gte('date', dateFrom)
        if (dateTo) query = query.lte('date', dateTo)
        if (typeFilter !== 'All') query = query.eq('voucher_type', typeFilter)
        const { data, error } = await query
        if (error) throw error
        setVouchers((data || []).filter((voucher: any) => (Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []).some((entry: any) => isCashAccount(entry))))
        return
      }

      const { data: companyRows, error: companyError } = await (supabase as any).from('companies').select('id, company_name').eq('is_active', true)
      if (companyError) throw companyError
      const accountingCompany = (companyRows || []).find((company: any) => companyKey(company.company_name) === companyKey(companyName))
      if (!accountingCompany) {
        setOpeningBalance(0)
        setVouchers([])
        return
      }

      const { data: accounts, error: accountsError } = await (supabase as any).from('chart_of_accounts').select('id, account_name, account_group, account_type, opening_balance, opening_balance_type').eq('company_id', accountingCompany.id).eq('is_active', true)
      if (accountsError) throw accountsError
      setOpeningBalance((accounts || []).filter(isCashAccount).reduce((total: number, account: any) => total + signedOpening(account), 0))

      let query: any = (supabase as any).from('vouchers').select('id, voucher_number, voucher_date, narration, status, created_at, voucher_type:voucher_types(voucher_type_name, voucher_category), voucher_entries(debit_amount, credit_amount, account:chart_of_accounts(account_name, account_group, account_type))').eq('company_id', accountingCompany.id).order('voucher_date', { ascending: true }).limit(2000)
      if (dateFrom) query = query.gte('voucher_date', dateFrom)
      if (dateTo) query = query.lte('voucher_date', dateTo)
      const { data, error } = await query
      if (error) throw error
      const normalized = (data || []).map((voucher: any) => ({
        id: `adamrit:${voucher.id}`,
        date: voucher.voucher_date,
        voucher_number: voucher.voucher_number,
        voucher_type: voucher.voucher_type?.voucher_type_name || voucher.voucher_type?.voucher_category || '-',
        voucher_category: voucher.voucher_type?.voucher_category || '',
        party_ledger: null,
        narration: voucher.narration,
        is_cancelled: voucher.status === 'cancelled',
        ledger_entries: (voucher.voucher_entries || []).map((entry: any) => ({ ledger: entry.account?.account_name || '', amount: Number(entry.debit_amount || entry.credit_amount || 0), is_debit: Number(entry.debit_amount || 0) > 0 })),
      })).filter((voucher: any) => (matchesVoucherType(voucher.voucher_type, typeFilter) || matchesVoucherType(voucher.voucher_category, typeFilter)) && voucher.ledger_entries.some((entry: any) => isCashAccount(entry)))
      setVouchers(normalized)
    } catch (error) {
      console.error('Cash book load failed', error)
      toast.error(showTally ? 'Failed to load Tally cash book' : 'Failed to load Adamrit cash book')
      setVouchers([])
      setOpeningBalance(0)
    } finally {
      setLoading(false)
    }
  }, [showTally, companyId, companyName, dateFrom, dateTo, typeFilter])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setPage(0) }, [showTally, companyId, companyName, dateFrom, dateTo, typeFilter])

  useEffect(() => {
    if (!showTally || !companyId) return
    const channel = supabase.channel(`tally_cash_book_${companyId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tally_vouchers', filter: `company_id=eq.${companyId}` }, (payload) => {
      const voucher = payload.new as any
      const entries = Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []
      const matchesDate = (!dateFrom || voucher.date >= dateFrom) && (!dateTo || voucher.date <= dateTo)
      const matchesType = typeFilter === 'All' || matchesVoucherType(voucher.voucher_type, typeFilter)
      if (!matchesDate || !matchesType || !entries.some(isCashAccount)) return
      setVouchers((current) => {
        if (current.some((row) => row.id === voucher.id)) return current
        return [...current, voucher].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      })
    }).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [showTally, companyId, dateFrom, dateTo, typeFilter])

  const { rows, totalCashIn, totalCashOut, closingBalance } = useMemo(() => {
    let runningBalance = openingBalance
    let cashIn = 0
    let cashOut = 0
    const rows = vouchers.map((voucher: any) => {
      const entries = Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []
      let received = 0; let paid = 0
      entries.filter(isCashAccount).forEach((entry: any) => entry.is_debit ? received += Math.abs(Number(entry.amount) || 0) : paid += Math.abs(Number(entry.amount) || 0))
      cashIn += received; cashOut += paid; runningBalance += received - paid
      const against = entries.find((entry: any) => !isCashAccount(entry))?.ledger || voucher.party_ledger || '-'
      return { ...voucher, received, paid, runningBalance, againstLedger: against }
    })
    return { rows, totalCashIn: cashIn, totalCashOut: cashOut, closingBalance: runningBalance }
  }, [vouchers, openingBalance])
  const paginatedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  return <div className="space-y-4">
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      {[['Opening Balance', openingBalance, 'text-gray-900'], ['Total Cash In', totalCashIn, 'text-green-800'], ['Total Cash Out', totalCashOut, 'text-red-800'], ['Net Cash', totalCashIn - totalCashOut, 'text-blue-800'], ['Closing Balance', closingBalance, 'text-gray-900']].map(([label, value, color]) => <div key={label as string} className="bg-white rounded-xl shadow-sm border p-4"><p className="text-xs text-gray-500">{label as string}</p><p className={`text-lg font-bold mt-1 ${color as string}`}>{formatCurrency(value as number)}</p></div>)}
    </div>
    <div className="bg-white rounded-xl shadow-sm border p-4"><div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"><div><label className="block text-xs font-medium text-gray-600">Show Tally</label><p className="text-xs text-gray-400">{showTally ? 'Show cached Tally vouchers' : 'Show Adamrit vouchers only'}</p></div><Switch checked={showTally} onCheckedChange={setShowTally} /></div>
      <label className="text-xs font-medium text-gray-600">From Date<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" /></label>
      <label className="text-xs font-medium text-gray-600">To Date<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" /></label>
      <label className="text-xs font-medium text-gray-600">Voucher Type<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm">{VOUCHER_TYPES.map(type => <option key={type}>{type === 'All' ? 'All Types' : type}</option>)}</select></label>
      <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 ml-auto"><Printer className="h-4 w-4" />Print</button>
    </div></div>
    <div className="bg-white rounded-xl shadow-sm border"><div className="flex items-center justify-between p-4 border-b"><h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Banknote className="h-4 w-4 text-green-600" />Cash Book <span className="text-xs font-normal text-gray-500">({rows.length} entries)</span></h3>{loading && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}</div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b border-gray-200 bg-gray-50">{['Date', 'Voucher No', 'Type', 'Party', 'Received (Dr)', 'Paid (Cr)', 'Balance'].map((heading, index) => <th key={heading} className={`py-2.5 px-3 text-gray-600 font-medium ${index > 3 ? 'text-right' : 'text-left'}`}>{heading}</th>)}</tr></thead><tbody>
        <tr className="bg-blue-50 border-b border-blue-100"><td colSpan={4} className="py-2 px-3 font-medium text-blue-800">Opening Balance</td><td /><td /><td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(openingBalance)}</td></tr>
        {!loading && !paginatedRows.length && <tr><td colSpan={7} className="text-center py-12 text-gray-500">No {showTally ? 'Tally' : 'Adamrit'} cash transactions found for the selected period.</td></tr>}
        {paginatedRows.map((row: any, index: number) => <tr key={row.id} className={`border-b border-gray-100 hover:bg-gray-50 ${index % 2 ? 'bg-gray-50/50' : ''} ${row.is_cancelled ? 'opacity-50 line-through' : ''}`}><td className="py-2 px-3 whitespace-nowrap">{formatDate(row.date)}</td><td className="py-2 px-3 font-mono text-xs">{row.voucher_number || '-'}</td><td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">{row.voucher_type}</span></td><td className="py-2 px-3 max-w-[200px] truncate">{row.againstLedger}</td><td className="py-2 px-3 text-right text-green-700 font-medium">{row.received ? formatCurrency(row.received) : ''}</td><td className="py-2 px-3 text-right text-red-600 font-medium">{row.paid ? formatCurrency(row.paid) : ''}</td><td className="py-2 px-3 text-right font-medium">{formatCurrency(row.runningBalance)}</td></tr>)}
        {!!rows.length && <tr className="bg-blue-50 border-t-2 border-blue-200"><td colSpan={4} className="py-2 px-3 font-bold text-blue-800">Closing Balance</td><td className="py-2 px-3 text-right font-bold text-green-700">{formatCurrency(totalCashIn)}</td><td className="py-2 px-3 text-right font-bold text-red-600">{formatCurrency(totalCashOut)}</td><td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(closingBalance)}</td></tr>}
      </tbody></table></div>
      {totalPages > 1 && <div className="flex items-center justify-between p-4 border-t"><p className="text-xs text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}</p><div className="flex items-center gap-1"><button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!page} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="px-3 py-1 text-xs">Page {page + 1} of {totalPages}</span><button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>}
    </div>
  </div>
}
