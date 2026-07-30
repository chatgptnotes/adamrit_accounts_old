import { supabase } from '@/integrations/supabase/client'
import { createAccountingVoucher } from '@/lib/accounting-voucher-service'

export type ApprovalCategory = 'VENDOR' | 'DOCTOR' | 'SALARY' | 'REFERRAL'

export interface ApprovalQueueRow {
  id: string
  company_id: string | null
  category: ApprovalCategory
  party_name: string
  reference_no: string | null
  amount: number
  expense_account_id: string | null
  party_account_id: string | null
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
  ot_schedule_id: string | null
}

/** True when an auto-created bill still needs amount/company/ledgers before approval. */
export function needsDetails(row: ApprovalQueueRow): boolean {
  return !row.amount || row.amount <= 0 || !row.company_id || !row.expense_account_id || !row.party_account_id
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
  // company_id IS NULL rows are OT-generated bills whose company is decided at
  // approval time — they must be visible from every company's queue.
  const { data, error } = await approvalQueue()
    .select('*')
    .or(`company_id.eq.${companyId},company_id.is.null`)
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
  // The claim itself refuses incomplete rows (OT-generated bills whose amount
  // or ledgers were never filled in) — not just the UI.
  const { data: claimed, error: claimError } = await approvalQueue()
    .update({ status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: approvedBy || null })
    .eq('id', id)
    .eq('status', 'PENDING')
    .gt('amount', 0)
    .not('company_id', 'is', null)
    .not('expense_account_id', 'is', null)
    .not('party_account_id', 'is', null)
    .select('*')
  if (claimError) throw new Error(claimError.message || 'Failed to approve the bill')
  const row = (claimed || [])[0] as ApprovalQueueRow | undefined
  if (!row) {
    const { data: current } = await approvalQueue().select('*').eq('id', id).maybeSingle()
    if (current && current.status === 'PENDING' && needsDetails(current as ApprovalQueueRow)) {
      throw new Error('Fill the amount and ledgers before approving this bill')
    }
    throw new Error('This bill was already approved or rejected by someone else')
  }

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

// ── OT auto-feed: doctor bills created when a surgery is marked done ──

export interface DoctorLedgerMapRow {
  id: string
  surgeon_name: string
  company_id: string
  party_account_id: string
  expense_account_id: string | null
}

const doctorLedgerMap = () => (supabase as any).from('doctor_ledger_map')

export async function listDoctorLedgerMap(): Promise<DoctorLedgerMapRow[]> {
  const { data, error } = await doctorLedgerMap().select('*').order('surgeon_name')
  if (error) throw new Error(error.message || 'Failed to load doctor ledger mappings')
  return (data || []) as DoctorLedgerMapRow[]
}

/** Creates or updates the single mapping for a surgeon (matched case-insensitively). */
export async function upsertDoctorLedgerMap(input: {
  surgeonName: string
  companyId: string
  partyAccountId: string
  expenseAccountId?: string | null
}): Promise<void> {
  const name = input.surgeonName.trim()
  if (!name) throw new Error('Enter the doctor name')
  if (!input.companyId || !input.partyAccountId) throw new Error('Select the company and party ledger')

  const { data: existing } = await doctorLedgerMap().select('id').ilike('surgeon_name', name).limit(1)
  const payload = {
    surgeon_name: name,
    company_id: input.companyId,
    party_account_id: input.partyAccountId,
    expense_account_id: input.expenseAccountId || null,
    updated_at: new Date().toISOString(),
  }
  const { error } = existing?.length
    ? await doctorLedgerMap().update(payload).eq('id', existing[0].id)
    : await doctorLedgerMap().insert(payload)
  if (error) throw new Error(error.message || 'Failed to save the doctor mapping')
}

export async function deleteDoctorLedgerMap(id: string): Promise<void> {
  const { error } = await doctorLedgerMap().delete().eq('id', id)
  if (error) throw new Error(error.message || 'Failed to delete the doctor mapping')
}

/**
 * Auto-creates one DOCTOR approval per surgeon when an OT surgery is marked
 * completed. Amount stays 0 (management fills it while approving); ledgers are
 * pre-filled from doctor_ledger_map when the surgeon is mapped. The partial
 * unique index on (ot_schedule_id, party_name) makes this idempotent, so
 * re-marking the same surgery done never duplicates a bill.
 *
 * Never throws — OT completion must not fail because of billing.
 */
export async function createDoctorApprovalsFromOt(ot: {
  id: string
  surgeon_name?: string | null
  surgery_name?: string | null
  visit_id?: string | null
  patient_name?: string | null
}): Promise<{ created: number }> {
  try {
    const surgeons = [...new Set(
      (ot.surgeon_name || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    )]
    if (!surgeons.length) return { created: 0 }

    let created = 0
    for (const surgeon of surgeons) {
      const { data: maps } = await doctorLedgerMap()
        .select('company_id, party_account_id, expense_account_id')
        .ilike('surgeon_name', surgeon)
        .limit(1)
      const map = (maps || [])[0]

      const { error } = await approvalQueue().insert({
        category: 'DOCTOR',
        party_name: surgeon,
        reference_no: ot.visit_id ? `OT-${ot.visit_id}` : null,
        amount: 0,
        company_id: map?.company_id || null,
        expense_account_id: map?.expense_account_id || null,
        party_account_id: map?.party_account_id || null,
        narration: [ot.surgery_name, ot.patient_name].filter(Boolean).join(' - ') || 'OT surgery',
        ot_schedule_id: ot.id,
        created_by: 'ot-auto',
      })
      if (!error) created += 1
      // 23505 = unique violation: bill already exists for this OT + surgeon.
      else if (error.code !== '23505') console.warn('[ot-auto] approval insert failed:', error.message)
    }
    return { created }
  } catch (err: any) {
    console.warn('[ot-auto] createDoctorApprovalsFromOt failed:', err?.message || err)
    return { created: 0 }
  }
}

/** The doctor bills generated for a set of OT schedule rows (for the tablet amount editor). */
export async function listOtDoctorApprovals(otScheduleIds: string[]): Promise<Array<{
  id: string
  ot_schedule_id: string
  party_name: string
  amount: number
  status: string
}>> {
  if (!otScheduleIds.length) return []
  const { data, error } = await approvalQueue()
    .select('id, ot_schedule_id, party_name, amount, status')
    .in('ot_schedule_id', otScheduleIds)
  if (error) throw new Error(error.message || 'Failed to load OT doctor bills')
  return data || []
}

/**
 * Tablet flow: sets the doctor-payment amount for a completed OT surgery.
 * Ensures the bills exist first (idempotent — covers surgeries completed
 * before the auto-feed shipped), then stamps the amount on every PENDING
 * bill of that OT row. Approved bills are never touched.
 */
export async function setOtDoctorAmount(
  ot: {
    id: string
    surgeon_name?: string | null
    surgery_name?: string | null
    visit_id?: string | null
    patient_name?: string | null
  },
  amount: number,
): Promise<{ updated: number }> {
  if (!amount || amount <= 0) throw new Error('Enter an amount greater than zero')
  await createDoctorApprovalsFromOt(ot)
  const { data, error } = await approvalQueue()
    .update({ amount })
    .eq('ot_schedule_id', ot.id)
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(error.message || 'Failed to save the amount')
  return { updated: (data || []).length }
}

/** Fills in amount/company/ledgers on a PENDING bill (OT-generated ones start empty). */
export async function updateApprovalDetails(
  id: string,
  input: { amount: number; companyId: string; expenseAccountId: string; partyAccountId: string },
): Promise<void> {
  if (!input.amount || input.amount <= 0) throw new Error('Enter an amount greater than zero')
  if (!input.companyId || !input.expenseAccountId || !input.partyAccountId) throw new Error('Select the ledgers')
  if (input.expenseAccountId === input.partyAccountId) throw new Error('Expense and party ledgers must be different')

  const { data, error } = await approvalQueue()
    .update({
      amount: input.amount,
      company_id: input.companyId,
      expense_account_id: input.expenseAccountId,
      party_account_id: input.partyAccountId,
    })
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(error.message || 'Failed to update the bill')
  if (!(data || []).length) throw new Error('Only pending bills can be edited')
}
