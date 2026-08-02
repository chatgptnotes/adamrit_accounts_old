
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import * as XLSX from 'xlsx';
import { HopeRMO } from './types';

export const useHopeRMOs = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingRMO, setEditingRMO] = useState<HopeRMO | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: hopeRMOs = [], isLoading } = useQuery({
    queryKey: ['hope-rmos'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('hope_rmos')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as HopeRMO[];
    }
  });

  const addMutation = useMutation({
    mutationFn: async (newRMO: Omit<HopeRMO, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await (supabase as any)
        .from('hope_rmos')
        .insert([newRMO])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-rmos'] });
      toast({ title: "Success", description: "Hope RMO added successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: "Failed to add Hope RMO", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<HopeRMO> }) => {
      const { data, error } = await (supabase as any)
        .from('hope_rmos')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-rmos'] });
      toast({ title: "Success", description: "Hope RMO updated successfully" });
      setIsEditDialogOpen(false);
      setEditingRMO(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: "Failed to update Hope RMO", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('hope_rmos')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-rmos'] });
      toast({ title: "Success", description: "Hope RMO deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: "Failed to delete Hope RMO", variant: "destructive" });
    }
  });

  const filteredRMOs = hopeRMOs.filter((rmo: HopeRMO) =>
    rmo.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rmo.specialty?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    rmo.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = (formData: Record<string, string>) => {
    addMutation.mutate({
      name: formData.name,
      specialty: formData.specialty || undefined,
      department: formData.department || undefined,
      contact_info: formData.contact_info || undefined,
      tpa_rate: formData.tpa_rate ? parseFloat(formData.tpa_rate) : undefined,
      non_nabh_rate: formData.non_nabh_rate ? parseFloat(formData.non_nabh_rate) : undefined,
      nabh_rate: formData.nabh_rate ? parseFloat(formData.nabh_rate) : undefined,
      private_rate: formData.private_rate ? parseFloat(formData.private_rate) : undefined,
      daily_remuneration: formData.daily_remuneration ? parseFloat(formData.daily_remuneration) : 0,
      ledger_account_id: formData.ledger_account_id || null,
      morning_rate: formData.morning_rate ? parseFloat(formData.morning_rate) : null,
      evening_rate: formData.evening_rate ? parseFloat(formData.evening_rate) : null,
      night_rate: formData.night_rate ? parseFloat(formData.night_rate) : null,
    } as any);
  };

  const handleEdit = (rmo: HopeRMO) => {
    setEditingRMO(rmo);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = (formData: Record<string, string>) => {
    if (editingRMO) {
      updateMutation.mutate({
        id: editingRMO.id,
        updates: {
          name: formData.name,
          specialty: formData.specialty || undefined,
          department: formData.department || undefined,
          contact_info: formData.contact_info || undefined,
          tpa_rate: formData.tpa_rate ? parseFloat(formData.tpa_rate) : undefined,
          non_nabh_rate: formData.non_nabh_rate ? parseFloat(formData.non_nabh_rate) : undefined,
          nabh_rate: formData.nabh_rate ? parseFloat(formData.nabh_rate) : undefined,
          private_rate: formData.private_rate ? parseFloat(formData.private_rate) : undefined,
          daily_remuneration: formData.daily_remuneration ? parseFloat(formData.daily_remuneration) : 0,
          ledger_account_id: formData.ledger_account_id || null,
          morning_rate: formData.morning_rate ? parseFloat(formData.morning_rate) : null,
          evening_rate: formData.evening_rate ? parseFloat(formData.evening_rate) : null,
          night_rate: formData.night_rate ? parseFloat(formData.night_rate) : null,
        } as any
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this Hope RMO?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleExport = async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('hope_rmos')
        .select('*')
        .order('name', { ascending: true });
      if (error) { sonnerToast.error('Failed to export data'); return; }

      const headers = ['name', 'specialty', 'department', 'contact_info', 'tpa_rate', 'non_nabh_rate', 'nabh_rate', 'private_rate'];
      const headerLabels = ['Name', 'Specialty', 'Department', 'Contact Info', 'TPA Rate', 'Non-NABH Rate', 'NABH Rate', 'Private Rate'];

      const excelData = data
        .filter((row: any) => row.name && row.name.trim())
        .map((row: any, index: number) => {
          const obj: any = { 'Sr No': index + 1 };
          headers.forEach((h, i) => { obj[headerLabels[i]] = row[h] || ''; });
          return obj;
        });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, 'Hope RMOs');
      XLSX.writeFile(wb, `hope_rmos_export_${new Date().toISOString().split('T')[0]}.xlsx`);
      sonnerToast.success(`Exported ${data.length} records`);
    } catch (err) { sonnerToast.error('Export failed'); }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        const records = jsonData.map((row: any) => ({
          name: row['Name'] || row['name'] || null,
          specialty: row['Specialty'] || row['specialty'] || null,
          department: row['Department'] || row['department'] || null,
          contact_info: row['Contact Info'] || row['contact_info'] || null,
          tpa_rate: row['TPA Rate'] || row['tpa_rate'] || null,
          non_nabh_rate: row['Non-NABH Rate'] || row['non_nabh_rate'] || null,
          nabh_rate: row['NABH Rate'] || row['nabh_rate'] || null,
          private_rate: row['Private Rate'] || row['private_rate'] || null,
        })).filter((r: any) => r.name && r.name.trim());
        if (records.length === 0) { sonnerToast.error('No valid records found in file'); return; }
        const { error } = await (supabase as any).from('hope_rmos').insert(records);
        if (error) { sonnerToast.error('Failed to import: ' + error.message); }
        else { sonnerToast.success(`Imported ${records.length} records`); queryClient.invalidateQueries({ queryKey: ['hope-rmos'] }); }
      } catch (err) { sonnerToast.error('Import failed - invalid file format'); }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  return {
    searchTerm, setSearchTerm, isAddDialogOpen, setIsAddDialogOpen,
    isEditDialogOpen, setIsEditDialogOpen, editingRMO, setEditingRMO,
    hopeRMOs, isLoading, filteredRMOs,
    handleAdd, handleEdit, handleUpdate, handleDelete, handleExport, handleImport
  };
};
