import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0'
import { corsHeaders } from '../_shared/cors.ts'

// Daily background scan that makes deadline automations fire even when no one has
// the Deadline Tracking page open. It mirrors the client scan in DeadlineDashboard
// (deriveStatus + dispatch loop): for each unpaid utility bill it finds the bills
// that are due-soon / overdue, matches the enabled "deadline" automations, and
// records a "notify" fire in user_activity_log (visible on the /activity-log page).
//
// Kept deliberately simple: notify only — no email/WhatsApp sending, no dedup
// table. Running once a day means each match naturally fires once.

interface UtilityDeadline {
  id: string
  hospital_type: string | null
  name: string
  bill_type: string
  due_date: string        // 'YYYY-MM-DD'
  status: 'pending' | 'paid'
  created_at: string
}

interface FlowNode {
  type: 'trigger' | 'condition' | 'action'
  data: { config: Record<string, unknown> }
}
interface TaskFlow {
  id: string
  hospital_type: string | null
  name: string
  enabled: boolean
  nodes: FlowNode[]
  created_at: string
}

// UTC-midnight day difference, matching DeadlineDashboard's daysUntil.
function daysUntil(dueDate: string, today: Date): number {
  const due = new Date(dueDate + 'T00:00:00Z')
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  return Math.round((due.getTime() - t.getTime()) / 86_400_000)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const now = new Date()
    const horizon = new Date(now.getTime() + 7 * 86_400_000).toISOString().split('T')[0]

    // Unpaid bills that are overdue or due within 7 days.
    const { data: bills, error: billErr } = await supabase
      .from('utility_deadlines')
      .select('id, hospital_type, name, bill_type, due_date, status, created_at')
      .neq('status', 'paid')
      .lte('due_date', horizon)
      .returns<UtilityDeadline[]>()
    if (billErr) throw billErr

    // All enabled automations (RLS is off on this table). We filter by hospital
    // per-bill below.
    const { data: flows, error: flowErr } = await supabase
      .from('task_optimizer_flows')
      .select('id, hospital_type, name, enabled, nodes, created_at')
      .eq('enabled', true)
      .returns<TaskFlow[]>()
    if (flowErr) throw flowErr

    let scanned = 0
    let fired = 0
    const logs: Record<string, unknown>[] = []

    for (const bill of bills ?? []) {
      const days = daysUntil(bill.due_date, now)
      const event = days < 0 ? 'deadline_overdue' : days <= 7 ? 'deadline_due' : null
      if (!event) continue
      scanned++

      for (const flow of flows ?? []) {
        // Hospital scoping: a flow with no hospital_type applies to all.
        if (flow.hospital_type && flow.hospital_type !== bill.hospital_type) continue

        // Rule 17 — don't retro-fire a freshly-created automation against old bills.
        if (new Date(flow.created_at) > new Date(bill.created_at)) continue

        const nodes = flow.nodes ?? []
        // Parity with the client: deadline events carry no task context, so flows
        // that have any condition node can't be evaluated — skip them.
        if (nodes.some(n => n.type === 'condition')) continue

        // Trigger must match this event. For deadline_due honour withinDays.
        const triggerOk = nodes.some(n => {
          if (n.type !== 'trigger') return false
          const cfg = n.data?.config ?? {}
          if (cfg.event !== event) return false
          if (event === 'deadline_due') {
            const within = typeof cfg.withinDays === 'number' ? cfg.withinDays : 3
            return days >= 0 && days <= within
          }
          return true
        })
        if (!triggerOk) continue

        // Run each notify action (email/whatsapp/tag/set_status are skipped in
        // this simplest version).
        for (const n of nodes) {
          if (n.type !== 'action') continue
          const cfg = n.data?.config ?? {}
          if (cfg.type !== 'notify') continue

          const message = (cfg.message as string | undefined)
            ?.replace(/\{task\}/gi, bill.name)
            ?.replace(/\{status\}/gi, event === 'deadline_overdue' ? 'overdue' : 'due soon')
            || `${bill.name} is ${event === 'deadline_overdue' ? 'overdue' : `due in ${days} day(s)`}`

          logs.push({
            user_id: null,
            user_email: 'system@cron',
            user_role: 'system',
            hospital_type: bill.hospital_type,
            action: 'automation_fired',
            details: { flow: flow.name, event, bill: bill.name, billType: bill.bill_type, daysUntilDue: days, message },
            page: 'cron/run-deadline-automations',
            ip_address: null,
            user_agent: 'run-deadline-automations',
          })
          fired++
        }
      }
    }

    if (logs.length > 0) {
      await supabase.from('user_activity_log').insert(logs)
    }

    return new Response(
      JSON.stringify({ success: true, scanned, fired }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('run-deadline-automations error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
