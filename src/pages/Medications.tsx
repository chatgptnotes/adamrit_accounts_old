
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Pill, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AddItemDialog } from '@/components/AddItemDialog';

const Medications = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingMedication, setEditingMedication] = useState(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: medications = [], isLoading } = useQuery({
    queryKey: ['medication', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('medication')
        .select('*')
        .order('name')
        .limit(100);
      if (searchTerm) {
        const t = `%${searchTerm}%`;
        query = query.or(
          `name.ilike.${t},description.ilike.${t},generic_name.ilike.${t},category.ilike.${t},manufacturer.ilike.${t},medicine_code.ilike.${t},item_code.ilike.${t},barcode.ilike.${t},supplier_name.ilike.${t}`
        );
      }
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching medications:', error);
        throw error;
      }
      
      return data;
    }
  });

  const addMedicationMutation = useMutation({
    mutationFn: async ({ 
      name, description, generic_name, category, dosage, cost, medicine_code, 
      barcode, strength, manufacturer, item_code, pack, price_per_strip, 
      stock, exp_date, shelf, supplier_name, is_implant 
    }: { 
      name: string; 
      description?: string; 
      generic_name?: string; 
      category?: string; 
      dosage?: string;
      cost?: string;
      medicine_code?: string;
      barcode?: string;
      strength?: string;
      manufacturer?: string;
      item_code?: string;
      pack?: string;
      price_per_strip?: string;
      stock?: string;
      exp_date?: string;
      shelf?: string;
      supplier_name?: string;
      is_implant?: boolean;
    }) => {
      const insertData = { 
        name, 
        description, 
        generic_name, 
        category, 
        dosage, 
        cost: cost ? parseFloat(cost) : null,
        medicine_code,
        barcode,
        strength,
        manufacturer,
        item_code,
        pack,
        price_per_strip,
        stock,
        exp_date: exp_date ? exp_date : null,
        shelf,
        supplier_name,
        is_implant: is_implant || false
      };


      const { data, error } = await supabase
        .from('medication')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        console.error('Error adding medication:', error);
        console.error('Insert data that caused error:', insertData);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication'] });
      toast({
        title: "Success",
        description: "Medication added successfully",
      });
    },
    onError: (error) => {
      console.error('Add medication error:', error);
      const errorMessage = error?.message || 'Failed to add medication';
      toast({
        title: "Error",
        description: `Failed to add medication: ${errorMessage}`,
        variant: "destructive"
      });
    }
  });

  const editMedicationMutation = useMutation({
    mutationFn: async ({ 
      id, name, description, generic_name, category, dosage, cost, medicine_code, 
      barcode, strength, manufacturer, item_code, pack, price_per_strip, 
      stock, exp_date, shelf, supplier_name, is_implant 
    }: { 
      id: string;
      name: string; 
      description?: string; 
      generic_name?: string; 
      category?: string; 
      dosage?: string;
      cost?: string;
      medicine_code?: string;
      barcode?: string;
      strength?: string;
      manufacturer?: string;
      item_code?: string;
      pack?: string;
      price_per_strip?: string;
      stock?: string;
      exp_date?: string;
      shelf?: string;
      supplier_name?: string;
      is_implant?: boolean;
    }) => {
      const updateData = { 
        name, 
        description, 
        generic_name, 
        category, 
        dosage, 
        cost: cost ? parseFloat(cost) : null,
        medicine_code,
        barcode,
        strength,
        manufacturer,
        item_code,
        pack,
        price_per_strip,
        stock,
        exp_date: exp_date ? exp_date : null,
        shelf,
        supplier_name,
        is_implant: is_implant || false
      };


      const { data, error } = await supabase
        .from('medication')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating medication:', error);
        console.error('Update data that caused error:', updateData);
        throw error;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication'] });
      toast({
        title: "Success",
        description: "Medication updated successfully",
      });
      setIsEditDialogOpen(false);
      setEditingMedication(null);
    },
    onError: (error) => {
      console.error('Edit medication error:', error);
      const errorMessage = error?.message || 'Failed to update medication';
      toast({
        title: "Error",
        description: `Failed to update medication: ${errorMessage}`,
        variant: "destructive"
      });
    }
  });

  const deleteMedicationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('medication')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting medication:', error);
        throw error;
      }

      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medication'] });
      toast({
        title: "Success",
        description: "Medication deleted successfully",
      });
    },
    onError: (error) => {
      console.error('Delete medication error:', error);
      toast({
        title: "Error",
        description: "Failed to delete medication",
        variant: "destructive"
      });
    }
  });

  const handleEdit = (medication: any) => {
    setEditingMedication(medication);
    setIsEditDialogOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteMedicationMutation.mutate(id);
    }
  };

  const filteredMedications = medications.filter(medication =>
    medication.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (medication.description && medication.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.generic_name && medication.generic_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.category && medication.category.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.manufacturer && medication.manufacturer.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.medicine_code && medication.medicine_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.item_code && medication.item_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.barcode && medication.barcode.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (medication.supplier_name && medication.supplier_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading medications...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Pill className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold text-primary">
              Medications Master List
            </h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Manage all medications
          </p>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search medications..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Medication
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMedications.map((medication) => (
            <Card key={medication.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="text-lg">{medication.name}</span>
                  <div className="flex items-center gap-2">
                    {medication.dosage && (
                      <Badge variant="outline">
                        {medication.dosage}
                      </Badge>
                    )}
                    {medication.category && (
                      <Badge variant="secondary">
                        {medication.category}
                      </Badge>
                    )}
                    <div className="flex gap-1 ml-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(medication)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(medication.id, medication.name)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardTitle>
                {medication.generic_name && (
                  <p className="text-sm text-muted-foreground">
                    Generic: {medication.generic_name}
                  </p>
                )}
                {medication.manufacturer && (
                  <p className="text-sm text-muted-foreground">
                    Manufacturer: {medication.manufacturer}
                  </p>
                )}
                {medication.strength && (
                  <p className="text-sm text-muted-foreground">
                    Strength: {medication.strength}
                  </p>
                )}
                <div className="flex gap-4 mt-2">
                  {medication.cost && (
                    <p className="text-sm font-medium text-green-600">
                      Cost: ₹{medication.cost}
                    </p>
                  )}
                  {medication.price_per_strip && (
                    <p className="text-sm font-medium text-blue-600">
                      Per Strip: ₹{medication.price_per_strip}
                    </p>
                  )}
                </div>
                {(medication.stock || medication.shelf || medication.exp_date) && (
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                    {medication.stock && (
                      <span>Stock: {medication.stock}</span>
                    )}
                    {medication.shelf && (
                      <span>Shelf: {medication.shelf}</span>
                    )}
                    {medication.exp_date && (
                      <span>Exp: {new Date(medication.exp_date).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
                {medication.is_implant && (
                  <div className="mt-1">
                    <Badge variant="destructive" className="text-xs">
                      Implant Item
                    </Badge>
                  </div>
                )}
              </CardHeader>
              {medication.description && (
                <CardContent>
                  <p className="text-muted-foreground">{medication.description}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {filteredMedications.length === 0 && (
          <div className="text-center py-12">
            <Pill className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">
              {searchTerm ? 'No medications found matching your search.' : 'No medications available.'}
            </p>
          </div>
        )}

        <AddItemDialog
          isOpen={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
          onAdd={(formData) => 
            addMedicationMutation.mutate({ 
              name: formData.name, 
              description: formData.description,
              generic_name: formData.generic_name,
              category: formData.category,
              dosage: formData.dosage,
              cost: formData.cost,
              medicine_code: formData.medicine_code,
              barcode: formData.barcode,
              strength: formData.strength,
              manufacturer: formData.manufacturer,
              item_code: formData.item_code,
              pack: formData.pack,
              price_per_strip: formData.price_per_strip,
              stock: formData.stock,
              exp_date: formData.exp_date,
              shelf: formData.shelf,
              supplier_name: formData.supplier_name,
              is_implant: formData.is_implant === 'true'
            })
          }
          title="Add New Medication"
          fields={[
            // Row 1: Basic Information
            {
              key: 'name',
              label: 'Medication Name',
              type: 'text',
              required: true,
              placeholder: 'Enter medication name',
              group: 'basic'
            },
            {
              key: 'generic_name',
              label: 'Generic Name',
              type: 'text',
              required: true,
              placeholder: 'Enter generic name',
              group: 'basic'
            },
            {
              key: 'medicine_code',
              label: 'Medicine Code',
              type: 'text',
              placeholder: 'Enter medicine code',
              group: 'basic'
            },
            
            // Row 2: Product Identification
            {
              key: 'item_code',
              label: 'Item Code',
              type: 'text',
              placeholder: 'Enter item code',
              group: 'identification'
            },
            {
              key: 'barcode',
              label: 'Barcode',
              type: 'text',
              placeholder: 'Enter barcode',
              group: 'identification'
            },
            {
              key: 'category',
              label: 'Category',
              type: 'text',
              required: true,
              placeholder: 'Enter category (e.g., Antibiotic, Analgesic)',
              group: 'identification'
            },
            
            // Row 3: Product Details
            {
              key: 'dosage',
              label: 'Dosage',
              type: 'text',
              required: true,
              placeholder: 'Enter dosage (e.g., 500mg)',
              group: 'details'
            },
            {
              key: 'strength',
              label: 'Strength',
              type: 'text',
              required: true,
              placeholder: 'Enter strength (e.g., 250mg)',
              group: 'details'
            },
            {
              key: 'pack',
              label: 'Pack Size',
              type: 'text',
              placeholder: 'Enter pack size (e.g., 10 tablets)',
              group: 'details'
            },
            
            // Row 4: Manufacturing
            {
              key: 'manufacturer',
              label: 'Manufacturer',
              type: 'text',
              required: true,
              placeholder: 'Enter manufacturer name',
              group: 'manufacturing',
              colSpan: 2
            },
            {
              key: 'supplier_name',
              label: 'Supplier Name',
              type: 'text',
              placeholder: 'Enter supplier name',
              group: 'manufacturing'
            },
            
            // Row 5: Pricing
            {
              key: 'cost',
              label: 'Cost/Amount (₹)',
              type: 'number',
              required: true,
              placeholder: 'Enter cost in rupees',
              group: 'pricing'
            },
            {
              key: 'price_per_strip',
              label: 'Price Per Strip (₹)',
              type: 'number',
              placeholder: 'Enter price per strip',
              group: 'pricing'
            },
            
            // Row 6: Inventory
            {
              key: 'stock',
              label: 'Stock Quantity',
              type: 'text',
              required: true,
              placeholder: 'Enter current stock',
              group: 'inventory'
            },
            {
              key: 'exp_date',
              label: 'Expiry Date',
              type: 'date',
              placeholder: 'Select expiry date',
              group: 'inventory'
            },
            {
              key: 'shelf',
              label: 'Shelf Location',
              type: 'text',
              placeholder: 'Enter shelf location (e.g., A1-B2)',
              group: 'inventory'
            },
            
            // Row 7: Special Properties
            {
              key: 'is_implant',
              label: 'Is Implant Item?',
              type: 'select',
              options: [
                { label: 'No', value: 'false' },
                { label: 'Yes', value: 'true' }
              ],
              group: 'special'
            },
            
            // Full Width
            {
              key: 'description',
              label: 'Description (Optional)',
              type: 'textarea',
              placeholder: 'Enter description',
              group: 'fullWidth',
              colSpan: 3
            }
          ]}
        />

        {editingMedication && (
          <AddItemDialog
            isOpen={isEditDialogOpen}
            onClose={() => {
              setIsEditDialogOpen(false);
              setEditingMedication(null);
            }}
            onAdd={(formData) => 
              editMedicationMutation.mutate({ 
                id: editingMedication.id,
                name: formData.name, 
                description: formData.description,
                generic_name: formData.generic_name,
                category: formData.category,
                dosage: formData.dosage,
                cost: formData.cost,
                medicine_code: formData.medicine_code,
                barcode: formData.barcode,
                strength: formData.strength,
                manufacturer: formData.manufacturer,
                item_code: formData.item_code,
                pack: formData.pack,
                price_per_strip: formData.price_per_strip,
                stock: formData.stock,
                exp_date: formData.exp_date,
                shelf: formData.shelf,
                supplier_name: formData.supplier_name,
                is_implant: formData.is_implant === 'true'
              })
            }
            title="Edit Medication"
            defaultValues={{
              name: editingMedication.name,
              generic_name: editingMedication.generic_name || '',
              medicine_code: editingMedication.medicine_code || '',
              item_code: editingMedication.item_code || '',
              barcode: editingMedication.barcode || '',
              category: editingMedication.category || '',
              dosage: editingMedication.dosage || '',
              strength: editingMedication.strength || '',
              pack: editingMedication.pack || '',
              manufacturer: editingMedication.manufacturer || '',
              cost: editingMedication.cost?.toString() || '',
              price_per_strip: editingMedication.price_per_strip || '',
              stock: editingMedication.stock || '',
              exp_date: editingMedication.exp_date ? new Date(editingMedication.exp_date).toISOString().split('T')[0] : '',
              shelf: editingMedication.shelf || '',
              supplier_name: editingMedication.supplier_name || '',
              is_implant: editingMedication.is_implant ? 'true' : 'false',
              description: editingMedication.description || ''
            }}
            fields={[
              // Row 1: Basic Information
              {
                key: 'name',
                label: 'Medication Name',
                type: 'text',
                required: true,
                placeholder: 'Enter medication name',
                group: 'basic'
              },
              {
                key: 'generic_name',
                label: 'Generic Name',
                type: 'text',
                required: true,
                placeholder: 'Enter generic name',
                group: 'basic'
              },
              {
                key: 'medicine_code',
                label: 'Medicine Code',
                type: 'text',
                placeholder: 'Enter medicine code',
                group: 'basic'
              },
              
              // Row 2: Product Identification
              {
                key: 'item_code',
                label: 'Item Code',
                type: 'text',
                placeholder: 'Enter item code',
                group: 'identification'
              },
              {
                key: 'barcode',
                label: 'Barcode',
                type: 'text',
                placeholder: 'Enter barcode',
                group: 'identification'
              },
              {
                key: 'category',
                label: 'Category',
                type: 'text',
                required: true,
                placeholder: 'Enter category (e.g., Antibiotic, Analgesic)',
                group: 'identification'
              },
              
              // Row 3: Product Details
              {
                key: 'dosage',
                label: 'Dosage',
                type: 'text',
                required: true,
                placeholder: 'Enter dosage (e.g., 500mg)',
                group: 'details'
              },
              {
                key: 'strength',
                label: 'Strength',
                type: 'text',
                required: true,
                placeholder: 'Enter strength (e.g., 250mg)',
                group: 'details'
              },
              {
                key: 'pack',
                label: 'Pack Size',
                type: 'text',
                placeholder: 'Enter pack size (e.g., 10 tablets)',
                group: 'details'
              },
              
              // Row 4: Manufacturing
              {
                key: 'manufacturer',
                label: 'Manufacturer',
                type: 'text',
                required: true,
                placeholder: 'Enter manufacturer name',
                group: 'manufacturing',
                colSpan: 2
              },
              {
                key: 'supplier_name',
                label: 'Supplier Name',
                type: 'text',
                placeholder: 'Enter supplier name',
                group: 'manufacturing'
              },
              
              // Row 5: Pricing
              {
                key: 'cost',
                label: 'Cost/Amount (₹)',
                type: 'number',
                required: true,
                placeholder: 'Enter cost in rupees',
                group: 'pricing'
              },
              {
                key: 'price_per_strip',
                label: 'Price Per Strip (₹)',
                type: 'number',
                placeholder: 'Enter price per strip',
                group: 'pricing'
              },
              
              // Row 6: Inventory
              {
                key: 'stock',
                label: 'Stock Quantity',
                type: 'text',
                required: true,
                placeholder: 'Enter current stock',
                group: 'inventory'
              },
              {
                key: 'exp_date',
                label: 'Expiry Date',
                type: 'date',
                placeholder: 'Select expiry date',
                group: 'inventory'
              },
              {
                key: 'shelf',
                label: 'Shelf Location',
                type: 'text',
                placeholder: 'Enter shelf location (e.g., A1-B2)',
                group: 'inventory'
              },
              
              // Row 7: Special Properties
              {
                key: 'is_implant',
                label: 'Is Implant Item?',
                type: 'select',
                options: [
                  { label: 'No', value: 'false' },
                  { label: 'Yes', value: 'true' }
                ],
                group: 'special'
              },
              
              // Full Width
              {
                key: 'description',
                label: 'Description (Optional)',
                type: 'textarea',
                placeholder: 'Enter description',
                group: 'fullWidth',
                colSpan: 3
              }
            ]}
          />
        )}
      </div>
    </div>
  );
};

export default Medications;
