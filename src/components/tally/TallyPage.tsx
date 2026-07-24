
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/integrations/supabase/client'
import {
  LayoutDashboard, BookOpen, FileText,
  BarChart3, ArrowUpFromLine, Banknote, Landmark,
  FileBarChart, PlusCircle, ClipboardCheck, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { TallyScreen } from '@/components/accounting/tally/TallyChrome'
import TallyDashboard from '@/components/tally/TallyDashboard'
import TallyLedgers from '@/components/tally/TallyLedgers'
import TallyVouchers from '@/components/tally/TallyVouchers'
import TallyReports from '@/components/tally/TallyReports'
import TallyBillSync from '@/components/tally/TallyBillSync'
import TallyCashBook from '@/components/tally/TallyCashBook'
import TallyBankBook from '@/components/tally/TallyBankBook'
import TallyGST from '@/components/tally/TallyGST'
import TallyCreateVoucher from '@/components/tally/TallyCreateVoucher'
import TallyApprovals from '@/components/tally/TallyApprovals'

type TallyConfigOption = {
  id: string
  server_url: string
  company_name: string
  is_active?: boolean | null
  auto_sync_enabled?: boolean | null
  last_sync_at?: string | null
  updated_at?: string | null
  created_at?: string | null
}

const DEFAULT_TALLY_COMPANY = 'DRM Hope Hospital'

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ledgers', label: 'Ledgers', icon: BookOpen },
  { id: 'vouchers', label: 'Vouchers', icon: FileText },
  { id: 'cashbook', label: 'Cash Book', icon: Banknote },
  { id: 'bankbook', label: 'Bank Book', icon: Landmark },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'gst', label: 'GST', icon: FileBarChart },
  { id: 'billsync', label: 'Bill Sync', icon: ArrowUpFromLine },
  { id: 'create-voucher', label: 'Create Voucher', icon: PlusCircle },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck },
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
  const defaultCompany = pool.find((option) => companyKey(option.company_name) === companyKey(DEFAULT_TALLY_COMPANY))
  if (defaultCompany) return defaultCompany
  return [...pool].sort(compareConfigPriority)[0] ?? pool[0] ?? null
}

function companyKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(privatelimited|pvtltd|limited|ltd)$/, '')
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
  return companyKey(left) === companyKey(right)
}

