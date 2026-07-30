// Create Goods Received Note (GRN) Component
// Allows creating GRN from Purchase Orders with batch details

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabaseClient } from '@/lib/supabase';
import { GRNService } from '@/lib/grn-service';
import type { PurchaseOrder, CreateGRNItemPayload } from '@/types/pharmacy';
import { Loader2, Package, AlertCircle, CheckCircle } from 'lucide-react';

interface GRNItemRow extends CreateGRNItemPayload {
  product_name: string;
  manufacturer?: string;
  pack?: string;
  order_quantity: number;
  balance_quantity: number;
}

const CreateGRN: React.FC = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  // Purchase Orders
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedPO, setSelectedPO] = useState<string>('');
  const [poDetails, setPoDetails] = useState<PurchaseOrder | null>(null);

  // GRN Header
  const [grnId, setGrnId] = useState<string | null>(null);
  const [grnStatus, setGrnStatus] = useState<'DRAFT' | 'POSTED' | null>(null);
  const [grnDate, setGrnDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>('');
  const [invoiceAmount, setInvoiceAmount] = useState<string>('');
  const [discount, setDiscount] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // GRN Items
  const [grnItems, setGrnItems] = useState<GRNItemRow[]>([]);

  // Load pending purchase orders
  useEffect(() => {
    loadPurchaseOrders();
  }, []);

  const loadPurchaseOrders = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabaseClient
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(*)
        `)
        .in('status', ['APPROVED', 'ORDERED', 'PARTIAL_RECEIVED'])
        .order('order_date', { ascending: false });

      if (error) throw error;
      setPurchaseOrders(data || []);
    } catch (error) {
      console.error('Error loading purchase orders:', error);
      toast({
        title: 'Error',
        description: 'Failed to load purchase orders',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadPODetails = async (poId: string) => {
    try {
      setIsLoading(true);

      const { data: po, error: poError } = await supabaseClient
        .from('purchase_orders')
        .select(`
          *,
          supplier:suppliers(*),
          purchase_order_items(*)
        `)
        .eq('id', poId)
        .single();

      if (poError) throw poError;

      setPoDetails(po);

      // Initialize GRN items from PO items
      const items: GRNItemRow[] = (po.purchase_order_items || []).map((item: any) => {
        const balance = item.order_quantity - (item.received_quantity || 0);
        return {
          purchase_order_item_id: item.id,
          medicine_id: item.medicine_id,
          product_name: item.product_name,
          manufacturer: item.manufacturer,
          pack: item.pack,
          batch_number: '',
          pieces_per_pack: 0,
          expiry_date: '',
          manufacturing_date: '',
          ordered_quantity: item.order_quantity,
          order_quantity: item.order_quantity,
          received_quantity: 0,
          balance_quantity: balance,
          rejected_quantity: 0,
          free_quantity: 0,
          purchase_price: item.purchase_price || 0,
          sale_price: item.sale_price || 0,
          mrp: item.mrp || 0,
          gst: item.gst || 0,
          sgst: item.sgst || 0,
          cgst: item.cgst || 0,
          rack_number: '',
          shelf_location: '',
        };
      });

      setGrnItems(items);
    } catch (error) {
      console.error('Error loading PO details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load purchase order details',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePOChange = (poId: string) => {
    setSelectedPO(poId);
    if (poId) {
      loadPODetails(poId);
    } else {
      setPoDetails(null);
      setGrnItems([]);
    }
  };

  const updateGRNItem = (index: number, field: keyof GRNItemRow, value: any) => {
    const newItems = [...grnItems];
    newItems[index] = { ...newItems[index], [field]: value };

    // Auto-calculate accepted quantity
    if (field === 'received_quantity' || field === 'rejected_quantity') {
      const received = field === 'received_quantity' ? Number(value) : newItems[index].received_quantity;
      const rejected = field === 'rejected_quantity' ? Number(value) : newItems[index].rejected_quantity;
      newItems[index].accepted_quantity = received - rejected;
    }

    setGrnItems(newItems);
  };

  const calculateTotals = () => {
    const totalOrdered = grnItems.reduce((sum, item) => sum + item.ordered_quantity, 0);
    const totalReceived = grnItems.reduce((sum, item) => sum + item.received_quantity, 0);
    const totalAmount = grnItems.reduce((sum, item) => {
      const itemAmount = item.received_quantity * item.purchase_price;
      const taxAmount = ((item.gst || 0) * itemAmount) / 100;
      return sum + itemAmount + taxAmount;
    }, 0);

    return { totalOrdered, totalReceived, totalAmount };
  };

  const validateGRN = (): boolean => {
    if (!selectedPO) {
      toast({
        title: 'Validation Error',
        description: 'Please select a purchase order',
        variant: 'destructive',
      });
      return false;
    }

    if (!grnDate) {
      toast({
        title: 'Validation Error',
        description: 'Please enter GRN date',
        variant: 'destructive',
      });
      return false;
    }

    // Check if at least one item has received quantity
    const hasReceivedItems = grnItems.some(item => item.received_quantity > 0);
    if (!hasReceivedItems) {
      toast({
        title: 'Validation Error',
        description: 'Please enter received quantity for at least one item',
        variant: 'destructive',
      });
      return false;
    }

    // Validate each item with received quantity
    for (const item of grnItems) {
      if (item.received_quantity > 0) {
        if (!item.batch_number) {
          toast({
            title: 'Validation Error',
            description: `Please enter batch number for ${item.product_name}`,
            variant: 'destructive',
          });
          return false;
        }

        if (!item.expiry_date) {
          toast({
            title: 'Validation Error',
            description: `Please enter expiry date for ${item.product_name}`,
            variant: 'destructive',
          });
          return false;
        }

        // Check if expiry date is in the future
        if (new Date(item.expiry_date) <= new Date()) {
          toast({
            title: 'Validation Error',
            description: `Expiry date for ${item.product_name} must be in the future`,
            variant: 'destructive',
          });
          return false;
        }

        // Check if pieces_per_pack is provided
        if (!item.pieces_per_pack || item.pieces_per_pack <= 0) {
          toast({
            title: 'Validation Error',
            description: `Please enter pieces per pack for ${item.product_name}`,
            variant: 'destructive',
          });
          return false;
        }

        // Check if received quantity doesn't exceed balance
        if (item.received_quantity > item.balance_quantity) {
          toast({
            title: 'Validation Error',
            description: `Received quantity for ${item.product_name} exceeds balance quantity`,
            variant: 'destructive',
          });
          return false;
        }
      }
    }

    return true;
  };

  const handleSaveGRN = async () => {
    if (!validateGRN()) return;

    try {
      setIsSaving(true);

      // Filter items with received quantity
      const itemsToReceive = grnItems
        .filter(item => item.received_quantity > 0)
        .map(item => ({
          purchase_order_item_id: item.purchase_order_item_id,
          medicine_id: item.medicine_id,
          product_name: item.product_name,
          manufacturer: item.manufacturer,
          pack: item.pack,
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          manufacturing_date: item.manufacturing_date || undefined,
          ordered_quantity: item.ordered_quantity,
          received_quantity: item.received_quantity,
          rejected_quantity: item.rejected_quantity || 0,
          free_quantity: item.free_quantity || 0,
          purchase_price: item.purchase_price,
          sale_price: item.sale_price,
          mrp: item.mrp,
          gst: item.gst,
          sgst: item.sgst,
          cgst: item.cgst,
          rack_number: item.rack_number,
          shelf_location: item.shelf_location,
        }));

      const payload = {
        purchase_order_id: selectedPO,
        grn_date: grnDate,
        invoice_number: invoiceNumber || undefined,
        invoice_date: invoiceDate || undefined,
        invoice_amount: invoiceAmount ? parseFloat(invoiceAmount) : undefined,
        notes: notes || undefined,
        hospital_name: 'hope HMIS', // TODO: Get from context/session
        items: itemsToReceive,
      };

      const result = await GRNService.createGRNFromPO(payload);

      // Store GRN ID and status for Submit action
      setGrnId(result.grn.id);
      setGrnStatus('DRAFT');

      toast({
        title: 'Success',
        description: `GRN ${result.grn.grn_number} saved as draft. Click Submit to add inventory.`,
      });

    } catch (error) {
      console.error('Error creating GRN:', error);
      toast({
        title: 'Error',
        description: 'Failed to create GRN. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePostGRN = async () => {
    if (!grnId) {
      toast({
        title: 'Error',
        description: 'Please save GRN draft first',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsPosting(true);

      const discountValue = discount ? parseFloat(discount) : undefined;
      const result = await GRNService.postGRN(grnId, undefined, discountValue);

      toast({
        title: 'Approved',
        description: result.purchase_voucher
          ? `GRN ${result.grn.grn_number} approved. ${result.batch_inventories.length} batches added to inventory and purchase voucher ${result.purchase_voucher.voucher_number} posted to the day book.`
          : `GRN ${result.grn.grn_number} approved. ${result.batch_inventories.length} batches added to inventory, but no purchase voucher was raised — check the invoice amount and the supplier's ledger.`,
        variant: result.purchase_voucher ? 'default' : 'destructive',
      });

      // Reset form
      setSelectedPO('');
      setPoDetails(null);
      setGrnItems([]);
      setGrnId(null);
      setGrnStatus(null);
      setInvoiceNumber('');
      setInvoiceDate('');
      setInvoiceAmount('');
      setDiscount('');
      setNotes('');
      loadPurchaseOrders();
    } catch (error: any) {
      console.error('Error posting GRN:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to post GRN. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsPosting(false);
    }
  };

  const totals = calculateTotals();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Create Goods Received Note</h1>
          <p className="text-gray-600 mt-1">Receive items from purchase order and create batch inventory</p>
        </div>
        <Package className="w-12 h-12 text-blue-600" />
      </div>

      {/* GRN Header */}
      <Card>
        <CardHeader>
          <CardTitle>GRN Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Purchase Order Selection */}
            <div className="space-y-2">
              <Label htmlFor="po-select">Purchase Order *</Label>
              <Select value={selectedPO} onValueChange={handlePOChange} disabled={isLoading}>
                <SelectTrigger id="po-select">
                  <SelectValue placeholder="Select Purchase Order" />
                </SelectTrigger>
                <SelectContent>
                  {purchaseOrders.map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.po_number} - {po.supplier?.supplier_name} ({po.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* GRN Date */}
            <div className="space-y-2">
              <Label htmlFor="grn-date">GRN Date *</Label>
              <Input
                id="grn-date"
                type="date"
                value={grnDate}
                onChange={(e) => setGrnDate(e.target.value)}
              />
            </div>

            {/* Invoice Number */}
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Invoice Number</Label>
              <Input
                id="invoice-number"
                placeholder="Enter invoice number"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            {/* Invoice Date */}
            <div className="space-y-2">
              <Label htmlFor="invoice-date">Invoice Date</Label>
              <Input
                id="invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>

            {/* Invoice Amount */}
            <div className="space-y-2">
              <Label htmlFor="invoice-amount">Invoice Amount</Label>
              <Input
                id="invoice-amount"
                type="number"
                step="0.01"
                placeholder="Enter invoice amount"
                value={invoiceAmount}
                onChange={(e) => setInvoiceAmount(e.target.value)}
              />
            </div>

            {/* Discount */}
            <div className="space-y-2">
              <Label htmlFor="discount">Discount (₹)</Label>
              <Input
                id="discount"
                type="number"
                step="0.01"
                placeholder="Enter discount amount"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="font-semibold text-red-600"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <textarea
              id="notes"
              className="w-full min-h-[80px] px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Enter any additional notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* PO Summary */}
          {poDetails && (
            <div className="bg-blue-50 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-blue-900">Purchase Order Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">PO Number</p>
                  <p className="font-semibold">{poDetails.po_number}</p>
                </div>
                <div>
                  <p className="text-gray-600">Supplier</p>
                  <p className="font-semibold">{poDetails.supplier?.supplier_name}</p>
                </div>
                <div>
                  <p className="text-gray-600">Order Date</p>
                  <p className="font-semibold">
                    {new Date(poDetails.order_date).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Status</p>
                  <p className="font-semibold">{poDetails.status}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GRN Items */}
      {grnItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Items to Receive</CardTitle>
            <div className="flex gap-2 mt-2">
              <AlertCircle className="w-4 h-4 text-yellow-600" />
              <p className="text-sm text-gray-600">
                Enter batch number, expiry date, and received quantity for each item.
                You can partially receive items.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Product</TableHead>
                    <TableHead className="w-[80px]">Ordered</TableHead>
                    <TableHead className="w-[80px]">Balance</TableHead>
                    <TableHead className="w-[120px]">Batch No *</TableHead>
                    <TableHead className="w-[80px]">Pieces/Pack</TableHead>
                    <TableHead className="w-[120px]">Expiry Date *</TableHead>
                    <TableHead className="w-[80px]">Received *</TableHead>
                    <TableHead className="w-[80px]">Rejected</TableHead>
                    <TableHead className="w-[80px]">Free</TableHead>
                    <TableHead className="w-[100px]">Purchase Price</TableHead>
                    <TableHead className="w-[100px]">MRP</TableHead>
                    <TableHead className="w-[100px]">Rack/Shelf</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grnItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        <div>
                          <p className="font-semibold">{item.product_name}</p>
                          <p className="text-xs text-gray-500">{item.manufacturer}</p>
                          <p className="text-xs text-gray-500">{item.pack}</p>
                        </div>
                      </TableCell>
                      <TableCell>{item.ordered_quantity}</TableCell>
                      <TableCell className="font-semibold text-blue-600">
                        {item.balance_quantity}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          placeholder="Batch"
                          value={item.batch_number}
                          onChange={(e) => updateGRNItem(index, 'batch_number', e.target.value)}
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="1"
                          placeholder="e.g., 10"
                          value={item.pieces_per_pack || ''}
                          onChange={(e) => updateGRNItem(index, 'pieces_per_pack', Number(e.target.value))}
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={item.expiry_date}
                          onChange={(e) => updateGRNItem(index, 'expiry_date', e.target.value)}
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          max={item.balance_quantity}
                          value={item.received_quantity || ''}
                          onChange={(e) =>
                            updateGRNItem(index, 'received_quantity', Number(e.target.value))
                          }
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={item.rejected_quantity || ''}
                          onChange={(e) =>
                            updateGRNItem(index, 'rejected_quantity', Number(e.target.value))
                          }
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          value={item.free_quantity || ''}
                          onChange={(e) =>
                            updateGRNItem(index, 'free_quantity', Number(e.target.value))
                          }
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.purchase_price}
                          onChange={(e) =>
                            updateGRNItem(index, 'purchase_price', parseFloat(e.target.value))
                          }
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.mrp}
                          onChange={(e) => updateGRNItem(index, 'mrp', parseFloat(e.target.value))}
                          className="w-full"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          placeholder="A1/S1"
                          value={item.rack_number || ''}
                          onChange={(e) => updateGRNItem(index, 'rack_number', e.target.value)}
                          className="w-full"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Totals */}
            <div className="mt-6 bg-gray-50 p-4 rounded-lg">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-gray-600">Total Ordered</p>
                  <p className="text-2xl font-bold text-gray-900">{totals.totalOrdered}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Received</p>
                  <p className="text-2xl font-bold text-blue-600">{totals.totalReceived}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-green-600">
                    ₹{totals.totalAmount.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            {/* GRN Status Indicator */}
            {grnStatus && (
              <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">GRN Status</p>
                    <p className="text-lg font-bold text-blue-600">{grnStatus}</p>
                  </div>
                  <Package className="h-8 w-8 text-blue-600" />
                </div>
                {grnStatus === 'DRAFT' && (
                  <p className="text-sm text-blue-700 mt-2">
                    ⚠️ GRN saved as draft. Click <strong>Submit</strong> to add inventory.
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-4 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedPO('');
                  setPoDetails(null);
                  setGrnItems([]);
                  setGrnId(null);
                  setGrnStatus(null);
                  setDiscount('');
                }}
                disabled={isSaving || isPosting}
              >
                Cancel
              </Button>

              {/* Update/Save Draft Button */}
              <Button
                onClick={handleSaveGRN}
                disabled={isSaving || isPosting || grnStatus === 'POSTED'}
                className="min-w-[150px]"
                variant={grnId ? "outline" : "default"}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  grnId ? 'Update Draft' : 'Save Draft'
                )}
              </Button>

              {/* Submit Button (only enabled after draft is saved) */}
              <Button
                onClick={handlePostGRN}
                disabled={!grnId || isPosting || isSaving || grnStatus === 'POSTED'}
                className="min-w-[150px] bg-green-600 hover:bg-green-700"
              >
                {isPosting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Approve & Post Purchase Voucher
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && grnItems.length === 0 && selectedPO && (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <span className="ml-3 text-gray-600">Loading purchase order details...</span>
        </div>
      )}
    </div>
  );
};

export default CreateGRN;
