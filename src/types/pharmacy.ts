// Enterprise Pharmacy System Types
// Comprehensive TypeScript definitions for pharmacy management

export interface MedicineCategory {
  id: string;
  category_name: string;
  category_code: string;
  description?: string;
  parent_category_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Relations
  parent_category?: MedicineCategory;
  subcategories?: MedicineCategory[];
}

export interface MedicineManufacturer {
  id: string;
  manufacturer_name: string;
  manufacturer_code?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  license_number?: string;
  gst_number?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Medicine {
  id: string;
  medicine_name: string;
  generic_name?: string;
  brand_name?: string;
  medicine_code: string;
  barcode?: string;
  category_id?: string;
  manufacturer_id?: string;
  
  // Medicine Details
  strength?: string;
  dosage_form?: string;
  pack_size?: number;
  unit_of_measurement?: string;
  
  // Regulatory
  schedule_type?: string;
  prescription_required: boolean;
  controlled_substance: boolean;
  
  // Pricing
  mrp: number;
  purchase_rate?: number;
  selling_rate?: number;
  discount_percentage: number;
  gst_percentage: number;
  
  // Stock Management
  minimum_stock_level: number;
  reorder_level: number;
  maximum_stock_level: number;
  
  // Additional Info
  side_effects?: string;
  contraindications?: string;
  drug_interactions?: string;
  storage_conditions?: string;
  
  is_active: boolean;
  created_at: string;
  updated_at: string;
  
  // Relations
  category?: MedicineCategory;
  manufacturer?: MedicineManufacturer;
  inventory?: MedicineInventory[];
  current_stock?: number;
  total_stock?: number;
}

export interface MedicineInventory {
  id: string;
  medicine_id: string;
  batch_number: string;
  manufacturing_date?: string;
  expiry_date: string;
  
  // Stock Quantities
  received_quantity: number;
  current_stock: number;
  reserved_stock: number;
  damaged_stock: number;
  
  // Purchase Info
  supplier_id?: string;
  purchase_order_id?: string;
  purchase_rate?: number;
  purchase_date?: string;
  
  // Location
  rack_number?: string;
  shelf_location?: string;
  
  is_active: boolean;
  created_at: string;
  updated_at: string;
  
  // Relations
  medicine?: Medicine;
  supplier?: MedicineManufacturer;
  
  // Computed
  days_to_expiry?: number;
  is_expired?: boolean;
  is_near_expiry?: boolean;
}

export interface Prescription {
  id: string;
  prescription_number: string;
  patient_id?: string;
  doctor_id?: string;
  doctor_name?: string;
  
  // Details
  prescription_date: string;
  diagnosis?: string;
  symptoms?: string;
  vital_signs?: Record<string, any>;
  
  // Status
  status: 'PENDING' | 'PARTIALLY_DISPENSED' | 'DISPENSED' | 'CANCELLED';
  priority: 'NORMAL' | 'URGENT' | 'EMERGENCY';
  
  // Financial
  total_amount: number;
  discount_amount: number;
  tax_amount: number;
  final_amount: number;
  
  // Dispensing
  dispensed_at?: string;
  dispensed_by?: string;
  
  notes?: string;
  created_at: string;
  updated_at: string;
  
  // Relations
  patient?: any; // Reference to patient type
  prescription_items?: PrescriptionItem[];
  medicine_sale?: MedicineSale;
}

export interface PrescriptionItem {
  id: string;
  prescription_id: string;
  medicine_id?: string;
  
  // Prescription Details
  quantity_prescribed: number;
  quantity_dispensed: number;
  
  // Dosage Instructions
  dosage_frequency?: string;
  dosage_timing?: string;
  duration_days?: number;
  special_instructions?: string;
  
  // Pricing
  unit_price?: number;
  total_price?: number;
  discount_percentage: number;
  
  // Dispensing
  batch_numbers?: string[];
  dispensed_at?: string;
  
