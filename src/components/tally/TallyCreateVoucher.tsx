import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import { PlusCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { isUuid } from '@/utils/visitId'
import { useCompanies } from '@/hooks/useCompanies'
import { createAccountingVoucher } from '@/lib/accounting-voucher-service'

interface Ledger {
  id: string
  name: string
  parent_group: string | null
}
interface VoucherLedgerEntry {
  ledger?: string
  ledgerName?: string
  amount?: number
  is_debit?: boolean
  isDebit?: boolean
}

interface VoucherHistory {
  id: string
  voucher_number: string | null
  voucher_type: string | null
  date: string | null
  party_ledger: string | null
  amount: number | null
  narration: string | null
  ledger_entries: VoucherLedgerEntry[] | null
  created_at?: string | null
  source?: 'tally' | 'accounting'
  voucher_category?: string | null
}

interface Props {
  serverUrl: string
  companyName: string
  companyId: string
  voucherCategory?: 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'PURCHASE'
}

const PAGE_SIZE = 1000

async function fetchAllPages<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await buildQuery().range(from, to)

    if (error) throw error

    const page = (data || []) as T[]
    rows.push(...page)

    if (page.length < PAGE_SIZE) break
  }

  return rows
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

const TODAY = today()

function formatINR(amount: number | null | undefined): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function getLedgerName(entry: VoucherLedgerEntry): string {
  return entry.ledger || entry.ledgerName || ''
}

function ledgerMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase()
}

function voucherHasLedger(voucher: VoucherHistory, ledgerName: string): boolean {
  if (!ledgerName) return false
  if (ledgerMatches(voucher.party_ledger, ledgerName)) return true
  return (voucher.ledger_entries || []).some((entry) => ledgerMatches(getLedgerName(entry), ledgerName))
}

function getCounterpartyLedger(voucher: VoucherHistory, accountLedger: string): string {
  const otherEntry = (voucher.ledger_entries || []).find((entry) => getLedgerName(entry) && !ledgerMatches(getLedgerName(entry), accountLedger))
  return getLedgerName(otherEntry || {}) || voucher.party_ledger || ''
}

function isReceivedPaymentVoucher(voucher: VoucherHistory): boolean {
  const type = (voucher.voucher_type || '').toLowerCase()
  const category = (voucher.voucher_category || '').toLowerCase()
  return category === 'receipt' || type.includes('receipt') || type.includes('received')
}

function looksLikeUuid(value: string | null | undefined): boolean {
  return isUuid(value)
}

function getDisplayVoucherNumber(voucher: VoucherHistory): string {
  if (voucher.voucher_number && !looksLikeUuid(voucher.voucher_number)) return voucher.voucher_number
  if (voucher.source === 'accounting') return 'HMS Receipt'
  return 'Tally Voucher'
}

function isOnOrBeforeToday(voucher: VoucherHistory): boolean {
  if (!voucher.date) return true
  return voucher.date <= TODAY
}

function getAccountLedgerEntry(voucher: VoucherHistory, accountLedger: string): VoucherLedgerEntry | null {
  return (voucher.ledger_entries || []).find((entry) => ledgerMatches(getLedgerName(entry), accountLedger)) || null
}

function getVoucherFlow(voucher: VoucherHistory, accountLedger: string): 'debit' | 'credit' {
  const accountEntry = getAccountLedgerEntry(voucher, accountLedger)
  const isDebit = accountEntry?.is_debit ?? accountEntry?.isDebit
  if (typeof isDebit === 'boolean') return isDebit ? 'debit' : 'credit'

  const type = (voucher.voucher_type || '').toLowerCase()
  if (type.includes('receipt') || type.includes('received')) return 'debit'
  if (type.includes('payment')) return 'credit'
  return 'debit'
}

