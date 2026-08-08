import { supabaseClient } from '@/utils/supabase-client';

export interface PurchaseOrder {
  id: string;
  po_number: string;
  order_date: string;
  order_for?: string;
  supplier_id?: number;
  status?: string;
  notes?: string;
  subtotal?: number;
  discount?: number;
  tax_amount?: number;
  total_amount?: number;
  expected_delivery_date?: string;
  actual_delivery_date?: string;
  approved_by?: string;
  approved_at?: string;
  created_at?: string;
  updated_at?: string;
}

export class PurchaseOrderService {
  /**
   * Generate a unique PO number in format: PO/YY-SEQUENCE
   * Example: PO/25-18063
   */
  static async generatePONumber(): Promise<string> {
    try {
      // Get current year (last 2 digits)
      const currentYear = new Date().getFullYear().toString().slice(-2);

      // Get the latest PO number for the current year
      const { data, error } = await supabaseClient
        .from('purchase_orders')
        .select('po_number')
        .like('po_number', `PO/${currentYear}-%`)
        .order('po_number', { ascending: false })
        .limit(1);

      if (error) {
        console.error('Error fetching latest PO number:', error);
        // If error or no records, start from 1
        return `PO/${currentYear}-10001`;
      }

      if (!data || data.length === 0) {
        // No PO for current year, start from 10001
        return `PO/${currentYear}-10001`;
      }

      // Extract sequence number from latest PO
      const latestPO = data[0].po_number;
      const match = latestPO.match(/PO\/\d{2}-(\d+)/);

      if (match) {
        const lastSequence = parseInt(match[1], 10);
        const newSequence = lastSequence + 1;
        return `PO/${currentYear}-${newSequence}`;
      }

      // Fallback if pattern doesn't match
      return `PO/${currentYear}-10001`;
    } catch (error) {
      console.error('Error generating PO number:', error);
      const currentYear = new Date().getFullYear().toString().slice(-2);
      return `PO/${currentYear}-10001`;
    }
  }

  /**
   * Get all purchase orders
   */
  static async getAll(): Promise<PurchaseOrder[]> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase orders:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Create a new purchase order
   */
  static async create(purchaseOrder: Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>): Promise<PurchaseOrder> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .insert([purchaseOrder])
      .select()
      .single();

    if (error) {
      console.error('Error creating purchase order:', error);
      throw error;
    }