  // Substitution
  is_substituted: boolean;
  substitute_medicine_id?: string;
  substitute_reason?: string;
  
  created_at: string;
  updated_at: string;
  
  // Relations
  prescription?: Prescription;
  medicine?: Medicine;
  substitute_medicine?: Medicine;
}

export interface MedicineSale {
  id: string;
  bill_number: string;
  patient_id?: string;
  prescription_id?: string;
  
  // Sale Details
  sale_date: string;
  sale_type: 'PRESCRIPTION' | 'OTC' | 'EMERGENCY';
  
  // Financial
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  
  // Payment
  payment_method: 'CASH' | 'CARD' | 'UPI' | 'INSURANCE' | 'CREDIT';
  payment_reference?: string;
  insurance_claim_number?: string;
  
  // Staff
  cashier_id?: string;
  pharmacist_id?: string;
  
  // Status
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  
  notes?: string;
  created_at: string;
  updated_at: string;
  
  // Relations
  patient?: any;
  prescription?: Prescription;
  sale_items?: MedicineSaleItem[];
  cashier?: any;
  pharmacist?: any;
}

export interface MedicineSaleItem {
  id: string;
  sale_id: string;
  medicine_id?: string;
  inventory_id?: string;
  
  // Sale Details
  quantity_sold: number;
  unit_price: number;
  discount_percentage: number;
  discount_amount: number;
  tax_percentage: number;
  tax_amount: number;
  total_amount: number;
  
  // Batch Info
  batch_number?: string;
  expiry_date?: string;
  
  created_at: string;
  
  // Relations
  sale?: MedicineSale;
  medicine?: Medicine;
  inventory?: MedicineInventory;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id?: string;
  
  // Order Details
  order_date: string;
  expected_delivery_date?: string;
  actual_delivery_date?: string;
  
  // Financial
  subtotal: number;
  discount?: number;
  tax_amount: number;
  total_amount: number;
  
  // Status
  status: 'Pending' | 'Completed' | 'Cancelled';
  
  // Approval
  approved_by?: string;
  approved_at?: string;
  
  notes?: string;
  created_at: string;
  updated_at: string;
  
  // Relations
  supplier?: MedicineManufacturer;
  purchase_order_items?: PurchaseOrderItem[];
  approver?: any;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  medicine_id?: string;
  
  // Order Details
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number;
  total_price: number;
  
  // Batch Info (when received)
  batch_number?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  
  created_at: string;
  updated_at: string;
  
  // Relations
  purchase_order?: PurchaseOrder;
  medicine?: Medicine;
}

export interface StockMovement {
  id: string;
  medicine_id?: string;
  inventory_id?: string;
  
  // Movement Details
  movement_type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | 'DAMAGE' | 'EXPIRY';
  reference_type?: string;
  reference_id?: string;
  
  // Quantities
  quantity_before: number;
  quantity_changed: number;
  quantity_after: number;
  
  // Details
  reason?: string;
  performed_by?: string;
  movement_date: string;
  
  created_at: string;
  
  // Relations
  medicine?: Medicine;
  inventory?: MedicineInventory;
  performer?: any;
}

export interface MedicineReturn {
  id: string;
  return_number: string;
  original_sale_id?: string;
  patient_id?: string;
  
  // Return Details
  return_date: string;
  return_reason: string;
  return_type: 'PATIENT' | 'DAMAGED' | 'EXPIRED' | 'RECALLED';
  
  // Financial
  refund_amount: number;
  processing_fee: number;
  net_refund: number;
  
  // Status
  status: 'PENDING' | 'APPROVED' | 'PROCESSED' | 'REJECTED';
  
  // Approval
  approved_by?: string;
  approved_at?: string;
  processed_by?: string;
  processed_at?: string;
  
  notes?: string;
  created_at: string;
  updated_at: string;
  
