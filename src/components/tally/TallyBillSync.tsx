
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  ArrowUpFromLine, CheckCircle, XCircle, Clock, Loader2,
  RefreshCw, Plus, Send, RotateCcw, FileText, X
} from 'lucide-react'

const OUTBOUND_TALLY_DISABLED = true

interface TallyBillSyncProps {
  serverUrl: string
  companyName: string
  companyId: string
}

export default function TallyBillSync({ serverUrl, companyName, companyId }: TallyBillSyncProps) {
  const [vouchers, setVouchers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pushing, setPushing] = useState<Set<string>>(new Set())
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    voucher_type: 'Sales',
    date: new Date().toISOString().split('T')[0],
    party_ledger: '',
    amount: '',
    narration: '',
  })

  const loadVouchers = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('tally_vouchers')
      .select('*')
      .eq('sync_direction', 'to_tally')
      .eq('company_id', companyId)
      .order('date', { ascending: false })
      .limit(1000)
    if (filter !== 'all') {
      query = query.eq('sync_status', filter)
    }

    const { data, error } = await query
    if (error) {
      toast.error('Failed to load vouchers')
    } else {
      setVouchers(data || [])
    }
    setLoading(false)
  }, [filter, companyId])

  useEffect(() => {
    loadVouchers()
  }, [loadVouchers])

  const stats = {
    total: vouchers.length,
    synced: vouchers.filter(v => v.sync_status === 'synced').length,
    pending: vouchers.filter(v => v.sync_status === 'pending').length,
    failed: vouchers.filter(v => v.sync_status === 'failed').length,
  }

  async function pushVoucher(voucher) {
    if (OUTBOUND_TALLY_DISABLED) {
      toast.info('Outbound push to Tally is disabled. Use sync-only mode.')
      return
    }
    setPushing(prev => new Set(prev).add(voucher.id))
    try {
      const action = voucher.voucher_type === 'Sales' ? 'create-sales-voucher' : 'create-voucher'
      const res = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'push',
          action,
          serverUrl,
          companyName,
          companyId,
          voucher: {
            id: voucher.id,
            voucher_type: voucher.voucher_type,
            date: voucher.date,
            party_ledger: voucher.party_ledger,
            amount: voucher.amount,
            narration: voucher.narration,
            voucher_number: voucher.voucher_number,
          },
        }),
      })
      const result = await res.json()
      if (result.success) {
        await supabase
          .from('tally_vouchers')
          .update({ sync_status: 'synced', error_message: null })
          .eq('id', voucher.id)
        toast.success(`Voucher ${voucher.voucher_number || voucher.id} pushed to Tally`)
      } else {
        await supabase
          .from('tally_vouchers')
          .update({ sync_status: 'failed', error_message: result.error || 'Push failed' })
          .eq('id', voucher.id)
        toast.error(result.error || 'Push failed')
      }
    } catch (err) {
      await supabase
        .from('tally_vouchers')
        .update({ sync_status: 'failed', error_message: 'Network error' })
        .eq('id', voucher.id)
      toast.error('Failed to push voucher')
    }
    setPushing(prev => {
      const next = new Set(prev)
      next.delete(voucher.id)
      return next
    })
    await loadVouchers()
  }

  async function pushSelected() {
    if (OUTBOUND_TALLY_DISABLED) {
      toast.info('Outbound push to Tally is disabled. Use sync-only mode.')
      return
    }
    const pendingSelected = vouchers.filter(v => selected.has(v.id) && v.sync_status === 'pending')
    if (pendingSelected.length === 0) {
      toast.error('No pending items selected')
      return
    }
    for (const v of pendingSelected) {
      await pushVoucher(v)
    }
    setSelected(new Set())
  }

  async function retryFailed() {
    if (OUTBOUND_TALLY_DISABLED) {
      toast.info('Outbound push to Tally is disabled. Use sync-only mode.')
      return
    }
    const failed = vouchers.filter(v => v.sync_status === 'failed')
    if (failed.length === 0) return toast.info('No failed items to retry')
    await ( supabase as any).from('tally_vouchers').update({ sync_status: 'pending', error_message: null })
      .eq('sync_direction', 'to_tally').eq('company_id', companyId).eq('sync_status', 'failed')
    await loadVouchers()
    for (const v of failed) await pushVoucher({ ...v, sync_status: 'pending' })
  }

  async function handleCreateVoucher(e) {
    e.preventDefault()
    if (!formData.party_ledger || !formData.amount) return toast.error('Party ledger and amount are required')
    const { data, error } = await ( supabase as any).from('tally_vouchers').insert({
      voucher_type: formData.voucher_type, date: formData.date, party_ledger: formData.party_ledger,
      amount: parseFloat(formData.amount), narration: formData.narration,
      sync_direction: 'to_tally', sync_status: 'pending',
    }).select().single()
    if (error) return toast.error('Failed to create voucher')
    toast.success('Voucher created locally')
    setShowModal(false)
    setFormData({ voucher_type: 'Sales', date: new Date().toISOString().split('T')[0], party_ledger: '', amount: '', narration: '' })
    await loadVouchers()
    if (data && !OUTBOUND_TALLY_DISABLED) {
      await pushVoucher(data)
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelected(selected.size === vouchers.length ? new Set() : new Set(vouchers.map(v => v.id)))
  }

  const fmt = (val) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0)
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

  const statusBadge = (status) => {
    const cfg = { synced: { cls: 'bg-green-100 text-green-700', icon: CheckCircle }, pending: { cls: 'bg-yellow-100 text-yellow-700', icon: Clock }, failed: { cls: 'bg-red-100 text-red-700', icon: XCircle } }
    const { cls, icon: Icon } = cfg[status] || { cls: 'bg-gray-100 text-gray-600', icon: Clock }
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}><Icon className="h-3 w-3" /> {status}</span>
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Vouchers', value: stats.total, color: 'blue' },
          { label: 'Synced', value: stats.synced, color: 'green' },
          { label: 'Pending', value: stats.pending, color: 'yellow' },
          { label: 'Failed', value: stats.failed, color: 'red' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border p-5">
            <p className="text-sm text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 text-${color}-600`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <ArrowUpFromLine className="h-5 w-5 text-blue-600" />
            Push Bills to TallyPrime
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setShowModal(true)}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Create New
            </button>
            <button
              onClick={pushSelected}
              disabled={OUTBOUND_TALLY_DISABLED || selected.size === 0}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="h-4 w-4" /> Push Selected ({selected.size})
            </button>
            <button
              onClick={retryFailed}
              disabled={OUTBOUND_TALLY_DISABLED || stats.failed === 0}
              className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <RotateCcw className="h-4 w-4" /> Retry Failed
            </button>
            <button
              onClick={loadVouchers}
              className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-1.5"
            >
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {['all', 'pending', 'synced', 'failed'].map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelected(new Set()) }}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                filter === f ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : vouchers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-12">No vouchers found for the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-2 px-3 text-left">
                    <input type="checkbox" checked={selected.size === vouchers.length && vouchers.length > 0} onChange={toggleSelectAll} className="rounded border-gray-300" />
                  </th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Bill ID</th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Date</th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Patient / Party</th>
                  <th className="py-2 px-3 text-right text-gray-500 font-medium">Amount (INR)</th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Type</th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Status</th>
                  <th className="py-2 px-3 text-left text-gray-500 font-medium">Error</th>
                  <th className="py-2 px-3 text-center text-gray-500 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v, idx) => (
                  <tr key={v.id} className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleSelect(v.id)} className="rounded border-gray-300" />
                    </td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-700">{v.adamrit_bill_id || v.voucher_number || v.id?.slice(0, 8)}</td>
                    <td className="py-2 px-3 text-gray-600">{fmtDate(v.date)}</td>
                    <td className="py-2 px-3 font-medium text-gray-900">{v.party_ledger || '-'}</td>
                    <td className="py-2 px-3 text-right font-medium text-gray-900">{fmt(v.amount)}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{v.voucher_type}</span>
                    </td>
                    <td className="py-2 px-3">{statusBadge(v.sync_status)}</td>
                    <td className="py-2 px-3 text-xs text-red-600 max-w-[200px] truncate" title={v.error_message || ''}>{v.error_message || '-'}</td>
                      <td className="py-2 px-3 text-center">
                      {v.sync_status === 'pending' && (
                        <button
                          onClick={() => pushVoucher(v)}
                          disabled={OUTBOUND_TALLY_DISABLED || pushing.has(v.id)}
                          className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {pushing.has(v.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          Push
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Voucher Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Create Voucher
              </h3>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreateVoucher} className="space-y-3">
              {[
                { label: 'Voucher Type', key: 'voucher_type', type: 'select', options: ['Sales', 'Receipt', 'Payment', 'Journal'] },
                { label: 'Date', key: 'date', type: 'date' },
                { label: 'Party Ledger', key: 'party_ledger', type: 'text', placeholder: 'Patient or party name' },
                { label: 'Amount', key: 'amount', type: 'number', placeholder: '0.00' },
              ].map(({ label, key, type, placeholder, options }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  {type === 'select' ? (
                    <select value={formData[key]} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                      {options.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={type} step={type === 'number' ? '0.01' : undefined} value={formData[key]} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  )}
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Narration</label>
                <textarea value={formData.narration} onChange={e => setFormData(p => ({ ...p, narration: e.target.value }))} rows={2} placeholder="Optional notes" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Send className="h-4 w-4" /> Create Voucher
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
