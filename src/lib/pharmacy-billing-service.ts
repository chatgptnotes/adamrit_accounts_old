/**
 * Pharmacy Billing Service
 * Handles saving pharmacy sales to pharmacy_sales and pharmacy_sale_items tables
 */

import { supabase } from '@/integrations/supabase/client';

export interface CartItem {
  medicine_id: string; // UUID from medication table
  medicine_name: string;
  generic_name?: string;
  item_code?: string;
  batch_number?: string;
  expiry_date?: string;
  quantity: number;
  pack_size?: number;
  loose_quantity?: number;
  unit_price: number;
  mrp?: number;
  cost_price?: number;
  discount_percentage: number;
  discount_amount: number;
  ward_discount?: number;
  tax_percentage: number;
  tax_amount: number;
  total_amount: number;
  manufacturer?: string;
  dosage_form?: string;
  strength?: string;
  is_implant?: boolean;
}

export interface SaleData {
  sale_type?: string;
  patient_id?: number | string;  // Accept both number and string
  visit_id?: number | string;     // Accept both number and string
  patient_name?: string;
  prescription_number?: string;
  doctor_id?: number;
  doctor_name?: string;
  ward_type?: string;
  remarks?: string;
  hospital_name?: string; // Add hospital name field
  bill_number?: string; // Unique bill number (e.g., BILL1766125832838)
  sale_date?: string; // ISO date string — allows backdated bills for corporate patients
  is_ot_surgical?: boolean;
  save_request_id?: string;
  subtotal: number;
  discount: number;
  discount_percentage?: number;
  tax_gst: number;
  tax_percentage?: number;
  total_amount: number;
  payment_method: 'CASH' | 'CARD' | 'UPI' | 'INSURANCE' | 'CREDIT';
  payment_status?: 'PENDING' | 'COMPLETED' | 'REFUNDED' | 'CANCELLED';
  created_by?: string;
  items: CartItem[];
}

export interface SaleResponse {
  success: boolean;
  sale_id?: number;
  error?: string;
  message?: string;
}

/**
 * Save pharmacy sale to database
 * Creates records in pharmacy_sales (header) and pharmacy_sale_items (line items)
 */
