import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Trash2, Save, RotateCcw, FileSpreadsheet, GripVertical, Printer } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '@/integrations/supabase/client';

// Right-aligned numeric input that hides the native up/down spinner steppers.
const numberInputClass =
  'h-8 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

interface VendorRow {
  id: string;
  vendor: string;
  paidThisMonth: number | null;
  balanceThisMonth: number | null;
  ledgerBalance: number | null;
  payableToday: number | null;
}

interface LineItem {
  id: string;
  label: string;
  amount: number | null;
}

type LineSection = 'collections' | 'expenses' | 'banks' | 'ipdCollection';

interface SheetData {
  vendors: VendorRow[];
  collections: LineItem[];
  expenses: LineItem[];
  banks: LineItem[];
  ipdCollection: LineItem[];
}

const DEFAULT_VENDORS = [
  'GANDHI RENT',
  'GANDHI LAB RENT',
  'NEPHROPLUS',
  'HOPE ELECTRICITY',
  'AYUSHMAN ELECTRICITY',
  'PBG',
  'STAF SALARY',
  'OPD/IPD IMPLANT',
  'SURAJ SIR IMPLANT',
  'SHREE BALAJI ENTERPRISES',
  'ASIAN SURGICAL',
  'SSV PHARMACEUTICAL',
  'DR. ANKIT DHAWARE',
  'DR. MONA BASANTWANI',
];

const DEFAULT_COLLECTIONS = ['CASH COLLECTION', 'ONLINE COLLECTION'];
const DEFAULT_EXPENSES = ['CASH EXPENSES', 'ONLINE EXPENSES'];
const DEFAULT_BANKS = ['NEW CANARA', 'HOPE PHARMACY', 'SHIKSHAK SAHAKARI BANK', 'STATE BANK OF INDIA'];

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const makeEmptySheet = (): SheetData => ({
  vendors: DEFAULT_VENDORS.map((v) => ({
    id: newId(),
    vendor: v,
    paidThisMonth: null,
    balanceThisMonth: null,
    ledgerBalance: null,
    payableToday: null,
  })),
  collections: DEFAULT_COLLECTIONS.map((l) => ({ id: newId(), label: l, amount: null })),
  expenses: DEFAULT_EXPENSES.map((l) => ({ id: newId(), label: l, amount: null })),
  banks: DEFAULT_BANKS.map((l) => ({ id: newId(), label: l, amount: null })),
  ipdCollection: [{ id: newId(), label: '', amount: null }],
});

// Guard data coming back from the database (jsonb) into a well-formed sheet so a
// partial/legacy row never crashes the table render.
const normalizeSheet = (raw: unknown): SheetData => {
  const empty = makeEmptySheet();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Partial<SheetData>;
  const vendors = Array.isArray(r.vendors) ? r.vendors : empty.vendors;
  return {
    vendors: vendors.map((v) => ({
      id: v?.id ?? newId(),
      vendor: v?.vendor ?? '',
      paidThisMonth: v?.paidThisMonth ?? null,
      balanceThisMonth: v?.balanceThisMonth ?? null,
      ledgerBalance: v?.ledgerBalance ?? null,
      payableToday: v?.payableToday ?? null,
    })),
    collections: Array.isArray(r.collections) ? r.collections : empty.collections,
    expenses: Array.isArray(r.expenses) ? r.expenses : empty.expenses,
    banks: Array.isArray(r.banks) ? r.banks : empty.banks,
    ipdCollection:
      Array.isArray(r.ipdCollection) && r.ipdCollection.length > 0
        ? r.ipdCollection
        : empty.ipdCollection,
  };
};

// Open a new day from the previous day's closing sheet: keep vendor names,
// monthly paid totals, outstanding balances, and bank balances. Payable Today
// and other per-day amounts start fresh for the new date.
const carryForwardSheet = (prev: SheetData): SheetData => ({
  vendors: prev.vendors.map((v) => ({
    id: newId(),
    vendor: v.vendor,
    paidThisMonth: v.paidThisMonth,
    balanceThisMonth: v.balanceThisMonth,
    ledgerBalance: v.ledgerBalance,
    payableToday: null,
  })),
  collections: prev.collections.map((l) => ({ id: newId(), label: l.label, amount: null })),
  expenses: prev.expenses.map((l) => ({ id: newId(), label: l.label, amount: null })),
  banks: prev.banks.map((l) => ({ id: newId(), label: l.label, amount: l.amount })),
  ipdCollection: prev.ipdCollection.map((l) => ({ id: newId(), label: l.label, amount: null })),
});

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const fmtINR = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
};

