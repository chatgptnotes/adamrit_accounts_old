import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Landmark, Loader2, Save, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";
import { TabletNumpad } from "@/tablet/components/TabletNumpad";
import { TabletInput } from "@/tablet/ui/TabletInput";
import { useAuth } from "@/contexts/AuthContext";
import { useRef } from "react";
import { extractInvoiceFromImage, fileToBase64, suggestExpenseLedger } from "@/lib/accounting-ai";
import { inr } from "@/tablet/lib/format";

type AmountField = "receipts" | "expenses" | "cashInHand" | "cashInBank";

type FormState = Record<AmountField, string>;

const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const FIELD_LABELS: Record<AmountField, string> = {
  receipts: "Receipts",
  expenses: "Expenses",
  cashInHand: "Cash in Hand",
  cashInBank: "Cash in Bank",
};

const FIELD_ROWS: Record<AmountField, { statementKey: string; rowLabel: string }[]> = {
  receipts: [
    { statementKey: "income", rowLabel: "Daily receipts (Tilak)" },
    { statementKey: "receivables", rowLabel: "Daily receipts (Tilak)" },
  ],
  expenses: [
    { statementKey: "income", rowLabel: "Daily expenses (Tilak)" },
    { statementKey: "expense", rowLabel: "Daily expenses (Tilak)" },
    { statementKey: "payables", rowLabel: "Daily expenses (Tilak)" },
  ],
  cashInHand: [
    { statementKey: "cash_position", rowLabel: "Cash in Hand (Tilak)" },
  ],
  cashInBank: [
    { statementKey: "cash_position", rowLabel: "Cash in Bank (Tilak)" },
  ],
};

const NET_PROFIT_ROW = { statementKey: "income", rowLabel: "Net profit / loss (Tilak)" };

const numberValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseDateParts = (dateIso: string) => {
  const [year, month, day] = dateIso.split("-").map(Number);
  return { year, month, day };
};

const emptyForm: FormState = {
  receipts: "",
  expenses: "",
  cashInHand: "",
  cashInBank: "",
};

const table = () => (supabase as any).from("director_matrix_daily_entries");

async function loadTilakEntry(dateIso: string): Promise<FormState> {
  const { year, month, day } = parseDateParts(dateIso);
  const rowLabels = [
    "Daily receipts (Tilak)",
    "Daily expenses (Tilak)",
    "Cash in Hand (Tilak)",
    "Cash in Bank (Tilak)",
  ];

  const { data, error } = await table()
    .select("statement_key, row_label, amount")
    .eq("year", year)
    .eq("month", month)
    .eq("day", day)
    .in("row_label", rowLabels);

  if (error) throw error;

  const next = { ...emptyForm };
  for (const row of data || []) {
    const amount = row.amount == null ? "" : String(Number(row.amount));
    if (row.statement_key === "income" && row.row_label === "Daily receipts (Tilak)") {
      next.receipts = amount;
    }
    if (row.statement_key === "expense" && row.row_label === "Daily expenses (Tilak)") {
      next.expenses = amount;
    }
    if (row.statement_key === "cash_position" && row.row_label === "Cash in Hand (Tilak)") {
      next.cashInHand = amount;
    }
    if (row.statement_key === "cash_position" && row.row_label === "Cash in Bank (Tilak)") {
      next.cashInBank = amount;
    }
  }

  return next;
}

async function saveTilakEntry(dateIso: string, values: FormState) {
  const { year, month, day } = parseDateParts(dateIso);
  const receipts = numberValue(values.receipts);
  const expenses = numberValue(values.expenses);
  const rows = [
    ...Object.entries(FIELD_ROWS).flatMap(([field, configs]) =>
      configs.map((config) => ({
        statement_key: config.statementKey,
        row_label: config.rowLabel,
        year,
        month,
        day,
        amount: numberValue(values[field as AmountField]),
        updated_at: new Date().toISOString(),
      })),
    ),
    {
      statement_key: NET_PROFIT_ROW.statementKey,
      row_label: NET_PROFIT_ROW.rowLabel,
      year,
      month,
      day,
      amount: receipts - expenses,
      updated_at: new Date().toISOString(),
    },
  ];

  const { error } = await table().upsert(rows, {
    onConflict: "statement_key,row_label,year,month,day",
  });
  if (error) throw error;
}