    return data;
  }

  /**
   * Get purchase order by ID
   */
  static async getById(id: string): Promise<PurchaseOrder | null> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching purchase order:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update a purchase order
   */
  static async update(id: string, purchaseOrder: Partial<Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>>): Promise<PurchaseOrder> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .update({ ...purchaseOrder, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating purchase order:', error);
      throw error;
    }

    return data;
  }

  /**
   * Cancel a purchase order (soft-delete — preserves audit trail)
   */
  static async delete(id: string): Promise<void> {
    const { error } = await supabaseClient
      .from('purchase_orders')
      .update({ status: 'Cancelled', updated_at: new Date().toISOString() } as any)
      .eq('id', id);

    if (error) {
      console.error('Error cancelling purchase order:', error);
      throw error;
    }
  }

  /**
   * Search purchase orders by PO number or supplier
   */
  static async search(searchTerm: string): Promise<PurchaseOrder[]> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .select('*')
      .or(`po_number.ilike.%${searchTerm}%,notes.ilike.%${searchTerm}%`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error searching purchase orders:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get purchase orders by status
   */
  static async getByStatus(status: string): Promise<PurchaseOrder[]> {
    const { data, error } = await supabaseClient
      .from('purchase_orders')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching purchase orders by status:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get purchase order items by purchase order ID
   */
  static async getPurchaseOrderItems(purchaseOrderId: string): Promise<any[]> {
    const { data, error } = await supabaseClient
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', purchaseOrderId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching purchase order items:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Update a purchase order item
   */
  static async updatePurchaseOrderItem(itemId: string, itemData: any): Promise<any> {
    const { data, error } = await supabaseClient
      .from('purchase_order_items')
      .update(itemData)
      .eq('id', itemId)
      .select()
      .single();

    if (error) {
      console.error('Error updating purchase order item:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update purchase order with items
   */
  static async updatePurchaseOrderWithItems(
    poId: string,
    poData: Partial<Omit<PurchaseOrder, 'id' | 'created_at' | 'updated_at'>>,
    items: Array<{
      id?: string;
      medicine_id?: string;
      product_name: string;
      manufacturer: string;
      pack: string;
      batch_no: string;
      expiry_date?: string;
      mrp: number;
      sale_price: number;
      purchase_price: number;
      tax_percentage: number;
      tax_amount: number;
      order_quantity: number;
      received_quantity?: number;
      free_quantity?: number;
      amount: number;
      gst?: number;
      sgst?: number;
      cgst?: number;
      gst_amount?: number;
    }>
  ): Promise<{ po: PurchaseOrder; items: any[] }> {
    try {
      // 1. Update purchase order header
      const { data: poResult, error: poError } = await supabaseClient
        .from('purchase_orders')
        .update({
          ...poData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId)
        .select()
        .single();

      if (poError) {
        console.error('Error updating purchase order:', poError);
        throw poError;
      }

      // 2. Update purchase order items
      const updatedItems = [];
      for (const item of items) {
        if (item.id) {
          // Update existing item
          const { data: itemResult, error: itemError } = await supabaseClient
            .from('purchase_order_items')
            .update({
              product_name: item.product_name,
              manufacturer: item.manufacturer,
              pack: item.pack,
              batch_no: item.batch_no,
              expiry_date: item.expiry_date,
              mrp: item.mrp,
              sale_price: item.sale_price,
              purchase_price: item.purchase_price,
              tax_percentage: item.tax_percentage,
              tax_amount: item.tax_amount,
              order_quantity: item.order_quantity,
              received_quantity: item.received_quantity,
              amount: item.amount,
            })
            .eq('id', item.id)
            .select()
            .single();

          if (itemError) {
            console.error('Error updating item:', itemError);
            throw itemError;
          }
          updatedItems.push(itemResult);
        }
      }

      return {
        po: poResult,
        items: updatedItems,
      };
    } catch (error) {
      console.error('Error in updatePurchaseOrderWithItems:', error);
      throw error;
    }
  }

  /**
   * Create purchase order with items and update medicine inventory
   */
  static async createWithItems(
    poData: {
      po_number: string;
      order_date: string;
      order_for: string;
      supplier_id: number;
      subtotal: number;
      tax_amount: number;
      total_amount: number;
    },
    items: Array<{
      medicine_id?: string;
      product_name: string;
      manufacturer: string;
      pack: string;
      batch_no: string;
      mrp: number;
      sale_price: number;
      purchase_price: number;
      tax: number;
      order_qty: number;
      vat_amt: number;
      amount: number;
    }>
  ): Promise<{ po: PurchaseOrder; items: any[] }> {
    try {
      // 1. Create purchase order header.
      // po_number is generated when the form opens, so another user can claim
      // the same number before this one is saved. On a unique violation take
      // the next free number and retry instead of failing the whole PO.
      let poNumber = poData.po_number;
      let poResult: PurchaseOrder | null = null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error: poError } = await supabaseClient
          .from('purchase_orders')
          .insert([{
            po_number: poNumber,
            order_date: poData.order_date,
            order_for: poData.order_for,
            supplier_id: poData.supplier_id,
            status: 'Pending',
            subtotal: poData.subtotal,
            tax_amount: poData.tax_amount,
            total_amount: poData.total_amount,
          }])
          .select()
          .single();

        if (!poError) {
          poResult = data;
          break;
        }

        if (poError.code !== '23505' || attempt === 4) {
          console.error('Error creating purchase order:', poError);
          throw poError;
        }

        const regenerated = await PurchaseOrderService.generatePONumber();
        // A stale read would hand back the number that just collided; step past
        // it so every retry moves forward.
        poNumber = regenerated === poNumber
          ? poNumber.replace(/(\d+)$/, (seq) => String(parseInt(seq, 10) + 1))
          : regenerated;
      }

      if (!poResult) {
        throw new Error('Could not allocate a free purchase order number.');
      }

      // 2. Create purchase order items
      const itemsToInsert = items.map(item => ({
        purchase_order_id: poResult.id,
        medicine_id: item.medicine_id,
        product_name: item.product_name,
        manufacturer: item.manufacturer,
        pack: item.pack,
        batch_no: item.batch_no,
        mrp: item.mrp,
        sale_price: item.sale_price,
        purchase_price: item.purchase_price,
        tax_percentage: item.tax,
        tax_amount: item.vat_amt,
        order_quantity: item.order_qty,
        amount: item.amount,
      }));

      const { data: itemsResult, error: itemsError } = await supabaseClient
        .from('purchase_order_items')
        .insert(itemsToInsert)
        .select();

      if (itemsError) {
        console.error('Error creating purchase order items:', itemsError);
        throw itemsError;
      }

      // NOTE: Stock is NOT updated here. Stock is only updated when GRN (Goods Received Note) is posted.
      // This ensures inventory reflects only actually received goods, not just ordered quantities.

      return {
        po: poResult,
        items: itemsResult || [],
      };
    } catch (error) {
      console.error('Error in createWithItems:', error);
      throw error;
    }
  }
}
