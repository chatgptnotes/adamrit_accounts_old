// Prescription Queue - Pharmacist view for dispensing prescriptions
import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// Use the anon data client, not the OAuth-session-aware one: under an
// authenticated Google session the shared client's JWT makes prescriptions /
// prescription_items RLS return 0 rows, so a pharmacist would see empty
// prescriptions and "No items found". See integrations/supabase/data-client.
import { supabaseData as supabase } from '@/integrations/supabase/data-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileText,
  Search,
  Eye,
  Package,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Pill,
  Stethoscope,
  User,
  Calendar,
  Printer,
  Pencil,
  ImageOff,
  ZoomIn,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import StockMedicinePicker, { SelectedMedicine } from './StockMedicinePicker';
import { EditableDropdown } from '@/components/ui/editable-dropdown';
import { savePharmacySale } from '@/lib/pharmacy-billing-service';
import { pushPharmacySaleToTally } from '@/lib/tally-auto-push';
import { checkDrugInteractions, InteractionReport } from '@/lib/drug-interactions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrescriptionItem {
  id: string;
  medicine_id: string | null;
  medicine_name?: string; // joined from medicines table
  medicine_mrp?: number | null; // joined from medicines.mrp — fallback for unit price
  quantity_prescribed: number;
  quantity_dispensed: number;
  dosage_frequency: string | null;
  dosage_timing: string | null;
  duration_days: number | null;
  special_instructions: string | null;
  unit_price?: number | null;
  total_price?: number | null;
  batch_numbers?: string[] | null;
  earliest_expiry?: string | null; // computed from medicine_batch_inventory join
  is_substituted?: boolean | null;
  substitute_reason?: string | null;
  generic_name?: string | null;
  brand_name?: string | null;
}

interface Prescription {
  id: string;
  prescription_number: string;
  patient_id: string | null;
  patient_name?: string; // joined from patients table
  doctor_name: string | null;
  prescription_date: string | null;
  status: string;
  source?: string | null; // 'ward' = bridged from the tablet treatment sheet
  notes: string | null;
  prescription_image_url?: string | null;
  prescription_image_type?: string | null;
  drug_interaction_report?: InteractionReport | null;
  drug_interaction_signature?: string | null;
  drug_interaction_checked_at?: string | null;
  patient_location?: string | null;
  prescription_items: PrescriptionItem[];
}

// ─── Status helpers ────────────────────────────────────────────────────────────

const STATUS_TABS = ['ALL', 'PENDING', 'APPROVED', 'PARTIALLY_DISPENSED', 'DISPENSED'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'APPROVED':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'PARTIALLY_DISPENSED':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'DISPENSED':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'CANCELLED':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'PENDING':
      return <Clock className="h-3 w-3" />;
    case 'APPROVED':
      return <CheckCircle className="h-3 w-3" />;
    case 'DISPENSED':
      return <CheckCircle className="h-3 w-3" />;
    case 'CANCELLED':
      return <XCircle className="h-3 w-3" />;
    default:
      return <AlertCircle className="h-3 w-3" />;
  }
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function fetchPrescriptions(): Promise<Prescription[]> {
  // Fetch prescriptions
  const { data: prescriptions, error } = await (supabase as any)
    .from('prescriptions')
    .select('*')
    .order('prescription_date', { ascending: false });

  if (error) throw error;
  if (!prescriptions || prescriptions.length === 0) return [];

  // Fetch prescription items for all prescriptions. PostgREST caps every
  // response at 1000 rows, and there are more than 1000 items across all
  // prescriptions — a single query silently dropped the overflow (sorted
  // oldest-first), so the newest ward prescriptions came back with 0 items.
  // Chunk the id list (keeps the URL sane) and page through each chunk.
  const prescriptionIds = prescriptions.map((p: any) => p.id);
  const items: any[] = [];
  const ID_CHUNK = 300;
  const PAGE = 1000;
  for (let c = 0; c < prescriptionIds.length; c += ID_CHUNK) {
    const idChunk = prescriptionIds.slice(c, c + ID_CHUNK);
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: page, error: itemsError } = await (supabase as any)
        .from('prescription_items')
        .select('*')
        .in('prescription_id', idChunk)
        .range(from, from + PAGE - 1);
      if (itemsError) throw itemsError;
      if (!page || page.length === 0) break;
      items.push(...page);
      if (page.length < PAGE) break;
      from += PAGE;
    }
  }

  // Fetch patient names
  const patientIds = [...new Set(prescriptions.map((p: any) => p.patient_id).filter(Boolean))];
  let patientMap: Record<string, string> = {};
  if (patientIds.length > 0) {
    const { data: patients } = await (supabase as any)
      .from('patients')
      .select('id, name')
      .in('id', patientIds);
    if (patients) {
      patientMap = Object.fromEntries(patients.map((p: any) => [p.id, p.name]));
    }
  }

  // Fetch medicine MRP — two strategies:
  // 1. By medicine_id (for items that have it)
  // 2. By medicine_name text match (camera-upload prescriptions have medicine_id=null)
  const medicineIds = [...new Set((items || []).map((i: any) => i.medicine_id).filter(Boolean))];
  // key → { name, mrp }
  let medicineById: Record<string, { name: string; mrp: number | null }> = {};
  if (medicineIds.length > 0) {
    const { data: medicines } = await (supabase as any)
      .from('medicines')
      .select('id, medicine_name, mrp')
      .in('id', medicineIds);
    if (medicines) {
      medicineById = Object.fromEntries(
        medicines.map((m: any) => [m.id, { name: m.medicine_name, mrp: m.mrp ?? null }])
      );
    }
  }

  // For items without medicine_id, look up by name
  const itemsWithoutId = (items || []).filter((i: any) => !i.medicine_id && i.medicine_name);
  const freeTextNames = [...new Set(itemsWithoutId.map((i: any) => (i.medicine_name as string).trim()))];
  let medicineByName: Record<string, number | null> = {}; // lowercase name → mrp
  if (freeTextNames.length > 0) {
    const { data: namedMeds } = await (supabase as any)
      .from('medicines')
      .select('medicine_name, mrp')
      .in('medicine_name', freeTextNames);
    if (namedMeds) {
      for (const m of namedMeds) {
        medicineByName[m.medicine_name.toLowerCase()] = m.mrp ?? null;
      }
    }
  }

  // Fetch earliest expiry per batch_number (data populated at dispense time)
  const allBatchNumbers = [
    ...new Set(
      (items || []).flatMap((i: any) =>
        Array.isArray(i.batch_numbers) ? i.batch_numbers : []
      )
    ),
  ].filter(Boolean) as string[];
  let batchExpiry: Record<string, string> = {};
  if (allBatchNumbers.length > 0) {
    const { data: batches } = await (supabase as any)
      .from('medicine_batch_inventory')
      .select('batch_number, expiry_date')
      .in('batch_number', allBatchNumbers);
    if (batches) {
      for (const b of batches) {
        const cur = batchExpiry[b.batch_number];
        if (!cur || (b.expiry_date && b.expiry_date < cur)) {
          batchExpiry[b.batch_number] = b.expiry_date;
        }
      }
    }
  }

  // Join items onto prescriptions
  const itemsByPrescription: Record<string, PrescriptionItem[]> = {};
  for (const item of items || []) {
    const key = item.prescription_id;
    if (!itemsByPrescription[key]) itemsByPrescription[key] = [];
    const medMeta = item.medicine_id ? medicineById[item.medicine_id] : null;
    const resolvedName = item.medicine_name || medMeta?.name || 'Unknown Medicine';
    // MRP: from id-lookup → name-lookup → null
    const resolvedMrp = medMeta?.mrp ?? medicineByName[(item.medicine_name || '').toLowerCase()] ?? null;
    const earliestExpiry = (item.batch_numbers || []).reduce(
      (min: string | null, bn: string) => {
        const e = batchExpiry[bn];
        if (!e) return min;
        if (!min || e < min) return e;
        return min;
      },
      null as string | null
    );
    itemsByPrescription[key].push({
      ...item,
      medicine_name: resolvedName.toUpperCase(),
      medicine_mrp: resolvedMrp,
      earliest_expiry: earliestExpiry,
    });
  }

  return prescriptions.map((p: any) => ({
    ...p,
    patient_name: p.patient_id ? patientMap[p.patient_id] || 'Unknown Patient' : 'Unknown Patient',
    prescription_items: itemsByPrescription[p.id] || [],
  }));
}

