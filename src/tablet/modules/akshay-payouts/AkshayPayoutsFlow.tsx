import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Banknote, Camera, Check, ChevronLeft, Landmark, Loader2, Printer, QrCode, ShieldCheck, Upload, User,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  VOUCHER_PAYMENT_PROOF_CATEGORY,
  linkVoucherAttachments,
  uploadVoucherAttachments,
} from "@/lib/voucher-attachments";
import { fileToBase64, verifyPaymentProof } from "@/lib/accounting-ai";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: rupali_visit_logs (the doctor's recorded services)
//   -> pay_doctor_services (payment voucher per company, against the JVs)
//   -> file_uploads (QR screenshot / signed cash voucher on the voucher)

interface ServiceRow {
  id: string;
  category: string;
  patient_name: string;
  purpose_reason: string;
  patient_category: string | null;
  amount: number;
  paid_voucher_id: string | null;
  created_at: string;
}

interface PaymentResult {
  companyName: string;
  voucherId: string;
  voucherNumber: string;
  amount: number;
}

const rupees = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * Akshay pays the doctors for the services Rupali recorded. Pick a doctor
 * and a day, tick the services to pay, then pay by scanning the doctor's QR
 * (every doctor's ledger carries one) or in cash. A payment voucher posts
 * against the JVs already made; the QR screenshot — or the printed, signed
 * cash voucher — is uploaded onto that voucher.
 */
export default function AkshayPayoutsFlow() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const qrFileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [doctorSearch, setDoctorSearch] = useState("");
  const [doctor, setDoctor] = useState<string | null>(null);
  const [day, setDay] = useState(format(new Date(), "yyyy-MM-dd"));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"QR" | "CASH" | "BANK" | null>(null);
  // Which account a bank transfer left. Required for BANK — the database
  // refuses a transfer that cannot say, because guessing is how a NEFT from
  // Saraswat came to sit against Canara (PV1436, 19 Aug).
  const [bankAccountId, setBankAccountId] = useState("");

  // Every active bank ledger, labelled with the company that owns it. The RPC
  // validates the choice against the company the services were booked in and
  // refuses a mismatch by name, so a wrong pick fails loudly rather than posting
  // into the wrong set of books.
  const bankLedgers = useQuery({
    queryKey: ["payout-bank-ledgers"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name, company_id, companies(company_name)")
        .eq("is_active", true)
        .or("account_group.ilike.%bank%,account_name.ilike.%bank%")
        .order("account_name");
      if (error) throw new Error(error.message);
      return ((data || []) as any[])
        // "Bank Charges" is an expense and "Dr. Badal Bankar" is a person; both
        // match on the word and neither is an account money leaves from.
        .filter((row) => !/charges|gurantee|guarantee|bankar/i.test(row.account_name))
        .map((row) => ({
          id: row.id as string,
          account_name: row.account_name as string,
          company_name: (row.companies?.company_name as string) || "",
        }));
    },
  });
  const [payments, setPayments] = useState<PaymentResult[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  // Every consultant in the two masters, searchable — not only the ones who
  // happen to have a recorded service already. A name carried by an old log
  // but no longer in a master stays listed, so its services remain payable.
  // Same shared-master rule as the Rupali tile: one doctor list, both
  // hospitals, deduped by name.
  const { data: doctors = [] } = useQuery({
    queryKey: ["akshay-doctors"],
    queryFn: async (): Promise<string[]> => {
      const [hope, ayushman, logged] = await Promise.all([
        supabase.from("hope_consultants").select("name"),
        supabase.from("ayushman_consultants").select("name"),
        (supabase as any)
          .from("rupali_visit_logs")
          .select("doctor_name")
          .not("voucher_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);
      const seen = new Map<string, string>();
      const add = (value: unknown) => {
        const name = String(value ?? "").trim();
        if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
      };
      for (const row of hope.data || []) add(row.name);
      for (const row of ayushman.data || []) add(row.name);
      for (const row of logged.data || []) add(row.doctor_name);
      return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    },
  });

  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ["akshay-services", doctor, day],
    enabled: !!doctor && step >= 2,
    queryFn: async (): Promise<ServiceRow[]> => {
      const { data, error } = await (supabase as any)
        .from("rupali_visit_logs")
        .select("id, category, patient_name, purpose_reason, patient_category, amount, paid_voucher_id, created_at")
        .eq("doctor_name", doctor)
        .not("voucher_id", "is", null)
        // The day as the hospital lives it (IST), not as UTC slices it.
        .gte("created_at", new Date(`${day}T00:00:00+05:30`).toISOString())
        .lte("created_at", new Date(`${day}T23:59:59.999+05:30`).toISOString())
        .order("created_at");
      if (error) throw error;
      return (data || []) as ServiceRow[];
    },
  });

  const { data: doctorQr } = useQuery({
    queryKey: ["akshay-doctor-qr", doctor],
    enabled: !!doctor,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await (supabase as any)
        .from("doctor_payment_qr")
        .select("qr_url")
        .ilike("doctor_name", doctor!)
        .maybeSingle();
      if (error) return null;
      return data?.qr_url ?? null;
    },
  });

  const total = useMemo(
    () => services.filter((s) => selected.has(s.id)).reduce((sum, s) => sum + Number(s.amount || 0), 0),
    [services, selected],
  );

  // The fingerprint of exactly what is being paid. Adding or removing a
  // patient changes it, so an approval never carries over to a bigger total.
  const logKey = useMemo(
    () => Array.from(selected).map(String).sort().join(","),
    [selected],
  );

  const { data: approval, refetch: refetchApproval } = useQuery({
    queryKey: ["akshay-payout-approval", logKey],
    enabled: selected.size > 0,
    queryFn: async (): Promise<{ approved_by: string; approved_at: string; total_amount: number } | null> => {
      const { data, error } = await (supabase as any)
        .from("doctor_payout_approvals")
        .select("approved_by, approved_at, total_amount")
        .eq("log_key", logKey)
        .order("approved_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (selected.size === 0) throw new Error("Select the services first");
      const { error } = await (supabase as any).from("doctor_payout_approvals").insert({
        doctor_name: doctor,
        log_ids: Array.from(selected),
        total_amount: total,
        service_count: selected.size,
        approved_by: user?.email || user?.id || "unknown",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(`${rupees(total)} approved for ${doctor}.`);
      void refetchApproval();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not approve the payout"),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!mode) throw new Error("Choose how the doctor was paid");
      if (mode === "BANK" && !bankAccountId) throw new Error("Choose the bank the transfer was made from");
      if (selected.size === 0) throw new Error("Select the services to pay");
      if (!approval) throw new Error("This total has not been approved yet");
      const { data, error } = await (supabase as any).rpc("pay_doctor_services", {
        p_log_ids: Array.from(selected),
        p_payment_mode: mode,
        p_paid_by: user?.email || user?.id || null,
        // Empty for QR and cash keeps the auto-pick this tile has always used.
        p_credit_account_id: bankAccountId || null,
      });
      if (error) throw new Error(error.message);
      return ((data as any)?.payments || []) as PaymentResult[];
    },
    onSuccess: (results) => {
      toast.success(
        `Paid ${rupees(results.reduce((s, p) => s + Number(p.amount), 0))} to ${doctor} — ${results
          .map((p) => p.voucherNumber)
          .join(", ")}.`,
      );
      setPayments(results);
      setUploadedCount(0);
      queryClient.invalidateQueries({ queryKey: ["akshay-services"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Payment failed"),
  });

  const uploadProof = async (files: FileList | null) => {
    if (!files?.length || !payments?.length) return;
    setUploading(true);
    try {
      const uploaded = await uploadVoucherAttachments(Array.from(files), VOUCHER_PAYMENT_PROOF_CATEGORY);
      // The proof belongs to every voucher this payment produced (usually one).
      for (const payment of payments) {
        await linkVoucherAttachments(payment.voucherId, uploaded.map((u) => ({ ...u, id: undefined })), user?.id || null);
      }
      setUploadedCount((n) => n + files.length);
      toast.success(
        mode === "CASH" ? "Signed voucher uploaded." : "Payment screenshot uploaded.",
      );
      // AI check: does the screenshot actually show this payment?
      if (mode === "QR" && files[0].type.startsWith("image/") && doctor) {
        const expected = payments.reduce((s, p) => s + Number(p.amount), 0);
        const { base64, mimeType } = await fileToBase64(files[0]);
        const verdict = await verifyPaymentProof(base64, mimeType, expected, doctor);
        if (verdict && !verdict.matches) {
          toast.warning(
            `AI check: screenshot shows ${verdict.amount_seen != null ? `₹${verdict.amount_seen.toLocaleString("en-IN")}` : "no clear amount"}, voucher is ₹${expected.toLocaleString("en-IN")}. ${verdict.note}`,
            { duration: 12000 },
          );
        } else if (verdict?.matches) {
          toast.success("AI check: screenshot matches the voucher amount.");
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveDoctorQr = async (files: FileList | null) => {
    if (!files?.length || !doctor) return;
    setUploading(true);
    try {
      const [uploaded] = await uploadVoucherAttachments([files[0]], VOUCHER_PAYMENT_PROOF_CATEGORY);
      // The unique index is on lower(btrim(doctor_name)) — an expression — so
      // upsert(onConflict) cannot target it. Look up first, then update/insert.
      const { data: existing } = await (supabase as any)
        .from("doctor_payment_qr")
        .select("id")
        .ilike("doctor_name", doctor)
        .maybeSingle();
      const write = existing?.id
        ? (supabase as any)
            .from("doctor_payment_qr")
            .update({ qr_url: uploaded.fileUrl, updated_by: user?.email || null, updated_at: new Date().toISOString() })
            .eq("id", existing.id)
        : (supabase as any)
            .from("doctor_payment_qr")
            .insert({ doctor_name: doctor, qr_url: uploaded.fileUrl, updated_by: user?.email || null });
      const { error } = await write;
      if (error) throw new Error(error.message);
      queryClient.invalidateQueries({ queryKey: ["akshay-doctor-qr", doctor] });
      toast.success(`QR saved for ${doctor}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the QR");
    } finally {
      setUploading(false);
      if (qrFileRef.current) qrFileRef.current.value = "";
    }
  };

  const printCashVoucher = () => {
    if (!payments?.length || !doctor) return;
    const paidRows = services
      .filter((s) => selected.has(s.id))
      .map(
        (s) =>
          `<tr><td style="padding:6px 10px;border:1px solid #999">${s.patient_name}</td>` +
          `<td style="padding:6px 10px;border:1px solid #999">${s.purpose_reason}</td>` +
          `<td style="padding:6px 10px;border:1px solid #999;text-align:right">${rupees(Number(s.amount))}</td></tr>`,
      )
      .join("");
    // No `noopener` here — it makes window.open return null and printing dies.
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) {
      toast.error("Allow pop-ups to print.");
      return;
    }
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
    w.document.write(
      `<html><head><title>Payment Voucher - ${doctor}</title></head>` +
        `<body style="font-family:Arial,sans-serif;padding:24px;color:#111">` +
        `<div style="text-align:center;border-bottom:2px solid #111;padding-bottom:8px">` +
        `<h2 style="margin:2px 0">Payment Voucher${payments.length === 1 ? " " + payments[0].voucherNumber : ""}</h2>` +
        `<p style="margin:2px 0">${payments.map((p) => `${p.voucherNumber} (${p.companyName})`).join(" · ")}</p></div>` +
        `<table style="width:100%;margin-top:14px;font-size:14px">` +
        `<tr><td><b>Paid to:</b> ${doctor}</td><td style="text-align:right"><b>Date:</b> ${format(new Date(), "dd/MM/yyyy")}</td></tr>` +
        `<tr><td><b>Mode:</b> Cash</td><td style="text-align:right"><b>Services:</b> ${selected.size}</td></tr>` +
        `</table>` +
        `<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:14px">` +
        `<tr><th style="padding:6px 10px;border:1px solid #999;background:#eee;text-align:left">Patient</th>` +
        `<th style="padding:6px 10px;border:1px solid #999;background:#eee;text-align:left">Service</th>` +
        `<th style="padding:6px 10px;border:1px solid #999;background:#eee;text-align:right">Amount</th></tr>` +
        paidRows +
        `<tr><td colspan="2" style="padding:6px 10px;border:1px solid #999;font-weight:bold">Total paid</td>` +
        `<td style="padding:6px 10px;border:1px solid #999;text-align:right;font-weight:bold">${rupees(totalPaid)}</td></tr>` +
        `</table>` +
        `<table style="width:100%;margin-top:60px;font-size:14px"><tr>` +
        `<td>Paid by: ______________________</td>` +
        `<td style="text-align:right">Received (Dr signature): ______________________</td>` +
        `</tr></table>` +
        `<script>window.print()</` +
        `script></body></html>`,
    );
    w.document.close();
  };

  const resetAll = () => {
    setStep(1);
    setDoctor(null);
    setDoctorSearch("");
    setSelected(new Set());
    setMode(null);
    setBankAccountId("");
    setPayments(null);
    setUploadedCount(0);
  };

  // ---- Done: proof upload ----
  if (payments) {
    return (
      <FlowScaffold
        heading={`Paid ${rupees(payments.reduce((s, p) => s + Number(p.amount), 0))} to ${doctor}`}
        subheading={payments.map((p) => `${p.voucherNumber} · ${p.companyName}`).join("  ·  ")}
        actions={
          <TabletButton className="w-full" onClick={resetAll}>
            <Check className="mr-2 h-5 w-5" /> Done
          </TabletButton>
        }
      >
        <div className="space-y-4">
          {mode === "CASH" && (
            <TabletButton variant="outline" className="w-full" onClick={printCashVoucher}>
              <Printer className="mr-2 h-5 w-5" /> Print voucher for signature
            </TabletButton>
          )}
          <div>
            <TabletLabel>
              {mode === "CASH"
                ? "Upload the signed payment voucher"
                : "Upload the payment screenshot"}
            </TabletLabel>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => void uploadProof(e.target.files)}
            />
            {/* Same upload path, camera straight away: the confirmation is on
                the payment phone's screen, so Akshay photographs that screen
                with this device rather than transferring a file first. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void uploadProof(e.target.files)}
            />
            <div className="mt-2 flex gap-2">
              <TabletButton
                variant="outline"
                className="flex-1"
                disabled={uploading}
                onClick={() => cameraRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="mr-2 h-5 w-5" />
                )}
                Take a photo
              </TabletButton>
              <TabletButton
                variant="outline"
                className="flex-1"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-5 w-5" />
                {uploadedCount > 0 ? `Uploaded (${uploadedCount})` : "Choose file"}
              </TabletButton>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              The file attaches to the payment voucher and shows on its Day Book row.
            </p>
          </div>
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 1: doctor ----
  if (step === 1) {
    const visible = doctors.filter((d) =>
      d.toLowerCase().includes(doctorSearch.trim().toLowerCase()),
    );
    return (
      <FlowScaffold
        step={1}
        totalSteps={3}
        heading="Doctor Payouts"
        subheading="Whose services are being paid?"
      >
        <div className="space-y-3">
          <TabletInput
            value={doctorSearch}
            onChange={(e) => setDoctorSearch(e.target.value)}
            placeholder="Search doctor…"
            autoFocus
          />
          <div className="grid gap-2">
            {visible.map((d) => (
              <TabletCard
                key={d}
                className="flex cursor-pointer items-center gap-3 p-4 active:scale-[0.99]"
                onClick={() => {
                  setDoctor(d);
                  setSelected(new Set());
                  setStep(2);
                }}
              >
                <User className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-semibold">{d}</span>
              </TabletCard>
            ))}
            {visible.length === 0 && (
              <p className="py-4 text-center text-muted-foreground">
                No consultant matches — check the spelling, or add them in the consultant
                master.
              </p>
            )}
          </div>
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 2: the day's services ----
  if (step === 2) {
    const unpaid = services.filter((s) => !s.paid_voucher_id);
    const paid = services.filter((s) => s.paid_voucher_id);
    return (
      <FlowScaffold
        step={2}
        totalSteps={3}
        heading={doctor}
        subheading="Tick the services to pay"
        actions={
          <div className="flex w-full gap-3">
            <TabletButton variant="outline" onClick={resetAll}>
              <ChevronLeft className="mr-1 h-5 w-5" /> Back
            </TabletButton>
            {/* Approval gates payment: the total covering several patients is
                agreed by name before anyone opens the QR. Whoever is making the
                payment approves it themselves — the record still stamps who. */}
            {selected.size > 0 && !approval ? (
              <TabletButton
                className="flex-1"
                disabled={approve.isPending}
                onClick={() => approve.mutate()}
              >
                {approve.isPending ? (
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-5 w-5" />
                )}
                Approve {rupees(total)}
              </TabletButton>
            ) : (
              <TabletButton
                className="flex-1"
                disabled={selected.size === 0 || !approval}
                onClick={() => setStep(3)}
              >
                Pay {selected.size > 0 ? `${selected.size} — ${rupees(total)}` : ""}
              </TabletButton>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <TabletLabel>Day</TabletLabel>
            <TabletInput
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setSelected(new Set());
              }}
              className="max-w-[200px]"
            />
          </div>
          {selected.size > 0 && (
            <div
              className={cn(
                "rounded-md px-3 py-2 text-sm",
                approval ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900",
              )}
            >
              {approval ? (
                <>
                  {rupees(Number(approval.total_amount))} for {selected.size} service
                  {selected.size === 1 ? "" : "s"} approved by {approval.approved_by} on{" "}
                  {new Date(approval.approved_at).toLocaleString("en-IN")}.
                </>
              ) : (
                <>
                  Approve {rupees(total)} before paying — one total across the{" "}
                  {selected.size} service{selected.size === 1 ? "" : "s"} ticked below.
                </>
              )}
            </div>
          )}
          {servicesLoading ? (
            <p className="py-6 text-center text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading services…
            </p>
          ) : services.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              No services recorded for {doctor} on this day.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                {unpaid.map((s) => {
                  const isPicked = selected.has(s.id);
                  return (
                    <TabletCard
                      key={s.id}
                      className={cn(
                        "flex cursor-pointer items-center justify-between p-4 active:scale-[0.99]",
                        isPicked && "border-primary ring-2 ring-primary/30",
                      )}
                      onClick={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold">{s.patient_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.category}
                          {s.purpose_reason && s.purpose_reason !== s.category
                            ? ` · ${s.purpose_reason}`
                            : ""}
                          {s.patient_category && s.patient_category !== "Any"
                            ? ` · ${s.patient_category}`
                            : ""}
                        </span>
                      </span>
                      <span className="font-mono text-lg font-bold">{rupees(Number(s.amount))}</span>
                    </TabletCard>
                  );
                })}
              </div>
              {paid.length > 0 && (
                <div className="grid gap-2 opacity-50">
                  <TabletLabel>Already paid</TabletLabel>
                  {paid.map((s) => (
                    <TabletCard key={s.id} className="flex items-center justify-between p-4">
                      <span className="text-base">{s.patient_name}</span>
                      <span className="font-mono">{rupees(Number(s.amount))}</span>
                    </TabletCard>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 3: pay by QR or cash ----
  return (
    <FlowScaffold
      step={3}
      totalSteps={3}
      heading={`Pay ${rupees(total)} to ${doctor}`}
      subheading={`${selected.size} service(s) on ${format(new Date(`${day}T00:00:00`), "dd MMM yyyy")}`}
      actions={
        <div className="flex w-full gap-3">
          <TabletButton variant="outline" onClick={() => setStep(2)} disabled={pay.isPending}>
            <ChevronLeft className="mr-1 h-5 w-5" /> Back
          </TabletButton>
          <TabletButton
            className="flex-1"
            disabled={!mode || pay.isPending || (mode === "BANK" && !bankAccountId)}
            onClick={() => pay.mutate()}
          >
            <Check className="mr-2 h-5 w-5" />
            {pay.isPending ? "Posting voucher…" : `Confirm ${mode === "CASH" ? "cash " : mode === "QR" ? "QR " : mode === "BANK" ? "bank transfer " : ""}payment`}
          </TabletButton>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TabletButton
            variant={mode === "QR" ? "default" : "outline"}
            className="min-h-[72px]"
            onClick={() => setMode("QR")}
          >
            <QrCode className="mr-2 h-6 w-6" /> Scan QR & pay
          </TabletButton>
          <TabletButton
            variant={mode === "CASH" ? "default" : "outline"}
            className="min-h-[72px]"
            onClick={() => setMode("CASH")}
          >
            <Banknote className="mr-2 h-6 w-6" /> Paid in cash
          </TabletButton>
          <TabletButton
            variant={mode === "BANK" ? "default" : "outline"}
            className="min-h-[72px]"
            onClick={() => setMode("BANK")}
          >
            <Landmark className="mr-2 h-6 w-6" /> Bank transfer
          </TabletButton>
        </div>

        {/* Which account the money left. There was no bank-transfer option at
            all before this, so a NEFT was recorded as QR and the database
            silently credited the company's OLDEST bank ledger — Canara, when the
            money had gone from Saraswat (Dr M, 19 Aug). */}
        {mode === "BANK" && (
          <div className="rounded-xl border p-4">
            <p className="mb-2 text-sm font-medium">Paid from</p>
            {bankLedgers.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading accounts…</p>
            ) : (bankLedgers.data || []).length === 0 ? (
              <p className="text-sm text-amber-700">
                No bank account is set up for this hospital yet — ask accounts to add one.
              </p>
            ) : (
              <div className="grid gap-2">
                {(bankLedgers.data || []).map((ledger) => (
                  <TabletButton
                    key={ledger.id}
                    variant={bankAccountId === ledger.id ? "default" : "outline"}
                    className="justify-start text-left"
                    onClick={() => setBankAccountId(ledger.id)}
                  >
                    {ledger.account_name}
                    <span className="ml-2 text-xs opacity-70">{ledger.company_name}</span>
                  </TabletButton>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === "QR" && (
          <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
            {doctorQr ? (
              <>
                <img src={doctorQr} alt={`${doctor} payment QR`} className="max-h-[340px] rounded-lg" />
                <p className="text-center text-sm text-muted-foreground">
                  Scan with the hospital mobile and pay {rupees(total)}, then confirm below.
                </p>
              </>
            ) : (
              <>
                <p className="text-center text-muted-foreground">
                  No QR saved for {doctor} yet — upload a photo of their payment QR once and it
                  stays linked to their ledger.
                </p>
                <input
                  ref={qrFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void saveDoctorQr(e.target.files)}
                />
                <TabletButton
                  variant="outline"
                  disabled={uploading}
                  onClick={() => qrFileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-5 w-5" />
                  )}
                  Upload {doctor}'s QR
                </TabletButton>
              </>
            )}
          </div>
        )}

        {mode === "CASH" && (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            After confirming, print the payment voucher, take the doctor's signature, and upload
            the signed copy — it attaches to the voucher.
          </p>
        )}
      </div>
    </FlowScaffold>
  );
}
