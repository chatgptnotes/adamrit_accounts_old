import { supabase } from '@/integrations/supabase/client'
import { approveAndPostJV, createApproval, postPaymentVoucher } from '@/lib/approval-queue-service'

/** The chart-of-accounts code every referral commission debits. */
export const REFERRAL_EXPENSE_CODE = '5130'

/** One relationship-manager cut on the Daily Revenue Report, ready to pay. */
export interface RmCut {
  /** daily_revenue_entries.id — the row that gets stamped once it is raised. */
  entryId: string
  entryDate: string
  patientName: string
  rmName: string
  /** The manager's creditor ledger. A cut without one cannot be paid. */
  ledgerId: string
  amount: number
}

export interface PayRmCutsInput {
  cuts: RmCut[]
  companyId: string
  /** Cash or bank ledger the payment is credited to. */
  bankAccountId: string
  date: string
  createdBy?: string
}

export interface PaidManager {
  rmName: string
  amount: number
  entries: number
  jvVoucherNumber: string
  paymentVoucherNumber: string
}

export interface PayRmCutsResult {
  paid: PaidManager[]
  total: number
}

/** The ledger every referral commission is debited to. */
export async function getReferralExpenseLedgerId(): Promise<string> {
  const { data, error } = await (supabase as any)
    .from('chart_of_accounts')
    .select('id')
    .eq('account_code', REFERRAL_EXPENSE_CODE)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) {
    throw new Error(
      `Ledger ${REFERRAL_EXPENSE_CODE} Referral & Implant Commission does not exist yet`,
    )
  }
  return data.id as string
}

/**
 * Pays relationship-manager cuts, one voucher pair per manager.
 *
 * The accounting is the two entries it has always been, and both come from the
 * approval queue's own posting code rather than a second implementation:
 *
 *   JV       Dr 5130 Referral Commission  /  Cr the manager's ledger
 *   Payment  Dr the manager's ledger      /  Cr the chosen bank
 *
 * Cuts are grouped by manager, so a manager who appears on six rows of one day's
 * report is paid once for the total rather than six times — which is how they
 * are actually paid, and what keeps the Day Book readable. Paying a single row
 * is the same path with a group of one.
 *
 * Every cut is stamped with its approval the moment that approval is raised, and
 * a stamped cut is refused here, so neither a double-click nor a per-row Pay
 * followed by Approve on the whole report can pay the same cut twice.
 */
export async function payRmCuts(input: PayRmCutsInput): Promise<PayRmCutsResult> {
  const { cuts, companyId, bankAccountId, date } = input
  if (!cuts.length) throw new Error('Nothing to pay')
  if (!companyId) throw new Error('Select the company the payment is made from')
  if (!bankAccountId) throw new Error('Select the bank account the payment is made from')
  if (!date) throw new Error('Select a payment date')

  const unmapped = cuts.filter((cut) => !cut.ledgerId)
  if (unmapped.length) {
    throw new Error(
      `${unmapped.length} row(s) have no ledger for their manager. Pick one on the row, or map it on the Relationship Manager master.`,
    )
  }

  // Refuse anything already raised. The check is against the database rather
  // than what the screen believes, so a stale report cannot re-pay a cut that
  // another user paid a moment ago.
  const { data: existing, error: existingError } = await (supabase as any)
    .from('daily_revenue_entries')
    .select('id, approval_id')
    .in('id', cuts.map((cut) => cut.entryId))
    .not('approval_id', 'is', null)
  if (existingError) throw new Error(existingError.message)
  if ((existing || []).length) {
    throw new Error(
      `${existing.length} of these cuts have already been raised for payment. Reload the report.`,
    )
  }

  const expenseAccountId = await getReferralExpenseLedgerId()
  if (cuts.some((cut) => cut.ledgerId === bankAccountId)) {
    throw new Error('The bank account cannot be the same ledger as the manager being paid')
  }

  const byLedger = new Map<string, RmCut[]>()
  for (const cut of cuts) {
    if (cut.amount <= 0) continue
    const list = byLedger.get(cut.ledgerId) || []
    list.push(cut)
    byLedger.set(cut.ledgerId, list)
  }
  if (byLedger.size === 0) throw new Error('Nothing to pay — every selected cut is zero')

  const paid: PaidManager[] = []

  for (const [ledgerId, ledgerCuts] of byLedger) {
    const amount = ledgerCuts.reduce((sum, cut) => sum + cut.amount, 0)
    const dates = ledgerCuts.map((cut) => cut.entryDate).sort()
    const span = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`
    const narration = `Referral commission, ${ledgerCuts.length} patient(s), ${span}`

    const approval = await createApproval({
      companyId,
      category: 'REFERRAL',
      partyName: ledgerCuts[0].rmName,
      amount,
      expenseAccountId,
      partyAccountId: ledgerId,
      narration,
      createdBy: input.createdBy,
    })

    // Stamp before posting. The approval row now owns this cut, so it drops off
    // the unpaid list immediately; if a posting below fails, the bill is sitting
    // in the Tally approval queue to be finished there rather than silently
    // becoming payable again here.
    const { error: stampError } = await (supabase as any)
      .from('daily_revenue_entries')
      .update({ approval_id: approval.id, updated_at: new Date().toISOString() })
      .in('id', ledgerCuts.map((cut) => cut.entryId))
    if (stampError) throw new Error(stampError.message)

    const jv = await approveAndPostJV(approval.id, input.createdBy)
    const payment = await postPaymentVoucher(approval.id, {
      cashBankAccountId: bankAccountId,
      date,
    })

    paid.push({
      rmName: ledgerCuts[0].rmName,
      amount,
      entries: ledgerCuts.length,
      jvVoucherNumber: jv.voucherNumber,
      paymentVoucherNumber: payment.voucherNumber,
    })
  }

  return { paid, total: paid.reduce((sum, row) => sum + row.amount, 0) }
}
