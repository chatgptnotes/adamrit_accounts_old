import { useMemo, useState } from "react";
import { Loader2, Search, User } from "lucide-react";
import type { TabletVisit } from "@/tablet/hooks/useVisitLists";
import { shortDate } from "@/tablet/lib/format";
import { PatientTypeBadge } from "@/tablet/components/PatientTypeBadge";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { PullToRefresh } from "@/tablet/components/PullToRefresh";

interface TabletVisitListProps {
  visits: TabletVisit[];
  loading: boolean;
  error: boolean;
  onSelect: (visit: TabletVisit) => void;
  emptyText: string;
  metaKind: "admitted" | "discharged";
}

/** Searchable, touch-friendly list of visits used by clinical module flows. */
export function TabletVisitList({
  visits,
  loading,
  error,
  onSelect,
  emptyText,
  metaKind,
}: TabletVisitListProps) {
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return visits;
    return visits.filter(
      (v) =>
        v.patientName.toLowerCase().includes(t) ||
        v.visitId?.toLowerCase().includes(t) ||
        v.patientsId?.toLowerCase().includes(t),
    );
  }, [visits, term]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 border-b p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <TabletInput
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search by name, visit or patient ID"
            className="pl-11"
          />
        </div>
      </div>
      <PullToRefresh className="p-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <p className="py-10 text-center text-destructive">
            Could not load visits. Check the connection.
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {term ? "No matches." : emptyText}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((v) => (
              <TabletCard
                key={v.id}
                interactive
                onClick={() => onSelect(v)}
                className="flex items-center gap-3"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{v.patientName}</p>
                    <PatientTypeBadge type={v.patientType} />
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {v.patientsId || v.visitId}
                    {v.age != null ? ` · ${v.age}/${v.gender || "—"}` : ""}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  {metaKind === "admitted" ? (
                    <>
                      <p>Adm {shortDate(v.admissionDate)}</p>
                      <p className="text-xs">{v.ward || "No ward"}</p>
                    </>
                  ) : (
                    <>
                      <p>Dis {shortDate(v.dischargeDate)}</p>
                      {v.dischargeMode ? (
                        <p className="text-xs capitalize">
                          {v.dischargeMode.replace(/_/g, " ")}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </TabletCard>
            ))}
          </div>
        )}
      </PullToRefresh>
    </div>
  );
}