  // Relations
  original_sale?: MedicineSale;
  patient?: any;
  return_items?: MedicineReturnItem[];
}

export interface MedicineReturnItem {
  id: string;
  return_id: string;
  medicine_id?: string;
  original_sale_item_id?: string;
  
  // Return Details
  quantity_returned: number;
  unit_price: number;
  refund_amount: number;
  
  // Batch Info
  batch_number?: string;
  expiry_date?: string;
  
  // Quality Check
  medicine_condition: 'GOOD' | 'DAMAGED' | 'EXPIRED' | 'OPENED';
  can_restock: boolean;
  
  created_at: string;
  
  // Relations
  return?: MedicineReturn;
  medicine?: Medicine;
  original_sale_item?: MedicineSaleItem;
}

// Form Types for Creating/Updating
export interface MedicineForm {
  medicine_name: string;
  generic_name?: string;
  brand_name?: string;
  medicine_code: string;
  barcode?: string;
  category_id?: string;
  manufacturer_id?: string;
  strength?: string;
  dosage_form?: string;
  pack_size?: number;
  unit_of_measurement?: string;
  schedule_type?: string;
  prescription_required: boolean;
  controlled_substance: boolean;
  mrp: number;
  purchase_rate?: number;
  selling_rate?: number;
  discount_percentage: number;
  gst_percentage: number;
  minimum_stock_level: number;
  reorder_level: number;
  maximum_stock_level: number;
  side_effects?: string;
  contraindications?: string;
  drug_interactions?: string;
  storage_conditions?: string;
}

export interface PrescriptionForm {
  patient_id?: string;
  doctor_id?: string;
  doctor_name?: string;
  prescription_date: string;
  diagnosis?: string;
  symptoms?: string;
  vital_signs?: Record<string, any>;
  priority: 'NORMAL' | 'URGENT' | 'EMERGENCY';
  notes?: string;
  prescription_items: PrescriptionItemForm[];
}

export interface PrescriptionItemForm {
  medicine_id?: string;
  quantity_prescribed: number;
  dosage_frequency?: string;
  dosage_timing?: string;
  duration_days?: number;
  special_instructions?: string;
}

export interface SaleForm {
  patient_id?: string;
  prescription_id?: string;
  sale_type: 'PRESCRIPTION' | 'OTC' | 'EMERGENCY';
  payment_method: 'CASH' | 'CARD' | 'UPI' | 'INSURANCE' | 'CREDIT';
  payment_reference?: string;
  insurance_claim_number?: string;
  notes?: string;
  sale_items: SaleItemForm[];
}

export interface SaleItemForm {
  medicine_id: string;
  inventory_id: string;
  quantity_sold: number;
  unit_price: number;
  discount_percentage: number;
}

// Dashboard and Analytics Types
export interface PharmacyDashboardData {
  // Sales Metrics
  todaySales: number;
  monthSales: number;
  yearSales: number;
  
  // Inventory Metrics
  totalMedicines: number;
  lowStockItems: number;
  expiredItems: number;
  nearExpiryItems: number;
  
  // Prescription Metrics
  pendingPrescriptions: number;
  processedPrescriptions: number;
  totalPrescriptions: number;
  
  // Financial Metrics
  todayRevenue: number;
  monthRevenue: number;
  outstandingPayments: number;
  
