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
  /** The invoice number on a surgery bill; null on salary and vendor rows. */
  invoice_no?: string | null
  /**
   * Stamped on by attachOtContext, not a column. The patient whose surgery this
   * consultant is being paid for — an approver releasing money to a doctor is
   * entitled to see who it was for (Dr M, 19 Aug). Null for salary, vendor and
   * referral bills, which have no patient.
   */
  patient_name?: string | null
  surgery_name?: string | null
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
  // The patient and the surgery, by the same two-step join the unpaid-invoice
  // list already uses — approval_queue.ot_schedule_id carries no FK, so
  // PostgREST cannot embed it. Two extra queries for the whole page, not one
  // per row.
  return attachOtContext((data || []) as ApprovalQueueRow[])
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
    // Why did the claim match nothing? If this diagnostic read itself fails we
    // must not guess — the old code fell through to "already approved by
    // someone else", which is a confident answer to a question it never asked.
    const { data: current, error: currentError } = await approvalQueue().select('*').eq('id', id).maybeSingle()
    if (currentError) {
      throw new Error(`Could not approve the bill, and could not determine why: ${currentError.message}`)
    }
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

  // This read decides UPDATE vs INSERT. If it failed and the error were
  // dropped, `existing` would be undefined, the INSERT branch would be taken,
  // and the doctor would silently gain a SECOND ledger mapping — after which
  // "resolve the ledger by name" returns whichever row comes back first.
  const { data: existing, error: existingError } = await doctorLedgerMap()
    .select('id')
    .ilike('surgeon_name', name)
    .limit(1)
  if (existingError) {
    throw new Error(existingError.message || 'Could not check for an existing doctor mapping')
  }
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

// Owner's default per-case rates (2026-08-04) when the Surgery Fees master
// has no row for the procedure. Panel = Yojana/corporate, private otherwise.
const SURGEON_DEFAULT_FEE = { panel: 5000, private: 8000 }
const ANESTHETIST_FEE = {
  general: { panel: 3000, private: 3500 },
  spinal: { panel: 2000, private: 2500 },
}

function anesthesiaKind(type: string | null | undefined): 'general' | 'spinal' | null {
  const t = String(type || '').toLowerCase()
  if (/gener|\bga\b|g\.a/.test(t)) return 'general'
  if (/spinal|\bsa\b|s\.a/.test(t)) return 'spinal'
  return null
}

/**
 * Auto-creates one DOCTOR approval per surgeon when an OT surgery is marked
 * completed. The surgeon's amount comes from the Surgery Fees master (panel
 * rate for Yojana/corporate patients, private rate otherwise) with the
 * default rates as fallback; the anesthetist's from the anesthesia type.
 * Ledgers are pre-filled from doctor_ledger_map when the person is mapped.
 * The partial unique index on (ot_schedule_id, party_name) makes this
 * idempotent, so re-marking the same surgery done never duplicates a bill.
 *
 * Never throws — OT completion must not fail because of billing.
 */
