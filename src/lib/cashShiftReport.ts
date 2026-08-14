import { supabase } from '@/integrations/supabase/client';

/**
 * The cash trail for a shift: what the counter opened with, what it took, and
 * what it handed on.
 *
 * All three already existed as data and none of it was visible anywhere.
 * cash_opening_declarations in particular had no screen at all -- the figure
 * was recorded and then could only be read out of the database by hand.
 *
 * Read-only, and deliberately so. Nothing here writes; a report that can edit
 * the record it reports on is how a reconciliation stops being evidence.
 */

export interface OpeningRow {
  id: string;
  hospitalType: string;
  amount: number;
  declaredByName: string;
  declaredBy: string | null;
  note: string | null;
  at: string;
  /** Null while the opening is still sitting on the counter unclaimed. */
  handoverId: string | null;
}

export interface HandoverRow {
  id: string;
  handoverNo: string;
  /**
   * The statement number of the whole session this handover belongs to: one
   * counter, one day. Two handovers on the same counter on the same day share
   * it, while their CH- numbers stay distinct — one is the session, the other
   * is the act. Null only on a row whose session could not be attached.
   */
  statementNo: string | null;
  hospitalType: string | null;
  fromUserId: string | null;
  fromName: string | null;
  toName: string | null;
  expected: number;
  counted: number;
  locker: number;
  deposit: number;
  variance: number;
  varianceReason: string | null;
  status: string;
  submittedAt: string | null;
  acceptedAt: string | null;
  verifiedAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  sourceCount: number;
}

export interface ShiftLine {
  amount: number;
  at: string | null;
  patientName: string | null;
  collectedByLabel: string | null;
  sourceTable: string | null;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Openings, newest first. Both filters are optional. */
export async function fetchOpenings(opts: {
  hospitalType?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<OpeningRow[]> {
  let q = (supabase as any)
    .from('cash_opening_declarations')
    .select('id, hospital_type, amount, declared_by, declared_by_name, note, created_at, cash_handover_id')
    .order('created_at', { ascending: false })
    .limit(500);
  if (opts.hospitalType) q = q.eq('hospital_type', opts.hospitalType);
  if (opts.from) q = q.gte('created_at', opts.from);
  if (opts.to) q = q.lte('created_at', opts.to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    hospitalType: r.hospital_type,
    amount: num(r.amount),
    declaredByName: r.declared_by_name || '—',
    declaredBy: r.declared_by ?? null,
    note: r.note ?? null,
    at: r.created_at,
    handoverId: r.cash_handover_id ?? null,
  }));
}

/** Handovers, newest first. */
export async function fetchHandoverLog(opts: {
  hospitalType?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<HandoverRow[]> {
  let q = (supabase as any)
    .from('cash_handovers')
    .select(
      'id, handover_no, hospital_type, from_user_id, from_user_name, to_user_name, expected_cash, counted_cash, locker_cash, bank_deposit, variance, variance_reason, status, submitted_at, accepted_at, verified_at, period_from, period_to, source_count, created_at, cash_sessions(statement_no)',
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (opts.hospitalType) q = q.eq('hospital_type', opts.hospitalType);
  if (opts.from) q = q.gte('created_at', opts.from);
  if (opts.to) q = q.lte('created_at', opts.to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    handoverNo: r.handover_no,
    statementNo: r.cash_sessions?.statement_no ?? null,
    hospitalType: r.hospital_type ?? null,
    fromUserId: r.from_user_id ?? null,
    fromName: r.from_user_name ?? null,
    toName: r.to_user_name ?? null,
    expected: num(r.expected_cash),
    counted: num(r.counted_cash),
    locker: num(r.locker_cash),
    deposit: num(r.bank_deposit),
    variance: num(r.variance),
    varianceReason: r.variance_reason ?? null,
    status: r.status,
    submittedAt: r.submitted_at ?? r.created_at ?? null,
    acceptedAt: r.accepted_at ?? null,
    verifiedAt: r.verified_at ?? null,
    periodFrom: r.period_from ?? null,
    periodTo: r.period_to ?? null,
    sourceCount: Number(r.source_count ?? 0),
  }));
}

/** Every receipt the shift claimed — the "what happened in between". */
export async function fetchShiftLines(handoverId: string): Promise<ShiftLine[]> {
  const { data, error } = await (supabase as any)
    .from('cash_handover_sources')
    .select('amount, collected_at, patient_name, collected_by_label, source_table')
    .eq('handover_id', handoverId)
    .order('collected_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    amount: num(r.amount),
    at: r.collected_at ?? null,
    patientName: r.patient_name ?? null,
    collectedByLabel: r.collected_by_label ?? null,
    sourceTable: r.source_table ?? null,
  }));
}

/** The opening that this handover carried across, if one was claimed. */
export async function fetchOpeningForHandover(handoverId: string): Promise<OpeningRow | null> {
  const { data, error } = await (supabase as any)
    .from('cash_opening_declarations')
    .select('id, hospital_type, amount, declared_by, declared_by_name, note, created_at, cash_handover_id')
    .eq('cash_handover_id', handoverId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0];
  if (!r) return null;
  return {
    id: r.id,
    hospitalType: r.hospital_type,
    amount: num(r.amount),
    declaredByName: r.declared_by_name || '—',
    declaredBy: r.declared_by ?? null,
    note: r.note ?? null,
    at: r.created_at,
    handoverId: r.cash_handover_id ?? null,
  };
}

export interface DepositRow {
  id: string;
  voucherNo: string;
  at: string;
  amount: number;
  narration: string;
  companyName: string;
  by: string | null;
  slipCount: number;
}

/**
 * Cash paid into the bank.
 *
 * post_cash_bank_entry writes a CONTRA voucher whose narration always begins
 * "Cash deposited into <bank>", which is what identifies one. There is no
 * deposit table -- the voucher IS the record, and inventing a parallel one
 * would mean two versions of the same deposit to reconcile.
 */
export async function fetchBankDeposits(opts: {
  companyId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<DepositRow[]> {
  let q = (supabase as any)
    .from('vouchers')
    .select('id, voucher_number, voucher_date, narration, total_amount, created_by, created_at, company_id, companies(company_name)')
    .ilike('narration', 'Cash deposited into%')
    .order('voucher_date', { ascending: false })
    .limit(500);
  if (opts.companyId) q = q.eq('company_id', opts.companyId);
  if (opts.from) q = q.gte('voucher_date', opts.from);
  if (opts.to) q = q.lte('voucher_date', opts.to);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  // The deposit slip, if one was attached. Counted rather than fetched: the
  // report says whether the evidence exists, and the day book opens it.
  const ids = rows.map((r: any) => r.id);
  const slips = new Map<string, number>();
  if (ids.length) {
    const { data: files } = await (supabase as any)
      .from('file_uploads')
      .select('voucher_id')
      .in('voucher_id', ids);
    for (const f of files ?? []) {
      slips.set(f.voucher_id, (slips.get(f.voucher_id) ?? 0) + 1);
    }
  }

  return rows.map((r: any) => ({
    id: r.id,
    voucherNo: r.voucher_number,
    at: r.voucher_date || r.created_at,
    amount: num(r.total_amount),
    narration: r.narration || '',
    companyName: r.companies?.company_name || '—',
    by: r.created_by ?? null,
    slipCount: slips.get(r.id) ?? 0,
  }));
}
