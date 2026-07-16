import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useAuth } from "@/contexts/AuthContext";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { usePreauthCases } from "@/tablet/modules/preauth/usePreauthCases";
import type { PreauthCase } from "@/tablet/modules/preauth/types";
import ImplantStickerSection from "@/pages/corporate-bill/ImplantStickerSection";

function formatDateInput(value: string | null | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function CaseList({
  cases,
  loading,
  onSelect,
}: {
  cases: PreauthCase[];
  loading: boolean;
  onSelect: (item: PreauthCase) => void;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Search to choose a case for implant sticker.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {cases.map((item) => (
        <button
          key={item.visitUuid}
          type="button"
          onClick={() => onSelect(item)}
          className="w-full rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
        >
          <p className="font-semibold">{item.patientName}</p>
          <p className="text-sm text-muted-foreground">
            {item.patientId || "No patient ID"} | {item.visitId || "No visit ID"}
          </p>
        </button>
      ))}
    </div>
  );
}

export default function ImplantStickerFlow() {
  const { hospitalConfig } = useAuth();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch] = useDebounce(searchInput, 300);
  const [selected, setSelected] = useState<PreauthCase | null>(null);

  const cases = usePreauthCases(debouncedSearch);

  const surgeryDate = formatDateInput(selected?.admissionDate || selected?.dischargeDate || null);

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

          <CaseList cases={cases.data || []} loading={cases.isLoading} onSelect={setSelected} />
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

          <div className="overflow-x-auto rounded-2xl border border-border bg-card p-2">
            <div className="min-w-[860px]">
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
