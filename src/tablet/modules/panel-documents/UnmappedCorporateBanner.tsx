import { AlertTriangle } from "lucide-react";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { useUnmappedPanelCorporates } from "@/hooks/usePanelDocuments";

/**
 * Warns when a `patients.corporate` spelling looks like one of the nine panels
 * but matches no entry in CORPORATE_NAME_ALIASES.
 *
 * This matters because matching is exact: getCorporateRegistrationDocuments
 * returns [] for an unlisted spelling, so those patients have no required
 * documents and disappear from this checklist AND from the bell without any
 * error. Silent absence is indistinguishable from "all documents submitted",
 * which is exactly the failure this banner exists to make visible.
 */
export function UnmappedCorporateBanner({ hospitalName = null }: { hospitalName?: string | null }) {
  const { data: unmapped = [] } = useUnmappedPanelCorporates(hospitalName);

  if (unmapped.length === 0) return null;

  const affectedPatients = unmapped.reduce((sum, row) => sum + row.patientCount, 0);

  return (
    <TabletCard
      variant="flat"
      role="alert"
      className="space-y-3 border-amber-400/60 bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {unmapped.length} corporate {unmapped.length === 1 ? "name" : "names"} not mapped to a panel
          </h3>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/80">
            {affectedPatients} {affectedPatients === 1 ? "patient is" : "patients are"} excluded from
            this checklist and from the pending-document bell, because these spellings match no panel
            alias.
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {unmapped.map((row) => (
          <li
            key={row.corporate}
            className="flex items-center justify-between gap-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate font-medium text-amber-900 dark:text-amber-100">
              {row.corporate}
            </span>
            <span className="shrink-0 tabular-nums text-amber-800/80 dark:text-amber-200/70">
              {row.patientCount} {row.patientCount === 1 ? "patient" : "patients"}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-amber-800/80 dark:text-amber-200/70">
        To include them, add each spelling to CORPORATE_NAME_ALIASES in
        src/lib/registrationDocuments.ts.
      </p>
    </TabletCard>
  );
}
