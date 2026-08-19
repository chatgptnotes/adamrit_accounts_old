import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { TabletInput } from "@/tablet/ui/TabletInput";

/**
 * A surgeon or anaesthetist name that is SEARCHED, not retyped, and that can be
 * saved to the master from here.
 *
 * Both fields were plain text boxes. The names were already in the database --
 * 48 surgeons in hope_surgeons and their anaesthetists in hope_anaesthetists,
 * each carrying the rates the fee master reads -- so typing the name by hand
 * meant a spelling that matched no master row. That is not cosmetic: the OT fee
 * lookup resolves an anaesthetist BY NAME to find their general and spinal
 * rates, so "Dr Mona" where the master says "Dr. Mona Basantvani" silently
 * finds no rate and the charge lands at nothing.
 *
 * Saving a new name writes it to the same master the search reads, so the next
 * schedule finds it. A name saved here carries no rates -- whoever sets fees
 * has to fill those in on the master -- and the field says so rather than
 * implying the person is fully set up.
 */

type Role = "surgeon" | "anaesthetist";

/** Which master holds this hospital's people. One table per hospital per role. */
const masterTable = (hospital: string, role: Role): string => {
  const prefix = (hospital || "").trim().toLowerCase() === "ayushman" ? "ayushman" : "hope";
  return role === "surgeon" ? `${prefix}_surgeons` : `${prefix}_anaesthetists`;
};

interface StaffNameFieldProps {
  label: string;
  role: Role;
  /** hospitalConfig.name — 'hope' or 'ayushman'. */
  hospital: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
}

export function StaffNameField({
  label,
  role,
  hospital,
  value,
  onChange,
  placeholder,
}: StaffNameFieldProps) {
  const table = masterTable(hospital, role);
  const qc = useQueryClient();
  // Whether the list is open. Typing opens it; picking or saving closes it, so
  // the suggestions do not sit over the fields below once a choice is made.
  const [open, setOpen] = useState(false);

  const names = useQuery({
    queryKey: ["ot-staff-names", table],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as any)
        .from(table)
        .select("name")
        .order("name");
      if (error) throw new Error(error.message);
      return [
        ...new Set(
          (data || [])
            .map((row: any) => String(row.name || "").trim())
            .filter(Boolean) as string[],
        ),
      ];
    },
  });

  const typed = value.trim();
  const suggestions = useMemo(() => {
    const all = names.data || [];
    if (!typed) return all.slice(0, 8);
    const needle = typed.toLowerCase();
    return all.filter((n) => n.toLowerCase().includes(needle)).slice(0, 8);
  }, [names.data, typed]);

  // An exact match means the name is already on the master, so there is nothing
  // to save. Compared case- and space-insensitively: "dr. mona basantvani" is
  // not a second person.
  const alreadyOnMaster = (names.data || []).some(
    (n) => n.trim().toLowerCase() === typed.toLowerCase(),
  );

  const save = useMutation({
    mutationFn: async () => {
      const name = typed;
      if (!name) throw new Error("Type the name first");
      // Re-check against the live master rather than the cached list: two
      // schedules being written at once must not create the same person twice.
      const { data: existing, error: readError } = await (supabase as any)
        .from(table)
        .select("name")
        .ilike("name", name)
        .limit(1);
      if (readError) throw new Error(readError.message);
      if ((existing || []).length > 0) return (existing[0] as any).name as string;

      const { error } = await (supabase as any).from(table).insert({
        name,
        // The masters distinguish OT people from other staff on the same table.
        ot_role: role,
        is_active: true,
      });
      if (error) throw new Error(error.message);
      return name;
    },
    onSuccess: (name) => {
      onChange(name);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["ot-staff-names", table] });
      toast.success(
        `${name} saved to the ${role} master. Add their rates there before the fees will fill in.`,
      );
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : `Could not save the ${role}`,
      ),
  });

  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {names.isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : null}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          value={value}
          className="pl-10"
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setOpen(true);
            onChange(event.target.value);
          }}
          // A tap outside closes it. Delayed, or the pointer-down on a
          // suggestion is lost to the blur before it registers.
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && (suggestions.length > 0 || (typed && !alreadyOnMaster)) ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border bg-background shadow-lg">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                className="block w-full border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted/60"
                onPointerDown={(event) => {
                  event.preventDefault();
                  onChange(name);
                  setOpen(false);
                }}
              >
                {name}
              </button>
            ))}
            {typed && !alreadyOnMaster ? (
              <button
                type="button"
                disabled={save.isPending}
                className="flex w-full items-center gap-2 border-t bg-emerald-50 px-3 py-2.5 text-left text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                onPointerDown={(event) => {
                  event.preventDefault();
                  save.mutate();
                }}
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Save "{typed}" as a new {role}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </label>
  );
}
