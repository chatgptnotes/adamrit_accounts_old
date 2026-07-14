
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import {
  FileBarChart, Loader2, Calendar, ChevronDown
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

const TABS = [
  { id: 'gstr1', label: 'GSTR-1' },
  { id: 'gstr3b', label: 'GSTR-3B' },
  { id: 'gst_ledger', label: 'GST Ledger' },
]

// Generate month options for period selector
function getMonthOptions() {
  const options = []
  const now = new Date()
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    options.push({
      label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      from: d.toISOString().split('T')[0],
      to: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0],
    })
  }
  return options
}

export default function TallyGST({ serverUrl, companyName, companyId }) {
  const [activeTab, setActiveTab] = useState('gstr1')
  const [loading, setLoading] = useState(false)
  const months = getMonthOptions()
  const [selectedPeriod, setSelectedPeriod] = useState(0) // index into months

  // Data states
  const [gstr1Data, setGstr1Data] = useState(null)
  const [gstr3bData, setGstr3bData] = useState(null)
  const [gstLedger, setGstLedger] = useState([])

  const period = months[selectedPeriod]

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Try to load from cached data first
      const { data } = await supabase
        .from('tally_gst_data')
        .select('*')
        .eq('report_type', activeTab === 'gst_ledger' ? 'gst_ledger' : activeTab)
        .gte('period_from', period.from)
        .lte('period_to', period.to)
        .eq('company_id', companyId)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .single()

      if (data) {
        if (activeTab === 'gstr1') setGstr1Data(data.data)
        else if (activeTab === 'gstr3b') setGstr3bData(data.data)
        else setGstLedger(Array.isArray(data.data?.entries) ? data.data.entries : [])
      } else {
        // If no cached data, derive from vouchers
        await deriveFromVouchers()
      }
    } catch {
      await deriveFromVouchers()
    }
    setLoading(false)
  }, [activeTab, selectedPeriod, companyId])

  async function deriveFromVouchers() {
    // Get vouchers in date range
    const { data: vouchers } = await supabase
      .from('tally_vouchers')
      .select('*')
      .gte('date', period.from)
      .lte('date', period.to)
      .eq('company_id', companyId)
      .order('date', { ascending: true })

    const vch = vouchers || []

    if (activeTab === 'gstr1') {
      const salesVouchers = vch.filter(v => v.voucher_type === 'Sales')
      const b2b = []
      const b2c = []
      for (const v of salesVouchers) {
        const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
        let igst = 0, cgst = 0, sgst = 0, taxable = 0
        for (const e of entries) {
          const name = (e.ledger || '').toLowerCase()
          const amt = Math.abs(e.amount || 0)
          if (name.includes('igst')) igst += amt
          else if (name.includes('cgst')) cgst += amt
          else if (name.includes('sgst')) sgst += amt
          else if (!name.includes('tax')) taxable += amt
        }
        b2c.push({
          invoiceNumber: v.voucher_number,
          date: v.date,
          party: v.party_ledger,
          value: v.amount,
          taxableValue: taxable || v.amount,
          igst, cgst, sgst,
        })
      }
      setGstr1Data({ b2b, b2c, hsnSummary: [] })
    } else if (activeTab === 'gstr3b') {
      let outTaxable = 0, outIgst = 0, outCgst = 0, outSgst = 0
      let inTaxable = 0, inIgst = 0, inCgst = 0, inSgst = 0

      for (const v of vch) {
        const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
        const isSale = v.voucher_type === 'Sales'
        for (const e of entries) {
          const name = (e.ledger || '').toLowerCase()
          const amt = Math.abs(e.amount || 0)
          if (name.includes('igst')) { if (isSale) outIgst += amt; else inIgst += amt }
          else if (name.includes('cgst')) { if (isSale) outCgst += amt; else inCgst += amt }
          else if (name.includes('sgst')) { if (isSale) outSgst += amt; else inSgst += amt }
        }
        if (isSale) outTaxable += v.amount || 0
        else if (v.voucher_type === 'Purchase') inTaxable += v.amount || 0
      }

      setGstr3bData({
        outwardSupplies: { taxable: outTaxable, igst: outIgst, cgst: outCgst, sgst: outSgst },
        inwardSupplies: { taxable: inTaxable, igst: inIgst, cgst: inCgst, sgst: inSgst },
        itcAvailed: { igst: inIgst, cgst: inCgst, sgst: inSgst },
        taxPayable: { igst: outIgst - inIgst, cgst: outCgst - inCgst, sgst: outSgst - inSgst },
      })
    } else {
      const ledgerEntries = []
      for (const v of vch) {
        const entries = Array.isArray(v.ledger_entries) ? v.ledger_entries : []
        let igst = 0, cgst = 0, sgst = 0, taxable = 0, hasGst = false
        for (const e of entries) {
          const name = (e.ledger || '').toLowerCase()
          const amt = Math.abs(e.amount || 0)
          if (name.includes('igst')) { igst += amt; hasGst = true }
          else if (name.includes('cgst')) { cgst += amt; hasGst = true }
          else if (name.includes('sgst')) { sgst += amt; hasGst = true }
          else taxable += amt
        }
        if (hasGst) {
          ledgerEntries.push({
            date: v.date,
            voucherNumber: v.voucher_number,
            voucherType: v.voucher_type,
            party: v.party_ledger,
            taxableValue: taxable || v.amount,
            igst, cgst, sgst,
          })
        }
      }
      setGstLedger(ledgerEntries)
    }
  }

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="space-y-4">
      {/* Tab Navigation + Period */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeTab === tab.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={selectedPeriod}
                onChange={e => setSelectedPeriod(Number(e.target.value))}
                className="pl-3 pr-8 py-1.5 border border-gray-300 rounded-lg text-sm bg-white appearance-none cursor-pointer"
              >
                {months.map((m, idx) => (
                  <option key={idx} value={idx}>{m.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 bg-white rounded-xl shadow-sm border">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          <span className="ml-2 text-sm text-gray-500">Loading GST data...</span>
        </div>
      ) : (
        <>
          {/* GSTR-1 View */}
          {activeTab === 'gstr1' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl shadow-sm border">
                <div className="p-4 border-b">
                  <h3 className="text-sm font-semibold text-gray-900">B2C Sales ({(gstr1Data?.b2c || []).length} invoices)</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="text-left py-2.5 px-3 font-medium text-gray-600">Invoice No</th>
                        <th className="text-left py-2.5 px-3 font-medium text-gray-600">Date</th>
                        <th className="text-left py-2.5 px-3 font-medium text-gray-600">Party</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600">Value</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600">Taxable</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600">IGST</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600">CGST</th>
                        <th className="text-right py-2.5 px-3 font-medium text-gray-600">SGST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(gstr1Data?.b2c || []).length === 0 && (
                        <tr><td colSpan={8} className="text-center py-8 text-gray-400">No B2C sales data</td></tr>
                      )}
                      {(gstr1Data?.b2c || []).map((inv, idx) => (
                        <tr key={idx} className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                          <td className="py-2 px-3 font-mono text-xs">{inv.invoiceNumber || '-'}</td>
                          <td className="py-2 px-3">{formatDate(inv.date)}</td>
                          <td className="py-2 px-3 max-w-[200px] truncate">{inv.party || '-'}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(inv.value)}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency(inv.taxableValue)}</td>
                          <td className="py-2 px-3 text-right">{inv.igst > 0 ? formatCurrency(inv.igst) : '-'}</td>
                          <td className="py-2 px-3 text-right">{inv.cgst > 0 ? formatCurrency(inv.cgst) : '-'}</td>
                          <td className="py-2 px-3 text-right">{inv.sgst > 0 ? formatCurrency(inv.sgst) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    {(gstr1Data?.b2c || []).length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 bg-gray-50 font-semibold">
                          <td colSpan={3} className="py-2 px-3">Total</td>
                          <td className="py-2 px-3 text-right">{formatCurrency((gstr1Data?.b2c || []).reduce((s, i) => s + (i.value || 0), 0))}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency((gstr1Data?.b2c || []).reduce((s, i) => s + (i.taxableValue || 0), 0))}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency((gstr1Data?.b2c || []).reduce((s, i) => s + (i.igst || 0), 0))}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency((gstr1Data?.b2c || []).reduce((s, i) => s + (i.cgst || 0), 0))}</td>
                          <td className="py-2 px-3 text-right">{formatCurrency((gstr1Data?.b2c || []).reduce((s, i) => s + (i.sgst || 0), 0))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {/* HSN Summary */}
              {(gstr1Data?.hsnSummary || []).length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border">
                  <div className="p-4 border-b"><h3 className="text-sm font-semibold text-gray-900">HSN Summary</h3></div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="text-left py-2 px-3 font-medium text-gray-600">HSN Code</th>
                          <th className="text-left py-2 px-3 font-medium text-gray-600">Description</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Qty</th>
                          <th className="text-right py-2 px-3 font-medium text-gray-600">Taxable Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gstr1Data.hsnSummary.map((h, idx) => (
                          <tr key={idx} className="border-b">
                            <td className="py-2 px-3 font-mono">{h.hsnCode}</td>
                            <td className="py-2 px-3">{h.description}</td>
                            <td className="py-2 px-3 text-right">{h.qty}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(h.taxableValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* GSTR-3B View */}
          {activeTab === 'gstr3b' && gstr3bData && (
            <div className="space-y-4">
              {[
                { title: '3.1 Outward Supplies', data: gstr3bData.outwardSupplies, color: 'blue' },
                { title: '3.2 Inward Supplies', data: gstr3bData.inwardSupplies, color: 'green' },
                { title: '4. ITC Availed', data: gstr3bData.itcAvailed, color: 'purple', noTaxable: true },
                { title: '6. Tax Payable', data: gstr3bData.taxPayable, color: 'red', noTaxable: true },
              ].map(section => (
                <div key={section.title} className="bg-white rounded-xl shadow-sm border p-5">
                  <h3 className={`text-sm font-semibold text-${section.color}-700 mb-3`}>{section.title}</h3>
                  <div className={`grid ${section.noTaxable ? 'grid-cols-3' : 'grid-cols-4'} gap-4`}>
                    {!section.noTaxable && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500">Taxable Value</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(section.data.taxable)}</p>
                      </div>
                    )}
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">IGST</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(section.data.igst)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">CGST</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(section.data.cgst)}</p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-500">SGST</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(section.data.sgst)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* GST Ledger View */}
          {activeTab === 'gst_ledger' && (
            <div className="bg-white rounded-xl shadow-sm border">
              <div className="p-4 border-b">
                <h3 className="text-sm font-semibold text-gray-900">GST Ledger ({gstLedger.length} entries)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">Date</th>
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">Voucher No</th>
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">Type</th>
                      <th className="text-left py-2.5 px-3 font-medium text-gray-600">Party</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">Taxable</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">IGST</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">CGST</th>
                      <th className="text-right py-2.5 px-3 font-medium text-gray-600">SGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstLedger.length === 0 && (
                      <tr><td colSpan={8} className="text-center py-12 text-gray-400">No GST entries for this period</td></tr>
                    )}
                    {gstLedger.map((entry, idx) => (
                      <tr key={idx} className={`border-b ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                        <td className="py-2 px-3">{formatDate(entry.date)}</td>
                        <td className="py-2 px-3 font-mono text-xs">{entry.voucherNumber || '-'}</td>
                        <td className="py-2 px-3">
                          <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">
                            {entry.voucherType}
                          </span>
                        </td>
                        <td className="py-2 px-3 max-w-[200px] truncate">{entry.party || '-'}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(entry.taxableValue)}</td>
                        <td className="py-2 px-3 text-right">{entry.igst > 0 ? formatCurrency(entry.igst) : '-'}</td>
                        <td className="py-2 px-3 text-right">{entry.cgst > 0 ? formatCurrency(entry.cgst) : '-'}</td>
                        <td className="py-2 px-3 text-right">{entry.sgst > 0 ? formatCurrency(entry.sgst) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  {gstLedger.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 bg-gray-50 font-semibold">
                        <td colSpan={4} className="py-2 px-3">Total</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(gstLedger.reduce((s, e) => s + (e.taxableValue || 0), 0))}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(gstLedger.reduce((s, e) => s + (e.igst || 0), 0))}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(gstLedger.reduce((s, e) => s + (e.cgst || 0), 0))}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(gstLedger.reduce((s, e) => s + (e.sgst || 0), 0))}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