export default function AccountsTilakFlow() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const [values, setValues] = useState<FormState>(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [activeField, setActiveField] = useState<AmountField>("receipts");

  const savedEntry = useQuery({
    queryKey: ["tablet-accounts-tilak-entry", date],
    queryFn: () => loadTilakEntry(date),
    staleTime: 10_000,
  });

  /**
   * Clear the form on every date change. Without this the previous date's
   * amounts stay in state, and if the new date's load fails they are still
   * sitting in the form for Save to write under the wrong date.
   */
  const changeDate = (nextDate: string) => {
    setDate(nextDate);
    setValues(emptyForm);
    setDirty(false);
  };

  useEffect(() => {
    // Never clobber unsaved typing: this query refetches on pull-to-refresh,
    // which would otherwise wipe amounts the user has entered but not saved.
    if (savedEntry.data && !dirty) setValues(savedEntry.data);
  }, [savedEntry.data, dirty]);

  const allFilled = Object.values(values).every((value) => value.trim() !== "");
  const receipts = numberValue(values.receipts);
  const expenses = numberValue(values.expenses);
  const net = receipts - expenses;

  const save = useMutation({
    mutationFn: async () => {
      if (!allFilled) throw new Error("All amount fields are mandatory.");
      await saveTilakEntry(date, values);
    },
    onSuccess: async () => {
      // Saved values are now the server's; let the refetch below repopulate.
      setDirty(false);
      const { year } = parseDateParts(date);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tablet-accounts-tilak-entry", date] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix-daily-totals"] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix-daily-entries"] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix", "income", year] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix", "expense", year] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix", "receivables", year] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix", "payables", year] }),
        queryClient.invalidateQueries({ queryKey: ["director-matrix", "cash_position", year] }),
        queryClient.invalidateQueries({ queryKey: ["director-kpis"] }),
      ]);
      toast.success("Accounts entry saved and dashboard data refreshed.");
    },
    onError: (error) => {
      toast.error((error as Error)?.message || "Could not save accounts entry.");
    },
  });

  const setFieldValue = (field: AmountField, value: string) => {
    if (value && !/^\d*\.?\d*$/.test(value)) return;
    setDirty(true);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const activeLabel = FIELD_LABELS[activeField];

  return (
    <FlowScaffold
      heading="Accounts (Tilak)"
      subheading="Daily receipts, expenses, cash position, and Director Dashboard sync"
      actions={
        <TabletButton
          className="w-full"
          // The action bar renders outside the body, so it stays visible while
          // the body shows a load error — it must disable itself explicitly.
          disabled={!allFilled || save.isPending || savedEntry.isLoading || savedEntry.isError}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          ) : (
            <Save className="mr-2 h-5 w-5" />
          )}
          Save
        </TabletButton>
      }
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <TabletCard className="border-slate-200 bg-slate-50">
          <label className="block space-y-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarDays className="h-4 w-4" />
              Date
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => changeDate(event.target.value)}
              className="h-14 w-full rounded-xl border bg-white px-4 text-xl font-semibold outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </TabletCard>

        {savedEntry.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded-2xl border bg-muted/60" />
            ))}
          </div>
        ) : savedEntry.isError ? (
          <TabletCard className="border-red-200 bg-red-50 text-red-700">
            {(savedEntry.error as Error)?.message || "Unable to load the selected date."}
          </TabletCard>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(FIELD_LABELS) as AmountField[]).map((field) => (
                <AmountInput
                  key={field}
                  field={field}
                  label={FIELD_LABELS[field]}
                  value={values[field]}
                  active={activeField === field}
                  onFocus={() => setActiveField(field)}
                  onChange={(value) => setFieldValue(field, value)}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SummaryTile
                label="Net Profit / Loss"
                value={inr(net)}
                className={net >= 0 ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}
              />
              <SummaryTile
                label="Total Cash Position"
                value={inr(numberValue(values.cashInHand) + numberValue(values.cashInBank))}
                className="border-blue-200 bg-blue-50 text-blue-900"
              />
            </div>

            <TabletCard variant="flat">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">Numeric keypad</p>
                  <p className="text-xl font-bold">{activeLabel}</p>
                </div>
                <Wallet className="h-7 w-7 text-emerald-700" />
              </div>
              <TabletNumpad
                value={values[activeField]}
                onChange={(value) => setFieldValue(activeField, value)}
                allowDecimal
                maxLength={10}
              />
            </TabletCard>
          </>
        )}
        <TilakExpenseBill />
      </div>
    </FlowScaffold>
  );
}

