
// Medicine Inventory Management Component
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Search, 
  Filter, 
  Package, 
  AlertTriangle, 
  Calendar,
  BarChart3,
  Edit,
  Trash2,
  Eye,
  Scan,
  Download,
  Upload
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Medicine {
  id: string;
  name: string;
  generic_name?: string;
  brand_name?: string[] | string;
  medicine_code?: string;
  barcode?: string;
  category?: string;
  manufacturer_id?: string;
  strength?: string;
  dosage?: string;
  price_per_strip?: string;
  stock?: string;
  Exp_date?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

const MedicineInventory: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState('all');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchMedicines = async () => {
      setLoading(true);
      let query = supabase
        .from('medication')
        .select('*')
        .order('name')
        .limit(100);
      if (searchTerm) {
        const t = `%${searchTerm}%`;
        query = query.or(`name.ilike.${t},generic_name.ilike.${t},medicine_code.ilike.${t}`);
      }
      const { data, error } = await query;
      if (error) {
        console.error('Error fetching medicines:', error);
        setMedicines([]);
      } else {
        setMedicines(data || []);
      }
      setLoading(false);
    };
    // Debounce so each keystroke doesn't fire a query
    const timer = setTimeout(fetchMedicines, searchTerm ? 300 : 0);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const categories = ['All', 'Analgesics', 'Antibiotics', 'Anti-inflammatory', 'Vitamins', 'Cardiovascular'];

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);

  const getStockStatus = (current: number) => {
    const minimum = 10; // Default minimum level
    if (current === 0) return { status: 'out-of-stock', color: 'bg-red-100 text-red-800' };
    if (current <= minimum) return { status: 'low-stock', color: 'bg-orange-100 text-orange-800' };
    if (current <= minimum * 2) return { status: 'moderate', color: 'bg-yellow-100 text-yellow-800' };
    return { status: 'in-stock', color: 'bg-green-100 text-green-800' };
  };

  const getExpiryStatus = (expiryDate?: string) => {
    if (!expiryDate) return null;
    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 3600 * 24));
    
    if (diffDays < 0) return { status: 'expired', color: 'bg-red-100 text-red-800' };
    if (diffDays <= 30) return { status: 'expiring-soon', color: 'bg-orange-100 text-orange-800' };
    if (diffDays <= 90) return { status: 'expiring-3months', color: 'bg-yellow-100 text-yellow-800' };
    return { status: 'good', color: 'bg-green-100 text-green-800' };
  };

  const filteredMedicines = medicines.filter(medicine => {
    const matchesSearch = (medicine.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (typeof medicine.brand_name === 'string' ? medicine.brand_name : medicine.brand_name?.[0])?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         medicine.medicine_code?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || medicine.category === selectedCategory;
    
    const stockValue = parseInt(medicine.stock || '0');
    const minimum = 10; // Default minimum level
    const matchesStock = stockFilter === 'all' || 
                        (stockFilter === 'low' && stockValue <= minimum) ||
                        (stockFilter === 'out' && stockValue === 0) ||
                        (stockFilter === 'good' && stockValue > minimum);
    
    return matchesSearch && matchesCategory && matchesStock;
  });

  const inventoryStats = {
    totalMedicines: medicines.length,
    lowStockItems: medicines.filter(m => parseInt(m.stock || '0') <= 10).length,
    outOfStockItems: medicines.filter(m => parseInt(m.stock || '0') === 0).length,
    totalValue: medicines.reduce((sum, m) => sum + (parseInt(m.stock || '0') * parseFloat(m.price_per_strip || '0')), 0)
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Medicine Inventory</h2>
            <p className="text-sm text-muted-foreground">
              Manage medicines, stock levels, and inventory tracking
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <Button variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Medicine
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add New Medicine</DialogTitle>
              </DialogHeader>
              <AddMedicineForm onSuccess={() => setIsAddDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Medicines</p>
                <p className="text-2xl font-bold">{inventoryStats.totalMedicines}</p>
              </div>
              <Package className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Low Stock Items</p>
                <p className="text-2xl font-bold text-orange-600">{inventoryStats.lowStockItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Out of Stock</p>
                <p className="text-2xl font-bold text-red-600">{inventoryStats.outOfStockItems}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Inventory Value</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(inventoryStats.totalValue)}</p>
              </div>
              <BarChart3 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search medicines by name, code, or barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              className="px-3 py-2 border rounded-md"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categories.slice(1).map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            <select
              className="px-3 py-2 border rounded-md"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            >
              <option value="all">All Stock Levels</option>
              <option value="good">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
            </select>
            <Button variant="outline">
              <Scan className="h-4 w-4 mr-2" />
              Scan Barcode
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Medicines Table */}
      <Card>
        <CardHeader>
          <CardTitle>Medicines ({filteredMedicines.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicine Details</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Pricing</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMedicines.map((medicine) => {
                  const stockValue = parseInt(medicine.stock || '0');
                  const stockStatus = getStockStatus(stockValue);
                  const expiryStatus = getExpiryStatus(medicine.Exp_date);
                  const brandName = typeof medicine.brand_name === 'string' ? medicine.brand_name : medicine.brand_name?.[0];
                  
                  return (
                    <TableRow key={medicine.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{medicine.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {brandName} • {medicine.strength} • {medicine.dosage}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Code: {medicine.medicine_code}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{medicine.category}</Badge>
                        <div className="text-xs text-muted-foreground mt-1">
                          {medicine.manufacturer_id}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{medicine.stock} units</div>
                        <div className="text-xs text-muted-foreground">
                          Min: 10
                        </div>
                        <Badge className={stockStatus.color}>
                          {stockStatus.status.replace('-', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">Price: {formatCurrency(parseFloat(medicine.price_per_strip || '0'))}</div>
                      </TableCell>
                      <TableCell>
                        {medicine.Exp_date ? (
                          <div>
                            <div className="text-sm">{medicine.Exp_date}</div>
                            {expiryStatus && (
                              <Badge className={expiryStatus.color}>
                                {expiryStatus.status.replace('-', ' ')}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">Active</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedMedicine(medicine)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline">
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline">
                            <Package className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filteredMedicines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <div className="flex flex-col items-center gap-2">
                        <Package className="h-8 w-8 text-muted-foreground" />
                        <p className="text-muted-foreground">
                          {searchTerm || selectedCategory !== 'all' || stockFilter !== 'all'
                            ? 'No medicines found matching your criteria.'
                            : 'No medicines in inventory.'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Medicine Details Dialog */}
      <Dialog open={!!selectedMedicine} onOpenChange={() => setSelectedMedicine(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Medicine Details - {selectedMedicine?.name}</DialogTitle>
          </DialogHeader>
          {selectedMedicine && (
            <MedicineDetailsView medicine={selectedMedicine} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Add Medicine Form Component
const AddMedicineForm: React.FC<{ onSuccess: () => void }> = ({ onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    generic_name: '',
    brand_name: '',
    medicine_code: '',
    barcode: '',
    category: '',
    manufacturer_id: '',
    strength: '',
    dosage: 'Tablet',
    description: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const { error } = await supabase
      .from('medication')
      .insert([
        { 
            name: formData.name,
            generic_name: formData.generic_name,
            brand_name: [formData.brand_name],
            medicine_code: formData.medicine_code,
            barcode: formData.barcode,
            category: formData.category,
            manufacturer_id: formData.manufacturer_id,
            strength: formData.strength,
            dosage: formData.dosage,
            description: formData.description,
        }
      ]);

    if (error) {
      console.error('Error adding medicine:', error);
      alert(`Error adding medicine: ${error.message}`);
    } else {
      alert('Medicine added successfully!');
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Medicine Name *</label>
          <Input
            required
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Enter medicine name"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Generic Name</label>
          <Input
            value={formData.generic_name}
            onChange={(e) => setFormData(prev => ({ ...prev, generic_name: e.target.value }))}
            placeholder="Enter generic name"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Brand Name</label>
          <Input
            value={formData.brand_name}
            onChange={(e) => setFormData(prev => ({ ...prev, brand_name: e.target.value }))}
            placeholder="Enter brand name"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Medicine Code *</label>
          <Input
            required
            value={formData.medicine_code}
            onChange={(e) => setFormData(prev => ({ ...prev, medicine_code: e.target.value }))}
            placeholder="Enter medicine code"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Barcode</label>
          <Input
            value={formData.barcode}
            onChange={(e) => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
            placeholder="Enter barcode"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Strength</label>
          <Input
            value={formData.strength}
            onChange={(e) => setFormData(prev => ({ ...prev, strength: e.target.value }))}
            placeholder="e.g., 500mg"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Dosage Form</label>
          <select
            className="w-full p-2 border rounded"
            value={formData.dosage}
            onChange={(e) => setFormData(prev => ({ ...prev, dosage: e.target.value }))}
          >
            <option value="Tablet">Tablet</option>
            <option value="Capsule">Capsule</option>
            <option value="Syrup">Syrup</option>
            <option value="Injection">Injection</option>
            <option value="Ointment">Ointment</option>
            <option value="Drop">Drop</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Category</label>
          <Input
            value={formData.category}
            onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
            placeholder="Enter category"
          />
        </div>
        <div>
          <label className="text-sm font-medium">Manufacturer ID</label>
          <Input
            value={formData.manufacturer_id}
            onChange={(e) => setFormData(prev => ({ ...prev, manufacturer_id: e.target.value }))}
            placeholder="Enter manufacturer ID"
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <Input
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Enter description"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="submit">Add Medicine</Button>
      </div>
    </form>
  );
};

// Medicine Details View Component
const MedicineDetailsView: React.FC<{ medicine: Medicine }> = ({ medicine }) => {
  const brandName = typeof medicine.brand_name === 'string' ? medicine.brand_name : medicine.brand_name?.[0];
  
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium text-muted-foreground">Medicine Name</label>
          <p className="font-medium">{medicine.name}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Generic Name</label>
          <p>{medicine.generic_name || 'N/A'}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Brand Name</label>
          <p>{brandName || 'N/A'}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Medicine Code</label>
          <p className="font-mono">{medicine.medicine_code}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Category</label>
          <p>{medicine.category}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Manufacturer</label>
          <p>{medicine.manufacturer_id}</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Current Stock</label>
          <p className="font-bold text-lg">{medicine.stock} units</p>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground">Minimum Level</label>
          <p>10 units</p>
        </div>
      </div>
    </div>
  );
};

export default MedicineInventory;
