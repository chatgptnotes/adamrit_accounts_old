import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Wallet, Building2, IndianRupee, TrendingUp, TrendingDown,
  Clock, CheckCircle, AlertTriangle, Plus, Edit2, ToggleLeft,
  ToggleRight, Banknote, Calendar, RefreshCw, Save, PenLine,
  GripVertical, X, SkipForward, Users, Upload, ExternalLink, FileSpreadsheet, Printer, Eye, Search, Link as LinkIcon
} from 'lucide-react';
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
import {
  useDailyPaymentSchedule,
  useFundAccounts,
  useTodayCashCollections,
  usePaymentHistory,
  useSubAllocations,
  useSubAllocationsForSchedule,
  useAllocationSaveStatus,
  useSaveAllocation,
  useSavedAllocations,
  isDailyAllocationExecution,
  DAILY_ALLOCATION_SOURCE_PREFIX,
  getDailyAllocationNarration,
  type ScheduleEntry,
  type BankAccount,
  type SubAllocation,
  type SavedAllocation,
} from '@/hooks/useDailyPaymentAllocation';
import { usePaymentObligations, usePayeeSearch, useMultiPayeeSearch, useObligationDefaultPayees, useTallyLedgerSearch, useTallyCompanies, useAccountingLedgerSearch, useAccountingCashBankLedgers, useSaveObligationLedgerLinks, useObligationSubCategories, type PaymentObligation, type DefaultPayee, type TallyCompany, type SubCategoryRow } from '@/hooks/usePaymentObligations';
import { useCompanies } from '@/hooks/useCompanies';
import { useAuth } from '@/contexts/AuthContext';
import { DailyAllocationSheet } from '@/components/DailyAllocationSheet';
import { BeneficiaryBankHint } from '@/components/BeneficiaryBankHint';
import { useAccountingRights } from '@/components/accounting/tally/rights';

const formatINR = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

// Maps an obligation's sub_category to one of the four Obligations Master sections.
type ObligationSection = 'pharmacy_implant' | 'consultants' | 'overheads' | 'other_vendors';

const OBLIGATION_SECTIONS: { key: ObligationSection; title: string }[] = [
  { key: 'pharmacy_implant', title: 'Pharmacy & Implant Vendors' },
  { key: 'consultants',      title: 'Consultants' },
  { key: 'overheads',        title: 'Overheads (Rent, Salary, Electricity, etc.)' },
  { key: 'other_vendors',    title: 'Other Vendors' },
];

const getSectionForSubCategory = (subCategory: string | null | undefined): ObligationSection => {
  switch (subCategory) {
    case 'pharmacy':
    case 'implant':
      return 'pharmacy_implant';
    case 'consultant':
    case 'rmo':
      return 'consultants';
    case 'rent':
    case 'electricity':
    case 'salary':
    case 'dialysis':
      return 'overheads';
    default:
      return 'other_vendors';
  }
};

// Prefer the explicit section column when set; otherwise derive from sub_category
// so existing rows keep working without manual backfill.
const getSectionForObligation = (ob: { section?: string | null; sub_category?: string | null }): ObligationSection => {
  const valid: ObligationSection[] = ['pharmacy_implant', 'consultants', 'overheads', 'other_vendors'];
  if (ob.section && (valid as string[]).includes(ob.section)) return ob.section as ObligationSection;
  return getSectionForSubCategory(ob.sub_category);
};

const getAgingColor = (days: number) => {
  if (days === 0) return 'bg-green-100 text-green-800';
  if (days <= 3) return 'bg-yellow-100 text-yellow-800';
  if (days <= 7) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
};

const getAgingBorder = (days: number) => {
  if (days === 0) return 'border-l-green-500';
  if (days <= 3) return 'border-l-yellow-500';
  if (days <= 7) return 'border-l-orange-500';
  return 'border-l-red-500';
};

const today = new Date().toISOString().split('T')[0];

