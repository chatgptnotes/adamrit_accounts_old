import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeIndianRupee,
  Download,
  FileImage,
  FileText,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Printer,
  RefreshCw,
  Save,
  Search,
  WalletCards,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { uploadPatientDocs } from "@/tablet/hooks/usePatientDocs";
import { inr } from "@/tablet/lib/format";

const PAYMENT_MODES = ["Cash", "UPI", "Card", "Cheque", "NEFT", "RTGS"] as const;
const EXTRA_PACKAGE_STATUS = "VASOOLI_EXTRA_PACKAGE";
const CORRECTION_COMMENT_STATUS = "VASOOLI_CORRECTION_COMMENT";

type PaymentMode = (typeof PAYMENT_MODES)[number];
type PaymentStatus = "pending" | "partial" | "paid";
type LedgerKind = "payment" | "extra" | "comment";

type PaymentLedgerRow = {
  id: string;
  kind: LedgerKind;
  amount: number;
  mode: string;
  date: string | null;
  bankName: string;
  referenceNumber: string;
  receivedBy: string;
  remarks: string;
  proofName: string;
  isRefund: boolean;
};

type CollectionRow = {
  visitUuid: string;
  visitId: string;
  patientUuid: string | null;
  patientName: string;
  uhid: string;
  registrationId: string;
  mobile: string;
  doctorName: string;
  schemeName: string;
  totalApprovedAmount: number;
  extraPackageAmount: number;
  totalReceivedAmount: number;
  balancePending: number;
  paymentStatus: PaymentStatus;
  lastPaymentDate: string | null;
  admissionDate: string | null;
  billNo: string;
  packageName: string;
  packageCode: string;
  ledger: PaymentLedgerRow[];
};

type PaymentForm = {
  collectionDate: string;
  amount: string;
  mode: PaymentMode;
  bankName: string;
  referenceNumber: string;
  receivedBy: string;
  remarks: string;
  proofFile: File | null;
};

const todayInput = () => new Date().toISOString().slice(0, 10);

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const receiptNo = (id: string) => `VAS-${String(id || "").slice(-8).toUpperCase() || "NEW"}`;

const chunk = <T,>(items: T[], size = 350): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

async function fetchAllPages(table: string, select: string, buildQuery?: (query: any) => any) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table as any).select(select).range(from, from + 999);
    if (buildQuery) query = buildQuery(query);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function fetchByValues(table: string, select: string, column: string, values: string[]) {
  const uniqueValues = [...new Set(values.filter(Boolean))];
  if (uniqueValues.length === 0) return [];

  const results = await Promise.all(
    chunk(uniqueValues).map(async (part) => {
      const { data, error } = await supabase
        .from(table as any)
        .select(select)
        .in(column, part);
      if (error) throw error;
      return data || [];
    }),
  );

  return results.flat();
}

function isAdmittedVisit(visit: any) {
  const patientType = normalize(visit?.patient_type);
  const admittedType =
    patientType.includes("ipd") ||
    patientType.includes("inpatient") ||
    patientType.includes("emergency") ||
    patientType.includes("admitted");
  return Boolean(!visit?.discharge_date && (visit?.admission_date || visit?.visit_date) && admittedType);
}

function isYojanaVisit(visit: any, patient: any, billPrep: any) {
  const text = [
    visit?.corporate,
    visit?.insurance_type,
    visit?.package_name,
    visit?.package_code,
    visit?.yojana_registration_id,
    visit?.thumb_registration_no,
    patient?.corporate,
    patient?.ayushman_id,
    billPrep?.corporate,
  ].join(" ");
  const hasSchemeText = /(yojana|pmjay|mjp|mjpjay|ayushman|mahatma|jyotirao|phule|jan arogya)/i.test(text);
  const hasPackageData =
    Boolean(visit?.yojana_registration_id || visit?.thumb_registration_no || patient?.ayushman_id) ||
    Boolean(visit?.package_name || visit?.package_code) ||
    toNumber(visit?.package_amount) > 0 ||
    toNumber(billPrep?.expected_amount) > 0;
  return hasSchemeText || hasPackageData;
}

