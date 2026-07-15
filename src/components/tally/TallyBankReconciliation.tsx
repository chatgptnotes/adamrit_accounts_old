
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import {
  Scale, Upload, Loader2, ChevronDown, CheckCircle, XCircle,
  AlertTriangle, Link, Unlink, X, Plus, Trash2
} from 'lucide-react'

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

export default function TallyBankReconciliation({ serverUrl, companyName, companyId }) {
  const [banks, setBanks] = useState([])
  const [selectedBank, setSelectedBank] = useState('')
  const [tallyEntries, setTallyEntries] = useState([])
  const [bankStatements, setBankStatements] = useState([])
  const [loading, setLoading] = useState(true)
  const [matching, setMatching] = useState(false)
  const [selectedTally, setSelectedTally] = useState(null)
  const [selectedBank_, setSelectedBank_] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [manualEntry, setManualEntry] = useState({ date: '', description: '', reference: '', deposit: '', withdrawal: '' })

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  )
  const [dateTo, setDateTo] = useState(now.toISOString().split('T')[0])

  // Load bank accounts
  useEffect(() => {
    async function loadBanks() {
      const { data } = await supabase
        .from('tally_ledgers')
        .select('name, closing_balance')
        .eq('company_id', companyId)
        .or('parent_group.ilike.%bank account%,parent_group.ilike.%bank accounts%')
        .order('name')
      if (data && data.length > 0) {
        setBanks(data)
        setSelectedBank(data[0].name)
      }
      setLoading(false)
    }
    loadBanks()
  }, [companyId])

  // Fetch tally entries and bank statements
  const fetchData = useCallback(async () => {
    if (!selectedBank) return
    setLoading(true)
    try {
      // Tally entries
      let q = ( supabase as any).from('tally_vouchers').select('*').eq('company_id', companyId).order('date', { ascending: true }).limit(2000)
      if (dateFrom) q = q.gte('date', dateFrom)
      if (dateTo) q = q.lte('date', dateTo)
      const { data: vData } = await q

      const bankName = selectedBank.toLowerCase()
      const filtered = (vData || []).filter(v => {
        const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
        return entries.some(e => (e.ledger || '').toLowerCase() === bankName)
      }).map(v => {
        const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
        let deposit = 0, withdrawal = 0
        for (const e of entries) {
          if ((e.ledger || '').toLowerCase() === bankName) {
            if (e.is_debit) deposit += Math.abs(e.amount || 0)
            else withdrawal += Math.abs(e.amount || 0)
          }
        }
        return { ...v, deposit, withdrawal }
      })
      setTallyEntries(filtered)

      // Bank statements
      const { data: stmtData } = await supabase
        .from('tally_bank_statements')
        .select('*')
        .eq('company_id', companyId)
        .eq('bank_ledger', selectedBank)
        .gte('date', dateFrom || '2000-01-01')
        .lte('date', dateTo || '2099-12-31')
        .order('date', { ascending: true })

      setBankStatements(stmtData || [])
    } catch {
      toast.error('Failed to load reconciliation data')
    }
    setLoading(false)
  }, [selectedBank, dateFrom, dateTo, companyId])

  useEffect(() => {
    if (selectedBank) fetchData()
  }, [fetchData])

  // Auto-match: by amount and date proximity (within 3 days)
  async function autoMatch() {
    setMatching(true)
    let matchCount = 0

    const unmatchedTally = tallyEntries.filter(t => !bankStatements.some(s => s.matched_voucher_id === t.id))
    const unmatchedStmts = bankStatements.filter(s => s.match_status !== 'matched')

    for (const stmt of unmatchedStmts) {
      const stmtAmount = (stmt.deposit || 0) > 0 ? stmt.deposit : stmt.withdrawal
      const stmtDate = new Date(stmt.date)

      const match = unmatchedTally.find(t => {
        const tallyAmount = (t.deposit || 0) > 0 ? t.deposit : t.withdrawal
        const tallyDate = new Date(t.date)
        const daysDiff = Math.abs((stmtDate - tallyDate) / (1000 * 60 * 60 * 24))
        return Math.abs(stmtAmount - tallyAmount) < 0.01 && daysDiff <= 3
      })

      if (match) {
        await ( supabase as any).from('tally_bank_statements')
          .update({ matched_voucher_id: match.id, match_status: 'matched' })
          .eq('id', stmt.id)
        matchCount++
      }
    }

    toast.success(`Auto-matched ${matchCount} entries`)
    await fetchData()
    setMatching(false)
  }

  // Manual match
  async function manualMatch() {
    if (!selectedTally || !selectedBank_) return
    await ( supabase as any).from('tally_bank_statements')
      .update({ matched_voucher_id: selectedTally.id, match_status: 'matched' })
      .eq('id', selectedBank_.id)
    toast.success('Entries matched')
    setSelectedTally(null)
    setSelectedBank_(null)
    await fetchData()
  }

  // Unmatch
  async function unmatch(stmtId) {
    await ( supabase as any).from('tally_bank_statements')
      .update({ matched_voucher_id: null, match_status: 'unmatched' })
      .eq('id', stmtId)
    toast.success('Unmatched')
    await fetchData()
  }

  // CSV Upload
  async function handleCsvUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedBank) return
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) { toast.error('Invalid CSV'); return }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const dateIdx = headers.findIndex(h => h.includes('date'))
    const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('narration') || h.includes('particular'))
    const refIdx = headers.findIndex(h => h.includes('ref') || h.includes('cheque'))
    const depIdx = headers.findIndex(h => h.includes('deposit') || h.includes('credit'))
    const wdIdx = headers.findIndex(h => h.includes('withdrawal') || h.includes('debit'))
    const balIdx = headers.findIndex(h => h.includes('balance'))

    let inserted = 0
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      if (cols.length < 2) continue

      const dateStr = cols[dateIdx] || ''
      // Try to parse date
      let parsedDate = ''
      if (dateStr.match(/\d{4}-\d{2}-\d{2}/)) parsedDate = dateStr
      else if (dateStr.match(/\d{2}\/\d{2}\/\d{4}/)) {
        const [d, m, y] = dateStr.split('/')
        parsedDate = `${y}-${m}-${d}`
      } else if (dateStr.match(/\d{2}-\d{2}-\d{4}/)) {
        const [d, m, y] = dateStr.split('-')
        parsedDate = `${y}-${m}-${d}`
      }
      if (!parsedDate) continue

      await ( supabase as any).from('tally_bank_statements').insert({
        bank_ledger: selectedBank,
        date: parsedDate,
        description: cols[descIdx] || null,
        reference: refIdx >= 0 ? cols[refIdx] || null : null,
        deposit: depIdx >= 0 ? parseFloat(cols[depIdx] || '0') || 0 : 0,
        withdrawal: wdIdx >= 0 ? parseFloat(cols[wdIdx] || '0') || 0 : 0,
        balance: balIdx >= 0 ? parseFloat(cols[balIdx] || '0') || 0 : null,
        match_status: 'unmatched',
      })
      inserted++
    }

    toast.success(`Uploaded ${inserted} bank statement entries`)
    setShowUpload(false)
    await fetchData()
  }

  // Manual entry
  async function handleManualAdd() {
    if (!manualEntry.date || !selectedBank) return
    await ( supabase as any).from('tally_bank_statements').insert({
      bank_ledger: selectedBank,
      date: manualEntry.date,
      description: manualEntry.description || null,
      reference: manualEntry.reference || null,
      deposit: parseFloat(manualEntry.deposit || '0') || 0,
      withdrawal: parseFloat(manualEntry.withdrawal || '0') || 0,
      match_status: 'unmatched',
    })
    toast.success('Entry added')
    setManualEntry({ date: '', description: '', reference: '', deposit: '', withdrawal: '' })
    setShowManualEntry(false)
    await fetchData()
  }

  // Summary
  const summary = useMemo(() => {
    const tallyBal = tallyEntries.reduce((s, t) => s + (t.deposit || 0) - (t.withdrawal || 0), 0)
    const bankBal = bankStatements.reduce((s, s2) => s + (s2.deposit || 0) - (s2.withdrawal || 0), 0)
    const matched = bankStatements.filter(s => s.match_status === 'matched').length
    const unmatched = bankStatements.filter(s => s.match_status !== 'matched').length
    const unmatchedTally = tallyEntries.filter(t => !bankStatements.some(s => s.matched_voucher_id === t.id)).length
    return { tallyBal, bankBal, diff: tallyBal - bankBal, matched, unmatched, unmatchedTally }
  }, [tallyEntries, bankStatements])

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3">
          <p className="text-xs text-blue-600">Tally Balance</p>
          <p className="text-lg font-bold text-blue-800">{formatCurrency(summary.tallyBal)}</p>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-3">
          <p className="text-xs text-green-600">Bank Balance</p>
          <p className="text-lg font-bold text-green-800">{formatCurrency(summary.bankBal)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${Math.abs(summary.diff) < 0.01 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs text-gray-600">Difference</p>
          <p className={`text-lg font-bold ${Math.abs(summary.diff) < 0.01 ? 'text-green-800' : 'text-red-800'}`}>{formatCurrency(summary.diff)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <p className="text-xs text-gray-500">Matched</p>
          <p className="text-lg font-bold text-green-700">{summary.matched}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <p className="text-xs text-gray-500">Unmatched (Bank)</p>
          <p className="text-lg font-bold text-orange-600">{summary.unmatched}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-3">
          <p className="text-xs text-gray-500">Unmatched (Tally)</p>
          <p className="text-lg font-bold text-orange-600">{summary.unmatchedTally}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank Account</label>
            <div className="relative">
              <select
                value={selectedBank}
                onChange={e => setSelectedBank(e.target.value)}
                className="pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm bg-white appearance-none cursor-pointer min-w-[200px]"
              >
                {banks.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={autoMatch} disabled={matching}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {matching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link className="h-4 w-4" />}
              Auto-Match
            </button>
            <button onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
              <Upload className="h-4 w-4" /> Upload CSV
            </button>
            <button onClick={() => setShowManualEntry(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Plus className="h-4 w-4" /> Manual Entry
            </button>
          </div>
        </div>
      </div>

      {/* Manual match indicator */}
      {(selectedTally || selectedBank_) && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 flex items-center justify-between">
          <p className="text-sm text-yellow-800">
            Manual Match: {selectedTally ? `Tally: ${selectedTally.voucher_number || 'Selected'}` : 'Select a Tally entry'} + {selectedBank_ ? `Bank: ${selectedBank_.description || 'Selected'}` : 'Select a Bank entry'}
          </p>
          <div className="flex gap-2">
            {selectedTally && selectedBank_ && (
              <button onClick={manualMatch}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">
                Link
              </button>
            )}
            <button onClick={() => { setSelectedTally(null); setSelectedBank_(null) }}
              className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT: Tally Entries */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Scale className="h-4 w-4 text-blue-600" /> Tally Entries ({tallyEntries.length})
            </h3>
          </div>
          <div className="overflow-y-auto max-h-[500px]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Date</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Vch No</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Dr</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Cr</th>
                  <th className="text-center py-2 px-2 font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {tallyEntries.map(t => {
                  const isMatched = bankStatements.some(s => s.matched_voucher_id === t.id)
                  const isSelected = selectedTally?.id === t.id
                  return (
                    <tr
                      key={t.id}
                      onClick={() => !isMatched && setSelectedTally(isSelected ? null : t)}
                      className={`border-b cursor-pointer transition-colors ${
                        isMatched ? 'bg-green-50 opacity-60' : isSelected ? 'bg-blue-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-1.5 px-2">{formatDate(t.date)}</td>
                      <td className="py-1.5 px-2 font-mono">{t.voucher_number || '-'}</td>
                      <td className="py-1.5 px-2 text-right text-green-700">{t.deposit > 0 ? formatCurrency(t.deposit) : ''}</td>
                      <td className="py-1.5 px-2 text-right text-red-600">{t.withdrawal > 0 ? formatCurrency(t.withdrawal) : ''}</td>
                      <td className="py-1.5 px-2 text-center">
                        {isMatched ? <CheckCircle className="h-3 w-3 text-green-600 mx-auto" /> : <XCircle className="h-3 w-3 text-gray-300 mx-auto" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Bank Statement Entries */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Landmark className="h-4 w-4 text-green-600" /> Bank Statement ({bankStatements.length})
            </h3>
          </div>
          <div className="overflow-y-auto max-h-[500px]">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Date</th>
                  <th className="text-left py-2 px-2 font-medium text-gray-600">Description</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Dr</th>
                  <th className="text-right py-2 px-2 font-medium text-gray-600">Cr</th>
                  <th className="text-center py-2 px-2 font-medium text-gray-600">Status</th>
                  <th className="py-2 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {bankStatements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-400">
                      No bank statement entries. Upload a CSV or add manually.
                    </td>
                  </tr>
                )}
                {bankStatements.map(s => {
                  const isMatched = s.match_status === 'matched'
                  const isSelected = selectedBank_?.id === s.id
                  return (
                    <tr
                      key={s.id}
                      onClick={() => !isMatched && setSelectedBank_(isSelected ? null : s)}
                      className={`border-b cursor-pointer transition-colors ${
                        isMatched ? 'bg-green-50 opacity-60' : isSelected ? 'bg-blue-100' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-1.5 px-2">{formatDate(s.date)}</td>
                      <td className="py-1.5 px-2 max-w-[150px] truncate">{s.description || s.reference || '-'}</td>
                      <td className="py-1.5 px-2 text-right text-green-700">{s.deposit > 0 ? formatCurrency(s.deposit) : ''}</td>
                      <td className="py-1.5 px-2 text-right text-red-600">{s.withdrawal > 0 ? formatCurrency(s.withdrawal) : ''}</td>
                      <td className="py-1.5 px-2 text-center">
                        {isMatched ? <CheckCircle className="h-3 w-3 text-green-600 mx-auto" /> : <XCircle className="h-3 w-3 text-gray-300 mx-auto" />}
                      </td>
                      <td className="py-1.5 px-2">
                        {isMatched && (
                          <button onClick={(e) => { e.stopPropagation(); unmatch(s.id) }}
                            className="text-gray-400 hover:text-red-500">
                            <Unlink className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Upload CSV Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowUpload(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Upload Bank Statement CSV</h3>
              <button onClick={() => setShowUpload(false)}><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              CSV should have columns: Date, Description/Narration, Deposit/Credit, Withdrawal/Debit.
              Optional: Reference/Cheque No, Balance.
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
        </div>
      )}

      {/* Manual Entry Modal */}
      {showManualEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowManualEntry(false)}>
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Bank Statement Entry</h3>
              <button onClick={() => setShowManualEntry(false)}><X className="h-5 w-5 text-gray-500" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date *</label>
                <input type="date" value={manualEntry.date} onChange={e => setManualEntry({ ...manualEntry, date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input type="text" value={manualEntry.description} onChange={e => setManualEntry({ ...manualEntry, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Transaction description" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference</label>
                <input type="text" value={manualEntry.reference} onChange={e => setManualEntry({ ...manualEntry, reference: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Cheque/Ref number" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Deposit</label>
                  <input type="number" value={manualEntry.deposit} onChange={e => setManualEntry({ ...manualEntry, deposit: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Withdrawal</label>
                  <input type="number" value={manualEntry.withdrawal} onChange={e => setManualEntry({ ...manualEntry, withdrawal: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowManualEntry(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
              <button onClick={handleManualAdd} disabled={!manualEntry.date}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                Add Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