const parseNumber = (value: string): number | null => {
  if (value === '' || value === '-') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const escapeHTML = (s: string): string =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

interface PrintTotals {
  vendorsTotal: number;
  collectionsTotal: number;
  netCash: number;
  grandTotal: number;
  ipdCollectionTotal: number;
}

const buildPrintHTML = (dateLabel: string, sheet: SheetData, totals: PrintTotals): string => {
  const fmt = (n: number | null | undefined): string => fmtINR(n);

  const sectionHeaderRow = (label: string): string => `
    <tr>
      <td colspan="7" class="section-header">${escapeHTML(label)}</td>
    </tr>`;

  const spacerRow = `<tr><td colspan="7" class="spacer"></td></tr>`;

  const vendorRows = sheet.vendors
    .map(
      (v, i) => `
        <tr>
          <td class="bordered center">${i + 1}</td>
          <td class="bordered">${escapeHTML(v.vendor)}</td>
          <td class="bordered num">${fmt(v.paidThisMonth)}</td>
          <td class="bordered num">${fmt(v.balanceThisMonth)}</td>
          <td class="bordered num">${fmt(v.ledgerBalance)}</td>
          <td class="bordered num">${fmt(v.payableToday)}</td>
          <td class="ghost"></td>
        </tr>`,
    )
    .join('');

  const renderSection = (
    sectionLabel: string,
    items: ReadonlyArray<LineItem>,
    totalLabel: string,
    totalValue: number,
  ): string => {
    const itemRows = items
      .map(
        (it) => `
        <tr>
          <td class="ghost"></td>
          <td class="ghost"></td>
          <td class="ghost"></td>
          <td colspan="2" class="bordered label">${escapeHTML(it.label)}</td>
          <td class="bordered num">${fmt(it.amount)}</td>
          <td class="ghost"></td>
        </tr>`,
      )
      .join('');
    const totalRow = `
      <tr>
        <td class="ghost"></td>
        <td class="ghost"></td>
        <td class="ghost"></td>
        <td colspan="2" class="bordered label subtotal">${escapeHTML(totalLabel)}</td>
        <td class="bordered num subtotal">${fmt(totalValue)}</td>
        <td class="ghost"></td>
      </tr>`;
    return `${sectionHeaderRow(sectionLabel)}${itemRows}${totalRow}`;
  };

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Today's Expenses Sheet — ${escapeHTML(dateLabel)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 14mm; color: #000; }
    .sheet-header { display: flex; justify-content: space-between; align-items: center; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 12px; margin-bottom: 14px; font-weight: 700; font-size: 13px; }
    .sheet-title { flex: 1; text-align: center; letter-spacing: 1px; }
    .sheet-date { white-space: nowrap; }
    table.main { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
    th { border: 1px solid #555; background: #d9e1f2; text-align: center; font-weight: 700; padding: 5px 6px; }
    td.bordered { border: 1px solid #555; padding: 4px 8px; vertical-align: middle; }
    td.ghost { border: none; padding: 4px 8px; background: transparent; }
    td.spacer { border: none; padding: 4px; height: 8px; background: transparent; }
    td.section-header { border: none; background: transparent; padding: 10px 0 4px; font-weight: 700; font-size: 12px; color: #1d4ed8; border-left: 3px solid #2563eb; padding-left: 8px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .center { text-align: center; }
    .label { font-weight: 600; }
    .total-row td.bordered { background: #d9e1f2; font-weight: 700; }
    .subtotal { background: #d9e1f2; font-weight: 700; }
    @page { size: A4 portrait; margin: 12mm; }
    @media print {
      body { margin: 8mm; }
      table { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet-header">
    <div class="sheet-title">TODAY EXPENSES SHEET</div>
    <div class="sheet-date">DATE: ${escapeHTML(dateLabel)}</div>
  </div>

  <table class="main">
    <colgroup>
      <col style="width:6%" />
      <col style="width:30%" />
      <col style="width:13%" />
      <col style="width:13%" />
      <col style="width:13%" />
      <col style="width:13%" />
      <col style="width:12%" />
    </colgroup>
    <tbody>
      ${sectionHeaderRow('Vendor Obligations')}
      <tr>
        <th>SR. NO.</th>
        <th>VENDORS</th>
        <th>PAID THIS MONTH</th>
        <th>BALANCE this month</th>
        <th>ledger BALANCE</th>
        <th>Payable today</th>
        <th style="border:none;background:transparent"></th>
      </tr>
      ${vendorRows}
      <tr class="total-row">
        <td class="bordered center" colspan="5">TOTAL PAYABLE TODAY</td>
        <td class="bordered num">${fmt(totals.vendorsTotal)}</td>
        <td class="ghost"></td>
      </tr>
      ${spacerRow}
      ${renderSection('Collections', sheet.collections, 'TOTAL COLLECTIONS', totals.collectionsTotal)}
      ${spacerRow}
      ${renderSection('Expenses', sheet.expenses, 'NET (Collections − Expenses)', totals.netCash)}
      ${spacerRow}
      ${renderSection('Bank Balances', sheet.banks, 'GRAND TOTAL (Banks + Net Cash)', totals.grandTotal)}
      ${spacerRow}
      ${renderSection('IPD Collection', sheet.ipdCollection, 'TOTAL IPD COLLECTION', totals.ipdCollectionTotal)}
    </tbody>
  </table>
</body>
</html>`;
};

interface SortableVendorRowProps {
  vendor: VendorRow;
  index: number;
  onUpdate: (id: string, field: keyof Omit<VendorRow, 'id'>, value: string) => void;
  onRemove: (id: string) => void;
}

function SortableVendorRow({ vendor, index, onUpdate, onRemove }: SortableVendorRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: vendor.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? '#f3f4f6' : undefined,
  };

  return (
    <TableRow ref={setNodeRef} style={style} {...attributes}>
      <TableCell
        {...listeners}
        className="cursor-grab text-gray-400 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </TableCell>
      <TableCell className="text-center">{index + 1}</TableCell>
      <TableCell>
        <Input
          value={vendor.vendor}
          onChange={(e) => onUpdate(vendor.id, 'vendor', e.target.value)}
          className="h-8"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="numeric"
          value={vendor.paidThisMonth ?? ''}
          onChange={(e) => onUpdate(vendor.id, 'paidThisMonth', e.target.value)}
          className={numberInputClass}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="numeric"
          value={vendor.balanceThisMonth ?? ''}
          onChange={(e) => onUpdate(vendor.id, 'balanceThisMonth', e.target.value)}
          className={numberInputClass}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="numeric"
          value={vendor.ledgerBalance ?? ''}
          onChange={(e) => onUpdate(vendor.id, 'ledgerBalance', e.target.value)}
          className={numberInputClass}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="numeric"
          value={vendor.payableToday ?? ''}
          onChange={(e) => onUpdate(vendor.id, 'payableToday', e.target.value)}
          className={numberInputClass}
        />
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onRemove(vendor.id)}
          className="h-7 w-7"
          aria-label="Delete vendor"
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

interface DailyAllocationSheetProps {
  hospital?: string;
}

export function DailyAllocationSheet({ hospital = 'hope' }: DailyAllocationSheetProps) {
  const [date, setDate] = useState<string>(todayISO);
  const [sheet, setSheet] = useState<SheetData>(makeEmptySheet);
  const [savedDates, setSavedDates] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loadedSheetKey, setLoadedSheetKey] = useState<string>('');
  const skipNextAutoSaveRef = useRef<boolean>(true);

  const refreshSavedDates = useCallback(async (): Promise<void> => {
    const { data, error } = await (supabase as any)
      .from('daily_allocation_sheets')
      .select('sheet_date')
      .eq('hospital_type', hospital)
      .order('sheet_date', { ascending: false });
    if (error) {
      console.error('Failed to load saved dates:', error);
      return;
    }
    setSavedDates((data ?? []).map((r: { sheet_date: string }) => r.sheet_date));
  }, [hospital]);

  useEffect(() => {
    refreshSavedDates();
  }, [refreshSavedDates]);

  // Load the sheet for the selected date from the database. If none exists yet,
  // carry the previous day's closing balances forward into a fresh sheet.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const { data: exact, error } = await (supabase as any)
          .from('daily_allocation_sheets')
          .select('data')
          .eq('hospital_type', hospital)
          .eq('sheet_date', date)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        skipNextAutoSaveRef.current = true;
        if (exact?.data) {
          setSheet(normalizeSheet(exact.data));
          setLoadedSheetKey(`${hospital}:${date}`);
          return;
        }
        const { data: prev, error: prevError } = await (supabase as any)
          .from('daily_allocation_sheets')
          .select('data')
          .eq('hospital_type', hospital)
          .lt('sheet_date', date)
          .order('sheet_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (prevError) throw prevError;
        if (cancelled) return;
        skipNextAutoSaveRef.current = true;
        setSheet(prev?.data ? carryForwardSheet(normalizeSheet(prev.data)) : makeEmptySheet());
        setLoadedSheetKey(`${hospital}:${date}`);
      } catch (err) {
        console.error('Failed to load daily allocation sheet:', err);
        if (!cancelled) {
          toast.error('Could not load the sheet from the database');
          skipNextAutoSaveRef.current = true;
          setSheet(makeEmptySheet());
          setLoadedSheetKey(`${hospital}:${date}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [date, hospital]);

  const saveSheet = useCallback(async (sheetToSave: SheetData, dateToSave: string): Promise<void> => {
    const { error } = await (supabase as any)
      .from('daily_allocation_sheets')
      .upsert(
        {
          hospital_type: hospital,
          sheet_date: dateToSave,
          data: sheetToSave,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'hospital_type,sheet_date' },
      );
    if (error) throw error;
  }, [hospital]);

  useEffect(() => {
    if (loading) return;
    if (loadedSheetKey !== `${hospital}:${date}`) return;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return;
    }

    setAutoSaveStatus('saving');
    const sheetToSave = sheet;
    const dateToSave = date;
    const timer = window.setTimeout(async () => {
      try {
        await saveSheet(sheetToSave, dateToSave);
        setAutoSaveStatus('saved');
        refreshSavedDates();
      } catch (error) {
        console.error('Failed to auto-save daily allocation sheet:', error);
        setAutoSaveStatus('error');
      }
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [date, hospital, loadedSheetKey, loading, refreshSavedDates, saveSheet, sheet]);

  const handleSave = async (): Promise<void> => {
    try {
      await saveSheet(sheet, date);
    } catch (error) {
      console.error('Failed to save daily allocation sheet:', error);
      toast.error('Failed to save — please try again');
      return;
    }
    setAutoSaveStatus('saved');
    toast.success(`Daily allocation saved for ${date}`);
    refreshSavedDates();
  };

  const handleReset = async (): Promise<void> => {
    const ok = window.confirm(`Reset the sheet for ${date}? This clears saved data for this date.`);
    if (!ok) return;
    const { error } = await (supabase as any)
      .from('daily_allocation_sheets')
      .delete()
      .eq('hospital_type', hospital)
      .eq('sheet_date', date);
    if (error) {
      console.error('Failed to reset daily allocation sheet:', error);
      toast.error('Failed to reset — please try again');
      return;
    }
    skipNextAutoSaveRef.current = true;
    setSheet(makeEmptySheet());
    setAutoSaveStatus('idle');
    refreshSavedDates();
    toast.info('Sheet reset to defaults');
  };

  const handlePrint = (): void => {
    const dateLabel = formatDateLabel(date);
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) {
      toast.error('Popup blocked — please allow popups for this site to print');
      return;
    }
    const html = buildPrintHTML(dateLabel, sheet, {
      vendorsTotal: totals.vendorsTotal,
      collectionsTotal: totals.collectionsTotal,
      netCash: totals.netCash,
      grandTotal: totals.grandTotal,
      ipdCollectionTotal: totals.ipdCollectionTotal,
    });
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // Popup may have been closed by the user before print fired — silently ignore
      }
    }, 250);
  };

  const handleDeleteSavedDate = async (d: string): Promise<void> => {
    const ok = window.confirm(`Delete the saved sheet for ${d}? This cannot be undone.`);
    if (!ok) return;
    const { error } = await (supabase as any)
      .from('daily_allocation_sheets')
      .delete()
      .eq('hospital_type', hospital)
      .eq('sheet_date', d);
    if (error) {
      console.error('Failed to delete saved sheet:', error);
      toast.error('Failed to delete — please try again');
      return;
    }
    refreshSavedDates();
    if (d === date) {
      skipNextAutoSaveRef.current = true;
      setSheet(makeEmptySheet());
      setAutoSaveStatus('idle');
    }
    toast.info(`Deleted sheet for ${d}`);
  };

  const formatDateLabel = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const updateVendor = (id: string, field: keyof Omit<VendorRow, 'id'>, value: string): void => {
    setSheet((prev) => ({
      ...prev,
      vendors: prev.vendors.map((v) => {
        if (v.id !== id) return v;
        const next = { ...v, [field]: field === 'vendor' ? value : parseNumber(value) };
        // When Paid This Month changes, deduct the change from both Balance This
        // Month and Ledger Balance (what is still outstanding goes down by what
        // was paid). Only fields that already hold a value are adjusted.
        if (field === 'paidThisMonth') {
          const delta = (next.paidThisMonth ?? 0) - (v.paidThisMonth ?? 0);
          if (v.balanceThisMonth !== null) next.balanceThisMonth = v.balanceThisMonth - delta;
          if (v.ledgerBalance !== null) next.ledgerBalance = v.ledgerBalance - delta;
        }
        return next;
      }),
    }));
  };

  const addVendor = (): void => {
    setSheet((prev) => ({
      ...prev,
      vendors: [
        ...prev.vendors,
        {
          id: newId(),
          vendor: '',
          paidThisMonth: null,
          balanceThisMonth: null,
          ledgerBalance: null,
          payableToday: null,
        },
      ],
    }));
  };

  const removeVendor = (id: string): void => {
    setSheet((prev) => ({ ...prev, vendors: prev.vendors.filter((v) => v.id !== id) }));
  };

  const updateLineItem = (section: LineSection, id: string, field: 'label' | 'amount', value: string): void => {
    setSheet((prev) => ({
      ...prev,
      [section]: prev[section].map((item) =>
        item.id === id ? { ...item, [field]: field === 'label' ? value : parseNumber(value) } : item,
      ),
    }));
  };

  const addLineItem = (section: LineSection): void => {
    setSheet((prev) => ({
      ...prev,
      [section]: [...prev[section], { id: newId(), label: '', amount: null }],
    }));
  };

  const removeLineItem = (section: LineSection, id: string): void => {
    setSheet((prev) => ({ ...prev, [section]: prev[section].filter((item) => item.id !== id) }));
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleVendorDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSheet((prev) => {
      const oldIndex = prev.vendors.findIndex((v) => v.id === active.id);
      const newIndex = prev.vendors.findIndex((v) => v.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return { ...prev, vendors: arrayMove(prev.vendors, oldIndex, newIndex) };
    });
  };

  const totals = useMemo(() => {
    const sum = (items: ReadonlyArray<{ amount: number | null }>): number =>
      items.reduce((acc, it) => acc + (it.amount ?? 0), 0);
    const vendorsTotal = sheet.vendors.reduce((acc, v) => acc + (v.payableToday ?? 0), 0);
    const collectionsTotal = sum(sheet.collections);
    const expensesTotal = sum(sheet.expenses);
    const netCash = collectionsTotal - expensesTotal;
    const banksTotal = sum(sheet.banks);
    const grandTotal = banksTotal + netCash;
    const ipdCollectionTotal = sum(sheet.ipdCollection);
    return { vendorsTotal, collectionsTotal, expensesTotal, netCash, banksTotal, grandTotal, ipdCollectionTotal };
  }, [sheet]);

  const summarySections: ReadonlyArray<{ key: LineSection; title: string; footerLabel: string; footerValue: number; centerTitle?: boolean }> = [
    { key: 'collections', title: 'Collections', footerLabel: 'TOTAL COLLECTIONS', footerValue: totals.collectionsTotal },
    { key: 'expenses', title: 'Expenses', footerLabel: 'NET (Collections − Expenses)', footerValue: totals.netCash },
    { key: 'banks', title: 'Bank Balances', footerLabel: 'GRAND TOTAL (Banks + Net Cash)', footerValue: totals.grandTotal },
    { key: 'ipdCollection', title: 'IPD Collection', footerLabel: 'TOTAL IPD COLLECTION', footerValue: totals.ipdCollectionTotal, centerTitle: true },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-blue-600" />
          <CardTitle>Daily Allocation — Today's Expenses Sheet</CardTitle>
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
          {!loading && autoSaveStatus === 'saving' && <span className="text-xs text-gray-400">Auto-saving…</span>}
          {!loading && autoSaveStatus === 'saved' && <span className="text-xs text-green-600">Saved</span>}
          {!loading && autoSaveStatus === 'error' && <span className="text-xs text-red-600">Auto-save failed</span>}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="da-date" className="text-sm">Date</Label>
          <Input
            id="da-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-auto"
          />
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1 h-4 w-4" /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-1 h-4 w-4" /> Print
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="mr-1 h-4 w-4" /> Save
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {savedDates.length > 0 && (
          <section>
            <h3 className="mb-2 font-semibold">Saved Days ({savedDates.length})</h3>
            <div className="flex flex-wrap gap-2">
              {savedDates.map((d) => (
                <div
                  key={d}
                  className={`inline-flex items-center gap-1 rounded-md border ${
                    d === date ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDate(d)}
                    className={`px-3 py-1 text-sm ${
                      d === date ? 'font-semibold text-blue-700' : 'text-gray-700 hover:text-blue-700'
                    }`}
                  >
                    {formatDateLabel(d)}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSavedDate(d)}
                    className="px-2 py-1 text-gray-400 hover:text-red-500"
                    aria-label={`Delete saved sheet for ${d}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Vendor Obligations</h3>
            <Button variant="outline" size="sm" onClick={addVendor}>
              <Plus className="mr-1 h-4 w-4" /> Add Vendor
            </Button>
          </div>
          <p className="mb-2 text-xs text-gray-500">
            All columns are editable. When you enter <strong>Paid This Month</strong>, that amount is deducted from both <strong>Balance This Month</strong> and <strong>Ledger Balance</strong>.
          </p>
          <p className="mb-2 text-xs text-gray-500">
            Tip: drag the <GripVertical className="inline h-3 w-3" /> handle on the left of any row to move important payments to the top.
          </p>
          <div className="overflow-x-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleVendorDragEnd}
            >
              <Table className="border">
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-12">SR.</TableHead>
                    <TableHead>VENDORS</TableHead>
                    <TableHead className="text-right">PAID THIS MONTH</TableHead>
                    <TableHead className="text-right">BALANCE THIS MONTH</TableHead>
                    <TableHead className="text-right">LEDGER BALANCE</TableHead>
                    <TableHead className="text-right">PAYABLE TODAY</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <SortableContext
                    items={sheet.vendors.map((v) => v.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {sheet.vendors.map((v, idx) => (
                      <SortableVendorRow
                        key={v.id}
                        vendor={v}
                        index={idx}
                        onUpdate={updateVendor}
                        onRemove={removeVendor}
                      />
                    ))}
                  </SortableContext>
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell colSpan={6} className="text-right">TOTAL PAYABLE TODAY</TableCell>
                    <TableCell className="text-right">{fmtINR(totals.vendorsTotal)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </DndContext>
          </div>
        </section>

        {summarySections.map((section) => (
          <section key={section.key}>
            <div className={`mb-2 flex items-center ${section.centerTitle ? 'relative justify-end' : 'justify-between'}`}>
              <h3 className={`font-semibold ${section.centerTitle ? 'absolute left-1/2 -translate-x-1/2' : ''}`}>
                {section.title}
              </h3>
              <Button variant="outline" size="sm" onClick={() => addLineItem(section.key)}>
                <Plus className="mr-1 h-4 w-4" /> Add Row
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table className="border">
                <TableBody>
                  {sheet[section.key].map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="w-2/3">
                        <Input
                          value={item.label}
                          onChange={(e) => updateLineItem(section.key, item.id, 'label', e.target.value)}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="numeric"
                          value={item.amount ?? ''}
                          onChange={(e) => updateLineItem(section.key, item.id, 'amount', e.target.value)}
                          className={numberInputClass}
                        />
                      </TableCell>
                      <TableCell className="w-12">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(section.key, item.id)}
                          className="h-7 w-7"
                          aria-label="Delete row"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell className="text-right">{section.footerLabel}</TableCell>
                    <TableCell className="text-right">{fmtINR(section.footerValue)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
