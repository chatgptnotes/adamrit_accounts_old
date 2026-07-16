import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import {
  fetchLatestPreauthCaseForPatient,
  usePreauthCases,
} from "@/tablet/modules/preauth/usePreauthCases";
import type { PreauthCase } from "@/tablet/modules/preauth/types";
import ImplantStickerSection from "@/pages/corporate-bill/ImplantStickerSection";

function formatDateInput(value: string | null | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

export default function ImplantStickerFlow() {
  const { hospitalConfig } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [selected, setSelected] = useState<PreauthCase | null>(null);
  const [resolving, setResolving] = useState(false);
  const cases = usePreauthCases(debouncedSearch);

  const surgeryDate = formatDateInput(selected?.admissionDate || selected?.dischargeDate || null);

  const handleSelect = async (item: PreauthCase) => {
    try {
      setResolving(true);
      const next = await fetchLatestPreauthCaseForPatient({
        id: item.patientUuid,
        name: item.patientName,
        patients_id: item.patientId,
        age: item.age ?? undefined,
        gender: item.gender,
      });
      if (!next) {
        toast.error("No visit found for this patient.");
        return;
      }
      setSelected(next);
    } catch (error) {
      console.error("Failed to load implant sticker case:", error);
      toast.error("Could not load the patient's visit.");
    } finally {
      setResolving(false);
    }
  };

  return (
    <FlowScaffold
      heading="Implant Sticker"
      subheading="Generate the sticker from tablet/mobile"
      actions={
        selected ? (
          <TabletButton variant="outline" className="flex-1" onClick={() => setSelected(null)}>
            Change case
          </TabletButton>
        ) : (
          <TabletButton variant="outline" className="flex-1" onClick={() => setSearchInput("")}>
            Clear
          </TabletButton>
        )
      }
    >
      {!selected ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <TabletInput
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search patient, visit, or registration ID"
              className="min-w-0 flex-1"
            />
            <TabletButton className="shrink-0" onClick={() => setSearchInput((s) => s.trim())}>
              <Search className="h-5 w-5" />
            </TabletButton>
          </div>

          {resolving || cases.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (cases.data || []).length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Search to choose a case for implant sticker.
            </p>
          ) : (
            <div className="space-y-3">
              {(cases.data || []).map((item) => (
                <button
                  key={item.patientUuid}
                  type="button"
                  onClick={() => void handleSelect(item)}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
                >
                  <p className="font-semibold">{item.patientName}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.patientId || "No patient ID"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <TabletCard className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Selected case</p>
            <h3 className="mt-1 text-lg font-semibold">{selected.patientName}</h3>
            <p className="text-sm text-muted-foreground">
              {selected.patientId || "No ID"} | {selected.visitId || "No visit ID"}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-2">
            <div className="w-full">
              <ImplantStickerSection
                visitId={selected.visitUuid}
                patient={{
                  patientName: selected.patientName,
                  patientId: selected.patientId || selected.registrationId || selected.yojanaRegistrationId || "",
                  age: selected.age ? String(selected.age) : "",
                  sex: selected.gender || "",
                  admissionDate: selected.admissionDate || surgeryDate,
                  dischargeDate: selected.dischargeDate || "",
                  hospitalName: hospitalConfig?.fullName || hospitalConfig?.name || "",
                }}
                defaultSurgeryDate={surgeryDate}
                defaultSurgeryName={selected.packageName || ""}
              />
            </div>
          </div>
        </TabletCard>
      )}
    </FlowScaffold>
  );
}
