import { supabase } from '@/integrations/supabase/client'
import { createAccountingVoucher } from '@/lib/accounting-voucher-service'

export type ApprovalCategory = 'VENDOR' | 'DOCTOR' | 'SALARY'

export interface ApprovalQueueRow {
  id: string
  company_id: string
  category: ApprovalCategory
  party_name: string
  reference_no: string | null
  amount: number
  expense_account_id: string
  party_account_id: string
  invoice_url: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  narration: string | null
  rejection_reason: string | null
  jv_voucher_id: string | null
  is_paid: boolean
  payment_voucher_id: string | null
  created_by: string | null
  approved_by: string | null
  created_at: string
  approved_at: string | null
  paid_at: string | null
}

// approval_queue is newer than the generated Supabase types.
const approvalQueue = () => (supabase as any).from('approval_queue')

function today(): string {
  return new Date().toISOString().split('T')[0]
}

export interface CreateApprovalInput {
  companyId: string
  category: ApprovalCategory
  partyName: string
  referenceNo?: string
  amount: number
  expenseAccountId: string
  partyAccountId: string
  invoiceUrl?: string | null
  narration?: string
  createdBy?: string
}

export async function createApproval(input: CreateApprovalInput): Promise<ApprovalQueueRow> {
  if (!input.companyId) throw new Error('Select a company before adding a bill')
  if (!input.partyName.trim()) throw new Error('Enter the party name')
  if (!input.amount || input.amount <= 0) throw new Error('Enter an amount greater than zero')
  if (!input.expenseAccountId || !input.partyAccountId) throw new Error('Select both expense and party ledgers')
  if (input.expenseAccountId === input.partyAccountId) throw new Error('Expense and party ledgers must be different')

  const { data, error } = await approvalQueue()
    .insert({
      company_id: input.companyId,
      category: input.category,
      party_name: input.partyName.trim(),
      reference_no: input.referenceNo?.trim() || null,
      amount: input.amount,
      expense_account_id: input.expenseAccountId,
      party_account_id: input.partyAccountId,
      invoice_url: input.invoiceUrl || null,
      narration: input.narration?.trim() || null,
      created_by: input.createdBy || null,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message || 'Failed to add the bill')
  return data as ApprovalQueueRow
}

export async function listApprovals(companyId: string): Promise<ApprovalQueueRow[]> {
  const { data, error } = await approvalQueue()
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Failed to load the approval queue')
  return (data || []) as ApprovalQueueRow[]
}

/** Soft duplicate check: same pending/approved party + reference + amount. */
export async function findLikelyDuplicate(
  companyId: string,
  partyName: string,
  referenceNo: string,
  amount: number,
): Promise<boolean> {
  if (!referenceNo.trim()) return false
  const { data, error } = await approvalQueue()
    .select('id')
    .eq('company_id', companyId)
    .eq('party_name', partyName.trim())
    .eq('reference_no', referenceNo.trim())
    .eq('amount', amount)
    .neq('status', 'REJECTED')
    .limit(1)
  if (error) return false
  return (data || []).length > 0
}

/**
 * Approves a pending bill and posts its JV (Dr expense / Cr party).
 *
 * Claim-then-post: the conditional UPDATE flips PENDING → APPROVED first and
 * only the caller that actually flipped the row goes on to post the JV, so a
 * double-click or a second approver can never create a duplicate voucher. If
 * posting fails the claim is reverted so the row returns to PENDING.
 */
export async function approveAndPostJV(id: string, approvedBy?: string): Promise<{ voucherNumber: string }> {
  const { data: claimed, error: claimError } = await approvalQueue()
    .update({ status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: approvedBy || null })
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('*')
  if (claimError) throw new Error(claimError.message || 'Failed to approve the bill')
  const row = (claimed || [])[0] as ApprovalQueueRow | undefined
  if (!row) throw new Error('This bill was already approved or rejected by someone else')

  try {
    const voucher = await createAccountingVoucher({
      companyId: row.company_id,
      category: 'JOURNAL',
      date: today(),
      referenceNumber: row.reference_no || undefined,
      narration: row.narration || `${row.category} bill - ${row.party_name}${row.reference_no ? ` (${row.reference_no})` : ''}`,
      entries: [
        { accountId: row.expense_account_id, debitAmount: row.amount, creditAmount: 0 },
        { accountId: row.party_account_id, debitAmount: 0, creditAmount: row.amount },
      ],
    })

    const { error: linkError } = await approvalQueue()
      .update({ jv_voucher_id: voucher.id })
      .eq('id', id)
    if (linkError) console.warn('[approval-queue] JV posted but link failed:', linkError.message)

    return { voucherNumber: voucher.voucher_number }
  } catch (err) {
    // Revert the claim so the bill goes back to PENDING (best-effort).
    await approvalQueue()
      .update({ status: 'PENDING', approved_at: null, approved_by: null })
      .eq('id', id)
      .eq('status', 'APPROVED')
      .is('jv_voucher_id', null)
    throw err
  }
}

export async function rejectApproval(id: string, reason: string): Promise<void> {
  const { data, error } = await approvalQueue()
    .update({ status: 'REJECTED', rejection_reason: reason.trim() || null })
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(error.message || 'Failed to reject the bill')
  if (!(data || []).length) throw new Error('Only pending bills can be rejected')
}

export async function deleteApproval(id: string): Promise<void> {
  const { data, error } = await approvalQueue()
    .delete()
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(error.message || 'Failed to delete the bill')
  if (!(data || []).length) throw new Error('Only pending bills can be deleted')
}

/**
 * Posts the payment voucher (Dr party / Cr cash-bank) for an approved bill.
 * Same claim-then-post guard as the JV: is_paid flips first, so the payment
 * can only ever post once.
 */
export async function postPaymentVoucher(
  id: string,
  input: { cashBankAccountId: string; date: string },
): Promise<{ voucherNumber: string }> {
  if (!input.cashBankAccountId) throw new Error('Select a cash or bank ledger')
  if (!input.date) throw new Error('Select a payment date')

  const { data: claimed, error: claimError } = await approvalQueue()
    .update({ is_paid: true, paid_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'APPROVED')
    .eq('is_paid', false)
    .not('jv_voucher_id', 'is', null)
    .select('*')
  if (claimError) throw new Error(claimError.message || 'Failed to start the payment')
  const row = (claimed || [])[0] as ApprovalQueueRow | undefined
  if (!row) throw new Error('This bill is not payable (already paid, or its JV is missing)')

  if (input.cashBankAccountId === row.party_account_id) {
    await approvalQueue().update({ is_paid: false, paid_at: null }).eq('id', id).is('payment_voucher_id', null)
    throw new Error('Cash/Bank ledger must be different from the party ledger')
  }

  try {
    const voucher = await createAccountingVoucher({
      companyId: row.company_id,
      category: 'PAYMENT',
      date: input.date,
      referenceNumber: row.reference_no || undefined,
      narration: `Paid ${row.party_name}${row.reference_no ? ` against ${row.reference_no}` : ''}`,
      entries: [
        { accountId: row.party_account_id, debitAmount: row.amount, creditAmount: 0 },
        { accountId: input.cashBankAccountId, debitAmount: 0, creditAmount: row.amount },
      ],
    })

    const { error: linkError } = await approvalQueue()
      .update({ payment_voucher_id: voucher.id })
      .eq('id', id)
    if (linkError) console.warn('[approval-queue] payment posted but link failed:', linkError.message)

    return { voucherNumber: voucher.voucher_number }
  } catch (err) {
    await approvalQueue()
      .update({ is_paid: false, paid_at: null })
      .eq('id', id)
      .is('payment_voucher_id', null)
    throw err
  }
}
