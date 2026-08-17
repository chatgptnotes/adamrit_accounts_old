/**
 * Cash handover — the chain of custody for physical cash.
 *
 * Every amount here is computed by the database. The client sends the note
 * count and who is receiving the cash; it never supplies the expected figure,
 * because that is the number the count is being checked against.
 */
import { supabase } from "@/integrations/supabase/client";

/** The notes and coins a drawer can hold, largest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface HandoverLine {
  table: string;
  id: string;
  amount: number;
  at: string;
  who: string;
  patient: string | null;
  mine: boolean;
}

export interface HandoverPreview {
  counterAmount: number;
  counterCount: number;
  payoutAmount: number;
  cutoverAt: string;
  mineAmount: number;
  mineCount: number;
  unattributedAmount: number;
  unattributedCount: number;
  includeUnattributed: boolean;
  expectedCash: number;
  refUpiTotal: number;
  refCardTotal: number;
  lines: HandoverLine[];
}

export interface CashHandover {
  id: string;
  handover_no: string;
  /** Which counter, and so which company's books: hope, ayushman, pharmacy. */
  hospital_type: string | null;
  from_user_id: string;
  from_user_name: string;
  to_user_id: string;
  to_user_name: string;
  expected_cash: number;
  /** The drawer only: the notes physically counted at handover. */
  counted_cash: number;
  /** Held by the counter but not handed over. Part of the variance. */
  locker_cash: number | null;
  /** Already banked during the shift. Part of the variance. */
  bank_deposit: number | null;
  /** Moved between drawer and locker during the shift. Recorded for the
   *  trail; deliberately NOT part of the variance, because the money is
   *  already counted at whichever end it landed. */
  locker_withdrawn: number | null;
  locker_deposited: number | null;
  variance: number;
  variance_reason: string | null;
  ref_upi_total: number;
  ref_card_total: number;
  declared_online: number | null;
  verifier_counted: number | null;
  software_online: number | null;
  source_count: number;
  included_unattributed: boolean;
  /** True when no receipts could be claimed: a declared count, not a
   *  reconciled one. Happens while counter staff share a login. */
  is_unmatched: boolean;
  status: "SUBMITTED" | "ACCEPTED" | "VERIFIED" | "CANCELLED";
  submitted_at: string;
  accepted_at: string | null;
  accepted_by_name: string | null;
  verified_at: string | null;
  verified_by_name: string | null;
  verify_note: string | null;
  accept_note: string | null;
  cancel_reason: string | null;
  notes: string | null;
}

export interface CashPosition {
  holder_user_id: string | null;
  holder_name: string;
  /**
   * How the holder was identified. "login" is the person who was signed in and
   * is the only one that can claim cash; "name" is the billing-executive name
   * typed on the payment screen, shown so old rows are not a blank; "none" is
   * neither.
   */
  attribution: "login" | "name" | "none" | "payout";
  net_cash: number;
  receipt_count: number;
  oldest_uncollected: string | null;
}

export interface Nominee {
  id: string;
  user_id: string;
  display_name: string;
  can_receive: boolean;
  can_verify: boolean;
  is_active: boolean;
  /** Which counter this applies to. "*" means every hospital. */
  hospital_type: string;
}

/** Nomination that applies everywhere. */
export const ALL_HOSPITALS = "*";

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(fn, args);

export async function fetchPreview(
  userId: string,
  includeUnattributed: boolean,
  hospitalType?: string | null,
): Promise<HandoverPreview> {
  const { data, error } = await rpc("cash_handover_preview", {
    p_user_id: userId,
    p_include_unattributed: includeUnattributed,
    p_hospital_type: hospitalType ?? null,
  });
  if (error) throw new Error(error.message);
  return data as HandoverPreview;
}

export async function submitHandover(input: {
  fromUserId: string;
  toUserId: string;
  denominations: { denomination: number; qty: number }[];
  hospitalType?: string | null;
  varianceReason?: string | null;
  includeUnattributed?: boolean;
  notes?: string | null;
  /** What the cashier says was taken online. Never counted as cash. */
  declaredOnline?: number | null;
  /** Cash held in the locker — still theirs, so it counts toward the total. */
  lockerCash?: number | null;
  /** Cash they already paid into the bank this shift, so it is not a shortfall. */
  bankDeposit?: number | null;
  /** Taken OUT of the locker this shift. Recorded, never added to the total —
   *  it is already counted in the drawer. */
  lockerWithdrawn?: number | null;
  /** Put INTO the locker this shift. Already counted in lockerCash. */
  lockerDeposited?: number | null;
}): Promise<{ handoverId: string; handoverNo: string; variance: number }> {
  const { data, error } = await rpc("submit_cash_handover", {
    p_from_user_id: input.fromUserId,
    p_to_user_id: input.toUserId,
    p_denominations: input.denominations.filter((d) => d.qty > 0),
    p_hospital_type: input.hospitalType ?? null,
    p_variance_reason: input.varianceReason ?? null,
    p_include_unattributed: input.includeUnattributed ?? false,
    p_notes: input.notes ?? null,
    p_declared_online: input.declaredOnline ?? null,
    p_locker_cash: input.lockerCash ?? 0,
    p_bank_deposit: input.bankDeposit ?? 0,
    p_locker_withdrawn: input.lockerWithdrawn ?? 0,
    p_locker_deposited: input.lockerDeposited ?? 0,
  });
  if (error) throw new Error(error.message);
  return data as { handoverId: string; handoverNo: string; variance: number };
}

