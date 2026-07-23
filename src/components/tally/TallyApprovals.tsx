import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  PlusCircle, Loader2, CheckCircle2, XCircle, Trash2, Eye, Banknote, FileText, Image as ImageIcon,
  Stethoscope, AlertTriangle, Pencil,
} from 'lucide-react'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useCompanies } from '@/hooks/useCompanies'
import { useAuth } from '@/contexts/AuthContext'
import { useAccountingRights } from '@/components/accounting/tally/rights'
import { uploadBillAttachment } from '@/lib/uploadBillAttachment'
import { resolveAccountingCompanyId } from '@/components/tally/TallyCreateVoucher'
import {
  type ApprovalCategory,
  type ApprovalQueueRow,
  type DoctorLedgerMapRow,
  approveAndPostJV,
  createApproval,
  deleteApproval,
  deleteDoctorLedgerMap,
  findLikelyDuplicate,
  listApprovals,
  listDoctorLedgerMap,
  needsDetails,
  postPaymentVoucher,
  rejectApproval,
  updateApprovalDetails,
  upsertDoctorLedgerMap,
} from '@/lib/approval-queue-service'

interface Ledger {
  id: string
  name: string
  parent_group: string | null
}

interface Props {
  serverUrl: string
  companyName: string
  companyId: string
}

const CATEGORIES: Array<{ value: ApprovalCategory; label: string; expenseHint: string; partyHint: string }> = [
  { value: 'VENDOR', label: 'Vendor', expenseHint: 'expense', partyHint: 'creditor' },
  { value: 'DOCTOR', label: 'Doctor', expenseHint: 'professional', partyHint: 'doctor' },
  { value: 'SALARY', label: 'Salary', expenseHint: 'salary', partyHint: 'payable' },
]

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function formatINR(amount: number | null | undefined): string {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-IN')
}

const categoryBadge: Record<ApprovalCategory, string> = {
  VENDOR: 'bg-blue-100 text-blue-800',
  DOCTOR: 'bg-purple-100 text-purple-800',
  SALARY: 'bg-emerald-100 text-emerald-800',
}

