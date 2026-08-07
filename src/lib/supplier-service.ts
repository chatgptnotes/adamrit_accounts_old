import { supabaseClient } from '@/utils/supabase-client';

export interface Supplier {
  id: number;
  supplier_name: string;
  supplier_code: string;
  supplier_type?: string;
  phone?: string;
  credit_limit?: number;
  email?: string;
  pin?: string;
  dl_no?: string;
  account_group?: string;
  cst?: string;
  s_tax_no?: string;
  address?: string;
  credit_day?: number;
  bank_or_branch?: string;
  mobile?: string;
  /** Creditor ledger this supplier posts to — GRNs credit it, payments debit it. */
  ledger_account_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export class SupplierService {
  // Get all suppliers
  static async getAll(): Promise<Supplier[]> {
    const { data, error } = await supabaseClient
      .from('suppliers')
      .select('*')
      .order('supplier_name', { ascending: true });

    if (error) {
      console.error('Error fetching suppliers:', error);
      throw error;
    }

    return data || [];
  }

  // Add a new supplier
  static async create(supplier: Omit<Supplier, 'id' | 'created_at' | 'updated_at'>): Promise<Supplier> {
    const { data, error } = await supabaseClient
      .from('suppliers')
      .insert([supplier])
      .select()
      .single();

    if (error) {
      console.error('Error creating supplier:', error);
      throw error;
    }

    return data;
  }

  // Update a supplier
  static async update(id: number, supplier: Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at'>>): Promise<Supplier> {
    const { data, error } = await supabaseClient
      .from('suppliers')
      .update({ ...supplier, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating supplier:', error);
      throw error;
    }

    return data;
  }

  // Delete a supplier
  static async delete(id: number): Promise<void> {
    const { error } = await supabaseClient
      .from('suppliers')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting supplier:', error);
      throw error;
    }
  }

  // Search suppliers by name or code
  static async search(searchTerm: string): Promise<Supplier[]> {
    const { data, error } = await supabaseClient
      .from('suppliers')
      .select('*')
      .or(`supplier_name.ilike.%${searchTerm}%,supplier_code.ilike.%${searchTerm}%`)
      .order('supplier_name', { ascending: true });

    if (error) {
      console.error('Error searching suppliers:', error);
      throw error;
    }

    return data || [];
  }

  // Get supplier by ID
  static async getById(id: number): Promise<Supplier | null> {
    const { data, error } = await supabaseClient
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching supplier:', error);
      throw error;
    }

    return data;
  }
}
