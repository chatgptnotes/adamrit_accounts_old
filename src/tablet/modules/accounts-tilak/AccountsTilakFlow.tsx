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
  const [activeField, setActiveField] = useState<AmountField>("receipts");

  const savedEntry = useQuery({
    queryKey: ["tablet-accounts-tilak-entry", date],
    queryFn: () => loadTilakEntry(date),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (savedEntry.data) setValues(savedEntry.data);
  }, [savedEntry.data]);

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
          disabled={!allFilled || save.isPending || savedEntry.isLoading}
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
              onChange={(event) => setDate(event.target.value)}
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
      </div>
    </FlowScaffold>
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
