
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Syringe, Trash2, Edit } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';

interface Implant {
  id: string;
  name: string;
  category?: string;
  subcategory?: string;
  manufacturer?: string;
  model_number?: string;
  description?: string;
  hsn_code?: string;
  gst_percentage?: number;
  nabh_nabl_rate?: number;
  non_nabh_nabl_rate?: number;
  private_rate?: number;
  bhopal_nabh_rate?: number;
  bhopal_non_nabh_rate?: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = [
  'ALL',
  'Orthopedic',
  'Cardiac',
  'Spinal',
  'Neurosurgery',
  'Ophthalmic',
  'Dental',
  'ENT',
  'Urology',
  'Vascular',
  'General',
];

const CATEGORY_OPTIONS = CATEGORIES.filter(c => c !== 'ALL');

const CATEGORY_COLORS: Record<string, string> = {
  Orthopedic: 'bg-blue-100 text-blue-800',
  Cardiac: 'bg-red-100 text-red-800',
  Spinal: 'bg-purple-100 text-purple-800',
  Neurosurgery: 'bg-indigo-100 text-indigo-800',
  Ophthalmic: 'bg-cyan-100 text-cyan-800',
  Dental: 'bg-green-100 text-green-800',
  ENT: 'bg-teal-100 text-teal-800',
  Urology: 'bg-yellow-100 text-yellow-800',
  Vascular: 'bg-orange-100 text-orange-800',
  General: 'bg-gray-100 text-gray-700',
};

function getCategoryBadgeClass(category?: string): string {
  return CATEGORY_COLORS[category || 'General'] || CATEGORY_COLORS['General'];
}

const ImplantMaster = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('ALL');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedImplant, setSelectedImplant] = useState<Implant | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canEditMasters } = usePermissions();

  const { data: implants = [], isLoading } = useQuery({
    queryKey: ['implants'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('implants')
        .select('*')
        .order('name');

      if (error) {
        console.error('Error fetching implants:', error);
        throw error;
      }

      return data || [];
    }
  });

  const addMutation = useMutation({
    mutationFn: async (newImplant: Record<string, unknown>) => {
      const { data, error } = await (supabase as any)
        .from('implants')
        .insert([newImplant])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implants'] });
      toast({ title: "Success", description: "Implant added successfully" });
    },
    onError: (error) => {
      console.error('Add implant error:', error);
      toast({ title: "Error", description: `Failed to add implant: ${error?.message || error}`, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('implants')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implants'] });
      toast({ title: "Success", description: "Implant deleted successfully" });
    },
    onError: (error) => {
      console.error('Delete implant error:', error);
      toast({ title: "Error", description: `Failed to delete implant: ${error?.message || error}`, variant: "destructive" });
    }
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const { error } = await (supabase as any)
        .from('implants')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['implants'] });
      toast({ title: "Success", description: "Implant updated successfully" });
    },
    onError: (error) => {
      console.error('Edit implant error:', error);
      toast({ title: "Error", description: `Failed to update implant: ${error?.message || error}`, variant: "destructive" });
    }
  });

  // Count implants per category
  const categoryCounts = implants.reduce((acc: Record<string, number>, implant: Implant) => {
    const cat = implant.category || 'General';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredImplants = implants.filter((implant: Implant) => {
    const matchesSearch = implant.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      implant.manufacturer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      implant.model_number?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'ALL' || (implant.category || 'General') === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Group filtered implants by category for list view
  const groupedImplants: Record<string, Implant[]> = filteredImplants.reduce(
    (acc: Record<string, Implant[]>, implant: Implant) => {
      const cat = implant.category || 'General';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(implant);
      return acc;
    },
    {}
  );

  const handleAdd = (formData: Record<string, string>) => {
    addMutation.mutate({
      name: formData.name,
      category: formData.category || 'General',
      subcategory: formData.subcategory || undefined,
      manufacturer: formData.manufacturer || undefined,
      model_number: formData.model_number || undefined,
      description: formData.description || undefined,
      hsn_code: formData.hsn_code || undefined,
      gst_percentage: formData.gst_percentage ? parseFloat(formData.gst_percentage) : 5,
      nabh_nabl_rate: formData.nabh_nabl_rate ? parseFloat(formData.nabh_nabl_rate) : undefined,
      non_nabh_nabl_rate: formData.non_nabh_nabl_rate ? parseFloat(formData.non_nabh_nabl_rate) : undefined,
      private_rate: formData.private_rate ? parseFloat(formData.private_rate) : undefined,
      bhopal_nabh_rate: formData.bhopal_nabh_rate ? parseFloat(formData.bhopal_nabh_rate) : undefined,
      bhopal_non_nabh_rate: formData.bhopal_non_nabh_rate ? parseFloat(formData.bhopal_non_nabh_rate) : undefined,
    });
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this implant?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleEdit = (formData: Record<string, string>) => {
    if (selectedImplant) {
      editMutation.mutate({
        id: selectedImplant.id,
        data: {
          name: formData.name,
          category: formData.category || 'General',
          subcategory: formData.subcategory || undefined,
          manufacturer: formData.manufacturer || undefined,
          model_number: formData.model_number || undefined,
          description: formData.description || undefined,
          hsn_code: formData.hsn_code || undefined,
          gst_percentage: formData.gst_percentage ? parseFloat(formData.gst_percentage) : 5,
          nabh_nabl_rate: formData.nabh_nabl_rate ? parseFloat(formData.nabh_nabl_rate) : undefined,
          non_nabh_nabl_rate: formData.non_nabh_nabl_rate ? parseFloat(formData.non_nabh_nabl_rate) : undefined,
          private_rate: formData.private_rate ? parseFloat(formData.private_rate) : undefined,
          bhopal_nabh_rate: formData.bhopal_nabh_rate ? parseFloat(formData.bhopal_nabh_rate) : undefined,
          bhopal_non_nabh_rate: formData.bhopal_non_nabh_rate ? parseFloat(formData.bhopal_non_nabh_rate) : undefined,
        }
      });
    }
    setIsEditDialogOpen(false);
    setSelectedImplant(null);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading implants...</div>
        </div>
      </div>
    );
  }

  const fields = [
    // Basic Info group
    { key: 'name', label: 'Name', type: 'text' as const, required: true, group: 'basic' },
    {
      key: 'category',
      label: 'Category',
      type: 'select' as const,
      options: CATEGORY_OPTIONS,
      placeholder: 'Select category',
      group: 'basic',
    },
    { key: 'subcategory', label: 'Subcategory', type: 'text' as const, group: 'basic' },
    { key: 'manufacturer', label: 'Manufacturer', type: 'text' as const, group: 'basic' },
    { key: 'model_number', label: 'Model / Catalog No.', type: 'text' as const, group: 'basic' },
    { key: 'hsn_code', label: 'HSN Code', type: 'text' as const, group: 'basic' },
    { key: 'gst_percentage', label: 'GST %', type: 'number' as const, placeholder: '5', group: 'basic' },
    { key: 'description', label: 'Description', type: 'textarea' as const, group: 'fullWidth' },
    // Rates group
    { key: 'nabh_nabl_rate', label: 'NABH/NABL Rate', type: 'number' as const, group: 'rates' },
    { key: 'non_nabh_nabl_rate', label: 'Non-NABH/NABL Rate', type: 'number' as const, group: 'rates' },
    { key: 'private_rate', label: 'Private Rate', type: 'number' as const, group: 'rates' },
    { key: 'bhopal_nabh_rate', label: 'Bhopal NABH Rate', type: 'number' as const, group: 'rates' },
    { key: 'bhopal_non_nabh_rate', label: 'Bhopal Non-NABH Rate', type: 'number' as const, group: 'rates' },
  ];

  const editInitialData = selectedImplant ? {
    name: selectedImplant.name || '',
    category: selectedImplant.category || 'General',
    subcategory: selectedImplant.subcategory || '',
    manufacturer: selectedImplant.manufacturer || '',
    model_number: selectedImplant.model_number || '',
    hsn_code: selectedImplant.hsn_code || '',
    gst_percentage: selectedImplant.gst_percentage?.toString() || '5',
    description: selectedImplant.description || '',
    nabh_nabl_rate: selectedImplant.nabh_nabl_rate?.toString() || '',
    non_nabh_nabl_rate: selectedImplant.non_nabh_nabl_rate?.toString() || '',
    private_rate: selectedImplant.private_rate?.toString() || '',
    bhopal_nabh_rate: selectedImplant.bhopal_nabh_rate?.toString() || '',
    bhopal_non_nabh_rate: selectedImplant.bhopal_non_nabh_rate?.toString() || '',
  } : undefined;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Syringe className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">Implant Master List</h1>
          </div>
          <p className="text-lg text-muted-foreground">Manage implants by category</p>
        </div>

        {/* Search + Add */}
        <div className="mb-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search by name, manufacturer, model..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          {canEditMasters && (
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Implant
            </Button>
          )}
        </div>

        {/* Category filter tabs */}
        <div className="mb-6 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => {
            const count = cat === 'ALL' ? implants.length : (categoryCounts[cat] || 0);
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-muted-foreground border-gray-200 hover:border-primary hover:text-primary'
                }`}
              >
                {cat}
                {count > 0 && (
                  <span className={`ml-1.5 text-xs rounded-full px-1.5 py-0.5 ${isActive ? 'bg-white/20' : 'bg-gray-100'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Implant list grouped by category */}
        {Object.keys(groupedImplants).length === 0 ? (
          <div className="text-center py-12">
            <Syringe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No implants found matching your search.' : 'No implants available.'}
            </p>
          </div>
        ) : (
          Object.entries(groupedImplants).map(([category, items]) => (
            <div key={category} className="mb-8">
              {/* Category heading — only show when showing ALL */}
              {activeCategory === 'ALL' && (
                <div className="flex items-center gap-3 mb-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${getCategoryBadgeClass(category)}`}>
                    {category}
                  </span>
                  <span className="text-sm text-muted-foreground">{items.length} implant{items.length !== 1 ? 's' : ''}</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>
              )}

              <div className="grid gap-3">
                {items.map((implant: Implant) => (
                  <Card key={implant.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-lg">{implant.name}</span>
                          {activeCategory === 'ALL' ? null : (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getCategoryBadgeClass(implant.category)}`}>
                              {implant.category || 'General'}
                            </span>
                          )}
                          {implant.subcategory && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              {implant.subcategory}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {canEditMasters && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedImplant(implant);
                                setIsEditDialogOpen(true);
                              }}
                              className="text-blue-600 hover:text-blue-700"
                              title="Edit implant"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {canEditMasters && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDelete(implant.id)}
                              className="text-red-600 hover:text-red-700"
                              title="Delete implant"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {/* Manufacturer / Model / GST row */}
                      {(implant.manufacturer || implant.model_number || implant.hsn_code) && (
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                          {implant.manufacturer && <span>Mfr: <span className="font-medium text-foreground">{implant.manufacturer}</span></span>}
                          {implant.model_number && <span>Model: <span className="font-medium text-foreground">{implant.model_number}</span></span>}
                          {implant.hsn_code && <span>HSN: <span className="font-medium text-foreground">{implant.hsn_code}</span></span>}
                          {implant.gst_percentage != null && <span>GST: <span className="font-medium text-foreground">{implant.gst_percentage}%</span></span>}
                        </div>
                      )}
                      {implant.description && (
                        <p className="text-xs text-muted-foreground mb-3 italic">{implant.description}</p>
                      )}
                      {/* Rates */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">NABH/NABL Rate:</span>
                          <p className="font-medium">{implant.nabh_nabl_rate ?? '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Non-NABH/NABL Rate:</span>
                          <p className="font-medium">{implant.non_nabh_nabl_rate ?? '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Private Rate:</span>
                          <p className="font-medium">{implant.private_rate ?? '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Bhopal NABH Rate:</span>
                          <p className="font-medium">{implant.bhopal_nabh_rate ?? '-'}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Bhopal Non-NABH Rate:</span>
                          <p className="font-medium">{implant.bhopal_non_nabh_rate ?? '-'}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))
        )}

        {/* Add Dialog */}
        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={handleAdd}
          title="Add Implant"
          fields={fields}
          defaultValues={{ category: 'General', gst_percentage: '5' }}
        />

        {/* Edit Dialog */}
        <AddItemDialog
          isOpen={isEditDialogOpen}
          onClose={() => {
            setIsEditDialogOpen(false);
            setSelectedImplant(null);
          }}
          onAdd={handleEdit}
          title="Edit Implant"
          fields={fields}
          initialData={editInitialData}
        />
      </div>
    </div>
  );
};

export default ImplantMaster;
