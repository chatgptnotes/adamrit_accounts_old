
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import * as XLSX from 'xlsx'
import { buildTallyVoucherImportXml, downloadTallyVoucherImport } from '@/lib/tally-voucher-export'
import {
  FileText, FileSpreadsheet, ArrowDownToLine, ArrowUpFromLine, CheckCircle, XCircle,
  Clock, AlertTriangle, ChevronLeft, ChevronRight, X, Search, Filter,
  Loader2, Edit3, Trash2, AlertCircle, Download
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'

const PAGE_SIZE = 25

const VOUCHER_TYPES = [
  'All', 'Sales', 'Purchase', 'Receipt', 'Payment',
  'Journal', 'Contra', 'DebitNote', 'CreditNote',
]

const SYNC_STATUSES = ['All', 'local', 'synced', 'pending', 'failed', 'conflict']

function companyKey(value: string | null | undefined) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(val || 0)
}

function formatDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function truncate(str: string | null, len = 40) {
  if (!str) return '-'
  return str.length > len ? str.slice(0, len) + '...' : str
}

function getPartyName(v: any): string {
  const partyLedger = (v.party_ledger || '').toLowerCase()
  const isBankOrCash = partyLedger.includes('bank') || partyLedger === 'cash' || partyLedger.includes('cash-in-hand')

  if (!isBankOrCash && v.party_ledger) return v.party_ledger

  const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
  const against = entries.find(e => {
    const n = (e.ledger || '').toLowerCase()
    return !n.includes('bank') && n !== 'cash' && !n.includes('cash-in-hand')
  })
  return against?.ledger || v.party_ledger || '-'
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    local: 'bg-violet-100 text-violet-700',
    synced: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    failed: 'bg-red-100 text-red-700',
    conflict: 'bg-orange-100 text-orange-700',
  }
  const icons = {
    local: <FileText className="h-3 w-3" />,
    synced: <CheckCircle className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
    failed: <XCircle className="h-3 w-3" />,
    conflict: <AlertTriangle className="h-3 w-3" />,
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {icons[status] || null}
      {status}
    </span>
  )
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === 'adamrit_local') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">
        <FileText className="h-3 w-3" /> Adamrit / Local
      </span>
    )
  }
  if (direction === 'from_tally') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
        <ArrowDownToLine className="h-3 w-3" /> From Tally
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
      <ArrowUpFromLine className="h-3 w-3" /> To Tally
    </span>
  )
}