export async function acceptHandover(id: string, userId: string, note?: string) {
  const { data, error } = await rpc("accept_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function verifyHandover(
  id: string, userId: string, note?: string, verifierCounted?: number | null,
) {
  const { data, error } = await rpc("verify_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_note: note ?? null,
    p_verifier_counted: verifierCounted ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelHandover(id: string, userId: string, reason: string) {
  const { data, error } = await rpc("cancel_cash_handover", {
    p_handover_id: id,
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data;
}

export interface CashPayout {
  id: string;
  amount: number;
  /** When the cash actually left the counter. */
  at: string;
  /** The date the voucher is filed under, which staff often backdate. */
  entry_date: string | null;
  label: string;
  voucher_no: string | null;
  paid_by: string | null;
  /** "payment_voucher" = the till; "accounting" = posted in the books. */
  source: "payment_voucher" | "accounting";
}

/** The individual payment vouchers behind the "Cash paid out" line. */
export async function fetchPayouts(hospitalType?: string | null): Promise<CashPayout[]> {
  const { data, error } = await rpc("cash_payouts_pool", {
    p_hospital_type: hospitalType ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as CashPayout[]).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export interface OnlineOut {
  id: string;
  amount: number;
  at: string;
  entry_date: string | null;
  label: string;
  ledger: string | null;
  voucher_no: string | null;
  /** Who the books say posted it, resolved to a name where the login is one. */
  paid_by: string | null;
}

/** Vendor and other payments made by bank or UPI. Never part of the drawer. */
export async function fetchOnlineOut(hospitalType?: string | null): Promise<OnlineOut[]> {
  const { data, error } = await rpc("online_out_pool", {
    p_hospital_type: hospitalType ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as OnlineOut[]).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export interface PharmacySummary {
  cashAmount: number; cashCount: number;
  upiAmount: number; upiCount: number;
  cardAmount: number; cardCount: number;
}

export interface PharmacyTransaction {
  id: string;
  source_table: "pharmacy_sales" | "pharmacy_credit_payments";
  amount: number;
  at: string;
  /** CASH, UPI, CARD ... upper-cased at the database. */
  mode: string;
  uid: string | null;
  /** Patient, or what the payment was for. */
  label: string;
  /** Who took it: the signed-in user's name, else the name typed at the till. */
  who: string | null;
  /** Bill number, or the payment reference on a credit collection. */
  reference: string | null;
}

/** Every pharmacy transaction behind the till figure, cash and online alike. */
export async function fetchPharmacyTransactions(): Promise<PharmacyTransaction[]> {
  const { data, error } = await rpc("pharmacy_cash_pool", {});
  if (error) throw new Error(error.message);
  return ((data ?? []) as PharmacyTransaction[]).sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Hope Pharmacy runs its own drawer: its own company, ledger and staff. */
export async function fetchPharmacyPositions(): Promise<CashPosition[]> {
  const { data, error } = await rpc("pharmacy_position_by_holder", {});
  if (error) throw new Error(error.message);
  return (data ?? []) as CashPosition[];
}

/** Cash is counted; UPI and card are reported beside it, never counted. */
export async function fetchPharmacySummary(): Promise<PharmacySummary> {
  const { data, error } = await rpc("pharmacy_cash_summary", {});
  if (error) throw new Error(error.message);
  return data as PharmacySummary;
}


export interface StaleHandover {
  id: string; handover_no: string; hospital_type: string | null; status: string;
  from_user_name: string; to_user_name: string; counted_cash: number;
  waiting_since: string; hours_waiting: number; waiting_on: string;
}

/** Handovers nobody has acted on. Both of the first two sat for hours. */
export async function fetchStaleHandovers(hours = 12): Promise<StaleHandover[]> {
  const { data, error } = await rpc("stale_handovers", { p_hours: hours });
  if (error) throw new Error(error.message);
  return (data ?? []) as StaleHandover[];
}

export interface SharedLogin {
  login: string; login_name: string; distinct_names: number;
  names: string; receipts: number; total: number;
}

/** Logins where more than one person's name was typed at the till. */
export async function fetchSharedLogins(days = 30): Promise<SharedLogin[]> {
  const { data, error } = await rpc("shared_login_report", { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as SharedLogin[];
}

/** The one-off count that stops the drawer reading negative. */
export async function declareOpeningCash(input: {
  hospitalType: string; amount: number; userId: string; note?: string | null;
  lockerWithdrawn?: number | null; lockerDeposited?: number | null;
}) {
  const { data, error } = await rpc("declare_opening_cash", {
    p_hospital_type: input.hospitalType,
    p_amount: input.amount,
    p_user_id: input.userId,
    p_note: input.note ?? null,
    p_locker_withdrawn: input.lockerWithdrawn ?? 0,
    p_locker_deposited: input.lockerDeposited ?? 0,
  });
  if (error) throw new Error(error.message);
  return data;
}

export interface OpeningState {
  declared: boolean; amount: number; at: string | null; by: string | null;
}

/** Whether the counter already holds an opening balance nobody has handed over. */
export async function fetchOpeningState(hospitalType: string): Promise<OpeningState> {
  const { data, error } = await rpc("cash_opening_state", { p_hospital_type: hospitalType });
  if (error) throw new Error(error.message);
  return data as OpeningState;
}

export interface UnattendedOpeningResult {
  id: string; hospitalType: string; amount: number; by: string;
  /** True when the previous shift's balance was closed with an unattended handover. */
  unattended: boolean;
  handoverNo?: string; previousBy?: string | null;
  previousAmount?: number; variance?: number;
}

/**
 * Opening cash over a balance the previous shift never handed over. The
 * database first closes the absent cashier's session with a handover in THEIR
 * name — counted at what this cashier actually found, so any shortfall lands
 * on the right person — and then records the fresh opening. Drawer and locker
 * are sent separately because the handover records them separately.
 */
export async function declareOpeningCashUnattended(input: {
  hospitalType: string; drawer: number; locker: number; userId: string;
  note?: string | null; lockerWithdrawn?: number | null; lockerDeposited?: number | null;
}): Promise<UnattendedOpeningResult> {
  const { data, error } = await rpc("declare_opening_cash_unattended", {
    p_hospital_type: input.hospitalType,
    p_drawer: input.drawer,
    p_locker: input.locker,
    p_user_id: input.userId,
    p_note: input.note ?? null,
    p_locker_withdrawn: input.lockerWithdrawn ?? 0,
    p_locker_deposited: input.lockerDeposited ?? 0,
  });
  if (error) {
    // PGRST202: the function is not in the schema yet — the migration that
    // creates it has not been applied to this database. Say that, rather than
    // surfacing "not found in the schema cache" to a cashier at 8am.
    if (/declare_opening_cash_unattended/.test(error.message) && /schema cache|does not exist/i.test(error.message)) {
      throw new Error(
        "The database update for unattended handovers has not been applied yet " +
        "(migration 20260817100000). The previous shift's balance still blocks this counter.");
    }
    throw new Error(error.message);
  }
  return data as UnattendedOpeningResult;
}

/** Omit the hospital for the group-wide view; pass one to see just that counter. */
export async function fetchPositions(hospitalType?: string | null): Promise<CashPosition[]> {
  const { data, error } = await rpc("cash_position_by_holder", {
    p_hospital_type: hospitalType ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CashPosition[];
}

/**
 * Nominated people. Pass a hospital to get only those who hold rights at that
 * counter (its own nominations plus the group-wide "*" ones); omit it to get
 * the full roster for the master screen.
 */
export async function fetchNominees(hospitalType?: string | null): Promise<Nominee[]> {
  let q = (supabase as any)
    .from("cash_handover_verifiers")
    .select("id, user_id, display_name, can_receive, can_verify, is_active, hospital_type")
    .eq("is_active", true)
    .order("display_name");
  if (hospitalType) {
    q = q.in("hospital_type", [ALL_HOSPITALS, hospitalType.trim().toLowerCase()]);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Nominee[];
}

export async function setNominee(input: {
  userId: string;
  canReceive: boolean;
  canVerify: boolean;
  isActive: boolean;
  actor?: string | null;
  /** "*" (default) applies at every hospital. */
  hospitalType?: string;
}) {
  const { data, error } = await rpc("set_cash_handover_verifier", {
    p_user_id: input.userId,
    p_can_receive: input.canReceive,
    p_can_verify: input.canVerify,
    p_is_active: input.isActive,
    p_actor: input.actor ?? null,
    p_hospital_type: input.hospitalType ?? ALL_HOSPITALS,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchHandovers(opts?: {
  status?: string[];
  toUserId?: string;
  limit?: number;
}): Promise<CashHandover[]> {
  let q = (supabase as any)
    .from("cash_handovers")
    .select("*")
    .order("submitted_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.status?.length) q = q.in("status", opts.status);
  if (opts?.toUserId) q = q.eq("to_user_id", opts.toUserId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as CashHandover[];
}

/* ------------------------------------------------- photographs at handover */

/** What a photograph is OF, so a reader knows before opening it. */
export const HANDOVER_PHOTO_KINDS = [
  { key: "cash_register", label: "Cash register" },
  { key: "signed_note", label: "Signed handover note" },
  { key: "other", label: "Other" },
] as const;

/**
 * A spoken explanation of the variance. Deliberately NOT in
 * HANDOVER_PHOTO_KINDS: that list is the dropdown offered when labelling a
 * photograph, and "spoken explanation" is not something a photograph can be.
 * It travels the same upload path because it is the same kind of thing -- a
 * file attached to a handover -- but it is produced by the recorder, never
 * chosen from a menu.
 */
export const VOICE_REASON_KIND = "voice_reason" as const;

export type HandoverPhotoKind =
  | (typeof HANDOVER_PHOTO_KINDS)[number]["key"]
  | typeof VOICE_REASON_KIND;

export const handoverPhotoLabel = (kind: string) =>
  kind === VOICE_REASON_KIND
    ? "Spoken explanation"
    : (HANDOVER_PHOTO_KINDS.find((k) => k.key === kind)?.label ?? "Other");

/** True for an attachment that must be played rather than looked at. */
export const isVoiceAttachment = (a: { kind: string; fileType: string | null }) =>
  a.kind === VOICE_REASON_KIND || (a.fileType ?? "").startsWith("audio/");

export interface HandoverPhoto {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string | null;
  kind: HandoverPhotoKind;
  uploadedAt: string | null;
}

const PHOTO_BUCKET = "uploads";
const MAX_PHOTO_SIZE = 12 * 1024 * 1024;

/** The photographs taken when this drawer was handed over, oldest first. */
export async function fetchHandoverPhotos(handoverId: string): Promise<HandoverPhoto[]> {
  const { data, error } = await (supabase as any)
    .from("cash_handover_photos")
    .select("id, file_name, file_url, file_type, kind, created_at")
    .eq("handover_id", handoverId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    fileName: r.file_name ?? "photo",
    fileUrl: r.file_url ?? "",
    fileType: r.file_type ?? null,
    kind: (r.kind ?? "other") as HandoverPhotoKind,
    uploadedAt: r.created_at ?? null,
  }));
}

/**
 * Store the photographs taken at a handover.
 *
 * Uploaded AFTER the handover is recorded, because the handover is the thing
 * that must not be lost: a failed upload should leave a correct handover with
 * missing evidence, never a photograph belonging to nothing. The caller is
 * expected to say so loudly if this throws.
 *
 * Each file is attempted on its own. One unreadable photo out of four should
 * not throw the other three away.
 */
export async function uploadHandoverPhotos(input: {
  handoverId: string;
  photos: { file: File; kind: HandoverPhotoKind }[];
  uploadedBy: string | null;
}): Promise<{ saved: number; failed: string[] }> {
  const failed: string[] = [];
  let saved = 0;

  for (const { file, kind } of input.photos) {
    try {
      const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      // Audio joins images and PDFs: a spoken variance explanation rides this
      // same path. Gated on the KIND as well as the type so an arbitrary sound
      // file cannot be attached as though it were a register page.
      const isVoice = kind === VOICE_REASON_KIND && file.type.startsWith("audio/");
      if (!file.type.startsWith("image/") && !isPdf && !isVoice) {
        throw new Error("not an image, PDF or voice note");
      }
      if (file.size > MAX_PHOTO_SIZE) throw new Error("over 12 MB");

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `cash-handovers/${input.handoverId}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;

      const { error: storageError } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (storageError) throw new Error(storageError.message);

      const { data: urlData } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(storagePath);

      const { error: insertError } = await (supabase as any)
        .from("cash_handover_photos")
        .insert({
          handover_id: input.handoverId,
          file_name: file.name,
          file_url: urlData?.publicUrl || "",
          file_type: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
          file_size: file.size,
          storage_path: storagePath,
          kind,
          uploaded_by: input.uploadedBy,
        });
      // The row is what makes a photograph findable; a file with no row is
      // invisible, so take it back out rather than leave it orphaned.
      if (insertError) {
        await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
        throw new Error(insertError.message);
      }
      saved += 1;
    } catch (e) {
      failed.push(`${file.name} (${e instanceof Error ? e.message : "failed"})`);
    }
  }

  return { saved, failed };
}

export async function fetchDenominations(handoverId: string) {
  const { data, error } = await (supabase as any)
    .from("cash_handover_denominations")
    .select("denomination, qty, line_total")
    .eq("handover_id", handoverId)
    .order("denomination", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { denomination: number; qty: number; line_total: number }[];
}
