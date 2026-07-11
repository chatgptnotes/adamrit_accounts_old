import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface ImplantBillItem {
  description: string;
  batchNo: string;
  qty: string;
  rate: string;
  amount: string;
}

export interface SavedImplantBill {
  id: string;
  visitId: string;
  billNo: number;
  billDate: string | null;
  vendorName: string;
  vendorAddress: string;
  items: ImplantBillItem[];
  totalAmount: number;
}

export interface SavedImplantSticker {
  id: string;
  visitId: string;
  batchNumbers: string;
  surgeryDate: string | null;
  surgeryName: string;
}

export async function fetchImplantBillByVisit(visitId: string): Promise<SavedImplantBill | null> {
  const { data, error } = await db
    .from('implant_bills')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    visitId: data.visit_id,
    billNo: data.bill_no,
    billDate: data.bill_date,
    vendorName: data.vendor_name || '',
    vendorAddress: data.vendor_address || '',
    items: (data.items || []) as ImplantBillItem[],
    totalAmount: Number(data.total_amount) || 0,
  };
}

export async function fetchNextImplantBillNo(): Promise<number> {
  const { data, error } = await db
    .from('implant_bills')
    .select('bill_no')
    .order('bill_no', { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data?.[0]?.bill_no as number) || 0) + 1;
}

export async function saveImplantBill(payload: {
  visitId: string;
  billNo: number;
  billDate: string;
  vendorName: string;
  vendorAddress: string;
  items: ImplantBillItem[];
  totalAmount: number;
}): Promise<void> {
  const { data: existing, error: existingError } = await db
    .from('implant_bills')
    .select('id')
    .eq('visit_id', payload.visitId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  const record = {
    visit_id: payload.visitId,
    bill_no: payload.billNo,
    bill_date: payload.billDate || null,
    vendor_name: payload.vendorName,
    vendor_address: payload.vendorAddress,
    items: payload.items,
    total_amount: payload.totalAmount,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db.from('implant_bills').update(record).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from('implant_bills').insert(record);
    if (error) throw error;
  }
}

export async function fetchImplantStickerByVisit(visitId: string): Promise<SavedImplantSticker | null> {
  const { data, error } = await db
    .from('implant_stickers')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    visitId: data.visit_id,
    batchNumbers: data.batch_numbers || '',
    surgeryDate: data.surgery_date,
    surgeryName: data.surgery_name || '',
  };
}

export async function saveImplantSticker(payload: {
  visitId: string;
  batchNumbers: string;
  surgeryDate: string;
  surgeryName: string;
}): Promise<void> {
  const { data: existing, error: existingError } = await db
    .from('implant_stickers')
    .select('id')
    .eq('visit_id', payload.visitId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  const record = {
    visit_id: payload.visitId,
    batch_numbers: payload.batchNumbers,
    surgery_date: payload.surgeryDate || null,
    surgery_name: payload.surgeryName,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db.from('implant_stickers').update(record).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await db.from('implant_stickers').insert(record);
    if (error) throw error;
  }
}
