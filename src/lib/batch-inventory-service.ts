import { supabase } from "@/integrations/supabase/client";

// ==================== INTERFACES ====================

export interface BatchFilters {
  expiry_status?: 'EXPIRED' | 'EXPIRING_SOON' | 'NEAR_EXPIRY' | 'GOOD';
  has_stock?: boolean;
  supplier_id?: number;
  medicine_id?: string;
  search_term?: string;
  from_date?: string;
  to_date?: string;
}

export interface StockAdjustment {
  batch_id: string;
  adjustment_type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'DAMAGE' | 'EXPIRY';
  quantity: number;
  reason: string;
  performed_by?: string;
  reference_type?: string;
  reference_id?: string;
}

export interface BatchAllocation {
  batch_id: string;
  batch_number: string;
  allocated_quantity: number;
  remaining_stock: number;
  expiry_date: string;
  selling_price: number;
}

export interface BatchSummary {
  medicine_id: string;
  medicine_name: string;
  total_batches: number;
  total_stock: number;
  total_value: number;
  expired_batches: number;
  near_expiry_batches: number;
  oldest_batch_expiry: string | null;
  newest_batch_expiry: string | null;
}

export interface BatchAlert {
  id: string;
  batch_id: string;
  medicine_name: string;
  batch_number: string;
  alert_type: 'EXPIRED' | 'EXPIRING_SOON' | 'LOW_STOCK' | 'NEAR_EXPIRY';
  expiry_date?: string;
  days_to_expiry?: number;
  current_stock: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

// ==================== CORE BATCH OPERATIONS ====================

/**
 * Get all batches for a medicine with optional filters
 */
export async function getMedicineBatches(
  medicine_id: string,
  hospital_name: string,
  filters?: BatchFilters
) {
  try {
    let query = supabase
      .from('medicine_batch_inventory')
      .select(`
        *,
        medication:medicine_id (
          product_name,
          generic,
          manufacturer
        )
      `)
      .eq('medicine_id', medicine_id)
      .eq('hospital_name', hospital_name)
      .eq('is_active', true)
      .order('expiry_date', { ascending: true });

    // Apply filters
    if (filters?.has_stock) {
      query = query.gt('current_stock', 0);
    }

    if (filters?.supplier_id) {
      query = query.eq('supplier_id', filters.supplier_id);
    }

    if (filters?.from_date) {
      query = query.gte('manufacturing_date', filters.from_date);
    }

    if (filters?.to_date) {
      query = query.lte('expiry_date', filters.to_date);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching medicine batches:', error);
    throw error;
  }
}

/**
 * Get all batch inventory with details (uses view)
 */
export async function getAllBatchInventory(
  hospital_name: string,
  filters?: BatchFilters
) {
  try {
    // First try the view
    let query = supabase
      .from('v_batch_stock_details')
      .select('*')
      .eq('hospital_name', hospital_name)
      .order('expiry_date', { ascending: true });

    // Apply filters
    if (filters?.expiry_status) {
      query = query.eq('expiry_status', filters.expiry_status);
    }

    if (filters?.has_stock) {
      query = query.gt('current_stock', 0);
    }

    if (filters?.search_term) {
      query = query.or(`medicine_name.ilike.%${filters.search_term}%,batch_number.ilike.%${filters.search_term}%`);
    }

    const { data, error } = await query;

    // If view returns data with missing medicine_name, enrich it
    if (!error && data && data.length > 0) {
      // FIRST: Fetch pieces_per_pack from base table (view doesn't have it)
      const batchIds = data.map(d => d.id).filter(Boolean);
      let piecesPerPackMap = new Map<string, number>();

      // Chunk the id list: a single .in() with ~1000 uuids exceeds the
      // PostgREST URL length limit and the whole request 400s.
      const CHUNK_SIZE = 200;
      for (let i = 0; i < batchIds.length; i += CHUNK_SIZE) {
        const { data: batchDetails } = await supabase
          .from('medicine_batch_inventory')
          .select('id, pieces_per_pack')
          .in('id', batchIds.slice(i, i + CHUNK_SIZE));

        if (batchDetails) {
          for (const b of batchDetails) {
            piecesPerPackMap.set(b.id, b.pieces_per_pack || 1);
          }
        }
      }

      // Check if medicine names are missing
      const needsEnrichment = data.some(d => !d.medicine_name || d.medicine_name === 'Unknown');

      if (needsEnrichment) {
        const medicineIds = [...new Set(data.map(b => b.medicine_id).filter(Boolean))];

        if (medicineIds.length > 0) {
          // Chunked .in() — one request per 200 ids instead of a .single()
          // per id, which 406s on every medicine_id missing from the master.
          const medicineMap = new Map();

          for (let i = 0; i < medicineIds.length; i += CHUNK_SIZE) {
            const { data: medicines } = await supabase
              .from('medicine_master')
              .select('id, medicine_name, generic_name, type')
              .in('id', medicineIds.slice(i, i + CHUNK_SIZE));

            for (const medicine of medicines || []) {
              medicineMap.set(medicine.id, medicine);
            }
          }

          if (medicineMap.size > 0) {
            return data.map(batch => {
              const medicine = medicineMap.get(batch.medicine_id);
              const piecesPerPack = piecesPerPackMap.get(batch.id) || 1;
              return {
                ...batch,
                medicine_name: medicine?.medicine_name || batch.medicine_name || 'Unknown',
                generic_name: medicine?.generic_name || batch.generic_name,
                dosage_form: medicine?.type || batch.dosage_form,
                pieces_per_pack: piecesPerPack
              };
            });
          }
        }
      }

      // Ensure pieces_per_pack is always included (from base table fetch)
      return data.map(batch => ({
        ...batch,
        pieces_per_pack: piecesPerPackMap.get(batch.id) || 1
      }));
    }

    // If view doesn't exist or fails, fallback to direct table query
    if (error) {
      // Fallback: Query medicine_batch_inventory directly with medicine_master join
      const { data: batchData, error: batchError } = await supabase
        .from('medicine_batch_inventory')
        .select('*')
        .eq('hospital_name', hospital_name)
        .eq('is_active', true)
        .order('expiry_date', { ascending: true });

      if (batchError) throw batchError;

      if (!batchData || batchData.length === 0) {
        return [];
      }

      // Get medicine details separately
      const medicineIds = [...new Set(batchData.map(b => b.medicine_id).filter(Boolean))];
      let medicineMap = new Map();

      if (medicineIds.length > 0) {
        const { data: medicines } = await supabase
          .from('medicine_master')
          .select('id, medicine_name, generic_name, type')
          .in('id', medicineIds);

        if (medicines) {
          medicineMap = new Map(medicines.map(m => [m.id, m]));
        }
      }

      // Merge data
      return batchData.map(batch => {
        const medicine = medicineMap.get(batch.medicine_id) || {};
        const today = new Date();
        const expiryDate = new Date(batch.expiry_date);
        const daysToExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
          ...batch,
          medicine_name: medicine.medicine_name || 'Unknown',
          generic_name: medicine.generic_name,
          dosage_form: medicine.type,
          pieces_per_pack: batch.pieces_per_pack || 1,
          days_to_expiry: daysToExpiry,
          expiry_status: daysToExpiry < 0 ? 'EXPIRED' : daysToExpiry <= 30 ? 'EXPIRING_SOON' : daysToExpiry <= 90 ? 'NEAR_EXPIRY' : 'GOOD'
        };
      });
    }

    return data;
  } catch (error) {
    console.error('Error fetching batch inventory:', error);
    throw error;
  }
}

/**
 * Get batch inventory summary for a medicine
 */
export async function getMedicineBatchSummary(
  medicine_id: string,
  hospital_name: string
): Promise<BatchSummary | null> {
  try {
    const { data, error } = await supabase
      .from('medicine_batch_inventory')
      .select(`
        current_stock,
        mrp,
        expiry_date,
        is_expired,
        medication:medicine_id (
          product_name
        )
      `)
      .eq('medicine_id', medicine_id)
      .eq('hospital_name', hospital_name)
      .eq('is_active', true);

    if (error) throw error;
    if (!data || data.length === 0) return null;

    const now = new Date();
    const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const summary: BatchSummary = {
      medicine_id,
      medicine_name: data[0].medication?.product_name || 'Unknown',
      total_batches: data.length,
      total_stock: data.reduce((sum, batch) => sum + (batch.current_stock || 0), 0),
      total_value: data.reduce((sum, batch) => sum + ((batch.current_stock || 0) * (batch.mrp || 0)), 0),
      expired_batches: data.filter(batch => batch.is_expired).length,
      near_expiry_batches: data.filter(batch => {
        if (!batch.expiry_date) return false;
        const expiryDate = new Date(batch.expiry_date);
        return expiryDate <= ninetyDaysFromNow && expiryDate > now;
      }).length,
      oldest_batch_expiry: data.length > 0 ? data[0].expiry_date : null,
      newest_batch_expiry: data.length > 0 ? data[data.length - 1].expiry_date : null,
    };

    return summary;
  } catch (error) {
    console.error('Error fetching medicine batch summary:', error);
    throw error;
  }
}

/**
 * Adjust batch stock with audit trail
 *
 * IMPORTANT: Database has a check constraint:
 * current_stock = (received_quantity + free_quantity + adjustment_quantity) - sold_quantity - reserved_stock
 *
 * We only modify adjustment_quantity to adjust stock (current_stock is auto-calculated):
 * - To ADD stock (IN): Add positive value to adjustment_quantity
 * - To REMOVE stock (OUT/DAMAGE/EXPIRY): Add negative value to adjustment_quantity
 *
 * This keeps received_quantity and sold_quantity accurate to actual business transactions.
 */
export async function adjustBatchStock(adjustment: StockAdjustment, hospital_name: string) {
  try {
    // Get current batch data (including medicine_id and batch_number for audit trail)
    const { data: batchData, error: fetchError } = await supabase
      .from('medicine_batch_inventory')
      .select('current_stock, adjustment_quantity, medicine_id, batch_number')
      .eq('id', adjustment.batch_id)
      .single();

    if (fetchError) throw fetchError;
    if (!batchData) throw new Error('Batch not found');

    const currentStock = batchData.current_stock || 0;
    const currentAdjustmentQty = batchData.adjustment_quantity || 0;

    // Calculate adjustment change based on type
    let adjustmentChange = 0;
    let expectedNewStock = currentStock;

    switch (adjustment.adjustment_type) {
      case 'IN':
        // Adding stock - positive adjustment
        adjustmentChange = adjustment.quantity;
        expectedNewStock = currentStock + adjustment.quantity;
        break;
      case 'OUT':
      case 'DAMAGE':
      case 'EXPIRY':
        // Removing stock - negative adjustment
        if (currentStock < adjustment.quantity) {
          throw new Error('Insufficient stock for this adjustment');
        }
        adjustmentChange = -adjustment.quantity;
        expectedNewStock = currentStock - adjustment.quantity;
        break;
    }

    const newAdjustmentQty = currentAdjustmentQty + adjustmentChange;

    // Update both adjustment_quantity AND current_stock (constraint validates, doesn't auto-calculate)
    const { error: updateError } = await supabase
      .from('medicine_batch_inventory')
      .update({
        adjustment_quantity: newAdjustmentQty,
        current_stock: expectedNewStock,
        updated_at: new Date().toISOString(),
      })
      .eq('id', adjustment.batch_id);

    if (updateError) throw updateError;

    // Create stock movement record for audit trail
    const { error: movementError } = await supabase
      .from('batch_stock_movements')
      .insert({
        batch_inventory_id: adjustment.batch_id,
        medicine_id: batchData.medicine_id,
        batch_number: batchData.batch_number,
        movement_type: adjustment.adjustment_type,
        reference_type: adjustment.reference_type || 'ADJUSTMENT',
        reference_id: adjustment.reference_id,
        quantity_before: currentStock,
        quantity_changed: adjustmentChange,
        quantity_after: expectedNewStock,
        reason: adjustment.reason,
        performed_by: adjustment.performed_by,
        movement_date: new Date().toISOString(),
        hospital_name: hospital_name,
      });

    if (movementError) throw movementError;

    return { success: true, newStock: expectedNewStock };
  } catch (error) {
    console.error('Error adjusting batch stock:', error);
    throw error;
  }
}

/**
 * Get stock movement history for a batch
 */
export async function getBatchMovementHistory(batch_id: string) {
  try {
    const { data, error } = await supabase
      .from('batch_stock_movements')
      .select('*')
      .eq('batch_inventory_id', batch_id)
      .order('movement_date', { ascending: false });

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching batch movement history:', error);
    throw error;
  }
}

/**
 * Get near expiry alerts
 */
export async function getNearExpiryAlerts(
  hospital_name: string,
  days_threshold: number = 90
): Promise<BatchAlert[]> {
  try {
    const { data, error } = await supabase
      .from('v_batch_stock_details')
      .select('*')
      .eq('hospital_name', hospital_name)
      .gt('current_stock', 0)
      .in('expiry_status', ['EXPIRED', 'EXPIRING_SOON', 'NEAR_EXPIRY'])
      .order('days_to_expiry', { ascending: true });

    if (error) throw error;
    if (!data) return [];

    // Enrich with medicine names from medicine_master (view doesn't have them)
    const medicineIds = [...new Set(data.map(b => b.medicine_id).filter(Boolean))];
    const medicineMap = new Map<string, string>();

    for (const medId of medicineIds) {
      const { data: medicine } = await supabase
        .from('medicine_master')
        .select('id, medicine_name')
        .eq('id', medId)
        .single();

      if (medicine) {
        medicineMap.set(medId, medicine.medicine_name);
      }
    }

    // Transform to alert format
    const alerts: BatchAlert[] = data.map(batch => {
      let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
      let alert_type: 'EXPIRED' | 'EXPIRING_SOON' | 'LOW_STOCK' | 'NEAR_EXPIRY' = 'NEAR_EXPIRY';

      if (batch.expiry_status === 'EXPIRED') {
        severity = 'CRITICAL';
        alert_type = 'EXPIRED';
      } else if (batch.expiry_status === 'EXPIRING_SOON') {
        severity = 'HIGH';
        alert_type = 'EXPIRING_SOON';
      } else if (batch.expiry_status === 'NEAR_EXPIRY') {
        severity = 'MEDIUM';
        alert_type = 'NEAR_EXPIRY';
      }

      return {
        id: batch.id,
        batch_id: batch.id,
        medicine_name: medicineMap.get(batch.medicine_id) || batch.medicine_name || 'Unknown',
        batch_number: batch.batch_number || 'N/A',
        alert_type,
        expiry_date: batch.expiry_date,
        days_to_expiry: batch.days_to_expiry,
        current_stock: batch.current_stock || 0,
        severity,
      };
    });

    return alerts;
  } catch (error) {
    console.error('Error fetching near expiry alerts:', error);
    throw error;
  }
}

/**
 * Get low stock alerts (two-query approach - NO joins due to missing FK constraints)
 */
export async function getLowStockAlerts(hospital_name: string): Promise<BatchAlert[]> {
  try {
    // Step 1: Fetch combined stock data (no join)
    const { data: stockData, error: stockError } = await supabase
      .from('v_medicine_combined_stock')
      .select('*')
      .eq('hospital_name', hospital_name);

    if (stockError) throw stockError;
    if (!stockData || stockData.length === 0) return [];

    // Step 2: Get unique medicine_ids
    const medicineIds = [...new Set(stockData.map(s => s.medicine_id).filter(Boolean))];

    // Step 3: Fetch medicine details separately (no join)
    let medicineMap = new Map<string, { product_name: string; minimum_stock: number }>();
    if (medicineIds.length > 0) {
      const { data: medicines, error: medError } = await supabase
        .from('medicine_master')
        .select('id, medicine_name, minimum_stock')
        .in('id', medicineIds);

      if (!medError && medicines) {
        medicineMap = new Map(medicines.map(m => [m.id, {
          product_name: m.medicine_name,
          minimum_stock: m.minimum_stock || 0
        }]));
      }
    }

    // Step 4: Build alerts
    const alerts: BatchAlert[] = [];

    for (const stock of stockData) {
      const medicineInfo = medicineMap.get(stock.medicine_id);
      const minStock = medicineInfo?.minimum_stock || 0;
      const currentStock = stock.total_stock || 0;

      if (minStock > 0 && currentStock <= minStock) {
        let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM';

        if (currentStock === 0) {
          severity = 'CRITICAL';
        } else if (currentStock <= minStock * 0.5) {
          severity = 'HIGH';
        }

        alerts.push({
          id: stock.medicine_id,
          batch_id: stock.medicine_id,
          medicine_name: medicineInfo?.product_name || 'Unknown',
          batch_number: `${stock.batch_count} batch(es)`,
          alert_type: 'LOW_STOCK',
          current_stock: currentStock,
          severity,
        });
      }
    }

    return alerts;
  } catch (error) {
    console.error('Error fetching low stock alerts:', error);
    throw error;
  }
}

/**
 * Mark batch as expired
 */
export async function markBatchExpired(batch_id: string, reason: string, performed_by?: string) {
  try {
    const { error } = await supabase
      .from('medicine_batch_inventory')
      .update({
        is_expired: true,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batch_id);

    if (error) throw error;

    // Create movement record
    const { data: batchData } = await supabase
      .from('medicine_batch_inventory')
      .select('current_stock, hospital_name')
      .eq('id', batch_id)
      .single();

    if (batchData && batchData.current_stock > 0) {
      await supabase
        .from('batch_stock_movements')
        .insert({
          batch_inventory_id: batch_id,
          movement_type: 'EXPIRY',
          reference_type: 'ADJUSTMENT',
          quantity_before: batchData.current_stock,
          quantity_changed: -batchData.current_stock,
          quantity_after: 0,
          reason: reason,
          performed_by: performed_by,
          movement_date: new Date().toISOString(),
          hospital_name: batchData.hospital_name,
        });

      // Set stock to 0
      await supabase
        .from('medicine_batch_inventory')
        .update({ current_stock: 0 })
        .eq('id', batch_id);
    }

    return { success: true };
  } catch (error) {
    console.error('Error marking batch as expired:', error);
    throw error;
  }
}

/**
 * Allocate stock for sale using FEFO (First Expiry First Out)
 */
export async function allocateStockForSale(
  medicine_id: string,
  required_quantity: number,
  hospital_name: string
): Promise<BatchAllocation[]> {
  try {
    // Get available batches using the database function
    const { data, error } = await supabase
      .rpc('get_available_batches', {
        p_medicine_id: medicine_id,
        p_hospital_name: hospital_name
      });

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('No available batches for this medicine');
    }

    const allocations: BatchAllocation[] = [];
    let remainingQuantity = required_quantity;

    // Allocate from batches (FEFO sorted)
    for (const batch of data) {
      if (remainingQuantity <= 0) break;

      const availableInBatch = batch.available_stock;
      const allocateFromThisBatch = Math.min(remainingQuantity, availableInBatch);

      allocations.push({
        batch_id: batch.batch_id,
        batch_number: batch.batch_number,
        allocated_quantity: allocateFromThisBatch,
        remaining_stock: availableInBatch - allocateFromThisBatch,
        expiry_date: batch.expiry_date,
        selling_price: batch.selling_price || batch.mrp,
      });

      remainingQuantity -= allocateFromThisBatch;
    }

    if (remainingQuantity > 0) {
      throw new Error(`Insufficient stock. Required: ${required_quantity}, Available: ${required_quantity - remainingQuantity}`);
    }

    return allocations;
  } catch (error) {
    console.error('Error allocating stock for sale:', error);
    throw error;
  }
}

/**
 * Transfer stock between batches
 */
export async function transferStock(
  from_batch_id: string,
  to_batch_id: string,
  quantity: number,
  reason: string,
  hospital_name: string,
  performed_by?: string
) {
  try {
    // Deduct from source batch
    await adjustBatchStock({
      batch_id: from_batch_id,
      adjustment_type: 'OUT',
      quantity: quantity,
      reason: `Transfer out: ${reason}`,
      performed_by,
      reference_type: 'TRANSFER',
      reference_id: to_batch_id,
    }, hospital_name);

    // Add to destination batch
    await adjustBatchStock({
      batch_id: to_batch_id,
      adjustment_type: 'IN',
      quantity: quantity,
      reason: `Transfer in: ${reason}`,
      performed_by,
      reference_type: 'TRANSFER',
      reference_id: from_batch_id,
    }, hospital_name);

    return { success: true };
  } catch (error) {
    console.error('Error transferring stock:', error);
    throw error;
  }
}

// ==================== OPENING STOCK ====================

export interface OpeningStockData {
  medicine_id: string;
  batch_number: string;
  quantity: number;
  pieces_per_pack?: number;
  expiry_date: string;
  manufacturing_date?: string;
  purchase_price?: number;
  mrp?: number;
  selling_price?: number;
  supplier_id?: number;
  hospital_name: string;
  performed_by?: string;
}

/**
 * Add opening stock for existing medicines (bypasses PO/GRN flow)
 * Creates a new batch inventory record and audit trail
 */
export async function addOpeningStock(data: OpeningStockData) {
  try {
    // Create batch inventory record
    const { data: batchData, error: batchError } = await supabase
      .from('medicine_batch_inventory')
      .insert({
        medicine_id: data.medicine_id,
        batch_number: data.batch_number,
        expiry_date: data.expiry_date,
        manufacturing_date: data.manufacturing_date || null,
        received_quantity: data.quantity,
        current_stock: data.quantity,
        sold_quantity: 0,
        pieces_per_pack: data.pieces_per_pack || 0,
        purchase_price: data.purchase_price || 0,
        mrp: data.mrp || 0,
        selling_price: data.selling_price || 0,
        supplier_id: data.supplier_id || null,
        hospital_name: data.hospital_name,
        is_active: true,
        is_expired: false,
      })
      .select()
      .single();

    if (batchError) throw batchError;

    // Create stock movement audit record
    const { error: movementError } = await supabase
      .from('batch_stock_movements')
      .insert({
        batch_inventory_id: batchData.id,
        medicine_id: data.medicine_id,
        batch_number: data.batch_number,
        movement_type: 'IN',
        reference_type: 'OPENING_STOCK',
        quantity_before: 0,
        quantity_changed: data.quantity,
        quantity_after: data.quantity,
        reason: 'Opening Stock Entry',
        performed_by: data.performed_by || null,
        movement_date: new Date().toISOString(),
        hospital_name: data.hospital_name,
      });

    if (movementError) {
      console.error('Error creating stock movement record:', movementError);
      // Don't throw here - batch was created successfully
    }

    return { success: true, batch: batchData };
  } catch (error) {
    console.error('Error adding opening stock:', error);
    throw error;
  }
}
