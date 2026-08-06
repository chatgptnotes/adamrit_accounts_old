import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { PurchaseOrderService } from '@/lib/purchase-order-service';
import { SupplierService, Supplier } from '@/lib/supplier-service';
import { MedicineService, Medicine } from '@/lib/medicine-service';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Loader2, Plus, Trash2, Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PurchaseOrderItem {
  id: string;
  medicine_id?: string;
  product_name: string;
  manufacturer: string;
  pack: string;
  batch_no: string;
  mrp: number;
  sale_price: number;
  purchase_price: number;
  tax: number;
  total_stock: number;
  order_qty: number;
  vat_amt: number;
  amount: number;
}

interface AddPurchaseOrderProps {
  onBack?: () => void;
}

const AddPurchaseOrder: React.FC<AddPurchaseOrderProps> = ({ onBack }) => {
  const draftStorageKey = 'pharmacy_purchase_order_draft';
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const isDraftHydrated = useRef(false);

  // Form state
  const [poNumber, setPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [orderFor, setOrderFor] = useState('');
  const [supplierId, setSupplierId] = useState<string>('');

  // Product line items state
  const [lineItems, setLineItems] = useState<PurchaseOrderItem[]>([]);
  const [showAddProductDialog, setShowAddProductDialog] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Medicine search state
  const [medicineSearch, setMedicineSearch] = useState('');
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [selectedMedicine, setSelectedMedicine] = useState<Medicine | null>(null);
  const [openMedicineCombobox, setOpenMedicineCombobox] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // New product form state
  const [newProduct, setNewProduct] = useState<Partial<PurchaseOrderItem>>({
    product_name: '',
    manufacturer: '',
    pack: '',
    batch_no: '',
    mrp: 0,
    sale_price: 0,
    purchase_price: 0,
    tax: 0,
    total_stock: 0,
    order_qty: 0,
    vat_amt: 0,
    amount: 0,
  });

  // Calculate totals
  const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const totalTax = lineItems.reduce((sum, item) => sum + item.vat_amt, 0);
  const netAmount = totalAmount + totalTax;

  // Initialize form data
  useEffect(() => {
    const initializeForm = async () => {
      try {
        setIsLoading(true);

        const savedDraft = localStorage.getItem(draftStorageKey);
        let draft: Partial<{
          poNumber: string;
          orderDate: string;
          orderFor: string;
          supplierId: string;
          lineItems: PurchaseOrderItem[];
        }> = {};

        if (savedDraft) {
          try {
            draft = JSON.parse(savedDraft);
          } catch (error) {
            console.error('Error reading purchase order draft:', error);
            localStorage.removeItem(draftStorageKey);
          }
        }

        // Restore the in-progress PO, or initialize a new one.
        const generatedPO = draft.poNumber || await PurchaseOrderService.generatePONumber();
        setPoNumber(generatedPO);

        const now = new Date();
        const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setOrderDate(draft.orderDate || localDateTime);
        setOrderFor(draft.orderFor || '');
        setSupplierId(draft.supplierId || '');
        setLineItems(Array.isArray(draft.lineItems) ? draft.lineItems : []);

        // Fetch suppliers
        const suppliersData = await SupplierService.getAll();
        setSuppliers(suppliersData);

        isDraftHydrated.current = true;
        setIsLoading(false);
      } catch (error) {
        console.error('Error initializing form:', error);
        toast({
          title: 'Error',
          description: 'Failed to initialize form. Please refresh the page.',
          variant: 'destructive',
        });
        setIsLoading(false);
      }
    };

    initializeForm();
  }, [toast]);

  // Keep the in-progress PO available if the page is refreshed before submission.
  useEffect(() => {
    if (!isDraftHydrated.current) return;

    localStorage.setItem(draftStorageKey, JSON.stringify({
      poNumber,
      orderDate,
      orderFor,
      supplierId,
      lineItems,
    }));
  }, [poNumber, orderDate, orderFor, supplierId, lineItems]);

  // Search medicines when user types
  useEffect(() => {
    const searchMedicines = async () => {
      if (medicineSearch.length < 2) {
        setMedicines([]);
        return;
      }

      try {
        setIsSearching(true);
        const results = await MedicineService.searchMedicines(medicineSearch);
        setMedicines(results);
        setIsSearching(false);
      } catch (error) {
        console.error('Error searching medicines:', error);
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchMedicines, 300);
    return () => clearTimeout(timeoutId);
  }, [medicineSearch]);

  // Auto-populate form when medicine is selected
  const handleMedicineSelect = async (medicine: Medicine) => {
    setSelectedMedicine(medicine);
    setOpenMedicineCombobox(false);

    // Fetch manufacturer name if manufacturer_id exists
    let manufacturerName = '';
    if (medicine.manufacturer_id) {
      try {
        const manufacturer = await MedicineService.getManufacturerById(medicine.manufacturer_id);
        manufacturerName = manufacturer?.name || '';
      } catch (error) {
        console.error('Error fetching manufacturer:', error);
      }
    }

    // Fetch total stock from batch inventory (sum of all batches for this medicine)
    let totalBatchStock = 0;
    try {
      const { data: batchData } = await supabase
        .from('medicine_batch_inventory')
        .select('current_stock')
        .eq('medicine_id', medicine.id)
        .eq('is_active', true);

      if (batchData) {
        totalBatchStock = batchData.reduce((sum, batch) => sum + (batch.current_stock || 0), 0);
      }
    } catch (error) {
      console.error('Error fetching batch inventory:', error);
    }

    // Auto-populate the form
    // Note: Pricing fields default to 0 - user must enter purchase_price
    // Batch number will be entered later during GRN
    setNewProduct({
      medicine_id: medicine.id,
      product_name: medicine.medicine_name,
      manufacturer: manufacturerName,
      pack: medicine.type || '1',
      batch_no: '', // Batch entered during GRN
      mrp: 0, // User can enter
      sale_price: 0, // User can enter
      purchase_price: 0, // User must enter
      tax: 0, // User must enter
      total_stock: totalBatchStock, // Stock from batch inventory
      order_qty: 0, // User must enter
      vat_amt: 0,
      amount: 0,
    });

    setMedicineSearch(medicine.medicine_name);
  };

  // Calculate amount and VAT when quantity or price changes
  const calculateLineItem = (item: Partial<PurchaseOrderItem>): Partial<PurchaseOrderItem> => {
    const qty = item.order_qty || 0;
    const price = item.purchase_price || 0;
    const taxRate = item.tax || 0;

    const amount = qty * price;
    const vat_amt = (amount * taxRate) / 100;

    return {
      ...item,
      amount,
      vat_amt,
    };
  };

  // Handle adding product to line items
  const handleAddProduct = () => {
    // Validate medicine selection
    if (!newProduct.medicine_id) {
      toast({
        title: 'Medicine Not Selected',
        description: 'Please search and select a medicine from the master list before adding to order.',
        variant: 'destructive',
      });
      return;
    }

    if (!newProduct.product_name || !newProduct.order_qty || newProduct.order_qty <= 0) {
      toast({
        title: 'Validation Error',
        description: 'Please enter order quantity.',
        variant: 'destructive',
      });
      return;
    }

    const calculatedProduct = calculateLineItem(newProduct);
    const newItem: PurchaseOrderItem = {
      id: `item-${Date.now()}`,
      medicine_id: calculatedProduct.medicine_id,
      product_name: calculatedProduct.product_name || '',
      manufacturer: calculatedProduct.manufacturer || '',
      pack: calculatedProduct.pack || '',
      batch_no: calculatedProduct.batch_no || '',
      mrp: calculatedProduct.mrp || 0,
      sale_price: calculatedProduct.sale_price || 0,
      purchase_price: calculatedProduct.purchase_price || 0,
      tax: calculatedProduct.tax || 0,
      total_stock: calculatedProduct.total_stock || 0,
      order_qty: calculatedProduct.order_qty || 0,
      vat_amt: calculatedProduct.vat_amt || 0,
      amount: calculatedProduct.amount || 0,
    };

    setLineItems([...lineItems, newItem]);
    setShowAddProductDialog(false);

    // Reset form
    setNewProduct({
      product_name: '',
      manufacturer: '',
      pack: '',
      batch_no: '',
      mrp: 0,
      sale_price: 0,
      purchase_price: 0,
      tax: 0,
      total_stock: 0,
      order_qty: 0,
      vat_amt: 0,
      amount: 0,
    });
    setSelectedMedicine(null);
    setMedicineSearch('');
    setMedicines([]);
  };

  // Handle deleting a line item
  const handleDeleteItem = (id: string) => {
    setLineItems(lineItems.filter(item => item.id !== id));
  };

  // Handle updating a line item
  const handleUpdateLineItem = (id: string, field: keyof PurchaseOrderItem, value: any) => {
    setLineItems(lineItems.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        return calculateLineItem(updatedItem) as PurchaseOrderItem;
      }
      return item;
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!orderDate || !orderFor || !supplierId) {
      toast({
        title: 'Validation Error',
        description: 'Please fill in all required fields.',
        variant: 'destructive',
      });
      return;
    }

    if (lineItems.length === 0) {
      toast({
        title: 'Validation Error',
        description: 'Please add at least one product to the purchase order.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Prepare PO data
      const poData = {
        po_number: poNumber,
        order_date: orderDate,
        order_for: orderFor,
        supplier_id: parseInt(supplierId),
        subtotal: totalAmount,
        tax_amount: totalTax,
        total_amount: netAmount,
      };

      // Save purchase order with items and update inventory
      const result = await PurchaseOrderService.createWithItems(poData, lineItems);

      toast({
        title: 'Success',
        description: `Purchase Order ${poNumber} created successfully with ${lineItems.length} items! Medicine inventory has been updated.`,
      });

      localStorage.removeItem(draftStorageKey);

      // Return to the pharmacy purchase-order list without a full browser
      // reload. A hard reload can lose the HMIS session/device context and
      // leaves the user on the standalone add route.
      setTimeout(() => {
        if (onBack) {
          onBack(); // Navigate to Purchase Order List
        } else {
          navigate('/pharmacy?tab=purchase-order', { replace: true });
        }
      }, 1500);
    } catch (error) {
      console.error('Error creating purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to create purchase order. Please try again.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading form...</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded shadow-md w-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-blue-800">Add Purchase Order</h2>
        <div className="flex gap-2">
          <Button
            className="bg-blue-500 hover:bg-blue-600 text-white"
            onClick={() => {
              if (onBack) {
                onBack();
              } else {
                navigate('/pharmacy/purchase-orders/list');
              }
            }}
          >
            Back
          </Button>
          <Dialog open={showAddProductDialog} onOpenChange={setShowAddProductDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-500 hover:bg-blue-600 text-white">
                <Plus className="h-4 w-4 mr-1" /> Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Product to Purchase Order</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                {/* Medicine Search Combobox */}
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-2 block text-red-600">
                    Medicine Selection (Required) *
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Search and select medicine from master list. Manual entry not allowed.
                  </p>
                  <Popover open={openMedicineCombobox} onOpenChange={setOpenMedicineCombobox}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={openMedicineCombobox}
                        className={cn(
                          "w-full justify-between",
                          !selectedMedicine && "border-red-300 focus:ring-red-500"
                        )}
                      >
                        {selectedMedicine
                          ? selectedMedicine.medicine_name
                          : "Search and select medicine..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[600px] p-0">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Type medicine name or generic name..."
                          value={medicineSearch}
                          onValueChange={setMedicineSearch}
                        />
                        <CommandList>
                          {isSearching && (
                            <div className="flex items-center justify-center p-4">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="ml-2 text-sm">Searching...</span>
                            </div>
                          )}
                          {!isSearching && medicineSearch.length < 2 && (
                            <CommandEmpty>Type at least 2 characters to search...</CommandEmpty>
                          )}
                          {!isSearching && medicineSearch.length >= 2 && medicines.length === 0 && (
                            <CommandEmpty>No medicine found.</CommandEmpty>
                          )}
                          {!isSearching && medicines.length > 0 && (
                            <CommandGroup>
                              {medicines.map((medicine) => (
                                <CommandItem
                                  key={medicine.id}
                                  value={medicine.id}
                                  onSelect={() => handleMedicineSelect(medicine)}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedMedicine?.id === medicine.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{medicine.medicine_name}</span>
                                    {medicine.generic_name && (
                                      <span className="text-xs text-gray-500">
                                        {medicine.generic_name}
                                      </span>
                                    )}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div>
                  <label className="text-sm font-medium">Manufacturer</label>
                  <Input
                    value={newProduct.manufacturer}
                    onChange={(e) => setNewProduct({ ...newProduct, manufacturer: e.target.value })}
                    placeholder="Auto-filled from medicine"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Pack (Pieces/Tablets)</label>
                  <Input
                    value={newProduct.pack}
                    onChange={(e) => setNewProduct({ ...newProduct, pack: e.target.value })}
                    placeholder="e.g., 10 Tablets, 1 Bottle"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Batch No.</label>
                  <Input
                    value={newProduct.batch_no}
                    onChange={(e) => setNewProduct({ ...newProduct, batch_no: e.target.value })}
                    placeholder="Auto-filled from medicine"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">MRP</label>
                  <Input
                    type="number"
                    value={newProduct.mrp}
                    onChange={(e) => setNewProduct({ ...newProduct, mrp: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Sale Price</label>
                  <Input
                    type="number"
                    value={newProduct.sale_price}
                    onChange={(e) => setNewProduct({ ...newProduct, sale_price: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Purchase Price *</label>
                  <Input
                    type="number"
                    value={newProduct.purchase_price}
                    onChange={(e) => setNewProduct({ ...newProduct, purchase_price: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Tax (%)</label>
                  <Input
                    type="number"
                    value={newProduct.tax}
                    onChange={(e) => setNewProduct({ ...newProduct, tax: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Total Stock</label>
                  <Input
                    type="number"
                    value={newProduct.total_stock}
                    onChange={(e) => setNewProduct({ ...newProduct, total_stock: parseInt(e.target.value) || 0 })}
                    placeholder="Auto-filled from medicine"
                    disabled
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Order Qty (Strips/Units) *</label>
                  <Input
                    type="number"
                    value={newProduct.order_qty}
                    onChange={(e) => setNewProduct({ ...newProduct, order_qty: parseInt(e.target.value) || 0 })}
                    placeholder="e.g., 100 strips"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => {
                  setShowAddProductDialog(false);
                  setSelectedMedicine(null);
                  setMedicineSearch('');
                  setMedicines([]);
                }}>
                  Cancel
                </Button>
                <Button onClick={handleAddProduct} className="bg-green-600 hover:bg-green-700">
                  Add to Order
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Colored line */}
      <div className="h-1 w-full mb-4 bg-gradient-to-r from-lime-400 via-pink-500 to-blue-500 rounded" />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Header Form Fields */}
        <div className="flex flex-wrap gap-6 items-end">
          {/* PO ID - Auto-generated, read-only */}
          <div className="flex flex-col">
            <label className="mb-1 font-medium text-sm">PO ID:</label>
            <input
              type="text"
              value={poNumber}
              className="border-2 border-green-700 rounded px-3 py-2 min-w-[180px] bg-green-50 font-medium"
              readOnly
            />
          </div>

          {/* Order Date - Required */}
          <div className="flex flex-col">
            <label className="mb-1 font-medium text-sm">
              Order Date: <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="border-2 border-green-700 rounded px-3 py-2 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-green-500"
              required
            />
          </div>

          {/* Order For - Required dropdown */}
          <div className="flex flex-col">
            <label className="mb-1 font-medium text-sm">
              Order For: <span className="text-red-500">*</span>
            </label>
            <Select value={orderFor} onValueChange={setOrderFor} required>
              <SelectTrigger className="min-w-[200px] border-2 border-green-700 h-[42px] focus:ring-2 focus:ring-green-500">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Pharmacy">Pharmacy</SelectItem>
                <SelectItem value="Lab">Lab</SelectItem>
                <SelectItem value="Radiology">Radiology</SelectItem>
                <SelectItem value="OT">OT</SelectItem>
                <SelectItem value="Ward">Ward</SelectItem>
                <SelectItem value="Emergency">Emergency</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Supplier - Required dropdown */}
          <div className="flex flex-col flex-1 min-w-[250px]">
            <label className="mb-1 font-medium text-sm">
              Supplier: <span className="text-red-500">*</span>
            </label>
            <Select value={supplierId} onValueChange={setSupplierId} required>
              <SelectTrigger className="w-full border-2 border-green-700 h-[42px] focus:ring-2 focus:ring-green-500">
                <SelectValue placeholder="Select supplier" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                {suppliers.length === 0 ? (
                  <div className="p-2 text-sm text-gray-500">No suppliers found</div>
                ) : (
                  suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id.toString()}>
                      {supplier.supplier_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Product Line Items Table */}
        <div className="mt-6 border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-blue-100">
                <tr>
                  <th className="border p-2 text-left">Product Name</th>
                  <th className="border p-2 text-left">Manufacturer</th>
                  <th className="border p-2 text-center">Pack</th>
                  <th className="border p-2 text-left">Batch No.</th>
                  <th className="border p-2 text-right">MRP</th>
                  <th className="border p-2 text-right">Sale Price</th>
                  <th className="border p-2 text-right">Purchase Price</th>
                  <th className="border p-2 text-right">Tax (%)</th>
                  <th className="border p-2 text-right">Total Stock</th>
                  <th className="border p-2 text-right">Order Qty</th>
                  <th className="border p-2 text-right">Vat Amt</th>
                  <th className="border p-2 text-right">Amount</th>
                  <th className="border p-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="border p-4 text-center text-gray-500">
                      No products added. Click "Add Product" to add items to this purchase order.
                    </td>
                  </tr>
                ) : (
                  lineItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="border p-2">{item.product_name}</td>
                      <td className="border p-2">{item.manufacturer}</td>
                      <td className="border p-2 text-center">{item.pack}</td>
                      <td className="border p-2">{item.batch_no}</td>
                      <td className="border p-2 text-right">
                        {editingItemId === item.id ? (
                          <Input
                            type="number"
                            value={item.mrp}
                            onChange={(e) => handleUpdateLineItem(item.id, 'mrp', parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-right"
                          />
                        ) : (
                          <span>{item.mrp.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="border p-2 text-right">
                        {editingItemId === item.id ? (
                          <Input
                            type="number"
                            value={item.sale_price}
                            onChange={(e) => handleUpdateLineItem(item.id, 'sale_price', parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-right"
                          />
                        ) : (
                          <span>{item.sale_price.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="border p-2 text-right">
                        {editingItemId === item.id ? (
                          <Input
                            type="number"
                            value={item.purchase_price}
                            onChange={(e) => handleUpdateLineItem(item.id, 'purchase_price', parseFloat(e.target.value) || 0)}
                            className="w-20 h-8 text-right"
                          />
                        ) : (
                          <span>{item.purchase_price.toFixed(2)}</span>
                        )}
                      </td>
                      <td className="border p-2 text-right">
                        {editingItemId === item.id ? (
                          <Input
                            type="number"
                            value={item.tax}
                            onChange={(e) => handleUpdateLineItem(item.id, 'tax', parseFloat(e.target.value) || 0)}
                            className="w-16 h-8 text-right"
                          />
                        ) : (
                          <span>{item.tax}</span>
                        )}
                      </td>
                      <td className="border p-2 text-right">{item.total_stock}</td>
                      <td className="border p-2 text-right">
                        {editingItemId === item.id ? (
                          <Input
                            type="number"
                            value={item.order_qty}
                            onChange={(e) => handleUpdateLineItem(item.id, 'order_qty', parseInt(e.target.value) || 0)}
                            className="w-20 h-8 text-right"
                          />
                        ) : (
                          <span>{item.order_qty}</span>
                        )}
                      </td>
                      <td className="border p-2 text-right">{item.vat_amt.toFixed(2)}</td>
                      <td className="border p-2 text-right font-medium">{item.amount.toFixed(2)}</td>
                      <td className="border p-2 text-center">
                        <div className="flex gap-1 justify-center">
                          {editingItemId === item.id ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => setEditingItemId(null)}
                              className="bg-green-600 hover:bg-green-700 text-white"
                            >
                              Save
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => setEditingItemId(item.id)}
                              className="bg-blue-600 hover:bg-blue-700 text-white"
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteItem(item.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary Section */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 bg-gray-50 p-4 rounded-lg border">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Total Amount:</span>
              <span>{totalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-medium">Total Tax:</span>
              <span>{totalTax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base border-t-2 pt-2 mt-2">
              <span className="font-bold">Net Amount:</span>
              <span className="font-bold text-lg">{netAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button
            type="submit"
            className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 text-lg"
          >
            Generate PO
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AddPurchaseOrder;