export async function createDoctorApprovalsFromOt(ot: {
  id: string
  surgeon_name?: string | null
  anesthetist_name?: string | null
  anesthesia_type?: string | null
  surgery_name?: string | null
  visit_id?: string | null
  patient_name?: string | null
  /**
   * What the OT schedule says these two are worth for THIS case, set by the
   * person who booked it. Either one absent means "price it from the masters",
   * which is exactly what happened before these fields existed.
   */
  surgeon_fee?: number | null
  anaesthetist_fee?: number | null
}): Promise<{ created: number }> {
  try {
    // Either field can carry several comma-separated names.
    const splitNames = (value: string | null | undefined) =>
      [...new Set(String(value || '').split(',').map((name) => name.trim()).filter(Boolean))]
    const surgeonNames = splitNames(ot.surgeon_name)
    const anesthetistNames = splitNames(ot.anesthetist_name)
    if (!surgeonNames.length && !anesthetistNames.length) return { created: 0 }

    // Panel (Yojana/corporate) or private, from the patient on the visit.
    // Unknown patients fall back to private, as the fee lookup always has.
    let isPrivate = true
    let corporateName = ''
    try {
      if (ot.visit_id) {
        const { data: visitRow, error: visitError } = await supabase
          .from('visits')
          .select('patients!inner(corporate)')
          .eq('visit_id', ot.visit_id)
          .maybeSingle()
        // "No such patient" is a legitimate miss and keeps the private default.
        // A rejected read is not — without this the two are indistinguishable
        // and a panel patient is silently charged the private rate.
        if (visitError) throw visitError
        corporateName = String((visitRow as any)?.patients?.corporate || '').trim()
        const corporate = corporateName.toLowerCase()
        isPrivate = !corporate || corporate.includes('private')
      }
    } catch (err: any) {
      console.warn(
        '[ot-auto] patient class lookup FAILED — falling back to the private rate, ' +
          'which may be the wrong rate for this patient:',
        err?.message || err,
      )
    }
    const rate = isPrivate ? 'private' : 'panel'
    // Named on the bill and therefore in the JV: Private, or the actual
    // panel/Yojana the patient belongs to.
    const patientClassLabel = isPrivate ? 'Private' : corporateName || 'Panel'

    // Surgeon: the figure agreed when the case was booked wins, because the
    // person booking it knew something the master cannot — a longer job, a
    // second procedure. Absent that, match the package name first, then the
    // exact Yojana surgery name. Keywords are intentionally search-only and do
    // not determine a payable amount. The owner's default is the last resort.
    const bookedSurgeonFee = Number(ot.surgeon_fee)
    let surgeonAmount = SURGEON_DEFAULT_FEE[rate]
    try {
      const surgeryName = (ot.surgery_name || '').trim()
      if (surgeryName) {
        const { data: feeRows, error: feeError } = await (supabase as any)
          .from('surgery_fee_master')
          .select('procedure_name, yojana_surgery_name, panel_rate, private_rate')
          .eq('is_active', true)
        // Same distinction as above: an empty master legitimately means "use
        // the owner's default", a rejected read means we do not know the fee.
        if (feeError) throw feeError
        const lowerName = surgeryName.toLowerCase()
        const fee =
          (feeRows || []).find((row: any) => row.procedure_name?.trim().toLowerCase() === lowerName) ||
          (feeRows || []).find((row: any) => row.yojana_surgery_name?.trim().toLowerCase() === lowerName)
        const masterAmount = Number(isPrivate ? fee?.private_rate : fee?.panel_rate) || 0
        if (masterAmount > 0) surgeonAmount = masterAmount
      }
    } catch (err: any) {
      console.warn(
        '[ot-auto] surgery fee lookup FAILED — falling back to the default rate, ' +
          'so the payable amount may not match the Surgery Fees master:',
        err?.message || err,
      )
    }

    // The booked figure overrides the master, as with the surgeon.
    if (Number.isFinite(bookedSurgeonFee) && bookedSurgeonFee > 0) {
      surgeonAmount = bookedSurgeonFee
    }

    // Anesthetist: the booked figure, else the rate for this anaesthesia type.
    // The rates now live in anaesthesia_fee_master rather than in this file, so
    // changing one no longer needs a deploy — and 'sedation', which had no
    // entry in the hardcoded table and therefore silently paid nothing, has a
    // rate like the others. ANESTHETIST_FEE remains only as the fallback for a
    // failed read, so a database problem cannot zero somebody's fee.
    const bookedAnaesthetistFee = Number(ot.anaesthetist_fee)
    const kind = anesthesiaKind(ot.anesthesia_type)
    let anesthetistAmount = kind ? ANESTHETIST_FEE[kind][rate] : 0
    const declaredType = String(ot.anesthesia_type || '').trim()
    if (declaredType) {
      try {
        const { data: rateRows, error: rateError } = await (supabase as any)
          .from('anaesthesia_fee_master')
          .select('anaesthesia_type, panel_rate, private_rate')
          .eq('is_active', true)
        // An empty master legitimately means "nothing configured"; a rejected
        // read does not, and must not quietly become the hardcoded fallback
        // without anybody knowing which one produced the number.
        if (rateError) throw rateError
        const match = (rateRows || []).find(
          (row: any) => String(row.anaesthesia_type || '').trim().toLowerCase() === declaredType.toLowerCase(),
        )
        const mastered = Number(isPrivate ? match?.private_rate : match?.panel_rate)
        if (Number.isFinite(mastered) && mastered > 0) anesthetistAmount = mastered
      } catch (err: any) {
        console.warn(
          `[ot-auto] anaesthesia rate lookup FAILED for "${declaredType}" — falling back to the ` +
            'rate compiled into the app, which may be out of date:',
          err?.message || err,
        )
      }
    }
    if (Number.isFinite(bookedAnaesthetistFee) && bookedAnaesthetistFee > 0) {
      anesthetistAmount = bookedAnaesthetistFee
    }

    // One bill per person; the same name in both roles gets the surgeon fee.
    const people: Array<{ name: string; amount: number; isAnesthetist: boolean }> = surgeonNames.map((name) => ({
      name,
      amount: surgeonAmount,
      isAnesthetist: false,
    }))
    for (const name of anesthetistNames) {
      if (!surgeonNames.some((s) => s.toLowerCase() === name.toLowerCase())) {
        people.push({ name, amount: anesthetistAmount, isAnesthetist: true })
      }
    }

    let created = 0
    for (const { name: surgeon, amount: masterAmount, isAnesthetist } of people) {
      // This decides which company and ledgers the payable is raised against.
      // A dropped error leaves `map` undefined and creates the row with all
      // three set to null — a payable pointing at no ledger at all.
      const { data: maps, error: mapsError } = await doctorLedgerMap()
        .select('company_id, party_account_id, expense_account_id')
        .ilike('surgeon_name', surgeon)
        .limit(1)
      if (mapsError) {
        throw new Error(`Could not read the ledger mapping for ${surgeon}: ${mapsError.message}`)
      }
      const map = (maps || [])[0]

      // An anaesthetist's fee is Anaesthetist Charges, never Surgeon Fees.
      let expenseAccountId = map?.expense_account_id || null
      if (isAnesthetist && map?.company_id) {
        try {
          const { data: anaes, error: anaesError } = await (supabase as any)
            .from('chart_of_accounts')
            .select('id')
            .eq('company_id', map.company_id)
            .eq('is_active', true)
            .ilike('account_name', 'anaesthetist charges')
            .limit(1)
          // No such ledger is a real answer and the fallback is correct. A
          // failed read is not: falling back then posts an anaesthetist's fee
          // to Surgeon Fees, which is the specific mistake this lookup exists
          // to prevent.
          if (anaesError) throw anaesError
          if (anaes?.[0]?.id) expenseAccountId = anaes[0].id
        } catch (err: any) {
          console.warn(
            `[ot-auto] Anaesthetist Charges lookup FAILED for ${surgeon} — falling back to the ` +
              'mapped expense ledger, which may post this fee as Surgeon Fees:',
            err?.message || err,
          )
        }
      }

      // The bill's narration becomes the JV's narration on approval, so it
      // carries the anaesthesia type and the patient class.
      const detail = [
        isAnesthetist && ot.anesthesia_type ? String(ot.anesthesia_type).trim() : null,
        patientClassLabel,
      ].filter(Boolean).join(', ')
      const narration =
        ([ot.surgery_name, ot.patient_name].filter(Boolean).join(' - ') || 'OT surgery')
        + (detail ? ` (${detail})` : '')

      const { error } = await approvalQueue().insert({
        category: 'DOCTOR',
        party_name: surgeon,
        reference_no: ot.visit_id ? `OT-${ot.visit_id}` : null,
        amount: masterAmount,
        company_id: map?.company_id || null,
        expense_account_id: expenseAccountId,
        party_account_id: map?.party_account_id || null,
        narration,
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

/**
 * Bills for the outsourced OT / cath-lab assistants on a scheduled surgery.
 * Raised at SCHEDULING time with the fee that was decided beforehand, so the
 * bill can be approved (and its JV posted) before the procedure happens.
 * Idempotent per (ot_schedule_id, party_name); a changed fee updates the
 * PENDING bill rather than duplicating it. Never throws — scheduling must
 * not fail because of billing.
 */
export async function createAssistantApprovalsFromOt(
  ot: {
    id: string
    surgery_name?: string | null
    visit_id?: string | null
    patient_name?: string | null
  },
  assistants: Array<{ role: string; name: string | null | undefined; fee: number | null | undefined }>,
): Promise<{ created: number }> {
  let created = 0
  for (const assistant of assistants) {
    const name = (assistant.name || '').trim()
    // Assistants are paid a flat 1,000 per case (owner's rate, 2026-08-02)
    // unless the OT screen names a different fee.
    const fee = Number(assistant.fee) || 1000
    if (!name) continue
    try {
      // Same as the surgeon path: without this the assistant's payable is
      // created against no company and no ledgers.
      const { data: maps, error: mapsError } = await doctorLedgerMap()
        .select('company_id, party_account_id, expense_account_id')
        .ilike('surgeon_name', name)
        .limit(1)
      if (mapsError) {
        throw new Error(`Could not read the ledger mapping for ${name}: ${mapsError.message}`)
      }
      const map = (maps || [])[0]
      const narration = [`${assistant.role}`, ot.surgery_name, ot.patient_name].filter(Boolean).join(' - ')
      const { error } = await approvalQueue().insert({
        category: 'DOCTOR',
        party_name: name,
        reference_no: ot.visit_id ? `OT-${ot.visit_id}` : null,
        amount: fee,
        company_id: map?.company_id || null,
        expense_account_id: map?.expense_account_id || null,
        party_account_id: map?.party_account_id || null,
        narration,
        ot_schedule_id: ot.id,
        created_by: 'ot-schedule',
      })
      if (!error) {
        created += 1
      } else if (error.code === '23505') {
        // Same assistant already billed for this OT — refresh the fee while
        // the bill is still pending; an approved bill is frozen. The fee can
        // only come DOWN from what was decided, never up (lte guard).
        await approvalQueue()
          .update({ amount: fee, narration })
          .eq('ot_schedule_id', ot.id)
          .ilike('party_name', name)
          .eq('status', 'PENDING')
          .gte('amount', fee)
      } else {
        console.warn('[ot-schedule] assistant bill insert failed:', error.message)
      }
    } catch (err: any) {
      console.warn('[ot-schedule] assistant bill failed:', err?.message || err)
    }
  }
  return { created }
}

/** One unpaid, JV-posted invoice of a party — what the payment screen searches. */
export interface UnpaidInvoice {
  id: string
  invoice_no: string | null
  party_name: string
  amount: number
  narration: string | null
  created_at: string | null
  ot_schedule_id: string | null
  company_id: string | null
  /** From the linked OT row, so the payment screen can search by patient/date. */
  patient_name: string | null
  surgery_name: string | null
  surgery_date: string | null
  surgery_time: string | null
  /** GA / SA / LA…, parsed from the OT row's marked segment. */
  anesthesia_type: string | null
}

/** special_requirements also carries free-text notes — only the marked segment is the anaesthesia. */
const parseAnesthesia = (value: string | null | undefined): string | null => {
  const match = String(value || '').match(/Anesthesia Type:\s*([^|\n]+)/i)
  return match ? match[1].trim() || null : null
}

/**
 * Stamps patient / surgery / date-time from each invoice's OT row onto it.
 * A manual two-step join: approval_queue.ot_schedule_id carries no FK, so
 * PostgREST cannot embed ot_schedule for us.
 */
async function attachOtContext<T extends { ot_schedule_id: string | null }>(rows: T[]): Promise<T[]> {
  const otIds = [...new Set(rows.map((r) => r.ot_schedule_id).filter(Boolean))] as string[]
  if (!otIds.length) {
    return rows.map((r) => ({ ...r, patient_name: null, surgery_name: null, surgery_date: null, surgery_time: null, anesthesia_type: null }))
  }
  // This is the patient and surgery an approver reads before releasing money.
  // Dropping these errors blanks every one of those fields, so the list looks
  // like invoices with no context rather than a screen that failed to load it.
  const { data: ots, error: otsError } = await (supabase as any)
    .from('ot_schedule')
    .select('id, surgery_name, scheduled_date, scheduled_time, patient_id, special_requirements, anaesthesia_type')
    .in('id', otIds)
  if (otsError) throw otsError
  const otById = new Map((ots || []).map((o: any) => [o.id, o]))
  const patientIds = [...new Set((ots || []).map((o: any) => o.patient_id).filter(Boolean))]
  let patientById = new Map<string, string>()
  if (patientIds.length) {
    const { data: pats, error: patsError } = await (supabase as any).from('patients').select('id, name').in('id', patientIds)
    if (patsError) throw patsError
    patientById = new Map((pats || []).map((p: any) => [p.id, p.name]))
  }
  return rows.map((r) => {
    const ot: any = r.ot_schedule_id ? otById.get(r.ot_schedule_id) : null
    return {
      ...r,
      patient_name: ot?.patient_id ? patientById.get(ot.patient_id) ?? null : null,
      surgery_name: ot?.surgery_name ?? null,
      surgery_date: ot?.scheduled_date ?? null,
      surgery_time: ot?.scheduled_time ?? null,
      // The real column first; the "Anesthesia Type:" text inside
      // special_requirements is where this lived before 20260816180000 and
      // remains the answer for rows written before it.
      anesthesia_type: ot?.anaesthesia_type ?? parseAnesthesia(ot?.special_requirements),
    }
  })
}

/**
 * The party's open invoices: approved, JV posted, not yet paid. Paid
 * invoices never appear here — that is the whole point of the list.
 */
export async function listUnpaidInvoices(partyAccountId: string): Promise<UnpaidInvoice[]> {
  const { data, error } = await approvalQueue()
    .select('id, invoice_no, party_name, amount, narration, created_at, ot_schedule_id, company_id')
    .eq('party_account_id', partyAccountId)
    .eq('status', 'APPROVED')
    .eq('is_paid', false)
    .not('jv_voucher_id', 'is', null)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message || 'Could not load the unpaid invoices')
  return attachOtContext((data || []) as UnpaidInvoice[])
}

/** One row of the date-wise surgery invoice report. */
export interface SurgeryInvoiceRow extends ApprovalQueueRow {
  patient_name: string | null
  surgery_name: string | null
  surgery_date: string | null
  surgery_time: string | null
  anesthesia_type: string | null
}

/**
 * Every OT-generated invoice (surgeon / anesthetist / OT & cath-lab
 * assistant), date-wise, with the patient and surgery it belongs to. The
 * date range filters on the SURGERY date; invoices whose OT row has no
 * scheduled date fall back to the invoice's created date.
 */
export async function listSurgeryInvoices(fromDate: string, toDate: string): Promise<SurgeryInvoiceRow[]> {
  const { data, error } = await approvalQueue()
    .select('*')
    .not('ot_schedule_id', 'is', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Could not load the surgery invoices')
  const rows = await attachOtContext((data || []) as SurgeryInvoiceRow[])
  return rows.filter((row) => {
    const d = row.surgery_date || (row.created_at || '').slice(0, 10)
    return d >= fromDate && d <= toDate
  })
}

/**
 * invoice id → schedule_date for surgery invoices already sitting on a live
 * (unpaid, unskipped) daily payment allocation.
 */
export async function listSurgeryInvoiceAllocations(): Promise<Record<string, string>> {
  const { data, error } = await (supabase as any)
    .from('daily_payment_schedule')
    .select('approval_queue_id, schedule_date, status')
    .not('approval_queue_id', 'is', null)
    .not('status', 'in', '(paid,skipped)')
  if (error) throw new Error(error.message || 'Could not check the daily allocations')
  const map: Record<string, string> = {}
  for (const r of (data || []) as any[]) map[r.approval_queue_id] = r.schedule_date
  return map
}

/**
 * Moves one approved, unpaid surgery invoice onto a day's Daily Payment
 * Allocation, where accounting pays it against the day's budget.
 */
export async function moveSurgeryInvoiceToDailyAllocation(
  invoiceId: string,
  date: string,
  createdBy?: string | null,
): Promise<{ invoice_no: string; party: string; amount: number }> {
  const { data, error } = await (supabase as any).rpc('move_surgery_invoice_to_daily_allocation', {
    p_invoice_id: invoiceId,
    p_date: date,
    p_created_by: createdBy ?? null,
  })
  if (error) throw new Error(error.message || 'Could not move the invoice to the daily allocation')
  return data
}

/**
 * Pays SEVERAL invoices of one party with ONE payment voucher:
 * Dr party (total) / Cr cash-bank (total), every invoice linked to the same
 * voucher. Same claim-then-post shape as the single payment: all rows flip
 * is_paid first; if any cannot be claimed the claimed ones are released and
 * nothing posts.
 */
export async function payInvoicesTogether(
  ids: string[],
  input: { cashBankAccountId: string; date: string },
): Promise<{ voucherNumber: string; total: number; count: number }> {
  if (!ids.length) throw new Error('Pick at least one invoice')
  if (!input.cashBankAccountId) throw new Error('Select a cash or bank ledger')
  if (!input.date) throw new Error('Select a payment date')

  const { data: claimed, error: claimError } = await approvalQueue()
    .update({ is_paid: true, paid_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'APPROVED')
    .eq('is_paid', false)
    .not('jv_voucher_id', 'is', null)
    .select('*')
  if (claimError) throw new Error(claimError.message || 'Failed to start the payment')
  const rows = (claimed || []) as ApprovalQueueRow[]

  const release = async () => {
    if (rows.length) {
      await approvalQueue()
        .update({ is_paid: false, paid_at: null })
        .in('id', rows.map((r) => r.id))
        .is('payment_voucher_id', null)
    }
  }

  if (rows.length !== ids.length) {
    await release()
    throw new Error('Some of these invoices were just paid or changed by someone else. Reload and pick again.')
  }
  const party = new Set(rows.map((r) => r.party_account_id))
  const company = new Set(rows.map((r) => r.company_id))
  if (party.size > 1 || company.size > 1) {
    await release()
    throw new Error('All invoices in one payment must belong to the same party and company')
  }
  if (input.cashBankAccountId === rows[0].party_account_id) {
    await release()
    throw new Error('Cash/Bank ledger must be different from the party ledger')
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
  const invoiceNos = rows.map((r) => (r as any).invoice_no || r.reference_no).filter(Boolean)

  try {
    const voucher = await createAccountingVoucher({
      companyId: rows[0].company_id,
      category: 'PAYMENT',
      date: input.date,
      referenceNumber: invoiceNos.join(', ') || undefined,
      narration: `Paid ${rows[0].party_name} against ${rows.length} invoice(s): ${invoiceNos.join(', ')}`,
      entries: [
        { accountId: rows[0].party_account_id, debitAmount: total, creditAmount: 0 },
        { accountId: input.cashBankAccountId, debitAmount: 0, creditAmount: total },
      ],
    })
    const { error: linkError } = await approvalQueue()
      .update({ payment_voucher_id: voucher.id })
      .in('id', rows.map((r) => r.id))
    if (linkError) console.warn('[approval-queue] payment posted but link failed:', linkError.message)
    return { voucherNumber: voucher.voucher_number, total, count: rows.length }
  } catch (err) {
    await release()
    throw err
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

  // The pre-filled amount is the DECIDED rate (fee master / defaults). The OT
  // desk may negotiate a fee DOWN, never up — raising is management's call on
  // the Approvals screen. Enforced per bill: an undecided bill (amount 0)
  // takes the entered amount, a decided bill only accepts a reduction, and a
  // bill already below the entered amount is left alone rather than raised.
  const { data, error } = await approvalQueue()
    .update({ amount })
    .eq('ot_schedule_id', ot.id)
    .eq('status', 'PENDING')
    .or(`amount.eq.0,amount.gte.${amount}`)
    .select('id')
  if (error) throw new Error(error.message || 'Failed to save the amount')
  if (!(data || []).length) {
    throw new Error(
      'The decided amount is lower — fees can be reduced after negotiation, not raised',
    )
  }
  return { updated: (data || []).length }
}

// ------------------------------------------------------------------
// RMO duty roster (OT Schedule - Gaurav). One approval-queue row per RMO
// per duty day, category SALARY: the duty entry IS the payable, so it flows
// through the same approve → JV → pay machinery as every other bill. The
// amount comes from the RMO master's daily_remuneration, decided the moment
// the duty is recorded.
// ------------------------------------------------------------------

const RMO_DUTY_PREFIX = 'RMO-DUTY-'
const JAVED_RMO_DUTY_PREFIX = 'RMO-DUTY-JAVED-'

export async function addRmoDutyApproval(input: {
  rmoName: string
  /** yyyy-mm-dd */
  dutyDate: string
  amount: number
  /** morning | evening | night — stored for the monthly duty report. */
  shift?: string | null
  /** The RMO's ledger from the master — pre-fills the bill's party side. */
  partyAccountId?: string | null
  /**
   * The company and expense head, resolved by the caller from the RMO's own
   * ledger. Without them the bill lands in Approvals as "needs details" and
   * cannot be approved until an accountant fills both in by hand.
   */
  companyId?: string | null
  expenseAccountId?: string | null
  hospital?: string | null
  createdBy?: string | null
  /** Separate roster namespace for the Ayushman-only Javed tile. */
  roster?: 'gaurav' | 'javed'
}): Promise<{ created: boolean }> {
  const name = input.rmoName.trim()
  if (!name) throw new Error('Pick the RMO who did the duty')
  if (!input.amount || input.amount <= 0) throw new Error('Duty amount must be more than zero')
  const referencePrefix = input.roster === 'javed' ? JAVED_RMO_DUTY_PREFIX : RMO_DUTY_PREFIX
  const reference = `${referencePrefix}${input.dutyDate}`

  // One duty payment per RMO per day — a re-tap must not queue a second bill.
  // REJECTED rows do not count: a rejected duty entry must not block the
  // corrected one from being entered. The partial unique index
  // approval_queue_duty_salary_reference_uniq backstops the race two
  // concurrent taps leave open.
  let existingQuery = approvalQueue()
    .select('id')
    .eq('reference_no', reference)
    .ilike('party_name', name)
    .neq('status', 'REJECTED')
  if (input.shift) existingQuery = existingQuery.eq('duty_shift', input.shift)
  const { data: existing, error: checkError } = await existingQuery.limit(1)
  if (checkError) throw new Error(checkError.message || 'Could not check existing duty entries')
  if ((existing || []).length) return { created: false }

  const { error } = await approvalQueue().insert({
    category: 'SALARY',
    party_name: name,
    reference_no: reference,
    amount: input.amount,
    party_account_id: input.partyAccountId || null,
    company_id: input.companyId || null,
    expense_account_id: input.expenseAccountId || null,
    duty_shift: input.shift || null,
    narration: `RMO duty ${input.dutyDate}${input.shift ? ` ${input.shift}` : ''}${input.hospital ? ` (${input.hospital})` : ''}`,
    created_by: input.createdBy || 'ot-rmo-duty',
  })
  if (error) {
    if (error.code === '23505') return { created: false }
    throw new Error(error.message || 'Could not record the duty')
  }
  return { created: true }
}

export async function listRmoDutyApprovals(
  dutyDate: string,
  roster: 'gaurav' | 'javed' = 'gaurav',
): Promise<Array<{
  id: string
  party_name: string
  amount: number
  status: string
  duty_shift: string | null
}>> {
  const { data, error } = await approvalQueue()
    .select('id, party_name, amount, status, duty_shift')
    .eq('reference_no', `${roster === 'javed' ? JAVED_RMO_DUTY_PREFIX : RMO_DUTY_PREFIX}${dutyDate}`)
    .neq('status', 'REJECTED')
    .order('party_name')
  if (error) throw new Error(error.message || 'Failed to load the duty list')
  return data || []
}

/** Removes a duty entry that has not been approved yet. Approved bills are frozen. */
export async function deleteRmoDutyApproval(id: string): Promise<void> {
  const { data, error } = await approvalQueue()
    .delete()
    .eq('id', id)
    .eq('status', 'PENDING')
    .select('id')
  if (error) throw new Error(error.message || 'Could not remove the duty entry')
  // Deleting zero rows is a failure the user must see, not a silent success —
  // the entry was approved (frozen) or already gone.
  if (!(data || []).length) {
    throw new Error('This entry is already approved in accounting and can no longer be removed here')
  }
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
