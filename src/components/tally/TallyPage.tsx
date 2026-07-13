
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import {
  LayoutDashboard, BookOpen, FileText, Package,
  BarChart3, ArrowUpFromLine, Link2, Banknote, Landmark,
  Scale, FileBarChart, PlusCircle,
  RefreshCw, Loader2, ArrowLeft
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import TallyDashboard from '@/components/tally/TallyDashboard'
import TallyLedgers from '@/components/tally/TallyLedgers'
import TallyVouchers from '@/components/tally/TallyVouchers'
import TallyStockItems from '@/components/tally/TallyStockItems'
import TallyReports from '@/components/tally/TallyReports'
import TallyBillSync from '@/components/tally/TallyBillSync'
import TallyMapping from '@/components/tally/TallyMapping'
import TallyCashBook from '@/components/tally/TallyCashBook'
import TallyBankBook from '@/components/tally/TallyBankBook'
import TallyBankReconciliation from '@/components/tally/TallyBankReconciliation'
import TallyGST from '@/components/tally/TallyGST'
import TallyCreateVoucher from '@/components/tally/TallyCreateVoucher'

type TallyConfigOption = {
  id: string
  server_url: string
  company_name: string
  is_active?: boolean | null
  last_sync_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ledgers', label: 'Ledgers', icon: BookOpen },
  { id: 'vouchers', label: 'Vouchers', icon: FileText },
  { id: 'cashbook', label: 'Cash Book', icon: Banknote },
  { id: 'bankbook', label: 'Bank Book', icon: Landmark },
  { id: 'reconciliation', label: 'Reconciliation', icon: Scale },
  { id: 'stock', label: 'Stock Items', icon: Package },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'gst', label: 'GST', icon: FileBarChart },
  { id: 'billsync', label: 'Bill Sync', icon: ArrowUpFromLine },
  { id: 'mapping', label: 'Mapping', icon: Link2 },
  { id: 'create-voucher', label: 'Create Voucher', icon: PlusCircle },
]

