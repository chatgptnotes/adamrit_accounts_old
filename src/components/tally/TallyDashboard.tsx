
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import {
  Settings, Wifi, WifiOff, Database, FileText,
  Package, BarChart3, ArrowDownToLine, ArrowUpFromLine,
  CheckCircle, XCircle, Clock, Loader2,
  PlusCircle, Trash2
} from 'lucide-react'

interface TallyDashboardProps {
  serverUrl: string
  companyName: string
  companyId: string
  configs: { id: string; server_url: string; company_name: string; is_active?: boolean | null }[]
  liveCompanies?: string[]
  onConfigChange?: (newId?: string) => void
}

function dedupeCompanyNames(options: string[]) {
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = companyKey(option)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function companyKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getTimestamp(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

function isCompanyMismatchError(message: string) {
  const text = (message || '').toLowerCase()
  return text.includes('company') && (text.includes('not found') || text.includes('mismatch'))
}

export default function TallyDashboard({ serverUrl: propServerUrl, companyName: propCompanyName, companyId: propCompanyId, configs = [], liveCompanies = [], onConfigChange }: TallyDashboardProps) {
  const { hospitalType } = useAuth()
  const [serverUrl, setServerUrl] = useState(propServerUrl ?? '')
  const [isAddingCompany, setIsAddingCompany] = useState(false)
  const [companyName, setCompanyName] = useState(propCompanyName || '')
  const [isConnected, setIsConnected] = useState(false)
  const [connectionInfo, setConnectionInfo] = useState(null)
  const [connectionError, setConnectionError] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [configId, setConfigId] = useState(null)

  // Stats
  const [stats, setStats] = useState({
    ledgers: 0, vouchers: 0, stockItems: 0, reports: 0
  })
  const [financials, setFinancials] = useState({
    cashInHand: 0, bankBalance: 0, receivables: 0, payables: 0
  })

  // Sync logs
  const [syncLogs, setSyncLogs] = useState([])

  const companyInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (propServerUrl) setServerUrl(propServerUrl)
    if (propCompanyName) setCompanyName(propCompanyName)
    if (propCompanyId) setConfigId(propCompanyId)
  }, [propServerUrl, propCompanyName, propCompanyId])

  useEffect(() => {
    if (propServerUrl && propCompanyName) void testConnection(propServerUrl, propCompanyName)
  }, [propServerUrl, propCompanyName])

  useEffect(() => {
    loadConfig()
    loadStats()
    loadSyncLogs()
  }, [configId])

  async function loadConfig() {
    if (!configId) return
    const { data } = await supabase
      .from('tally_config')
      .select('*')
      .eq('id', configId)
      .single()

    if (data) {
      setServerUrl(data.server_url || '')
      setCompanyName(data.company_name || '')
    }
  }

  async function loadStats() {
    if (!companyName) return
    const [ledgers, vouchers, stock, reports] = await Promise.all([
      ( supabase as any).from('tally_ledgers').select('*', { count: 'exact', head: true }).eq('company_id', configId),
      ( supabase as any).from('tally_vouchers').select('*', { count: 'exact', head: true }).eq('company_id', configId),
      ( supabase as any).from('tally_stock_items').select('*', { count: 'exact', head: true }).eq('company_id', configId),
      ( supabase as any).from('tally_reports').select('*', { count: 'exact', head: true }).eq('company_id', configId),
    ])
    setStats({
      ledgers: ledgers.count || 0,
      vouchers: vouchers.count || 0,
      stockItems: stock.count || 0,
      reports: reports.count || 0,
    })

    // Load financial snapshot from ledgers
    const { data: cashLedgers } = await supabase
      .from('tally_ledgers')
      .select('name, closing_balance, parent_group')
      .eq('company_id', configId)
      .or('parent_group.ilike.%cash%,parent_group.ilike.%bank%')
      .limit(50)

    if (cashLedgers) {
      let cash = 0, bank = 0
      for (const l of cashLedgers) {
        const pg = (l.parent_group || '').toLowerCase()
        if (pg.includes('cash')) cash += Math.abs(l.closing_balance || 0)
        else if (pg.includes('bank')) bank += Math.abs(l.closing_balance || 0)
      }
      setFinancials(prev => ({ ...prev, cashInHand: cash, bankBalance: bank }))
    }

    const { data: debtors } = await supabase
      .from('tally_ledgers')
      .select('closing_balance')
      .eq('company_id', configId)
      .ilike('parent_group', '%sundry debtor%')
      .limit(100)

    const { data: creditors } = await supabase
      .from('tally_ledgers')
      .select('closing_balance')
      .eq('company_id', configId)
      .ilike('parent_group', '%sundry creditor%')
      .limit(100)

    setFinancials(prev => ({
      ...prev,
      receivables: (debtors || []).reduce((s, l) => s + Math.abs(l.closing_balance || 0), 0),
      payables: (creditors || []).reduce((s, l) => s + Math.abs(l.closing_balance || 0), 0),
    }))
  }

  async function loadSyncLogs() {
    let query = supabase
      .from('tally_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20)

    if (companyName) {
      query = query.eq('company_id', configId)
    }

    const { data } = await query
    setSyncLogs(data || [])
  }

  async function testConnection(serverUrlOverride?: string, companyNameOverride?: string) {
    setIsTesting(true)
    const normalizedServerUrl = (serverUrlOverride ?? serverUrl).trim()
    const normalizedCompanyName = (companyNameOverride ?? companyName).trim()
    if (!normalizedServerUrl) {
      setIsConnected(false)
      setConnectionInfo(null)
      setConnectionError('Enter the Tally server URL first, for example http://192.168.1.10:9000')
      toast.error('Tally server URL is required')
      setIsTesting(false)
      return
    }
    if (!normalizedCompanyName) {
      setIsConnected(false)
      setConnectionInfo(null)
      setConnectionError('Select or enter the Tally company name first')
      toast.error('Tally company name is required')
      setIsTesting(false)
      return
    }
    try {
      const res = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'test-connection',
          serverUrl: normalizedServerUrl,
          companyName: normalizedCompanyName,
        }),
      })
      const result = await res.json()

      if (result.connected && result.companyValid !== false) {
        setIsConnected(true)
        setConnectionInfo(result)
        setConnectionError('')
        if (!companyName.trim() && result.companies?.[0]) {
          setCompanyName(result.companies[0])
        }
        toast.success(`Connected to TallyPrime! Found ${result.companies.length} company(ies)`)
      } else {
        setIsConnected(false)
        setConnectionInfo(null)
        const errorMessage = result.error || (result.companyValid === false
          ? `Company "${normalizedCompanyName}" was not found on this Tally server`
          : 'Cannot connect to Tally server')
        setConnectionError(errorMessage)
        toast.error(errorMessage)
      }
    } catch (err) {
      setIsConnected(false)
      setConnectionError('Failed to test connection. Check that the Tally proxy API is deployed and reachable.')
      toast.error('Failed to test connection. Check that the Tally proxy API is deployed and reachable.')
    }
    setIsTesting(false)
  }

  async function saveConfig() {
    if (!serverUrl.trim()) {
      toast.error('Enter the Tally server URL before saving')
      return
    }
    if (!companyName.trim()) {
      toast.error('Enter or select the Tally company name before saving')
      return
    }
    setIsSaving(true)
    try {
      const payload = {
        company_name: companyName.trim(),
        server_url: serverUrl,
        is_active: true,
        hospital_id: hospitalType || 'hope',
        updated_at: new Date().toISOString(),
      }

      const { data: existingConfigs, error: lookupError } = await (supabase as any)
        .from('tally_config')
        .select('id, company_name, is_active, last_sync_at, updated_at, created_at')
      if (lookupError) throw lookupError

      const currentConfig = (existingConfigs || []).find((config: any) => config.id === configId)
      const currentMatchesName = currentConfig &&
        companyKey(currentConfig.company_name || '') === companyKey(companyName)
      const matchingConfig = (existingConfigs || [])
        .filter((config: any) => config.id !== configId && companyKey(config.company_name || '') === companyKey(companyName))
        .sort((left: any, right: any) => {
          const activeDelta = Number(right.is_active !== false) - Number(left.is_active !== false)
          if (activeDelta !== 0) return activeDelta
          const syncDelta = getTimestamp(right.last_sync_at) - getTimestamp(left.last_sync_at)
          if (syncDelta !== 0) return syncDelta
          const updatedDelta = getTimestamp(right.updated_at) - getTimestamp(left.updated_at)
          if (updatedDelta !== 0) return updatedDelta
          return getTimestamp(right.created_at) - getTimestamp(left.created_at)
        })[0]

      if (configId && currentMatchesName) {
        const { error } = await (supabase as any).from('tally_config').update(payload).eq('id', configId)
        if (error) throw error
        toast.success('Configuration saved')
        onConfigChange?.(configId)
      } else if (matchingConfig) {
        const { error } = await (supabase as any).from('tally_config').update(payload).eq('id', matchingConfig.id)
        if (error) throw error
        setConfigId(matchingConfig.id)
        setIsAddingCompany(false)
        toast.success('Existing company configuration reused')
        onConfigChange?.(matchingConfig.id)
      } else if (configId) {
        const { error } = await (supabase as any).from('tally_config').update(payload).eq('id', configId)
        if (error) throw error
        toast.success('Configuration saved')
        onConfigChange?.(configId)
      } else {
        const { data, error } = await (supabase as any).from('tally_config').insert(payload).select().single()
        if (error) throw error
        if (data) {
          setConfigId(data.id)
          setIsAddingCompany(false)
          toast.success('New company added')
          onConfigChange?.(data.id)
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save configuration')
    }
    setIsSaving(false)
  }

  function handleAddCompany() {
    setIsAddingCompany(true)
    setCompanyName('')
    setConfigId(null)
    setIsConnected(false)
    setConnectionInfo(null)
    setConnectionError('')
    toast.info('Enter the new company name and click Save Configuration')
    setTimeout(() => companyInputRef.current?.focus(), 0)
  }

  const connectionState = (() => {
    if (isConnected) {
      return {
        tone: 'green',
        title: 'Connected to TallyPrime',
        detail: connectionInfo?.version ? `v${connectionInfo.version}` : 'Connection verified',
      }
    }

    if (connectionError) {
      if (isCompanyMismatchError(connectionError)) {
        return {
          tone: 'amber',
          title: 'Tally company not found',
          detail: connectionError,
        }
      }

      return {
        tone: 'red',
        title: 'Tally server is not reachable',
        detail: connectionError,
      }
    }

    return null
  })()

  async function handleDeleteCompany() {
    if (!configId) return
    if (!confirm(`Delete company "${companyName}" configuration? This only removes the config, not the synced data.`)) return
    try {
      await (supabase as any).from('tally_config').delete().eq('id', configId)
      toast.success(`Company "${companyName}" removed`)
      setConfigId(null)
      setCompanyName('')
      onConfigChange?.()
    } catch {
      toast.error('Failed to delete company')
    }
  }

function getFirstSyncError(log: any): string {
  const errors = Array.isArray(log?.error_details?.errors) ? log.error_details.errors : []
  return typeof errors[0] === 'string' ? errors[0] : ''
}

  function formatCurrency(val) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0)
  }

  function formatDate(d) {
    if (!d) return '-'
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const companyOptions = useMemo(() => {
    const configNames = (configs || [])
      .filter((config) => config.is_active !== false)
      .map((config) => config.company_name)
      .filter(Boolean)
    const liveNames = Array.isArray(liveCompanies) ? liveCompanies : (((connectionInfo as any)?.companies || []) as string[])
    return dedupeCompanyNames([
      ...configNames,
      ...liveNames,
    ])
  }, [configs, liveCompanies, connectionInfo])

  return (
    <div className="space-y-6">
      {/* Connection Panel */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Settings className="h-5 w-5 text-blue-600" />
            TallyPrime Server Connection
          </h2>
          <div className="flex items-center gap-2">
            {isConnected ? (
              <span className="flex items-center gap-1 text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full">
                <Wifi className="h-4 w-4" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm text-red-500 bg-red-50 px-3 py-1 rounded-full">
                <WifiOff className="h-4 w-4" /> Disconnected
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
            <input
              type="text"
              value={serverUrl}
              onChange={e => setServerUrl(e.target.value)}
              placeholder="http://localhost:9000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
            {companyOptions.length > 0 ? (
              <select
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select a company</option>
                {companyOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                ref={companyInputRef}
                type="text"
                value={companyName}
                onChange={e => {
                  setCompanyName(e.target.value)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && companyName.trim()) saveConfig()
                }}
                placeholder="Enter exact company name from Tally"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
            )}
          </div>
        </div>

        {connectionState && (
          <div
            className={`mb-4 rounded-lg border p-3 text-sm ${
              connectionState.tone === 'green'
                ? 'border-green-200 bg-green-50 text-green-800'
                : connectionState.tone === 'amber'
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <p className="font-medium">{connectionState.title}</p>
            <p className="mt-1">{connectionState.detail}</p>
            {isConnected && connectionInfo?.companies?.length > 0 && (
              <p className="mt-2 text-green-700">
                Companies: {connectionInfo.companies.join(', ')}
              </p>
            )}
            {!isConnected && !isCompanyMismatchError(connectionError) && (
              <p className="mt-2 text-red-700">
                Verify TallyPrime is open on the server PC, the HTTP port is enabled, and firewall/router forwarding allows the deployed Adamrit server to reach this URL.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={testConnection}
            disabled={isTesting || !serverUrl}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
            Test Connection
          </button>
        </div>
      </div>

      {/* Data Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Ledgers Synced', value: stats.ledgers, icon: Database, color: 'blue' },
          { label: 'Vouchers Synced', value: stats.vouchers, icon: FileText, color: 'indigo' },
          { label: 'Stock Items', value: stats.stockItems, icon: Package, color: 'emerald' },
          { label: 'Reports Cached', value: stats.reports, icon: BarChart3, color: 'purple' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{value.toLocaleString()}</p>
              </div>
              <div className={`p-3 bg-${color}-100 rounded-lg`}>
                <Icon className={`h-6 w-6 text-${color}-600`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Financial Snapshot */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Snapshot (from Tally)</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-sm text-green-700">Cash in Hand</p>
            <p className="text-xl font-bold text-green-800 mt-1">{formatCurrency(financials.cashInHand)}</p>
          </div>
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-sm text-blue-700">Bank Balance</p>
            <p className="text-xl font-bold text-blue-800 mt-1">{formatCurrency(financials.bankBalance)}</p>
          </div>
          <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
            <p className="text-sm text-orange-700">Total Receivables</p>
            <p className="text-xl font-bold text-orange-800 mt-1">{formatCurrency(financials.receivables)}</p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm text-red-700">Total Payables</p>
            <p className="text-xl font-bold text-red-800 mt-1">{formatCurrency(financials.payables)}</p>
          </div>
        </div>
      </div>

      {/* Sync Log Table */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Sync Activity</h2>
        {syncLogs.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No sync activity yet. Click Refresh All in the Tally toolbar to sync.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Direction</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Status</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Synced</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Failed</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Duration</th>
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {syncLogs.map(log => {
                  const firstError = getFirstSyncError(log)
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 capitalize font-medium text-gray-900">{log.sync_type}</td>
                        <td className="py-2 px-3">
                          <span className="flex items-center gap-1 text-gray-600">
                            {log.direction === 'inward' ? <ArrowDownToLine className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
                            {log.direction}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            log.status === 'completed' ? 'bg-green-100 text-green-700' :
                            log.status === 'failed' ? 'bg-red-100 text-red-700' :
                            log.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                            log.status === 'no_data' ? 'bg-orange-100 text-orange-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {log.status === 'completed' ? <CheckCircle className="h-3 w-3" /> :
                             log.status === 'failed' || log.status === 'no_data' ? <XCircle className="h-3 w-3" /> :
                             <Clock className="h-3 w-3" />}
                            {log.status === 'no_data' ? 'no data' : log.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-900">{log.records_synced || 0}</td>
                        <td className="py-2 px-3 text-right text-red-600">{log.records_failed || 0}</td>
                        <td className="py-2 px-3 text-right text-gray-600">
                          {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '-'}
                        </td>
                        <td className="py-2 px-3 text-gray-600">{formatDate(log.started_at)}</td>
                      </tr>
                      {firstError && (log.status === 'failed' || log.status === 'no_data' || log.status === 'partial') ? (
                        <tr className="border-b border-gray-100 bg-red-50/40">
                          <td colSpan={7} className="py-2 px-3 text-xs text-red-700">
                            {firstError}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
