import { useState } from "react";
import { useDebounce } from "use-debounce";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabletInput, TabletLabel } from "@/tablet/ui/TabletInput";
import type { LedgerOption, LedgerOptionsPage } from "./useExpenseBills";

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
  useOptions: (search: string, page: number) => {
    data?: LedgerOptionsPage;
    isLoading: boolean;
    isFetching: boolean;
  };
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [debounced] = useDebounce(search, 250);
  const { data, isLoading, isFetching } = useOptions(debounced, page);
  const options = data?.options ?? [];

  if (selected && !open) {
    return (
      <div>
        <TabletLabel>{label}</TabletLabel>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSearch("");
            setPage(0);
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
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={placeholder}
          className="pl-12"
        />
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border">
        <div className="max-h-64 overflow-y-auto">
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base">{o.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[o.code, o.group || o.type].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {selected?.id === o.id && <Check className="h-5 w-5 shrink-0" />}
              </button>
            ))
          )}
        </div>
        {(page > 0 || data?.hasMore) && (
          <div className="flex items-center justify-between border-t bg-muted/30 p-2">
            <button
              type="button"
              disabled={page === 0 || isFetching}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              className="flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Page {page + 1}</span>
            <button
              type="button"
              disabled={!data?.hasMore || isFetching}
              onClick={() => setPage((value) => value + 1)}
              className="flex min-h-10 items-center gap-1 rounded-lg px-3 text-sm font-medium disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
