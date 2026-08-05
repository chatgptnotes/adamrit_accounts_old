import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronLeft, FileText, Printer, TestTube } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import type { Patient } from "@/components/PatientLookup/types/patientLookup";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletPatientPicker } from "@/tablet/components/TabletPatientPicker";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";

// DATA SOURCE: diagnostic_centres + diagnostic_centre_tests (master)
//   -> record_diagnostic_referral -> expense_bills (JV) -> pay later

interface Centre {
  id: string;
  name: string;
}

interface CentreTest {
  id: string;
  test_name: string;
  amount: number;
}

const rupees = (n: number) => `Rs. ${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * Outsourced diagnostics referral. One tile per hospital: Nisha's posts on
 * DRM Hope, Chetna's on Ayushman — the tile id decides, not the login.
 * Approving records the referral, raises the centre's invoice on the
 * hospital (JV via the expense-bill trigger) and leaves it outstanding on
 * the Expense Bill page, where the later online payment generates the
 * payment voucher. Requisition and invoice print from the success screen.
 */
export default function DiagnosticsFlow() {
  const { user } = useAuth();
  const { moduleId } = useParams();
  const queryClient = useQueryClient();

  const hospitalType = moduleId === "diagnostics-ayushman" ? "ayushman" : "hope";
  const hospitalLabel =
    hospitalType === "ayushman" ? "Ayushman Nagpur Hospital" : "Hope Multi-Specialty Hospital";
  const companyLabel =
    hospitalType === "ayushman" ? "Ayushman Nagpur Hospital" : "DRM Hope Hospital Private Limited";

  const [step, setStep] = useState(1);
  const [centre, setCentre] = useState<Centre | null>(null);
  const [centreSearch, setCentreSearch] = useState("");
  const [patientType, setPatientType] = useState<"OPD" | "IPD" | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [testSearch, setTestSearch] = useState("");
  const [picked, setPicked] = useState<CentreTest[]>([]);
  const [done, setDone] = useState<{ invoiceNumber: string; amount: number } | null>(null);

  const { data: centres = [] } = useQuery({
    queryKey: ["diagnostic-centres"],
    queryFn: async (): Promise<Centre[]> => {
      const { data, error } = await (supabase as any)
        .from("diagnostic_centres")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as Centre[];
    },
  });

  const { data: tests = [] } = useQuery({
    queryKey: ["diagnostic-centre-tests", centre?.id],
    enabled: !!centre,
    queryFn: async (): Promise<CentreTest[]> => {
      const { data, error } = await (supabase as any)
        .from("diagnostic_centre_tests")
        .select("id, test_name, amount")
        .eq("centre_id", centre!.id)
        .eq("is_active", true)
        .order("test_name");
      if (error) throw error;
      return (data || []) as CentreTest[];
    },
  });

  const total = useMemo(() => picked.reduce((s, t) => s + Number(t.amount || 0), 0), [picked]);

  const approve = useMutation({
    mutationFn: async () => {
      if (!centre || !patient || !patientType) throw new Error("Incomplete referral");
      if (picked.length === 0) throw new Error("Pick at least one test");
      const { data, error } = await (supabase as any).rpc("record_diagnostic_referral", {
        p_centre_id: centre.id,
        p_patient_id: patient.id,
        p_patient_name: patient.name,
        p_patient_type: patientType,
        p_test_ids: picked.map((t) => t.id),
        p_hospital_type: hospitalType,
        p_approved_by: user?.email || user?.id || null,
      });
      if (error) throw new Error(error.message);
      return data as { invoiceNumber: string; amount: number };
    },
    onSuccess: (result) => {
      toast.success(
        `Referral approved - invoice ${result.invoiceNumber}, ${rupees(result.amount)} payable to ${centre?.name}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["expense-bills"] });
      setDone({ invoiceNumber: result.invoiceNumber, amount: result.amount });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save the referral"),
  });

  const openPrint = (kind: "requisition" | "invoice") => {
    if (!done || !centre || !patient) return;
    const today = new Date().toLocaleDateString("en-GB");
    const rows = picked
      .map(
        (t) =>
          `<tr><td style="padding:6px 10px;border:1px solid #999">${t.test_name}</td>` +
          `<td style="padding:6px 10px;border:1px solid #999;text-align:right">${rupees(Number(t.amount))}</td></tr>`,
      )
      .join("");
    const title =
      kind === "requisition"
        ? `Diagnostic Requisition - ${patient.name}`
        : `Invoice ${done.invoiceNumber} - ${centre.name}`;
    const heading =
      kind === "requisition"
        ? `<h2 style="margin:2px 0">${hospitalLabel}</h2><h3 style="margin:2px 0">Diagnostic Requisition</h3>`
        : `<h2 style="margin:2px 0">${centre.name}</h2><h3 style="margin:2px 0">Invoice ${done.invoiceNumber}</h3>` +
          `<p style="margin:2px 0">To: ${companyLabel}</p>`;
    const w = window.open("", "_blank", "noopener,width=800,height=900");
    if (!w) {
      toast.error("Allow pop-ups to print.");
      return;
    }
    w.document.write(
      `<html><head><title>${title}</title></head>` +
        `<body style="font-family:Arial,sans-serif;padding:24px;color:#111">` +
        `<div style="text-align:center;border-bottom:2px solid #111;padding-bottom:8px">${heading}</div>` +
        `<table style="width:100%;margin-top:14px;font-size:14px">` +
        `<tr><td><b>Date:</b> ${today}</td><td style="text-align:right"><b>${kind === "requisition" ? "Sent to" : "Reference"}:</b> ${
          kind === "requisition" ? centre.name : done.invoiceNumber
        }</td></tr>` +
        `<tr><td><b>Patient:</b> ${patient.name} (${patientType})</td>` +
        `<td style="text-align:right"><b>Patient ID:</b> ${patient.patients_id || "-"}</td></tr>` +
        `</table>` +
        `<table style="width:100%;border-collapse:collapse;margin-top:14px;font-size:14px">` +
        `<tr><th style="padding:6px 10px;border:1px solid #999;background:#eee;text-align:left">Investigation</th>` +
        `<th style="padding:6px 10px;border:1px solid #999;background:#eee;text-align:right">Amount</th></tr>` +
        rows +
        `<tr><td style="padding:6px 10px;border:1px solid #999;font-weight:bold">Total</td>` +
        `<td style="padding:6px 10px;border:1px solid #999;text-align:right;font-weight:bold">${rupees(done.amount)}</td></tr>` +
        `</table>` +
        `<p style="margin-top:28px;font-size:13px">Approved by: ${user?.email || ""} &nbsp;&nbsp; Invoice: ${done.invoiceNumber}</p>` +
        `<p style="margin-top:40px">Signature: ______________________</p>` +
        `<script>window.print()</` +
        `script></body></html>`,
    );
    w.document.close();
  };

  const resetAll = () => {
    setStep(1);
    setCentre(null);
    setCentreSearch("");
    setPatientType(null);
    setPatient(null);
    setTestSearch("");
    setPicked([]);
    setDone(null);
  };

  const back = () => {
    if (step === 2) {
      setPatient(null);
      setPatientType(null);
      setStep(1);
    } else if (step === 3) {
      setPicked([]);
      setTestSearch("");
      setStep(2);
    }
  };

  const backButton =
    step > 1 && !done ? (
      <TabletButton variant="outline" onClick={back} disabled={approve.isPending}>
        <ChevronLeft className="mr-1 h-5 w-5" /> Back
      </TabletButton>
    ) : null;

  // ---- Done: print requisition / invoice ----
  if (done) {
    return (
      <FlowScaffold
        heading={`Invoice ${done.invoiceNumber} posted`}
        subheading={`${patient?.name} · ${centre?.name} · ${rupees(done.amount)} — payable from the Expense Bill page`}
        actions={
          <TabletButton className="w-full" onClick={resetAll}>
            <Check className="mr-2 h-5 w-5" /> Next referral
          </TabletButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TabletButton variant="outline" className="min-h-[72px]" onClick={() => openPrint("requisition")}>
            <Printer className="mr-2 h-5 w-5" /> Print Requisition
          </TabletButton>
          <TabletButton variant="outline" className="min-h-[72px]" onClick={() => openPrint("invoice")}>
            <FileText className="mr-2 h-5 w-5" /> Print Invoice
          </TabletButton>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          The journal is posted in {companyLabel}; the invoice sits outstanding on the Expense
          Bill page. Paying it there generates the payment voucher.
        </p>
      </FlowScaffold>
    );
  }

  // ---- Step 1: centre ----
  if (step === 1) {
    const visible = centres.filter((c) =>
      c.name.toLowerCase().includes(centreSearch.trim().toLowerCase()),
    );
    return (
      <FlowScaffold
        step={1}
        totalSteps={3}
        heading={`Diagnostics — ${hospitalLabel}`}
        subheading="Where is the patient being sent?"
      >
        <div className="space-y-3">
          <TabletInput
            value={centreSearch}
            onChange={(e) => setCentreSearch(e.target.value)}
            placeholder="Search diagnostic centre…"
            autoFocus
          />
          <div className="grid gap-2">
            {visible.map((c) => (
              <TabletCard
                key={c.id}
                className="flex cursor-pointer items-center gap-3 p-4 active:scale-[0.99]"
                onClick={() => {
                  setCentre(c);
                  setStep(2);
                }}
              >
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-semibold">{c.name}</span>
              </TabletCard>
            ))}
            {visible.length === 0 && (
              <p className="py-4 text-center text-muted-foreground">
                No centre found. Add it in the Diagnostic Centre Master.
              </p>
            )}
          </div>
        </div>
      </FlowScaffold>
    );
  }

  // ---- Step 2: OPD/IPD + patient ----
  if (step === 2) {
    return (
      <FlowScaffold step={2} totalSteps={3} heading={centre?.name} actions={backButton}>
        <div className="mb-3 flex gap-3">
          {(["OPD", "IPD"] as const).map((t) => (
            <TabletButton
              key={t}
              variant={patientType === t ? "default" : "outline"}
              onClick={() => setPatientType(t)}
              className="flex-1"
            >
              {t}
            </TabletButton>
          ))}
        </div>
        {patientType ? (
          <TabletPatientPicker
            heading={`Find the ${patientType} patient`}
            hint="Search by name, patient ID or mobile number"
            onSelect={(p) => {
              setPatient(p);
              setStep(3);
            }}
          />
        ) : (
          <p className="py-6 text-center text-muted-foreground">
            Choose whether the patient is OPD or IPD first.
          </p>
        )}
      </FlowScaffold>
    );
  }

  // ---- Step 3: tests + approve ----
  const visibleTests = tests.filter((t) =>
    t.test_name.toLowerCase().includes(testSearch.trim().toLowerCase()),
  );
  return (
    <FlowScaffold
      step={3}
      totalSteps={3}
      heading={patient?.name || ""}
      subheading={`${patientType} · ${centre?.name}`}
      actions={
        <div className="flex w-full gap-3">
          {backButton}
          <TabletButton
            className="flex-1"
            disabled={picked.length === 0 || approve.isPending}
            onClick={() => approve.mutate()}
          >
            <Check className="mr-2 h-5 w-5" />
            {approve.isPending ? "Posting…" : `Approve — ${rupees(total)}`}
          </TabletButton>
        </div>
      }
    >
      <div className="space-y-3">
        <TabletLabel>Advised investigations</TabletLabel>
        <TabletInput
          value={testSearch}
          onChange={(e) => setTestSearch(e.target.value)}
          placeholder="Search the centre's tests…"
        />
        <div className="grid gap-2">
          {visibleTests.map((t) => {
            const isPicked = picked.some((p) => p.id === t.id);
            return (
              <TabletCard
                key={t.id}
                className={cn(
                  "flex cursor-pointer items-center justify-between p-4 active:scale-[0.99]",
                  isPicked && "border-primary ring-2 ring-primary/30",
                )}
                onClick={() =>
                  setPicked((prev) =>
                    isPicked ? prev.filter((p) => p.id !== t.id) : [...prev, t],
                  )
                }
              >
                <span className="flex items-center gap-2 text-base font-medium">
                  <TestTube className="h-4 w-4 text-muted-foreground" />
                  {t.test_name}
                </span>
                <span className="font-mono text-lg font-bold">{rupees(Number(t.amount))}</span>
              </TabletCard>
            );
          })}
          {tests.length === 0 && (
            <p className="py-4 text-center text-muted-foreground">
              No tests configured for {centre?.name} yet — add them in the Diagnostic Centre
              Master with their amounts.
            </p>
          )}
        </div>
        {picked.length > 0 && (
          <p className="text-right font-mono text-xl font-bold">Total: {rupees(total)}</p>
        )}
      </div>
    </FlowScaffold>
  );
}