// Print helper — opens a new window with a styled HTML table
const printTable = (title: string, headers: string[], rows: string[][], dateLabel?: string) => {
  const fmtINR = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  void fmtINR; // used in caller; keep formatter accessible
  const headerRow = headers.map(h => `<th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:left">${h}</th>`).join('');
  const bodyRows = rows.map(r => `<tr>${r.map(c => `<td style="border:1px solid #ccc;padding:5px 10px;font-size:12px">${c}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><title>${title}</title>
<style>body{font-family:Arial,sans-serif;padding:20px;max-width:1000px;margin:0 auto}h2{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:12px}.meta{color:#666;font-size:13px;margin-bottom:10px}@media print{body{padding:10px}}</style>
</head><body><h2>${title}</h2><p class="meta">${dateLabel || new Date().toLocaleDateString('en-IN')}</p>
<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
};

// ── Sortable row for Today's Allocation table ──
interface SortableScheduleRowProps {
  entry: ScheduleEntry;
  idx: number;
  isEditing: boolean;
  editAmount: string;
  editNotes: string;
  skipConfirmId: string | null;
  subAllocations: SubAllocation[];
  companyName: string;
  ledgerName: string;
  narration: string;
  companies: Array<{ id: string; company_name: string }>;
  editParty: string;
  editCompanyId: string;
  editLedgerId: string;
  editLedgerName: string;
  editLedgerSearch: string;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditAmountChange: (v: string) => void;
  onEditNotesChange: (v: string) => void;
  onEditPartyChange: (v: string) => void;
  onEditCompanyChange: (v: string) => void;
  onEditLedgerChange: (id: string, name: string) => void;
  onEditLedgerSearchChange: (v: string) => void;
  onPay: () => void;
  onSkipConfirm: () => void;
  onSkipCancel: () => void;
  onSkip: () => void;
}

const SortableScheduleRow = ({
  entry, idx, isEditing, editAmount, editNotes, skipConfirmId,
  subAllocations, companyName, ledgerName, narration, companies,
  editParty, editCompanyId, editLedgerId, editLedgerName, editLedgerSearch,
  onStartEdit, onSaveEdit, onCancelEdit, onEditAmountChange, onEditNotesChange,
  onEditPartyChange, onEditCompanyChange, onEditLedgerChange, onEditLedgerSearchChange,
  onPay, onSkipConfirm, onSkipCancel, onSkip,
}: SortableScheduleRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id });
  const { data: editLedgers = [] } = useAccountingLedgerSearch(editLedgerSearch, editCompanyId || null);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const totalDue = entry.daily_amount + entry.carryforward_amount;
  const isSkipped = entry.status === 'skipped';

  return (
    <TableRow ref={setNodeRef} style={style} className={`border-l-4 ${getAgingBorder(entry.days_overdue)} ${isSkipped ? 'opacity-40 line-through' : ''}`}>
      {/* Drag handle */}
      <TableCell className="w-8 px-1">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded">
          <GripVertical className="h-4 w-4 text-gray-400" />
        </button>
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>
      <TableCell>
        {isEditing ? (
          <Input value={editParty} onChange={(e) => onEditPartyChange(e.target.value)} className="h-8 min-w-[180px]" />
        ) : <div className="font-medium">{entry.party_name}</div>}
        {subAllocations.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {subAllocations.map((sa) => (
              <span
                key={sa.id}
                className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full border ${
                  sa.is_paid
                    ? 'bg-green-50 border-green-300 text-green-700'
                    : 'bg-gray-50 border-gray-300 text-gray-600'
                }`}
              >
                {sa.is_paid && <CheckCircle className="h-3 w-3" />}
                {sa.payee_name} ({formatINR(sa.amount)})
              </span>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {isEditing ? (
          <select
            value={editCompanyId}
            onChange={(e) => onEditCompanyChange(e.target.value)}
            className="h-8 w-full min-w-[150px] rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Select company</option>
            {companies.map((company) => <option key={company.id} value={company.id}>{company.company_name}</option>)}
          </select>
        ) : companyName || '-'}
      </TableCell>
      <TableCell className="relative text-xs text-muted-foreground">
        {isEditing ? (
          <>
            <Input
              value={editLedgerSearch || editLedgerName}
              onChange={(e) => onEditLedgerSearchChange(e.target.value)}
              placeholder="Search ledger"
              className="h-8 min-w-[170px]"
              disabled={!editCompanyId}
            />
            {editLedgerSearch && editLedgers.length > 0 && (
              <div className="absolute left-0 top-9 z-50 max-h-48 w-64 overflow-y-auto rounded-md border bg-white shadow-lg">
                {editLedgers.map((ledger) => (
                  <button
                    key={ledger.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-blue-50"
                    onClick={() => onEditLedgerChange(ledger.id, ledger.account_name)}
                  >
                    {ledger.account_name}
                  </button>
                ))}
              </div>
            )}
            {editLedgerId && <BeneficiaryBankHint accountId={editLedgerId} />}
          </>
        ) : ledgerName ? (
          <>
            {ledgerName}
            <BeneficiaryBankHint ledgerName={ledgerName} />
          </>
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell className="max-w-[240px] text-xs text-muted-foreground">
        {isEditing ? (
          <Input
            value={editNotes}
            onChange={(e) => onEditNotesChange(e.target.value)}
            placeholder="Narration"
            className="h-8 min-w-[180px] text-xs"
          />
        ) : narration || '-'}
      </TableCell>
      <TableCell className="text-right">
        {isEditing ? (
          <Input
            type="number"
            value={editAmount}
            onChange={(e) => onEditAmountChange(e.target.value)}
            className="w-28 h-8 text-right font-mono ml-auto"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }}
          />
        ) : (
          <span className="font-mono">{formatINR(entry.daily_amount)}</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono">
        {entry.carryforward_amount > 0 ? (
          <span className="text-red-600">{formatINR(entry.carryforward_amount)}</span>
        ) : '-'}
      </TableCell>
      <TableCell className="text-right font-mono font-bold">{formatINR(totalDue)}</TableCell>
      <TableCell className="text-right font-mono">
        {entry.paid_amount > 0 ? (
          <span className="text-green-600">{formatINR(entry.paid_amount)}</span>
        ) : '-'}
      </TableCell>
      <TableCell className="text-center">
        <Badge className={`${getAgingColor(entry.days_overdue)} font-mono`}>{entry.days_overdue}d</Badge>
      </TableCell>
      <TableCell>
        <Badge className={
          entry.status === 'paid' ? 'bg-green-100 text-green-800' :
          entry.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
          entry.status === 'skipped' ? 'bg-gray-100 text-gray-500' :
          entry.status === 'carried_forward' ? 'bg-orange-100 text-orange-800' :
          'bg-gray-100 text-gray-800'
        }>
          {entry.status === 'carried_forward' ? 'Carried' : entry.status}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          {isEditing ? (
            <>
              <Button size="sm" variant="ghost" onClick={onSaveEdit} title="Save">
                <Save className="h-4 w-4 text-green-600" />
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelEdit} title="Cancel">
                <X className="h-4 w-4 text-gray-400" />
              </Button>
            </>
          ) : skipConfirmId === entry.id ? (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Skip?</span>
              <Button size="sm" variant="ghost" onClick={onSkip} className="text-red-600 h-7 px-2">Yes</Button>
              <Button size="sm" variant="ghost" onClick={onSkipCancel} className="h-7 px-2">No</Button>
            </div>
          ) : (
            <>
              {entry.status !== 'paid' && entry.status !== 'skipped' && (
                <Button size="sm" className="bg-green-600 hover:bg-green-700 h-7 px-2 text-xs" onClick={onPay}>
                  Pay
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onStartEdit} title="Edit amount">
                <Edit2 className="h-3.5 w-3.5 text-blue-600" />
              </Button>
              {entry.status !== 'paid' && entry.status !== 'skipped' && (
                <Button size="sm" variant="ghost" onClick={onSkipConfirm} title="Skip for today">
                  <SkipForward className="h-3.5 w-3.5 text-orange-500" />
                </Button>
              )}
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

// ── Sortable row for Obligations Master table ──
interface SortableObligationRowProps {
  ob: PaymentObligation;
  deleteConfirmId: string | null;
  companyName: string;
  onEdit: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

const SortableObligationRow = ({
  ob, deleteConfirmId, companyName, onEdit, onDeleteConfirm, onDeleteCancel, onDelete, onToggleActive,
}: SortableObligationRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ob.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <TableRow ref={setNodeRef} style={style} className={ob.is_active ? '' : 'opacity-50'}>
      <TableCell className="w-8 px-1">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 hover:bg-gray-100 rounded">
          <GripVertical className="h-4 w-4 text-gray-400" />
        </button>
      </TableCell>
      <TableCell>
        <div className="font-medium">{ob.party_name}</div>
        <div className="text-xs text-muted-foreground capitalize">{ob.sub_category || '-'}</div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{companyName || '-'}</TableCell>
      <TableCell>
        {ob.payee_name ? (
          <span className="text-sm">{ob.payee_name}</span>
        ) : ob.payee_search_table ? (
          <Badge variant="outline" className="text-xs">Search from master</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={ob.category === 'fixed' ? 'default' : 'outline'} className="capitalize">
          {ob.category}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono">{formatINR(ob.default_daily_amount)}</TableCell>
      <TableCell className="text-xs">
        {ob.payment_obligation_ledgers && ob.payment_obligation_ledgers.length > 0 ? (
          <div className="space-y-0.5">
            {ob.payment_obligation_ledgers.map(link => (
              <div key={link.company_id} className="flex items-center justify-between gap-2">
                <span className="text-blue-700 truncate max-w-[120px]" title={link.tally_config?.company_name || ''}>
                  {link.tally_config?.company_name || 'Unknown'}:
                </span>
                <span className="font-mono text-right whitespace-nowrap">
                  {formatINR(Number(link.tally_ledgers?.closing_balance) || 0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground italic">Not linked</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">
        {ob.approximate_balance != null ? formatINR(Number(ob.approximate_balance)) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-center">{ob.priority}</TableCell>
      <TableCell className="text-center">
        <Button variant="ghost" size="sm" onClick={onToggleActive}>
          {ob.is_active
            ? <ToggleRight className="h-5 w-5 text-green-600" />
            : <ToggleLeft className="h-5 w-5 text-gray-400" />}
        </Button>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground max-w-[150px]">
        <div className="truncate">{ob.notes || '-'}</div>
        <div className="flex items-center gap-1 mt-0.5">
          {ob.attachment_url && (
            <a href={ob.attachment_url.startsWith('http') ? ob.attachment_url : '#'} target="_blank" rel="noopener noreferrer" title="View attachment">
              <FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />
            </a>
          )}
          {ob.google_sheet_link && (
            <a href={ob.google_sheet_link} target="_blank" rel="noopener noreferrer" title="Open Google Sheet">
              <ExternalLink className="h-3.5 w-3.5 text-blue-600" />
            </a>
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} title="Edit">
            <Edit2 className="h-4 w-4 text-blue-600" />
          </Button>
          {deleteConfirmId === ob.id ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={onDelete} className="text-red-600 text-xs">Yes</Button>
              <Button size="sm" variant="ghost" onClick={onDeleteCancel} className="text-xs">No</Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={onDeleteConfirm} title="Delete">
              <span className="text-red-500 text-sm">x</span>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

const DailyPaymentAllocation = () => {
  const { canAlter: canAccessPaymentAllocation } = useAccountingRights();
  const { user } = useAuth();
  const { data: companies = [] } = useCompanies();
  const companyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    companies.forEach(c => { map[c.id] = c.company_name; });
    return map;
  }, [companies]);

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedHospital, setSelectedHospital] = useState('hope');
  const [activeTab, setActiveTab] = useState('allocation');

  // Pay dialog state
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingEntry, setPayingEntry] = useState<ScheduleEntry | null>(null);
  const [payAmount, setPayAmount] = useState('');
  // Legacy accounting selections remain stored for compatibility with older
  // schedule rows, but Daily Payment Allocation no longer uses them to post.
  const [payTallyCompanyId, setPayTallyCompanyId] = useState('');
  const [payLedgerCompanyId, setPayLedgerCompanyId] = useState('');
  const [payDebitLedgerId, setPayDebitLedgerId] = useState('');
  const [payDebitLedgerName, setPayDebitLedgerName] = useState('');
  const [payDebitLedgerSearch, setPayDebitLedgerSearch] = useState('');
  const [payCreditLedgerId, setPayCreditLedgerId] = useState('');
  const [paymentError, setPaymentError] = useState('');

  // Sub-allocation dialog mode: 'plan' = manage payees, 'confirm' = confirm payment for one payee
  const [subAllocDialogMode, setSubAllocDialogMode] = useState<'plan' | 'confirm'>('plan');
  // When confirming a single sub-allocation payment
  const [confirmingSubAlloc, setConfirmingSubAlloc] = useState<SubAllocation | null>(null);
  // New ledger allocation input (in plan mode)
  const [newPayeeAmount, setNewPayeeAmount] = useState('');

  // Add/Edit obligation dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingObligationId, setEditingObligationId] = useState<string | null>(null);
  const [newObligation, setNewObligation] = useState({
    party_name: '', category: 'variable' as 'fixed' | 'variable',
    sub_category: 'other', default_daily_amount: '',
    priority: '10', notes: '', payee_name: '', payee_search_table: '',
    attachment_url: '', google_sheet_link: '', company_id: null as string | null,
    tally_ledger_id: null as string | null, // legacy
    tally_ledger_name: '',
    tally_ledger_closing: null as number | null,
    approximate_balance: '',
    section: '' as '' | ObligationSection,
  });
  // Per-Tally-company ledger links for the obligation being edited.
  type LedgerLinkInfo = { ledgerId: string; ledgerName: string; closingBalance: number };
  const [ledgerLinks, setLedgerLinks] = useState<Record<string, LedgerLinkInfo>>({});
  const [openPickerCompanyId, setOpenPickerCompanyId] = useState<string | null>(null);
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');
  const { data: ledgerSearchResults = [] } = useTallyLedgerSearch(ledgerSearchTerm, openPickerCompanyId);
  const { data: tallyCompanies = [] } = useTallyCompanies(activeTab === 'master');
  const tallyCompanyNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    tallyCompanies.forEach((company) => {
      map[company.id] = company.company_name;
      (company.company_ids || []).forEach((id) => { map[id] = company.company_name; });
    });
    return map;
  }, [tallyCompanies]);
  const saveLedgerLinks = useSaveObligationLedgerLinks();
  const { subCategories, upsert: upsertSubCategory, remove: removeSubCategory } = useObligationSubCategories(activeTab === 'master');

  // Manage Sub-Categories dialog state
  const [manageSubCatsOpen, setManageSubCatsOpen] = useState(false);
  const [editingSubCat, setEditingSubCat] = useState<Partial<SubCategoryRow> | null>(null);

  // Payee search for sub-payments (consultant, RMO, staff)
  const [payeeSearchTerm, setPayeeSearchTerm] = useState('');
  const [selectedPayeeName, setSelectedPayeeName] = useState('');

  // Inline edit for schedule entries (Today's Allocation)
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editScheduleAmount, setEditScheduleAmount] = useState('');
  const [editScheduleNotes, setEditScheduleNotes] = useState('');
  const [editScheduleParty, setEditScheduleParty] = useState('');
  const [editScheduleCompanyId, setEditScheduleCompanyId] = useState('');
  const [editScheduleLedgerId, setEditScheduleLedgerId] = useState('');
  const [editScheduleLedgerName, setEditScheduleLedgerName] = useState('');
  const [editScheduleLedgerSearch, setEditScheduleLedgerSearch] = useState('');

  // Skip confirmation for schedule
  const [skipConfirmId, setSkipConfirmId] = useState<string | null>(null);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Drag-and-drop local order for schedule and obligations
  const [localScheduleOrder, setLocalScheduleOrder] = useState<string[] | null>(null);
  const [localObligationOrder, setLocalObligationOrder] = useState<string[] | null>(null);

  // Default payees for obligation editor
  const { defaultPayees, addPayee: addDefaultPayee, removePayee: removeDefaultPayee } = useObligationDefaultPayees(editingObligationId);
  const [defPayeeName, setDefPayeeName] = useState('');
  const [defPayeeAmount, setDefPayeeAmount] = useState('');

  // Extracted staff from uploaded Excel/CSV
  const [extractedStaff, setExtractedStaff] = useState<{ name: string; amount: number; selected: boolean }[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncingRMOs, setIsSyncingRMOs] = useState(false);

  // Expected IPD Collections
  const [expectedAyushman, setExpectedAyushman] = useState<number>(100000);
  const [expectedHope, setExpectedHope] = useState<number>(50000);
  const [defPayeeSearchTerm, setDefPayeeSearchTerm] = useState('');
  const { data: defPayeeResults = [] } = useMultiPayeeSearch(defPayeeSearchTerm, selectedHospital);

  // Add manual account dialog
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: '', type: 'bank' as 'bank' | 'cash', hospital: 'hope', balance: '', notes: '',
  });

  // Editable actual balances (local state before save)
  const [editingBalances, setEditingBalances] = useState<Record<string, { balance: string; notes: string }>>({});
  const [editingCashCollection, setEditingCashCollection] = useState<string | null>(null);
  const [actualCashCollection, setActualCashCollection] = useState('');

  // History date range
  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [historyTo, setHistoryTo] = useState(today);

  // Saved allocations state
  const [savedFrom, setSavedFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 60);
    return d.toISOString().split('T')[0];
  });
  const [savedTo, setSavedTo] = useState(today);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [saveNotes, setSaveNotes] = useState('');

  // Queries
  const { schedule, isLoading, createPaymentVoucher, saveAccountingLedgers, saveObligationDetails, updateScheduleEntry, skipEntry, reorderSchedule, refetch } = useDailyPaymentSchedule(selectedDate, selectedHospital);
  const { funds, refetch: refetchFunds, saveActualBalance, addManualAccount } = useFundAccounts(selectedDate);
  const { data: cashCollections = 0 } = useTodayCashCollections(selectedDate);

  // Save status & saved allocations
  const { isSaved, save: currentSave } = useAllocationSaveStatus(selectedDate, selectedHospital);
  const saveAllocation = useSaveAllocation();
  const { data: savedAllocations = [] } = useSavedAllocations(savedFrom, savedTo, selectedHospital, activeTab === 'saved');
  const { obligations, createObligation, updateObligation, deleteObligation, toggleActive } = usePaymentObligations(selectedHospital, activeTab === 'master');

  // Batch sub-allocations for all schedule entries (for table display)
  const scheduleIds = schedule.map(s => s.id);
  const { data: allSubAllocations = [] } = useSubAllocationsForSchedule(scheduleIds);

  // Sub-allocations for the currently open pay dialog entry
  const {
    subAllocations: dialogSubAllocations,
    removePayee,
    markPayeePaid,
  } = useSubAllocations(payingEntry?.id || null);

  // Determine which table to search for sub-payment payee
  const payingSubCategory = payingEntry
    ? obligations.find(o => o.id === payingEntry.obligation_id)?.sub_category || ''
    : '';
  const payeeTable = payingSubCategory === 'consultant' || payingSubCategory === 'rmo'
    ? (selectedHospital === 'hope' ? 'hope_consultants' : 'ayushman_consultants')
    : payingSubCategory === 'salary'
    ? 'staff_members'
    : '';
  // payeeResults for the original single-payee flow (the add-obligation dialog search term)
  const { data: payeeResults = [] } = usePayeeSearch(payeeTable, payeeSearchTerm);
  // payeeResults for the sub-allocation payee search in plan mode (multi-table search)
  const { data: history = [] } = usePaymentHistory(historyFrom, historyTo, selectedHospital, activeTab === 'history');
  const { data: payDebitLedgers = [] } = useAccountingLedgerSearch(payDebitLedgerSearch, payTallyCompanyId);
  const { data: payCreditLedgers = [] } = useAccountingCashBankLedgers(payTallyCompanyId);

  // Use actual cash if manually entered, else system value
  const effectiveCash = actualCashCollection !== '' ? parseFloat(actualCashCollection) || 0 : cashCollections;

  // Sent obligations remain visible until they are paid. Accounting company
  // and ledger values are loaded from the obligation and saved only when Pay
  // is confirmed.
  const displaySchedule = useMemo(
    () => schedule.filter((entry) => Boolean(
      entry.notes?.startsWith(DAILY_ALLOCATION_SOURCE_PREFIX)
      || entry.notes?.startsWith('Sent from Daily Allocation'),
    )),
    [schedule],
  );

  // Today’s Allocation is intentionally scoped to rows explicitly sent from
  // Daily Allocation. Master templates may still be materialized by the
  // schedule RPC, but they must not affect this page's payment totals.
  const activeSchedule = displaySchedule.filter(e => e.status !== 'skipped');
  const totalDue = activeSchedule.reduce((s, e) => s + (e.daily_amount + e.carryforward_amount), 0);
  const totalPaid = activeSchedule.reduce((s, e) => s + e.paid_amount, 0);

  // Sum ALL entered actual balances from ALL hospitals (cash + banks) + expected IPD collections
  const totalBankAndCash = funds.accounts
    .filter(a => a.actual_balance !== null)
    .reduce((s, a) => s + a.actual_balance, 0)
    + expectedAyushman
    + expectedHope;
  const totalAvailable = totalBankAndCash;
  const surplus = totalAvailable - totalDue;
  const coveragePercent = totalDue > 0 ? Math.min(Math.round((totalAvailable / totalDue) * 100), 100) : 100;

  // Print handlers
  const printAvailableFunds = () => {
    const headers = ['Account Name', 'Type', 'Hospital', 'As per Ledger', 'Actual Balance'];
    const rows = funds.accounts.map(a => [
      a.name, a.type, a.hospital,
      formatINR(a.ledger_balance),
      a.actual_balance !== null ? formatINR(a.actual_balance) : '—',
    ]);
    rows.push(['TOTAL (All Hospitals - All Cash + Banks)', '', '', formatINR(funds.totalLedger), formatINR(totalBankAndCash)]);
    printTable('Available Funds', headers, rows, selectedDate);
  };

  const printTodayAllocation = () => {
    const headers = ['#', 'Party', 'Daily Amount', 'Carry Forward', 'Total Due', 'Paid', 'Aging', 'Status'];
    const active = sortedSchedule.filter(e => e.status !== 'skipped');
    const rows = active.map((e, i) => [
      String(i + 1), e.party_name,
      formatINR(e.daily_amount), formatINR(e.carryforward_amount),
      formatINR(e.daily_amount + e.carryforward_amount),
      e.paid_amount > 0 ? formatINR(e.paid_amount) : '-',
      `${e.days_overdue}d`, e.status,
    ]);
    rows.push(['', 'TOTAL',
      formatINR(active.reduce((s, e) => s + e.daily_amount, 0)),
      formatINR(active.reduce((s, e) => s + e.carryforward_amount, 0)),
      formatINR(totalDue), formatINR(totalPaid), '', '',
    ]);
    printTable("Today's Payment Allocation", headers, rows, selectedDate);
  };

  const printDetailedAllocation = () => {
    const active = sortedSchedule.filter(e => e.status !== 'skipped');
    const dateLabel = new Date(selectedDate).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // Build rows with payee sub-rows
    let bodyHtml = '';
    let serial = 0;
    let grandDaily = 0, grandCarry = 0, grandDue = 0, grandPaid = 0;

    for (const entry of active) {
      serial++;
      const totalDueEntry = entry.daily_amount + entry.carryforward_amount;
      grandDaily += entry.daily_amount;
      grandCarry += entry.carryforward_amount;
      grandDue += totalDueEntry;
      grandPaid += entry.paid_amount;

      const subs = allSubAllocations.filter(sa => sa.schedule_id === entry.id);

      // Main party row
      bodyHtml += `<tr style="background:#fafafa;font-weight:600">
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px">${serial}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px">${entry.party_name}${getDailyAllocationNarration(entry.notes) ? `<br/><span style="font-weight:400;color:#666;font-size:11px">${getDailyAllocationNarration(entry.notes)}</span>` : ''}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${formatINR(entry.daily_amount)}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${entry.carryforward_amount > 0 ? formatINR(entry.carryforward_amount) : '-'}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right;font-weight:700">${formatINR(totalDueEntry)}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right;color:${entry.paid_amount > 0 ? 'green' : '#999'}">${entry.paid_amount > 0 ? formatINR(entry.paid_amount) : '-'}</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:center">${entry.days_overdue}d</td>
        <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px">${entry.status === 'carried_forward' ? 'Carried' : entry.status}</td>
      </tr>`;

      // Payee sub-rows
      if (subs.length > 0) {
        for (const sa of subs) {
          bodyHtml += `<tr>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px"></td>
            <td style="border:1px solid #eee;padding:3px 10px 3px 30px;font-size:11px;color:#444">↳ ${sa.payee_name}${sa.notes ? ` <span style="color:#888">(${sa.notes})</span>` : ''}</td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px;text-align:right">${formatINR(sa.amount)}</td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px"></td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px"></td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px;text-align:right;color:${sa.is_paid ? 'green' : '#999'}">${sa.is_paid ? '✓ Paid' : 'Pending'}</td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px"></td>
            <td style="border:1px solid #eee;padding:3px 10px;font-size:11px"></td>
          </tr>`;
        }
      }
    }

    // Totals row
    bodyHtml += `<tr style="background:#f0f0f0;font-weight:700">
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px"></td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px">TOTAL</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${formatINR(grandDaily)}</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${formatINR(grandCarry)}</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${formatINR(grandDue)}</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px;text-align:right">${formatINR(grandPaid)}</td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px"></td>
      <td style="border:1px solid #ccc;padding:6px 10px;font-size:12px"></td>
    </tr>`;

    const html = `<!DOCTYPE html><html><head><title>Detailed Payment Allocation</title>
<style>
body{font-family:Arial,sans-serif;padding:20px;max-width:1100px;margin:0 auto}
h2{margin-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:12px}
.meta{color:#666;font-size:13px;margin-bottom:4px}
.summary{margin-top:8px;padding:8px 12px;background:#f8f8f8;border:1px solid #ddd;border-radius:4px;font-size:12px;display:flex;gap:24px}
.summary span{font-weight:600}
@media print{body{padding:10px}.summary{break-inside:avoid}}
</style>
</head><body>
<h2>Detailed Payment Allocation — ${selectedHospital.charAt(0).toUpperCase() + selectedHospital.slice(1)}</h2>
<p class="meta">${dateLabel}</p>
<div class="summary">
  <div>Total Due: <span>${formatINR(grandDue)}</span></div>
  <div>Total Paid: <span style="color:green">${formatINR(grandPaid)}</span></div>
  <div>Balance: <span style="color:${grandDue - grandPaid > 0 ? 'red' : 'green'}">${formatINR(grandDue - grandPaid)}</span></div>
  <div>Funds Available: <span>${formatINR(totalAvailable)}</span></div>
</div>
<table>
<thead><tr>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:left">#</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:left">Party / Payee</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:right">Daily Amount</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:right">Carry Forward</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:right">Total Due</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:right">Paid</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:center">Aging</th>
  <th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;font-size:12px;text-align:left">Status</th>
</tr></thead>
<tbody>${bodyHtml}</tbody>
</table>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const printPaymentHistory = () => {
    const headers = ['Date', 'Party', 'Daily', 'Carry Fwd', 'Total Due', 'Paid', 'Aging', 'Status'];
    const rows = history.map((e: ScheduleEntry) => [
      new Date(e.schedule_date).toLocaleDateString('en-IN'), e.party_name,
      formatINR(e.daily_amount),
      e.carryforward_amount > 0 ? formatINR(e.carryforward_amount) : '-',
      formatINR(e.daily_amount + e.carryforward_amount),
      e.paid_amount > 0 ? formatINR(e.paid_amount) : '-',
      `${e.days_overdue}d`, e.status === 'carried_forward' ? 'Carried' : e.status,
    ]);
    printTable('Payment History', headers, rows, `${historyFrom} to ${historyTo}`);
  };

  // Tally stale check
  const tallyStale = funds.lastSyncAt
    ? (Date.now() - new Date(funds.lastSyncAt).getTime()) > 24 * 60 * 60 * 1000
    : true;

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Sorted schedule: use local drag order if available, else original
  const sortedSchedule = useMemo(() => {
    if (!localScheduleOrder) return displaySchedule;
    const map = new Map(displaySchedule.map(s => [s.id, s]));
    return localScheduleOrder.map(id => map.get(id)).filter(Boolean) as ScheduleEntry[];
  }, [displaySchedule, localScheduleOrder]);

  // Group schedule entries by sub_category for section totals
  const groupedSchedule = useMemo(() => {
    const obligationMap = new Map(obligations.map(o => [o.id, o]));
    const groups: { category: string; label: string; entries: ScheduleEntry[]; totalDaily: number; totalCarryforward: number; totalDue: number; totalPaid: number }[] = [];
    const categoryMap = new Map<string, ScheduleEntry[]>();

    for (const entry of sortedSchedule) {
      const ob = obligationMap.get(entry.obligation_id);
      const cat = ob?.sub_category || 'other';
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(entry);
    }

    const labelMap: Record<string, string> = {
      rent: 'Rent', dialysis: 'Dialysis', electricity: 'Electricity',
      salary: 'Staff Salary', consultant: 'Consultants', rmo: 'RMO Salary',
      referral: 'Referrals', vendor: 'Vendors', other: 'Other',
    };

    // Maintain order: rent, dialysis, electricity, salary, consultant, rmo, referral, vendor, other
    const order = ['rent', 'dialysis', 'electricity', 'salary', 'consultant', 'rmo', 'referral', 'vendor', 'other'];
    const sortedCats = [...categoryMap.keys()].sort((a, b) => {
      const ai = order.indexOf(a), bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const cat of sortedCats) {
      const entries = categoryMap.get(cat)!;
      const active = entries.filter(e => e.status !== 'skipped');
      groups.push({
        category: cat,
        label: labelMap[cat] || cat.charAt(0).toUpperCase() + cat.slice(1),
        entries,
        totalDaily: active.reduce((s, e) => s + e.daily_amount, 0),
        totalCarryforward: active.reduce((s, e) => s + e.carryforward_amount, 0),
        totalDue: active.reduce((s, e) => s + e.daily_amount + e.carryforward_amount, 0),
        totalPaid: active.reduce((s, e) => s + e.paid_amount, 0),
      });
    }
    return groups;
  }, [sortedSchedule, obligations]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOrder = localScheduleOrder || displaySchedule.map(s => s.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
    setLocalScheduleOrder(newOrder);

    // Persist priorities: position in array = priority number
    const priorityUpdates = newOrder.map((id, idx) => ({ id, priority: idx + 1 }));
    reorderSchedule.mutate(priorityUpdates);
  };

  const startEditSchedule = (entry: ScheduleEntry) => {
    setEditingScheduleId(entry.id);
    setEditScheduleParty(entry.party_name);
    setEditScheduleAmount(String(entry.daily_amount));
    setEditScheduleNotes(getDailyAllocationNarration(entry.notes));
    setEditScheduleCompanyId(entry.accounting_company_id || entry.company_id || '');
    setEditScheduleLedgerId(entry.debit_account_id || '');
    setEditScheduleLedgerName(entry.debit_account_name || '');
    setEditScheduleLedgerSearch('');
  };

  const saveEditSchedule = async () => {
    if (!editingScheduleId) return;
    if (!editScheduleParty.trim()) { toast.error('Enter a party name'); return; }
    const amount = parseFloat(editScheduleAmount);
    if (isNaN(amount) || amount < 0) { toast.error('Enter a valid amount'); return; }
    const entry = schedule.find((item) => item.id === editingScheduleId);
    if (!entry) return;
    try {
      await saveObligationDetails.mutateAsync({
        obligationId: entry.obligation_id,
        partyName: editScheduleParty.trim(),
        companyId: editScheduleCompanyId || null,
        ledgerId: editScheduleLedgerId || null,
      });
      await updateScheduleEntry.mutateAsync({
        id: editingScheduleId,
        party_name: editScheduleParty.trim(),
        daily_amount: amount,
        notes: `${DAILY_ALLOCATION_SOURCE_PREFIX}${editScheduleNotes.trim()}`,
      });
      setEditingScheduleId(null);
    } catch (error: any) {
      toast.error(`Could not save row: ${error?.message || 'unknown error'}`);
    }
  };

  const handleSkipEntry = (id: string) => {
    skipEntry.mutate(id);
    setSkipConfirmId(null);
  };

  // Sorted obligations: use local drag order if available, else original
  const sortedObligations = useMemo(() => {
    if (!localObligationOrder) return obligations;
    const map = new Map(obligations.map(o => [o.id, o]));
    return localObligationOrder.map(id => map.get(id)).filter(Boolean) as PaymentObligation[];
  }, [obligations, localObligationOrder]);

  const handleObligationDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentOrder = localObligationOrder || obligations.map(o => o.id);
    const oldIndex = currentOrder.indexOf(String(active.id));
    const newIndex = currentOrder.indexOf(String(over.id));
    const newOrder = arrayMove(currentOrder, oldIndex, newIndex);
    setLocalObligationOrder(newOrder);

    // Persist priority for each obligation
    for (let i = 0; i < newOrder.length; i++) {
      updateObligation.mutate({ id: newOrder[i], priority: i + 1 });
    }
  };

  if (!canAccessPaymentAllocation) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-yellow-500 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">Only admins and billing/accounts staff can access the Payment Allocation dashboard.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handlePay = (entry: ScheduleEntry) => {
    const remaining = entry.daily_amount + entry.carryforward_amount - entry.paid_amount;
    setPayingEntry(entry);
    setPaymentError('');
    setPayAmount(String(remaining));
    setPayTallyCompanyId(entry.accounting_company_id || entry.company_id || '');
    setPayLedgerCompanyId(entry.accounting_company_id || entry.company_id || '');
    setPayDebitLedgerId(entry.debit_account_id || '');
    setPayDebitLedgerName(entry.debit_account_name || '');
    setPayDebitLedgerSearch('');
    setPayCreditLedgerId(entry.credit_account_id || '');
    setPayeeSearchTerm('');
    setSelectedPayeeName('');
    setSubAllocDialogMode('plan');
    setConfirmingSubAlloc(null);
    setNewPayeeAmount(String(entry.daily_amount + entry.carryforward_amount - entry.paid_amount));
    setPayDialogOpen(true);
  };

  // Confirm payment for a single sub-allocation
  const handleConfirmSubPayment = (sa: SubAllocation) => {
    setPaymentError('');
    setConfirmingSubAlloc(sa);
    setPayAmount(String(sa.amount));
    setSubAllocDialogMode('confirm');
  };

  // Confirm the actual voucher creation. Ledger selection is deliberately
  // made here, after the payee plan is saved, so planning a payment never
  // posts accounting entries by itself.
  const confirmPay = async () => {
    setPaymentError('');
    if (!payingEntry) {
      setPaymentError('Payment obligation is not selected. Close this window and open Pay again.');
      return;
    }
    if (!payAmount) {
      setPaymentError('Enter a payment amount.');
      return;
    }
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) {
      setPaymentError('Enter a valid payment amount greater than zero.');
      return;
    }
    if (confirmingSubAlloc && Math.abs(amount - confirmingSubAlloc.amount) > 0.005) {
      setPaymentError('Payee payments must match the allocated amount exactly.');
      return;
    }
    try {
      // Both sides are required: the payment posts Dr party / Cr cash-bank into
      // the day book, and a half-mapped payment would leave the books unbalanced.
      if (!payTallyCompanyId || !payDebitLedgerId || !payCreditLedgerId) {
        setPaymentError('Select an Accounting company, the ledger being paid, and the cash or bank it is paid from before confirming.');
        return;
      }
      if (
        payTallyCompanyId !== (payingEntry.accounting_company_id || payingEntry.company_id || '') ||
        payDebitLedgerId !== (payingEntry.debit_account_id || '')
      ) {
        await saveAccountingLedgers.mutateAsync({
          obligationId: payingEntry.obligation_id,
          accountingCompanyId: payTallyCompanyId || null,
          debitAccountId: payDebitLedgerId || null,
        });
        setPayingEntry({
          ...payingEntry,
          company_id: payTallyCompanyId || null,
          accounting_company_id: payTallyCompanyId || null,
          debit_account_id: payDebitLedgerId || null,
          credit_account_id: payCreditLedgerId || null,
        });
      }
      const posting = await createPaymentVoucher.mutateAsync({
        scheduleId: payingEntry.id,
        amount,
        userId: user?.username || 'admin',
        payeeName: confirmingSubAlloc?.payee_name || payingEntry.party_name,
        hospitalType: selectedHospital,
        companyId: payTallyCompanyId,
        debitAccountId: payDebitLedgerId,
        creditAccountId: payCreditLedgerId,
      });
      // Link the exact accounting voucher to the sub-payee row. This keeps
      // the payee-level audit trail aligned with the parent schedule voucher.
      if (confirmingSubAlloc) {
        await markPayeePaid.mutateAsync({
          id: confirmingSubAlloc.id,
          paidBy: user?.username || 'admin',
          paymentVoucherId: posting.paymentVoucherId,
        });
      }
    } catch (error: any) {
      const message = error?.message || 'Payment could not be posted. Check the database function and account selections.';
      setPaymentError(message);
      toast.error('Payment failed: ' + message);
      return;
    }
    setPayDialogOpen(false);
  };

  // Open a printable HTML window showing obligations grouped by section.
  // Each section starts on a new page when printed. Pass a section key to
  // print only that section; pass null/undefined for the full report.
  const printObligationsReport = (onlySection: ObligationSection | null = null) => {
    const hospitalLabel = selectedHospital.charAt(0).toUpperCase() + selectedHospital.slice(1);
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const sectionsToRender = OBLIGATION_SECTIONS.filter(s => onlySection ? s.key === onlySection : true);

    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let sectionsHtml = '';
    sectionsToRender.forEach((section, idx) => {
      const rows = sortedObligations.filter(o =>
        !isDailyAllocationExecution(o.notes) && getSectionForObligation(o) === section.key,
      );
      const sectionDailyTotal = rows.reduce((sum, o) => sum + Number(o.default_daily_amount || 0), 0);
      const sectionApproxTotal = rows.reduce((sum, o) => sum + Number(o.approximate_balance || 0), 0);

      sectionsHtml += `<section class="ob-section${idx > 0 ? ' page-break' : ''}">
        <header class="ob-section-header">
          <h2>${esc(section.title)}</h2>
          <div class="ob-meta">
            <span><strong>${rows.length}</strong> obligation${rows.length === 1 ? '' : 's'}</span>
            <span>Daily Total: <strong>${formatINR(sectionDailyTotal)}</strong></span>
            <span>Approx Balance Total: <strong>${formatINR(sectionApproxTotal)}</strong></span>
          </div>
        </header>`;

      if (rows.length === 0) {
        sectionsHtml += `<p class="ob-empty">No obligations in this section.</p>`;
      } else {
        sectionsHtml += `<table>
          <thead><tr>
            <th>#</th>
            <th>Party Name</th>
            <th>Payee</th>
            <th>Category</th>
            <th class="num">Daily Amount</th>
            <th>Outstanding (per Tally company)</th>
            <th class="num">Approx Balance</th>
            <th class="num">Priority</th>
            <th>Notes</th>
          </tr></thead>
          <tbody>`;
        rows.forEach((ob, i) => {
          const ledgerLines = (ob.payment_obligation_ledgers || [])
            .map(l => `${esc(l.tally_config?.company_name || '—')}: ${formatINR(Number(l.tally_ledgers?.closing_balance) || 0)}`)
            .join('<br/>') || '<span class="muted">Not linked</span>';
          sectionsHtml += `<tr>
            <td>${i + 1}</td>
            <td><strong>${esc(ob.party_name)}</strong>${ob.sub_category ? `<div class="muted">${esc(ob.sub_category)}</div>` : ''}</td>
            <td>${esc(ob.payee_name || (ob.payee_search_table ? 'From master' : '—'))}</td>
            <td>${esc(ob.category)}</td>
            <td class="num">${formatINR(Number(ob.default_daily_amount) || 0)}</td>
            <td>${ledgerLines}</td>
            <td class="num">${ob.approximate_balance != null ? formatINR(Number(ob.approximate_balance)) : '—'}</td>
            <td class="num">${ob.priority}</td>
            <td class="notes">${esc(ob.notes || '')}</td>
          </tr>`;
        });
        sectionsHtml += `</tbody></table>`;
      }
      sectionsHtml += `</section>`;
    });

    const titleSuffix = onlySection
      ? ` — ${OBLIGATION_SECTIONS.find(s => s.key === onlySection)?.title}`
      : '';

    const html = `<!DOCTYPE html><html><head>
<title>Payment Obligations — ${esc(hospitalLabel)}${esc(titleSuffix)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:20px;color:#222}
  h1{margin:0 0 4px;font-size:20px}
  h2{margin:0 0 6px;font-size:16px;color:#1e40af}
  .doc-header{border-bottom:2px solid #1e40af;padding-bottom:8px;margin-bottom:14px}
  .doc-meta{color:#666;font-size:12px}
  .ob-section{margin-bottom:18px}
  .ob-section-header{background:#eff6ff;padding:8px 12px;border-left:4px solid #1e40af;margin-bottom:8px}
  .ob-meta{display:flex;gap:18px;font-size:12px;color:#444;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th,td{border:1px solid #ccc;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f5f5f5;font-weight:600}
  .num{text-align:right;font-family:Menlo,Consolas,monospace;white-space:nowrap}
  .muted{color:#888;font-size:10px}
  .notes{max-width:160px;font-size:10px;color:#555}
  .ob-empty{padding:10px;color:#888;font-style:italic;font-size:12px}
  .page-break{page-break-before:always;break-before:page}
  @media print{
    body{padding:8px}
    .ob-section{break-inside:auto}
    .doc-header{break-after:auto}
    table{font-size:10px}
    @page{size:A4 landscape;margin:10mm}
  }
</style>
</head><body>
<div class="doc-header">
  <h1>Payment Obligations — ${esc(hospitalLabel)}${esc(titleSuffix)}</h1>
  <div class="doc-meta">Generated: ${esc(generatedAt)} &nbsp;·&nbsp; ${onlySection ? '1 section' : `${OBLIGATION_SECTIONS.length} sections, page break between each`}</div>
</div>
${sectionsHtml}
<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else toast.error('Popup blocked — allow popups for this site to print.');
  };

  const persistLedgerLinks = (
    obligationId: string,
    linksSnapshot: { company_id: string; ledger_id: string }[],
  ) => {
    saveLedgerLinks.mutate({ obligationId, links: linksSnapshot });
  };

  const handleAddObligation = () => {
    if (!newObligation.party_name || !newObligation.default_daily_amount) {
      toast.error('Party name and daily amount are required');
      return;
    }
    const payload = {
      party_name: newObligation.party_name,
      category: newObligation.category,
      sub_category: newObligation.sub_category,
      default_daily_amount: parseFloat(newObligation.default_daily_amount),
      priority: parseInt(newObligation.priority) || 10,
      notes: newObligation.notes || null,
      hospital_name: selectedHospital,
      payee_name: newObligation.payee_name || null,
      payee_search_table: newObligation.payee_search_table || null,
      attachment_url: newObligation.attachment_url || null,
      google_sheet_link: newObligation.google_sheet_link || null,
      tally_ledger_id: newObligation.tally_ledger_id || null,
      approximate_balance: newObligation.approximate_balance === ''
        ? null
        : parseFloat(newObligation.approximate_balance),
      section: newObligation.section || null,
    };
    // Snapshot the ledger links BEFORE we reset state, so the async create
    // callback (which fires after setLedgerLinks({})) still has the picks.
    const linksSnapshot = Object.entries(ledgerLinks).map(([company_id, info]) => ({
      company_id,
      ledger_id: info.ledgerId,
    }));
    if (editingObligationId) {
      updateObligation.mutate({ id: editingObligationId, ...payload });
      persistLedgerLinks(editingObligationId, linksSnapshot);
    } else {
      createObligation.mutate(payload, {
        onSuccess: (created: any) => {
          if (created?.id) persistLedgerLinks(created.id, linksSnapshot);
        },
      });
    }
    setAddDialogOpen(false);
    setEditingObligationId(null);
    setLedgerLinks({});
    setLedgerSearchTerm('');
    setOpenPickerCompanyId(null);
    setNewObligation({ party_name: '', category: 'variable', sub_category: 'other', default_daily_amount: '', priority: '10', notes: '', payee_name: '', payee_search_table: '', attachment_url: '', google_sheet_link: '', company_id: null, tally_ledger_id: null, tally_ledger_name: '', tally_ledger_closing: null, approximate_balance: '', section: '' });
  };

  const handleEditObligation = (ob: PaymentObligation) => {
    setEditingObligationId(ob.id);
    setNewObligation({
      party_name: ob.party_name,
      category: ob.category,
      sub_category: ob.sub_category || 'other',
      default_daily_amount: String(ob.default_daily_amount),
      priority: String(ob.priority),
      notes: ob.notes || '',
      payee_name: ob.payee_name || '',
      payee_search_table: ob.payee_search_table || '',
      attachment_url: ob.attachment_url || '',
      google_sheet_link: ob.google_sheet_link || '',
      company_id: ob.company_id || null,
      tally_ledger_id: ob.tally_ledger_id || null,
      tally_ledger_name: ob.tally_ledgers?.name || '',
      tally_ledger_closing: ob.tally_ledgers?.closing_balance ?? null,
      approximate_balance: ob.approximate_balance != null ? String(ob.approximate_balance) : '',
      section: (ob.section as ObligationSection) || '',
    });
    // Hydrate per-company links from the junction table
    const hydrated: Record<string, LedgerLinkInfo> = {};
    (ob.payment_obligation_ledgers || []).forEach(link => {
      if (link.tally_ledgers) {
        hydrated[link.company_id] = {
          ledgerId: link.tally_ledgers.id,
          ledgerName: link.tally_ledgers.name,
          closingBalance: Number(link.tally_ledgers.closing_balance) || 0,
        };
      }
    });
    setLedgerLinks(hydrated);
    setLedgerSearchTerm('');
    setOpenPickerCompanyId(null);
    setAddDialogOpen(true);
  };

  const handleDeleteObligation = (id: string) => {
    deleteObligation.mutate(id);
    setDeleteConfirmId(null);
  };

  // Sync active RMOs from master tables into obligations
  const syncRMOsFromMaster = async () => {
    setIsSyncingRMOs(true);
    try {
      const rmoTable = selectedHospital === 'hope' ? 'hope_rmos' : 'ayushman_rmos';
      const { data: rmos, error: rmoError } = await (supabase as any)
        .from(rmoTable)
        .select('id, name, daily_remuneration, is_active')
        .eq('is_active', true);

      if (rmoError) throw rmoError;
      if (!rmos || rmos.length === 0) {
        toast.info('No active RMOs found in master. Add RMOs in the RMO Master page first.');
        setIsSyncingRMOs(false);
        return;
      }

      // Check which RMOs are already obligations
      const existingRMONames = new Set(
        obligations
          .filter(o => o.sub_category === 'rmo' && o.hospital_name === selectedHospital)
          .map(o => o.party_name.toLowerCase())
      );

      let added = 0;
      let updated = 0;
      for (const rmo of rmos) {
        if (existingRMONames.has(rmo.name.toLowerCase())) {
          // Update daily_remuneration if changed
          const existing = obligations.find(
            o => o.sub_category === 'rmo' && o.party_name.toLowerCase() === rmo.name.toLowerCase() && o.hospital_name === selectedHospital
          );
          if (existing && existing.default_daily_amount !== (rmo.daily_remuneration || 0)) {
            await (supabase as any).from('payment_obligations').update({
              default_daily_amount: rmo.daily_remuneration || 0,
            }).eq('id', existing.id);
            updated++;
          }
        } else {
          // Add new RMO obligation
          await (supabase as any).from('payment_obligations').insert({
            party_name: rmo.name,
            category: 'variable',
            sub_category: 'rmo',
            default_daily_amount: rmo.daily_remuneration || 0,
            priority: 50,
            is_active: true,
            hospital_name: selectedHospital,
            payee_search_table: rmoTable,
          });
          added++;
        }
      }

      if (added > 0 || updated > 0) {
        toast.success(`RMO sync: ${added} added, ${updated} updated from ${rmoTable}`);
        window.location.reload();
      } else {
        toast.info('All active RMOs are already in obligations. No changes needed.');
      }
    } catch (err) {
      toast.error('Failed to sync RMOs from master');
    }
    setIsSyncingRMOs(false);
  };

  // Save/finalize day's allocation
  const handleSaveDay = (status: 'saved' | 'finalized' | 'revised') => {
    saveAllocation.mutate({
      save_date: selectedDate,
      hospital_name: selectedHospital,
      total_due: totalDue,
      total_paid: totalPaid,
      total_available: totalAvailable,
      surplus,
      schedule_count: activeSchedule.length,
      notes: saveNotes || undefined,
      saved_by: user?.email || undefined,
      status,
    });
    setSaveConfirmOpen(false);
    setSaveNotes('');
  };

  const startEditBalance = (acc: BankAccount) => {
    setEditingBalances(prev => ({
      ...prev,
      [acc.id]: {
        balance: acc.actual_balance !== null ? String(acc.actual_balance) : String(acc.ledger_balance),
        notes: acc.notes || '',
      },
    }));
  };

  const saveBalance = (acc: BankAccount) => {
    const edit = editingBalances[acc.id];
    if (!edit) return;
    const bal = parseFloat(edit.balance);
    if (isNaN(bal)) {
      toast.error('Enter a valid amount');
      return;
    }
    saveActualBalance.mutate({
      accountRefId: acc.id,
      accountName: acc.name,
      accountType: acc.type,
      hospital: acc.hospital,
      actualBalance: bal,
      notes: edit.notes,
    });
    setEditingBalances(prev => {
      const next = { ...prev };
      delete next[acc.id];
      return next;
    });
  };

  const handleAddAccount = () => {
    if (!newAccount.name || !newAccount.balance) {
      toast.error('Account name and balance are required');
      return;
    }
    addManualAccount.mutate({
      accountName: newAccount.name,
      accountType: newAccount.type,
      hospital: newAccount.hospital,
      actualBalance: parseFloat(newAccount.balance) || 0,
      notes: newAccount.notes,
    });
    setAddAccountOpen(false);
    setNewAccount({ name: '', type: 'bank', hospital: 'hope', balance: '', notes: '' });
  };

  const handleRefreshAll = () => {
    refetch();
    refetchFunds();
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Payment Allocation</h1>
          <p className="text-sm text-muted-foreground">Manage daily payment obligations and track fund availability</p>
        </div>
        <div className="flex items-center gap-3">
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-44"
          />
          <Select value={selectedHospital} onValueChange={setSelectedHospital}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hope">Hope Hospital</SelectItem>
              <SelectItem value="ayushman">Ayushman Hospital</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={handleRefreshAll} title="Reload all data">
            <RefreshCw className="h-4 w-4" />
          </Button>
          {isSaved && currentSave && (
            <Badge className={
              currentSave.status === 'finalized' ? 'bg-green-100 text-green-800' :
              currentSave.status === 'revised' ? 'bg-blue-100 text-blue-800' :
              'bg-orange-100 text-orange-800'
            }>
              {currentSave.status === 'finalized' ? <CheckCircle className="h-3 w-3 mr-1" /> : <Save className="h-3 w-3 mr-1" />}
              {currentSave.status.charAt(0).toUpperCase() + currentSave.status.slice(1)}
            </Badge>
          )}
        </div>
      </div>

      {/* ──── AVAILABLE FUNDS SECTION ──── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5" /> Available Funds
              {tallyStale && (
                <Badge variant="outline" className="text-xs text-orange-600 ml-2">
                  {funds.lastSyncAt
                    ? `Tally synced: ${new Date(funds.lastSyncAt).toLocaleDateString('en-IN')}`
                    : 'No Tally sync'}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={printAvailableFunds}>
              <Printer className="h-3 w-3 mr-1" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={() => setAddAccountOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Add Account
            </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Cash Collections Row */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-green-700" />
                <span className="font-medium text-green-900">Today's Cash Collections</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-green-700">As per System</p>
                  <p className="font-mono font-bold text-green-800">{formatINR(cashCollections)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-blue-700">Actual Amount</p>
                  {editingCashCollection !== null ? (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        value={actualCashCollection}
                        onChange={(e) => setActualCashCollection(e.target.value)}
                        className="w-28 h-8 text-right font-mono"
                        placeholder={String(cashCollections)}
                      />
                      <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingCashCollection(null)}>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="font-mono font-bold text-blue-800">
                        {actualCashCollection !== '' ? formatINR(parseFloat(actualCashCollection) || 0) : formatINR(cashCollections)}
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => setEditingCashCollection('editing')}>
                        <PenLine className="h-3 w-3 text-gray-500" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bank/Cash Accounts Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account Name</TableHead>
                <TableHead className="text-center">Type</TableHead>
                <TableHead className="text-center">Hospital</TableHead>
                <TableHead className="text-right">As per Ledger</TableHead>
                <TableHead className="text-right">Actual Balance</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-center w-20">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {funds.accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                    No bank/cash accounts found. Sync Tally or add accounts manually.
                  </TableCell>
                </TableRow>
              ) : (
                funds.accounts.map((acc) => {
                  const isEditing = !!editingBalances[acc.id];
                  return (
                    <TableRow key={acc.id}>
                      <TableCell>
                        <div className="font-medium">{acc.name}</div>
                        {acc.last_synced && (
                          <div className="text-xs text-muted-foreground">
                            Synced: {new Date(acc.last_synced).toLocaleDateString('en-IN')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={acc.type === 'bank' ? 'default' : 'outline'} className="capitalize">
                          {acc.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center capitalize">{acc.hospital}</TableCell>
                      <TableCell className="text-right font-mono text-gray-600">
                        {formatINR(acc.ledger_balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editingBalances[acc.id].balance}
                            onChange={(e) => setEditingBalances(prev => ({
                              ...prev,
                              [acc.id]: { ...prev[acc.id], balance: e.target.value },
                            }))}
                            className="w-32 h-8 text-right font-mono ml-auto"
                          />
                        ) : (
                          <span className={`font-mono font-bold ${acc.actual_balance !== null ? 'text-blue-700' : 'text-gray-400'}`}>
                            {acc.actual_balance !== null ? formatINR(acc.actual_balance) : '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editingBalances[acc.id].notes}
                            onChange={(e) => setEditingBalances(prev => ({
                              ...prev,
                              [acc.id]: { ...prev[acc.id], notes: e.target.value },
                            }))}
                            className="h-8 text-sm"
                            placeholder="Add notes..."
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">{acc.notes || '—'}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {isEditing ? (
                          <Button size="sm" variant="ghost" onClick={() => saveBalance(acc)}>
                            <Save className="h-4 w-4 text-green-600" />
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => startEditBalance(acc)}>
                            <PenLine className="h-4 w-4 text-gray-500" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
              {/* Expected IPD Collections */}
              <TableRow className="bg-blue-50">
                <TableCell colSpan={3} className="font-medium text-blue-800">
                  Expected Collection IPD Ayushman
                </TableCell>
                <TableCell className="text-right text-gray-400">—</TableCell>
                <TableCell className="text-right">
                  <input
                    type="number"
                    value={expectedAyushman}
                    onChange={e => setExpectedAyushman(Number(e.target.value) || 0)}
                    className="w-28 text-right border rounded px-1 py-0.5 text-sm font-mono text-blue-800 bg-white"
                  />
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
              <TableRow className="bg-blue-50">
                <TableCell colSpan={3} className="font-medium text-blue-800">
                  Expected Collection IPD Hope
                </TableCell>
                <TableCell className="text-right text-gray-400">—</TableCell>
                <TableCell className="text-right">
                  <input
                    type="number"
                    value={expectedHope}
                    onChange={e => setExpectedHope(Number(e.target.value) || 0)}
                    className="w-28 text-right border rounded px-1 py-0.5 text-sm font-mono text-blue-800 bg-white"
                  />
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
              {/* Totals */}
              <TableRow className="bg-green-50 font-bold border-t-2 border-green-200">
                <TableCell colSpan={3} className="text-green-800">
                  TOTAL (All Hospitals - All Cash + Banks)
                </TableCell>
                <TableCell className="text-right font-mono text-gray-600">
                  {formatINR(funds.accounts.reduce((s, a) => s + a.ledger_balance, 0))}
                </TableCell>
                <TableCell className="text-right font-mono text-green-800 text-base">{formatINR(totalBankAndCash)}</TableCell>
                <TableCell colSpan={2}></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary Row: Total Available vs Total Due */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Total Available (Actual + Expected IPD)</div>
            <p className="text-2xl font-bold text-green-700">{formatINR(totalAvailable)}</p>
            <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <div>Actual (All Accounts): <span className="font-medium">{formatINR(funds.accounts.filter(a => a.actual_balance !== null).reduce((s,a)=>s+a.actual_balance,0))}</span></div>
              <div>Expected IPD Ayushman: <span className="font-medium">{formatINR(expectedAyushman)}</span></div>
              <div>Expected IPD Hope: <span className="font-medium">{formatINR(expectedHope)}</span></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Total Obligations Due</div>
            <p className="text-2xl font-bold text-red-700">{formatINR(totalDue)}</p>
            <p className="text-xs text-muted-foreground mt-1">Paid: {formatINR(totalPaid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
              {surplus >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {surplus >= 0 ? 'Surplus' : 'Deficit'}
            </div>
            <p className={`text-2xl font-bold ${surplus >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {formatINR(Math.abs(surplus))}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Coverage Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Obligations Coverage</span>
            <span className="text-sm font-bold">{coveragePercent}%</span>
          </div>
          <Progress value={coveragePercent} className="h-3" />
          <div className="flex justify-between mt-1 text-xs text-muted-foreground">
            <span>Paid: {formatINR(totalPaid)}</span>
            <span>Remaining: {formatINR(totalDue - totalPaid)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5">
          <TabsTrigger value="allocation">
            Today's Allocation
            {displaySchedule.filter(s => s.status === 'pending').length > 0 && (
              <Badge className="ml-2 bg-red-500">{displaySchedule.filter(s => s.status === 'pending').length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="saved">
            Saved Days
            {savedAllocations.length > 0 && (
              <Badge className="ml-2 bg-blue-500">{savedAllocations.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="master">Obligations Master</TabsTrigger>
          <TabsTrigger value="history">Payment History</TabsTrigger>
          <TabsTrigger value="daily-allocation">Daily Allocation</TabsTrigger>
        </TabsList>

        {/* TAB 1: Today's Allocation — drag-and-drop, inline edit, skip */}
        <TabsContent value="allocation" className="mt-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading schedule...</div>
          ) : displaySchedule.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No obligations with a selected ledger are scheduled for {selectedDate}.
            </div>
          ) : (
            <Card>
              <div className="px-4 py-2 border-b bg-gray-50 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Drag rows to reorder priority. Click pencil to edit amount. Click X to skip.</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={printTodayAllocation}>
                    <Printer className="h-3 w-3 mr-1" /> Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={printDetailedAllocation}>
                    <Users className="h-3 w-3 mr-1" /> Detailed Print
                  </Button>
                  {!isSaved ? (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => setSaveConfirmOpen(true)}
                    >
                      <Save className="h-3 w-3 mr-1" /> Save Day
                    </Button>
                  ) : currentSave?.status === 'saved' ? (
                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => handleSaveDay('finalized')}
                      disabled={saveAllocation.isPending}
                    >
                      <CheckCircle className="h-3 w-3 mr-1" /> Finalize
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-300 text-blue-700"
                      onClick={() => handleSaveDay('revised')}
                      disabled={saveAllocation.isPending}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" /> Re-save
                    </Button>
                  )}
                </div>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Party</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Ledger</TableHead>
                      <TableHead>Narration</TableHead>
                      <TableHead className="text-right">Daily Amount</TableHead>
                      <TableHead className="text-right">Carry Forward</TableHead>
                      <TableHead className="text-right">Total Due</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-center">Aging</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <SortableContext items={sortedSchedule.map(s => s.id)} strategy={verticalListSortingStrategy}>
                    <TableBody>
                      {(() => {
                        let globalIdx = 0;
                        return groupedSchedule.map((group) => (
                          <React.Fragment key={group.category}>
                            {/* Section Header */}
                            <TableRow className="bg-blue-50 border-t-2 border-blue-200">
                              <TableCell colSpan={13} className="py-2">
                                <span className="font-semibold text-blue-800 text-sm uppercase tracking-wide">{group.label}</span>
                                <span className="text-xs text-blue-600 ml-2">({group.entries.length} items)</span>
                              </TableCell>
                            </TableRow>
                            {/* Section Entries */}
                            {group.entries.map((entry) => {
                              const idx = globalIdx++;
                              return (
                                <SortableScheduleRow
                                  key={entry.id}
                                  entry={entry}
                                  idx={idx}
                                  isEditing={editingScheduleId === entry.id}
                                  editAmount={editScheduleAmount}
                                  editNotes={editScheduleNotes}
                                  skipConfirmId={skipConfirmId}
                                  subAllocations={allSubAllocations.filter(sa => sa.schedule_id === entry.id)}
                                  companyName={entry.accounting_company_id
                                    ? (companyNameMap[entry.accounting_company_id] || '')
                                    : (entry.company_id ? (companyNameMap[entry.company_id] || '') : '')}
                                  ledgerName={entry.debit_account_name || ''}
                                  narration={getDailyAllocationNarration(entry.notes)}
                                  companies={companies}
                                  editParty={editScheduleParty}
                                  editCompanyId={editScheduleCompanyId}
                                  editLedgerId={editScheduleLedgerId}
                                  editLedgerName={editScheduleLedgerName}
                                  editLedgerSearch={editScheduleLedgerSearch}
                                  onStartEdit={() => startEditSchedule(entry)}
                                  onSaveEdit={saveEditSchedule}
                                  onCancelEdit={() => setEditingScheduleId(null)}
                                  onEditAmountChange={setEditScheduleAmount}
                                  onEditNotesChange={setEditScheduleNotes}
                                  onEditPartyChange={setEditScheduleParty}
                                  onEditCompanyChange={(companyId) => {
                                    setEditScheduleCompanyId(companyId);
                                    setEditScheduleLedgerId('');
                                    setEditScheduleLedgerName('');
                                    setEditScheduleLedgerSearch('');
                                  }}
                                  onEditLedgerChange={(ledgerId, ledgerName) => {
                                    setEditScheduleLedgerId(ledgerId);
                                    setEditScheduleLedgerName(ledgerName);
                                    setEditScheduleLedgerSearch('');
                                  }}
                                  onEditLedgerSearchChange={(value) => {
                                    setEditScheduleLedgerSearch(value);
                                    setEditScheduleLedgerId('');
                                    setEditScheduleLedgerName('');
                                  }}
                                  onPay={() => handlePay(entry)}
                                  onSkipConfirm={() => setSkipConfirmId(entry.id)}
                                  onSkipCancel={() => setSkipConfirmId(null)}
                                  onSkip={() => handleSkipEntry(entry.id)}
                                />
                              );
                            })}
                            {/* Section Subtotal */}
                            <TableRow className="bg-blue-50/50 border-b border-blue-100">
                              <TableCell colSpan={6} className="text-right text-xs font-semibold text-blue-700">
                                {group.label} Subtotal
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-blue-700">{formatINR(group.totalDaily)}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-red-600">{formatINR(group.totalCarryforward)}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold text-blue-800">{formatINR(group.totalDue)}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold text-green-600">{formatINR(group.totalPaid)}</TableCell>
                              <TableCell colSpan={3}></TableCell>
                            </TableRow>
                          </React.Fragment>
                        ));
                      })()}
                      {/* Grand Total */}
                      <TableRow className="bg-gray-100 font-bold border-t-2 border-gray-300">
                        <TableCell colSpan={6} className="text-sm">GRAND TOTAL</TableCell>
                        <TableCell className="text-right font-mono">{formatINR(sortedSchedule.filter(e => e.status !== 'skipped').reduce((s, e) => s + e.daily_amount, 0))}</TableCell>
                        <TableCell className="text-right font-mono text-red-600">{formatINR(sortedSchedule.filter(e => e.status !== 'skipped').reduce((s, e) => s + e.carryforward_amount, 0))}</TableCell>
                        <TableCell className="text-right font-mono">{formatINR(totalDue)}</TableCell>
                        <TableCell className="text-right font-mono text-green-600">{formatINR(totalPaid)}</TableCell>
                        <TableCell colSpan={3}></TableCell>
                      </TableRow>
                    </TableBody>
                  </SortableContext>
                </Table>
              </DndContext>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2: Obligations Master */}
        <TabsContent value="master" className="mt-4 space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h3 className="text-lg font-semibold">Payment Obligations</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => printObligationsReport(null)}
                title="Print all sections — each on a new page"
              >
                <Printer className="h-4 w-4 mr-1" /> Print / PDF
              </Button>
              <Button
                variant="outline"
                onClick={syncRMOsFromMaster}
                disabled={isSyncingRMOs}
                className="bg-orange-50 hover:bg-orange-100 border-orange-200 text-orange-700"
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isSyncingRMOs ? 'animate-spin' : ''}`} />
                {isSyncingRMOs ? 'Syncing...' : 'Sync RMOs from Master'}
              </Button>
              <Button onClick={() => { setEditingObligationId(null); setNewObligation({ party_name: '', category: 'variable', sub_category: 'other', default_daily_amount: '', priority: '10', notes: '', payee_name: '', payee_search_table: '', attachment_url: '', google_sheet_link: '', company_id: null, tally_ledger_id: null, tally_ledger_name: '', tally_ledger_closing: null, approximate_balance: '', section: '' }); setLedgerLinks({}); setLedgerSearchTerm(''); setOpenPickerCompanyId(null); setAddDialogOpen(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Add Obligation
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Drag rows within a section to reorder priority. Lower position = paid first.
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleObligationDragEnd}>
            {OBLIGATION_SECTIONS.map(section => {
              const rows = sortedObligations.filter(o =>
                !isDailyAllocationExecution(o.notes) && getSectionForObligation(o) === section.key,
              );
              return (
                <Card key={section.key} className="overflow-hidden">
                  <div className="px-4 py-2 border-b bg-blue-50 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-blue-900">{section.title}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-blue-700">{rows.length} {rows.length === 1 ? 'obligation' : 'obligations'}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-blue-700 hover:bg-blue-100"
                        onClick={() => printObligationsReport(section.key)}
                        title={`Print only ${section.title}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Party Name</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Payee</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Daily Amount</TableHead>
                        <TableHead>Outstanding (per Tally company)</TableHead>
                        <TableHead className="text-right">Approx Balance</TableHead>
                        <TableHead className="text-center">Priority</TableHead>
                        <TableHead className="text-center">Active</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-center">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <SortableContext items={rows.map(o => o.id)} strategy={verticalListSortingStrategy}>
                      <TableBody>
                        {rows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={12} className="text-center py-4 text-muted-foreground text-xs italic">
                              No obligations in this section yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          rows.map((ob: PaymentObligation) => (
                            <SortableObligationRow
                              key={ob.id}
                              ob={ob}
                              deleteConfirmId={deleteConfirmId}
                              companyName={ob.company_id ? (companyNameMap[ob.company_id] || '') : ''}
                              onEdit={() => handleEditObligation(ob)}
                              onDeleteConfirm={() => setDeleteConfirmId(ob.id)}
                              onDeleteCancel={() => setDeleteConfirmId(null)}
                              onDelete={() => handleDeleteObligation(ob.id)}
                              onToggleActive={() => toggleActive.mutate({ id: ob.id, is_active: !ob.is_active })}
                            />
                          ))
                        )}
                      </TableBody>
                    </SortableContext>
                  </Table>
                </Card>
              );
            })}
          </DndContext>
        </TabsContent>

        {/* TAB 3: Payment History */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} className="w-40" />
            </div>
            <Button variant="outline" size="sm" onClick={printPaymentHistory} className="mt-4">
              <Printer className="h-3 w-3 mr-1" /> Print
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead className="text-right">Daily</TableHead>
                  <TableHead className="text-right">Carry Fwd</TableHead>
                  <TableHead className="text-right">Total Due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-center">Aging</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No payment history for selected date range.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((entry: ScheduleEntry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{new Date(entry.schedule_date).toLocaleDateString('en-IN')}</TableCell>
                      <TableCell className="font-medium">{entry.party_name}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(entry.daily_amount)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.carryforward_amount > 0 ? formatINR(entry.carryforward_amount) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold">
                        {formatINR(entry.daily_amount + entry.carryforward_amount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.paid_amount > 0 ? <span className="text-green-600">{formatINR(entry.paid_amount)}</span> : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={`${getAgingColor(entry.days_overdue)} font-mono`}>{entry.days_overdue}d</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          entry.status === 'paid' ? 'bg-green-100 text-green-800' :
                          entry.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                          entry.status === 'carried_forward' ? 'bg-orange-100 text-orange-800' :
                          'bg-gray-100 text-gray-800'
                        }>
                          {entry.status === 'carried_forward' ? 'Carried' : entry.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* TAB: Saved Allocations */}
        <TabsContent value="saved" className="mt-4 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={savedFrom} onChange={(e) => setSavedFrom(e.target.value)} className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={savedTo} onChange={(e) => setSavedTo(e.target.value)} className="w-40" />
            </div>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Hospital</TableHead>
                  <TableHead className="text-right">Total Due</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Surplus / Deficit</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Saved By</TableHead>
                  <TableHead>Saved At</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {savedAllocations.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                      No saved allocations for this date range. Save a day's allocation from the "Today's Allocation" tab.
                    </TableCell>
                  </TableRow>
                ) : (
                  savedAllocations.map((sa: SavedAllocation) => (
                    <TableRow key={sa.id} className="hover:bg-blue-50/50 cursor-pointer">
                      <TableCell className="font-medium">{new Date(sa.save_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</TableCell>
                      <TableCell className="capitalize text-xs">{sa.hospital_name}</TableCell>
                      <TableCell className="text-right font-mono text-red-700">{formatINR(sa.total_due)}</TableCell>
                      <TableCell className="text-right font-mono text-green-700">{formatINR(sa.total_paid)}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(sa.total_available)}</TableCell>
                      <TableCell className={`text-right font-mono font-bold ${sa.surplus >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {sa.surplus >= 0 ? '+' : ''}{formatINR(sa.surplus)}
                      </TableCell>
                      <TableCell className="text-center font-mono">{sa.schedule_count}</TableCell>
                      <TableCell>
                        <Badge className={
                          sa.status === 'finalized' ? 'bg-green-100 text-green-800' :
                          sa.status === 'revised' ? 'bg-blue-100 text-blue-800' :
                          'bg-orange-100 text-orange-800'
                        }>
                          {sa.status.charAt(0).toUpperCase() + sa.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{sa.saved_by || '-'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(sa.saved_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{sa.notes || '-'}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => { setSelectedDate(sa.save_date); setActiveTab('allocation'); }}
                        >
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* TAB 5: Daily Allocation — editable today's expenses sheet (database-backed, carries forward) */}
        <TabsContent value="daily-allocation" className="mt-4">
          <DailyAllocationSheet
            hospital={selectedHospital}
            onSent={({ date }) => {
              setSelectedDate(date);
              setActiveTab('allocation');
              void refetch();
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Save Day Confirmation Dialog */}
      <Dialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Save className="h-5 w-5 text-green-600" />
              Save Day's Allocation
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Save allocation for <strong>{new Date(selectedDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong> — <strong className="capitalize">{selectedHospital}</strong>
            </div>
            <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg">
              <div>
                <div className="text-xs text-muted-foreground">Total Due</div>
                <div className="font-mono font-bold text-red-700">{formatINR(totalDue)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Total Paid</div>
                <div className="font-mono font-bold text-green-700">{formatINR(totalPaid)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="font-mono font-bold">{formatINR(totalAvailable)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Surplus / Deficit</div>
                <div className={`font-mono font-bold ${surplus >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {surplus >= 0 ? '+' : ''}{formatINR(surplus)}
                </div>
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                value={saveNotes}
                onChange={(e) => setSaveNotes(e.target.value)}
                placeholder="Any remarks for this day's allocation..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveConfirmOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={() => handleSaveDay('saved')}
              disabled={saveAllocation.isPending}
            >
              {saveAllocation.isPending ? 'Saving...' : 'Save Allocation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay Dialog — create a Payment Voucher only */}
      <Dialog open={payDialogOpen} onOpenChange={(open) => { setPayDialogOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {subAllocDialogMode === 'plan' ? (
                <><Wallet className="h-5 w-5" /> Payment Setup — {payingEntry?.party_name}</>
              ) : (
                <><CheckCircle className="h-5 w-5 text-green-600" /> Confirm Payment</>
              )}
            </DialogTitle>
          </DialogHeader>

          {payingEntry && subAllocDialogMode === 'plan' && (
            <div className="space-y-4">
              {/* Summary bar */}
              <div className="bg-gray-50 rounded-lg p-3 flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Due: </span>
                  <span className="font-semibold">{formatINR(payingEntry.daily_amount + payingEntry.carryforward_amount)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Allocated: </span>
                  <span className={`font-semibold ${
                    dialogSubAllocations.reduce((s, sa) => s + sa.amount, 0) > (payingEntry.daily_amount + payingEntry.carryforward_amount)
                      ? 'text-red-600' : 'text-blue-700'
                  }`}>
                    {formatINR(dialogSubAllocations.reduce((s, sa) => s + sa.amount, 0))}
                  </span>
                </div>
                {payingEntry.days_overdue > 0 && (
                  <Badge className={getAgingColor(payingEntry.days_overdue)}>{payingEntry.days_overdue}d overdue</Badge>
                )}
              </div>

              {/* Accounting setup is saved to the obligation only when the
                  payment is confirmed. */}
              <div className="border rounded-md p-3 space-y-3 bg-amber-50/40">
                <p className="text-xs font-semibold text-amber-900">Accounting details for this payment</p>
                <div>
                  <Label className="text-xs">Company</Label>
                  <Select
                    value={payTallyCompanyId}
                    onValueChange={(value) => {
                      setPayTallyCompanyId(value);
                      setPayLedgerCompanyId(value);
                      setPayDebitLedgerId('');
                      setPayDebitLedgerName('');
                      setPayDebitLedgerSearch('');
                      setPayCreditLedgerId('');
                    }}
                  >
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select company first" /></SelectTrigger>
                    <SelectContent>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>{company.company_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="relative">
                  <Label className="text-xs">Ledger to Pay (Debit)</Label>
                  <Input
                    value={payDebitLedgerSearch || payDebitLedgerName || ''}
                    onChange={(e) => {
                      setPayDebitLedgerSearch(e.target.value);
                      setPayDebitLedgerId('');
                      setPayDebitLedgerName('');
                    }}
                    placeholder="Search expense or payable ledger"
                    className="mt-1 h-8 text-sm"
                    disabled={!payTallyCompanyId}
                  />
                  {payDebitLedgerSearch.length >= 1 && payDebitLedgers.length > 0 && (
                    <div className="absolute left-0 right-0 top-[3.75rem] z-50 max-h-44 overflow-y-auto rounded-md border bg-white shadow-lg">
                      {payDebitLedgers.map((ledger: any) => (
                        <button
                          key={ledger.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                          onClick={() => {
                            setPayDebitLedgerId(ledger.id);
                            setPayTallyCompanyId(ledger.company_id || payTallyCompanyId);
                            setPayLedgerCompanyId(ledger.company_id || payTallyCompanyId);
                            setPayDebitLedgerName(ledger.account_name);
                            setPayDebitLedgerSearch('');
                          }}
                        >
                        <span className="font-medium">{ledger.account_name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{ledger.account_group || ledger.account_type || 'Accounting ledger'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {payDebitLedgerId && (
                    <>
                      <p className="mt-1 text-xs text-green-700">Selected: {payDebitLedgerName || payDebitLedgerId}</p>
                      <BeneficiaryBankHint accountId={payDebitLedgerId} onUseBank={setPayCreditLedgerId} />
                    </>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Pay From (Credit Cash / Bank)</Label>
                  <Select value={payCreditLedgerId} onValueChange={setPayCreditLedgerId}>
                    <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue placeholder="Select Cash or Bank account" /></SelectTrigger>
                    <SelectContent>
                      {payCreditLedgers.map((ledger: any) => (
                        <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.account_group || 'Cash/Bank'})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount to Pay (Rs.)</Label>
                  <Input
                    type="number"
                    value={newPayeeAmount}
                    onChange={(e) => setNewPayeeAmount(e.target.value)}
                    placeholder="Enter amount"
                    className="mt-1 h-8 text-sm"
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                This action creates only a Payment Voucher. No Journal Voucher or ledger posting is created.
                </p>
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
                <Label className="text-xs">Amount to Pay (Rs.)</Label>
                <Input
                  type="number"
                  value={newPayeeAmount}
                  onChange={(e) => setNewPayeeAmount(e.target.value)}
                  className="mt-1"
                  min="0.01"
                  step="0.01"
                />
                <p className="mt-1 text-xs text-muted-foreground">Only a Payment Voucher will be created.</p>
              </div>

              {/* Existing sub-allocations list */}
              {dialogSubAllocations.length > 0 && (
                <div className="border rounded-md divide-y">
                  {dialogSubAllocations.map((sa) => (
                    <div key={sa.id} className="flex items-center gap-2 px-3 py-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sa.is_paid ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="flex-1 text-sm font-medium">{sa.payee_name}</span>
                      <span className="font-mono text-sm text-gray-700">{formatINR(sa.amount)}</span>
                      {sa.is_paid ? (
                        <Badge className="bg-green-100 text-green-700 text-xs">Paid</Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="h-6 px-2 text-xs bg-green-600 hover:bg-green-700"
                          onClick={() => handleConfirmSubPayment(sa)}
                        >
                          Pay
                        </Button>
                      )}
                      {!sa.is_paid && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removePayee.mutate(sa.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* No sub-allocations — show single-payee fallback info */}
              {dialogSubAllocations.length === 0 && !payeeTable && (
                (() => {
                  const ob = obligations.find(o => o.id === payingEntry.obligation_id);
                  return ob?.payee_name ? (
                    <div className="bg-blue-50 rounded p-2 text-sm">
                      <span className="text-muted-foreground">Paying to: </span>
                      <span className="font-semibold">{ob.payee_name}</span>
                    </div>
                  ) : null;
                })()
              )}
            </div>
          )}

          {payingEntry && subAllocDialogMode === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Party:</span>
                  <span className="font-semibold">{payingEntry.party_name}</span>
                </div>
                {confirmingSubAlloc && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Payee:</span>
                    <span className="font-semibold text-blue-700">{confirmingSubAlloc.payee_name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Due:</span>
                  <span className="font-semibold">{formatINR(payingEntry.daily_amount + payingEntry.carryforward_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already Paid:</span>
                  <span>{formatINR(payingEntry.paid_amount)}</span>
                </div>
                {payingEntry.days_overdue > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Overdue:</span>
                    <Badge className={getAgingColor(payingEntry.days_overdue)}>{payingEntry.days_overdue} days</Badge>
                  </div>
                )}
              </div>
              <div>
                <Label>Company</Label>
                <Select
                  value={payTallyCompanyId}
                  onValueChange={(value) => {
                    setPayTallyCompanyId(value);
                    setPayLedgerCompanyId(value);
                    setPayDebitLedgerId('');
                    setPayDebitLedgerName('');
                    setPayDebitLedgerSearch('');
                    setPayCreditLedgerId('');
                  }}
                >
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select company first" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>{company.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="relative">
                <Label>Ledger to Pay (Debit)</Label>
                <Input
                  value={payDebitLedgerSearch || payDebitLedgerName || ''}
                  onChange={(e) => {
                    setPayDebitLedgerSearch(e.target.value);
                    setPayDebitLedgerId('');
                    setPayDebitLedgerName('');
                  }}
                  placeholder="Search expense or payable ledger"
                  className="mt-1"
                  disabled={!payTallyCompanyId}
                />
                {payDebitLedgerSearch.length >= 1 && payDebitLedgers.length > 0 && (
                  <div className="absolute left-0 right-0 top-[4.5rem] z-50 max-h-44 overflow-y-auto rounded-md border bg-white shadow-lg">
                    {payDebitLedgers.map((ledger: any) => (
                      <button
                        key={ledger.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                        onClick={() => {
                          setPayDebitLedgerId(ledger.id);
                          setPayTallyCompanyId(ledger.company_id || payTallyCompanyId);
                          setPayLedgerCompanyId(ledger.company_id || payTallyCompanyId);
                          setPayDebitLedgerName(ledger.account_name);
                          setPayDebitLedgerSearch('');
                        }}
                      >
                          <span className="font-medium">{ledger.account_name}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{ledger.account_group || ledger.account_type || 'Accounting ledger'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {payDebitLedgerId && (
                  <>
                    <p className="mt-1 text-xs text-green-700">Selected: {payDebitLedgerName || payDebitLedgerId}</p>
                    <BeneficiaryBankHint accountId={payDebitLedgerId} onUseBank={setPayCreditLedgerId} />
                  </>
                )}
              </div>
              <div>
                <Label>Pay From (Credit Cash / Bank)</Label>
                <Select value={payCreditLedgerId} onValueChange={setPayCreditLedgerId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select payment account" /></SelectTrigger>
                  <SelectContent>
                    {payCreditLedgers.map((ledger: any) => (
                      <SelectItem key={ledger.id} value={ledger.id}>{ledger.account_name} ({ledger.account_group || 'Cash/Bank'})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment Amount (Rs.)</Label>
                <Input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="Enter amount"
                  className="mt-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                On confirmation, only a Payment Voucher is created. No Journal Voucher or ledger posting is created.
              </p>
              {paymentError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {paymentError}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {subAllocDialogMode === 'plan' ? (
              <>
                <Button variant="outline" onClick={() => setPayDialogOpen(false)}>Close</Button>
                {dialogSubAllocations.length > 0 && (
                  <Button
                    variant="secondary"
                    className="bg-blue-100 hover:bg-blue-200 text-blue-800"
                    onClick={() => {
                      toast.success(`Saved ${dialogSubAllocations.length} payee(s) for ${payingEntry?.party_name}. Pay later or carry forward.`);
                      setPayDialogOpen(false);
                    }}
                  >
                    <Save className="h-4 w-4 mr-1" /> Save & Pay Later
                  </Button>
                )}
                {dialogSubAllocations.length > 0 && dialogSubAllocations.some((sa) => !sa.is_paid) && (
                  <p className="text-xs text-muted-foreground self-center">
                    Pay each allocated payee separately so every voucher remains linked to the correct payee.
                  </p>
                )}
                {dialogSubAllocations.length === 0 && (
                  <Button
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      setPaymentError('');
                      setPayAmount(newPayeeAmount);
                      setSubAllocDialogMode('confirm');
                    }}
                    disabled={!newPayeeAmount}
                  >
                    Proceed to Pay
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setSubAllocDialogMode('plan')}>Back</Button>
                <Button type="button" onClick={() => void confirmPay()} disabled={createPaymentVoucher.isPending || markPayeePaid.isPending} className="bg-green-600 hover:bg-green-700">
                  {createPaymentVoucher.isPending || markPayeePaid.isPending ? 'Processing...' : 'Create Payment Voucher'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Obligation Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) { setEditingObligationId(null); setLedgerLinks({}); setLedgerSearchTerm(''); setOpenPickerCompanyId(null); } }}>
        <DialogContent className="w-[95vw] max-w-2xl sm:max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle>{editingObligationId ? 'Edit' : 'Add'} Payment Obligation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1">
            <div>
              <Label>Company</Label>
              <Select value={newObligation.company_id || ''} onValueChange={(v) => setNewObligation({ ...newObligation, company_id: v || null })}>
                <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Obligation Name *</Label>
              <Input
                value={newObligation.party_name}
                onChange={(e) => setNewObligation({ ...newObligation, party_name: e.target.value })}
                placeholder="e.g., Rent, NephroPlus, Staff Salary"
              />
            </div>
            <div>
              <Label>Payee Name (who gets paid)</Label>
              <Input
                value={newObligation.payee_name}
                onChange={(e) => setNewObligation({ ...newObligation, payee_name: e.target.value })}
                placeholder="e.g., Dr Pramod Gandhi (for rent)"
              />
              <p className="text-xs text-muted-foreground mt-1">
                For fixed payees like rent. Leave blank if payee is selected at payment time.
              </p>
            </div>
            <div>
              <Label>Section <span className="text-xs text-muted-foreground">(determines which group this appears under)</span></Label>
              <Select
                value={newObligation.section || ''}
                onValueChange={(v) => setNewObligation({ ...newObligation, section: v as ObligationSection })}
              >
                <SelectTrigger><SelectValue placeholder="Pick a section..." /></SelectTrigger>
                <SelectContent>
                  {OBLIGATION_SECTIONS.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Leave unset to auto-derive from Sub-Category.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={newObligation.category} onValueChange={(v: 'fixed' | 'variable') => setNewObligation({ ...newObligation, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="variable">Variable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Sub-Category</Label>
                  <Button
                    type="button"
                    size="sm" variant="ghost"
                    className="h-6 px-2 text-xs text-blue-700 hover:bg-blue-50"
                    onClick={() => { setEditingSubCat(null); setManageSubCatsOpen(true); }}
                  >
                    Manage
                  </Button>
                </div>
                <Select value={newObligation.sub_category} onValueChange={(v) => setNewObligation({ ...newObligation, sub_category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {subCategories.filter(c => c.is_active).map(c => (
                      <SelectItem key={c.id} value={c.value}>{c.label}</SelectItem>
                    ))}
                    {subCategories.length === 0 && (
                      <SelectItem value="other" disabled>(no sub-categories — click Manage)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Daily Amount (Rs.) *</Label>
                <Input
                  type="number"
                  value={newObligation.default_daily_amount}
                  onChange={(e) => setNewObligation({ ...newObligation, default_daily_amount: e.target.value })}
                  placeholder="50000"
                />
              </div>
              <div>
                <Label>Priority (lower = higher)</Label>
                <Input
                  type="number"
                  value={newObligation.priority}
                  onChange={(e) => setNewObligation({ ...newObligation, priority: e.target.value })}
                  placeholder="10"
                />
              </div>
            </div>
            {/* Default Payees — multiple names/amounts (shown first when editing) */}
            {editingObligationId && (
              <div className="border-2 border-blue-200 rounded-md p-3 space-y-2 bg-blue-50/40">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-600" />
                  <Label className="text-sm font-bold text-blue-800">Breakup — Names & Amounts</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  e.g. Hope Electricity: ₹12,000 &amp; Ayushman Electricity: ₹8,000. These are saved and pre-populated daily.
                </p>
                {defaultPayees.length > 0 && (
                  <div className="border rounded-md divide-y bg-white">
                    {defaultPayees.map((dp) => (
                      <div key={dp.id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="flex-1 text-sm">{dp.payee_name}</span>
                        <span className="font-mono text-sm text-gray-700">{formatINR(dp.amount)}</span>
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removeDefaultPayee.mutate(dp.id)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <div className="px-3 py-1.5 bg-gray-50 text-sm font-semibold flex justify-between">
                      <span>Total</span>
                      <span className="font-mono">{formatINR(defaultPayees.reduce((s, dp) => s + dp.amount, 0))}</span>
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Input
                    value={defPayeeSearchTerm || defPayeeName}
                    onChange={(e) => { setDefPayeeSearchTerm(e.target.value); setDefPayeeName(e.target.value); }}
                    placeholder="Type name e.g. Hope Electricity, Dr. Sharma..."
                    className="h-8 text-sm"
                  />
                  {defPayeeResults.length > 0 && defPayeeSearchTerm.length >= 2 && (
                    <div className="border rounded-md max-h-32 overflow-y-auto bg-white shadow-sm">
                      {defPayeeResults.map((p: any) => (
                        <div
                          key={p.id}
                          className="px-3 py-1.5 hover:bg-blue-50 cursor-pointer text-sm flex justify-between"
                          onClick={() => { setDefPayeeName(p.name); setDefPayeeSearchTerm(''); }}
                        >
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.source}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number" value={defPayeeAmount}
                    onChange={(e) => setDefPayeeAmount(e.target.value)}
                    placeholder="Amount" className="h-8 text-sm flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && defPayeeName.trim() && defPayeeAmount) {
                        addDefaultPayee.mutate({ payee_name: defPayeeName.trim(), amount: parseFloat(defPayeeAmount) });
                        setDefPayeeName(''); setDefPayeeAmount(''); setDefPayeeSearchTerm('');
                      }
                    }}
                  />
                  <Button
                    size="sm" className="h-8"
                    disabled={!defPayeeName.trim() || !defPayeeAmount || addDefaultPayee.isPending}
                    onClick={() => {
                      addDefaultPayee.mutate({ payee_name: defPayeeName.trim(), amount: parseFloat(defPayeeAmount) });
                      setDefPayeeName(''); setDefPayeeAmount(''); setDefPayeeSearchTerm('');
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
              </div>
            )}

            <div>
              <Label>Payee Search Table</Label>
              <Select value={newObligation.payee_search_table || 'none'} onValueChange={(v) => setNewObligation({ ...newObligation, payee_search_table: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="None (manual entry)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (manual / fixed payee)</SelectItem>
                  <SelectItem value="hope_consultants">Hope Consultants</SelectItem>
                  <SelectItem value="ayushman_consultants">Ayushman Consultants</SelectItem>
                  <SelectItem value="hope_anaesthetists">Hope Anaesthetists</SelectItem>
                  <SelectItem value="ayushman_anaesthetists">Ayushman Anaesthetists</SelectItem>
                  <SelectItem value="staff_members">Staff Members</SelectItem>
                  <SelectItem value="hope_surgeons">Hope Surgeons</SelectItem>
                  <SelectItem value="ayushman_surgeons">Ayushman Surgeons</SelectItem>
                  <SelectItem value="hope_rmos">Hope RMOs</SelectItem>
                  <SelectItem value="ayushman_rmos">Ayushman RMOs</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                When paying, user can search this table to pick the specific person.
              </p>
            </div>

            <div>
              <Label>Notes</Label>
              <Input
                value={newObligation.notes}
                onChange={(e) => setNewObligation({ ...newObligation, notes: e.target.value })}
                placeholder="Optional notes"
              />
            </div>

            {/* Outstanding Payments — Upload & Google Link */}
            <div className="border rounded-md p-3 space-y-3 bg-amber-50/40">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-amber-700" />
                <Label className="text-sm font-bold text-amber-800">Outstanding Payments</Label>
              </div>

              {/* Upload Excel/Doc */}
              <div>
                <Label className="text-xs">Upload Excel / Doc</Label>
                <div className="flex items-center gap-2 mt-1">
                  <label className="cursor-pointer flex-1">
                    <div className="flex items-center gap-2 border rounded-md px-3 py-1.5 bg-white hover:bg-gray-50 text-sm">
                      <Upload className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground truncate">
                        {newObligation.attachment_url
                          ? newObligation.attachment_url.split('/').pop()
                          : 'Choose file (.xlsx, .xls, .csv, .doc, .pdf)'}
                      </span>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.doc,.docx,.pdf"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          // Extract names + amounts from Excel/CSV
                          const reader = new FileReader();
                          reader.onload = (evt) => {
                            try {
                              const data = evt.target?.result;
                              const workbook = XLSX.read(data, { type: 'binary' });
                              const sheetName = workbook.SheetNames[0];
                              const worksheet = workbook.Sheets[sheetName];
                              const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

                              if (jsonData.length === 0) {
                                toast.error('No data found in file');
                                return;
                              }

                              // Auto-detect name and amount columns
                              const keys = Object.keys(jsonData[0]);
                              const nameKey = keys.find(k => /name|staff|employee|party|person/i.test(k)) || keys[0];
                              const amountKey = keys.find(k => /amount|salary|daily|rate|pay|cost/i.test(k)) || keys[1];

                              const staff = jsonData
                                .map(row => ({
                                  name: String(row[nameKey] || '').trim(),
                                  amount: parseFloat(row[amountKey]) || 0,
                                  selected: true,
                                }))
                                .filter(s => s.name && s.name.length > 0);

                              if (staff.length === 0) {
                                toast.error('No valid names found. Ensure columns have Name and Amount headers.');
                                return;
                              }

                              setExtractedStaff(staff);
                              setNewObligation({ ...newObligation, attachment_url: file.name });
                              toast.success(`Extracted ${staff.length} entries from ${file.name}`);
                            } catch (parseErr) {
                              toast.error('Failed to parse file');
                            }
                          };
                          reader.readAsBinaryString(file);
                        } catch (err) {
                          toast.error('Upload failed');
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {newObligation.attachment_url && (
                    <Button
                      size="sm" variant="ghost"
                      className="h-8 px-2 text-red-400 hover:text-red-600"
                      onClick={() => setNewObligation({ ...newObligation, attachment_url: '' })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {newObligation.attachment_url && newObligation.attachment_url.startsWith('http') && (
                  <a href={newObligation.attachment_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" /> View uploaded file
                  </a>
                )}
              </div>

              {/* Extracted Staff Preview */}
              {extractedStaff.length > 0 && (
                <div className="border rounded-md p-2 bg-white max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-bold text-green-700">Extracted ({extractedStaff.filter(s => s.selected).length}/{extractedStaff.length} selected)</Label>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                        onClick={() => setExtractedStaff(extractedStaff.map(s => ({ ...s, selected: true })))}>
                        All
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                        onClick={() => setExtractedStaff(extractedStaff.map(s => ({ ...s, selected: false })))}>
                        None
                      </Button>
                    </div>
                  </div>
                  {extractedStaff.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 py-0.5 text-xs">
                      <input type="checkbox" checked={s.selected}
                        onChange={() => setExtractedStaff(prev => prev.map((p, j) => j === i ? { ...p, selected: !p.selected } : p))} />
                      <span className="flex-1 truncate">{s.name}</span>
                      <span className="font-mono text-right w-20">{formatINR(s.amount)}</span>
                    </div>
                  ))}
                  <Button size="sm" className="w-full mt-2 bg-green-600 hover:bg-green-700 text-xs h-7"
                    disabled={isImporting || extractedStaff.filter(s => s.selected).length === 0}
                    onClick={async () => {
                      setIsImporting(true);
                      const selected = extractedStaff.filter(s => s.selected);
                      let imported = 0;
                      for (const s of selected) {
                        try {
                          await (supabase as any).from('payment_obligations').insert({
                            party_name: s.name,
                            category: newObligation.category || 'variable',
                            sub_category: newObligation.sub_category || 'salary',
                            default_daily_amount: s.amount,
                            priority: 10,
                            is_active: true,
                            hospital_name: selectedHospital,
                          });
                          imported++;
                        } catch (err) {
                          console.error('Failed to import', s.name, err);
                        }
                      }
                      toast.success(`Imported ${imported} of ${selected.length} staff as obligations`);
                      setExtractedStaff([]);
                      setNewObligation({ ...newObligation, attachment_url: '' });
                      // Refresh obligations
                      window.location.reload();
                      setIsImporting(false);
                    }}>
                    {isImporting ? 'Importing...' : `Import ${extractedStaff.filter(s => s.selected).length} as Obligations`}
                  </Button>
                </div>
              )}

              {/* Tally Ledger Links — one picker per Tally company */}
              <div className="border rounded-md p-3 bg-slate-50 space-y-3">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <LinkIcon className="h-3 w-3" /> Linked Tally Ledgers (per company)
                </Label>

                {tallyCompanies.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No Tally companies configured. Add one in Tally settings first.
                  </p>
                ) : (
                  tallyCompanies.map((co: TallyCompany) => {
                    const link = ledgerLinks[co.id];
                    const isPickerOpen = openPickerCompanyId === co.id;
                    return (
                      <div key={co.id} className="bg-white border rounded p-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-blue-700">{co.company_name}</Label>
                          {link && (
                            <span className="text-xs font-mono text-green-700">
                              Outstanding: {formatINR(link.closingBalance)}
                            </span>
                          )}
                        </div>

                        <div className="relative">
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <Input
                                value={isPickerOpen ? ledgerSearchTerm : (link?.ledgerName || '')}
                                onChange={(e) => { setLedgerSearchTerm(e.target.value); setOpenPickerCompanyId(co.id); }}
                                onFocus={() => { setOpenPickerCompanyId(co.id); setLedgerSearchTerm(''); }}
                                placeholder={`Search ledger in ${co.company_name}...`}
                                className="h-8 text-sm pl-7"
                              />
                            </div>
                            {link && (
                              <Button
                                size="sm" variant="ghost"
                                className="h-8 px-2 text-red-400 hover:text-red-600"
                                type="button"
                                onClick={() => {
                                  setLedgerLinks(prev => {
                                    const next = { ...prev };
                                    delete next[co.id];
                                    return next;
                                  });
                                  setLedgerSearchTerm('');
                                  setOpenPickerCompanyId(null);
                                }}
                                title={`Unlink from ${co.company_name}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                          {isPickerOpen && ledgerSearchTerm.length >= 2 && (
                            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto">
                              {ledgerSearchResults.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground">No matching ledgers in {co.company_name}</div>
                              ) : (
                                ledgerSearchResults.map((lg) => (
                                  <button
                                    key={lg.id}
                                    type="button"
                                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0"
                                    onClick={() => {
                                      setLedgerLinks(prev => ({
                                        ...prev,
                                        [co.id]: {
                                          ledgerId: lg.id,
                                          ledgerName: lg.name,
                                          closingBalance: Number(lg.closing_balance) || 0,
                                        },
                                      }));
                                      setLedgerSearchTerm('');
                                      setOpenPickerCompanyId(null);
                                    }}
                                  >
                                    <div className="text-sm font-medium">{lg.name}</div>
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                      <span>{lg.parent_group || '—'}</span>
                                      <span className="font-mono">{formatINR(Number(lg.closing_balance) || 0)}</span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Approximate balance — manual, single field */}
                <div>
                  <Label className="text-xs">Approximate Balance (manual estimate)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={newObligation.approximate_balance}
                    onChange={(e) => setNewObligation({ ...newObligation, approximate_balance: e.target.value })}
                    placeholder="e.g. 50000 — used when ledger values are stale"
                    className="h-8 text-sm font-mono"
                  />
                </div>
              </div>

              {/* Google Sheet / Drive Link */}
              <div>
                <Label className="text-xs">Google Sheet / Drive Link</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={newObligation.google_sheet_link}
                    onChange={(e) => setNewObligation({ ...newObligation, google_sheet_link: e.target.value })}
                    placeholder="Paste Google Sheets or Drive link here..."
                    className="h-8 text-sm"
                  />
                  {newObligation.google_sheet_link && (
                    <a href={newObligation.google_sheet_link} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline" className="h-8 px-2" type="button">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Link to Google Sheet with outstanding payment details for this category.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter className="px-6 py-3 border-t shrink-0">
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); setEditingObligationId(null); }}>Cancel</Button>
            <Button onClick={handleAddObligation} disabled={createObligation.isPending || updateObligation.isPending}>
              {editingObligationId ? 'Save Changes' : 'Add Obligation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Sub-Categories Dialog */}
      <Dialog open={manageSubCatsOpen} onOpenChange={(open) => { setManageSubCatsOpen(open); if (!open) setEditingSubCat(null); }}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle>Manage Sub-Categories</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              These appear in the Sub-Category dropdown. Each must belong to one of the 4 sections.
            </p>

            {/* Add / edit form */}
            <div className="border rounded p-3 bg-slate-50 grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <Label className="text-xs">Value (slug)</Label>
                <Input
                  className="h-8 text-sm"
                  value={editingSubCat?.value || ''}
                  onChange={(e) => setEditingSubCat({ ...(editingSubCat || {}), value: e.target.value })}
                  placeholder="rent"
                  disabled={!!editingSubCat?.id}
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Label</Label>
                <Input
                  className="h-8 text-sm"
                  value={editingSubCat?.label || ''}
                  onChange={(e) => setEditingSubCat({ ...(editingSubCat || {}), label: e.target.value })}
                  placeholder="Rent"
                />
              </div>
              <div className="col-span-3">
                <Label className="text-xs">Section</Label>
                <Select
                  value={editingSubCat?.section || ''}
                  onValueChange={(v) => setEditingSubCat({ ...(editingSubCat || {}), section: v as ObligationSection })}
                >
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pick..." /></SelectTrigger>
                  <SelectContent>
                    {OBLIGATION_SECTIONS.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-1">
                <Label className="text-xs">Sort</Label>
                <Input
                  className="h-8 text-sm"
                  type="number"
                  value={editingSubCat?.sort_order ?? ''}
                  onChange={(e) => setEditingSubCat({ ...(editingSubCat || {}), sort_order: e.target.value === '' ? undefined : parseInt(e.target.value) })}
                  placeholder="100"
                />
              </div>
              <div className="col-span-2 flex gap-1">
                <Button
                  size="sm"
                  className="h-8 text-xs px-2 flex-1"
                  onClick={() => {
                    if (!editingSubCat?.value || !editingSubCat?.label || !editingSubCat?.section) {
                      toast.error('Value, label and section are required');
                      return;
                    }
                    upsertSubCategory.mutate(editingSubCat as any, {
                      onSuccess: () => setEditingSubCat(null),
                    });
                  }}
                >
                  {editingSubCat?.id ? 'Save' : 'Add'}
                </Button>
                {editingSubCat?.id && (
                  <Button
                    size="sm" variant="outline"
                    className="h-8 text-xs px-2"
                    onClick={() => setEditingSubCat(null)}
                  >Cancel</Button>
                )}
              </div>
            </div>

            {/* Existing list */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Value</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Sort</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subCategories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-4">No sub-categories yet.</TableCell>
                  </TableRow>
                ) : subCategories.map(c => (
                  <TableRow key={c.id} className={c.is_active ? '' : 'opacity-50'}>
                    <TableCell className="font-mono text-xs">{c.value}</TableCell>
                    <TableCell>{c.label}</TableCell>
                    <TableCell className="text-xs">{OBLIGATION_SECTIONS.find(s => s.key === c.section)?.title || c.section}</TableCell>
                    <TableCell className="text-right text-xs">{c.sort_order}</TableCell>
                    <TableCell className="text-center">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => upsertSubCategory.mutate({ ...c, is_active: !c.is_active })}
                      >
                        {c.is_active
                          ? <ToggleRight className="h-4 w-4 text-green-600" />
                          : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                      </Button>
                    </TableCell>
                    <TableCell className="text-center space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingSubCat(c)} title="Edit">
                        <Edit2 className="h-3.5 w-3.5 text-blue-600" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete sub-category "${c.label}"? Obligations already using "${c.value}" will keep that value but it will no longer appear in the dropdown.`)) {
                            removeSubCategory.mutate(c.id);
                          }
                        }}
                        title="Delete"
                      >
                        <span className="text-red-500 text-sm">×</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter className="px-6 py-3 border-t shrink-0">
            <Button variant="outline" onClick={() => setManageSubCatsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Manual Account Dialog */}
      <Dialog open={addAccountOpen} onOpenChange={setAddAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Bank / Cash Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Account Name *</Label>
              <Input
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                placeholder="e.g., Canara Bank Current A/c, SBI Savings"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={newAccount.type} onValueChange={(v: 'bank' | 'cash') => setNewAccount({ ...newAccount, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank Account</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hospital</Label>
                <Select value={newAccount.hospital} onValueChange={(v) => setNewAccount({ ...newAccount, hospital: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hope">Hope Hospital</SelectItem>
                    <SelectItem value="ayushman">Ayushman Hospital</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Current Balance (Rs.) *</Label>
              <Input
                type="number"
                value={newAccount.balance}
                onChange={(e) => setNewAccount({ ...newAccount, balance: e.target.value })}
                placeholder="Enter actual balance"
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Input
                value={newAccount.notes}
                onChange={(e) => setNewAccount({ ...newAccount, notes: e.target.value })}
                placeholder="Account number, branch, or other details"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAccountOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAccount} disabled={addManualAccount.isPending}>
              {addManualAccount.isPending ? 'Adding...' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DailyPaymentAllocation;
