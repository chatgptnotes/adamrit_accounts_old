
import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'
import { Package, Search, Filter, Loader2, ArrowUpDown } from 'lucide-react'

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(val || 0)
}

function formatQty(val: number) {
  if (val == null) return '-'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(val)
}

export default function TallyStockItems({ serverUrl, companyName, companyId }: { serverUrl?: string; companyName?: string; companyId?: string }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [sortField, setSortField] = useState('name')
  const [sortAsc, setSortAsc] = useState(true)

  useEffect(() => {
    loadItems()
  }, [companyId])

  async function loadItems() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tally_stock_items')
        .select('id, tally_guid, name, stock_group, unit, opening_balance, closing_balance, opening_value, closing_value, rate, gst_rate, hsn_code, last_synced_at')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
        .limit(2000)

      if (error) {
        toast.error('Failed to load stock items: ' + error.message)
        setItems([])
      } else {
        setItems(data || [])
      }
    } catch (err) {
      toast.error('Failed to load stock items')
      setItems([])
    }
    setLoading(false)
  }

  const groups = useMemo(() => {
    const unique = new Set(items.map((i) => i.stock_group).filter(Boolean))
    return Array.from(unique).sort()
  }, [items])

  const filtered = useMemo(() => {
    let result = items

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((i) => (i.name || '').toLowerCase().includes(q))
    }

    if (groupFilter) {
      result = result.filter((i) => i.stock_group === groupFilter)
    }

    result = [...result].sort((a, b) => {
      const aVal = a[sortField] ?? ''
      const bVal = b[sortField] ?? ''
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortAsc ? aVal - bVal : bVal - aVal
      }
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortAsc ? cmp : -cmp
    })

    return result
  }, [items, search, groupFilter, sortField, sortAsc])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, i) => ({
        openingValue: acc.openingValue + (i.opening_value || 0),
        closingValue: acc.closingValue + (i.closing_value || 0),
      }),
      { openingValue: 0, closingValue: 0 }
    )
  }, [filtered])

  function handleSort(field: string) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  function SortHeader({ field, label, align = 'left' }: { field: string; label: string; align?: string }) {
    return (
      <th
        className={`py-3 px-3 font-medium text-gray-500 cursor-pointer hover:text-blue-600 select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortField === field && (
            <ArrowUpDown className="h-3 w-3 text-blue-600" />
          )}
        </span>
      </th>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600 mr-2" />
        <span className="text-gray-500">Loading stock items...</span>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Package className="h-5 w-5 text-blue-600" />
            Stock Items
          </h2>
          <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
            {filtered.length} of {items.length} items
          </span>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by item name..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white min-w-[200px]"
            >
              <option value="">All Groups</option>
              {groups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center text-gray-500 text-sm">
          {items.length === 0
            ? 'No stock items synced yet. Sync stock data from Tally to see items here.'
            : 'No items match your search criteria.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <SortHeader field="name" label="Item Name" />
                <SortHeader field="stock_group" label="Group" />
                <SortHeader field="unit" label="Unit" />
                <SortHeader field="opening_balance" label="Opening Qty" align="right" />
                <SortHeader field="closing_balance" label="Closing Qty" align="right" />
                <SortHeader field="rate" label="Rate (INR)" align="right" />
                <SortHeader field="closing_value" label="Value (INR)" align="right" />
                <SortHeader field="hsn_code" label="HSN Code" />
                <SortHeader field="gst_rate" label="GST%" align="right" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                >
                  <td className="py-2.5 px-3 font-medium text-gray-900 max-w-[240px] truncate">
                    {item.name || '-'}
                  </td>
                  <td className="py-2.5 px-3 text-gray-600">{item.stock_group || '-'}</td>
                  <td className="py-2.5 px-3 text-gray-600">{item.unit || '-'}</td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{formatQty(item.opening_balance)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-700">{formatQty(item.closing_balance)}</td>
                  <td className="py-2.5 px-3 text-right text-gray-700">
                    {item.rate != null ? formatCurrency(item.rate) : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium text-gray-900">
                    {item.closing_value != null ? formatCurrency(item.closing_value) : '-'}
                  </td>
                  <td className="py-2.5 px-3 text-gray-600">{item.hsn_code || '-'}</td>
                  <td className="py-2.5 px-3 text-right text-gray-600">
                    {item.gst_rate != null ? `${item.gst_rate}%` : '-'}
                  </td>
                </tr>
              ))}

              {/* Summary Row */}
              <tr className="bg-blue-50 border-t-2 border-blue-200 font-semibold">
                <td className="py-3 px-3 text-blue-900" colSpan={3}>
                  Total ({filtered.length} items)
                </td>
                <td className="py-3 px-3" colSpan={2} />
                <td className="py-3 px-3 text-right text-blue-800" />
                <td className="py-3 px-3 text-right text-blue-900">
                  {formatCurrency(totals.closingValue)}
                </td>
                <td className="py-3 px-3" colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
