import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePatientLookup } from "@/hooks/usePatientLookup";
import type {
  Patient,
  SearchCriteria,
} from "@/components/PatientLookup/types/patientLookup";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { TabletButton } from "@/tablet/ui/TabletButton";

type FieldKey = keyof SearchCriteria;

const FIELDS: { id: FieldKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "patientId", label: "Patient ID" },
  { id: "mobile", label: "Mobile" },
  { id: "aadhaar", label: "Aadhaar" },
];

/**
 * Centring envelope: caps the layout width and centres it so the console never
 * over-stretches or loses line rhythm on large desktop / 4K monitors, while
 * staying full-width and compactly padded on phones.
 */
const ENVELOPE = "mx-auto w-full max-w-7xl px-4 py-4 sm:px-6";

/** Shared grid template — keeps the column header aligned with every row. */
const ROW_COLS =
  "sm:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,2fr)_2.25rem]";

interface TabletPatientPickerProps {
  onSelect: (patient: Patient) => void;
  heading?: string;
  hint?: string;
  /**
   * When provided, a Hope/Ayushman toggle appears and the search runs against
   * the chosen hospital's patients — the caller uses the same value to post
   * in that hospital's books.
   */
  hospital?: 'hope' | 'ayushman';
  onHospitalChange?: (hospital: 'hope' | 'ayushman') => void;
  /**
   * When set, the empty state lists the patients registered in the last N
   * hours instead of asking for a search term — for flows that act on someone
   * who has just walked in. Typing a search replaces the list as usual.
   */
  recentHours?: number;
}

/**
 * Universal patient search for tablet module flows.
 * Built on the shared usePatientLookup hook (hospital-scoped).
 *
 * Results render as an aligned table on tablet / desktop and collapse into
 * stacked high-contrast mini-cards on phones — a single row element morphs
 * across breakpoints, so there is one source of truth per patient.
 */
