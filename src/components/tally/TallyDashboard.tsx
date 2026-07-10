
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import {
  RefreshCw, Settings, Wifi, WifiOff, Database, FileText,
  Package, BarChart3, ArrowDownToLine, ArrowUpFromLine,
  CheckCircle, XCircle, Clock, Loader2, Save, Play, Pause,
  PlusCircle, Trash2
} from 'lucide-react'

interface TallyDashboardProps {
  serverUrl: string
  companyName: string
  companyId: string
  configs: { id: string; server_url: string; company_name: string }[]
  onConfigChange?: (newId?: string) => void
}

export default function TallyDashboard({ serverUrl: propServerUrl, companyName: propCompanyName, companyId: propCompanyId, configs = [], onConfigChange }: TallyDashboardProps) {
  const { hospitalType } = useAuth()
  const [serverUrl, setServerUrl] = useState(propServerUrl ?? '')
  const [isAddingCompany, setIsAddingCompany] = useState(false)
  const [companyName, setCompanyName] = useState(propCompanyName || '')
  const [isConnected, setIsConnected] = useState(false)
  const [connectionInfo, setConnectionInfo] = useState(null)
  const [connectionError, setConnectionError] = useState('')
  const [isTesting, setIsTesting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [autoSync, setAutoSync] = useState(false)
  const [syncInterval, setSyncInterval] = useState(30)
  const [configId, setConfigId] = useState(null)

  // Sync state
  const [syncing, setSyncing] = useState(null) // null or sync type
  const [syncProgress, setSyncProgress] = useState(0)

  // Stats
  const [stats, setStats] = useState({
    ledgers: 0, vouchers: 0, stockItems: 0, reports: 0
  })
  const [financials, setFinancials] = useState({
    cashInHand: 0, bankBalance: 0, receivables: 0, payables: 0
  })

  // Sync logs
  const [syncLogs, setSyncLogs] = useState([])

  // Auto-sync scheduler state
  const autoSyncTimerRef = useRef(null)
  const companyInputRef = useRef<HTMLInputElement | null>(null)
  const [nextSyncAt, setNextSyncAt] = useState(null)
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const [autoSyncQueue, setAutoSyncQueue] = useState([])
  const [autoSyncCurrent, setAutoSyncCurrent] = useState(null)
  const [autoSyncCompleted, setAutoSyncCompleted] = useState(0)
  const [countdown, setCountdown] = useState(0)

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
      setAutoSync(data.auto_sync_enabled || false)
      setSyncInterval(data.sync_interval_minutes || 30)
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

    const { data: creditors } = await supabase
      .from('tally_ledgers')
      .select('closing_balance')
      .eq('company_id', configId)
      .ilike('parent_group', '%sundry creditor%')

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
        setAutoSync(false)
        toast.error(errorMessage)
      }
    } catch (err) {
      setIsConnected(false)
      setConnectionError('Failed to test connection. Check that the Tally proxy API is deployed and reachable.')
      setAutoSync(false)
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
        auto_sync_enabled: autoSync,
        sync_interval_minutes: syncInterval,
        hospital_id: hospitalType || 'hope',
        updated_at: new Date().toISOString(),
      }

      if (configId) {
        await ( supabase as any).from('tally_config').update(payload).eq('id', configId)
        toast.success('Configuration saved')
        onConfigChange?.(configId)
      } else {
        const { data } = await ( supabase as any).from('tally_config').insert(payload).select().single()
        if (data) {
          setConfigId(data.id)
          setIsAddingCompany(false)
          toast.success('New company added')
          onConfigChange?.(data.id)
        }
      }
    } catch (err) {
      toast.error('Failed to save configuration')
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
    setAutoSync(false)
    toast.info('Enter the new company name and click Save Configuration')
    setTimeout(() => companyInputRef.current?.focus(), 0)
  }

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

  // Auto-sync scheduler
  const runAutoSync = useCallback(async () => {
    if (!serverUrl || !companyName) return
    const syncTypes = ['ledgers', 'vouchers', 'stock', 'reports']
    setAutoSyncQueue(syncTypes)
    setAutoSyncCompleted(0)

    // Sync from financial year start (April 1)
    const now = new Date()
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const fyStart = `${fyYear}-04-01`
    const today = new Date().toISOString().split('T')[0]

    for (let i = 0; i < syncTypes.length; i++) {
      setAutoSyncCurrent(syncTypes[i])
      setAutoSyncCompleted(i)
      try {
        await fetch('/api/tally-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: 'sync', action: syncTypes[i], serverUrl, companyName, companyId: configId,
            dateRange: { from: fyStart, to: today },
          }),
        })
      } catch {}
    }

    setAutoSyncCurrent(null)
    setAutoSyncCompleted(syncTypes.length)
    setAutoSyncQueue([])
    setLastSyncAt(new Date())
    await loadStats()
    await loadSyncLogs()
  }, [serverUrl, companyName, configId])

  useEffect(() => {
    if (autoSyncTimerRef.current) {
      clearInterval(autoSyncTimerRef.current)
      autoSyncTimerRef.current = null
    }

    if (autoSync && companyName && serverUrl) {
      const intervalMs = syncInterval * 60 * 1000
      setNextSyncAt(new Date(Date.now() + intervalMs))

      autoSyncTimerRef.current = setInterval(() => {
        runAutoSync()
        setNextSyncAt(new Date(Date.now() + intervalMs))
      }, intervalMs)
    } else {
      setNextSyncAt(null)
    }

    return () => {
      if (autoSyncTimerRef.current) clearInterval(autoSyncTimerRef.current)
    }
  }, [autoSync, syncInterval, companyName, serverUrl, runAutoSync])

  // Countdown timer
  useEffect(() => {
    if (!nextSyncAt || !autoSync) { setCountdown(0); return }
    const timer = setInterval(() => {
      const diff = Math.max(0, Math.round((nextSyncAt.getTime() - Date.now()) / 1000))
      setCountdown(diff)
    }, 1000)
    return () => clearInterval(timer)
  }, [nextSyncAt, autoSync])

  function formatCountdown(secs) {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  async function runSingleSync(syncAction: string, dateRange: { from: string; to: string }) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000) // 5 min per type
    try {
      const res = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'sync', action: syncAction, serverUrl, companyName, companyId: configId,
          dateRange,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      return await res.json()
    } catch (err: any) {
      clearTimeout(timeout)
      return { success: false, error: err.name === 'AbortError' ? `${syncAction} timed out` : err.message, recordsSynced: 0, recordsFailed: 0 }
    }
  }

  async function runSync(action) {
    setSyncing(action)
    setSyncProgress(5)

    // Sync from financial year start (April 1)
    const now = new Date()
    const fyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const fyStart = `${fyYear}-04-01`
    const today = new Date().toISOString().split('T')[0]
    const dateRange = { from: fyStart, to: today }

    try {
      if (action === 'full') {
        // Run each sync type as separate API call to avoid Vercel timeout
        const syncTypes = ['groups', 'ledgers', 'stock', 'vouchers', 'reports']
        let totalSynced = 0
        let totalFailed = 0
        const allErrors: string[] = []

        for (let i = 0; i < syncTypes.length; i++) {
          setSyncProgress(Math.round(((i) / syncTypes.length) * 90) + 5)
          toast.info(`Syncing ${syncTypes[i]}...`)
          const result = await runSingleSync(syncTypes[i], dateRange)
          totalSynced += result.recordsSynced || 0
          totalFailed += result.recordsFailed || 0
          if (result.errors?.length) allErrors.push(...result.errors)
          if (result.error) allErrors.push(result.error)
        }

        setSyncProgress(100)
        if (totalFailed > 0 && allErrors.length) {
          toast.error(`Sync: ${totalSynced} synced, ${totalFailed} failed — ${allErrors[0]}`)
        } else {
          toast.success(`Sync complete: ${totalSynced} records synced${totalFailed ? `, ${totalFailed} failed` : ''}`)
        }
      } else {
        const progressTimer = setInterval(() => {
          setSyncProgress(prev => Math.min(prev + 3, 90))
        }, 2000)

        const result = await runSingleSync(action, dateRange)
        clearInterval(progressTimer)
        setSyncProgress(100)

        if (result.success) {
          if (result.recordsFailed > 0 && result.errors?.length) {
            toast.error(`Sync: ${result.recordsSynced} synced, ${result.recordsFailed} failed — ${result.errors[0]}`)
          } else {
            toast.success(`Sync complete: ${result.recordsSynced} records synced${result.recordsFailed ? `, ${result.recordsFailed} failed` : ''}`)
          }
        } else {
          toast.error(result.error || 'Sync failed')
        }
      }

      await loadStats()
      await loadSyncLogs()
    } catch (err: any) {
      toast.error('Sync request failed - check if Tally server is reachable')
    }
    setSyncing(null)
    setSyncProgress(0)
  }

  function formatCurrency(val) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0)
  }

  function formatDate(d) {
    if (!d) return '-'
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const companyOptions = Array.from(
    new Set([
      ...(configs || []).map((c) => c.company_name).filter(Boolean),
      ...(((connectionInfo as any)?.companies || []) as string[]),
    ])
  )

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
            {isConnected && connectionInfo?.companies?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {connectionInfo.companies.map((name: string) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setCompanyName(name)}
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {connectionInfo && isConnected && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm">
            <p className="font-medium text-green-800">Connected to TallyPrime (v{connectionInfo.version})</p>
            {connectionInfo.companies.length > 0 && (
              <p className="text-green-700 mt-1">
                Companies: {connectionInfo.companies.join(', ')}
              </p>
            )}
          </div>
        )}

        {connectionError && !isConnected && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">Tally server is not reachable</p>
            <p className="mt-1">{connectionError}</p>
            <p className="mt-2 text-red-700">
              Verify TallyPrime is open on the server PC, the HTTP port is enabled, and firewall/router forwarding allows the deployed Adamrit server to reach this URL.
            </p>
          </div>
        )}

        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-700">Auto-Sync</label>
            <button
              onClick={() => setAutoSync(!autoSync)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoSync ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoSync ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {autoSync && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-700">Every</label>
              <select
                value={syncInterval}
                onChange={e => setSyncInterval(Number(e.target.value))}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={360}>6 hours</option>
              </select>
            </div>
          )}
        </div>

        {/* Auto-sync status bar */}
        {autoSync && companyName && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
                <span className="text-sm font-medium text-green-800">Auto-Sync Active</span>
                <span className="text-xs text-green-600">Every {syncInterval} min</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-green-700">
                {countdown > 0 && (
                  <span>Next sync in <span className="font-mono font-bold">{formatCountdown(countdown)}</span></span>
                )}
                {lastSyncAt && (
                  <span>Last: {lastSyncAt.toLocaleTimeString('en-IN')}</span>
                )}
              </div>
            </div>
            {autoSyncCurrent && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-green-700 mb-1">
                  <span>Syncing {autoSyncCurrent}...</span>
                  <span>{autoSyncCompleted}/{autoSyncQueue.length} complete</span>
                </div>
                <div className="w-full bg-green-200 rounded-full h-1.5">
                  <div className="bg-green-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${autoSyncQueue.length > 0 ? (autoSyncCompleted / autoSyncQueue.length) * 100 : 0}%` }} />
                </div>
              </div>
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
          <p className="text-sm text-gray-500 text-center py-8">No sync activity yet. Click a sync button above to get started.</p>
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
                {syncLogs.map(log => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