function parseExtraPackage(row: any) {
  const fromReference = toNumber(row?.reference_number);
  if (fromReference > 0) return fromReference;
  const match = String(row?.remarks || "").match(/extra_package_amount=([0-9.]+)/i);
  return match ? toNumber(match[1]) : 0;
}

function parseProofName(remarks: string) {
  const match = remarks.match(/payment_proof=([^;]+)/i);
  return match?.[1]?.trim() || "";
}

function cleanRemarks(remarks: string) {
  return remarks.replace(/;?\s*payment_proof=[^;]+/i, "").trim();
}

function getPaymentStatus(extraPackageAmount: number, totalReceivedAmount: number): PaymentStatus {
  if (extraPackageAmount > 0 && totalReceivedAmount <= 0) return "pending";
  if (extraPackageAmount > 0 && totalReceivedAmount < extraPackageAmount) return "partial";
  return "paid";
}

const statusMeta = (status: PaymentStatus) => {
  switch (status) {
    case "paid":
      return {
        label: "Fully Paid",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "partial":
      return {
        label: "Partially Paid",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    default:
      return {
        label: "Pending",
        className: "border-red-200 bg-red-50 text-red-700",
      };
  }
};

async function loadCollectionRows(hospitalName: string): Promise<CollectionRow[]> {
  const visits = await fetchAllPages(
    "visits",
    [
      "id",
      "visit_id",
      "patient_id",
      "visit_date",
      "admission_date",
      "discharge_date",
      "appointment_with",
      "yojana_registration_id",
      "thumb_registration_no",
      "package_amount",
      "package_name",
      "package_code",
      "insurance_type",
      "corporate",
      "patient_type",
      "created_at",
      "patients!inner(id, name, patients_id, phone, corporate, hospital_name, ayushman_id, registration_id)",
    ].join(", "),
    (query) =>
      query
        .eq("patients.hospital_name", hospitalName)
        .order("created_at", { ascending: false }),
  );

  const visitIds = visits.map((visit) => String(visit.visit_id || "")).filter(Boolean);
  const visitUuids = visits.map((visit) => String(visit.id || "")).filter(Boolean);
  const visitKeys = [...visitIds, ...visitUuids];
  const patientIds = visits.map((visit) => String(visit.patient_id || "")).filter(Boolean);

  const [bills, visitAdvances, patientAdvances, billPrepRows] = await Promise.all([
    fetchByValues(
      "bills",
      "id, patient_id, visit_id, bill_no, bill_number, total_amount, status, date, category, created_at",
      "visit_id",
      visitKeys,
    ),
    fetchByValues(
      "advance_payment",
      "id, patient_id, visit_id, patient_name, bill_no, patients_id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, bank_account_name, reference_number, billing_executive, remarks, status, created_at",
      "visit_id",
      visitKeys,
    ),
    fetchByValues(
      "advance_payment",
      "id, patient_id, visit_id, patient_name, bill_no, patients_id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, bank_account_name, reference_number, billing_executive, remarks, status, created_at",
      "patient_id",
      patientIds,
    ),
    fetchByValues(
      "bill_preparation",
      "id, visit_id, bill_amount, expected_amount, received_amount, received_date, corporate, intimation_date",
      "visit_id",
      visitIds,
    ),
  ]);

  const billsByVisit = new Map<string, any>();
  for (const bill of bills) {
    const key = String(bill.visit_id || "");
    if (!key || billsByVisit.has(key)) continue;
    billsByVisit.set(key, bill);
  }

  const billPrepByVisit = new Map<string, any>();
  for (const row of billPrepRows) {
    if (row.visit_id && !billPrepByVisit.has(row.visit_id)) {
      billPrepByVisit.set(row.visit_id, row);
    }
  }

  const allAdvances = new Map<string, any>();
  for (const payment of [...visitAdvances, ...patientAdvances]) {
    if (payment?.id) allAdvances.set(payment.id, payment);
  }

  const rows: CollectionRow[] = [];

  for (const visit of visits) {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    const billPrep = billPrepByVisit.get(String(visit.visit_id || ""));
    if (!isAdmittedVisit(visit) || !isYojanaVisit(visit, patient, billPrep)) continue;

    const bill = billsByVisit.get(String(visit.visit_id || "")) || billsByVisit.get(String(visit.id || ""));
    const visitPaymentKeys = new Set([String(visit.visit_id || ""), String(visit.id || "")].filter(Boolean));
    const patientId = String(visit.patient_id || "");

    const ledger: PaymentLedgerRow[] = [...allAdvances.values()]
      .filter((payment) => {
        const paymentVisitId = String(payment.visit_id || "");
        if (paymentVisitId) return visitPaymentKeys.has(paymentVisitId);
        return patientId && String(payment.patient_id || "") === patientId;
      })
      .map((payment) => {
        const remarks = String(payment.remarks || "");
        const status = String(payment.status || "");
        const isExtra = status === EXTRA_PACKAGE_STATUS;
        const isComment = status === CORRECTION_COMMENT_STATUS;
        const kind: LedgerKind = isExtra ? "extra" : isComment ? "comment" : "payment";
        const amount = toNumber(payment.advance_amount);
        const refund = Boolean(payment.is_refund);
        return {
          id: payment.id,
          kind,
          amount: refund ? -Math.abs(amount) : amount,
          mode: payment.payment_mode || "-",
          date: payment.payment_date || payment.created_at || null,
          bankName: payment.bank_account_name || "-",
          referenceNumber: payment.reference_number || "-",
          receivedBy: payment.billing_executive || "-",
          remarks: cleanRemarks(remarks),
          proofName: parseProofName(remarks),
          isRefund: refund,
        };
      })
      .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());

    const latestExtra = ledger.find((entry) => entry.kind === "extra");
    const extraPackageAmount = latestExtra ? parseExtraPackage({
      reference_number: latestExtra.referenceNumber,
      remarks: latestExtra.remarks,
    }) : 0;
    const paymentRows = ledger.filter((entry) => entry.kind === "payment");
    const totalReceivedAmount = paymentRows.reduce((sum, payment) => sum + payment.amount, 0);
    const balancePending = Math.max(extraPackageAmount - totalReceivedAmount, 0);
    const totalApprovedAmount =
      toNumber(visit.package_amount) ||
      toNumber(billPrep?.expected_amount) ||
      toNumber(bill?.total_amount) ||
      toNumber(billPrep?.bill_amount);
    const lastPayment = paymentRows[0];

    rows.push({
      visitUuid: visit.id,
      visitId: visit.visit_id || visit.id,
      patientUuid: visit.patient_id || patient?.id || null,
      patientName: patient?.name || "Unknown",
      uhid: patient?.patients_id || patient?.registration_id || "-",
      registrationId: visit.yojana_registration_id || visit.thumb_registration_no || patient?.ayushman_id || "-",
      mobile: patient?.phone || "-",
      doctorName: visit.appointment_with || "-",
      schemeName: visit.corporate || visit.insurance_type || billPrep?.corporate || patient?.corporate || "Yojana",
      totalApprovedAmount,
      extraPackageAmount,
      totalReceivedAmount,
      balancePending,
      paymentStatus: getPaymentStatus(extraPackageAmount, totalReceivedAmount),
      lastPaymentDate: lastPayment?.date || null,
      admissionDate: visit.admission_date || visit.visit_date || null,
      billNo: bill?.bill_no || bill?.bill_number || "-",
      packageName: visit.package_name || "-",
      packageCode: visit.package_code || "-",
      ledger,
    });
  }

  return rows.sort((left, right) => {
    const statusOrder = { pending: 0, partial: 1, paid: 2 };
    if (statusOrder[left.paymentStatus] !== statusOrder[right.paymentStatus]) {
      return statusOrder[left.paymentStatus] - statusOrder[right.paymentStatus];
    }
    return right.balancePending - left.balancePending;
  });
}

export default function PaymentCollectionGauravFlow() {
  const { hospitalConfig } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedVisitUuid, setSelectedVisitUuid] = useState<string | null>(null);

  const collection = useQuery({
    queryKey: ["tablet-payment-collection-gaurav", hospitalConfig.name],
    queryFn: () => loadCollectionRows(hospitalConfig.name),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const rows = collection.data || [];
  const filteredRows = useMemo(() => {
    const term = normalize(search);
    if (!term) return rows;
    return rows.filter((row) =>
      [row.patientName, row.mobile].some((value) => normalize(value).includes(term)),
    );
  }, [rows, search]);

  const selected = useMemo(() => {
    const fallback = filteredRows[0] || rows[0] || null;
    return rows.find((row) => row.visitUuid === selectedVisitUuid) || fallback;
  }, [filteredRows, rows, selectedVisitUuid]);

  const totals = useMemo(() => ({
    patients: filteredRows.length,
    approved: filteredRows.reduce((sum, row) => sum + row.totalApprovedAmount, 0),
    extra: filteredRows.reduce((sum, row) => sum + row.extraPackageAmount, 0),
    received: filteredRows.reduce((sum, row) => sum + row.totalReceivedAmount, 0),
    pending: filteredRows.reduce((sum, row) => sum + row.balancePending, 0),
  }), [filteredRows]);

  return (
    <FlowScaffold
      heading="Payment Collection (Vasooli) - Gaurav"
      subheading="Admitted Yojana patients, patient-wise collections, proof uploads, and audit notes"
      actions={
        <TabletButton
          variant="outline"
          className="flex-1"
          onClick={() => collection.refetch()}
          disabled={collection.isFetching}
        >
          <RefreshCw className={cn("mr-2 h-5 w-5", collection.isFetching && "animate-spin")} />
          Refresh
        </TabletButton>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Patients" value={String(totals.patients)} tone="slate" />
          <Metric label="Approved" value={inr(totals.approved)} tone="blue" />
          <Metric label="Extra Package" value={inr(totals.extra)} tone="amber" />
          <Metric label="Received" value={inr(totals.received)} tone="emerald" />
          <Metric label="Pending" value={inr(totals.pending)} tone="red" />
        </div>

        {collection.isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border bg-card">
            <Loader2 className="mr-3 h-6 w-6 animate-spin" />
            Loading admitted Yojana patients
          </div>
        ) : collection.isError ? (
          <TabletCard className="border-red-200 bg-red-50 text-red-700">
            {(collection.error as Error)?.message || "Unable to load payment collection data."}
          </TabletCard>
        ) : rows.length === 0 ? (
          <TabletCard className="py-10 text-center text-muted-foreground">
            No admitted Yojana patients were found.
          </TabletCard>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
            <TabletCard variant="flat" className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Search Patient
                </span>
                <span className="flex h-13 min-h-[52px] items-center gap-2 rounded-xl border bg-background px-3">
                  <Search className="h-5 w-5 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Patient name or mobile number"
                    className="min-w-0 flex-1 bg-transparent text-base outline-none"
                  />
                </span>
              </label>

              <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
                {filteredRows.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No patient matches this search.
                  </p>
                ) : (
                  filteredRows.map((row) => (
                    <PatientListItem
                      key={row.visitUuid}
                      row={row}
                      selected={selected?.visitUuid === row.visitUuid}
                      onSelect={() => setSelectedVisitUuid(row.visitUuid)}
                    />
                  ))
                )}
              </div>
            </TabletCard>

            {selected && (
              <PatientCollectionDetail
                key={selected.visitUuid}
                row={selected}
                onBack={() => setSelectedVisitUuid(null)}
              />
            )}
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}

function PatientCollectionDetail({ row, onBack }: { row: CollectionRow; onBack: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [extraAmount, setExtraAmount] = useState(row.extraPackageAmount ? String(row.extraPackageAmount) : "");
  const [payment, setPayment] = useState<PaymentForm>({
    collectionDate: todayInput(),
    amount: "",
    mode: "Cash",
    bankName: "",
    referenceNumber: "",
    receivedBy: user?.username || "",
    remarks: "",
    proofFile: null,
  });
  const [correctionComment, setCorrectionComment] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tablet-payment-collection-gaurav"] });
  };

  const saveExtra = useMutation({
    mutationFn: async () => {
      const value = Number(extraAmount);
      if (!row.patientUuid) throw new Error("Patient is not linked to this visit.");
      if (!Number.isFinite(value) || value < 0) throw new Error("Enter a valid extra package amount.");

      const { error } = await supabase.from("advance_payment").insert({
        patient_id: row.patientUuid,
        visit_id: row.visitId,
        patient_name: row.patientName,
        bill_no: row.billNo !== "-" ? row.billNo : null,
        patients_id: row.uhid !== "-" ? row.uhid : null,
        date_of_admission: row.admissionDate,
        advance_amount: 0,
        returned_amount: 0,
        is_refund: false,
        payment_date: new Date().toISOString(),
        payment_mode: "SYSTEM",
        reference_number: String(value),
        billing_executive: user?.username || null,
        remarks: `extra_package_amount=${value}`,
        status: EXTRA_PACKAGE_STATUS,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Extra package amount saved.");
      await refresh();
    },
    onError: (error) => {
      toast.error((error as Error)?.message || "Extra package amount could not be saved.");
    },
  });

  const collectPayment = useMutation({
    mutationFn: async () => {
      const value = Number(payment.amount);
      if (!row.patientUuid) throw new Error("Patient is not linked to this visit.");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid collected amount.");

      let proofRemark = "";
      if (payment.proofFile) {
        await uploadPatientDocs([payment.proofFile], {
          patientId: row.patientUuid,
          patientName: row.patientName,
          category: "payment_proof",
          uploadedBy: user?.id ?? null,
          placeLabel: "Payment Collection (Vasooli)",
        });
        proofRemark = `; payment_proof=${payment.proofFile.name}`;
      }

      const paymentDate = payment.collectionDate
        ? new Date(`${payment.collectionDate}T12:00:00`).toISOString()
        : new Date().toISOString();
      const remarks = `${payment.remarks.trim() || "Payment collected from Vasooli Gaurav tablet tile"}${proofRemark}`;

      const { error } = await supabase.from("advance_payment").insert({
        patient_id: row.patientUuid,
        visit_id: row.visitId,
        patient_name: row.patientName,
        bill_no: row.billNo !== "-" ? row.billNo : null,
        patients_id: row.uhid !== "-" ? row.uhid : null,
        date_of_admission: row.admissionDate,
        advance_amount: value,
        returned_amount: 0,
        is_refund: false,
        payment_date: paymentDate,
        payment_mode: payment.mode,
        bank_account_name: payment.bankName.trim() || null,
        reference_number: payment.referenceNumber.trim() || null,
        billing_executive: payment.receivedBy.trim() || user?.username || null,
        remarks,
        status: "ACTIVE",
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Payment collected successfully.");
      setPayment({
        collectionDate: todayInput(),
        amount: "",
        mode: "Cash",
        bankName: "",
        referenceNumber: "",
        receivedBy: user?.username || "",
        remarks: "",
        proofFile: null,
      });
      await refresh();
    },
    onError: (error) => {
      toast.error((error as Error)?.message || "Payment could not be collected.");
    },
  });

  const addCorrection = useMutation({
    mutationFn: async () => {
      if (!row.patientUuid) throw new Error("Patient is not linked to this visit.");
      const note = correctionComment.trim();
      if (!note) throw new Error("Enter the correction comment first.");

      const { error } = await supabase.from("advance_payment").insert({
        patient_id: row.patientUuid,
        visit_id: row.visitId,
        patient_name: row.patientName,
        bill_no: row.billNo !== "-" ? row.billNo : null,
        patients_id: row.uhid !== "-" ? row.uhid : null,
        date_of_admission: row.admissionDate,
        advance_amount: 0,
        returned_amount: 0,
        is_refund: false,
        payment_date: new Date().toISOString(),
        payment_mode: "COMMENT",
        billing_executive: user?.username || null,
        remarks: note,
        status: CORRECTION_COMMENT_STATUS,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Correction comment saved.");
      setCorrectionComment("");
      await refresh();
    },
    onError: (error) => {
      toast.error((error as Error)?.message || "Correction comment could not be saved.");
    },
  });

  const meta = statusMeta(row.paymentStatus);

  return (
    <div className="space-y-4">
      <TabletCard variant="flat" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold tracking-normal">{row.patientName}</h2>
              <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", meta.className)}>
                {meta.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {row.uhid} · {row.mobile} · {row.registrationId}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98] xl:hidden"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => window.open(`/detailed-invoice/${row.visitId}`, "_blank", "noopener,noreferrer")}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
            >
              <Download className="mr-2 h-4 w-4" />
              Invoice
            </button>
            <button
              type="button"
              onClick={() => navigate(`/final-bill/${row.visitId}`)}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
            >
              <FileText className="mr-2 h-4 w-4" />
              Final Bill
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Info label="Scheme" value={row.schemeName} />
          <Info label="Doctor" value={row.doctorName} />
          <Info label="Package Code" value={row.packageCode} />
          <Info label="Package Name" value={row.packageName} />
        </div>
      </TabletCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total Approved" value={inr(row.totalApprovedAmount)} tone="blue" />
        <Metric label="Extra Package" value={inr(row.extraPackageAmount)} tone="amber" />
        <Metric label="Patient Received" value={inr(row.totalReceivedAmount)} tone="emerald" />
        <Metric label="Balance Pending" value={inr(row.balancePending)} tone="red" />
      </div>

      <TabletCard variant="flat" className="space-y-3">
        <div className="flex items-center gap-2">
          <Pencil className="h-5 w-5 text-amber-600" />
          <h3 className="text-lg font-bold">Extra Package Amount</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <AmountInput
            label="Amount to be paid by patient"
            value={extraAmount}
            onChange={setExtraAmount}
            placeholder="0"
          />
          <TabletButton
            className="self-end"
            onClick={() => saveExtra.mutate()}
            disabled={saveExtra.isPending}
          >
            {saveExtra.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            Save Amount
          </TabletButton>
        </div>
      </TabletCard>

      <TabletCard variant="flat" className="space-y-4">
        <div className="flex items-center gap-2">
          <WalletCards className="h-5 w-5 text-emerald-600" />
          <h3 className="text-lg font-bold">Collect Payment</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DateInput
            label="Collection Date"
            value={payment.collectionDate}
            onChange={(value) => setPayment((current) => ({ ...current, collectionDate: value }))}
          />
          <AmountInput
            label="Amount Collected"
            value={payment.amount}
            onChange={(value) => setPayment((current) => ({ ...current, amount: value }))}
            placeholder="0"
          />
          <FilterSelect
            label="Payment Mode"
            value={payment.mode}
            onChange={(value) => setPayment((current) => ({ ...current, mode: value as PaymentMode }))}
            options={PAYMENT_MODES.map((mode) => [mode, mode])}
          />
          <TextInput
            label="Bank Name"
            value={payment.bankName}
            onChange={(value) => setPayment((current) => ({ ...current, bankName: value }))}
            placeholder="Required for bank modes"
          />
          <TextInput
            label="Transaction / UPI Ref No."
            value={payment.referenceNumber}
            onChange={(value) => setPayment((current) => ({ ...current, referenceNumber: value }))}
            placeholder="Reference number"
          />
          <TextInput
            label="Received By"
            value={payment.receivedBy}
            onChange={(value) => setPayment((current) => ({ ...current, receivedBy: value }))}
            placeholder="Accountant name"
          />
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remarks</span>
          <textarea
            value={payment.remarks}
            onChange={(event) => setPayment((current) => ({ ...current, remarks: event.target.value }))}
            rows={3}
            className="w-full resize-none rounded-xl border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring"
            placeholder="Optional collection note"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-semibold transition-all active:scale-[0.98]">
            <FileImage className="h-5 w-5" />
            Upload Proof Screenshot
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPayment((current) => ({ ...current, proofFile: event.target.files?.[0] || null }))
              }
            />
          </label>
          {payment.proofFile && (
            <span className="max-w-full truncate rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
              {payment.proofFile.name}
            </span>
          )}
          <TabletButton
            className="ml-auto"
            onClick={() => collectPayment.mutate()}
            disabled={collectPayment.isPending || Number(payment.amount) <= 0}
          >
            {collectPayment.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <BadgeIndianRupee className="mr-2 h-5 w-5" />}
            Save Collection
          </TabletButton>
        </div>
      </TabletCard>

      <TabletCard variant="flat" className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-5 w-5 text-slate-600" />
          <h3 className="text-lg font-bold">Correction Comment</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <textarea
            value={correctionComment}
            onChange={(event) => setCorrectionComment(event.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring"
            placeholder="Write correction note. Existing payment amount rows remain unchanged."
          />
          <TabletButton
            className="self-end"
            variant="outline"
            onClick={() => addCorrection.mutate()}
            disabled={addCorrection.isPending || !correctionComment.trim()}
          >
            {addCorrection.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            Save Note
          </TabletButton>
        </div>
      </TabletCard>

      <PaymentHistory row={row} />
    </div>
  );
}

function PaymentHistory({ row }: { row: CollectionRow }) {
  return (
    <TabletCard variant="flat">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">Payment Collection History</h3>
        <span className="text-sm text-muted-foreground">{row.ledger.length} audit rows</span>
      </div>
      {row.ledger.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">No payment or audit entry has been recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-left text-sm">
            <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th className="text-right">Amount</Th>
                <Th>Mode</Th>
                <Th>Bank</Th>
                <Th>Reference</Th>
                <Th>Received By</Th>
                <Th>Remarks / Proof</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {row.ledger.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <Td>{formatDate(entry.date)}</Td>
                  <Td>
                    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", ledgerKindClass(entry.kind))}>
                      {entry.kind === "payment" ? "Payment" : entry.kind === "extra" ? "Extra Amount" : "Correction Note"}
                    </span>
                  </Td>
                  <Td className="text-right font-bold">
                    {entry.kind === "payment" ? inr(entry.amount) : "-"}
                  </Td>
                  <Td>{entry.mode}</Td>
                  <Td>{entry.bankName}</Td>
                  <Td>{entry.referenceNumber}</Td>
                  <Td>{entry.receivedBy}</Td>
                  <Td>
                    <p className="max-w-[260px] whitespace-pre-wrap text-foreground">{entry.remarks || "-"}</p>
                    {entry.proofName && (
                      <p className="mt-1 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        <FileImage className="mr-1 h-3.5 w-3.5" />
                        {entry.proofName}
                      </p>
                    )}
                  </Td>
                  <Td>
                    {entry.kind === "payment" ? (
                      <button
                        type="button"
                        onClick={() => printReceipt(row, entry)}
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
                      >
                        <Printer className="h-4 w-4" />
                        Print
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Audit only</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TabletCard>
  );
}

function PatientListItem({
  row,
  selected,
  onSelect,
}: {
  row: CollectionRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = statusMeta(row.paymentStatus);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full rounded-xl border p-3 text-left transition-all active:scale-[0.99]",
        selected ? "border-slate-900 bg-slate-50 shadow-sm" : "bg-background hover:bg-muted/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{row.patientName}</p>
          <p className="text-sm text-muted-foreground">{row.mobile}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", meta.className)}>
          {meta.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Info label="Extra" value={inr(row.extraPackageAmount)} />
        <Info label="Pending" value={inr(row.balancePending)} />
      </div>
    </button>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "blue" | "emerald" | "red" | "amber";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div className={cn("rounded-xl border p-4", tones[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-normal">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold text-foreground">{value || "-"}</p>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function AmountInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ""))}
        placeholder={placeholder}
        className="h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cn("px-3 py-3 font-semibold", className)}>{children}</th>;
}

function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("px-3 py-3", className)}>{children}</td>;
}

function ledgerKindClass(kind: LedgerKind) {
  if (kind === "payment") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (kind === "extra") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function printReceipt(row: CollectionRow, payment: PaymentLedgerRow) {
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char] || char));

  const html = `
    <html>
      <head>
        <title>Receipt ${escape(receiptNo(payment.id))}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #111827; }
          .receipt { max-width: 760px; margin: 0 auto; border: 1px solid #111827; padding: 24px; }
          .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #111827; padding-bottom: 16px; }
          h1 { margin: 0; font-size: 22px; }
          h2 { margin: 20px 0 8px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          td { padding: 8px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          td:first-child { width: 190px; color: #6b7280; }
          .amount { font-size: 28px; font-weight: 700; margin-top: 18px; }
          .sign { display: flex; justify-content: space-between; margin-top: 72px; }
          .line { width: 220px; border-top: 1px solid #111827; padding-top: 8px; text-align: center; }
          .print { margin-bottom: 16px; text-align: right; }
          button { min-height: 36px; padding: 0 14px; border: 1px solid #111827; background: white; cursor: pointer; }
          @media print { .print { display: none; } body { padding: 0; } .receipt { border: none; } }
        </style>
      </head>
      <body>
        <div class="print"><button onclick="window.print()">Print</button></div>
        <div class="receipt">
          <div class="top">
            <div>
              <h1>Payment Receipt</h1>
              <p>Hope Multi-Specialty Hospital</p>
            </div>
            <div>
              <strong>${escape(receiptNo(payment.id))}</strong><br />
              ${escape(formatDate(payment.date))}
            </div>
          </div>
          <h2>Received From</h2>
          <table>
            <tr><td>Patient Name</td><td><strong>${escape(row.patientName)}</strong></td></tr>
            <tr><td>UHID</td><td>${escape(row.uhid)}</td></tr>
            <tr><td>Registration ID</td><td>${escape(row.registrationId)}</td></tr>
            <tr><td>Scheme</td><td>${escape(row.schemeName)}</td></tr>
            <tr><td>Payment Mode</td><td>${escape(payment.mode)}</td></tr>
            <tr><td>Bank Name</td><td>${escape(payment.bankName)}</td></tr>
            <tr><td>Reference Number</td><td>${escape(payment.referenceNumber)}</td></tr>
            <tr><td>Received By</td><td>${escape(payment.receivedBy)}</td></tr>
            <tr><td>Remarks</td><td>${escape(payment.remarks || "-")}</td></tr>
            <tr><td>Proof Screenshot</td><td>${escape(payment.proofName || "-")}</td></tr>
          </table>
          <div class="amount">${escape(inr(payment.amount))}</div>
          <div class="sign">
            <div class="line">Patient / Relative</div>
            <div class="line">Authorised Signatory</div>
          </div>
        </div>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("Popup blocked. Please allow popups to print receipt.");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();
}