function EditVoucherModal({ voucher, serverUrl, companyName, onClose, onSaved }: any) {
  const entries = Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []
  const [form, setForm] = useState({
    date: voucher.date || '',
    partyLedger: voucher.party_ledger || '',
    narration: voucher.narration || '',
    ledgerEntries: entries.map(e => ({
      ledger: e.ledger || '',
      amount: Math.abs(e.amount || 0),
      isDeemedPositive: e.is_debit || false,
    })),
  })
  const [saving, setSaving] = useState(false)

  function updateEntry(idx, field, value) {
    const updated = [...form.ledgerEntries]
    updated[idx] = { ...updated[idx], [field]: value }
    setForm({ ...form, ledgerEntries: updated })
  }

  function addEntry() {
    setForm({ ...form, ledgerEntries: [...form.ledgerEntries, { ledger: '', amount: 0, isDeemedPositive: false }] })
  }

  function removeEntry(idx) {
    setForm({ ...form, ledgerEntries: form.ledgerEntries.filter((_, i) => i !== idx) })
  }

  async function handleSave() {
    setSaving(true)
    try {
      await (supabase as any).from('tally_vouchers').update({
        date: form.date,
        party_ledger: form.partyLedger,
        narration: form.narration,
        ledger_entries: form.ledgerEntries.map(e => ({
          ledger: e.ledger, amount: e.amount, is_debit: e.isDeemedPositive,
        })),
        amount: form.ledgerEntries.filter(e => e.isDeemedPositive).reduce((s, e) => s + e.amount, 0),
        sync_status: 'pending',
        synced_at: null,
      }).eq('id', voucher.id)
      toast.success('Voucher updated locally')
      onSaved()
    } catch {
      toast.error('Failed to update voucher')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-blue-600" />
            Edit Voucher — {voucher.voucher_number}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Party Ledger</label>
              <input type="text" value={form.partyLedger} onChange={e => setForm({ ...form, partyLedger: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Narration</label>
            <textarea value={form.narration} onChange={e => setForm({ ...form, narration: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-sm" rows={2} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Ledger Entries</label>
              <button onClick={addEntry} className="text-xs text-blue-600 hover:text-blue-800">+ Add Entry</button>
            </div>
            <div className="space-y-2">
              {form.ledgerEntries.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input type="text" value={entry.ledger} onChange={e => updateEntry(idx, 'ledger', e.target.value)}
                    placeholder="Ledger name" className="flex-1 px-2 py-1.5 border rounded text-sm" />
                  <input type="number" value={entry.amount} onChange={e => updateEntry(idx, 'amount', parseFloat(e.target.value) || 0)}
                    placeholder="Amount" className="w-28 px-2 py-1.5 border rounded text-sm text-right" />
                  <select value={entry.isDeemedPositive ? 'Dr' : 'Cr'} onChange={e => updateEntry(idx, 'isDeemedPositive', e.target.value === 'Dr')}
                    className="px-2 py-1.5 border rounded text-sm">
                    <option value="Dr">Dr</option>
                    <option value="Cr">Cr</option>
                  </select>
                  {form.ledgerEntries.length > 2 && (
                    <button onClick={() => removeEntry(idx)} className="p-1 text-red-400 hover:text-red-600">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirmModal({ voucher, serverUrl, companyName, onClose, onDeleted }: any) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await (supabase as any).from('tally_vouchers').delete().eq('id', voucher.id)
      toast.success('Voucher removed locally')
      onDeleted()
    } catch {
      toast.error('Failed to delete voucher')
    }
    setDeleting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-full">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Cancel Voucher</h3>
            <p className="text-sm text-gray-500">This will delete the voucher in Tally</p>
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm">
          <p><span className="text-gray-500">Voucher:</span> <span className="font-medium">{voucher.voucher_number}</span></p>
          <p><span className="text-gray-500">Type:</span> {voucher.voucher_type}</p>
          <p><span className="text-gray-500">Amount:</span> {formatCurrency(voucher.amount)}</p>
          <p><span className="text-gray-500">Party:</span> {voucher.party_ledger || '-'}</p>
        </div>
        <p className="text-sm text-red-600 mb-4">This action cannot be undone. The voucher will be deleted from TallyPrime.</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
          <button onClick={handleDelete} disabled={deleting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete Voucher
          </button>
        </div>
      </div>
    </div>
  )
}

function DetailModal({ voucher, onClose, onEdit, onDelete }: { voucher: any; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const entries = Array.isArray(voucher.ledger_entries) ? voucher.ledger_entries : []
  const totalDebit = entries.filter(e => e.is_debit).reduce((s, e) => s + Math.abs(e.amount || 0), 0)
  const totalCredit = entries.filter(e => !e.is_debit).reduce((s, e) => s + Math.abs(e.amount || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Voucher Details
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Voucher Number</p>
              <p className="font-medium text-gray-900">{voucher.voucher_number || '-'}</p>
            </div>
            <div>
              <p className="text-gray-500">Type</p>
              <p className="font-medium text-gray-900">{voucher.voucher_type}</p>
            </div>
            <div>
              <p className="text-gray-500">Date</p>
              <p className="font-medium text-gray-900">{formatDate(voucher.date)}</p>
            </div>
            <div>
              <p className="text-gray-500">Party</p>
              <p className="font-medium text-gray-900">{getPartyName(voucher)}</p>
            </div>
            <div>
              <p className="text-gray-500">Amount</p>
              <p className="font-medium text-gray-900">{formatCurrency(voucher.amount)}</p>
            </div>
            <div>
              <p className="text-gray-500">Status</p>
              <div className="mt-0.5 flex items-center gap-2">
                <StatusBadge status={voucher.sync_status} />
                <DirectionBadge direction={voucher.sync_direction} />
              </div>
            </div>
          </div>

          {voucher.narration && (
            <div className="text-sm">
              <p className="text-gray-500 mb-1">Narration</p>
              <p className="text-gray-900 bg-gray-50 p-3 rounded-lg">{voucher.narration}</p>
            </div>
          )}

          {voucher.is_cancelled && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg">
              This voucher is cancelled.
            </div>
          )}

          {voucher.error_message && (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg">
              <span className="font-medium">Error:</span> {voucher.error_message}
            </div>
          )}

          {voucher.adamrit_bill_id && (
            <div className="text-sm">
              <p className="text-gray-500">Linked Bill ID: <span className="font-mono text-gray-900">{voucher.adamrit_bill_id}</span></p>
            </div>
          )}
          {voucher.adamrit_payment_id && (
            <div className="text-sm">
              <p className="text-gray-500">Linked Payment ID: <span className="font-mono text-gray-900">{voucher.adamrit_payment_id}</span></p>
            </div>
          )}

          {voucher.synced_at && (
            <div className="text-sm text-gray-500">
              Last synced: {new Date(voucher.synced_at).toLocaleString('en-IN')}
            </div>
          )}

          {/* Ledger Entries Table */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-2">Ledger Entries</h4>
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">No ledger entries available.</p>
            ) : (
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left py-2 px-3 font-medium text-gray-600">Ledger</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-600">Debit</th>
                      <th className="text-right py-2 px-3 font-medium text-gray-600">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="py-2 px-3 text-gray-900">{entry.ledger || '-'}</td>
                        <td className="py-2 px-3 text-right text-gray-900">
                          {entry.is_debit ? formatCurrency(Math.abs(entry.amount || 0)) : ''}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-900">
                          {!entry.is_debit ? formatCurrency(Math.abs(entry.amount || 0)) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                      <td className="py-2 px-3 text-gray-900">Total</td>
                      <td className="py-2 px-3 text-right text-gray-900">{formatCurrency(totalDebit)}</td>
                      <td className="py-2 px-3 text-right text-gray-900">{formatCurrency(totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TallyVouchers({ serverUrl, companyName, companyId, focusFilter, onFocusHandled }: {
  serverUrl?: string
  companyName?: string
  companyId?: string
  focusFilter?: 'period' | 'type' | null
  onFocusHandled?: () => void
}) {
  const [allVouchers, setAllVouchers] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showAll, setShowAll] = useState(false)
  const dateFromRef = useRef<HTMLInputElement>(null)
  const typeFilterRef = useRef<HTMLSelectElement>(null)
  const [selectedLocalIds, setSelectedLocalIds] = useState<Set<string>>(new Set())
  const [exportingXml, setExportingXml] = useState(false)

  // Modals
  const [selectedVoucher, setSelectedVoucher] = useState<any>(null)
  const [editVoucher, setEditVoucher] = useState<any>(null)
  const [deleteVoucher, setDeleteVoucher] = useState<any>(null)

  const fetchVouchers = useCallback(async () => {
    setLoading(true)
    try {
      const tallyRequest = companyId
        ? (supabase as any).from('tally_vouchers').select('*').eq('company_id', companyId).order('date', { ascending: false }).limit(2000)
        : Promise.resolve({ data: [], error: null })
      const { data: companyRows, error: companyError } = await (supabase as any)
        .from('companies').select('id, company_name').eq('is_active', true)
      if (companyError) throw companyError

      const accountingCompany = (companyRows || []).find((company: any) => companyKey(company.company_name) === companyKey(companyName))
      const localRequest = accountingCompany
        ? (supabase as any)
            .from('vouchers')
            .select('id, voucher_number, voucher_date, narration, total_amount, status, created_at, voucher_type:voucher_types(voucher_type_name, voucher_category), voucher_entries(debit_amount, credit_amount, account:chart_of_accounts(account_name))')
            .eq('company_id', accountingCompany.id)
            .neq('status', 'CANCELLED')
            .order('voucher_date', { ascending: false })
            .limit(2000)
        : Promise.resolve({ data: [], error: null })
      const [tallyResult, localResult] = await Promise.all([tallyRequest, localRequest])
      if (tallyResult.error) throw tallyResult.error
      if (localResult.error) throw localResult.error

      const localVouchers = (localResult.data || []).map((voucher: any) => {
        const ledger_entries = (voucher.voucher_entries || []).map((entry: any) => ({
          ledger: entry.account?.account_name || '',
          amount: Number(entry.debit_amount || entry.credit_amount || 0),
          is_debit: Number(entry.debit_amount || 0) > 0,
        }))
        const party_ledger = ledger_entries.find((entry: any) => {
          const name = entry.ledger.toLowerCase()
          return !name.includes('bank') && !name.includes('cash')
        })?.ledger || ledger_entries[0]?.ledger || null
        return {
          id: `adamrit:${voucher.id}`,
          date: voucher.voucher_date,
          voucher_number: voucher.voucher_number,
          voucher_type: voucher.voucher_type?.voucher_type_name || voucher.voucher_type?.voucher_category || 'Voucher',
          party_ledger,
          amount: Number(voucher.total_amount || 0),
          narration: voucher.narration || null,
          ledger_entries,
          sync_direction: 'adamrit_local',
          sync_status: 'local',
          created_at: voucher.created_at,
          is_local: true,
        }
      })

      let rows = [...(tallyResult.data || []).map((voucher: any) => ({ ...voucher, is_local: false })), ...localVouchers]
      if (!showAll) rows = rows.filter((voucher) => voucher.is_local)
      if (dateFrom) rows = rows.filter((voucher) => (voucher.date || '') >= dateFrom)
      if (dateTo) rows = rows.filter((voucher) => (voucher.date || '') <= dateTo)
      if (typeFilter !== 'All') rows = rows.filter((voucher) => (voucher.voucher_type || '').toLowerCase().includes(typeFilter.toLowerCase()))
      if (statusFilter !== 'All') rows = rows.filter((voucher) => voucher.sync_status === statusFilter)
      rows.sort((a, b) => new Date(b.date || b.created_at || 0).getTime() - new Date(a.date || a.created_at || 0).getTime())
      setTotalCount(rows.length)
      setAllVouchers(rows)
    } catch (err) {
      toast.error('Failed to load vouchers')
      setAllVouchers([])
      setTotalCount(0)
    }
    setLoading(false)
  }, [dateFrom, dateTo, typeFilter, statusFilter, showAll, companyId, companyName])

  useEffect(() => {
    fetchVouchers()
  }, [fetchVouchers])

  // Reset to first page when filters change
  useEffect(() => {
    setPage(0)
  }, [dateFrom, dateTo, typeFilter, statusFilter, showAll])

  useEffect(() => {
    if (!focusFilter) return
    const target = focusFilter === 'period' ? dateFromRef.current : typeFilterRef.current
    target?.focus()
    onFocusHandled?.()
  }, [focusFilter, onFocusHandled])

  const vouchers = useMemo(() => allVouchers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [allVouchers, page])
  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  const handleExportExcel = useCallback(() => {
    if (vouchers.length === 0) {
      toast.info('No vouchers to export')
      return
    }

    const data = vouchers.map((voucher) => ({
      Date: formatDate(voucher.date),
      Particulars: getPartyName(voucher),
      'Voucher Type': voucher.voucher_type || '-',
      'Voucher No': voucher.voucher_number || '-',
      'Debit Amount': voucher.sync_direction === 'to_tally' ? Number(voucher.amount || 0) : '',
      'Credit Amount': voucher.sync_direction !== 'to_tally' ? Number(voucher.amount || 0) : '',
      Status: voucher.sync_status || '-',
      Direction: voucher.sync_direction === 'adamrit_local' ? 'Adamrit / Local' : voucher.sync_direction === 'from_tally' ? 'From Tally' : 'To Tally',
      Narration: voucher.narration || '-',
    }))

    const worksheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Day Book')
    XLSX.writeFile(workbook, `Tally_Vouchers_${companyName || 'Company'}_${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [companyName, vouchers])

  const localVouchersOnPage = vouchers.filter((voucher) => voucher.is_local)
  const allVisibleLocalSelected = localVouchersOnPage.length > 0 && localVouchersOnPage.every((voucher) => selectedLocalIds.has(voucher.id))

  const toggleLocalVoucher = useCallback((id: string, checked: boolean) => {
    setSelectedLocalIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const toggleAllVisibleLocal = useCallback((checked: boolean) => {
    setSelectedLocalIds((current) => {
      const next = new Set(current)
      localVouchersOnPage.forEach((voucher) => {
        if (checked) next.add(voucher.id)
        else next.delete(voucher.id)
      })
      return next
    })
  }, [localVouchersOnPage])

  const handleExportTallyXml = useCallback(async () => {
    const selectedIds = Array.from(selectedLocalIds)
      .filter((id) => id.startsWith('adamrit:'))
      .map((id) => id.slice('adamrit:'.length))
    if (!selectedIds.length) {
      toast.info('Select Adamrit / Local vouchers to export')
      return
    }

    setExportingXml(true)
    try {
      const { data: companyRows, error: companyError } = await (supabase as any)
        .from('companies').select('id, company_name').eq('is_active', true)
      if (companyError) throw companyError
      const accountingCompany = (companyRows || []).find((company: any) => companyKey(company.company_name) === companyKey(companyName))
      if (!accountingCompany) throw new Error(`No Adamrit company is linked to ${companyName || 'the selected Tally company'}`)

      const { data, error } = await (supabase as any)
        .from('vouchers')
        .select('id, company_id, voucher_number, voucher_date, narration, status, voucher_type:voucher_types(voucher_category), voucher_entries(debit_amount, credit_amount, entry_order, account:chart_of_accounts(account_name))')
        .in('id', selectedIds)
      if (error) throw error
      if ((data || []).length !== selectedIds.length) throw new Error('One or more selected vouchers could not be loaded')
      if ((data || []).some((voucher: any) => voucher.company_id !== accountingCompany.id)) {
        throw new Error('Selected vouchers must belong to the currently selected company')
      }

      const requiredLedgerNames = Array.from(new Set((data || []).flatMap((voucher: any) =>
        (voucher.voucher_entries || []).map((entry: any) => entry.account?.account_name).filter(Boolean),
      ))) as string[]
      if (!requiredLedgerNames.length) throw new Error('Selected vouchers have no ledger entries to export')
      if (!companyId) throw new Error('Select the target Tally company before exporting')
      const { data: tallyLedgers, error: ledgerError } = await (supabase as any)
        .from('tally_ledgers')
        .select('name')
        .eq('company_id', companyId)
        .in('name', requiredLedgerNames)
      if (ledgerError) throw ledgerError
      const availableLedgers = new Set((tallyLedgers || []).map((ledger: any) => String(ledger.name).trim().toLowerCase()))
      const missingLedgers = requiredLedgerNames.filter((name) => !availableLedgers.has(name.trim().toLowerCase()))
      if (missingLedgers.length) {
        throw new Error(`These ledgers are not available in the selected Tally company: ${missingLedgers.slice(0, 4).join(', ')}${missingLedgers.length > 4 ? '…' : ''}`)
      }

      const xml = buildTallyVoucherImportXml((data || []).map((voucher: any) => ({
        id: voucher.id,
        voucherNumber: voucher.voucher_number,
        voucherDate: voucher.voucher_date,
        voucherCategory: voucher.voucher_type?.voucher_category,
        narration: voucher.narration,
        status: voucher.status,
        entries: (voucher.voucher_entries || []).map((entry: any) => ({
          accountName: entry.account?.account_name,
          debitAmount: entry.debit_amount,
          creditAmount: entry.credit_amount,
          entryOrder: entry.entry_order,
        })),
      })))
      const safeCompanyName = (accountingCompany.company_name || 'Adamrit').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')
      downloadTallyVoucherImport(`${safeCompanyName}_Tally_Vouchers_${new Date().toISOString().slice(0, 10)}.xml`, xml)
      toast.success(`Downloaded ${selectedIds.length} Tally voucher(s). Import the XML in TallyPrime.`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not create the Tally XML file')
    } finally {
      setExportingXml(false)
    }
  }, [companyId, companyName, selectedLocalIds])

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Show All</label>
              <p className="text-xs text-gray-400">{showAll ? 'Show cached Tally and Adamrit vouchers' : 'Show Adamrit vouchers only'}</p>
            </div>
            <Switch checked={showAll} onCheckedChange={setShowAll} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
            <input
              ref={dateFromRef}
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Voucher Type</label>
            <select
              ref={typeFilterRef}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {VOUCHER_TYPES.map(t => (
                <option key={t} value={t}>{t === 'All' ? 'All Types' : t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sync Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {SYNC_STATUSES.map(s => (
                <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            Vouchers
            <span className="text-xs font-normal text-gray-500 ml-1">
              ({totalCount.toLocaleString()} total)
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportTallyXml}
              disabled={exportingXml || selectedLocalIds.size === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exportingXml ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Tally XML {selectedLocalIds.size > 0 ? `(${selectedLocalIds.size})` : ''}
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={loading || vouchers.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-white px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </button>
            {loading && <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="w-10 py-2.5 px-3 text-center">
                  <input
                    type="checkbox"
                    checked={allVisibleLocalSelected}
                    disabled={localVouchersOnPage.length === 0}
                    onChange={(event) => toggleAllVisibleLocal(event.target.checked)}
                    aria-label="Select all visible Adamrit vouchers"
                  />
                </th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Date</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Number</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Type</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Party</th>
                <th className="text-right py-2.5 px-3 text-gray-600 font-medium">Amount</th>
                <th className="text-left py-2.5 px-3 text-gray-600 font-medium">Narration</th>
                <th className="text-center py-2.5 px-3 text-gray-600 font-medium">Status</th>
                <th className="text-center py-2.5 px-3 text-gray-600 font-medium">Direction</th>
              </tr>
            </thead>
            <tbody>
              {!loading && vouchers.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-500">
                    <Search className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    No vouchers found. Adjust your filters or create a voucher in Adamrit.
                  </td>
                </tr>
              )}
              {vouchers.map((v, idx) => (
                <tr
                  key={v.id}
                  onClick={() => !v.is_local && setSelectedVoucher(v)}
                  className={`border-b border-gray-100 ${v.is_local ? 'cursor-default' : 'cursor-pointer hover:bg-blue-50'} transition-colors ${
                    idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                  } ${v.is_cancelled ? 'opacity-60 line-through' : ''}`}
                >
                  <td className="py-2.5 px-3 text-center">
                    {v.is_local ? (
                      <input
                        type="checkbox"
                        checked={selectedLocalIds.has(v.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleLocalVoucher(v.id, event.target.checked)}
                        aria-label={`Select voucher ${v.voucher_number || v.id}`}
                      />
                    ) : null}
                  </td>
                  <td className="py-2.5 px-3 text-gray-900 whitespace-nowrap">{formatDate(v.date)}</td>
                  <td className="py-2.5 px-3 text-gray-900 font-mono text-xs">{v.voucher_number || '-'}</td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                      {v.voucher_type}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-gray-900 max-w-[180px] truncate">{getPartyName(v)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-900 font-medium whitespace-nowrap">
                    {formatCurrency(v.amount)}
                  </td>
                  <td className="py-2.5 px-3 text-gray-600 max-w-[200px]" title={v.narration || ''}>
                    {truncate(v.narration)}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <StatusBadge status={v.sync_status} />
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <DirectionBadge direction={v.sync_direction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-xs text-gray-500">
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4 text-gray-600" />
              </button>
              <span className="px-3 py-1 text-xs text-gray-700 font-medium">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4 text-gray-600" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedVoucher && (
        <DetailModal
          voucher={selectedVoucher}
          onClose={() => setSelectedVoucher(null)}
          onEdit={() => { setEditVoucher(selectedVoucher); setSelectedVoucher(null) }}
          onDelete={() => { setDeleteVoucher(selectedVoucher); setSelectedVoucher(null) }}
        />
      )}

      {/* Edit Modal */}
      {editVoucher && (
        <EditVoucherModal
          voucher={editVoucher}
          serverUrl={serverUrl}
          companyName={companyName}
          onClose={() => setEditVoucher(null)}
          onSaved={() => { setEditVoucher(null); fetchVouchers() }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteVoucher && (
        <DeleteConfirmModal
          voucher={deleteVoucher}
          serverUrl={serverUrl}
          companyName={companyName}
          onClose={() => setDeleteVoucher(null)}
          onDeleted={() => { setDeleteVoucher(null); fetchVouchers() }}
        />
      )}
    </div>
  )
}
