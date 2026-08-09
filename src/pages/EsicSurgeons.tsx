import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, UserCheck, Edit, Trash2 } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { doctorLedgerFormField } from '@/components/DoctorLedgerField';
import { EditSurgeonDialog } from '@/components/EditSurgeonDialog';
import { useToast } from '@/hooks/use-toast';

interface EsicSurgeon {
  id: string;
  name: string;
  specialty?: string;
  department?: string;
  contact_info?: string;
  created_at: string;
  updated_at: string;
}

const EsicSurgeons = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedSurgeon, setSelectedSurgeon] = useState<EsicSurgeon | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: esicSurgeons = [], isLoading } = useQuery({
    queryKey: ['esic-surgeons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('esic_surgeons')
        .select('*')
        .order('name');
      
      if (error) {
        console.error('Error fetching ESIC surgeons:', error);
        throw error;
      }
      
      return data || [];
    }
  });

  const addMutation = useMutation({
    mutationFn: async (newSurgeon: Omit<EsicSurgeon, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('esic_surgeons')
        .insert([newSurgeon])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esic-surgeons'] });
      queryClient.invalidateQueries({ queryKey: ['esic-surgeons-count'] });
      toast({
        title: "Success",
        description: "ESIC surgeon added successfully",
      });
    },
    onError: (error) => {
      console.error('Add ESIC surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to add ESIC surgeon",
        variant: "destructive"
      });
    }
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<EsicSurgeon> }) => {
      const { data: updatedData, error } = await supabase
        .from('esic_surgeons')
        .update({
          name: data.name,
          specialty: data.specialty || null,
          department: data.department || null,
          contact_info: data.contact_info || null,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return updatedData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esic-surgeons'] });
      toast({
        title: "Success",
        description: "ESIC surgeon updated successfully",
      });
    },
    onError: (error) => {
      console.error('Edit ESIC surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to update ESIC surgeon",
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('esic_surgeons')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['esic-surgeons'] });
      queryClient.invalidateQueries({ queryKey: ['esic-surgeons-count'] });
      toast({
        title: "Success",
        description: "ESIC surgeon deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Delete ESIC surgeon error:', error);
      toast({
        title: "Error",
        description: "Failed to delete ESIC surgeon",
        variant: "destructive"
      });
    }
  });

  const filteredSurgeons = esicSurgeons.filter(surgeon =>
    surgeon.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    surgeon.specialty?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    surgeon.department?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleAdd = (formData: Record<string, string>) => {
    addMutation.mutate({
      name: formData.name,
      specialty: formData.specialty || undefined,
      department: formData.department || undefined,
      contact_info: formData.contact_info || undefined
    });
  };

  const handleEdit = (surgeon: EsicSurgeon) => {
    setSelectedSurgeon(surgeon);
    setIsEditDialogOpen(true);
  };

  const handleEditSubmit = (id: string, formData: Record<string, string>) => {
    editMutation.mutate({
      id,
      data: {
        name: formData.name,
        specialty: formData.specialty || undefined,
        department: formData.department || undefined,
        contact_info: formData.contact_info || undefined
      }
    });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this ESIC surgeon?')) {
      deleteMutation.mutate(id);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading ESIC surgeons...</div>
        </div>
      </div>
    );
  }

  const fields = [
    { key: 'name', label: 'Name', type: 'text' as const, required: true },
    { key: 'specialty', label: 'Specialty', type: 'text' as const },
    { key: 'department', label: 'Department', type: 'text' as const },
    { key: 'contact_info', label: 'Contact Info', type: 'text' as const }
  ];

  // The ledger is mapped against the surgeon's NAME, so it can only be picked
  // once that name exists. Editing an existing surgeon offers the real field.
  const addFields = [...fields, doctorLedgerFormField('')];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <UserCheck className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">
              ESIC Surgeons Master List
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Manage ESIC surgeons for follow up
          </p>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search ESIC surgeons..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add ESIC Surgeon
          </Button>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(surgeon)}
                      className="text-blue-600 hover:text-blue-700"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(surgeon.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
            <UserCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No ESIC surgeons found matching your search.' : 'No ESIC surgeons available.'}
            </p>
          </div>
        )}

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add ESIC Surgeon"
          fields={addFields}
        />

        <EditSurgeonDialog
          isOpen={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
          onEdit={handleEditSubmit}
          surgeon={selectedSurgeon}
        />
      </div>
    </div>
  );
};

export default EsicSurgeons;
