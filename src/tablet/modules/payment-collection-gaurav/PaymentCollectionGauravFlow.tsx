import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Printer,
  ReceiptText,
  RefreshCw,
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
import { TabletNumpad } from "@/tablet/components/TabletNumpad";
import { inr } from "@/tablet/lib/format";

const PAYMENT_MODES = ["CASH", "UPI", "CARD", "CHEQUE", "NEFT", "RTGS", "CREDIT"] as const;
const STATUS_OPTIONS = ["all", "pending", "partial", "paid", "covered"] as const;
const TYPE_OPTIONS = ["all", "cash", "yojana"] as const;

type PaymentMode = (typeof PAYMENT_MODES)[number];
type PaymentStatus = (typeof STATUS_OPTIONS)[number];
type PaymentType = (typeof TYPE_OPTIONS)[number];

type PaymentHistoryRow = {
  id: string;
  source: "Advance" | "Final";
  amount: number;
  mode: string;
  date: string | null;
  receiptNumber: string;
  remarks: string;
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
  yojanaName: string;
  paymentType: Exclude<PaymentType, "all">;
  totalBillAmount: number;
  yojanaApprovedAmount: number;
  patientPayableAmount: number;
  patientPaidAmount: number;
  pendingAmount: number;
  lastPaymentDate: string | null;
  lastPaymentAmount: number;
  paymentStatus: Exclude<PaymentStatus, "all">;
  billNo: string;
  billStatus: string;
  billDate: string | null;
  admissionDate: string | null;
  dischargeDate: string | null;
  packageName: string;
  packageCode: string;
  history: PaymentHistoryRow[];
};

type Filters = {
  search: string;
  status: PaymentStatus;
  type: PaymentType;
  doctor: string;
  dateFrom: string;
  dateTo: string;
};

const toNumber = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalize = (value: unknown) => String(value || "").trim().toLowerCase();

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

const receiptNo = (id: string, source: string) =>
  `${source === "Final" ? "FP" : "ADV"}-${String(id || "").slice(-8).toUpperCase() || "NEW"}`;

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

const isCoveragePatient = (visit: any, patient: any, bill: any) => {
  const text = [
    visit?.corporate,
    visit?.insurance_type,
    visit?.package_name,
    visit?.yojana_registration_id,
    visit?.thumb_registration_no,
    patient?.corporate,
    patient?.ayushman_id,
    bill?.category,
  ].join(" ");

  return /(yojana|pmjay|mjp|ayushman|insurance|esic|cghs|corporate|panel)/i.test(text);
};

