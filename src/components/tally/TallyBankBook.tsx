import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import { Landmark, Loader2, Printer, ChevronDown, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { Switch } from '@/components/ui/switch'

const PAGE_SIZE = 50
const VOUCHER_TYPES = ['All', 'Sales', 'Receipt', 'Payment', 'Journal', 'Contra']
const companyKey = (value: string | null | undefined) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const isBankAccount = (account: any) => `${account?.account_name || account?.ledger || ''} ${account?.account_group || ''} ${account?.account_type || ''}`.toLowerCase().includes('bank')
const signedOpening = (account: any) => (Number(account?.opening_balance) || 0) * (account?.opening_balance_type?.toUpperCase() === 'CR' ? -1 : 1)
const matchesVoucherType = (value: string | null | undefined, filter: string) => filter === 'All' || (value || '').toLowerCase().includes(filter.toLowerCase())
const formatCurrency = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value || 0)
const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

export default function TallyBankBook({ companyName, companyId }: { serverUrl?: string; companyName?: string; companyId?: string }) {
  const [showTally, setShowTally] = useState(true)
  const [banks, setBanks] = useState<any[]>([])
  const [selectedBank, setSelectedBank] = useState('')
  const [vouchers, setVouchers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')

  const loadBanks = useCallback(async () => {
    setLoading(true)
    try {
      let rows: any[] = []
      if (showTally) {
        const { data, error } = await (supabase as any).from('tally_ledgers').select('name, opening_balance, closing_balance, parent_group').eq('company_id', companyId || '').order('name')
        if (error) throw error
        rows = (data || []).filter((ledger: any) => isBankAccount({ account_name: ledger.name, account_group: ledger.parent_group }))
      } else {
        const { data: companyRows, error: companyError } = await (supabase as any).from('companies').select('id, company_name').eq('is_active', true)
        if (companyError) throw companyError
        const accountingCompany = (companyRows || []).find((company: any) => companyKey(company.company_name) === companyKey(companyName))
        if (accountingCompany) {
          const { data, error } = await (supabase as any).from('chart_of_accounts').select('id, account_name, account_group, account_type, opening_balance, opening_balance_type').eq('company_id', accountingCompany.id).eq('is_active', true).order('account_name')
          if (error) throw error
          rows = (data || []).filter(isBankAccount).map((account: any) => ({ name: account.account_name, opening_balance: signedOpening(account), closing_balance: signedOpening(account) }))
        }
      }
      setBanks(rows)
      setSelectedBank(current => rows.some((bank: any) => bank.name === current) ? current : (rows[0]?.name || ''))
    } catch (error) {
      console.error('Bank accounts load failed', error)
      toast.error(showTally ? 'Failed to load Tally bank accounts' : 'Failed to load Adamrit bank accounts')
      setBanks([]); setSelectedBank('')
    } finally { setLoading(false) }
  }, [showTally, companyId, companyName])

  useEffect(() => { loadBanks() }, [loadBanks])
  useEffect(() => { setPage(0) }, [showTally, selectedBank, dateFrom, dateTo, typeFilter])

  const fetchVouchers = useCallback(async () => {
    if (!selectedBank) { setVouchers([]); return }
    setLoading(true)
    try {
      const bank = banks.find((row: any) => row.name === selectedBank)
      if (showTally) {
        let query: any = (supabase as any).from('tally_vouchers').select('*').eq('company_id', companyId || '').order('date', { ascending: true }).limit(2000)
        if (dateFrom) query = query.gte('date', dateFrom)
        if (dateTo) query = query.lte('date', dateTo)
        if (typeFilter !== 'All') query = query.eq('voucher_type', typeFilter)
        const { data, error } = await query
        if (error) throw error
        setVouchers((data || []).filter((voucher: any) => (Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []).some((entry: any) => (entry.ledger || '').toLowerCase() === selectedBank.toLowerCase())))
        return
      }
      const { data: companyRows, error: companyError } = await (supabase as any).from('companies').select('id, company_name').eq('is_active', true)
      if (companyError) throw companyError
      const accountingCompany = (companyRows || []).find((company: any) => companyKey(company.company_name) === companyKey(companyName))
      if (!accountingCompany) { setVouchers([]); return }
      let query: any = (supabase as any).from('vouchers').select('id, voucher_number, voucher_date, narration, status, created_at, voucher_type:voucher_types(voucher_type_name, voucher_category), voucher_entries(debit_amount, credit_amount, account:chart_of_accounts(account_name))').eq('company_id', accountingCompany.id).order('voucher_date', { ascending: true }).limit(2000)
      if (dateFrom) query = query.gte('voucher_date', dateFrom)
      if (dateTo) query = query.lte('voucher_date', dateTo)
      const { data, error } = await query
      if (error) throw error
      const normalized = (data || []).map((voucher: any) => ({ id: `adamrit:${voucher.id}`, date: voucher.voucher_date, voucher_number: voucher.voucher_number, voucher_type: voucher.voucher_type?.voucher_type_name || voucher.voucher_type?.voucher_category || '-', voucher_category: voucher.voucher_type?.voucher_category || '', party_ledger: null, narration: voucher.narration, is_cancelled: voucher.status === 'cancelled', ledger_entries: (voucher.voucher_entries || []).map((entry: any) => ({ ledger: entry.account?.account_name || '', amount: Number(entry.debit_amount || entry.credit_amount || 0), is_debit: Number(entry.debit_amount || 0) > 0 })) })).filter((voucher: any) => (matchesVoucherType(voucher.voucher_type, typeFilter) || matchesVoucherType(voucher.voucher_category, typeFilter)) && voucher.ledger_entries.some((entry: any) => (entry.ledger || '').toLowerCase() === selectedBank.toLowerCase()))
      setVouchers(normalized)
    } catch (error) {
      console.error('Bank book load failed', error)
      toast.error(showTally ? 'Failed to load Tally bank book' : 'Failed to load Adamrit bank book')
      setVouchers([])
    } finally { setLoading(false) }
  }, [showTally, selectedBank, banks, companyId, companyName, dateFrom, dateTo, typeFilter])

  useEffect(() => { fetchVouchers() }, [fetchVouchers])

  const openingBalance = Number(banks.find((bank: any) => bank.name === selectedBank)?.opening_balance) || 0
  const { rows, totalDeposit, totalWithdrawal, closingBalance } = useMemo(() => {
    let runningBalance = openingBalance; let deposit = 0; let withdrawal = 0
    const bankName = selectedBank.toLowerCase()
    const rows = vouchers.map((voucher: any) => {
      const entries = Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []
      let received = 0; let paid = 0
      entries.filter((entry: any) => (entry.ledger || '').toLowerCase() === bankName).forEach((entry: any) => entry.is_debit ? received += Math.abs(Number(entry.amount) || 0) : paid += Math.abs(Number(entry.amount) || 0))
      deposit += received; withdrawal += paid; runningBalance += received - paid
      return { ...voucher, deposit: received, withdrawal: paid, runningBalance, againstLedger: entries.find((entry: any) => (entry.ledger || '').toLowerCase() !== bankName)?.ledger || voucher.party_ledger || '-' }
    })
    return { rows, totalDeposit: deposit, totalWithdrawal: withdrawal, closingBalance: runningBalance }
  }, [vouchers, openingBalance, selectedBank])
  const bankSummary = useMemo(() => banks.map((bank: any) => ({ name: bank.name, balance: Number(bank.closing_balance ?? bank.opening_balance) || 0 })), [banks])
  const paginatedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)

  return <div className="space-y-4">
    {!!bankSummary.length && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{bankSummary.map(bank => <button key={bank.name} onClick={() => setSelectedBank(bank.name)} className={`rounded-xl border p-4 text-left transition-colors ${selectedBank === bank.name ? 'bg-blue-50 border-blue-300' : 'bg-white shadow-sm hover:bg-gray-50'}`}><p className="text-xs text-gray-500 truncate">{bank.name}</p><p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(bank.balance)}</p></button>)}</div>}
    <div className="bg-white rounded-xl shadow-sm border p-4"><div className="flex flex-wrap items-end gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"><div><label className="block text-xs font-medium text-gray-600">Show Tally</label><p className="text-xs text-gray-400">{showTally ? 'Show cached Tally vouchers' : 'Show Adamrit vouchers only'}</p></div><Switch checked={showTally} onCheckedChange={setShowTally} /></div>
      <label className="text-xs font-medium text-gray-600">Bank Account<div className="relative mt-1"><select value={selectedBank} onChange={e => setSelectedBank(e.target.value)} className="pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm bg-white appearance-none min-w-[200px]">{!banks.length && <option value="">No bank account</option>}{banks.map((bank: any) => <option key={bank.name} value={bank.name}>{bank.name}</option>)}</select><ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" /></div></label>
      <label className="text-xs font-medium text-gray-600">From Date<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" /></label>
      <label className="text-xs font-medium text-gray-600">To Date<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm" /></label>
      <label className="text-xs font-medium text-gray-600">Voucher Type<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm">{VOUCHER_TYPES.map(type => <option key={type}>{type === 'All' ? 'All Types' : type}</option>)}</select></label>
      <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 ml-auto"><Printer className="h-4 w-4" />Print</button>
    </div></div>
    <div className="bg-white rounded-xl shadow-sm border"><div className="flex items-center justify-between p-4 border-b"><h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Landmark className="h-4 w-4 text-blue-600" />Bank Book — {selectedBank || 'Select a bank'} <span className="text-xs font-normal text-gray-500">({rows.length} entries)</span></h3>{loading && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}</div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="border-b border-gray-200 bg-gray-50">{['Date', 'Voucher No', 'Type', 'Party', 'Deposit (Dr)', 'Withdrawal (Cr)', 'Balance', 'Reconciled'].map((heading, index) => <th key={heading} className={`py-2.5 px-3 text-gray-600 font-medium ${index > 3 ? 'text-right' : 'text-left'}`}>{heading}</th>)}</tr></thead><tbody>
        <tr className="bg-blue-50 border-b border-blue-100"><td colSpan={4} className="py-2 px-3 font-medium text-blue-800">Opening Balance</td><td /><td /><td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(openingBalance)}</td><td /></tr>
        {!loading && !paginatedRows.length && <tr><td colSpan={8} className="text-center py-12 text-gray-500">No {showTally ? 'Tally' : 'Adamrit'} bank transactions found for the selected period.</td></tr>}
        {paginatedRows.map((row: any, index: number) => <tr key={row.id} className={`border-b border-gray-100 hover:bg-gray-50 ${index % 2 ? 'bg-gray-50/50' : ''} ${row.is_cancelled ? 'opacity-50 line-through' : ''}`}><td className="py-2 px-3 whitespace-nowrap">{formatDate(row.date)}</td><td className="py-2 px-3 font-mono text-xs">{row.voucher_number || '-'}</td><td className="py-2 px-3"><span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">{row.voucher_type}</span></td><td className="py-2 px-3 max-w-[200px] truncate">{row.againstLedger}</td><td className="py-2 px-3 text-right text-green-700 font-medium">{row.deposit ? formatCurrency(row.deposit) : ''}</td><td className="py-2 px-3 text-right text-red-600 font-medium">{row.withdrawal ? formatCurrency(row.withdrawal) : ''}</td><td className="py-2 px-3 text-right font-medium">{formatCurrency(row.runningBalance)}</td><td className="py-2 px-3 text-center"><span className="inline-flex items-center gap-1 text-xs text-yellow-600"><Clock className="h-3 w-3" />Pending</span></td></tr>)}
        {!!rows.length && <tr className="bg-blue-50 border-t-2 border-blue-200"><td colSpan={4} className="py-2 px-3 font-bold text-blue-800">Closing Balance</td><td className="py-2 px-3 text-right font-bold text-green-700">{formatCurrency(totalDeposit)}</td><td className="py-2 px-3 text-right font-bold text-red-600">{formatCurrency(totalWithdrawal)}</td><td className="py-2 px-3 text-right font-bold text-blue-800">{formatCurrency(closingBalance)}</td><td /></tr>}
      </tbody></table></div>
      {totalPages > 1 && <div className="flex items-center justify-between p-4 border-t"><p className="text-xs text-gray-500">Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}</p><div className="flex items-center gap-1"><button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!page} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="px-3 py-1 text-xs">Page {page + 1} of {totalPages}</span><button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1.5 rounded-lg border disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>}
    </div>
  </div>
}
