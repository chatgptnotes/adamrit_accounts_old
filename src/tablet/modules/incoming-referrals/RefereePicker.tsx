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
 */

export interface RefereeChoice {
  /** What gets stored on the announcement. */
  value: string;
  label: string;
  kind: "rm" | "referee";
  detail: string | null;
}

export function RefereePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (choice: RefereeChoice | null) => void;
}) {
  const [term, setTerm] = useState("");
  const search = term.trim();

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

  if (value) {
    return (
      <div>
        <TabletLabel>RM / referee</TabletLabel>
        <div className="mt-1 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-3">
          <span className="flex min-w-0 items-center gap-2">
            <Check className="h-5 w-5 flex-shrink-0 text-emerald-600" />
            <span className="truncate font-semibold">{value}</span>
          </span>
          <button
            type="button"
            onClick={() => { onChange(null); setTerm(""); }}
            className="flex-shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted"
            aria-label="Choose a different RM or referee"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TabletLabel htmlFor="ref-search">RM / referee</TabletLabel>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          id="ref-search"
          className="pl-10"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search by name or code"
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

      {search.length >= 2 && !results.isLoading && (results.data ?? []).length === 0 && (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          Nobody matches “{search}”. They have to exist in the RM or referee master
          first — ask the office to add them, so the commission has somewhere to go.
        </p>
      )}

      {(results.data ?? []).length > 0 && (
        <div className="mt-2 space-y-1">
          {(results.data ?? []).map((c) => (
            <TabletButton
              key={`${c.kind}:${c.value}:${c.label}`}
              variant="outline"
              className="w-full justify-start text-left"
              onClick={() => { onChange(c); setTerm(""); }}
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
        </div>
      )}
    </div>
  );
}
