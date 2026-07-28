import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFinalBillData } from "@/hooks/useFinalBillData";
import { supabase } from "@/integrations/supabase/client";
import {
  useAdmittedVisits,
  useDischargedVisits,
  type TabletVisit,
} from "@/tablet/hooks/useVisitLists";
import { TabletVisitList } from "@/tablet/components/TabletVisitList";
import { TabletNumpad } from "@/tablet/components/TabletNumpad";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletConfirm } from "@/tablet/components/TabletConfirm";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { inr } from "@/tablet/lib/format";
import ProtectedFinalBillContent from "@/components/invoice/ProtectedFinalBillContent";

const MODES = ["CASH", "CARD", "UPI", "CHEQUE", "NEFT"] as const;

/** Module 3 — view a visit's bill and collect a payment. */
export default function BillingFlow() {
  const [selected, setSelected] = useState<TabletVisit | null>(null);
  if (!selected) return <BillingPicker onSelect={setSelected} />;
  return <BillingView visit={selected} onBack={() => setSelected(null)} />;
}

function BillingPicker({ onSelect }: { onSelect: (v: TabletVisit) => void }) {
  const admitted = useAdmittedVisits();
  const discharged = useDischargedVisits();

  const visits = useMemo(() => {
    const seen = new Set<string>();
    const merged: TabletVisit[] = [];
    for (const v of [...(admitted.data || []), ...(discharged.data || [])]) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      merged.push(v);
    }
    return merged;
  }, [admitted.data, discharged.data]);

  return (
    <TabletVisitList
      visits={visits}
      loading={admitted.isLoading || discharged.isLoading}
      error={admitted.isError || discharged.isError}
      onSelect={onSelect}
      emptyText="No visits found."
      metaKind="admitted"
    />
  );
}

function BillingView({
  visit,
  onBack,
}: {
  visit: TabletVisit;
  onBack: () => void;
}) {
  return (
    <ProtectedFinalBillContent visitId={visit.visitId} onBack={onBack}>
      <BillingUnlockedView visit={visit} onBack={onBack} />
    </ProtectedFinalBillContent>
  );
}

function BillingUnlockedView({
  visit,
  onBack,
}: {
  visit: TabletVisit;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { billData, isLoading } = useFinalBillData(visit.visitId);
  const [stage, setStage] = useState<"view" | "collect">("view");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("CASH");

  const pay = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!value || value <= 0) throw new Error("Enter a valid amount");
      if (!visit.patientUuid) throw new Error("Patient not linked to this visit");
      // Record the collection exactly like the desktop AdvancePaymentModal and
      // the tablet AdvanceFlow: a direct insert into advance_payment. (The old
      // record_opd_visit_payment RPC compared visit_clinical_services.visit_id
      // (uuid) to the text visit code and always failed with "uuid = text".)
      // advance_payment.visit_id stores the TEXT visit code, so pass visit.visitId.
      const { error } = await supabase.from("advance_payment").insert({
        patient_id: visit.patientUuid,
        patient_name: visit.patientName,
        patients_id: visit.patientsId || null,
        visit_id: visit.visitId,
        advance_amount: value,
        returned_amount: 0,
        is_refund: false,
        payment_date: new Date().toISOString(),
        payment_mode: mode,
        status: "ACTIVE",
      });
      if (error) throw new Error(error.message || "Payment could not be recorded");
      return { success: true };
    },
  });

  if (pay.isSuccess) {
    return (
      <TabletConfirm
        status="success"
        title="Payment recorded"
        message={`${inr(Number(amount))} collected via ${mode} for ${visit.patientName}.`}
        primaryAction={{
          label: "Back to bill",
          onClick: () => {
            setAmount("");
            setStage("view");
            pay.reset();
          },
        }}
        secondaryAction={{ label: "Home", onClick: () => navigate("/") }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (stage === "collect") {
    const value = Number(amount) || 0;
    return (
      <FlowScaffold
        heading="Collect payment"
        subheading={`${visit.patientName} · ${visit.patientsId || visit.visitId}`}
        actions={
          <>
            <TabletButton
              variant="outline"
              className="flex-1"
              onClick={() => setStage("view")}
              disabled={pay.isPending}
            >
              Cancel
            </TabletButton>
            <TabletButton
              className="flex-1"
              disabled={value <= 0 || pay.isPending}
              onClick={() => pay.mutate()}
            >
              {pay.isPending ? "Recording…" : `Collect ${inr(value)}`}
            </TabletButton>
          </>
        }
      >
        <div className="space-y-5">
          <div className="rounded-2xl bg-muted p-5 text-center">
            <p className="text-sm text-muted-foreground">Payment amount</p>
            <p className="text-4xl font-bold">{inr(value)}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">
              Payment mode
            </p>
            <div className="grid grid-cols-5 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "h-12 rounded-xl text-sm font-medium",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <TabletNumpad
            value={amount}
            onChange={setAmount}
            allowDecimal
            maxLength={9}
          />
          {pay.isError ? (
            <p className="text-destructive">
              {(pay.error as Error)?.message || "Could not record payment."}
            </p>
          ) : null}
        </div>
      </FlowScaffold>
    );
  }

  const items = billData?.line_items || [];

  return (
    <FlowScaffold
      heading="Bill"
      subheading={`${visit.patientName} · ${visit.patientsId || visit.visitId}`}
      actions={
        <>
          <TabletButton variant="outline" className="flex-1" onClick={onBack}>
            Change visit
          </TabletButton>
          <TabletButton className="flex-1" onClick={() => setStage("collect")}>
            Collect payment
          </TabletButton>
        </>
      }
    >
      {!billData ? (
        <p className="py-10 text-center text-muted-foreground">
          No bill found for this visit. Create the bill on the desktop first;
          you can still collect a payment.
        </p>
      ) : (
        <>
          <TabletCard className="mb-4 flex items-center gap-4 bg-fuchsia-50">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-fuchsia-100">
              <Receipt className="h-7 w-7 text-fuchsia-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                Bill {billData.bill_no || "—"} · {billData.status || "—"}
              </p>
              <p className="text-3xl font-bold">{inr(billData.total_amount)}</p>
            </div>
          </TabletCard>

          <h3 className="mb-2 font-semibold">Line items ({items.length})</h3>
          {items.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              No line items on this bill.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <TabletCard
                  key={it.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="truncate font-medium">
                      {it.item_description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Qty {it.qty}
                      {it.cghs_nabh_code ? ` · ${it.cghs_nabh_code}` : ""}
                    </p>
                  </div>
                  <span className="font-semibold">{inr(it.amount)}</span>
                </TabletCard>
              ))}
            </div>
          )}
        </>
      )}
    </FlowScaffold>
  );
}