export async function savePharmacySale(saleData: SaleData): Promise<SaleResponse> {
  try {
    // Validate items
    if (!saleData.items || saleData.items.length === 0) {
      return {
        success: false,
        error: 'No items in cart to save'
      };
    }

    // Map the existing frontend item shape to database columns once. The
    // database RPC inserts the header, all items and the threshold result in a
    // single transaction.
    const saleItems = saleData.items.map(item => {
      return {
        medication_id: item.medicine_id || null, // May be null if FK constraint is removed
        medication_name: item.medicine_name || 'Unknown', // Ensure not null
        generic_name: item.generic_name || null,
        item_code: item.item_code || null,
        batch_number: item.batch_number || null,
        expiry_date: item.expiry_date || null,
        quantity: item.quantity,
        pack_size: item.pack_size || 1,
        loose_quantity: item.loose_quantity || 0,
        unit_price: item.unit_price,
        mrp: item.mrp || item.unit_price,
        cost_price: item.cost_price || null,
        discount: item.discount_amount || 0,
        discount_percentage: item.discount_percentage || 0,
        ward_discount: item.ward_discount || 0,
        tax_amount: item.tax_amount || 0,
        tax_percentage: item.tax_percentage || 0,
        total_price: item.total_amount,
        manufacturer: item.manufacturer || null,
        dosage_form: item.dosage_form || null,
        strength: item.strength || null,
        is_implant: item.is_implant || false
      };
    });

    const requestId = saleData.save_request_id || crypto.randomUUID();
    const rpcArgs = {
      p_sale: {
        sale_type: saleData.sale_type,
        patient_id: saleData.patient_id,
        visit_id: saleData.visit_id,
        patient_name: saleData.patient_name,
        prescription_number: saleData.prescription_number,
        doctor_id: saleData.doctor_id,
        doctor_name: saleData.doctor_name,
        ward_type: saleData.ward_type,
        remarks: saleData.remarks,
        hospital_name: saleData.hospital_name,
        bill_number: saleData.bill_number,
        subtotal: saleData.subtotal,
        discount: saleData.discount,
        discount_percentage: saleData.discount_percentage || 0,
        tax_gst: saleData.tax_gst,
        tax_percentage: saleData.tax_percentage || 0,
        total_amount: saleData.total_amount,
        payment_method: saleData.payment_method,
        payment_status: saleData.payment_status || 'COMPLETED',
        sale_date: saleData.sale_date || new Date().toISOString(),
        is_ot_surgical: saleData.is_ot_surgical || false
      },
      p_items: saleItems,
      p_created_by: saleData.created_by || null,
      p_request_id: requestId
    };

    // One retry with the same request ID is safe even if the first response
    // was lost after commit: the database returns the original sale.
    let rpcResponse = await (supabase as any).rpc(
      'save_pharmacy_sale_atomic',
      rpcArgs
    );
    if (rpcResponse.error) {
      rpcResponse = await (supabase as any).rpc(
        'save_pharmacy_sale_atomic',
        rpcArgs
      );
    }
    const { data, error } = rpcResponse;

    if (error) {
      console.error('Atomic pharmacy sale failed:', error);
      return {
        success: false,
        error: `Failed to save sale: ${error.message}`
      };
    }

    const result = data as {
      success?: boolean;
      sale_id?: number;
      duplicate_request?: boolean;
    } | null;

    if (!result?.success || !result.sale_id) {
      return {
        success: false,
        error: 'Database did not confirm the pharmacy sale'
      };
    }

    return {
      success: true,
      sale_id: result.sale_id,
      message: result.duplicate_request
        ? 'Sale was already saved successfully'
        : 'Sale saved successfully'
    };

  } catch (error: any) {
    console.error('Unexpected error saving sale:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    };
  }
}

/**
 * Alternative: Use RPC function (if you created create_pharmacy_sale function)
 */
export async function savePharmacySaleRPC(saleData: SaleData): Promise<SaleResponse> {
  try {
    const { data: saleId, error } = await supabase.rpc('create_pharmacy_sale', {
      p_sale_type: saleData.sale_type || 'Other',
      p_patient_id: saleData.patient_id || null,
      p_patient_name: saleData.patient_name || null,
      p_visit_id: saleData.visit_id || null,
      p_payment_method: saleData.payment_method,
      p_items: saleData.items.map(item => ({
        medication_id: item.medicine_id,
        medication_name: item.medicine_name,
        generic_name: item.generic_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount_amount,
        item_code: item.item_code,
        batch_number: item.batch_number
      }))
    });

    if (error) {
      return {
        success: false,
        error: error.message
      };
    }

    return {
      success: true,
      sale_id: saleId,
      message: 'Sale saved successfully via RPC'
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get sale by ID with all items
 */
export async function getSaleById(saleId: number) {
  const { data, error } = await supabase
    .from('v_pharmacy_sales_complete')
    .select('*')
    .eq('sale_id', saleId);

  if (error) {
    console.error('Error fetching sale:', error);
    return null;
  }

  return data;
}

/**
 * Get patient sales history
 */
export async function getPatientSalesHistory(patientId: number) {
  const { data, error } = await supabase
    .from('v_pharmacy_sales_complete')
    .select('*')
    .eq('patient_id', patientId)
    .order('sale_date', { ascending: false });

  if (error) {
    console.error('Error fetching patient sales:', error);
    return [];
  }

  return data || [];
}

/**
 * Get today's sales
 */
export async function getTodaySales() {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('pharmacy_sales')
    .select('*')
    .gte('sale_date', `${today}T00:00:00`)
    .lte('sale_date', `${today}T23:59:59`)
    .order('sale_date', { ascending: false });

  if (error) {
    console.error('Error fetching today sales:', error);
    return [];
  }

  return data || [];
}
