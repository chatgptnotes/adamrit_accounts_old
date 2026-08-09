
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, UserCog, Trash2, Edit, Download, Upload } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { toast as sonnerToast } from 'sonner';
import * as XLSX from 'xlsx';

interface HopeSurgeon {
  id: string;
  name: string;
  specialty?: string;
  department?: string;
  contact_info?: string;
  tpa_rate?: number;
  non_nabh_rate?: number;
  nabh_rate?: number;
  private_rate?: number;
  created_at: string;
  updated_at: string;
}

const HopeSurgeons = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSurgeon, setEditingSurgeon] = useState<HopeSurgeon | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canEditMasters } = usePermissions();

  const { data: hopeSurgeons = [], isLoading } = useQuery({
    queryKey: ['hope-surgeons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hope_surgeons')
        .select('*')
        .order('name');
      
      if (error) {
        console.error('Error fetching Hope surgeons:', error);
        throw error;
      }
      
      return data || [];
    }
  });

  const addMutation = useMutation({
    mutationFn: async (newSurgeon: Omit<HopeSurgeon, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('hope_surgeons')
        .insert([newSurgeon])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-surgeons'] });
      queryClient.invalidateQueries({ queryKey: ['hope-surgeons-count'] });
      toast({
        title: "Success",
        description: "Hope surgeon added successfully",
      });
    },
    onError: (error) => {
      console.error('Add Hope surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to add Hope surgeon",
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('hope_surgeons')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-surgeons'] });
      queryClient.invalidateQueries({ queryKey: ['hope-surgeons-count'] });
      toast({
        title: "Success",
        description: "Hope surgeon deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Delete Hope surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to delete Hope surgeon",
        variant: "destructive"
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<HopeSurgeon> }) => {
      const { data, error } = await supabase
        .from('hope_surgeons')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hope-surgeons'] });
      toast({
        title: "Success",
        description: "Hope surgeon updated successfully",
      });
      setIsEditDialogOpen(false);
      setEditingSurgeon(null);
    },
    onError: (error) => {
      console.error('Update Hope surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to update Hope surgeon",
        variant: "destructive"
      });
    }
  });

  const filteredSurgeons = hopeSurgeons.filter(surgeon =>
    surgeon.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    surgeon.specialty?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    surgeon.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = (formData: Record<string, string>) => {
    
    // Create the data object with basic fields
    const surgeonData: any = {
      name: formData.name,
      specialty: formData.specialty || undefined,
      department: formData.department || undefined,
      contact_info: formData.contact_info || undefined
    };
    
    // Only add rate fields if they have values
    if (formData.tpa_rate && formData.tpa_rate.trim() !== '') {
      surgeonData.tpa_rate = parseFloat(formData.tpa_rate);
    }
    if (formData.non_nabh_rate && formData.non_nabh_rate.trim() !== '') {
      surgeonData['non-nabh_rate'] = parseFloat(formData.non_nabh_rate);
    }
    if (formData.nabh_rate && formData.nabh_rate.trim() !== '') {
      surgeonData.nabh_rate = parseFloat(formData.nabh_rate);
    }
    if (formData.private_rate && formData.private_rate.trim() !== '') {
      surgeonData.private_rate = parseFloat(formData.private_rate);
    }
    
    addMutation.mutate(surgeonData);
  };

  const handleEdit = (surgeon: HopeSurgeon) => {
    setEditingSurgeon(surgeon);
    setIsEditDialogOpen(true);
  };

  const handleUpdate = (formData: Record<string, string>) => {
    if (editingSurgeon) {
      const updates: any = {
        name: formData.name,
        specialty: formData.specialty || undefined,
        department: formData.department || undefined,
        contact_info: formData.contact_info || undefined,
        tpa_rate: formData.tpa_rate && formData.tpa_rate.trim() !== '' ? parseFloat(formData.tpa_rate) : null,
        'non-nabh_rate': formData.non_nabh_rate && formData.non_nabh_rate.trim() !== '' ? parseFloat(formData.non_nabh_rate) : null,
        nabh_rate: formData.nabh_rate && formData.nabh_rate.trim() !== '' ? parseFloat(formData.nabh_rate) : null,
        private_rate: formData.private_rate && formData.private_rate.trim() !== '' ? parseFloat(formData.private_rate) : null
      };
      
      updateMutation.mutate({
        id: editingSurgeon.id,
        updates: updates
      });
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this Hope surgeon?')) {
      deleteMutation.mutate(id);
    }
  };

  // Export function - downloads all surgeons as Excel
  const handleExport = async () => {
    try {
      const { data, error } = await supabase
        .from('hope_surgeons')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        sonnerToast.error('Failed to export data');
        return;
      }

      const headers = ['name', 'specialty', 'department', 'contact_info', 'tpa_rate', 'non-nabh_rate', 'nabh_rate', 'private_rate'];
      const headerLabels = ['Name', 'Specialty', 'Department', 'Contact Info', 'TPA Rate', 'Non-NABH Rate', 'NABH Rate', 'Private Rate'];

      const excelData = data
        .filter(row => row.name && row.name.trim())
        .map((row, index) => {
          const obj: any = { 'Sr No': index + 1 };
          headers.forEach((h, i) => {
            obj[headerLabels[i]] = (row as any)[h] || '';
          });
          return obj;
        });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, 'Hope Surgeons');
      XLSX.writeFile(wb, `hope_surgeons_export_${new Date().toISOString().split('T')[0]}.xlsx`);

      sonnerToast.success(`Exported ${data.length} records`);
    } catch (err) {
      sonnerToast.error('Export failed');
    }
  };

  // Import function - uploads Excel file and adds records
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
          'non-nabh_rate': row['Non-NABH Rate'] || row['non_nabh_rate'] || null,
          nabh_rate: row['NABH Rate'] || row['nabh_rate'] || null,
          private_rate: row['Private Rate'] || row['private_rate'] || null,
        })).filter((r: any) => r.name && r.name.trim());

        if (records.length === 0) {
          sonnerToast.error('No valid records found in file');
          return;
        }

        const { error } = await supabase.from('hope_surgeons').insert(records);

        if (error) {
          sonnerToast.error('Failed to import: ' + error.message);
        } else {
          sonnerToast.success(`Imported ${records.length} records`);
          queryClient.invalidateQueries({ queryKey: ['hope-surgeons'] });
        }
      } catch (err) {
        sonnerToast.error('Import failed - invalid file format');
      }
    };

    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading Hope surgeons...</div>
        </div>
      </div>
    );
  }

  const fields = [
    { key: 'name', label: 'Name', type: 'text' as const, required: true },
    { key: 'specialty', label: 'Specialty', type: 'text' as const },
    { key: 'department', label: 'Department', type: 'text' as const },
    { key: 'contact_info', label: 'Contact Info', type: 'text' as const },
    { key: 'tpa_rate', label: 'TPA Rate', type: 'number' as const },
    { key: 'non_nabh_rate', label: 'Non-NABH Rate', type: 'number' as const },
    { key: 'nabh_rate', label: 'NABH Rate', type: 'number' as const },
    { key: 'private_rate', label: 'Private Rate', type: 'number' as const }
  ];

  // The ledger is mapped against the surgeon's NAME, so it can only be picked
  // once that name exists — on Add the field says so instead.
  const addFields = [...fields, doctorLedgerFormField('')];
  const editFields = [...fields, doctorLedgerFormField(editingSurgeon?.name || '')];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <UserCog className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">
              Hope Surgeons Master List
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Manage Hope hospital surgeons
          </p>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search Hope surgeons..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <label className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  Import
                </span>
              </Button>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} className="hidden" />
            </label>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Hope Surgeon
            </Button>
          </div>
        </div>

        <div className="grid gap-4">
          {filteredSurgeons.map((surgeon) => (
            <Card key={surgeon.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="text-xl">{surgeon.name}</span>
                  <div className="flex gap-2">
                    {surgeon.specialty && (
                      <Badge variant="outline">{surgeon.specialty}</Badge>
                    )}
                    {surgeon.department && (
                      <Badge variant="secondary">{surgeon.department}</Badge>
                    )}
                    {canEditMasters && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(surgeon)}
                        className="text-blue-600 hover:text-blue-700"
                        title="Edit surgeon"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}
                    {canEditMasters && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(surgeon.id)}
                        className="text-red-600 hover:text-red-700"
                        title="Delete surgeon"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              {surgeon.contact_info && (
                <CardContent>
                  <div className="text-sm">
                    <span className="font-semibold">Contact:</span> {surgeon.contact_info}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {filteredSurgeons.length === 0 && (
          <div className="text-center py-12">
            <UserCog className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No Hope surgeons found matching your search.' : 'No Hope surgeons available.'}
            </p>
          </div>
        )}

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add Hope Surgeon"
          fields={addFields}
        />

        <AddItemDialog
          isOpen={isEditDialogOpen}
          onClose={() => {
            setIsEditDialogOpen(false);
            setEditingSurgeon(null);
          }}
          onAdd={handleUpdate}
          title="Edit Hope Surgeon"
          fields={editFields}
          initialData={{
            name: editingSurgeon?.name || '',
            specialty: editingSurgeon?.specialty || '',
            department: editingSurgeon?.department || '',
            contact_info: editingSurgeon?.contact_info || '',
            tpa_rate: editingSurgeon?.tpa_rate?.toString() || '',
            non_nabh_rate: editingSurgeon?.non_nabh_rate?.toString() || '',
            nabh_rate: editingSurgeon?.nabh_rate?.toString() || '',
            private_rate: editingSurgeon?.private_rate?.toString() || ''
          }}
        />
      </div>
    </div>
  );
};

export default HopeSurgeons;
