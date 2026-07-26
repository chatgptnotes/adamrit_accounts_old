import { useState } from "react";
import { useDebounce } from "use-debounce";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import type { LedgerOption } from "./useExpenseBills";

/**
 * Type-to-search over real ledgers. Deliberately offers no way to type a free
 * name: the id picked here becomes the account a voucher posts to, so it has
 * to exist.
 */
export function LedgerPicker({
  label,
  placeholder,
  selected,
  onSelect,
  useOptions,
}: {
  label: string;
  placeholder: string;
  selected: LedgerOption | null;
  onSelect: (ledger: LedgerOption | null) => void;
  useOptions: (search: string) => {
    data?: LedgerOption[];
    isLoading: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced] = useDebounce(search, 250);
  const { data: options = [], isLoading } = useOptions(debounced);

  if (selected && !open) {
    return (
      <div>
        <TabletLabel>{label}</TabletLabel>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSearch("");
          }}
          className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border bg-background px-4 text-left"
        >
          <span className="min-w-0 flex-1 truncate text-lg font-medium">
            {selected.name}
          </span>
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <TabletLabel>{label}</TabletLabel>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <TabletInput
          autoFocus={open}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          className="pl-12"
        />
      </div>

      <div className="mt-2 max-h-64 overflow-y-auto rounded-xl border">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Searching
          </div>
        ) : options.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {search.trim().length === 1
              ? "Keep typing to search."
              : "No matching ledger. Ask an administrator to create it before recording this bill."}
          </p>
        ) : (
          options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onSelect(o);
                setOpen(false);
                setSearch("");
              }}
              className={cn(
                "flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 active:bg-muted",
                selected?.id === o.id && "bg-muted",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-base">{o.name}</span>
              {selected?.id === o.id && <Check className="h-5 w-5 shrink-0" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
