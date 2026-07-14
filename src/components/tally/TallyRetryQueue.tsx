import React, { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  RefreshCw, Trash2, RotateCcw, Loader2, AlertTriangle,
  CheckCircle, XCircle, Clock, Inbox
} from 'lucide-react'
import {
  processRetryQueue,
  getQueueStats,
  retryItem,
  deleteQueueItem,
} from '@/lib/tally-retry-processor'
import { supabase } from '@/integrations/supabase/client'

interface QueueItem {
  id: string
  push_type: string
  push_action: string
  status: string
  retry_count: number
  max_retries: number
  last_error: string | null
  created_at: string
  payload: any
  reference_id: string | null
}

export default function TallyRetryQueue() {
  const [stats, setStats] = useState({ pending: 0, failedPermanent: 0, completed: 0 })
  const [items, setItems] = useState<QueueItem[]>([])
  const [processing, setProcessing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [queueStats, { data: queueItems }] = await Promise.all([
      getQueueStats(),
      supabase
        .from('tally_push_queue')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    setStats(queueStats)
    setItems((queueItems as QueueItem[]) || [])
    setLoading(false)
  }

  async function handleProcessNow() {
    setProcessing(true)
    try {
      const result = await processRetryQueue()
      toast.success(`Processed ${result.processed}: ${result.succeeded} succeeded, ${result.failed} failed`)
      await loadData()
    } catch {
      toast.error('Failed to process queue')
    }
    setProcessing(false)
  }

  async function handleRetry(id: string) {
    await retryItem(id)
    toast.success('Item reset for retry')
    await loadData()
  }

  async function handleDelete(id: string) {
    await deleteQueueItem(id)
    toast.success('Item removed from queue')
    await loadData()
  }

  function formatDate(d: string | null) {
    if (!d) return '-'
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }

  function statusBadge(status: string) {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
            <Clock className="h-3 w-3" /> Pending
          </span>
        )
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle className="h-3 w-3" /> Completed
          </span>
        )
      case 'failed_permanent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <XCircle className="h-3 w-3" /> Failed
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {status}
          </span>
        )
    }
  }

  const total = stats.pending + stats.failedPermanent + stats.completed

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-600" />
          Push Retry Queue
        </h2>
        <button
          onClick={handleProcessNow}
          disabled={processing || stats.pending === 0}
          className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
        >
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Process Queue Now
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
          <Clock className="h-4 w-4" />
          Pending: {stats.pending}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          <XCircle className="h-4 w-4" />
          Failed: {stats.failedPermanent}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-50 text-green-700 border border-green-200">
          <CheckCircle className="h-4 w-4" />
          Completed: {stats.completed}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : total === 0 ? (
        <div className="text-center py-8">
          <Inbox className="h-10 w-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No items in the retry queue.</p>
          <p className="text-xs text-gray-400 mt-1">Failed pushes will appear here automatically.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Action</th>
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Status</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Retries</th>
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Last Error</th>
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Created</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-900">{item.push_type}</td>
                  <td className="py-2 px-3 text-gray-600">{item.push_action}</td>
                  <td className="py-2 px-3">{statusBadge(item.status)}</td>
                  <td className="py-2 px-3 text-right text-gray-600">{item.retry_count}/{item.max_retries}</td>
                  <td className="py-2 px-3 text-red-600 text-xs max-w-[200px] truncate" title={item.last_error || ''}>
                    {item.last_error || '-'}
                  </td>
                  <td className="py-2 px-3 text-gray-600">{formatDate(item.created_at)}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {item.status !== 'completed' && (
                        <button
                          onClick={() => handleRetry(item.id)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                          title="Retry"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