function dedupeCompanyConfigs(options: TallyConfigOption[]) {
  const seen = new Set<string>()
  return options.filter((option) => {
    const key = companyKey(option.company_name)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function TallyPage({ initialTab = 'dashboard' }: { initialTab?: string } = {}) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(initialTab)
  const [createVoucherCategory, setCreateVoucherCategory] = useState<'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'PURCHASE'>('PAYMENT')
  const [voucherFocus, setVoucherFocus] = useState<'period' | 'type' | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const companyIdRef = useRef('')
  const [configs, setConfigs] = useState<TallyConfigOption[]>([])
  const [liveCompanies, setLiveCompanies] = useState<string[]>([])
  const [syncingLatest, setSyncingLatest] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)

  const loadLiveCompanies = useCallback(async (targetServerUrl?: string): Promise<string[]> => {
    if (!targetServerUrl) {
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
      return Array.isArray(result.companies) ? result.companies.filter(Boolean) : []
    } catch {
      return []
    }
  }, [])

  const loadConfigs = useCallback(async (selectId?: string) => {
    const query = supabase
      .from('tally_config')
      .select('id, server_url, company_name, is_active, auto_sync_enabled, last_sync_at, updated_at, created_at')

    const { data } = await query.order('company_name')

    const activeConfigs = (data || []).filter((config) => config.is_active !== false)

    if (activeConfigs.length > 0) {
      setConfigs(activeConfigs)
      const target = pickPreferredConfig(activeConfigs, selectId || companyIdRef.current)
      if (target) {
        setServerUrl(target.server_url || '')
        setCompanyName(target.company_name || '')
        setCompanyId(target.id)
        const serverUrls = Array.from(
          new Set(activeConfigs.map((item) => item.server_url).filter(Boolean)),
        )
        const discoveredByServer = await Promise.all(
          serverUrls.map(async (server_url) => ({
            server_url,
            companies: await loadLiveCompanies(server_url),
          })),
        )
        const discovered = Array.from(new Set(discoveredByServer.flatMap((item) => item.companies)))
        const liveTarget = [...activeConfigs]
          .sort(compareConfigPriority)
          .find((config) => discovered.some((company) => companyKey(company) === companyKey(config.company_name)))
        if (liveTarget && !discovered.some((company) => companyKey(company) === companyKey(target.company_name))) {
          setServerUrl(liveTarget.server_url || '')
          setCompanyName(liveTarget.company_name || '')
          setCompanyId(liveTarget.id)
        }
        setLiveCompanies(discovered)
        const discoveredConfigs = new Map<string, { company_name: string; server_url: string }>()
        for (const { server_url, companies } of discoveredByServer) {
          for (const company_name of companies) {
            const key = companyKey(company_name)
            if (key && !discoveredConfigs.has(key)) {
              discoveredConfigs.set(key, { company_name, server_url })
            }
          }
        }

        let configsChanged = false
        for (const [key, discoveredConfig] of discoveredConfigs) {
          const matches = (data || [])
            .filter((config) => companyKey(config.company_name) === key)
            .sort(compareConfigPriority)
          const activeMatch = matches.find((config) => config.is_active !== false)
          if (activeMatch) continue

          const archivedMatch = matches[0]
          const writeResult = archivedMatch
            ? await (supabase as any).from('tally_config').update({
                company_name: discoveredConfig.company_name,
                server_url: discoveredConfig.server_url,
                is_active: true,
                auto_sync_enabled: false,
                updated_at: new Date().toISOString(),
              }).eq('id', archivedMatch.id)
            : await (supabase as any).from('tally_config').insert({
                ...discoveredConfig,
                is_active: true,
                auto_sync_enabled: false,
                hospital_id: null,
              })

          if (writeResult.error) {
            console.error('Failed to reuse discovered Tally company', writeResult.error)
          } else {
            configsChanged = true
          }
        }

        if (configsChanged) {
          const { data: refreshed } = await supabase
            .from('tally_config')
            .select('id, server_url, company_name, is_active, last_sync_at, updated_at, created_at')
            .order('company_name')
          const refreshedConfigs = (refreshed || []).filter((config) => config.is_active !== false)
          setConfigs(refreshedConfigs)
          const refreshedLiveTarget = refreshedConfigs.find((config) =>
            discovered.some((company) => companyKey(company) === companyKey(config.company_name))
          )
          const refreshedTarget = refreshedLiveTarget && !discovered.some((company) => companyKey(company) === companyKey(target.company_name))
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
    }
  }, [loadLiveCompanies])

  const companyOptions = useMemo(
    () => dedupeCompanyConfigs(configs.filter((config) => config.is_active !== false).sort(compareConfigPriority)),
    [configs]
  )

  const companyNameOptions = useMemo(
    () => companyOptions.map(c => c.company_name),
    [companyOptions]
  )

  const handleCompanyNameChange = useCallback(
    (selectedName: string) => {
      const config = configs.find((c) => c.company_name === selectedName)
      if (config) {
        setCompanyId(config.id)
        setCompanyName(config.company_name)
        setServerUrl(config.server_url || '')
      }
    },
    [configs]
  )

  useEffect(() => {
    loadConfigs()
  }, [loadConfigs])

  useEffect(() => {
    companyIdRef.current = companyId
  }, [companyId])

  const syncLatest = useCallback(async () => {
    const selected = configs.find((config) => config.id === companyId)
    if (!selected || !selected.server_url || !selected.company_name) {
      toast.error('Select a configured Tally company first')
      return
    }
    if (selected.auto_sync_enabled !== true) {
      toast.info('Incoming Tally sync is disabled for the fresh manual ledger master')
      return
    }

    setSyncingLatest(true)
    try {
      const today = new Date()
      const fallbackFrom = new Date(today)
      fallbackFrom.setDate(fallbackFrom.getDate() - 30)
      const lastSync = selected.last_sync_at ? new Date(selected.last_sync_at) : fallbackFrom
      lastSync.setDate(lastSync.getDate() - 1)
      const isoDate = (date: Date) => date.toISOString().slice(0, 10)

      const response = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'sync',
          action: 'full',
          serverUrl: selected.server_url,
          companyName: selected.company_name,
          companyId: selected.id,
          dateRange: { from: isoDate(lastSync), to: isoDate(today) },
        }),
      })
      const result = await response.json()
      if (!response.ok || result.error || result.success === false) {
        throw new Error(result.error || result.message || 'Latest Tally sync failed')
      }

      await loadConfigs(selected.id)
      setRefreshVersion((value) => value + 1)
      toast.success(`Latest data saved for ${selected.company_name} (${result.recordsSynced ?? 0} records)`)
    } catch (error: any) {
      toast.error(error?.message || 'Latest Tally sync failed')
    } finally {
      setSyncingLatest(false)
    }
  }, [companyId, configs, loadConfigs])

  const activeLabel = tabs.find(t => t.id === activeTab)?.label || 'Dashboard'
  const selectedConfig = configs.find((config) => config.id === companyId)
  const syncEnabled = selectedConfig?.auto_sync_enabled === true

  const cycleCompany = useCallback(() => {
    if (companyNameOptions.length <= 1) return
    const idx = companyNameOptions.indexOf(companyName)
    const next = companyNameOptions[(idx + 1) % companyNameOptions.length]
    void handleCompanyNameChange(next)
  }, [companyNameOptions, companyName, handleCompanyNameChange])

  const openVoucherList = useCallback((focus: 'period' | 'type') => {
    setVoucherFocus(focus)
    setActiveTab('vouchers')
  }, [])

  const openVoucherCreation = useCallback((category: 'PAYMENT' | 'RECEIPT' | 'JOURNAL' | 'PURCHASE') => {
    setCreateVoucherCategory(category)
    setActiveTab('create-voucher')
  }, [])

  const saveTallyView = useCallback(() => {
    localStorage.setItem('tally-live-default-tab', activeTab)
    toast.success('Tally Live view saved')
  }, [activeTab])

  const pushToTally = useCallback(async () => {
    if (!serverUrl || !companyName || !companyId) {
      toast.error('Select a Tally company first')
      return
    }
    try {
      const res = await fetch('/api/tally-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'push',
          action: 'vouchers',
          serverUrl,
          companyName,
          companyId,
        }),
      })
      const result = await res.json()
      if (!res.ok || result.success === false) {
        throw new Error(result.error || result.message || 'Push to Tally failed')
      }
      toast.success(`Pending vouchers pushed to Tally for ${companyName}`)
    } catch (error: any) {
      toast.error(error?.message || 'Could not push vouchers to Tally')
    }
  }, [companyId, companyName, serverUrl])

  const rail = useMemo(() => [
    { hotkey: 'F1', label: 'Help', onClick: () => window.dispatchEvent(new CustomEvent('tally-help')) },
    { hotkey: 'F2', label: 'Period', onClick: () => openVoucherList('period') },
    {
      hotkey: 'F3',
      label: 'Company',
      onClick: () => cycleCompany(),
      disabled: companyOptions.length <= 1,
    },
    { hotkey: 'F4', label: 'Voucher Type', onClick: () => openVoucherList('type') },
    {
      hotkey: 'F5',
      label: syncingLatest ? 'Syncing...' : syncEnabled ? 'Sync Latest' : 'Sync Disabled',
      gapBefore: true,
      disabled: syncingLatest || !syncEnabled,
      onClick: () => void syncLatest(),
    },
    { hotkey: 'F6', label: 'Receipt', onClick: () => openVoucherCreation('RECEIPT') },
    { hotkey: 'F7', label: 'Journal', onClick: () => openVoucherCreation('JOURNAL') },
    {
      hotkey: 'F8',
      label: 'Send to Tally',
      disabled: !companyId,
      onClick: () => void pushToTally(),
    },
    { hotkey: 'F9', label: 'Purchase', onClick: () => openVoucherCreation('PURCHASE') },
    { hotkey: 'F12', label: 'Configure', onClick: () => window.dispatchEvent(new CustomEvent('tally-configure')) },
    { hotkey: 'L', label: 'Save View', onClick: saveTallyView },
    { hotkey: 'J', label: 'Exception Reports', onClick: () => window.dispatchEvent(new CustomEvent('tally-goto', { detail: 'exception-reports' })) },
    { hotkey: 'P', label: 'Print', gapBefore: true, onClick: () => window.print() },
  ], [syncingLatest, syncEnabled, companyId, syncLatest, pushToTally, cycleCompany, companyOptions.length, openVoucherList, openVoucherCreation, saveTallyView])

  return (
    <TallyScreen
      title={`Tally Live — ${activeLabel}`}
      centerTitle={companyName || undefined}
      rail={rail}
      headerAction={
        <button
          type="button"
          onClick={() => void syncLatest()}
          disabled={syncingLatest || !companyId || !syncEnabled}
          className="mr-2 inline-flex items-center gap-1 border border-[#6f8fb5] bg-[#e9f0fa] px-2 py-0.5 text-[12px] font-semibold text-[#16437e] hover:bg-white disabled:cursor-default disabled:opacity-60"
          title="Fetch and save latest data for the selected Tally company"
        >
          <RefreshCw className={`h-3 w-3 ${syncingLatest ? 'animate-spin' : ''}`} />
          {syncingLatest ? 'Syncing...' : syncEnabled ? 'Sync Latest' : 'Sync Disabled'}
        </button>
      }
      closeLabel="← Back"
      onClose={() => navigate('/dashboard')}
    >
      <div className="space-y-4">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200 px-2">
          <nav className="flex space-x-1 overflow-x-auto" aria-label="Tabs">
            {tabs.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
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
        <div key={`${activeTab}-${companyId}-${refreshVersion}`}>
          {activeTab === 'dashboard' && <TallyDashboard serverUrl={serverUrl} companyName={companyName} companyId={companyId} configs={configs} onConfigChange={(newId) => loadConfigs(newId)} />}
          {activeTab === 'ledgers' && <TallyLedgers serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'vouchers' && <TallyVouchers serverUrl={serverUrl} companyName={companyName} companyId={companyId} focusFilter={voucherFocus} onFocusHandled={() => setVoucherFocus(null)} />}
          {activeTab === 'cashbook' && <TallyCashBook serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'bankbook' && <TallyBankBook serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'reports' && <TallyReports serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'gst' && <TallyGST serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'billsync' && <TallyBillSync serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
          {activeTab === 'create-voucher' && <TallyCreateVoucher serverUrl={serverUrl} companyName={companyName} companyId={companyId} voucherCategory={createVoucherCategory} />}
          {activeTab === 'approvals' && <TallyApprovals serverUrl={serverUrl} companyName={companyName} companyId={companyId} />}
        </div>
      </div>
    </TallyScreen>
  )
}
