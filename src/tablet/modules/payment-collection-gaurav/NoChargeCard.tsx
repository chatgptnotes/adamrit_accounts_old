import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  NO_CHARGE_REASON_LABEL,
  liftNoChargeFlag,
  setNoChargeFlag,
  useNoChargeFlag,
  type NoChargeReason,
} from "@/lib/noChargeFlag";
import { NoChargeLabel } from "@/components/NoChargeBadge";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { Textarea } from "@/components/ui/textarea";

// Marks a patient as one the hospital must not charge — set here, on the tile
// where collection is decided, and read by every screen that takes money.

const REASONS: NoChargeReason[] = ["PACKAGE", "VIP"];

export function NoChargeCard({
  patientId,
  patientName,
}: {
  patientId: string | null;
  patientName: string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: flag, isLoading } = useNoChargeFlag(patientId);
  const [reason, setReason] = useState<NoChargeReason>("PACKAGE");
  const [note, setNote] = useState("");
  const [authorisedBy, setAuthorisedBy] = useState("");
  const [busy, setBusy] = useState(false);

  // A different patient is a different decision — never carry a half-typed
  // authorisation from the last one onto this one.
  useEffect(() => {
    setReason("PACKAGE");
    setNote("");
    setAuthorisedBy("");
  }, [patientId]);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["no-charge-flag", patientId || "none"] }),
      queryClient.invalidateQueries({ queryKey: ["no-charge-flags"] }),
    ]);

  if (!patientId) {
    return (
      <TabletCard variant="flat">
        <p className="text-sm text-muted-foreground">
          This visit has no patient record linked, so a do-not-charge flag cannot be set.
        </p>
      </TabletCard>
    );
  }

  const raise = async () => {
    if (!authorisedBy.trim()) {
      toast.error("Enter who authorised this");
      return;
    }
    setBusy(true);
    try {
      await setNoChargeFlag({
        patientId,
        reason,
        note,
        authorisedBy,
        actor: user?.email || user?.id || null,
      });
      toast.success(`${patientName} marked "do not charge".`);
      setNote("");
      setAuthorisedBy("");
      await invalidate();
    } catch (error) {
      toast.error((error as Error)?.message || "Could not set the flag");
    } finally {
      setBusy(false);
    }
  };

  const lift = async () => {
    setBusy(true);
    try {
      await liftNoChargeFlag(patientId, user?.email || user?.id || null);
      toast.success(`${patientName} can be charged again.`);
      await invalidate();
    } catch (error) {
      toast.error((error as Error)?.message || "Could not lift the flag");
    } finally {
      setBusy(false);
    }
  };

  return (
    <TabletCard variant="flat" className="space-y-3">
      <div className="flex items-center gap-2">
        <Ban className="h-5 w-5 text-red-600" />
        <h3 className="text-lg font-bold">Do not charge</h3>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : flag ? (
        <div className="space-y-3">
          <NoChargeLabel flag={flag} detailed />
          <TabletButton variant="outline" disabled={busy} onClick={() => void lift()}>
            {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            Lift the flag — charge normally again
          </TabletButton>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Use this when the whole cost has already been collected from {patientName} as a
            package, or when they must not be billed at all. Pharmacy and billing screens will
            show the label.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {REASONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setReason(value)}
                className={cn(
                  "rounded-xl border px-3 py-3 text-left text-sm font-semibold transition",
                  reason === value
                    ? "border-red-500 bg-red-50 text-red-800"
                    : "hover:border-red-300",
                )}
              >
                {NO_CHARGE_REASON_LABEL[value]}
              </button>
            ))}
          </div>

          <div>
            <TabletLabel>Note</TabletLabel>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. full package amount taken at admission"
              rows={2}
              className="mt-1 bg-background"
            />
          </div>

          <div>
            <TabletLabel>Authorised by *</TabletLabel>
            <TabletInput
              value={authorisedBy}
              onChange={(event) => setAuthorisedBy(event.target.value)}
              placeholder="Who allowed this"
              className="mt-1"
            />
          </div>

          <TabletButton
            className="w-full"
            disabled={busy || !authorisedBy.trim()}
            onClick={() => void raise()}
          >
            {busy ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-5 w-5" />
            )}
            Mark "do not charge"
          </TabletButton>
        </div>
      )}
    </TabletCard>
  );
}

export default NoChargeCard;