  // Recent Activities
  recentSales: MedicineSale[];
  recentPrescriptions: Prescription[];
  lowStockAlerts: Medicine[];
  expiryAlerts: MedicineInventory[];
}

export interface StockAlert {
  id: string;
  medicine: Medicine;
  alert_type: 'LOW_STOCK' | 'OUT_OF_STOCK' | 'EXPIRED' | 'NEAR_EXPIRY';
  current_stock: number;
  threshold: number;
  days_to_expiry?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
}

// Filter and Search Types
export interface MedicineFilters {
  category_id?: string;
  manufacturer_id?: string;
  prescription_required?: boolean;
  in_stock?: boolean;
  near_expiry?: boolean;
  search?: string;
  sort_by?: 'name' | 'stock' | 'expiry' | 'sales';
  sort_order?: 'asc' | 'desc';
}

export interface PrescriptionFilters {
  patient_id?: string;
  doctor_id?: string;
  status?: string;
  priority?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
}

export interface SalesFilters {
  patient_id?: string;
  cashier_id?: string;
  payment_method?: string;
  sale_type?: string;
  from_date?: string;
  to_date?: string;
  search?: string;
}

// Report Types
export interface SalesReport {
  period: string;
  total_sales: number;
  total_revenue: number;
  total_items_sold: number;
  average_bill_value: number;
  top_selling_medicines: Array<{
    medicine: Medicine;
    quantity_sold: number;
    revenue: number;
  }>;
  sales_by_category: Array<{
    category: MedicineCategory;
    quantity_sold: number;
    revenue: number;
  }>;
  daily_sales: Array<{
    date: string;
    sales: number;
    revenue: number;
  }>;
}

export interface InventoryReport {
  total_medicines: number;
  total_stock_value: number;
  low_stock_items: number;
  expired_items: number;
  near_expiry_items: number;
  category_wise_stock: Array<{
    category: MedicineCategory;
    total_medicines: number;
    total_stock: number;
    total_value: number;
  }>;
  expiry_analysis: Array<{
    month: string;
    expiring_items: number;
    expiring_value: number;
  }>;
}

// Barcode and Scanning Types
export interface BarcodeResult {
  barcode: string;
  medicine?: Medicine;
  found: boolean;
  error?: string;
}

export interface ScanResult {
  success: boolean;
  data: BarcodeResult;
  timestamp: string;
}

// =====================================================
// BATCH INVENTORY SYSTEM TYPES
// =====================================================

export interface MedicineBatchInventory {
  id: string;

  // Medicine Reference
  medicine_id: string;

  // Batch Details
  batch_number: string;
  expiry_date: string;
  manufacturing_date?: string;
  pieces_per_pack?: number;

  // Stock Quantities
  received_quantity: number;
  current_stock: number;
  sold_quantity: number;
  reserved_stock: number;
  free_quantity: number;

  // Pricing (can vary per batch)
  purchase_price?: number;
  selling_price?: number;
  mrp?: number;

  // GST Details
  gst?: number;
  sgst?: number;
  cgst?: number;
  gst_amount?: number;

  // Purchase Reference
  purchase_order_id?: string;
  supplier_id?: number;
  grn_number?: string;
  grn_date?: string;

  // Storage Location
  rack_number?: string;
  shelf_location?: string;

  // Multi-tenancy
  hospital_name?: string;

  // Status
  is_active: boolean;
  is_expired?: boolean;

  // Audit
  created_at: string;
  updated_at: string;
  created_by?: string;

  // Relations
  medicine?: Medicine;
  purchase_order?: PurchaseOrder;
  supplier?: MedicineManufacturer;
}

export interface GoodsReceivedNote {
  id: string;

  // GRN Details
  grn_number: string;
  grn_date: string;

  // Purchase Reference
  purchase_order_id: string;
  po_number?: string;
  supplier_id?: number;

  // Invoice Details
  invoice_number?: string;
  /** CREDIT leaves the supplier owed; CASH settles them from Cash in Hand. */
  payment_terms?: 'CREDIT' | 'CASH';
  invoice_date?: string;
  invoice_amount?: number;

  // Summary
  total_items: number;
  total_quantity_ordered: number;
  total_quantity_received: number;
  total_amount: number;
  discount?: number;

  // Status
  status: 'DRAFT' | 'VERIFIED' | 'POSTED' | 'CANCELLED';

  // Verification
  verified_by?: string;
  verified_at?: string;

  // Notes
  notes?: string;
  remarks?: string;

