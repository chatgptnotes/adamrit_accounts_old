
import React, { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import {
  Loader2, ChevronDown, ChevronRight, Clock,
  BarChart3, Scale, TrendingUp, Users, CreditCard, Calendar
} from 'lucide-react'
import type {
  TrialBalanceEntry,
  BalanceSheetData,
  PnLData,
  OutstandingEntry,
} from '@/lib/tally-xml-service'

type TabKey = 'trial-balance' | 'balance-sheet' | 'pnl' | 'receivables' | 'payables'

interface TabDef {
  key: TabKey
  label: string
  icon: React.ElementType
}

const TABS: TabDef[] = [
  { key: 'trial-balance', label: 'Trial Balance', icon: Scale },
  { key: 'balance-sheet', label: 'Balance Sheet', icon: BarChart3 },
  { key: 'pnl', label: 'P&L', icon: TrendingUp },
  { key: 'receivables', label: 'Receivables', icon: Users },
  { key: 'payables', label: 'Payables', icon: CreditCard },
]

function formatINR(amount: number): string {
  if (amount === 0) return '0.00'
  const abs = Math.abs(amount)
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs)
  return amount < 0 ? `(${formatted})` : formatted
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function fyStartStr(): string {
  const now = new Date()
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-04-01`
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isRawReport(value: unknown): boolean {
  return isRecord(value) && typeof value.raw === 'string'
}

function asTrialBalance(value: unknown): TrialBalanceEntry[] | null {
  if (!Array.isArray(value)) return null
  return value
    .filter(isRecord)
    .map((entry) => ({
      ledgerName: String(entry.ledgerName || entry.name || ''),
      group: String(entry.group || entry.parentGroup || ''),
      debit: Number(entry.debit) || 0,
      credit: Number(entry.credit) || 0,
      closingBalance: Number(entry.closingBalance) || 0,
    }))
}

function asBalanceSheet(value: unknown): BalanceSheetData | null {
  if (!isRecord(value) || isRawReport(value)) return null
  if (!Array.isArray(value.assets) || !Array.isArray(value.liabilities)) return null
  return {
    assets: value.assets,
    liabilities: value.liabilities,
    totalAssets: Number(value.totalAssets) || 0,
    totalLiabilities: Number(value.totalLiabilities) || 0,
  }
}

function asPnL(value: unknown): PnLData | null {
  if (!isRecord(value) || isRawReport(value)) return null
  if (!Array.isArray(value.income) || !Array.isArray(value.expenses)) return null
  return {
    income: value.income,
    expenses: value.expenses,
    grossProfit: Number(value.grossProfit) || 0,
    netProfit: Number(value.netProfit) || 0,
    totalIncome: Number(value.totalIncome) || 0,
    totalExpenses: Number(value.totalExpenses) || 0,
  }
}

function asOutstanding(value: unknown): OutstandingEntry[] | null {
  if (!Array.isArray(value)) return null
  return value.filter(isRecord).map((entry) => ({
    partyName: String(entry.partyName || entry.name || ''),
    totalAmount: Number(entry.totalAmount) || 0,
    billDetails: Array.isArray(entry.billDetails) ? entry.billDetails : [],
    aging: {
      current: Number(entry.aging?.current) || 0,
      days30: Number(entry.aging?.days30) || 0,
      days60: Number(entry.aging?.days60) || 0,
      days90: Number(entry.aging?.days90) || 0,
      above90: Number(entry.aging?.above90) || 0,
    },
  }))
}

export default function TallyReports({ serverUrl, companyName, companyId }: { serverUrl: string; companyName: string; companyId: string }) {
  const [activeTab, setActiveTab] = useState<TabKey>('trial-balance')
  const [lastFetched, setLastFetched] = useState<Record<TabKey, string | null>>({
    'trial-balance': null, 'balance-sheet': null, 'pnl': null, 'receivables': null, 'payables': null,
  })

  // Date selectors
  const [tbDate, setTbDate] = useState(todayStr())
  const [bsDate, setBsDate] = useState(todayStr())
  const [pnlFrom, setPnlFrom] = useState(fyStartStr())
  const [pnlTo, setPnlTo] = useState(todayStr())

  // Report data
  const [trialBalance, setTrialBalance] = useState<TrialBalanceEntry[]>([])
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetData | null>(null)
  const [pnlData, setPnlData] = useState<PnLData | null>(null)
  const [receivables, setReceivables] = useState<OutstandingEntry[]>([])
  const [payables, setPayables] = useState<OutstandingEntry[]>([])

  // Expandable groups
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setLastFetched({
      'trial-balance': null, 'balance-sheet': null, 'pnl': null, 'receivables': null, 'payables': null,
    })
    setTrialBalance([])
    setBalanceSheet(null)
    setPnlData(null)
    setReceivables([])
    setPayables([])
    setExpanded({})
    loadCachedReports()
  }, [companyId])

  async function loadCachedReports() {
    if (!companyId) return
    const { data } = await supabase
      .from('tally_reports')
      .select('*')
      .eq('company_id', companyId)
      .order('fetched_at', { ascending: false })
      .limit(10)

    if (!data || data.length === 0) return

    const loaded: Record<TabKey, boolean> = {
      'trial-balance': false,
      'balance-sheet': false,
      pnl: false,
      receivables: false,
      payables: false,
    }

    for (const report of data) {
      const ts = report.fetched_at
      switch (report.report_type) {
        case 'trial_balance':
          if (!loaded['trial-balance']) {
            const parsed = asTrialBalance(report.data)
            if (parsed) {
              loaded['trial-balance'] = true
              setTrialBalance(parsed)
              setLastFetched(prev => ({ ...prev, 'trial-balance': ts }))
            }
          }
          break
        case 'balance_sheet':
          if (!loaded['balance-sheet']) {
            const parsed = asBalanceSheet(report.data)
            if (parsed) {
              loaded['balance-sheet'] = true
              setBalanceSheet(parsed)
              setLastFetched(prev => ({ ...prev, 'balance-sheet': ts }))
            }
          }
          break
        case 'pnl':
        case 'profit_and_loss':
          if (!loaded.pnl) {
            const parsed = asPnL(report.data)
            if (parsed) {
              loaded.pnl = true
              setPnlData(parsed)
              setLastFetched(prev => ({ ...prev, 'pnl': ts }))
            }
          }
          break
        case 'outstanding_receivables':
        case 'receivables':
          if (!loaded.receivables) {
            const parsed = asOutstanding(report.data)
            if (parsed) {
              loaded.receivables = true
              setReceivables(parsed)
              setLastFetched(prev => ({ ...prev, 'receivables': ts }))
            }
          }
          break
        case 'outstanding_payables':
        case 'payables':
          if (!loaded.payables) {
            const parsed = asOutstanding(report.data)
            if (parsed) {
              loaded.payables = true
              setPayables(parsed)
              setLastFetched(prev => ({ ...prev, 'payables': ts }))
            }
          }
          break
      }
    }
  }

  function toggleExpand(key: string) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function formatTimestamp(ts: string | null): string {
    if (!ts) return 'Never'
    return new Date(ts).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // ---- Renderers ----

  function renderDateSelector() {
    if (activeTab === 'trial-balance') {
      return (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <label className="text-sm text-gray-600">As on:</label>
          <input type="date" value={tbDate} onChange={e => setTbDate(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
      )
    }
    if (activeTab === 'balance-sheet') {
      return (
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <label className="text-sm text-gray-600">As on:</label>
          <input type="date" value={bsDate} onChange={e => setBsDate(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
      )
    }
    if (activeTab === 'pnl') {
      return (
        <div className="flex items-center gap-3">
          <Calendar className="h-4 w-4 text-gray-400" />
          <label className="text-sm text-gray-600">From:</label>
          <input type="date" value={pnlFrom} onChange={e => setPnlFrom(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          <label className="text-sm text-gray-600">To:</label>
          <input type="date" value={pnlTo} onChange={e => setPnlTo(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
        </div>
      )
    }
    return null
  }

  function renderTrialBalance() {
    if (trialBalance.length === 0) {
      return <EmptyState message="No Trial Balance data. Click Refresh All in the Tally toolbar to load it." />
    }
    const totalDebit = trialBalance.reduce((s, e) => s + e.debit, 0)
    const totalCredit = trialBalance.reduce((s, e) => s + e.credit, 0)

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-3 px-4 font-semibold text-gray-700">Ledger Name</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700">Group</th>
              <th className="text-right py-3 px-4 font-semibold text-gray-700">Debit (Rs.)</th>
              <th className="text-right py-3 px-4 font-semibold text-gray-700">Credit (Rs.)</th>
            </tr>
          </thead>
          <tbody>
            {trialBalance.map((entry, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/30">
                <td className="py-2 px-4 text-gray-900">{entry.ledgerName}</td>
                <td className="py-2 px-4 text-gray-500">{entry.group}</td>
                <td className="py-2 px-4 text-right font-mono text-gray-900">
                  {entry.debit > 0 ? formatINR(entry.debit) : '-'}
                </td>
                <td className="py-2 px-4 text-right font-mono text-gray-900">
                  {entry.credit > 0 ? formatINR(entry.credit) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
              <td className="py-3 px-4 text-blue-900" colSpan={2}>Total</td>
              <td className="py-3 px-4 text-right font-mono text-blue-900">{formatINR(totalDebit)}</td>
              <td className="py-3 px-4 text-right font-mono text-blue-900">{formatINR(totalCredit)}</td>
            </tr>
            {Math.abs(totalDebit - totalCredit) > 0.01 && (
              <tr className="bg-red-50">
                <td className="py-2 px-4 text-red-700 text-sm" colSpan={2}>Difference</td>
                <td className="py-2 px-4 text-right font-mono text-red-700 text-sm" colSpan={2}>
                  {formatINR(Math.abs(totalDebit - totalCredit))}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    )
  }

  function renderGroupItems(items: { name: string; amount: number; children?: { name: string; amount: number }[] }[], prefix: string) {
    return items.map((item, i) => {
      const key = `${prefix}-${i}`
      const hasChildren = item.children && item.children.length > 0
      return (
        <React.Fragment key={key}>
          <tr
            className={`border-b border-gray-100 ${hasChildren ? 'cursor-pointer hover:bg-blue-50/30' : 'hover:bg-gray-50'}`}
            onClick={() => hasChildren && toggleExpand(key)}
          >
            <td className="py-2 px-4 text-gray-900 flex items-center gap-1">
              {hasChildren ? (
                expanded[key] ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />
              ) : (
                <span className="inline-block w-4" />
              )}
              <span className={hasChildren ? 'font-medium' : ''}>{item.name}</span>
            </td>
            <td className="py-2 px-4 text-right font-mono text-gray-900">{formatINR(item.amount)}</td>
          </tr>
          {hasChildren && expanded[key] && item.children!.map((child, ci) => (
            <tr key={`${key}-c${ci}`} className="border-b border-gray-50 bg-gray-50/50">
              <td className="py-1.5 px-4 pl-10 text-gray-600 text-sm">{child.name}</td>
              <td className="py-1.5 px-4 text-right font-mono text-gray-600 text-sm">{formatINR(child.amount)}</td>
            </tr>
          ))}
        </React.Fragment>
      )
    })
  }

  function renderSection(title: string, items: any[], prefix: string, total: number, totalColor = 'blue') {
    const cls = `bg-${totalColor}-50 border-t-2 border-${totalColor}-200`
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2 px-4">{title}</h3>
        <div className="border rounded-lg overflow-hidden">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left py-2 px-4 font-semibold text-gray-600">Particulars</th>
                <th className="text-right py-2 px-4 font-semibold text-gray-600">Amount (Rs.)</th>
              </tr>
            </thead>
            <tbody>{renderGroupItems(items, prefix)}</tbody>
            <tfoot>
              <tr className={`${cls} font-bold`}>
                <td className={`py-3 px-4 text-${totalColor}-900`}>Total</td>
                <td className={`py-3 px-4 text-right font-mono text-${totalColor}-900`}>{formatINR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  function renderBalanceSheet() {
    if (!balanceSheet) {
      return <EmptyState message="No Balance Sheet data. Click Refresh All in the Tally toolbar to load it." />
    }
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {renderSection('Liabilities', balanceSheet.liabilities, 'bs-l', balanceSheet.totalLiabilities)}
        {renderSection('Assets', balanceSheet.assets, 'bs-a', balanceSheet.totalAssets)}
      </div>
    )
  }

  function renderPnL() {
    if (!pnlData) {
      return <EmptyState message="No Profit & Loss data. Click Refresh All in the Tally toolbar to load it." />
    }
    return (
      <div className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Total Income" amount={pnlData.totalIncome} color="green" />
          <SummaryCard label="Total Expenses" amount={pnlData.totalExpenses} color="red" />
          <SummaryCard label="Gross Profit" amount={pnlData.grossProfit} color="blue" />
          <SummaryCard label="Net Profit" amount={pnlData.netProfit}
            color={pnlData.netProfit >= 0 ? 'green' : 'red'} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderSection('Income', pnlData.income, 'pnl-i', pnlData.totalIncome, 'green')}
          {renderSection('Expenses', pnlData.expenses, 'pnl-e', pnlData.totalExpenses, 'red')}
        </div>
      </div>
    )
  }

  function renderOutstandingTable(entries: OutstandingEntry[], type: 'receivables' | 'payables') {
    if (entries.length === 0) {
      const label = type === 'receivables' ? 'Receivables' : 'Payables'
      return <EmptyState message={`No Outstanding ${label} data. Click Refresh All in the Tally toolbar to load it.`} />
    }
    const grandTotal = entries.reduce((s, e) => s + e.totalAmount, 0)

    return (
      <div className="space-y-4">
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 flex items-center justify-between">
          <span className="text-sm font-medium text-blue-800">
            Total Outstanding ({entries.length} {entries.length === 1 ? 'party' : 'parties'})
          </span>
          <span className="text-lg font-bold text-blue-900 font-mono">{formatINR(grandTotal)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left py-3 px-4 font-semibold text-gray-700">Party Name</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">Total (Rs.)</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">0-30 Days</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">30-60 Days</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">60-90 Days</th>
                <th className="text-right py-3 px-4 font-semibold text-gray-700">90+ Days</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-blue-50/30">
                  <td className="py-2 px-4 text-gray-900 font-medium">{entry.partyName}</td>
                  <td className="py-2 px-4 text-right font-mono text-gray-900">{formatINR(entry.totalAmount)}</td>
                  <td className="py-2 px-4 text-right font-mono text-gray-600">
                    {entry.aging.current > 0 ? formatINR(entry.aging.current) : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-gray-600">
                    {entry.aging.days30 > 0 ? formatINR(entry.aging.days30) : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-orange-600">
                    {entry.aging.days60 > 0 ? formatINR(entry.aging.days60) : '-'}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-red-600">
                    {(entry.aging.days90 + entry.aging.above90) > 0
                      ? formatINR(entry.aging.days90 + entry.aging.above90)
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-bold">
                <td className="py-3 px-4 text-blue-900">Total</td>
                <td className="py-3 px-4 text-right font-mono text-blue-900">{formatINR(grandTotal)}</td>
                <td className="py-3 px-4 text-right font-mono text-blue-800">
                  {formatINR(entries.reduce((s, e) => s + e.aging.current, 0))}
                </td>
                <td className="py-3 px-4 text-right font-mono text-blue-800">
                  {formatINR(entries.reduce((s, e) => s + e.aging.days30, 0))}
                </td>
                <td className="py-3 px-4 text-right font-mono text-blue-800">
                  {formatINR(entries.reduce((s, e) => s + e.aging.days60, 0))}
                </td>
                <td className="py-3 px-4 text-right font-mono text-blue-800">
                  {formatINR(entries.reduce((s, e) => s + e.aging.days90 + e.aging.above90, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  function renderTabContent() {
    switch (activeTab) {
      case 'trial-balance': return renderTrialBalance()
      case 'balance-sheet': return renderBalanceSheet()
      case 'pnl': return renderPnL()
      case 'receivables': return renderOutstandingTable(receivables, 'receivables')
      case 'payables': return renderOutstandingTable(payables, 'payables')
    }
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto -mb-px">
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-gray-50/50">
          <div className="flex items-center gap-4">
            {renderDateSelector()}
          </div>
          <div className="flex items-center gap-4">
            {lastFetched[activeTab] && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="h-3.5 w-3.5" />
                Last fetched: {formatTimestamp(lastFetched[activeTab])}
              </span>
            )}
          </div>
        </div>

        {/* Report Content */}
        <div className="p-5">
          {renderTabContent()}
        </div>
      </div>
    </div>
  )
}

// ---- Sub-components ----

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      <BarChart3 className="h-12 w-12 mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

function SummaryCard({ label, amount, color }: { label: string; amount: number; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
  }
  const cls = colorMap[color] || colorMap.blue
  return (
    <div className={`p-4 rounded-lg border ${cls}`}>
      <p className="text-sm opacity-80">{label}</p>
      <p className="text-xl font-bold font-mono mt-1">{formatINR(amount)}</p>
    </div>
  )
}