export default function TallyCreateVoucher({ serverUrl, companyName, companyId, voucherCategory = 'PAYMENT' }: Props) {
  const { data: companies = [] } = useCompanies()
  const [allLedgers, setAllLedgers] = useState<Ledger[]>([])
  const [loadingLedgers, setLoadingLedgers] = useState(false)
  const [accountingCompanyId, setAccountingCompanyId] = useState('')

  const [form, setForm] = useState({
    paymentNo: '',
    account: '',
    date: today(),
    amount: '',
    particulars: '',
    narration: '',
  })
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [voucherHistory, setVoucherHistory] = useState<VoucherHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedHistoryId, setSelectedHistoryId] = useState('')
  const voucherTitle = `${voucherCategory.charAt(0)}${voucherCategory.slice(1).toLowerCase()} Voucher`
  const cashBankMode = voucherCategory === 'PAYMENT' || voucherCategory === 'RECEIPT'

  useEffect(() => {
    if (!companies.length) return
    const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const matching = companies.find((item) => key(item.company_name) === key(companyName))
    setAccountingCompanyId((current) => current || matching?.id || companies[0].id)
  }, [companies, companyName])

  const loadVoucherHistory = useCallback(async () => {
    if (!companyId || !accountingCompanyId) return

    setLoadingHistory(true)
    try {
      const tallyRows = await fetchAllPages<VoucherHistory>(() =>
        supabase
          .from('tally_vouchers')
          .select('id, voucher_number, voucher_type, date, party_ledger, amount, narration, ledger_entries, created_at')
          .eq('company_id', companyId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(200)
      )

      const receiptRows: VoucherHistory[] = []

      try {
        const accountingEntries = await fetchAllPages<any>(() =>
          supabase
            .from('voucher_entries')
            .select(`
              id,
              narration,
              debit_amount,
              credit_amount,
              account:chart_of_accounts(account_name),
              voucher:vouchers(
                id,
                voucher_number,
                voucher_date,
                narration,
                total_amount,
                company_id,
                status,
                created_at,
                patient:patients(name),
                voucher_type:voucher_types(voucher_type_name, voucher_category)
              )
            `)
            .order('created_at', { ascending: false })
            .limit(500)
        )

        accountingEntries.forEach((entry: any) => {
          const voucher = entry.voucher
          const voucherType = voucher?.voucher_type
          const accountName = entry.account?.account_name || ''
          const typeName = voucherType?.voucher_type_name || 'Receipt Voucher'
          const category = voucherType?.voucher_category || ''

          if (!voucher || voucher.company_id !== accountingCompanyId || voucher.status === 'CANCELLED') return
          if (category !== 'RECEIPT' && !typeName.toLowerCase().includes('receipt')) return

          receiptRows.push({
            id: `accounting:${voucher.id}:${entry.id}`,
            voucher_number: voucher.voucher_number || null,
            voucher_type: typeName,
            voucher_category: category,
            date: voucher.voucher_date || null,
            party_ledger: accountName,
            amount: Number(voucher.total_amount || entry.debit_amount || entry.credit_amount || 0),
            narration: voucher.narration || entry.narration || voucher.patient?.name || null,
            ledger_entries: [
              { ledger: accountName, amount: Number(entry.debit_amount || entry.credit_amount || 0) },
              { ledger: voucher.patient?.name || voucher.narration || 'Received Payment', amount: Number(voucher.total_amount || 0) },
            ],
            created_at: voucher.created_at || null,
            source: 'accounting',
          })
        })
      } catch (receiptErr: any) {
        console.warn('[VoucherHistory] accounting receipt vouchers skipped:', receiptErr?.message || receiptErr)
      }

      const rows = [...tallyRows.map((row) => ({ ...row, source: 'tally' as const })), ...receiptRows]
        .sort((a, b) => {
          const aDate = new Date(a.date || a.created_at || 0).getTime()
          const bDate = new Date(b.date || b.created_at || 0).getTime()
          return bDate - aDate
        })

      setVoucherHistory(rows)
    } catch (err: any) {
      console.error('[VoucherHistory] load failed:', err?.message || err)
      toast.warning('Could not load voucher history')
    } finally {
      setLoadingHistory(false)
    }
  }, [companyId, accountingCompanyId])

  // ── Ledger fetch ──────────────────────────────────────────────
  const loadLedgers = useCallback(async () => {
    setLoadingLedgers(true)
    if (!accountingCompanyId) {
      setAllLedgers([])
      setLoadingLedgers(false)
      return
    }
    const ledgers = await fetchAllPages<Ledger>(() =>
      supabase
        .from('chart_of_accounts')
        .select('id, account_name, account_group')
        .eq('company_id', accountingCompanyId)
        .eq('is_active', true)
        .order('account_name')
        .limit(1000)
    )
    const normalized = ledgers.map((ledger: any) => ({
      id: ledger.id,
      name: ledger.account_name,
      parent_group: ledger.account_group,
    }))

    if (normalized.length > 0) {
      setAllLedgers(normalized)
    } else {
      toast.warning('No Adamrit ledger accounts are available for this company yet.')
    }

    setLoadingLedgers(false)
  }, [accountingCompanyId])

  useEffect(() => {
    if (accountingCompanyId) loadLedgers()
  }, [accountingCompanyId, loadLedgers])

  useEffect(() => {
    setSelectedHistoryId('')
    setForm((current) => ({ ...current, account: '', particulars: '' }))
  }, [accountingCompanyId])

  useEffect(() => {
    setSelectedHistoryId('')
    setLastSaved(null)
    setForm((current) => ({ ...current, paymentNo: '', account: '', amount: '', particulars: '', narration: '' }))
  }, [voucherCategory])

  useEffect(() => {
    loadVoucherHistory()
  }, [loadVoucherHistory])

  // ── Group ledgers by parent_group for optgroup selects ───────
  const ledgerOptions: SearchableSelectOption[] = allLedgers.map((ledger) => ({
    value: ledger.name,
    label: ledger.parent_group ? `${ledger.name} (${ledger.parent_group})` : ledger.name,
    selectedLabel: ledger.name,
  }))

  const cashBankOptions = ledgerOptions.filter((option) => {
    const ledger = allLedgers.find((item) => item.name === option.value)
    const group = (ledger?.parent_group || '').toLowerCase()
    const name = option.value.toLowerCase()
    return group.includes('bank') || group.includes('cash') || name.includes('bank') || name.includes('cash')
  })

  const accountOptions = cashBankMode ? cashBankOptions : ledgerOptions

  const particularsOptions = ledgerOptions.filter((option) => option.value !== form.account)

  const accountVoucherHistory = useMemo(
    () => voucherHistory.filter((voucher) => voucherHasLedger(voucher, form.account)),
    [voucherHistory, form.account]
  )

  const accountVoucherTotal = useMemo(
    () => accountVoucherHistory.reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0),
    [accountVoucherHistory]
  )

  const receivedPaymentHistory = useMemo(
    () => accountVoucherHistory.filter((voucher) => isReceivedPaymentVoucher(voucher) && isOnOrBeforeToday(voucher)),
    [accountVoucherHistory]
  )

  const receivedPaymentTotal = useMemo(
    () => receivedPaymentHistory.reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0),
    [receivedPaymentHistory]
  )

  const receivedPaymentStatement = useMemo(() => {
    let runningTotal = 0

    return [...receivedPaymentHistory]
      .sort((a, b) => {
        const aDate = new Date(a.date || a.created_at || 0).getTime()
        const bDate = new Date(b.date || b.created_at || 0).getTime()
        return aDate - bDate
      })
      .map((voucher) => {
        const amount = Number(voucher.amount || 0)
        runningTotal += amount
        return {
          ...voucher,
          displayDate: voucher.date ? new Date(`${voucher.date}T00:00:00`).toLocaleDateString('en-IN') : 'No date',
          displayVoucherNo: getDisplayVoucherNumber(voucher),
          displayParticulars: getCounterpartyLedger(voucher, form.account) || voucher.narration || 'Received Payment',
          runningTotal,
        }
      })
      .reverse()
  }, [receivedPaymentHistory, form.account])

  const accountStatement = useMemo(() => {
    let runningBalance = 0

    return accountVoucherHistory
      .filter(isOnOrBeforeToday)
      .sort((a, b) => {
        const aDate = new Date(a.date || a.created_at || 0).getTime()
        const bDate = new Date(b.date || b.created_at || 0).getTime()
        return aDate - bDate
      })
      .map((voucher) => {
        const amount = Number(voucher.amount || 0)
        const flow = getVoucherFlow(voucher, form.account)
        const debit = flow === 'debit' ? amount : 0
        const credit = flow === 'credit' ? amount : 0
        runningBalance += debit - credit

        return {
          ...voucher,
          displayDate: voucher.date ? new Date(`${voucher.date}T00:00:00`).toLocaleDateString('en-IN') : 'No date',
          displayVoucherNo: getDisplayVoucherNumber(voucher),
          displayParticulars: getCounterpartyLedger(voucher, form.account) || voucher.narration || voucher.voucher_type || 'Voucher',
          debit,
          credit,
          runningBalance,
        }
      })
      .reverse()
  }, [accountVoucherHistory, form.account])

  const voucherHistoryOptions: SearchableSelectOption[] = accountVoucherHistory.map((voucher) => {
    const counterparty = getCounterpartyLedger(voucher, form.account)
    const date = voucher.date ? new Date(`${voucher.date}T00:00:00`).toLocaleDateString('en-IN') : 'No date'
    const voucherNo = getDisplayVoucherNumber(voucher)
    const typeLabel = isReceivedPaymentVoucher(voucher) ? 'Received Payment' : voucher.voucher_type || 'Voucher'

    return {
      value: voucher.id,
      label: `${date} | ${typeLabel} | ${voucherNo} | ${counterparty || 'No particulars'} | ${formatINR(voucher.amount)}`,
      selectedLabel: `${typeLabel} ${voucherNo} - ${formatINR(voucher.amount)}`,
    }
  })

  function applyVoucherHistory(voucherId: string) {
    const voucher = accountVoucherHistory.find((item) => item.id === voucherId)
    if (!voucher) return

    const counterparty = getCounterpartyLedger(voucher, form.account)
    setSelectedHistoryId(voucherId)
    setForm((current) => ({
      ...current,
      amount: voucher.amount != null ? String(voucher.amount) : current.amount,
      particulars: counterparty || current.particulars,
      narration: voucher.narration || current.narration,
    }))
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!accountingCompanyId) { toast.error('Select an Adamrit company first'); return }
    if (!form.account) { toast.error('Select an Account'); return }
    if (!form.particulars) { toast.error('Select Particulars'); return }
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }

    setSaving(true)
    try {
      const account = allLedgers.find((ledger) => ledger.name === form.account)
      const particulars = allLedgers.find((ledger) => ledger.name === form.particulars)
      if (!account || !particulars) throw new Error('Select valid company ledger accounts')
      const voucher = await createAccountingVoucher({
        companyId: accountingCompanyId,
        category: voucherCategory,
        date: form.date,
        voucherNumber: form.paymentNo,
        narration: form.narration || `${voucherTitle} - ${form.particulars}`,
        entries: voucherCategory === 'RECEIPT'
          ? [
              { accountId: account.id, debitAmount: amount, creditAmount: 0 },
              { accountId: particulars.id, debitAmount: 0, creditAmount: amount },
            ]
          : [
              { accountId: particulars.id, debitAmount: amount, creditAmount: 0 },
              { accountId: account.id, debitAmount: 0, creditAmount: amount },
            ],
      })

      toast.success(`Voucher ${voucher.voucher_number} saved in Adamrit`)
      setLastSaved(voucher.voucher_number)
      await loadVoucherHistory()
      setForm({ paymentNo: '', account: form.account, date: form.date, amount: '', particulars: '', narration: '' })
    } catch (err: any) {
      toast.error(err.message || 'Failed to save voucher')
    } finally {
      setSaving(false)
    }
  }

  // ── UI ────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl space-y-6">

      {/* Ledger status bar */}
      <div className="flex items-center justify-between bg-white border rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {loadingLedgers && <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /><span className="text-blue-700">Loading Adamrit ledger accounts...</span></>}
          {!loadingLedgers && allLedgers.length > 0 && <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-green-700">Adamrit ledger accounts loaded ({allLedgers.length})</span></>}
          {!loadingLedgers && allLedgers.length === 0 && <span className="text-amber-700">No Adamrit ledger accounts are available for this company.</span>}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(520px,0.95fr)]">
        {/* Form */}
        <div className="bg-white border rounded-xl p-6 space-y-5">
          <h3 className="text-base font-semibold text-gray-900">New {voucherTitle}</h3>
          <p className="text-xs text-gray-500">This saves in Adamrit first. Export it later and import it into Tally manually.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Create for company <span className="text-red-500">*</span></label>
            <select
              value={accountingCompanyId}
              onChange={(event) => setAccountingCompanyId(event.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select Adamrit company</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
            </select>
          </div>
          {/* Payment Number */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Payment Number <span className="text-gray-400">(optional — auto-generated if blank)</span>
            </label>
            <input
              type="text"
              value={form.paymentNo}
              onChange={e => setForm(f => ({ ...f, paymentNo: e.target.value }))}
              placeholder="e.g. PV-001"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Account — searchable via datalist */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {cashBankMode ? 'Account (Cash / Bank)' : 'Credit Account'} <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={accountOptions}
            value={form.account}
            onValueChange={(value) => {
              setSelectedHistoryId('')
              setForm(f => ({ ...f, account: value }))
            }}
            placeholder={loadingLedgers ? 'Loading accounts...' : 'Select account'}
            searchPlaceholder={cashBankMode ? 'Search cash or bank accounts...' : 'Search credit account...'}
            emptyText={loadingLedgers ? 'Loading accounts...' : 'No matching account found'}
            disabled={loadingLedgers || allLedgers.length === 0}
            className="h-11 justify-between"
          />
          {allLedgers.length === 0 && !loadingLedgers && (
            <p className="text-xs text-amber-600 mt-1">No Adamrit ledger accounts are available for the selected company.</p>
          )}
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
          <input
            type="number"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Particulars — searchable via datalist */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            {cashBankMode ? 'Particulars' : 'Debit Account'} <span className="text-red-500">*</span>
          </label>
          <SearchableSelect
            options={particularsOptions}
            value={form.particulars}
            onValueChange={(value) => setForm(f => ({ ...f, particulars: value }))}
            placeholder={loadingLedgers ? 'Loading particulars...' : 'Select particulars'}
            searchPlaceholder={cashBankMode ? 'Search particulars (e.g. Salary, Maintenance)...' : 'Search debit account...'}
            emptyText={loadingLedgers ? 'Loading particulars...' : 'No matching ledger found'}
            disabled={loadingLedgers || allLedgers.length === 0}
            className="h-11 justify-between"
          />
        </div>

        {/* Narration */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Narration</label>
          <textarea
            value={form.narration}
            onChange={e => setForm(f => ({ ...f, narration: e.target.value }))}
            placeholder="Reason for payment…"
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSubmit}
            disabled={saving || loadingLedgers}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save in Adamrit'}
          </button>

          {lastSaved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Saved in Adamrit: {lastSaved}
            </span>
          )}
        </div>
      </div>

        {/* Voucher History */}
        <aside className="bg-white border rounded-xl p-6 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Voucher History</h3>
            <p className="mt-1 text-xs text-gray-500">
              {form.account
                ? `${accountVoucherHistory.length} dynamic entries for ${form.account}`
                : 'Select an account to view account-wise voucher history.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Total</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{formatINR(accountVoucherTotal)}</p>
            </div>
            <div className="rounded-lg border bg-emerald-50 px-3 py-2">
              <p className="text-xs text-emerald-700">Received Payments</p>
              <p className="mt-1 text-sm font-semibold text-emerald-900">{formatINR(receivedPaymentTotal)}</p>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-100 bg-white px-3 py-2">
            <p className="text-xs text-gray-500">Received payment vouchers</p>
            <p className="mt-1 text-sm font-medium text-gray-900">
              {form.account ? `${receivedPaymentHistory.length} entries till today` : 'Select account first'}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Account Voucher History
            </label>
            <SearchableSelect
              options={voucherHistoryOptions}
              value={selectedHistoryId}
              onValueChange={applyVoucherHistory}
              placeholder={
                !form.account
                  ? 'Select account first'
                  : loadingHistory
                    ? 'Loading voucher history...'
                    : `Select ${form.account} voucher`
              }
              searchPlaceholder="Search voucher no, type, particulars, amount..."
              emptyText={
                !form.account
                  ? 'Select an account to view voucher history'
                  : loadingHistory
                    ? 'Loading voucher history...'
                    : 'No voucher history found for this account'
              }
              disabled={!form.account || loadingHistory || voucherHistoryOptions.length === 0}
              className="h-11 justify-between"
            />
            <div className="mt-3 rounded-lg border bg-gray-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-500">Shown in dropdown</span>
                <span className="font-medium text-gray-900">{accountVoucherHistory.length} vouchers</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-500">Total amount</span>
                <span className="font-semibold text-gray-900">{formatINR(accountVoucherTotal)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-xs">
                <span className="text-emerald-700">Received payment total</span>
                <span className="font-semibold text-emerald-900">{formatINR(receivedPaymentTotal)}</span>
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Payment, Receipt, and received payment vouchers linked to the selected account are shown here with exact totals.
            </p>
          </div>

          <div className="rounded-lg border">
            <div className="border-b bg-gray-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">Account Statement</p>
                <p className="text-xs font-semibold text-gray-900">
                  Balance {formatINR(accountStatement[0]?.runningBalance || 0)}
                </p>
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">Showing vouchers dated up to today</p>
            </div>

            {!form.account ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                Select an account to view statement.
              </div>
            ) : accountStatement.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                No payment history found for this account till today.
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto">
                <div className="sticky top-0 z-10 grid grid-cols-[82px_minmax(0,1fr)_82px_82px_96px] gap-2 border-b bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                  <span>Date</span>
                  <span>Particulars</span>
                  <span className="text-right">Debit</span>
                  <span className="text-right">Credit</span>
                  <span className="text-right">Balance</span>
                </div>
                {accountStatement.map((voucher) => (
                  <button
                    key={voucher.id}
                    type="button"
                    onClick={() => applyVoucherHistory(voucher.id)}
                    className="grid w-full grid-cols-[82px_minmax(0,1fr)_82px_82px_96px] gap-2 border-b px-3 py-2 text-left text-xs hover:bg-blue-50"
                  >
                    <span className="text-gray-600">{voucher.displayDate}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">{voucher.displayParticulars}</span>
                      <span className="block truncate text-[11px] text-gray-500">{voucher.displayVoucherNo}</span>
                    </span>
                    <span className="text-right font-semibold text-emerald-700">
                      {voucher.debit ? formatINR(voucher.debit) : '-'}
                    </span>
                    <span className="text-right font-semibold text-red-700">
                      {voucher.credit ? formatINR(voucher.credit) : '-'}
                    </span>
                    <span className="text-right font-semibold text-gray-900">
                      {formatINR(voucher.runningBalance)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