/**
 * Tilak's figures stay figures — but every actual counter expense is raised
 * as a real expense bill here, so the JV posts and the books carry it.
 */
function TilakExpenseBill() {
  const { user, hospitalType } = useAuth();
  const [hospital, setHospital] = useState<"hope" | "ayushman">(
    hospitalType === "ayushman" ? "ayushman" : "hope",
  );
  const [party, setParty] = useState<{ id: string; account_name: string } | null>(null);
  const [expense, setExpense] = useState<{ id: string; account_name: string } | null>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<"party" | "expense" | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  // AI: snap the vendor invoice and the form fills itself for confirmation.
  const scanInvoice = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setScanning(true);
    try {
      const { base64, mimeType } = await fileToBase64(files[0]);
      const read = await extractInvoiceFromImage(base64, mimeType);
      if (!read) throw new Error("Could not read the invoice - fill it manually");
      if (read.amount) setAmount(String(read.amount));
      const noteParts = [read.description, read.bill_number ? `bill ${read.bill_number}` : null]
        .filter(Boolean)
        .join(", ");
      if (noteParts) setNote(noteParts);
      if (read.party_name && !party) {
        setPicking("party");
        setSearch(read.party_name.split(/\s+/).slice(0, 2).join(" "));
      }
      toast.success(
        `Invoice read (${read.confidence} confidence)${read.party_name ? ` - ${read.party_name}` : ""}. Confirm the fields.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
      if (scanRef.current) scanRef.current.value = "";
    }
  };

  const [suggesting, setSuggesting] = useState(false);

  const companyKey = hospital === "ayushman" ? "ayushman_nagpur" : "drm_pvt_ltd";

  // AI: pick the right expense ledger from the narration, and say so if the
  // narration does not explain what the money was for.
  const aiSuggest = async () => {
    if (!party) {
      toast.error("Pick who was paid first");
      return;
    }
    setSuggesting(true);
    try {
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", companyKey).single();
      const { data: ledgers } = await (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name")
        .eq("is_active", true)
        .in("account_type", ["DIRECT_EXPENSES", "INDIRECT_EXPENSES", "EXPENSES"])
        .or(`company_id.eq.${company.id},company_id.is.null`)
        .limit(80);
      const names = (ledgers || []).map((l: any) => l.account_name);
      const result = await suggestExpenseLedger(note || "(no narration)", party.account_name, names);
      if (!result) throw new Error("AI could not suggest - pick manually");
      if (result.ledger) {
        const match = (ledgers || []).find(
          (l: any) => l.account_name.toLowerCase() === result.ledger!.toLowerCase(),
        );
        if (match) {
          setExpense(match);
          toast.success(`AI suggests: ${match.account_name}`);
        }
      }
      if (!result.narration_ok && result.narration_advice) {
        toast.warning(`Narration: ${result.narration_advice}`, { duration: 9000 });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };
  const { data: options = [] } = useQuery({
    queryKey: ["tilak-ledger-search", companyKey, picking, search],
    enabled: !!picking && search.trim().length >= 2,
    queryFn: async () => {
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", companyKey).single();
      let query = (supabase as any)
        .from("chart_of_accounts")
        .select("id, account_name")
        .eq("is_active", true)
        .ilike("account_name", `%${search.trim()}%`)
        .or(`company_id.eq.${company.id},company_id.is.null`)
        .order("account_name")
        .limit(10);
      if (picking === "expense") {
        query = query.in("account_type", ["DIRECT_EXPENSES", "INDIRECT_EXPENSES", "EXPENSES"]);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as { id: string; account_name: string }[];
    },
  });

  const raise = useMutation({
    mutationFn: async () => {
      const value = parseFloat(amount);
      if (!party || !expense) throw new Error("Pick who was paid and what it was for");
      if (party.id === expense.id) throw new Error("Pick two different ledgers");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter the amount");
      const { data: company } = await (supabase as any)
        .from("companies").select("id").eq("company_key", companyKey).single();
      const { data, error } = await (supabase as any)
        .from("expense_bills")
        .insert({
          bill_number: `TILAK-${Date.now()}`,
          bill_date: new Date().toISOString().slice(0, 10),
          party_ledger_id: party.id,
          expense_ledger_id: expense.id,
          amount: value,
          narration: note.trim() || `Counter expense - ${party.account_name}`,
          company_id: company.id,
          status: "POSTED",
          created_by: user?.email || "accounts-tilak",
        })
        .select("bill_number")
        .single();
      if (error) throw new Error(error.message);
      return data.bill_number as string;
    },
    onSuccess: (billNo) => {
      toast.success(`Expense bill ${billNo} raised — JV posted.`);
      setParty(null);
      setExpense(null);
      setAmount("");
      setNote("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not raise the bill"),
  });

  const pickerButton = (
    which: "party" | "expense",
    value: { account_name: string } | null,
    label: string,
  ) => (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <TabletButton
        variant="outline"
        size="default"
        className="mt-1 min-h-[44px] w-full justify-start text-sm"
        onClick={() => {
          setPicking(which);
          setSearch("");
        }}
      >
        {value?.account_name || "Tap to search…"}
      </TabletButton>
    </div>
  );

  return (
    <TabletCard className="space-y-3 p-4">
      <p className="font-semibold">Raise an expense bill (posts the JV)</p>
      <input
        ref={scanRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void scanInvoice(e.target.files)}
      />
      <TabletButton
        variant="outline"
        size="default"
        className="min-h-[44px] w-full text-sm"
        disabled={scanning}
        onClick={() => scanRef.current?.click()}
      >
        {scanning ? "Reading the invoice…" : "📸 Scan invoice with AI - fills the form"}
      </TabletButton>
      <div className="flex gap-2">
        {(["hope", "ayushman"] as const).map((h) => (
          <TabletButton
            key={h}
            size="default"
            variant={hospital === h ? "default" : "outline"}
            className="min-h-[40px] flex-1 text-sm"
            onClick={() => {
              setHospital(h);
              setParty(null);
              setExpense(null);
            }}
          >
            {h === "hope" ? "Hope" : "Ayushman"}
          </TabletButton>
        ))}
      </div>
      {pickerButton("party", party, "Paid to (party ledger)")}
      {pickerButton("expense", expense, "What it is for (expense ledger)")}
      <TabletButton
        variant="outline"
        size="default"
        className="min-h-[40px] w-full text-sm"
        disabled={suggesting}
        onClick={() => void aiSuggest()}
      >
        {suggesting ? "Thinking…" : "✨ AI: suggest the expense ledger"}
      </TabletButton>
      {picking && (
        <div className="rounded-lg border p-2">
          <TabletInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type at least 2 letters…"
            autoFocus
          />
          <div className="mt-2 grid gap-1">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="rounded border px-3 py-2 text-left text-sm active:bg-muted"
                onClick={() => {
                  if (picking === "party") setParty(option);
                  else setExpense(option);
                  setPicking(null);
                }}
              >
                {option.account_name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <TabletInput
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          className="max-w-[160px] font-mono"
        />
        <TabletInput
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Narration (optional)"
        />
      </div>
      <TabletButton
        className="w-full"
        disabled={raise.isPending}
        onClick={() => raise.mutate()}
      >
        {raise.isPending ? "Raising…" : "Raise bill & post JV"}
      </TabletButton>
    </TabletCard>
  );
}

function AmountInput({
  field,
  label,
  value,
  active,
  onFocus,
  onChange,
}: {
  field: AmountField;
  label: string;
  value: string;
  active: boolean;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  const Icon = field === "cashInBank" ? Landmark : Wallet;
  return (
    <label
      className={cn(
        "block rounded-2xl border bg-card p-4 transition-all",
        active ? "border-emerald-500 ring-2 ring-emerald-100" : "border-border",
      )}
    >
      <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <input
        value={value}
        inputMode="decimal"
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        className="h-14 w-full rounded-xl border bg-background px-4 text-right text-2xl font-bold outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

function SummaryTile({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={cn("rounded-2xl border p-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