const statusMeta = (status: CollectionRow["paymentStatus"]) => {
  switch (status) {
    case "paid":
      return {
        label: "Paid",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      };
    case "partial":
      return {
        label: "Partial Paid",
        className: "border-amber-200 bg-amber-50 text-amber-700",
      };
    case "covered":
      return {
        label: "Fully Covered by Yojana",
        className: "border-blue-200 bg-blue-50 text-blue-700",
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

  const [bills, visitAdvances, patientAdvances, finalPayments, billPrepRows] = await Promise.all([
    fetchByValues(
      "bills",
      "id, patient_id, visit_id, bill_no, bill_number, total_amount, status, date, category, created_at",
      "visit_id",
      visitKeys,
    ),
    fetchByValues(
      "advance_payment",
      "id, patient_id, visit_id, patient_name, bill_no, patients_id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, reference_number, remarks, status, created_at",
      "visit_id",
      visitKeys,
    ),
    fetchByValues(
      "advance_payment",
      "id, patient_id, visit_id, patient_name, bill_no, patients_id, advance_amount, returned_amount, is_refund, payment_date, payment_mode, reference_number, remarks, status, created_at",
      "patient_id",
      patientIds,
    ),
    fetchByValues(
      "final_payments",
      "id, visit_id, patient_id, amount, mode_of_payment, payment_remark, payment_date, created_at",
      "visit_id",
      visitIds,
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

  const rows = visits.map((visit) => {
    const patient = Array.isArray(visit.patients) ? visit.patients[0] : visit.patients;
    const bill = billsByVisit.get(String(visit.visit_id || "")) || billsByVisit.get(String(visit.id || ""));
    const billPrep = billPrepByVisit.get(String(visit.visit_id || ""));
    const visitPaymentKeys = new Set([String(visit.visit_id || ""), String(visit.id || "")].filter(Boolean));
    const patientId = String(visit.patient_id || "");

    const advanceHistory: PaymentHistoryRow[] = [...allAdvances.values()]
      .filter((payment) => {
        const paymentVisitId = String(payment.visit_id || "");
        if (paymentVisitId) return visitPaymentKeys.has(paymentVisitId);
        return patientId && String(payment.patient_id || "") === patientId;
      })
      .map((payment) => {
        const amount = toNumber(payment.advance_amount);
        const refund = Boolean(payment.is_refund);
        return {
          id: payment.id,
          source: "Advance" as const,
          amount: refund ? -Math.abs(amount) : amount,
          mode: payment.payment_mode || "-",
          date: payment.payment_date || payment.created_at || null,
          receiptNumber: receiptNo(payment.id, "Advance"),
          remarks: payment.remarks || payment.reference_number || "",
          isRefund: refund,
        };
      });

    const finalHistory: PaymentHistoryRow[] = finalPayments
      .filter((payment: any) => String(payment.visit_id || "") === String(visit.visit_id || ""))
      .map((payment: any) => ({
        id: payment.id,
        source: "Final" as const,
        amount: toNumber(payment.amount),
        mode: payment.mode_of_payment || "-",
        date: payment.payment_date || payment.created_at || null,
        receiptNumber: receiptNo(payment.id, "Final"),
        remarks: payment.payment_remark || "",
        isRefund: false,
      }));

    const history = [...advanceHistory, ...finalHistory].sort(
      (left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime(),
    );

    const totalBillAmount = toNumber(bill?.total_amount) || toNumber(billPrep?.bill_amount);
    const coveragePatient = isCoveragePatient(visit, patient, bill);
    const yojanaApprovedAmount = coveragePatient
      ? toNumber(visit.package_amount) || toNumber(billPrep?.expected_amount)
      : 0;
    const patientPayableAmount = coveragePatient && yojanaApprovedAmount > 0
      ? Math.max(totalBillAmount - yojanaApprovedAmount, 0)
      : totalBillAmount;
    const patientPaidAmount = history.reduce((sum, payment) => sum + payment.amount, 0);
    const pendingAmount = Math.max(patientPayableAmount - patientPaidAmount, 0);
    const lastPayment = history[0];
    const paymentStatus: CollectionRow["paymentStatus"] =
      coveragePatient && patientPayableAmount <= 0 && totalBillAmount > 0
        ? "covered"
        : pendingAmount <= 0 && patientPayableAmount > 0
          ? "paid"
          : patientPaidAmount > 0
            ? "partial"
            : "pending";

    return {
      visitUuid: visit.id,
      visitId: visit.visit_id || visit.id,
      patientUuid: visit.patient_id || patient?.id || null,
      patientName: patient?.name || "Unknown",
      uhid: patient?.patients_id || patient?.registration_id || "-",
      registrationId: visit.yojana_registration_id || visit.thumb_registration_no || patient?.ayushman_id || "-",
      mobile: patient?.phone || "-",
      doctorName: visit.appointment_with || "-",
      yojanaName: visit.corporate || visit.insurance_type || patient?.corporate || bill?.category || "-",
      paymentType: coveragePatient ? "yojana" : "cash",
      totalBillAmount,
      yojanaApprovedAmount,
      patientPayableAmount,
      patientPaidAmount,
      pendingAmount,
      lastPaymentDate: lastPayment?.date || null,
      lastPaymentAmount: lastPayment?.amount || 0,
      paymentStatus,
      billNo: bill?.bill_no || bill?.bill_number || "-",
      billStatus: bill?.status || "-",
      billDate: bill?.date || visit.discharge_date || visit.admission_date || visit.visit_date || null,
      admissionDate: visit.admission_date || visit.visit_date || null,
      dischargeDate: visit.discharge_date || null,
      packageName: visit.package_name || "-",
      packageCode: visit.package_code || "-",
      history,
    } satisfies CollectionRow;
  });

  return rows.sort((left, right) => {
    const statusOrder = { pending: 0, partial: 1, paid: 2, covered: 3 };
    if (statusOrder[left.paymentStatus] !== statusOrder[right.paymentStatus]) {
      return statusOrder[left.paymentStatus] - statusOrder[right.paymentStatus];
    }
    return right.pendingAmount - left.pendingAmount;
  });
}

export default function PaymentCollectionGauravFlow() {
  const { hospitalConfig } = useAuth();
  const [filters, setFilters] = useState<Filters>({
    search: "",
    status: "all",
    type: "all",
    doctor: "all",
    dateFrom: "",
    dateTo: "",
  });
  const [selected, setSelected] = useState<CollectionRow | null>(null);

  const collection = useQuery({
    queryKey: ["tablet-payment-collection-gaurav", hospitalConfig.name],
    queryFn: () => loadCollectionRows(hospitalConfig.name),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const rows = collection.data || [];

  const doctors = useMemo(() => {
    const unique = new Set(rows.map((row) => row.doctorName).filter((name) => name && name !== "-"));
    return [...unique].sort((left, right) => left.localeCompare(right));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const term = normalize(filters.search);
    const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : null;
    const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() : null;

    return rows.filter((row) => {
      const searchMatch = !term || [
        row.patientName,
        row.uhid,
        row.registrationId,
        row.mobile,
        row.visitId,
      ].some((value) => normalize(value).includes(term));
      if (!searchMatch) return false;
      if (filters.status !== "all" && row.paymentStatus !== filters.status) return false;
      if (filters.type !== "all" && row.paymentType !== filters.type) return false;
      if (filters.doctor !== "all" && row.doctorName !== filters.doctor) return false;

      const dateValue = row.lastPaymentDate || row.billDate || row.admissionDate;
      const timestamp = dateValue ? new Date(dateValue).getTime() : null;
      if (from !== null && (timestamp === null || timestamp < from)) return false;
      if (to !== null && (timestamp === null || timestamp > to)) return false;
      return true;
    });
  }, [filters, rows]);

  const totals = useMemo(() => ({
    totalBill: filteredRows.reduce((sum, row) => sum + row.totalBillAmount, 0),
    approved: filteredRows.reduce((sum, row) => sum + row.yojanaApprovedAmount, 0),
    paid: filteredRows.reduce((sum, row) => sum + row.patientPaidAmount, 0),
    pending: filteredRows.reduce((sum, row) => sum + row.pendingAmount, 0),
  }), [filteredRows]);

  if (selected) {
    return (
      <CollectionDetail
        row={selected}
        onBack={() => setSelected(null)}
        onUpdated={() => {
          collection.refetch();
          setSelected(null);
        }}
      />
    );
  }

  return (
    <FlowScaffold
      heading="Payment Collection (Vasooli) - Gaurav"
      subheading="Pending and received bills from Billing, Advance Payment, and Final Payment"
      actions={
        <>
          <TabletButton
            variant="outline"
            className="flex-1"
            onClick={() => collection.refetch()}
            disabled={collection.isFetching}
          >
            <RefreshCw className={cn("mr-2 h-5 w-5", collection.isFetching && "animate-spin")} />
            Refresh
          </TabletButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Total Bill" value={inr(totals.totalBill)} tone="slate" />
          <Metric label="Yojana Approved" value={inr(totals.approved)} tone="blue" />
          <Metric label="Patient Paid" value={inr(totals.paid)} tone="emerald" />
          <Metric label="Pending" value={inr(totals.pending)} tone="red" />
        </div>

        <TabletCard variant="flat" className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[minmax(240px,1.4fr)_1fr_1fr] xl:grid-cols-[minmax(280px,1.5fr)_1fr_1fr_1fr_1fr_1fr]">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Search
              </span>
              <span className="flex h-12 items-center gap-2 rounded-xl border bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  placeholder="Name, UHID, registration ID, mobile"
                  className="min-w-0 flex-1 bg-transparent text-base outline-none"
                />
              </span>
            </label>

            <FilterSelect
              label="Payment Status"
              value={filters.status}
              onChange={(value) => setFilters((current) => ({ ...current, status: value as PaymentStatus }))}
              options={[
                ["all", "All statuses"],
                ["pending", "Pending"],
                ["partial", "Partial Paid"],
                ["paid", "Paid"],
                ["covered", "Fully Covered"],
              ]}
            />

            <FilterSelect
              label="Payment Type"
              value={filters.type}
              onChange={(value) => setFilters((current) => ({ ...current, type: value as PaymentType }))}
              options={[
                ["all", "All types"],
                ["cash", "Cash patients"],
                ["yojana", "Yojana / Insurance"],
              ]}
            />

            <FilterSelect
              label="Doctor"
              value={filters.doctor}
              onChange={(value) => setFilters((current) => ({ ...current, doctor: value }))}
              options={[["all", "All doctors"], ...doctors.map((doctor) => [doctor, doctor] as [string, string])]}
            />

            <DateInput
              label="From"
              value={filters.dateFrom}
              onChange={(value) => setFilters((current) => ({ ...current, dateFrom: value }))}
            />
            <DateInput
              label="To"
              value={filters.dateTo}
              onChange={(value) => setFilters((current) => ({ ...current, dateTo: value }))}
            />
          </div>
        </TabletCard>

        {collection.isLoading ? (
          <div className="grid gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border bg-muted/60" />
            ))}
          </div>
        ) : collection.isError ? (
          <TabletCard className="border-red-200 bg-red-50 text-red-700">
            {(collection.error as Error)?.message || "Unable to load payment collection data."}
          </TabletCard>
        ) : filteredRows.length === 0 ? (
          <TabletCard className="py-10 text-center text-muted-foreground">
            No patients match the selected filters.
          </TabletCard>
        ) : (
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[1420px] text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <Th>Patient</Th>
                    <Th>UHID</Th>
                    <Th>Registration</Th>
                    <Th>Mobile</Th>
                    <Th>Doctor</Th>
                    <Th>Yojana / Insurance</Th>
                    <Th className="text-right">Total Bill</Th>
                    <Th className="text-right">Approved</Th>
                    <Th className="text-right">Payable</Th>
                    <Th className="text-right">Paid</Th>
                    <Th className="text-right">Pending</Th>
                    <Th>Last Payment</Th>
                    <Th>Status</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((row) => (
                    <DashboardTableRow key={row.visitUuid} row={row} onSelect={() => setSelected(row)} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y xl:hidden">
              {filteredRows.map((row) => (
                <DashboardMobileRow key={row.visitUuid} row={row} onSelect={() => setSelected(row)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </FlowScaffold>
  );
}

function CollectionDetail({
  row,
  onBack,
  onUpdated,
}: {
  row: CollectionRow;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<"summary" | "collect">("summary");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("CASH");
  const [remarks, setRemarks] = useState("");

  const collectPayment = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!row.patientUuid) throw new Error("Patient is not linked to this visit.");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid amount.");

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
        payment_date: new Date().toISOString(),
        payment_mode: mode,
        remarks: remarks.trim() || "Payment collected from Vasooli Gaurav tablet tile",
        status: "ACTIVE",
      });

      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Payment collected successfully.");
      await queryClient.invalidateQueries({ queryKey: ["tablet-payment-collection-gaurav"] });
      setAmount("");
      setRemarks("");
      setStage("summary");
      onUpdated();
    },
    onError: (error) => {
      toast.error((error as Error)?.message || "Payment could not be collected.");
    },
  });

  const openInvoice = (route: "detailed" | "final") => {
    const path = route === "detailed" ? `/detailed-invoice/${row.visitId}` : `/final-bill/${row.visitId}`;
    window.open(path, "_blank", "noopener,noreferrer");
  };

  if (stage === "collect") {
    const value = Number(amount) || 0;
    return (
      <FlowScaffold
        heading="Collect Payment"
        subheading={`${row.patientName} - Pending ${inr(row.pendingAmount)}`}
        actions={
          <>
            <TabletButton variant="outline" className="flex-1" onClick={() => setStage("summary")}>
              Cancel
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={value <= 0 || collectPayment.isPending}
              onClick={() => collectPayment.mutate()}
            >
              {collectPayment.isPending ? "Saving..." : `Collect ${inr(value)}`}
            </TabletButton>
          </>
        }
      >
        <div className="mx-auto max-w-3xl space-y-4">
          <TabletCard className="bg-emerald-50">
            <p className="text-sm font-medium text-emerald-700">Payment amount</p>
            <p className="mt-1 text-4xl font-bold text-emerald-950">{inr(value)}</p>
          </TabletCard>

          <div>
            <p className="mb-2 text-sm font-semibold text-muted-foreground">Payment mode</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
              {PAYMENT_MODES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setMode(item)}
                  className={cn(
                    "h-12 rounded-xl border text-sm font-semibold transition-all active:scale-[0.98]",
                    mode === item
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-semibold text-muted-foreground">Remarks</span>
            <textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-xl border bg-background p-3 text-base outline-none focus:ring-2 focus:ring-ring"
              placeholder="Optional receipt remark"
            />
          </label>

          <TabletNumpad value={amount} onChange={setAmount} allowDecimal maxLength={9} />
        </div>
      </FlowScaffold>
    );
  }

  const meta = statusMeta(row.paymentStatus);

  return (
    <FlowScaffold
      heading={row.patientName}
      subheading={`${row.uhid} - ${row.registrationId}`}
      actions={
        <>
          <TabletButton variant="outline" className="flex-1" onClick={onBack}>
            <ArrowLeft className="mr-2 h-5 w-5" />
            Back
          </TabletButton>
          <TabletButton variant="outline" className="flex-1" onClick={() => openInvoice("detailed")}>
            <Download className="mr-2 h-5 w-5" />
            Invoice
          </TabletButton>
          <TabletButton className="flex-1" onClick={() => setStage("collect")}>
            <WalletCards className="mr-2 h-5 w-5" />
            Collect
          </TabletButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", meta.className)}>
            {meta.label}
          </span>
          <span className="rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
            Bill {row.billNo}
          </span>
          <button
            type="button"
            onClick={() => navigate(`/final-bill/${row.visitId}`)}
            className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
          >
            <FileText className="h-4 w-4" />
            Final Bill
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Total Bill" value={inr(row.totalBillAmount)} tone="slate" />
          <Metric label="Yojana Approved" value={inr(row.yojanaApprovedAmount)} tone="blue" />
          <Metric label="Patient Payable" value={inr(row.patientPayableAmount)} tone="amber" />
          <Metric label="Patient Paid" value={inr(row.patientPaidAmount)} tone="emerald" />
          <Metric label="Pending" value={inr(row.pendingAmount)} tone="red" />
        </div>

        <TabletCard variant="flat">
          <h3 className="mb-3 text-lg font-bold">Billing Summary</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Mobile" value={row.mobile} />
            <Info label="Doctor" value={row.doctorName} />
            <Info label="Yojana / Insurance" value={row.yojanaName} />
            <Info label="Bill Status" value={row.billStatus} />
            <Info label="Admission" value={formatDate(row.admissionDate)} />
            <Info label="Discharge" value={formatDate(row.dischargeDate)} />
            <Info label="Package Code" value={row.packageCode} />
            <Info label="Package Name" value={row.packageName} />
          </div>
        </TabletCard>

        <TabletCard variant="flat">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold">Payment History</h3>
            <span className="text-sm text-muted-foreground">{row.history.length} receipt rows</span>
          </div>
          {row.history.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No payment collected yet.</p>
          ) : (
            <div className="divide-y">
              {row.history.map((payment) => (
                <div key={`${payment.source}-${payment.id}`} className="grid gap-3 py-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto] md:items-center">
                  <div>
                    <p className="font-semibold">{payment.receiptNumber}</p>
                    <p className="text-sm text-muted-foreground">{payment.source} receipt</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium">{formatDate(payment.date)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Mode</p>
                    <p className="font-medium">{payment.mode}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className={cn("font-bold", payment.amount < 0 ? "text-red-700" : "text-emerald-700")}>
                      {inr(payment.amount)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => printReceipt(row, payment)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </button>
                </div>
              ))}
            </div>
          )}
        </TabletCard>
      </div>
    </FlowScaffold>
  );
}

function DashboardTableRow({ row, onSelect }: { row: CollectionRow; onSelect: () => void }) {
  const meta = statusMeta(row.paymentStatus);
  return (
    <tr className="align-top">
      <Td>
        <p className="font-semibold text-foreground">{row.patientName}</p>
        <p className="text-xs text-muted-foreground">{row.visitId}</p>
      </Td>
      <Td>{row.uhid}</Td>
      <Td>{row.registrationId}</Td>
      <Td>{row.mobile}</Td>
      <Td>{row.doctorName}</Td>
      <Td>{row.yojanaName}</Td>
      <Td className="text-right font-semibold">{inr(row.totalBillAmount)}</Td>
      <Td className="text-right">{inr(row.yojanaApprovedAmount)}</Td>
      <Td className="text-right">{inr(row.patientPayableAmount)}</Td>
      <Td className="text-right text-emerald-700">{inr(row.patientPaidAmount)}</Td>
      <Td className="text-right font-bold text-red-700">{inr(row.pendingAmount)}</Td>
      <Td>
        <p>{formatDate(row.lastPaymentDate)}</p>
        <p className="text-xs font-semibold text-muted-foreground">{inr(row.lastPaymentAmount)}</p>
      </Td>
      <Td>
        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", meta.className)}>
          {meta.label}
        </span>
      </Td>
      <Td>
        <button
          type="button"
          onClick={onSelect}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white transition-all active:scale-[0.98]"
        >
          <ReceiptText className="h-4 w-4" />
          Details
        </button>
      </Td>
    </tr>
  );
}

function DashboardMobileRow({ row, onSelect }: { row: CollectionRow; onSelect: () => void }) {
  const meta = statusMeta(row.paymentStatus);
  return (
    <button type="button" onClick={onSelect} className="block w-full p-4 text-left transition-colors active:bg-muted">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{row.patientName}</p>
          <p className="text-sm text-muted-foreground">{row.uhid} - {row.registrationId}</p>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold", meta.className)}>
          {meta.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <Info label="Total" value={inr(row.totalBillAmount)} />
        <Info label="Paid" value={inr(row.patientPaidAmount)} />
        <Info label="Pending" value={inr(row.pendingAmount)} />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>{row.doctorName}</span>
        <span>{formatDate(row.lastPaymentDate)}</span>
      </div>
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "slate" | "blue" | "emerald" | "red" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    red: "border-red-200 bg-red-50 text-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div className={cn("rounded-2xl border p-4", tones[tone])}>
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

function printReceipt(row: CollectionRow, payment: PaymentHistoryRow) {
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
        <title>Receipt ${escape(payment.receiptNumber)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 24px; color: #111827; }
          .receipt { max-width: 760px; margin: 0 auto; border: 1px solid #111827; padding: 24px; }
          .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #111827; padding-bottom: 16px; }
          h1 { margin: 0; font-size: 22px; }
          h2 { margin: 20px 0 8px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          td { padding: 8px 0; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          td:first-child { width: 180px; color: #6b7280; }
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
              <strong>${escape(payment.receiptNumber)}</strong><br />
              ${escape(formatDate(payment.date))}
            </div>
          </div>
          <h2>Received From</h2>
          <table>
            <tr><td>Patient Name</td><td><strong>${escape(row.patientName)}</strong></td></tr>
            <tr><td>UHID</td><td>${escape(row.uhid)}</td></tr>
            <tr><td>Registration ID</td><td>${escape(row.registrationId)}</td></tr>
            <tr><td>Payment Mode</td><td>${escape(payment.mode)}</td></tr>
            <tr><td>Payment Type</td><td>${escape(payment.source)} ${payment.isRefund ? "Refund" : "Receipt"}</td></tr>
            <tr><td>Remarks</td><td>${escape(payment.remarks || "-")}</td></tr>
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
