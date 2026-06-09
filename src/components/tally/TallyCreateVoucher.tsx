import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { PlusCircle, RefreshCw, Loader2, CheckCircle2, WifiOff } from 'lucide-react'

interface Ledger {
  name: string
  parent_group: string | null
}

interface Props {
  serverUrl: string
  companyName: string
  companyId: string
}

const CASH_BANK_KEYWORDS = ['cash', 'bank', 'cash-in-hand', 'cash in hand', 'bank accounts', 'bank account']

function isCashOrBank(parentGroup: string | null): boolean {
  if (!parentGroup) return false
  const g = parentGroup.toLowerCase()
  return CASH_BANK_KEYWORDS.some(k => g.includes(k))
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export default function TallyCreateVoucher({ serverUrl, companyName, companyId }: Props) {
  const { hospitalType } = useAuth()

  const [allLedgers, setAllLedgers] = useState<Ledger[]>([])
  const [loadingLedgers, setLoadingLedgers] = useState(false)
  const [tallyOnline, setTallyOnline] = useState<boolean | null>(null)

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

  // ── Ledger fetch ──────────────────────────────────────────────
  const loadLedgers = useCallback(async (forceLive = false) => {
    setLoadingLedgers(true)
    let liveSuccess = false

    // 1. Try to refresh from TallyPrime live
    if ((forceLive || tallyOnline !== false) && serverUrl && companyName) {
      try {
        const res = await fetch('/api/tally-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'sync',
            action: 'ledgers',
            serverUrl,
            companyName,
            companyId,
          }),
        })
        const result = await res.json()
        if (result.recordsSynced > 0 || result.success) {
          liveSuccess = true
          setTallyOnline(true)
        }
      } catch {
        setTallyOnline(false)
      }
    }

    // 2. Read from tally_ledgers (fresh or cached)
    const { data } = await supabase
      .from('tally_ledgers')
      .select('name, parent_group')
      .eq('company_id', companyId)
      .order('name')

    if (data && data.length > 0) {
      setAllLedgers(data as Ledger[])
      if (!liveSuccess) setTallyOnline(false)
    } else if (!liveSuccess) {
      setTallyOnline(false)
      toast.warning('No ledgers found. Make sure Tally is online and sync at least once.')
    }

    setLoadingLedgers(false)
  }, [serverUrl, companyName, companyId, tallyOnline])

  useEffect(() => {
    if (companyId) loadLedgers()
  }, [companyId])

  // ── Derived ledger lists ──────────────────────────────────────
  const accountLedgers = allLedgers.filter(l => isCashOrBank(l.parent_group))
  const particularLedgers = allLedgers

  // ── Voucher number generator (same logic as PaymentVoucher page) ──
  async function nextVoucherNo(date: string): Promise<string> {
    const datePart = date.replace(/-/g, '')
    const prefix = `PV-${datePart}-`
    const { data } = await (supabase as any)
      .from('payment_vouchers')
      .select('voucher_no')
      .like('voucher_no', `${prefix}%`)
      .order('voucher_no', { ascending: false })
      .limit(1)
    const lastNo = data?.[0]?.voucher_no as string | undefined
    const lastSeq = lastNo ? parseInt(lastNo.slice(prefix.length), 10) : 0
    const seq = String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(3, '0')
    return `${prefix}${seq}`
  }

  // ── Submit ────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.account) { toast.error('Select an Account'); return }
    if (!form.particulars) { toast.error('Select Particulars'); return }
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }

    setSaving(true)
    try {
      const voucherNo = form.paymentNo.trim() || await nextVoucherNo(form.date)

      // 1 — Save to HMS payment_vouchers
      const { error: dbError } = await (supabase as any).from('payment_vouchers').insert({
        voucher_no: voucherNo,
        voucher_date: form.date,
        person_name: form.particulars,
        amount,
        purpose: form.narration.trim() || null,
        paid_by: form.account,
        hospital_type: hospitalType,
      })
      if (dbError) throw new Error(`HMS save failed: ${dbError.message}`)

      // 2 — Push to TallyPrime
      const narration = form.narration.trim() || `Payment #${voucherNo} to ${form.particulars}`
      let tallySuccess = false
      try {
        const res = await fetch('/api/tally-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'push',
            action: 'create-voucher',
            serverUrl,
            companyName,
            data: {
              voucherType: 'Payment',
              date: form.date,
              narration,
              partyLedger: form.particulars,
              ledgerEntries: [
                { ledgerName: form.particulars, amount, isDeemedPositive: true },
                { ledgerName: form.account, amount, isDeemedPositive: false },
              ],
            },
          }),
        })
        const result = await res.json()
        tallySuccess = !!result.success
        if (!tallySuccess) {
          toast.warning(`Saved to HMS but Tally push failed: ${result.errors?.join(', ') || result.message}`)
        }
      } catch {
        toast.warning('Saved to HMS but could not reach TallyPrime')
      }

      // 3 — Mirror to tally_vouchers so Cash Book Realtime picks it up
      if (tallySuccess && companyId) {
        const { count } = await supabase
          .from('tally_vouchers')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', companyId)
          .eq('voucher_number', voucherNo)

        if (!count || count === 0) {
          await supabase.from('tally_vouchers').insert({
            voucher_type: 'Payment',
            voucher_number: voucherNo,
            date: form.date,
            party_ledger: form.particulars,
            amount,
            narration,
            ledger_entries: [
              { ledger: form.particulars, amount, is_debit: true },
              { ledger: form.account, amount, is_debit: false },
            ],
            sync_direction: 'to_tally',
            sync_status: 'synced',
            adamrit_payment_id: voucherNo,
            company_id: companyId,
            synced_at: new Date().toISOString(),
          })
        }
      }

      toast.success(`Voucher ${voucherNo} saved${tallySuccess ? ' & pushed to Tally' : ' to HMS'}`)
      setLastSaved(voucherNo)
      setForm({ paymentNo: '', account: form.account, date: form.date, amount: '', particulars: '', narration: '' })
    } catch (err: any) {
      toast.error(err.message || 'Failed to save voucher')
    } finally {
      setSaving(false)
    }
  }

  // ── UI ────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-6">

      {/* Ledger status bar */}
      <div className="flex items-center justify-between bg-white border rounded-xl px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          {tallyOnline === true && <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-green-700">Ledgers loaded from TallyPrime ({allLedgers.length})</span></>}
          {tallyOnline === false && <><WifiOff className="h-4 w-4 text-amber-500" /><span className="text-amber-700">Tally offline — showing cached ledgers ({allLedgers.length})</span></>}
          {tallyOnline === null && loadingLedgers && <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /><span className="text-blue-700">Loading ledgers from TallyPrime…</span></>}
        </div>
        <button
          onClick={() => loadLedgers(true)}
          disabled={loadingLedgers}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingLedgers ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Form */}
      <div className="bg-white border rounded-xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-gray-900">New Payment Voucher</h3>

        <div className="grid grid-cols-2 gap-4">
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

        {/* Account */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Account (Cash / Bank) <span className="text-red-500">*</span>
          </label>
          <select
            value={form.account}
            onChange={e => setForm(f => ({ ...f, account: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="">— Select Account —</option>
            {accountLedgers.map(l => (
              <option key={l.name} value={l.name}>{l.name}</option>
            ))}
          </select>
          {accountLedgers.length === 0 && !loadingLedgers && (
            <p className="text-xs text-amber-600 mt-1">No Cash/Bank ledgers found. Refresh ledgers or sync from Tally first.</p>
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

        {/* Particulars */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Particulars <span className="text-red-500">*</span>
          </label>
          <select
            value={form.particulars}
            onChange={e => setForm(f => ({ ...f, particulars: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="">— Select Particulars —</option>
            {particularLedgers.map(l => (
              <option key={l.name} value={l.name}>{l.name}</option>
            ))}
          </select>
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
            {saving ? 'Saving…' : 'Save Voucher'}
          </button>

          {lastSaved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Last saved: {lastSaved}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