// ─── Dispense Modal ────────────────────────────────────────────────────────────

interface DispenseBatchAllocation {
  batch_inventory_id: string;
  batch_number: string;
  expiry_date: string | null;
  selling_price: number;
  mrp: number;
  qty: number;
}

// Resolve a free-text medicine name → medicine_master → in-stock batches (FEFO),
// and allocate `qty` across the earliest-expiring batches first.
async function resolveBatchesForDispense(
  medicineName: string,
  qty: number
): Promise<{
  medicineMasterId: string | null;
  allocations: DispenseBatchAllocation[];
  unallocated: number;
}> {
  const name = (medicineName || '').trim();
  if (!name || qty <= 0) {
    return { medicineMasterId: null, allocations: [], unallocated: Math.max(0, qty) };
  }

  const { data: med } = await (supabase as any)
    .from('medicine_master')
    .select('id')
    .eq('is_deleted', false)
    .ilike('medicine_name', name)
    .limit(1);
  const medicineMasterId = med && med[0] ? med[0].id : null;
  if (!medicineMasterId) {
    return { medicineMasterId: null, allocations: [], unallocated: qty };
  }

  const { data: batches } = await (supabase as any)
    .from('medicine_batch_inventory')
    .select('id, batch_number, expiry_date, current_stock, selling_price, mrp')
    .eq('medicine_id', medicineMasterId)
    .eq('is_active', true)
    .eq('is_expired', false)
    .gt('current_stock', 0)
    .order('expiry_date', { ascending: true }); // FEFO

  const allocations: DispenseBatchAllocation[] = [];
  let remaining = qty;
  for (const b of batches || []) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, b.current_stock || 0);
    if (take <= 0) continue;
    allocations.push({
      batch_inventory_id: b.id,
      batch_number: b.batch_number || '',
      expiry_date: b.expiry_date || null,
      selling_price: b.selling_price || 0,
      mrp: b.mrp || 0,
      qty: take,
    });
    remaining -= take;
  }
  return { medicineMasterId, allocations, unallocated: remaining };
}

interface DispenseModalProps {
  prescription: Prescription;
  onClose: () => void;
  hospitalName?: string;
}