export default function TallyApprovals({ companyName }: Props) {
  const { user } = useAuth()
  const { canAlter } = useAccountingRights()
  const { data: companies = [] } = useCompanies()
  const queryClient = useQueryClient()

  const [accountingCompanyId, setAccountingCompanyId] = useState('')
  const [allLedgers, setAllLedgers] = useState<Ledger[]>([])
  const [loadingLedgers, setLoadingLedgers] = useState(false)
  const [section, setSection] = useState<'pending' | 'topay' | 'history' | 'doctormap'>('pending')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [processing, setProcessing] = useState(false)

  // Add-bill modal
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    category: 'VENDOR' as ApprovalCategory,
    partyName: '',
    referenceNo: '',
    amount: '',
    expenseLedger: '',
    partyLedger: '',
    narration: '',
  })
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [savingBill, setSavingBill] = useState(false)

  // Invoice preview / reject / pay modals
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [rejectingRow, setRejectingRow] = useState<ApprovalQueueRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [payingRow, setPayingRow] = useState<ApprovalQueueRow | null>(null)
  const [payForm, setPayForm] = useState({ cashBankLedger: '', date: today() })

  // OT-generated bills: fill amount + ledgers while approving
  const [completingRow, setCompletingRow] = useState<ApprovalQueueRow | null>(null)
  const [completeForm, setCompleteForm] = useState({ amount: '', expenseLedger: '', partyLedger: '', saveMapping: true })

  // Doctor Map sub-tab
  const [mapForm, setMapForm] = useState({ id: '', surgeonName: '', partyLedger: '', expenseLedger: '' })
  const [savingMap, setSavingMap] = useState(false)

  useEffect(() => {
    setAccountingCompanyId(resolveAccountingCompanyId(companies, companyName))
  }, [companies, companyName])

  // ── Ledgers (same source as TallyCreateVoucher) ────────────────
  // Chart of accounts plus the Masters → Ledger table, so ledgers created
  // under Masters show up here too. Masters-only entries carry a `master:`
  // prefixed id and are materialised into chart_of_accounts on first use.
  const loadLedgers = useCallback(async () => {
    if (!accountingCompanyId) { setAllLedgers([]); return }
    setLoadingLedgers(true)
    try {
      const { data, error } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name, account_group')
        .eq('company_id', accountingCompanyId)
        .eq('is_active', true)
        .order('account_name')
        .limit(2000)
      if (error) throw error
      const coa = (data || []).map((l: any) => ({ id: l.id, name: l.account_name, parent_group: l.account_group }))

      const { data: masterData, error: masterError } = await (supabase as any)
        .from('ledgers')
        .select('id, name, group_name')
        .eq('is_active', true)
        .order('name')
        .limit(2000)
      if (masterError) console.warn('[TallyApprovals] masters ledger load failed:', masterError.message)

      const seen = new Set(coa.map((l) => l.name.trim().toLowerCase()))
      const masters = (masterData || [])
        .filter((l: any) => l.name && !seen.has(String(l.name).trim().toLowerCase()))
        .map((l: any) => ({ id: `master:${l.id}`, name: l.name, parent_group: l.group_name }))

      setAllLedgers([...coa, ...masters].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (err: any) {
      console.error('[TallyApprovals] ledger load failed:', err?.message || err)
      toast.warning('Could not load ledger accounts')
    } finally {
      setLoadingLedgers(false)
    }
  }, [accountingCompanyId])

  useEffect(() => { loadLedgers() }, [loadLedgers])

  // Materialise a Masters-only ledger into chart_of_accounts so JV posting
  // (which stores chart_of_accounts ids) works. Returns a real COA id.
  const ensureLedgerId = useCallback(async (value: string): Promise<string> => {
    if (!value.startsWith('master:')) return value
    const masterId = value.slice('master:'.length)
    const { data: master, error: masterError } = await (supabase as any)
      .from('ledgers')
      .select('id, name, code, group_name')
      .eq('id', masterId)
      .single()
    if (masterError || !master) throw new Error('Masters ledger not found')

    // Someone may have created it in the chart meanwhile — reuse by name.
    const { data: existing } = await supabase
      .from('chart_of_accounts')
      .select('id')
      .eq('company_id', accountingCompanyId)
      .ilike('account_name', master.name.trim())
      .limit(1)
      .maybeSingle()
    if (existing?.id) return existing.id

    const group = String(master.group_name || '').toLowerCase()
    const accountType =
      group.includes('expense') || group.includes('purchase') || group.includes('salary') || group.includes('consultant')
        ? 'DIRECT_EXPENSES'
        : group.includes('income') || group.includes('sales')
          ? 'INCOME'
          : group.includes('capital')
            ? 'EQUITY'
            : group.includes('liabilit') || group.includes('creditor') || group.includes('loan') || group.includes('provision')
              ? 'LIABILITIES'
              : 'CURRENT_ASSETS'

    const { data: created, error: createError } = await supabase
      .from('chart_of_accounts')
      .insert({
        account_code: master.code || `ML${masterId.replace(/-/g, '').slice(0, 12)}`,
        account_name: master.name,
        account_type: accountType,
        account_group: master.group_name || null,
        company_id: accountingCompanyId,
        is_active: true,
      } as any)
      .select('id')
      .single()
    if (createError || !created) throw new Error(createError?.message || 'Could not add the masters ledger to the chart of accounts')
    loadLedgers()
    return created.id
  }, [accountingCompanyId, loadLedgers])

  const ledgerById = useMemo(() => new Map(allLedgers.map((l) => [l.id, l])), [allLedgers])

  const ledgerOptions: SearchableSelectOption[] = allLedgers.map((ledger) => ({
    value: ledger.id,
    label: ledger.parent_group ? `${ledger.name} (${ledger.parent_group})` : ledger.name,
    selectedLabel: ledger.name,
  }))

  const cashBankOptions = ledgerOptions.filter((option) => {
    const ledger = ledgerById.get(option.value)
    const group = (ledger?.parent_group || '').toLowerCase()
    const name = (ledger?.name || '').toLowerCase()
    return group.includes('bank') || group.includes('cash') || name.includes('bank') || name.includes('cash')
  })

  // ── Queue rows ─────────────────────────────────────────────────
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['approval-queue', accountingCompanyId],
    queryFn: () => listApprovals(accountingCompanyId),
    enabled: !!accountingCompanyId,
  })

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['approval-queue', accountingCompanyId] })

  const { data: doctorMaps = [] } = useQuery({
    queryKey: ['doctor-ledger-map'],
    queryFn: listDoctorLedgerMap,
    enabled: section === 'doctormap',
  })
  const refetchMaps = () => queryClient.invalidateQueries({ queryKey: ['doctor-ledger-map'] })

  const pendingRows = rows.filter((r) => r.status === 'PENDING')
  const toPayRows = rows.filter((r) => r.status === 'APPROVED' && !r.is_paid && r.jv_voucher_id)
  const historyRows = rows.filter((r) => r.status === 'REJECTED' || (r.status === 'APPROVED' && r.is_paid))

  useEffect(() => { setSelectedIds(new Set()) }, [section, accountingCompanyId])

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Add bill ───────────────────────────────────────────────────
  async function handleAddBill() {
    const amount = Number(addForm.amount)
    if (!accountingCompanyId) { toast.error(`No Adamrit company is mapped to ${companyName || 'the selected Tally company'}`); return }
    if (!addForm.partyName.trim()) { toast.error('Enter the party name'); return }
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    if (!addForm.expenseLedger || !addForm.partyLedger) { toast.error('Select both expense and party ledgers'); return }
    if (addForm.expenseLedger === addForm.partyLedger) { toast.error('Expense and party ledgers must be different'); return }

    setSavingBill(true)
    try {
      const duplicate = await findLikelyDuplicate(accountingCompanyId, addForm.partyName, addForm.referenceNo, amount)
      if (duplicate) {
        toast.warning('A bill with the same party, reference and amount already exists in the queue')
      }

      let invoiceUrl: string | null = null
      if (invoiceFile) {
        invoiceUrl = await uploadBillAttachment(invoiceFile, `approvals-${invoiceFile.name}`)
        if (!invoiceUrl) toast.warning('Invoice upload failed — bill saved without it')
      }

      const expenseAccountId = await ensureLedgerId(addForm.expenseLedger)
      const partyAccountId = await ensureLedgerId(addForm.partyLedger)

      await createApproval({
        companyId: accountingCompanyId,
        category: addForm.category,
        partyName: addForm.partyName,
        referenceNo: addForm.referenceNo,
        amount,
        expenseAccountId,
        partyAccountId,
        invoiceUrl,
        narration: addForm.narration,
        createdBy: user?.email || undefined,
      })

      toast.success('Bill added to the approval queue')
      setAddOpen(false)
      setAddForm({ category: addForm.category, partyName: '', referenceNo: '', amount: '', expenseLedger: '', partyLedger: '', narration: '' })
      setInvoiceFile(null)
      refetch()
    } catch (err: any) {
      toast.error(err.message || 'Failed to add the bill')
    } finally {
      setSavingBill(false)
    }
  }

  // ── Approve (single + bulk) ────────────────────────────────────
  async function handleApprove(ids: string[]) {
    if (!canAlter) { toast.error('You do not have rights to approve bills'); return }
    const incomplete = ids.filter((id) => {
      const row = rows.find((r) => r.id === id)
      return row && needsDetails(row)
    })
    if (incomplete.length) {
      toast.warning(`${incomplete.length} bill(s) need amount/ledgers first — use the pencil icon on those`)
      ids = ids.filter((id) => !incomplete.includes(id))
    }
    if (!ids.length) { if (!incomplete.length) toast.error('Select at least one bill'); return }
    setProcessing(true)
    let ok = 0
    for (const id of ids) {
      try {
        const { voucherNumber } = await approveAndPostJV(id, user?.email || undefined)
        ok += 1
        toast.success(`JV ${voucherNumber} posted`)
      } catch (err: any) {
        const row = rows.find((r) => r.id === id)
        toast.error(`${row?.party_name || 'Bill'}: ${err.message || 'approval failed'}`)
      }
    }
    setProcessing(false)
    setSelectedIds(new Set())
    refetch()
    if (ids.length > 1) toast.info(`${ok} of ${ids.length} bills approved`)
  }

  // ── Reject ─────────────────────────────────────────────────────
  async function handleReject() {
    if (!rejectingRow) return
    if (!rejectReason.trim()) { toast.error('Enter a rejection reason'); return }
    setProcessing(true)
    try {
      await rejectApproval(rejectingRow.id, rejectReason)
      toast.success('Bill rejected')
      setRejectingRow(null)
      setRejectReason('')
      refetch()
    } catch (err: any) {
      toast.error(err.message || 'Failed to reject')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDelete(row: ApprovalQueueRow) {
    if (!canAlter) { toast.error('You do not have rights to delete bills'); return }
    if (!window.confirm(`Delete the pending bill for ${row.party_name} (${formatINR(row.amount)})?`)) return
    try {
      await deleteApproval(row.id)
      toast.success('Bill deleted')
      refetch()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete')
    }
  }

  // ── Pay ────────────────────────────────────────────────────────
  async function handlePay() {
    if (!payingRow) return
    if (!canAlter) { toast.error('You do not have rights to make payments'); return }
    if (!payForm.cashBankLedger) { toast.error('Select a cash or bank ledger'); return }
    setProcessing(true)
    try {
      const cashBankAccountId = await ensureLedgerId(payForm.cashBankLedger)
      const { voucherNumber } = await postPaymentVoucher(payingRow.id, {
        cashBankAccountId,
        date: payForm.date,
      })
      toast.success(`Payment voucher ${voucherNumber} posted — ${payingRow.party_name} settled`)
      setPayingRow(null)
      setPayForm({ cashBankLedger: '', date: today() })
      refetch()
    } catch (err: any) {
      toast.error(err.message || 'Payment failed')
    } finally {
      setProcessing(false)
    }
  }

  // ── Complete & Approve (OT-generated bills) ────────────────────
  function openCompleteDialog(row: ApprovalQueueRow) {
    setCompletingRow(row)
    setCompleteForm({
      amount: row.amount > 0 ? String(row.amount) : '',
      expenseLedger: row.expense_account_id || '',
      partyLedger: row.party_account_id || '',
      saveMapping: row.category === 'DOCTOR',
    })
  }

  async function handleCompleteAndApprove() {
    if (!completingRow) return
    const amount = Number(completeForm.amount)
    if (!amount || amount <= 0) { toast.error('Enter the amount to pay'); return }
    if (!completeForm.expenseLedger || !completeForm.partyLedger) { toast.error('Select both ledgers'); return }
    if (completeForm.expenseLedger === completeForm.partyLedger) { toast.error('Expense and party ledgers must be different'); return }
    setProcessing(true)
    try {
      const expenseAccountId = await ensureLedgerId(completeForm.expenseLedger)
      const partyAccountId = await ensureLedgerId(completeForm.partyLedger)
      await updateApprovalDetails(completingRow.id, {
        amount,
        companyId: accountingCompanyId,
        expenseAccountId,
        partyAccountId,
      })
      if (completeForm.saveMapping && completingRow.category === 'DOCTOR') {
        try {
          await upsertDoctorLedgerMap({
            surgeonName: completingRow.party_name,
            companyId: accountingCompanyId,
            partyAccountId,
            expenseAccountId,
          })
          refetchMaps()
        } catch (mapErr: any) {
          toast.warning(`Bill approved but mapping not saved: ${mapErr.message}`)
        }
      }
      const { voucherNumber } = await approveAndPostJV(completingRow.id, user?.email || undefined)
      toast.success(`JV ${voucherNumber} posted`)
      setCompletingRow(null)
      refetch()
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve')
      refetch()
    } finally {
      setProcessing(false)
    }
  }

  // ── Doctor Map handlers ────────────────────────────────────────
  async function handleSaveMapping() {
    if (!mapForm.surgeonName.trim()) { toast.error('Enter the doctor name (same as it appears on OT bills)'); return }
    if (!mapForm.partyLedger) { toast.error('Select the doctor’s party ledger'); return }
    setSavingMap(true)
    try {
      const partyAccountId = await ensureLedgerId(mapForm.partyLedger)
      const expenseAccountId = mapForm.expenseLedger ? await ensureLedgerId(mapForm.expenseLedger) : null
      await upsertDoctorLedgerMap({
        surgeonName: mapForm.surgeonName,
        companyId: accountingCompanyId,
        partyAccountId,
        expenseAccountId,
      })
      toast.success('Doctor mapping saved')
      setMapForm({ id: '', surgeonName: '', partyLedger: '', expenseLedger: '' })
      refetchMaps()
    } catch (err: any) {
      toast.error(err.message || 'Failed to save mapping')
    } finally {
      setSavingMap(false)
    }
  }

  async function handleDeleteMapping(row: DoctorLedgerMapRow) {
    if (!window.confirm(`Delete the ledger mapping for ${row.surgeon_name}?`)) return
    try {
      await deleteDoctorLedgerMap(row.id)
      toast.success('Mapping deleted')
      refetchMaps()
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete mapping')
    }
  }

  // ── Render helpers ─────────────────────────────────────────────
  function ledgerName(id: string | null): string {
    return (id && ledgerById.get(id)?.name) || '—'
  }

  function DrCrSplit({ row }: { row: ApprovalQueueRow }) {
    return (
      <div className="text-xs leading-5">
        <span className="text-emerald-700 font-medium">Dr</span> {ledgerName(row.expense_account_id)}
        <br />
        <span className="text-red-700 font-medium">Cr</span> {ledgerName(row.party_account_id)}
      </div>
    )
  }

  function InvoiceCell({ row }: { row: ApprovalQueueRow }) {
    if (!row.invoice_url) return <span className="text-xs text-gray-400">No invoice</span>
    return (
      <button
        type="button"
        onClick={() => setPreviewUrl(row.invoice_url)}
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
      >
        <ImageIcon className="h-4 w-4" /> View
      </button>
    )
  }

  const sectionTabs = [
    { id: 'pending' as const, label: `Pending (${pendingRows.length})`, icon: FileText },
    { id: 'topay' as const, label: `To Pay (${toPayRows.length})`, icon: Banknote },
    { id: 'history' as const, label: `History (${historyRows.length})`, icon: Eye },
    { id: 'doctormap' as const, label: 'Doctor Map', icon: Stethoscope },
  ]

  return (
    <div className="max-w-6xl space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {loadingLedgers && <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /><span className="text-blue-700">Loading ledgers...</span></>}
          {!loadingLedgers && accountingCompanyId && allLedgers.length > 0 && (
            <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-green-700">{companyName}: {allLedgers.length} ledgers</span></>
          )}
          {!loadingLedgers && !accountingCompanyId && (
            <span className="text-amber-700">No Adamrit company is mapped to {companyName || 'the selected Tally company'}.</span>
          )}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          disabled={!accountingCompanyId || loadingLedgers}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <PlusCircle className="h-4 w-4" /> Add Bill
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2">
        {sectionTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSection(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border ${
              section === tab.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Pending ── */}
      {section === 'pending' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">Bills awaiting approval</p>
            <button
              onClick={() => handleApprove([...selectedIds])}
              disabled={processing || !canAlter || selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Approve &amp; Post JV ({selectedIds.size})
            </button>
          </div>
          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">Loading...</div>
          ) : pendingRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No pending bills. Use "Add Bill" to queue one.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === pendingRows.length && pendingRows.length > 0}
                        onChange={(e) => setSelectedIds(e.target.checked ? new Set(pendingRows.map((r) => r.id)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">Ref No</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">JV Split</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Added</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-blue-50/40">
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selectedIds.has(row.id)} onChange={() => toggleSelected(row.id)} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${categoryBadge[row.category]}`}>
                          {row.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {row.party_name}
                        {needsDetails(row) && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            <AlertTriangle className="h-3 w-3" /> Details needed
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{row.reference_no || '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{row.amount > 0 ? formatINR(row.amount) : '—'}</td>
                      <td className="px-3 py-2"><DrCrSplit row={row} /></td>
                      <td className="px-3 py-2"><InvoiceCell row={row} /></td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatDate(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => (needsDetails(row) ? openCompleteDialog(row) : handleApprove([row.id]))}
                            disabled={processing || !canAlter}
                            title={needsDetails(row) ? 'Fill amount & ledgers, then approve' : 'Approve & Post JV'}
                            className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                          >
                            {needsDetails(row) ? <Pencil className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => { setRejectingRow(row); setRejectReason('') }}
                            disabled={processing || !canAlter}
                            title="Reject"
                            className="rounded p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(row)}
                            disabled={processing || !canAlter}
                            title="Delete"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── To Pay ── */}
      {section === 'topay' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="border-b bg-gray-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">Approved bills — waiting for payment</p>
          </div>
          {toPayRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">Nothing to pay. Approved bills appear here.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">Ref No</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Approved</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {toPayRows.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-blue-50/40">
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${categoryBadge[row.category]}`}>
                          {row.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row.party_name}</td>
                      <td className="px-3 py-2 text-gray-600">{row.reference_no || '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatINR(row.amount)}</td>
                      <td className="px-3 py-2"><InvoiceCell row={row} /></td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatDate(row.approved_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => { setPayingRow(row); setPayForm({ cashBankLedger: '', date: today() }) }}
                          disabled={processing || !canAlter}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          <Banknote className="h-3.5 w-3.5" /> Pay
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {section === 'history' && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="border-b bg-gray-50 px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">Paid &amp; rejected bills</p>
          </div>
          {historyRows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">No history yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">Ref No</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${categoryBadge[row.category]}`}>
                          {row.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row.party_name}</td>
                      <td className="px-3 py-2 text-gray-600">{row.reference_no || '-'}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatINR(row.amount)}</td>
                      <td className="px-3 py-2">
                        {row.status === 'REJECTED' ? (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">REJECTED</span>
                        ) : (
                          <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">PAID</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><InvoiceCell row={row} /></td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {row.status === 'REJECTED'
                          ? row.rejection_reason || '-'
                          : `Paid ${formatDate(row.paid_at)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Doctor Map ── */}
      {section === 'doctormap' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-900">Doctor → Ledger Mapping</p>
            <p className="mt-1 text-xs text-gray-500">
              One-time setup: map each surgeon (name exactly as it appears on OT bills) to their ledgers in {companyName}.
              Mapped doctors' OT bills arrive pre-filled — only the amount is entered at approval.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Doctor Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={mapForm.surgeonName}
                  onChange={(e) => setMapForm((f) => ({ ...f, surgeonName: e.target.value }))}
                  placeholder="e.g. Dr. Sharma"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Party Ledger (Credit) <span className="text-red-500">*</span></label>
                <SearchableSelect
                  options={ledgerOptions.filter((o) => o.value !== mapForm.expenseLedger)}
                  value={mapForm.partyLedger}
                  onValueChange={(value) => setMapForm((f) => ({ ...f, partyLedger: value }))}
                  placeholder="Select doctor's ledger"
                  searchPlaceholder="Search ledgers..."
                  emptyText="No matching ledger"
                  disabled={loadingLedgers || allLedgers.length === 0}
                  className="h-10 justify-between"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expense Ledger (Debit)</label>
                <SearchableSelect
                  options={ledgerOptions.filter((o) => o.value !== mapForm.partyLedger)}
                  value={mapForm.expenseLedger}
                  onValueChange={(value) => setMapForm((f) => ({ ...f, expenseLedger: value }))}
                  placeholder="e.g. Professional Fees"
                  searchPlaceholder="Search expense ledgers..."
                  emptyText="No matching ledger"
                  disabled={loadingLedgers || allLedgers.length === 0}
                  className="h-10 justify-between"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleSaveMapping}
                  disabled={savingMap || !canAlter || !accountingCompanyId}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingMap ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                  Save
                </button>
              </div>
            </div>
          </div>
          <div className="bg-white border rounded-xl overflow-hidden">
            {doctorMaps.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                No doctors mapped yet. Mappings also save automatically when you tick
                "Save these ledgers for this doctor" while approving an OT bill.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Doctor</th>
                    <th className="px-3 py-2">Party Ledger (Cr)</th>
                    <th className="px-3 py-2">Expense Ledger (Dr)</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {doctorMaps.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-blue-50/40">
                      <td className="px-3 py-2 font-medium text-gray-900">{row.surgeon_name}</td>
                      <td className="px-3 py-2 text-gray-600">{ledgerName(row.party_account_id)}</td>
                      <td className="px-3 py-2 text-gray-600">{ledgerName(row.expense_account_id)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setMapForm({ id: row.id, surgeonName: row.surgeon_name, partyLedger: row.party_account_id, expenseLedger: row.expense_account_id || '' })}
                            title="Edit"
                            className="rounded p-1.5 text-blue-600 hover:bg-blue-50"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteMapping(row)}
                            disabled={!canAlter}
                            title="Delete"
                            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Complete & Approve modal (OT-generated bills) ── */}
      <Dialog open={!!completingRow} onOpenChange={(open) => { if (!open) setCompletingRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve — {completingRow?.party_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {completingRow?.narration && (
              <p className="text-xs text-gray-500">{completingRow.narration}{completingRow.reference_no ? ` · ${completingRow.reference_no}` : ''}</p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">How much are we paying? (₹) <span className="text-red-500">*</span></label>
              <input
                type="number"
                value={completeForm.amount}
                onChange={(e) => setCompleteForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Expense Ledger (Debit) <span className="text-red-500">*</span></label>
              <SearchableSelect
                options={ledgerOptions.filter((o) => o.value !== completeForm.partyLedger)}
                value={completeForm.expenseLedger}
                onValueChange={(value) => setCompleteForm((f) => ({ ...f, expenseLedger: value }))}
                placeholder="e.g. Professional Fees"
                searchPlaceholder="Search expense ledgers..."
                emptyText="No matching ledger"
                disabled={loadingLedgers || allLedgers.length === 0}
                className="h-10 justify-between"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Party Ledger (Credit) <span className="text-red-500">*</span></label>
              <SearchableSelect
                options={ledgerOptions.filter((o) => o.value !== completeForm.expenseLedger)}
                value={completeForm.partyLedger}
                onValueChange={(value) => setCompleteForm((f) => ({ ...f, partyLedger: value }))}
                placeholder="Select the doctor's ledger"
                searchPlaceholder="Search ledgers..."
                emptyText="No matching ledger"
                disabled={loadingLedgers || allLedgers.length === 0}
                className="h-10 justify-between"
              />
            </div>
            {completingRow?.category === 'DOCTOR' && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={completeForm.saveMapping}
                  onChange={(e) => setCompleteForm((f) => ({ ...f, saveMapping: e.target.checked }))}
                />
                Save these ledgers for this doctor (next OT bills arrive pre-filled)
              </label>
            )}
            {completeForm.expenseLedger && completeForm.partyLedger && Number(completeForm.amount) > 0 && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs">
                <p className="font-semibold text-gray-700 mb-1">JV that will post:</p>
                <p><span className="text-emerald-700 font-medium">Dr</span> {ledgerName(completeForm.expenseLedger)} — {formatINR(Number(completeForm.amount))}</p>
                <p><span className="text-red-700 font-medium">Cr</span> {ledgerName(completeForm.partyLedger)} — {formatINR(Number(completeForm.amount))}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setCompletingRow(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleCompleteAndApprove}
              disabled={processing || !canAlter}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Approve &amp; Post JV
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Bill modal ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Bill to Approval Queue</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <div className="flex gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    onClick={() => setAddForm((f) => ({ ...f, category: cat.value }))}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      addForm.category === cat.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Party Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={addForm.partyName}
                  onChange={(e) => setAddForm((f) => ({ ...f, partyName: e.target.value }))}
                  placeholder="e.g. Vidarbha Agency"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference / Invoice No</label>
                <input
                  type="text"
                  value={addForm.referenceNo}
                  onChange={(e) => setAddForm((f) => ({ ...f, referenceNo: e.target.value }))}
                  placeholder="e.g. INV-4521"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹) <span className="text-red-500">*</span></label>
              <input
                type="number"
                value={addForm.amount}
                onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Expense Ledger (Debit) <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                options={ledgerOptions.filter((o) => o.value !== addForm.partyLedger)}
                value={addForm.expenseLedger}
                onValueChange={(value) => setAddForm((f) => ({ ...f, expenseLedger: value }))}
                placeholder={loadingLedgers ? 'Loading...' : 'Select expense ledger'}
                searchPlaceholder={`Search ${CATEGORIES.find((c) => c.value === addForm.category)?.expenseHint || 'expense'} ledgers...`}
                emptyText="No matching ledger"
                disabled={loadingLedgers || allLedgers.length === 0}
                className="h-10 justify-between"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Party Ledger (Credit) <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                options={ledgerOptions.filter((o) => o.value !== addForm.expenseLedger)}
                value={addForm.partyLedger}
                onValueChange={(value) => setAddForm((f) => ({ ...f, partyLedger: value }))}
                placeholder={loadingLedgers ? 'Loading...' : 'Select party ledger'}
                searchPlaceholder={`Search ${CATEGORIES.find((c) => c.value === addForm.category)?.partyHint || 'party'} ledgers...`}
                emptyText="No matching ledger"
                disabled={loadingLedgers || allLedgers.length === 0}
                className="h-10 justify-between"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Invoice Photo / PDF</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Narration</label>
              <textarea
                value={addForm.narration}
                onChange={(e) => setAddForm((f) => ({ ...f, narration: e.target.value }))}
                rows={2}
                placeholder="Optional note..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            {addForm.expenseLedger && addForm.partyLedger && Number(addForm.amount) > 0 && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs">
                <p className="font-semibold text-gray-700 mb-1">JV that will post on approval:</p>
                <p><span className="text-emerald-700 font-medium">Dr</span> {ledgerName(addForm.expenseLedger)} — {formatINR(Number(addForm.amount))}</p>
                <p><span className="text-red-700 font-medium">Cr</span> {ledgerName(addForm.partyLedger)} — {formatINR(Number(addForm.amount))}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <button
              onClick={() => setAddOpen(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddBill}
              disabled={savingBill}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingBill ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
              {savingBill ? 'Saving...' : 'Add to Queue'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Invoice preview ── */}
      <Dialog open={!!previewUrl} onOpenChange={(open) => { if (!open) setPreviewUrl(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Invoice</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            previewUrl.toLowerCase().includes('.pdf') ? (
              <iframe src={previewUrl} title="Invoice PDF" className="w-full h-[70vh] rounded border" />
            ) : (
              <img src={previewUrl} alt="Invoice" className="max-h-[70vh] w-auto mx-auto rounded border object-contain" />
            )
          )}
        </DialogContent>
      </Dialog>

      {/* ── Reject modal ── */}
      <Dialog open={!!rejectingRow} onOpenChange={(open) => { if (!open) setRejectingRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Bill — {rejectingRow?.party_name}</DialogTitle>
          </DialogHeader>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Why is this bill being rejected?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 resize-none"
            />
          </div>
          <DialogFooter>
            <button onClick={() => setRejectingRow(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleReject}
              disabled={processing}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Reject Bill
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Pay modal ── */}
      <Dialog open={!!payingRow} onOpenChange={(open) => { if (!open) setPayingRow(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pay {payingRow?.party_name} — {formatINR(payingRow?.amount)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Cash / Bank Ledger (Credit) <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                options={cashBankOptions}
                value={payForm.cashBankLedger}
                onValueChange={(value) => setPayForm((f) => ({ ...f, cashBankLedger: value }))}
                placeholder="Select cash or bank ledger"
                searchPlaceholder="Search cash/bank ledgers..."
                emptyText="No cash/bank ledger found"
                disabled={loadingLedgers || cashBankOptions.length === 0}
                className="h-10 justify-between"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={payForm.date}
                onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {payingRow && payForm.cashBankLedger && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2 text-xs">
                <p className="font-semibold text-gray-700 mb-1">Payment voucher that will post:</p>
                <p><span className="text-emerald-700 font-medium">Dr</span> {ledgerName(payingRow.party_account_id)} — {formatINR(payingRow.amount)}</p>
                <p><span className="text-red-700 font-medium">Cr</span> {ledgerName(payForm.cashBankLedger)} — {formatINR(payingRow.amount)}</p>
                {payingRow.reference_no && <p className="mt-1 text-gray-500">Knocked off against {payingRow.reference_no}</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <button onClick={() => setPayingRow(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handlePay}
              disabled={processing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
              Post Payment Voucher
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