  // Multi-tenancy
  hospital_name?: string;

  // Audit
  created_at: string;
  updated_at: string;
  created_by?: string;

  // Relations
  purchase_order?: PurchaseOrder;
  supplier?: MedicineManufacturer;
  grn_items?: GRNItem[];
}

export interface GRNItem {
  id: string;

  // GRN Reference
  grn_id: string;

  // Purchase Order Reference
  purchase_order_item_id?: string;

  // Medicine Reference
  medicine_id: string;
  product_name: string;
  manufacturer?: string;
  pack?: string;

  // Batch Details
  batch_number: string;
  expiry_date: string;
  manufacturing_date?: string;

  // Quantities
  ordered_quantity: number;
  received_quantity: number;
  accepted_quantity?: number;
  rejected_quantity: number;
  free_quantity: number;

  // Pricing
  purchase_price: number;
  sale_price?: number;
  mrp?: number;

  // Tax Details
  gst?: number;
  sgst?: number;
  cgst?: number;
  tax_amount?: number;

  // Amount
  amount?: number;

  // Storage Location
  rack_number?: string;
  shelf_location?: string;

  // Audit
  created_at: string;

  // Relations
  grn?: GoodsReceivedNote;
  purchase_order_item?: PurchaseOrderItem;
  medicine?: Medicine;
}

export interface BatchStockMovement {
  id: string;

  // Batch Reference
  batch_inventory_id: string;
  medicine_id: string;
  batch_number: string;

  // Movement Details
  movement_type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | 'DAMAGE' | 'EXPIRY' | 'RETURN';

  // Reference
  reference_type?: string; // 'SALE', 'PURCHASE', 'GRN', 'ADJUSTMENT', 'OPENING_STOCK'
  reference_id?: string;
  reference_number?: string;

  // Quantities
  quantity_before: number;
  quantity_changed: number;
  quantity_after: number;

  // Details
  reason?: string;
  remarks?: string;

  // Audit
  movement_date: string;
  performed_by?: string;
  hospital_name?: string;

  // Relations
  batch_inventory?: MedicineBatchInventory;
  medicine?: Medicine;
}

// View Types
export interface MedicineCombinedStock {
  medicine_id: string;
  hospital_name?: string;
  total_stock: number;
  total_received: number;
  total_sold: number;
  batch_count: number;
  nearest_expiry?: string;
  near_expiry_batches: number;

  // Relations
  medicine?: Medicine;
}

export interface BatchStockDetail extends MedicineBatchInventory {
  expiry_status: 'EXPIRED' | 'EXPIRING_SOON' | 'NEAR_EXPIRY' | 'GOOD';
  days_to_expiry: number;
}

// Helper Types
export interface AvailableBatch {
  batch_id: string;
  batch_number: string;
  expiry_date: string;
  available_stock: number;
  mrp: number;
  selling_price: number;
  days_to_expiry: number;
}

// GRN Creation Payload
export interface CreateGRNPayload {
  purchase_order_id: string;
  grn_date: string;
  grn_number?: string;  // Reuse existing GRN number when updating draft
  invoice_number?: string;
  invoice_date?: string;
  invoice_amount?: number;
  discount?: number;
  total_tax?: number;
  notes?: string;
  hospital_name?: string;
  items: CreateGRNItemPayload[];
}

export interface CreateGRNItemPayload {
  purchase_order_item_id?: string;
  medicine_id: string;
  product_name: string;
  manufacturer?: string;
  pack?: string;
  pieces_per_pack?: number;
  batch_number: string;
  expiry_date: string;
  manufacturing_date?: string;
  ordered_quantity: number;
  received_quantity: number;
  rejected_quantity?: number;
  free_quantity?: number;
  purchase_price: number;
  sale_price?: number;
  mrp?: number;
  gst?: number;
  sgst?: number;
  cgst?: number;
  rack_number?: string;
  shelf_location?: string;
}