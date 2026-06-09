
import React, { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, BookOpen, FileText, Package,
  BarChart3, ArrowUpFromLine, Link2, Banknote, Landmark,
  Scale, FileBarChart, PlusCircle
} from 'lucide-react'
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

export default function TallyPage() {
  const { hospitalType } = useAuth()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [serverUrl, setServerUrl] = useState('http://localhost:9000')
  const [companyName, setCompanyName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [configs, setConfigs] = useState<{ id: string; server_url: string; company_name: string }[]>([])

  async function loadConfigs(selectId?: string) {
    // Try with hospital filter first
    let query = supabase
      .from('tally_config')
      .select('id, server_url, company_name')
      .eq('is_active', true)

    if (hospitalType) {
      query = query.eq('hospital_id', hospitalType)
    }

    let { data } = await query.order('company_name')

    // Fallback: if no results with hospital filter, load all active configs
    if ((!data || data.length === 0) && hospitalType) {
      const fallback = await supabase
        .from('tally_config')
        .select('id, server_url, company_name')
        .eq('is_active', true)
        .order('company_name')
      data = fallback.data
    }

    if (data && data.length > 0) {
      setConfigs(data)
      const target = selectId
        ? data.find(c => c.id === selectId) || data[0]
        : data[0]
      setServerUrl(target.server_url || 'http://localhost:9000')
      setCompanyName(target.company_name || '')
      setCompanyId(target.id)
    } else {
      setConfigs([])
    }
  }

  useEffect(() => {
    loadConfigs()
  }, [])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tally Integration</h1>
          <p className="text-sm text-gray-500 mt-1">
            TallyPrime Server two-way sync for Adamrit HMS
          </p>
        </div>
        {configs.length > 1 ? (
          <div className="flex items-center gap-2 text-sm text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
            <span>Company:</span>
            <select
              value={companyId}
              onChange={(e) => {
                const config = configs.find(c => c.id === e.target.value)
                if (config) {
                  setCompanyId(config.id)
                  setCompanyName(config.company_name)
                  setServerUrl(config.server_url || 'http://localhost:9000')
                }
              }}
              className="font-medium text-blue-700 bg-transparent border-none outline-none cursor-pointer"
            >
              {configs.map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
        ) : companyName ? (
          <div className="text-sm text-gray-600 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
            Company: <span className="font-medium text-blue-700">{companyName}</span>
          </div>
        ) : null}
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
        {activeTab === 'dashboard' && <TallyDashboard serverUrl={serverUrl} companyName={companyName} companyId={companyId} configs={configs} onConfigChange={(newId) => loadConfigs(newId)} />}
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