const DispenseModal: React.FC<DispenseModalProps> = ({ prescription, onClose, hospitalName }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDispensing, setIsDispensing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'UPI' | 'CREDIT'>('CASH');
  const [quantities, setQuantities] = useState<Record<string, number>>(
    Object.fromEntries(
      prescription.prescription_items.map((item) => [
        item.id,
        item.quantity_prescribed - item.quantity_dispensed,
      ])
    )
  );

  const handleQuantityChange = (itemId: string, value: number) => {
    const item = prescription.prescription_items.find((i) => i.id === itemId);
    if (!item) return;
    const maxQty = item.quantity_prescribed - item.quantity_dispensed;
    const clamped = Math.max(0, Math.min(value, maxQty));
    setQuantities((prev) => ({ ...prev, [itemId]: clamped }));
  };

  const handleCreateSaleBill = async () => {
    // Check if any quantity is being dispensed
    const itemsToDispense = prescription.prescription_items.filter(
      (item) => (quantities[item.id] || 0) > 0
    );
    if (itemsToDispense.length === 0) {
      toast({ title: 'No items to dispense', description: 'Please enter quantity for at least one medicine.', variant: 'destructive' });
      return;
    }

    setIsDispensing(true);
    try {
      // Guard against a double-dispense race: the linked ward medicine may have
      // been dispensed elsewhere (e.g. the tablet, synced via DB trigger) since
      // this modal opened. Re-read live quantities; if anything we're about to
      // dispense is already fully dispensed, abort BEFORE creating any sale or
      // decrementing stock so the patient can't be billed twice.
      const { data: liveItems } = await (supabase as any)
        .from('prescription_items')
        .select('id, quantity_dispensed, quantity_prescribed')
        .eq('prescription_id', prescription.id);
      const liveById: Record<string, any> = Object.fromEntries(
        (liveItems || []).map((i: any) => [i.id, i]),
      );
      const alreadyDispensed = itemsToDispense.some((item) => {
        const live = liveById[item.id];
        return live && (live.quantity_dispensed || 0) >= (live.quantity_prescribed || 0);
      });
      if (alreadyDispensed) {
        setIsDispensing(false);
        toast({
          title: 'Already dispensed',
          description: 'This medicine was already dispensed (possibly from the ward). Refreshing — please review before billing.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: ['prescription-queue'] });
        onClose();
        return;
      }

      // Step 1: Determine the new prescription status (computed only — the
      // prescription is marked dispensed AFTER the sale is saved, so a failed
      // sale never leaves a prescription dispensed with no bill).
      const allFullyDispensed = prescription.prescription_items.every((item) => {
        const qtyToDispense = quantities[item.id] || 0;
        return (item.quantity_dispensed + qtyToDispense) >= item.quantity_prescribed;
      });
      const newStatus = allFullyDispensed ? 'DISPENSED' : 'PARTIALLY_DISPENSED';

      // Step 2: Resolve the patient's latest visit so a CREDIT sale links to Final Bill
      let visitId: string | undefined;
      if (prescription.patient_id) {
        const { data: visitRows } = await (supabase as any)
          .from('visits')
          .select('visit_id')
          .eq('patient_id', prescription.patient_id)
          .order('created_at', { ascending: false })
          .limit(1);
        visitId = visitRows && visitRows[0] ? visitRows[0].visit_id : undefined;
      }

      // Step 3: FEFO-resolve batches per item; build sale lines + stock-decrement list
      const saleLineItems: any[] = [];
      const stockUpdates: { batch_inventory_id: string; qty: number }[] = [];
      let shortStock = false;

      for (const item of itemsToDispense) {
        const qty = quantities[item.id] || 0;
        // Prefer the prescription's own price; fall back to the batch's selling
        // price so camera-extracted items (which carry no price) don't bill at ₹0.
        const basePrice = item.unit_price ?? item.medicine_mrp ?? null;
        const { medicineMasterId, allocations, unallocated } = await resolveBatchesForDispense(
          item.medicine_name || '',
          qty
        );

        for (const alloc of allocations) {
          const unitPrice = basePrice ?? alloc.selling_price ?? alloc.mrp ?? 0;
          saleLineItems.push({
            medicine_id: medicineMasterId,
            medicine_name: item.medicine_name || 'Unknown',
            generic_name: (item as any).generic_name || undefined,
            batch_number: alloc.batch_number,
            expiry_date: alloc.expiry_date || undefined,
            quantity: alloc.qty,
            unit_price: unitPrice,
            mrp: item.medicine_mrp ?? alloc.mrp ?? 0,
            discount_percentage: 0,
            discount_amount: 0,
            tax_percentage: 0,
            tax_amount: 0,
            total_amount: alloc.qty * unitPrice,
          });
          stockUpdates.push({ batch_inventory_id: alloc.batch_inventory_id, qty: alloc.qty });
        }

        // Remainder with no available stock — still billed so the total is correct.
        if (unallocated > 0) {
          shortStock = true;
          const unitPrice = basePrice ?? 0;
          saleLineItems.push({
            medicine_id: medicineMasterId,
            medicine_name: item.medicine_name || 'Unknown',
            generic_name: (item as any).generic_name || undefined,
            batch_number: null,
            quantity: unallocated,
            unit_price: unitPrice,
            mrp: item.medicine_mrp ?? 0,
            discount_percentage: 0,
            discount_amount: 0,
            tax_percentage: 0,
            tax_amount: 0,
            total_amount: unallocated * unitPrice,
          });
        }
      }

      const totalAmount = saleLineItems.reduce((s, it) => s + (it.total_amount || 0), 0);
      const billNumber = `BILL${Date.now()}`;

      // Step 4: Save the sale via the shared service (correct columns + rollback)
      const saleResp = await savePharmacySale({
        sale_type: 'PRESCRIPTION',
        patient_id: prescription.patient_id || undefined,
        visit_id: visitId,
        patient_name: prescription.patient_name,
        prescription_number: prescription.prescription_number,
        doctor_name: prescription.doctor_name || undefined,
        hospital_name: hospitalName || 'hope',
        bill_number: billNumber,
        remarks: `Dispensed from prescription ${prescription.prescription_number}`,
        subtotal: totalAmount,
        discount: 0,
        tax_gst: 0,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        payment_status: 'COMPLETED',
        items: saleLineItems,
      } as any);
      if (!saleResp?.success) {
        throw new Error(saleResp?.error || 'Failed to save pharmacy sale');
      }

      // Step 5: Decrement batch stock (only after the sale saved)
      for (const su of stockUpdates) {
        const { data: batch } = await (supabase as any)
          .from('medicine_batch_inventory')
          .select('current_stock, sold_quantity')
          .eq('id', su.batch_inventory_id)
          .single();
        if (!batch) continue;
        await (supabase as any)
          .from('medicine_batch_inventory')
          .update({
            current_stock: Math.max(0, (batch.current_stock || 0) - su.qty),
            sold_quantity: (batch.sold_quantity || 0) + su.qty,
            updated_at: new Date().toISOString(),
          })
          .eq('id', su.batch_inventory_id);
      }

      // Step 6: Mark items dispensed + update prescription status — only now
      // that the sale and stock are committed.
      for (const item of itemsToDispense) {
        const qtyToDispense = quantities[item.id] || 0;
        const { error: itemErr } = await (supabase as any)
          .from('prescription_items')
          .update({ quantity_dispensed: item.quantity_dispensed + qtyToDispense })
          .eq('id', item.id);
        if (itemErr) console.error('Error updating prescription item:', item.id, itemErr);
      }
      const { error: statusError } = await (supabase as any)
        .from('prescriptions')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', prescription.id);
      if (statusError) console.error('Error updating prescription status:', statusError);

      // Step 7: Sync to Tally (fire-and-forget)
      pushPharmacySaleToTally({
        invoiceNumber: billNumber,
        patientName: prescription.patient_name || 'Patient',
        date: new Date().toISOString().split('T')[0],
        totalAmount,
        items: saleLineItems.map((it) => ({
          medicineName: it.medicine_name,
          quantity: it.quantity,
          amount: it.total_amount,
        })),
      }).catch(console.error);

      toast({
        title: allFullyDispensed ? 'Fully Dispensed' : 'Partially Dispensed',
        description:
          `${itemsToDispense.length} medicine(s) dispensed. Bill: ${billNumber}` +
          (shortStock ? ' — note: some items were short on stock.' : ''),
      });

      // Refresh the prescription list
      queryClient.invalidateQueries({ queryKey: ['prescription-queue'] });
      onClose();
    } catch (err: any) {
      toast({
        title: 'Dispense failed',
        description: err.message || 'An error occurred while dispensing',
        variant: 'destructive',
      });
    } finally {
      setIsDispensing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Patient & Doctor info */}
      <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Patient</p>
            <p className="font-medium text-sm">{prescription.patient_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Doctor</p>
            <p className="font-medium text-sm">{prescription.doctor_name || 'N/A'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Prescription #</p>
            <p className="font-medium text-sm font-mono">{prescription.prescription_number}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Date</p>
            <p className="font-medium text-sm">{prescription.prescription_date || 'N/A'}</p>
          </div>
        </div>
      </div>

      {/* Medicines list */}
      <div>
        <h4 className="font-medium mb-2 flex items-center gap-2">
          <Pill className="h-4 w-4" />
          Medicines to Dispense
        </h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medicine</TableHead>
              <TableHead className="text-center">Prescribed</TableHead>
              <TableHead className="text-center">Already Dispensed</TableHead>
              <TableHead className="text-center">Qty to Dispense</TableHead>
              <TableHead>Instructions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prescription.prescription_items.map((item) => {
              const remaining = item.quantity_prescribed - item.quantity_dispensed;
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-bold text-sm">{(item as any).generic_name || item.medicine_name}</p>
                    {(item as any).brand_name && (
                      <p className="text-[10px] text-gray-500">({(item as any).brand_name})</p>
                    )}
                    {item.dosage_frequency && (
                      <p className="text-xs text-muted-foreground">{item.dosage_frequency}</p>
                    )}
                    {item.duration_days && (
                      <p className="text-xs text-muted-foreground">{item.duration_days} days</p>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{item.quantity_prescribed}</TableCell>
                  <TableCell className="text-center">{item.quantity_dispensed}</TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      min={0}
                      max={remaining}
                      value={quantities[item.id] ?? remaining}
                      onChange={(e) => handleQuantityChange(item.id, parseInt(e.target.value) || 0)}
                      className="w-20 text-center mx-auto"
                      disabled={remaining === 0}
                    />
                    {remaining === 0 && (
                      <p className="text-xs text-green-600 mt-1">Fully dispensed</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p className="text-xs text-muted-foreground">
                      {item.dosage_timing || ''}
                      {item.special_instructions ? ` · ${item.special_instructions}` : ''}
                    </p>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Payment</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'CARD' | 'UPI' | 'CREDIT')}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="UPI">UPI</option>
            <option value="CREDIT">Credit (to hospital bill)</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreateSaleBill} disabled={isDispensing}>
            <Package className="h-4 w-4 mr-2" />
            {isDispensing ? 'Dispensing...' : 'Dispense & Create Bill'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── Detail Modal ──────────────────────────────────────────────────────────────

interface DetailModalProps {
  prescription: Prescription;
  onClose: () => void;
}

const formatINR = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(amount || 0);

const formatExpiry = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  } catch {
    return '—';
  }
};

// Right-pane viewer for the original prescription photo / PDF.
const PrescriptionPhotoPane: React.FC<{
  imageUrl?: string | null;
  imageType?: string | null;
}> = ({ imageUrl, imageType }) => {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  const isPdf =
    (imageType || '').toLowerCase().includes('pdf') ||
    (imageUrl || '').toLowerCase().endsWith('.pdf');

  if (!imageUrl || imgError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] border border-dashed rounded-lg bg-gray-50 text-muted-foreground">
        <ImageOff className="h-10 w-10 mb-2" />
        <p className="text-sm">No prescription image</p>
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="space-y-2">
        <iframe
          src={imageUrl}
          title="Prescription PDF"
          className="w-full h-[70vh] border rounded-lg bg-gray-50"
        />
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open PDF in new tab
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="relative group">
        <img
          src={imageUrl}
          alt="Prescription"
          onError={() => setImgError(true)}
          onClick={() => setZoomOpen(true)}
          className="w-full max-h-[70vh] object-contain bg-gray-50 rounded-lg border cursor-zoom-in"
        />
        <div className="absolute top-2 right-2 bg-black/60 text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <ZoomIn className="h-4 w-4" />
        </div>
      </div>
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="max-w-5xl max-h-[95vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Prescription Image</DialogTitle>
          </DialogHeader>
          <img
            src={imageUrl}
            alt="Prescription full size"
            className="w-full h-auto object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

// Common dosage frequencies for the editable Frequency dropdown (free text also allowed).
const FREQUENCY_OPTIONS = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS'];

const DetailModal: React.FC<DetailModalProps> = ({ prescription, onClose }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hospitalType } = useAuth();

  // Local copy of items so a medicine swap reflects immediately in this modal.
  const [items, setItems] = useState<PrescriptionItem[]>(prescription.prescription_items);
  // itemId → aggregated in-stock quantity (null = no catalog match found).
  const [stockMap, setStockMap] = useState<Record<string, number | null>>({});
  // Medicine-change dialog state.
  const [changeItem, setChangeItem] = useState<PrescriptionItem | null>(null);
  const [selectedMedicine, setSelectedMedicine] = useState<SelectedMedicine | null>(null);
  const [substituteReason, setSubstituteReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Inline field-edit state (quantity / frequency / duration).
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<string>>(new Set());
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  // Drug-interaction advisory state.
  const [interactionReport, setInteractionReport] = useState<InteractionReport | null>(null);
  const [interactionStatus, setInteractionStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle');
  const [interactionError, setInteractionError] = useState<string | null>(null);

  const canEdit = prescription.status !== 'DISPENSED';

  // Re-run the stock lookup only when the set of medicine names changes —
  // not on every quantity/duration keystroke.
  const medicineNamesKey = items.map((i) => i.medicine_name || '').join('|');

  // Stable key of the medicine set — drives the drug-interaction cache/re-check.
  const medicineSignature = [
    ...new Set(items.map((i) => (i.medicine_name || '').trim().toLowerCase()).filter(Boolean)),
  ]
    .sort()
    .join('|');

  // Best-effort: resolve each item's medicine name to live stock for a badge.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const distinctNames = [
        ...new Set(items.map((i) => (i.medicine_name || '').trim()).filter(Boolean)),
      ];
      if (distinctNames.length === 0) return;
      try {
        const nameToId: Record<string, string> = {};
        await Promise.all(
          distinctNames.map(async (name) => {
            const { data } = await supabase
              .from('medicine_master')
              .select('id, medicine_name')
              .eq('is_deleted', false)
              .ilike('medicine_name', name)
              .limit(1);
            if (data && data[0]) nameToId[name.toLowerCase()] = data[0].id;
          })
        );
        const ids = [...new Set(Object.values(nameToId))];
        const stockById: Record<string, number> = {};
        if (ids.length > 0) {
          const { data: batches } = await supabase
            .from('medicine_batch_inventory')
            .select('medicine_id, current_stock')
            .in('medicine_id', ids)
            .eq('is_active', true)
            .eq('is_expired', false)
            .gt('current_stock', 0);
          for (const b of batches || []) {
            stockById[b.medicine_id] = (stockById[b.medicine_id] || 0) + (b.current_stock || 0);
          }
        }
        const map: Record<string, number | null> = {};
        for (const it of items) {
          const id = nameToId[(it.medicine_name || '').trim().toLowerCase()];
          map[it.id] = id ? stockById[id] || 0 : null;
        }
        if (!cancelled) setStockMap(map);
      } catch (e) {
        console.error('Stock lookup failed:', e);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [medicineNamesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const runInteractionCheck = async () => {
    if (items.length === 0) return;
    setInteractionStatus('checking');
    setInteractionError(null);
    try {
      const report = await checkDrugInteractions(
        items.map((it) => ({
          name: it.medicine_name || '',
          generic: it.generic_name || undefined,
          strength: it.special_instructions || undefined,
        }))
      );
      setInteractionReport(report);
      setInteractionStatus('done');
      // Cache on the prescription — best-effort (ignored if columns aren't migrated yet).
      const { error: cacheErr } = await (supabase as any)
        .from('prescriptions')
        .update({
          drug_interaction_report: report,
          drug_interaction_signature: medicineSignature,
          drug_interaction_checked_at: report.generatedAt,
        })
        .eq('id', prescription.id);
      if (cacheErr) {
        console.warn('Could not cache interaction report (migration may be pending):', cacheErr);
      }
    } catch (err: any) {
      setInteractionStatus('error');
      setInteractionError(err?.message || 'Interaction check failed.');
    }
  };

  // Auto-run the interaction check: reuse the cached report when the medicine
  // set is unchanged, otherwise call the AI.
  useEffect(() => {
    if (items.length === 0) return;
    if (
      prescription.drug_interaction_signature === medicineSignature &&
      prescription.drug_interaction_report
    ) {
      setInteractionReport(prescription.drug_interaction_report as InteractionReport);
      setInteractionStatus('done');
      return;
    }
    runInteractionCheck();
  }, [medicineSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute per-row price/amount with a sensible fallback chain:
  //   unit_price (saved at dispense) ?? medicine_mrp (current catalog)
  //   amount     = total_price (saved)        ?? unit * dispensed
  const itemsWithMoney = items.map((item) => {
    const unitPrice = item.unit_price ?? item.medicine_mrp ?? 0;
    const amount = item.total_price ?? unitPrice * (item.quantity_dispensed || 0);
    return { ...item, _unitPrice: unitPrice, _amount: amount };
  });
  const grandTotal = itemsWithMoney.reduce((s, it) => s + (it._amount || 0), 0);

  // Clean, single-document print. The page-wide window.print() printed the whole
  // app (queue table, sidebar) across many pages; this opens a dedicated window
  // with just the prescription so it prints as one tidy A4 sheet.
  const handlePrint = () => {
    const hospitalName = (hospitalType || 'Hospital')
      .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    const esc = (s: unknown) =>
      String(s ?? '').replace(/[&<>"]/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

    const rows = itemsWithMoney
      .map((it, i) => {
        const name = (it.brand_name || it.medicine_name || it.generic_name || '').toString();
        const dose = [it.dosage_frequency, it.dosage_timing].filter(Boolean).join(' ');
        const dur = it.duration_days ? `${it.duration_days} days` : '';
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(name)}</td>
          <td>${esc(dose)}</td>
          <td>${esc(dur)}</td>
          <td style="text-align:center;">${esc(it.quantity_prescribed)}</td>
        </tr>`;
      })
      .join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<title>Prescription ${esc(prescription.prescription_number)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #000; }
  h1 { font-size: 18px; margin-bottom: 10px; }
  p { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #000; padding: 6px 8px; text-align: left; }
</style></head>
<body>
  <h1>${esc(hospitalName)} — Prescription</h1>
  <p><strong>Patient:</strong> ${esc(prescription.patient_name || '-')}</p>
  <p><strong>Doctor:</strong> ${esc(prescription.doctor_name || '-')}</p>
  <p><strong>Rx No.:</strong> ${esc(prescription.prescription_number)} &nbsp;&nbsp; <strong>Date:</strong> ${esc(prescription.prescription_date || '-')}</p>
  <table>
    <thead><tr><th>#</th><th>Medicine</th><th>Frequency</th><th>Duration</th><th>Qty</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = function () { window.print(); setTimeout(function(){ window.close(); }, 300); };</script>
</body></html>`;

    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      toast({ title: 'Pop-up blocked', description: 'Allow pop-ups to print the prescription.', variant: 'destructive' });
      return;
    }
    win.document.write(html);
    win.document.close();
  };

  const closeChangeDialog = () => {
    setChangeItem(null);
    setSelectedMedicine(null);
    setSubstituteReason('');
  };

  const handleConfirmChange = async () => {
    if (!changeItem || !selectedMedicine) return;
    setIsSaving(true);
    try {
      const reason = substituteReason.trim() || 'Stock substitution by pharmacist';
      const newUnitPrice = selectedMedicine.fefoBatch?.selling_price ?? 0;
      // FEFO batch of the chosen medicine — populates the Batch/Expiry column;
      // earliest_expiry is recomputed from this on the next fetch.
      const newBatchNumbers = selectedMedicine.fefoBatch?.batch_number
        ? [selectedMedicine.fefoBatch.batch_number]
        : [];
      const { error } = await (supabase as any)
        .from('prescription_items')
        .update({
          medicine_name: selectedMedicine.name,
          generic_name: selectedMedicine.generic || '',
          brand_name: '',
          is_substituted: true,
          substitute_reason: reason,
          unit_price: newUnitPrice,
          batch_numbers: newBatchNumbers,
          // The picker returns a medicine_master id; medicine_id FKs to `medicines`,
          // so null it out rather than store a wrong-table id.
          medicine_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', changeItem.id);
      if (error) throw error;

      const fromName = changeItem.medicine_name;
      // Reflect the swap immediately in the open modal.
      setItems((prev) =>
        prev.map((it) =>
          it.id === changeItem.id
            ? {
                ...it,
                medicine_name: selectedMedicine.name.toUpperCase(),
                generic_name: selectedMedicine.generic || '',
                brand_name: '',
                is_substituted: true,
                substitute_reason: reason,
                unit_price: newUnitPrice,
                medicine_id: null,
                medicine_mrp: selectedMedicine.fefoBatch?.mrp ?? it.medicine_mrp ?? null,
                batch_numbers: newBatchNumbers,
                earliest_expiry: selectedMedicine.fefoBatch?.expiry_date ?? null,
              }
            : it
        )
      );
      setStockMap((prev) => ({ ...prev, [changeItem.id]: selectedMedicine.totalStock }));
      queryClient.invalidateQueries({ queryKey: ['prescription-queue'] });

      toast(
        selectedMedicine.totalStock <= 0
          ? {
              title: 'Medicine changed — out of stock',
              description: `${selectedMedicine.name} currently has no stock.`,
            }
          : {
              title: 'Medicine changed',
              description: `${fromName} → ${selectedMedicine.name}`,
            }
      );
      closeChangeDialog();
    } catch (err: any) {
      toast({
        title: 'Could not change medicine',
        description: err?.message || 'Update failed.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const updateItemField = (
    id: string,
    field: 'quantity_prescribed' | 'dosage_frequency' | 'duration_days',
    value: any
  ) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
    setDirtyItemIds((prev) => new Set(prev).add(id));
  };

  const handleSaveEdits = async () => {
    setIsSavingEdits(true);
    try {
      for (const id of dirtyItemIds) {
        const it = items.find((i) => i.id === id);
        if (!it) continue;
        const { error } = await (supabase as any)
          .from('prescription_items')
          .update({
            quantity_prescribed: it.quantity_prescribed,
            dosage_frequency: it.dosage_frequency,
            duration_days: it.duration_days,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (error) throw error;
      }
      queryClient.invalidateQueries({ queryKey: ['prescription-queue'] });
      toast({ title: 'Changes saved', description: `${dirtyItemIds.size} item(s) updated.` });
      setDirtyItemIds(new Set());
    } catch (err: any) {
      toast({
        title: 'Save failed',
        description: err?.message || 'Could not save changes.',
        variant: 'destructive',
      });
    } finally {
      setIsSavingEdits(false);
    }
  };

  const stockBadge = (stock: number | null | undefined) => {
    if (stock === null || stock === undefined) {
      return (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          Stock: unknown
        </Badge>
      );
    }
    if (stock <= 0) {
      return (
        <Badge className="text-[10px] bg-red-100 text-red-700 border-red-200">Out of stock</Badge>
      );
    }
    if (stock <= 10) {
      return (
        <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
          Low: {stock}
        </Badge>
      );
    }
    return (
      <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
        In stock: {stock}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        {/* LEFT — summary + extracted items */}
        <div className="space-y-4 min-w-0">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Patient</p>
              <p className="font-medium">{prescription.patient_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Location</p>
              {prescription.patient_location ? (
                <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${
                  prescription.patient_location === 'ICU'  ? 'bg-red-100 text-red-700' :
                  prescription.patient_location === 'Ward' ? 'bg-blue-100 text-blue-700' :
                  prescription.patient_location === 'Room' ? 'bg-green-100 text-green-700' :
                  prescription.patient_location === 'OT'   ? 'bg-orange-100 text-orange-700' : ''
                }`}>
                  {prescription.patient_location}
                </span>
              ) : <p className="font-medium text-muted-foreground">—</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Doctor</p>
              <p className="font-medium">{prescription.doctor_name || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Prescription #</p>
              <p className="font-mono font-medium">{prescription.prescription_number}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="font-medium">{prescription.prescription_date || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <Badge className={`${getStatusBadgeClass(prescription.status)} border text-xs flex items-center gap-1 w-fit`}>
                {getStatusIcon(prescription.status)}
                {formatStatusLabel(prescription.status)}
              </Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Amount</p>
              <p className="font-semibold text-base">{formatINR(grandTotal)}</p>
            </div>
          </div>

          {/* Items */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Pill className="h-4 w-4" />
              Prescription Items ({items.length})
            </h4>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No items found</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medicine</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead className="text-center">Prescribed</TableHead>
                      <TableHead className="text-center">Dispensed</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Batch / Expiry</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsWithMoney.map((item) => {
                      const isComplete = item.quantity_dispensed >= item.quantity_prescribed;
                      const batches = Array.isArray(item.batch_numbers)
                        ? item.batch_numbers.filter(Boolean)
                        : [];
                      const alreadyDispensed = item.quantity_dispensed > 0;
                      const editable = canEdit && !alreadyDispensed;
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex items-start gap-1.5">
                              <div className="min-w-0">
                                <p className="font-medium text-sm">{item.medicine_name}</p>
                                {item.special_instructions && (
                                  <p className="text-xs text-muted-foreground">{item.special_instructions}</p>
                                )}
                                {item.is_substituted && (
                                  <p className="text-xs text-amber-700 mt-0.5">
                                    Substituted{item.substitute_reason ? `: ${item.substitute_reason}` : ''}
                                  </p>
                                )}
                                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                  {stockBadge(stockMap[item.id])}
                                  {canEdit && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1.5 text-xs text-blue-600 hover:text-blue-700 print:hidden"
                                      disabled={alreadyDispensed}
                                      title={
                                        alreadyDispensed
                                          ? 'Already dispensed — cannot change'
                                          : 'Change medicine'
                                      }
                                      onClick={() => {
                                        setChangeItem(item);
                                        setSelectedMedicine(null);
                                        setSubstituteReason('');
                                      }}
                                    >
                                      <Pencil className="h-3 w-3 mr-1" />
                                      Change
                                    </Button>
                                  )}
                                </div>
                              </div>
                              {item.is_substituted && (
                                <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700 shrink-0">
                                  SUB
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {editable ? (
                              <EditableDropdown
                                value={item.dosage_frequency || ''}
                                options={FREQUENCY_OPTIONS}
                                onChange={(v) => updateItemField(item.id, 'dosage_frequency', v)}
                                className="w-24"
                                placeholder="Freq."
                              />
                            ) : (
                              item.dosage_frequency || '—'
                            )}
                            {item.dosage_timing && (
                              <p className="text-xs text-muted-foreground">{item.dosage_timing}</p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {editable ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  min={0}
                                  value={item.duration_days ?? ''}
                                  onChange={(e) =>
                                    updateItemField(
                                      item.id,
                                      'duration_days',
                                      e.target.value === ''
                                        ? null
                                        : Math.max(0, parseInt(e.target.value) || 0)
                                    )
                                  }
                                  className="w-16 h-8"
                                />
                                <span className="text-xs text-muted-foreground">days</span>
                              </div>
                            ) : item.duration_days ? (
                              `${item.duration_days} days`
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {editable ? (
                              <Input
                                type="number"
                                min={1}
                                value={item.quantity_prescribed}
                                onChange={(e) =>
                                  updateItemField(
                                    item.id,
                                    'quantity_prescribed',
                                    Math.max(1, parseInt(e.target.value) || 1)
                                  )
                                }
                                className="w-16 h-8 text-center mx-auto"
                              />
                            ) : (
                              item.quantity_prescribed
                            )}
                          </TableCell>
                          <TableCell className="text-center">{item.quantity_dispensed}</TableCell>
                          <TableCell className="text-right text-sm tabular-nums">
                            {item._unitPrice > 0 ? formatINR(item._unitPrice) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums">
                            {item._amount > 0 ? formatINR(item._amount) : '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {batches.length > 0 ? (
                              <div>
                                <div className="font-mono">{batches.join(', ')}</div>
                                <div className="text-muted-foreground">Exp: {formatExpiry(item.earliest_expiry)}</div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={isComplete ? 'default' : 'secondary'} className="text-xs">
                              {isComplete ? 'Complete' : 'Pending'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {grandTotal > 0 && (
                      <TableRow className="bg-gray-50 font-semibold">
                        <TableCell colSpan={6} className="text-right">Grand Total</TableCell>
                        <TableCell className="text-right tabular-nums">{formatINR(grandTotal)}</TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Drug-interaction advisory */}
          {items.length > 0 && (
            <div className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  Drug Interaction Check
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runInteractionCheck}
                  disabled={interactionStatus === 'checking'}
                >
                  {interactionStatus === 'checking' ? 'Checking…' : 'Re-check'}
                </Button>
              </div>

              {interactionStatus === 'checking' && (
                <p className="text-sm text-muted-foreground">
                  Analyzing medicines for interactions…
                </p>
              )}
              {interactionStatus === 'error' && (
                <p className="text-sm text-red-600">{interactionError}</p>
              )}
              {interactionStatus === 'done' && interactionReport && (
                interactionReport.interactions.length === 0 ? (
                  <p className="text-sm text-green-700">
                    No significant interactions found among these medicines.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {interactionReport.interactions.map((ix, i) => {
                      const sev = (ix.severity || 'minor').toLowerCase();
                      const box =
                        sev === 'major'
                          ? 'border-red-200 bg-red-50'
                          : sev === 'moderate'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-gray-200 bg-gray-50';
                      const badge =
                        sev === 'major'
                          ? 'bg-red-100 text-red-700 border-red-200'
                          : sev === 'moderate'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-gray-100 text-gray-700 border-gray-200';
                      return (
                        <div key={i} className={`border rounded p-2 ${box}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className={`text-[10px] uppercase ${badge}`}>{sev}</Badge>
                            <span className="font-medium text-sm">
                              {(ix.drugs || []).join('  +  ')}
                            </span>
                          </div>
                          {ix.effect && <p className="text-sm mt-1">{ix.effect}</p>}
                          {ix.recommendation && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Advice: {ix.recommendation}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              <p className="text-[11px] text-muted-foreground mt-2">
                ⚠️ AI-generated advisory — verify against a clinical drug-interaction reference.
                This does not block dispensing.
              </p>
            </div>
          )}
        </div>

        {/* RIGHT — original prescription photo */}
        <div className="lg:sticky lg:top-0 print:hidden">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Prescription Photo
          </h4>
          <PrescriptionPhotoPane
            imageUrl={prescription.prescription_image_url}
            imageType={prescription.prescription_image_type}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t pt-2 print:hidden">
        {dirtyItemIds.size > 0 && (
          <Button onClick={handleSaveEdits} disabled={isSavingEdits}>
            {isSavingEdits ? 'Saving…' : `Save changes (${dirtyItemIds.size})`}
          </Button>
        )}
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1" />
          Print
        </Button>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Change-medicine dialog */}
      <Dialog open={!!changeItem} onOpenChange={(o) => { if (!o) closeChangeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Change medicine{changeItem ? ` — ${changeItem.medicine_name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <StockMedicinePicker onSelect={setSelectedMedicine} />
            {selectedMedicine && (
              <div className="text-sm bg-green-50 border border-green-200 rounded p-2">
                Selected: <span className="font-medium">{selectedMedicine.name}</span>{' '}
                ({selectedMedicine.totalStock > 0
                  ? `${selectedMedicine.totalStock} in stock`
                  : 'out of stock'})
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground">Reason for substitution</label>
              <Input
                value={substituteReason}
                onChange={(e) => setSubstituteReason(e.target.value)}
                placeholder="e.g. Prescribed medicine out of stock"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeChangeDialog}>
                Cancel
              </Button>
              <Button onClick={handleConfirmChange} disabled={!selectedMedicine || isSaving}>
                {isSaving ? 'Saving…' : 'Confirm change'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────

interface PrescriptionQueueProps {
  autoOpenPrescriptionId?: string | null;
  onAutoOpenHandled?: () => void;
}

const PrescriptionQueue: React.FC<PrescriptionQueueProps> = ({ autoOpenPrescriptionId, onAutoOpenHandled }) => {
  const { hospitalType } = useAuth();
  const [activeStatusTab, setActiveStatusTab] = useState<StatusTab>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewPrescription, setViewPrescription] = useState<Prescription | null>(null);
  const [dispensePrescription, setDispensePrescription] = useState<Prescription | null>(null);

  const {
    data: prescriptions = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<Prescription[]>({
    queryKey: ['prescription-queue'],
    queryFn: fetchPrescriptions,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  // Auto-open detail dialog when triggered from the bell dropdown
  useEffect(() => {
    if (!autoOpenPrescriptionId || !prescriptions.length) return;
    const found = prescriptions.find((p) => p.id === autoOpenPrescriptionId);
    if (found) {
      setViewPrescription(found);
      onAutoOpenHandled?.();
    }
  }, [autoOpenPrescriptionId, prescriptions]);

  // Ward orders are hospital-specific — a pharmacist only sees their own
  // hospital's ward orders. Camera/manual prescriptions (source !== 'ward')
  // are unchanged.
  const scoped = prescriptions.filter(
    (p) => p.source !== 'ward' || p.hospital_name === hospitalType,
  );

  // Filter by status tab
  const statusFiltered =
    activeStatusTab === 'ALL'
      ? scoped
      : scoped.filter((p) => p.status === activeStatusTab);

  // Filter by search term
  const filtered = statusFiltered.filter((p) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      p.prescription_number.toLowerCase().includes(term) ||
      (p.patient_name || '').toLowerCase().includes(term) ||
      (p.doctor_name || '').toLowerCase().includes(term)
    );
  });

  // Count per status for badges (hospital-scoped, same as the visible list)
  const countByStatus = (status: string) =>
    scoped.filter((p) => p.status === status).length;

  const pendingCount = countByStatus('PENDING');
  const approvedCount = countByStatus('APPROVED');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              Prescription Queue
              {(pendingCount + approvedCount) > 0 && (
                <span className="bg-orange-100 text-orange-700 text-sm font-semibold px-2 py-0.5 rounded-full">
                  {pendingCount + approvedCount} action{pendingCount + approvedCount !== 1 ? 's' : ''} needed
                </span>
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              View and dispense prescriptions from patients
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-2 border-b pb-2 flex-wrap">
        {STATUS_TABS.map((tab) => {
          const count =
            tab === 'ALL'
              ? prescriptions.length
              : countByStatus(tab);
          const isActive = activeStatusTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveStatusTab(tab)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-white text-muted-foreground border-gray-200 hover:border-gray-300 hover:text-foreground'
              }`}
            >
              {formatStatusLabel(tab)}
              {count > 0 && (
                <span className={`ml-1.5 text-xs font-semibold ${isActive ? 'opacity-80' : 'text-muted-foreground'}`}>
                  ({count})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name or prescription number..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Prescriptions
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({filtered.length} result{filtered.length !== 1 ? 's' : ''})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isError && (
            <div className="text-center py-8 text-red-500">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p>Failed to load prescriptions. Please refresh.</p>
            </div>
          )}

          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin" />
              <p>Loading prescriptions...</p>
            </div>
          )}

          {!isLoading && !isError && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prescription #</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Items</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <FileText className="h-8 w-8" />
                          <p>
                            {searchTerm
                              ? 'No prescriptions match your search.'
                              : 'No prescriptions found.'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((prescription) => (
                      <TableRow key={prescription.id}>
                        <TableCell>
                          <p className="font-mono font-medium text-sm">
                            {prescription.prescription_number}
                          </p>
                          {prescription.source === 'ward' && (
                            <Badge className="mt-1 text-[10px] bg-purple-100 text-purple-700 border-purple-200">
                              Ward
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <User className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm">{prescription.patient_name}</span>
                          </div>
                        </TableCell>

                        <TableCell>
                          {prescription.patient_location ? (
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              prescription.patient_location === 'ICU'  ? 'bg-red-100 text-red-700' :
                              prescription.patient_location === 'Ward' ? 'bg-blue-100 text-blue-700' :
                              prescription.patient_location === 'Room' ? 'bg-green-100 text-green-700' :
                              prescription.patient_location === 'OT'   ? 'bg-orange-100 text-orange-700' : ''
                            }`}>
                              {prescription.patient_location}
                            </span>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Stethoscope className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm">{prescription.doctor_name || '—'}</span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm">{prescription.prescription_date || '—'}</span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              className={`${getStatusBadgeClass(prescription.status)} border text-xs flex items-center gap-1 w-fit`}
                            >
                              {getStatusIcon(prescription.status)}
                              {formatStatusLabel(prescription.status)}
                            </Badge>
                            {prescription.status === 'PENDING' && (
                              <span className="text-xs text-yellow-600 font-medium">
                                Awaiting Doctor Approval
                              </span>
                            )}
                          </div>
                        </TableCell>

                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Pill className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">
                              {prescription.prescription_items.length}
                            </span>
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            {/* View button — always visible */}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setViewPrescription(prescription)}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              View
                            </Button>

                            {/* Dispense button — only for APPROVED & PARTIALLY_DISPENSED */}
                            {(prescription.status === 'APPROVED' ||
                              prescription.status === 'PARTIALLY_DISPENSED') && (
                              <Button
                                size="sm"
                                onClick={() => setDispensePrescription(prescription)}
                              >
                                <Package className="h-3 w-3 mr-1" />
                                Dispense
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Detail Modal */}
      <Dialog open={!!viewPrescription} onOpenChange={() => setViewPrescription(null)}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Prescription Details — {viewPrescription?.prescription_number}
            </DialogTitle>
          </DialogHeader>
          {viewPrescription && (
            <DetailModal
              prescription={viewPrescription}
              onClose={() => setViewPrescription(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dispense Modal */}
      <Dialog open={!!dispensePrescription} onOpenChange={() => setDispensePrescription(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Dispense Prescription — {dispensePrescription?.prescription_number}
            </DialogTitle>
          </DialogHeader>
          {dispensePrescription && (
            <DispenseModal
              prescription={dispensePrescription}
              onClose={() => setDispensePrescription(null)}
              hospitalName={hospitalType || 'hope'}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrescriptionQueue;
