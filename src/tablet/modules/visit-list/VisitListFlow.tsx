import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, LogIn, Search, Stethoscope, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { HOSPITAL_CONFIGS, type HospitalType } from "@/types/hospital";
import { getDateRange } from "@/hooks/useDirectorKpis";
import { shortDate } from "@/tablet/lib/format";
import { PatientTypeBadge } from "@/tablet/components/PatientTypeBadge";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";

interface VisitRow {
  visit_id: string;
  patient_type: string | null;
  visit_date: string | null;
  admission_date: string | null;
  ward_allotted: string | null;
  patients: {
    name: string;
    patients_id: string | null;
    age: number | null;
    gender: string | null;
    hospital_name: string | null;
  };
}

// Two read-only list variants driven by the module id, mirroring the director
// dashboard's "OPD Visits" and "Admissions" tiles: today's OPD visits and
// today's IPD admissions. Both hospitals are shown together, since the director
// dashboard is a cross-hospital view.
const VARIANTS = {
  "todays-opd": {
    title: "OPD Visits",
    empty: "No OPD visits today.",
    icon: Stethoscope,
  },
  "todays-ipd": {
    title: "Admissions",
    empty: "No admissions today.",
    icon: LogIn,
  },
} as const;

type VariantKey = keyof typeof VARIANTS;

const HOSPITALS: HospitalType[] = ["hope", "ayushman"];
const shortLabel = (h: HospitalType) => HOSPITAL_CONFIGS[h].fullName.split(" ")[0];
const HOSPITAL_TINT: Record<HospitalType, string> = {
  hope: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ayushman: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
};
const hospitalOf = (r: VisitRow): HospitalType | null =>
  r.patients?.hospital_name === "hope"
    ? "hope"
    : r.patients?.hospital_name === "ayushman"
      ? "ayushman"
      : null;

/** Today's OPD / IPD-admission patient list across both hospitals (read-only). */
export default function VisitListFlow() {
  const { moduleId } = useParams();
  const variant: VariantKey = moduleId === "todays-ipd" ? "todays-ipd" : "todays-opd";
  const [term, setTerm] = useState("");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["tablet-visit-list", variant],
    staleTime: 1000 * 60,
    queryFn: async (): Promise<VisitRow[]> => {
      const range = getDateRange("today", "");
      const cols =
        "visit_id, patient_type, visit_date, admission_date, ward_allotted, patients!inner(name, patients_id, age, gender, hospital_name)";
      // No hospital filter — both Hope and Ayushman are shown together.
      let query = supabase.from("visits").select(cols);

      if (variant === "todays-ipd") {
        query = query
          .not("admission_date", "is", null)
          .gte("admission_date", range.startISO)
          .lt("admission_date", range.endISO)
          .order("admission_date", { ascending: false });
      } else {
        query = query
          .eq("patient_type", "OPD")
          .gte("visit_date", range.startDate)
          .lt("visit_date", range.endDate)
          .order("visit_date", { ascending: false });
      }

      const { data, error } = await query.limit(400);
      if (error) throw error;
      return (data || []) as unknown as VisitRow[];
    },
  });

  // Per-hospital counts for the stats header (whole dataset, not search-filtered).
  const counts = useMemo(() => {
    const c: Record<string, number> = { hope: 0, ayushman: 0 };
    for (const r of data) {
      const h = hospitalOf(r);
      if (h) c[h] += 1;
    }
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return data;
    return data.filter(
      (r) =>
        r.patients?.name?.toLowerCase().includes(t) ||
        r.patients?.patients_id?.toLowerCase().includes(t) ||
        r.visit_id?.toLowerCase().includes(t),
    );
  }, [data, term]);

  const cfg = VARIANTS[variant];
  const dateOf = (r: VisitRow) => (variant === "todays-ipd" ? r.admission_date : r.visit_date);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 space-y-3 border-b p-4">
        {/* Both-hospital stats: Hope, Ayushman, Total */}
        <div className="grid grid-cols-3 gap-2">
          {HOSPITALS.map((h) => (
            <div key={h} className="rounded-xl border border-border bg-card/60 p-3 text-center">
              <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {shortLabel(h)}
              </div>
              <div className="mt-1 text-2xl font-bold">{counts[h] ?? 0}</div>
            </div>
          ))}
          <div className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Total
            </div>
            <div className="mt-1 text-2xl font-bold">{data.length}</div>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={`Search ${cfg.title.toLowerCase()} (both hospitals)`}
            className="pl-11"
          />
        </div>
      </div>
      <div className="tablet-no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-destructive">
            Could not load {cfg.title.toLowerCase()}.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {term ? "No matches." : cfg.empty}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const h = hospitalOf(r);
              return (
                <TabletCard key={r.visit_id} className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <User className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{r.patients?.name}</p>
                      <PatientTypeBadge type={r.patient_type} />
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          h ? HOSPITAL_TINT[h] : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {h ? shortLabel(h) : r.patients?.hospital_name || "—"}
                      </span>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {r.patients?.patients_id || r.visit_id} ·{" "}
                      {r.patients?.age ?? "—"}/{r.patients?.gender || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center gap-1 text-sm font-medium">
                      <CalendarDays className="h-4 w-4" />
                      {shortDate(dateOf(r))}
                    </p>
                    {r.ward_allotted ? (
                      <p className="text-xs capitalize text-muted-foreground">{r.ward_allotted}</p>
                    ) : null}
                  </div>
                </TabletCard>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