function getTimestamp(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

function compareConfigPriority(a: TallyConfigOption, b: TallyConfigOption) {
  const activeDelta = Number(Boolean(b.is_active)) - Number(Boolean(a.is_active))
  if (activeDelta !== 0) return activeDelta

  const syncDelta = getTimestamp(b.last_sync_at) - getTimestamp(a.last_sync_at)
  if (syncDelta !== 0) return syncDelta

  const updatedDelta = getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
  if (updatedDelta !== 0) return updatedDelta

  return getTimestamp(b.created_at) - getTimestamp(a.created_at)
}

function pickPreferredConfig(options: TallyConfigOption[], selectedId?: string) {
  if (options.length === 0) return null
  if (selectedId) {
    const selected = options.find((option) => option.id === selectedId)
    if (selected) return selected
  }

  const activeOptions = options.filter((option) => option.is_active !== false)
  const pool = activeOptions.length > 0 ? activeOptions : options
  return [...pool].sort(compareConfigPriority)[0] ?? pool[0] ?? null
}

function formatLastSync(value?: string | null) {
  if (!value) return 'never synced'
  return `synced ${new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`
}

function getConfigLabel(config: TallyConfigOption) {
  const status = config.is_active === false ? 'inactive' : 'active'
  return `${config.company_name} (${status}, ${formatLastSync(config.last_sync_at)})`
}

function sameCompanyName(left: string, right: string) {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase()
}

function dedupeCompanyConfigs(options: TallyConfigOption[]) {
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = option.company_name.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function TallyPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [serverUrl, setServerUrl] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const companyIdRef = useRef('')
  const [configs, setConfigs] = useState<TallyConfigOption[]>([])
  const [liveCompanies, setLiveCompanies] = useState<string[]>([])
  const [refreshingAll, setRefreshingAll] = useState(false)

  const loadLiveCompanies = useCallback(async (targetServerUrl?: string): Promise<string[]> => {
    if (!targetServerUrl) {
      setLiveCompanies([])
      return []
    }

    try {
      const res = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'test-connection',
          serverUrl: targetServerUrl,
        }),
      })
      const result = await res.json()
      setLiveCompanies(Array.isArray(result.companies) ? result.companies.filter(Boolean) : [])
      return Array.isArray(result.companies) ? result.companies.filter(Boolean) : []
    } catch {
      setLiveCompanies([])
      return []
    }
  }, [])

  const loadConfigs = useCallback(async (selectId?: string) => {
    const query = supabase
      .from('tally_config')
      .select('id, server_url, company_name, is_active, last_sync_at, updated_at, created_at')

    const { data } = await query.order('company_name')

    if (data && data.length > 0) {
      setConfigs(data)
      const target = pickPreferredConfig(data, selectId || companyIdRef.current)
      if (target) {
        setServerUrl(target.server_url || '')
        setCompanyName(target.company_name || '')
        setCompanyId(target.id)
        const serverUrls = Array.from(
          new Set(data.map((item) => item.server_url).filter(Boolean)),
        )
        const discoveredByServer = await Promise.all(
          serverUrls.map(async (server_url) => ({
            server_url,
            companies: await loadLiveCompanies(server_url),
          })),
        )
        const discovered = Array.from(new Set(discoveredByServer.flatMap((item) => item.companies)))
        setLiveCompanies(discovered)
        const liveTarget = [...data]
          .sort(compareConfigPriority)
          .find((config) => discovered.some((company) => sameCompanyName(company, config.company_name)))
        if (liveTarget && !discovered.some((company) => sameCompanyName(company, target.company_name))) {
          setServerUrl(liveTarget.server_url || '')
          setCompanyName(liveTarget.company_name || '')
          setCompanyId(liveTarget.id)
        }
        const existing = new Set(data.map((item) => item.company_name).filter(Boolean))
        const missing = discoveredByServer.flatMap(({ server_url, companies }) =>
          companies
            .filter((name) => name && !existing.has(name))
            .map((company_name) => ({ company_name, server_url })),
        )
        if (missing.length > 0) {
          await Promise.all(
            missing.map(({ company_name, server_url }) =>
              supabase.from('tally_config').insert({
                company_name,
                server_url,
                is_active: true,
                auto_sync_enabled: false,
                sync_interval_minutes: 30,
                hospital_id: null,
              })
            )
          )
          const { data: refreshed } = await supabase
            .from('tally_config')
            .select('id, server_url, company_name, is_active, last_sync_at, updated_at, created_at')
            .order('company_name')
          const refreshedConfigs = refreshed || []
          setConfigs(refreshedConfigs)
          const refreshedLiveTarget = [...refreshedConfigs].sort(compareConfigPriority).find((config) =>
            discovered.some((company) => sameCompanyName(company, config.company_name))
          )
          const refreshedTarget = refreshedLiveTarget && !discovered.some((company) => sameCompanyName(company, target.company_name))
            ? refreshedLiveTarget
            : pickPreferredConfig(refreshedConfigs, target.id)
          if (refreshedTarget) {
            setServerUrl(refreshedTarget.server_url || '')
            setCompanyName(refreshedTarget.company_name || '')
            setCompanyId(refreshedTarget.id)
          }
        }
      }
    } else {
      setConfigs([])
      setCompanyId('')
      setCompanyName('')
      setServerUrl('')
      setLiveCompanies([])
    }
  }, [loadLiveCompanies])

  const companyOptions = useMemo(() => dedupeCompanyConfigs([...configs].sort(compareConfigPriority)), [configs])

  const handleCompanyChange = useCallback(
    async (selectedId: string) => {
      const config = configs.find((c) => c.id === selectedId)
      if (config) {
        setCompanyId(config.id)
        setCompanyName(config.company_name)
        setServerUrl(config.server_url || '')
        await loadLiveCompanies(config.server_url || '')
      }
    },
    [configs, loadLiveCompanies]
  )

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  useEffect(() => {
    companyIdRef.current = companyId
  }, [companyId])

  const refreshAll = useCallback(async () => {
    if (!serverUrl || !companyName || !companyId) {
      toast.error('Select a Tally company first')
      return
    }

    setRefreshingAll(true)
    try {
      const response = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'sync',
          action: 'full',
          serverUrl,
          companyName,
          companyId,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.error || result.success === false) {
        throw new Error(result.error || result.message || 'Tally refresh failed')
      }
      toast.success(`All Tally data refreshed for ${companyName}`)
      window.location.reload()
    } catch (error: any) {
      toast.error(error?.message || 'Could not refresh Tally data')
    } finally {
      setRefreshingAll(false)
    }
  }, [companyId, companyName, serverUrl])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tally Integration</h1>
            <p className="text-sm text-gray-500 mt-1">
              One-way import from TallyPrime into Adamrit HMS
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {companyOptions.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
              <span>Company:</span>
              <select
                value={companyId}
                onChange={(e) => { void handleCompanyChange(e.target.value) }}
                className="font-medium text-blue-700 bg-transparent border-none outline-none cursor-pointer"
              >
                {!companyId && <option value="">Select company</option>}
                {companyOptions.map((config) => (
                  <option key={config.id} value={config.id}>{getConfigLabel(config)}</option>
                ))}
              </select>
            </div>
          ) : companyName ? (
            <div className="text-sm text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
              Company: <span className="font-medium text-blue-700">{companyName}</span>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshingAll || !companyId}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Refresh all Tally data for the selected company"
          >
            {refreshingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshingAll ? 'Refreshing...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-1 overflow-x-auto" aria-label="Tabs">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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

      {/* Tab Content */}
      <div>
        {activeTab === 'dashboard' && <TallyDashboard serverUrl={serverUrl} companyName={companyName} companyId={companyId} configs={configs} liveCompanies={liveCompanies} onConfigChange={(newId) => loadConfigs(newId)} />}
        {activeTab === 'ledgers' && <TallyLedgers serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'vouchers' && <TallyVouchers serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'cashbook' && <TallyCashBook serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'bankbook' && <TallyBankBook serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'reconciliation' && <TallyBankReconciliation serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'stock' && <TallyStockItems serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'reports' && <TallyReports serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'gst' && <TallyGST serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'billsync' && <TallyBillSync serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'mapping' && <TallyMapping serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        {activeTab === 'create-voucher' && <TallyCreateVoucher serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
      </div>
    </div>
  )
}
