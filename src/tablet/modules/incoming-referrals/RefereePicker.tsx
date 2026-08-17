import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import { TabletButton } from "@/tablet/ui/TabletButton";

/**
 * Pick the RM or referee, rather than typing their initials.
 *
 * The field was free text with a placeholder of "e.g. RKS", so the same person
 * arrived as RKS, R.K.S., Dr RKS and a misspelling of their name. That matters
 * more here than most typos: the referee on an announcement is who the
 * commission is eventually attributed to, and an initial that matches nobody
 * cannot be paid.
 *
 * Both masters are searched at once because the person announcing does not
 * think in terms of which table someone lives in -- relationship_managers (123)
 * and referees (97). An RM is stored by short code where they have one, which
 * is what "initials" always meant; a referee by name.
 *
 * SEVERAL REFEREES CAN SEND ONE PATIENT (owner, 17 Aug), so the picker holds a
 * list: each choice becomes a confirmed row, and the search stays open for the
 * next. Order is kept -- the FIRST pick is the one registration prefills and
 * commission matching reads, so it should be the main referee. Who is actually
 * paid is still decided at registration and on the Daily Revenue Report.
 */

export interface RefereeChoice {
  /** What gets stored on the announcement. */
  value: string;
  label: string;
  kind: "rm" | "referee" | "typed";
  detail: string | null;
}

export function RefereePicker({
  values,
  onAdd,
  onRemove,
}: {
  values: string[];
  onAdd: (choice: RefereeChoice) => void;
  onRemove: (value: string) => void;
}) {
  const [term, setTerm] = useState("");
  // Which of the held names were typed rather than chosen. Kept so the
  // exception stays visible after it is taken, not just at the moment of
  // taking it.
  const [typedValues, setTypedValues] = useState<string[]>([]);
  const search = term.trim();

  const useAsTyped = () => {
    const name = search;
    if (name.length < 2 || values.includes(name)) return;
    setTypedValues((prev) => [...prev, name]);
    onAdd({ value: name, label: name, kind: "typed", detail: null });
    setTerm("");
  };

  const results = useQuery({
    queryKey: ["referee-picker", search],
    enabled: search.length >= 2,
    staleTime: 60_000,
    queryFn: async (): Promise<RefereeChoice[]> => {
      const like = `%${search.replace(/[,()]/g, " ")}%`;
      const [rms, refs] = await Promise.all([
        (supabase as any)
          .from("relationship_managers")
          .select("id, name, short_code, code, contact_no, is_hidden")
          .or(`name.ilike.${like},short_code.ilike.${like},code.ilike.${like}`)
          .order("name")
          .limit(8),
        (supabase as any)
          .from("referees")
          .select("id, name, specialty, institution")
          .ilike("name", like)
          .order("name")
          .limit(8),
      ]);
      if (rms.error) throw new Error(rms.error.message);
      if (refs.error) throw new Error(refs.error.message);

      const out: RefereeChoice[] = [];
      for (const r of rms.data || []) {
        // Hidden RMs are retired; offering them would quietly reattach new
        // work to somebody who has been taken off the list.
        if (r.is_hidden) continue;
        out.push({
          value: String(r.short_code || r.code || r.name),
          label: String(r.name),
          kind: "rm",
          detail: [r.short_code || r.code, r.contact_no].filter(Boolean).join(" · ") || null,
        });
      }
      for (const r of refs.data || []) {
        out.push({
          value: String(r.name),
          label: String(r.name),
          kind: "referee",
          detail: [r.specialty, r.institution].filter(Boolean).join(" · ") || null,
        });
      }
      return out;
    },
  });

  // Already-picked people drop out of the results, so tapping twice cannot
  // announce the same referee twice.
  const options = (results.data ?? []).filter((c) => !values.includes(c.value));

  return (
    <div>
      <TabletLabel htmlFor="ref-search">
        {values.length > 1 ? "RM / referees" : "RM / referee"}
      </TabletLabel>

      {values.map((v, index) => (
        <div
          key={v}
          className="mt-1 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Check className="h-5 w-5 flex-shrink-0 text-emerald-600" />
            <span className="truncate font-semibold">{v}</span>
            {index === 0 && values.length > 1 && (
              <span className="flex-shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                main
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => {
              onRemove(v);
              setTypedValues((prev) => prev.filter((t) => t !== v));
            }}
            className="flex-shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted"
            aria-label={`Remove ${v}`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ))}
      {typedValues.some((t) => values.includes(t)) && (
        <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Typed by hand — {typedValues.filter((t) => values.includes(t)).join(", ")} is not
          on the RM or referee master, so nothing will match it automatically when the
          commission is worked out. Have them added.
        </p>
      )}
      {values.length > 1 && (
        <p className="mt-1 text-xs text-muted-foreground">
          The first name is the main referee — registration will prefill from it.
        </p>
      )}

      <div className="relative mt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          id="ref-search"
          className="pl-10"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={values.length ? "Add another referee (optional)" : "Search by name or code"}
        />
      </div>

      {search.length > 0 && search.length < 2 && (
        <p className="mt-1 text-xs text-muted-foreground">Keep typing to search…</p>
      )}

      {results.isLoading && search.length >= 2 && (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}

      {search.length >= 2 && !results.isLoading && options.length === 0 && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-xs text-amber-900">
            Nobody matches “{search}”. Best is to have them added to the master, so the
            commission has somewhere to go.
          </p>
          <TabletButton
            variant="outline"
            className="mt-2 w-full justify-start text-left"
            onClick={useAsTyped}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">Use “{search}” as typed</span>
              <span className="block text-xs font-normal text-muted-foreground">
                An exception — it will not match a commission automatically
              </span>
            </span>
          </TabletButton>
        </div>
      )}

      {options.length > 0 && (
        <div className="mt-2 space-y-1">
          {options.map((c) => (
            <TabletButton
              key={`${c.kind}:${c.value}:${c.label}`}
              variant="outline"
              className="w-full justify-start text-left"
              onClick={() => { onAdd(c); setTerm(""); }}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{c.label}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {c.kind === "rm" ? "RM" : "Referee"}
                  {c.detail ? ` · ${c.detail}` : ""}
                </span>
              </span>
            </TabletButton>
          ))}
          <button
            type="button"
            onClick={useAsTyped}
            className="w-full px-1 pt-1 text-left text-xs text-muted-foreground underline"
          >
            None of these — use “{search}” as typed
          </button>
        </div>
      )}
    </div>
  );
}