export function TabletPatientPicker({
  onSelect,
  heading,
  hint,
  hospital,
  onHospitalChange,
  recentHours,
}: TabletPatientPickerProps) {
  const {
    criteria,
    setCriteria,
    patients,
    isLoading,
    hasSearched,
    showNoResults,
    search,
    hasCriteria,
  } = usePatientLookup(hospital, { autoSearch: true });
  const [field, setField] = useState<FieldKey>("name");
  const { hospitalConfig } = useAuth();
  const hospitalName = hospital || hospitalConfig.name;

  // The just-registered list. Same table and hospital scoping as the search,
  // so a row picked from here is the same shape as a searched one.
  const { data: recent = [], isFetching: recentLoading } = useQuery({
    queryKey: ["patient-recent", hospitalName, recentHours],
    enabled: !!recentHours && !hasCriteria,
    staleTime: 60_000,
    queryFn: async (): Promise<Patient[]> => {
      const since = new Date(Date.now() - recentHours! * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("patients")
        .select("*")
        .eq("hospital_name", hospitalName)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as Patient[];
    },
  });

  // With nothing typed, the recent list stands in for the results.
  const showingRecent = !!recentHours && !hasCriteria;
  const rows = showingRecent ? recent : patients;
  const busy = showingRecent ? recentLoading : isLoading;

  const updateField = (key: FieldKey, value: string) => {
    setField(key);
    setCriteria({ mobile: "", name: "", patientId: "", aadhaar: "", [key]: value });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Search controls */}
      <div className="flex-shrink-0 border-b border-border">
        <div className={cn(ENVELOPE, "space-y-3")}>
          {heading ? (
            <h2 className="text-lg font-bold text-foreground sm:text-xl">
              {heading}
            </h2>
          ) : null}
          {hint ? (
            <p className="text-sm text-muted-foreground">{hint}</p>
          ) : null}
          {hospital && onHospitalChange ? (
            <div className="flex gap-2">
              {(["hope", "ayushman"] as const).map((h) => (
                <TabletButton
                  key={h}
                  size="default"
                  variant={hospital === h ? "default" : "outline"}
                  className="min-h-[44px] flex-1 text-sm"
                  onClick={() => onHospitalChange(h)}
                >
                  {h === "hope" ? "Hope Hospital" : "Ayushman Hospital"}
                </TabletButton>
              ))}
            </div>
          ) : null}

          {/* Field selector — wraps instead of overflowing on narrow phones */}
          <div className="flex flex-wrap gap-2">
            {FIELDS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => updateField(f.id, "")}
                className={cn(
                  "flex min-h-[48px] items-center rounded-full px-5 text-sm font-semibold transition-colors",
                  field === f.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <TabletInput
              value={criteria[field]}
              onChange={(e) => updateField(field, e.target.value)}
              placeholder={`Search by ${FIELDS.find((f) => f.id === field)?.label.toLowerCase()}`}
              inputMode={field === "name" ? "text" : "numeric"}
              className="min-w-0 flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter" && hasCriteria) search();
              }}
            />
            <TabletButton
              onClick={() => hasCriteria && search()}
              disabled={!hasCriteria || isLoading}
              aria-label="Search"
              className="shrink-0"
            >
              <Search className="h-5 w-5" />
            </TabletButton>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="tablet-no-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className={ENVELOPE}>
          {busy ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : rows.length > 0 ? (
            <div>
              {showingRecent ? (
                <p className="px-4 pb-2 text-sm font-semibold text-muted-foreground">
                  Registered in the last {recentHours} hours
                </p>
              ) : null}
              {/* Column header — tablet / desktop only */}
              <div
                className={cn(
                  "hidden px-4 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                  "sm:grid sm:gap-4",
                  ROW_COLS,
                )}
              >
                <span>Patient</span>
                <span>Patient ID</span>
                <span>Diagnosis</span>
                <span aria-hidden />
              </div>

              <ul className="space-y-3 sm:space-y-1.5">
                {rows.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className={cn(
                        "grid w-full gap-3 text-left transition-colors",
                        // Mobile: high-contrast stacked mini-card
                        "rounded-2xl border-2 border-border bg-card p-4",
                        // Tablet / desktop: aligned, compact table row
                        "sm:items-center sm:gap-4 sm:rounded-xl sm:border sm:px-4 sm:py-3",
                        ROW_COLS,
                        "hover:border-primary/60 hover:bg-primary/10 active:scale-[0.99]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      {/* Patient — avatar + name */}
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15">
                          <User className="h-6 w-6 text-primary" />
                        </div>
                        <p className="truncate font-semibold text-foreground">
                          {p.name}
                        </p>
                      </div>

                      {/* Patient ID — monospace for unambiguous medical IDs */}
                      <div className="min-w-0 pl-14 sm:pl-0">
                        <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground sm:hidden">
                          Patient ID
                        </span>
                        <p className="truncate font-mono tracking-wider text-foreground">
                          {p.patients_id || "—"}
                        </p>
                      </div>

                      {/* Diagnosis */}
                      <div className="min-w-0 pl-14 sm:pl-0">
                        <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground sm:hidden">
                          Diagnosis
                        </span>
                        <p className="truncate text-sm text-muted-foreground">
                          {p.primary_diagnosis || "—"}
                        </p>
                      </div>

                      {/* Row affordance — table view only */}
                      <ChevronRight className="hidden h-5 w-5 self-center text-muted-foreground sm:block" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : showNoResults ? (
            <p className="py-12 text-center text-muted-foreground">
              No patients found. Check the spelling or try another field.
            </p>
          ) : showingRecent ? (
            <p className="py-12 text-center text-muted-foreground">
              Nobody has been registered in the last {recentHours} hours. Search by name,
              patient ID or mobile instead.
            </p>
          ) : (
            <p className="py-12 text-center text-muted-foreground">
              {hasSearched ? "No results." : "Search for a patient to begin."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
