import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PurchaseOrderService, PurchaseOrder } from '@/lib/purchase-order-service';
import { SupplierService, Supplier } from '@/lib/supplier-service';
import { GRNService } from '@/lib/grn-service';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Package, CheckCircle, AlertCircle } from 'lucide-react';

interface EditPurchaseOrderProps {
  purchaseOrderId: string;
  onBack?: () => void;
}

interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  medicine_id?: string;
  product_name: string;
  manufacturer: string;
  pack: string;
  pieces_per_pack?: number;
  batch_no: string;
  expiry_date?: string;
  mrp: number;
  sale_price: number;
  purchase_price: number;
  tax_percentage: number;
  tax_amount: number;
  order_quantity: number;
  received_quantity?: number;
  free_quantity?: number;
  amount: number;
  gst?: number;
  sgst?: number;
  cgst?: number;
  gst_amount?: number;
}

const EditPurchaseOrder: React.FC<EditPurchaseOrderProps> = ({ purchaseOrderId, onBack }) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPosting, setIsPosting] = useState(false);

  // PO Header Data
  const [poData, setPoData] = useState<PurchaseOrder | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // PO Items Data
  const [items, setItems] = useState<PurchaseOrderItem[]>([]);

  // GRN State
  const [grnId, setGrnId] = useState<string | null>(null);
  const [grnStatus, setGrnStatus] = useState<'DRAFT' | 'POSTED' | null>(null);
  const [grnNumber, setGrnNumber] = useState<string | null>(null);

  // Form state
  const [partyInvoiceNumber, setPartyInvoiceNumber] = useState('');
  const [paymentTerms, setPaymentTerms] = useState<'CREDIT' | 'CASH'>('CREDIT');
  const [goodsReceivedDate, setGoodsReceivedDate] = useState('');
  const [discount, setDiscount] = useState<number>(0);
  const [manualTotalTax, setManualTotalTax] = useState<number | null>(null);

  useEffect(() => {
    fetchPurchaseOrder();
  }, [purchaseOrderId]);

  const fetchPurchaseOrder = async () => {
    try {
      setIsLoading(true);

      // Fetch PO header, items, and suppliers in parallel
      const [poHeader, poItems, suppliersData] = await Promise.all([
        PurchaseOrderService.getById(purchaseOrderId),
        PurchaseOrderService.getPurchaseOrderItems(purchaseOrderId),
        SupplierService.getAll(),
      ]);

      setPoData(poHeader);
      setSuppliers(suppliersData);

      // Check if a GRN already exists for this PO (DRAFT or POSTED)
      const grnList = await GRNService.listGRNs();
      const existingGRN = grnList.find(
        grn => grn.purchase_order_id === purchaseOrderId
      );

      if (existingGRN) {
        // Load data from existing GRN

        const grnDetails = await GRNService.getGRNDetails(existingGRN.id);

        // Store GRN details
        setGrnId(existingGRN.id);
        setGrnStatus(existingGRN.status as 'DRAFT' | 'POSTED');
        setGrnNumber(existingGRN.grn_number);
        setPartyInvoiceNumber(existingGRN.invoice_number || '');
        setPaymentTerms(
          String((existingGRN as any).payment_terms || 'CREDIT').toUpperCase() === 'CASH'
            ? 'CASH'
            : 'CREDIT',
        );
        setDiscount(existingGRN.discount || 0);

        // Map GRN items to PO item format
        const grnItemsMapped = grnDetails.grn_items.map(grnItem => ({
          id: grnItem.purchase_order_item_id || grnItem.id,
          purchase_order_id: purchaseOrderId,
          medicine_id: grnItem.medicine_id,
          product_name: grnItem.product_name,
          manufacturer: grnItem.manufacturer || '',
          pack: grnItem.pack || '',
          pieces_per_pack: grnItem.pieces_per_pack || 0,
          batch_no: grnItem.batch_number,
          expiry_date: grnItem.expiry_date,
          mrp: grnItem.mrp,
          sale_price: grnItem.sale_price,
          purchase_price: grnItem.purchase_price,
          tax_percentage: grnItem.gst || 0,
          tax_amount: grnItem.tax_amount || 0,
          order_quantity: grnItem.ordered_quantity,
          received_quantity: grnItem.received_quantity,
          free_quantity: grnItem.free_quantity || 0,
          amount: grnItem.amount || 0,
          gst: grnItem.gst,
          sgst: grnItem.sgst,
          cgst: grnItem.cgst,
          gst_amount: grnItem.gst_amount,
        }));

        setItems(grnItemsMapped);

        if (existingGRN.status === 'POSTED') {
          toast({
            title: 'GRN Already Posted',
            description: `${existingGRN.grn_number} has been posted to inventory. Editing is locked.`,
            variant: 'default',
          });
        } else {
          toast({
            title: 'Draft Loaded',
            description: `Loaded existing draft: ${existingGRN.grn_number}`,
          });
        }
      } else {
        // No GRN exists, load fresh PO data
        setItems(poItems);
        setDiscount(poHeader.discount || 0);
      }

      // Set current date for goods received date (format: YYYY-MM-DDTHH:MM for datetime-local input)
      const now = new Date();
      const formattedDate = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}T${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setGoodsReceivedDate(formattedDate);
    } catch (error) {
      console.error('Error fetching purchase order:', error);
      toast({
        title: 'Error',
        description: 'Failed to load purchase order',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const updatedItems = [...items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value,
    };

    // Clear manual total tax when user edits item-level tax
    if (field === 'tax_percentage') {
      setManualTotalTax(null);
    }

    // Recalculate amounts if quantity or price changes
    if (['order_quantity', 'received_quantity', 'purchase_price', 'tax_percentage', 'mrp', 'sale_price'].includes(field)) {
      const item = updatedItems[index];
      const qty = item.received_quantity || item.order_quantity || 0;
      const price = item.purchase_price || 0;
      const taxPercent = item.tax_percentage || 0;

      // Calculate tax amount
      const taxAmount = (qty * price * taxPercent) / 100;

      updatedItems[index] = {
        ...updatedItems[index],
        gst: taxPercent,
        sgst: taxPercent / 2,
        cgst: taxPercent / 2,
        gst_amount: taxAmount,
        tax_amount: taxAmount,
        amount: qty * price + taxAmount,
      };
    }

    setItems(updatedItems);
  };

  // UPDATE button handler - Creates/Updates GRN draft (NO inventory change)
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!poData) {
      toast({
        title: 'Error',
        description: 'Purchase order data not loaded',
        variant: 'destructive',
      });
      return;
    }

    // Prevent updating if GRN is already POSTED
    if (grnStatus === 'POSTED') {
      toast({
        title: 'Cannot Update',
        description: 'This GRN has already been posted to inventory and cannot be modified',
        variant: 'destructive',
      });
      return;
    }

    // Validate required fields
    const hasEmptyRequiredFields = items.some(item =>
      !item.batch_no ||
      !item.expiry_date ||
      !item.mrp ||
      item.mrp <= 0 ||
      !item.purchase_price ||
      item.purchase_price <= 0 ||
      !item.sale_price ||
      item.sale_price <= 0
    );

    if (hasEmptyRequiredFields) {
      toast({
        title: 'Validation Error',
        description: 'Please fill all mandatory fields (Batch No., Expiry Date, MRP, Purchase Price, Sale Price)',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsSaving(true);
      const { supabaseClient } = await import('@/utils/supabase-client');

      // Prepare GRN items data
      const grnItemsData = items.map(item => ({
        purchase_order_item_id: item.id,
        medicine_id: item.medicine_id || null,
        product_name: item.product_name,
        manufacturer: item.manufacturer,
        pack: item.pack,
        pieces_per_pack: item.pieces_per_pack || 0,
        batch_number: item.batch_no,
        expiry_date: item.expiry_date || '',
        manufacturing_date: null,
        ordered_quantity: item.order_quantity,
        received_quantity: item.received_quantity || item.order_quantity,
        accepted_quantity: item.received_quantity || item.order_quantity,
        rejected_quantity: 0,
        free_quantity: item.free_quantity || 0,
        purchase_price: item.purchase_price,
        sale_price: item.sale_price,
        mrp: item.mrp,
        gst: item.gst || item.tax_percentage || 0,
        sgst: item.sgst || (item.tax_percentage || 0) / 2,
        cgst: item.cgst || (item.tax_percentage || 0) / 2,
        tax_amount: item.tax_amount || 0,
        amount: item.amount || (item.purchase_price * (item.received_quantity || item.order_quantity)),
        rack_number: '',
        shelf_location: '',
      }));

      // Calculate totals for GRN header
      const totalTax = manualTotalTax !== null ? manualTotalTax : totals.totalTax;
      const totalAmount = totals.subtotal + totalTax;

      // SAFETY CHECK: Query DB directly to find existing GRN for this PO
      // This ensures we update even if state was not loaded properly
      let existingGrnId = grnId;
      let existingGrnNumber = grnNumber;
      let existingGrnStatus = grnStatus;

      if (!existingGrnId) {

        // First, try to find by purchase_order_id
        let { data: existingGrn, error: queryError } = await supabaseClient
          .from('goods_received_notes')
          .select('id, grn_number, status, purchase_order_id')
          .eq('purchase_order_id', purchaseOrderId)
          .maybeSingle();

        if (queryError) {
          console.error('Error querying for existing GRN:', queryError);
        }


        // If not found by PO ID, look for orphaned DRAFT GRNs (with null purchase_order_id)
        if (!existingGrn) {
          const { data: draftGrns } = await supabaseClient
            .from('goods_received_notes')
            .select('id, grn_number, status, purchase_order_id')
            .eq('status', 'DRAFT')
            .order('created_at', { ascending: false })
            .limit(5);


          // Find orphaned GRN (null purchase_order_id)
          if (draftGrns && draftGrns.length > 0) {
            const orphanedGrn = draftGrns.find(g => !g.purchase_order_id);
            if (orphanedGrn) {
              // Link it to this PO
              await supabaseClient
                .from('goods_received_notes')
                .update({ purchase_order_id: purchaseOrderId })
                .eq('id', orphanedGrn.id);
              existingGrn = orphanedGrn;
            }
          }
        }

        if (existingGrn) {
          existingGrnId = existingGrn.id;
          existingGrnNumber = existingGrn.grn_number;
          existingGrnStatus = existingGrn.status as 'DRAFT' | 'POSTED';

          // Update state so next time we don't need to query
          setGrnId(existingGrn.id);
          setGrnNumber(existingGrn.grn_number);
          setGrnStatus(existingGrn.status as 'DRAFT' | 'POSTED');
        }
      }

      if (existingGrnId && existingGrnStatus === 'DRAFT') {
        // UPDATE existing GRN

        // Update GRN header
        const { error: updateError } = await supabaseClient
          .from('goods_received_notes')
          .update({
            invoice_number: partyInvoiceNumber || null,
            payment_terms: paymentTerms,
            discount: discount || 0,
            total_amount: totalAmount,
          })
          .eq('id', existingGrnId);

        if (updateError) {
          console.error('Error updating GRN:', updateError);
          throw new Error('Failed to update GRN header');
        }

        // Delete old GRN items
        const { error: deleteItemsError } = await supabaseClient
          .from('grn_items')
          .delete()
          .eq('grn_id', existingGrnId);

        if (deleteItemsError) {
          console.error('Error deleting old GRN items:', deleteItemsError);
        }

        // Insert updated GRN items
        const itemsToInsert = grnItemsData.map(item => ({
          ...item,
          grn_id: existingGrnId,
        }));

        const { error: insertItemsError } = await supabaseClient
          .from('grn_items')
          .insert(itemsToInsert);

        if (insertItemsError) {
          console.error('Error inserting GRN items:', insertItemsError);
          throw new Error('Failed to save GRN items');
        }

        toast({
          title: 'Draft Updated',
          description: `GRN ${existingGrnNumber} updated successfully. Click Submit to add inventory.`,
        });
      } else if (existingGrnId && existingGrnStatus === 'POSTED') {
        // GRN already posted - cannot modify
        throw new Error('This GRN has already been posted to inventory and cannot be modified');
      } else {
        // CREATE new GRN (first time - no GRN exists for this PO)
        const grnPayload = {
          purchase_order_id: purchaseOrderId,
          grn_date: goodsReceivedDate.split('T')[0],
          invoice_number: partyInvoiceNumber || undefined,
          payment_terms: paymentTerms,
          invoice_date: undefined,
          invoice_amount: undefined,
          discount: discount || undefined,
          total_tax: manualTotalTax !== null ? manualTotalTax : undefined,
          notes: undefined,
          hospital_name: 'hope HMIS',
          items: grnItemsData,
        };

        const result = await GRNService.createGRNFromPO(grnPayload);

        // Save GRN details to state
        setGrnId(result.grn.id);
        setGrnStatus('DRAFT');
        setGrnNumber(result.grn.grn_number);

        toast({
          title: 'Draft Saved',
          description: `GRN ${result.grn.grn_number} saved as draft. Click Submit to add inventory.`,
        });
      }
    } catch (error: any) {
      console.error('Error saving GRN draft:', error);
      const errorMessage = error?.message || error?.details || JSON.stringify(error);
      toast({
        title: 'Error',
        description: `Failed to save GRN draft: ${errorMessage}`,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // SUBMIT button handler - Posts GRN and adds to inventory
  const handlePostGRN = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!grnId) {
      toast({
        title: 'Error',
        description: 'Please click UPDATE button first to save draft',
        variant: 'destructive',
      });
      return;
    }

    if (grnStatus === 'POSTED') {
      toast({
        title: 'Already Posted',
        description: 'This GRN has already been posted to inventory',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsPosting(true);

      // Post GRN - this adds to inventory
      const result = await GRNService.postGRN(grnId, undefined, discount || undefined);

      setGrnStatus('POSTED');

      toast({
        title: 'Success!',
        description: `GRN ${result.grn.grn_number} posted successfully. ${result.batch_inventories.length} batches added to inventory.`,
      });

      // Navigate back after delay
      setTimeout(() => {
        if (onBack) {
          onBack();
        }
      }, 2000);
    } catch (error: any) {
      console.error('Error posting GRN:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to post GRN',
        variant: 'destructive',
      });
    } finally {
      setIsPosting(false);
    }
  };

  // Calculate totals
  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + (item.purchase_price * (item.received_quantity || item.order_quantity)), 0);

    // Use manual total tax if set, otherwise calculate from individual items
    const calculatedTax = items.reduce((sum, item) => {
      const taxPercent = item.tax_percentage || item.gst || 0;
      return sum + ((taxPercent * (item.received_quantity || item.order_quantity) * item.purchase_price) / 100);
    }, 0);
    const totalTax = manualTotalTax !== null ? manualTotalTax : calculatedTax;

    const totalAmount = subtotal + totalTax;
    const netAmount = totalAmount - discount;

    return {
      subtotal,
      discount,
      totalTax,
      totalAmount,
      netAmount,
    };
  };

  const totals = calculateTotals();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-2">Loading purchase order...</span>
      </div>
    );
  }

  if (!poData) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600">Purchase order not found</p>
        <Button onClick={onBack} className="mt-4">Back to List</Button>
      </div>
    );
  }

  const supplier = suppliers.find(s => s.id === poData.supplier_id);

  return (
    <div className="space-y-6 bg-gray-50 p-6 rounded-lg w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package className="h-8 w-8 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Goods Received Note</h2>
            <p className="text-sm text-gray-500">Edit and update purchase order details</p>
          </div>
        </div>
        <Button
          variant="outline"
          className="border-gray-300 hover:bg-gray-100"
          onClick={onBack}
        >
          Back
        </Button>
      </div>

      <form className="space-y-6">
        {/* Search Filters Card */}
        <Card className="shadow-md border-gray-200">
          <CardContent className="p-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium text-gray-700 mb-2 block">From</label>
                <Input type="date" className="border-gray-300" />
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium text-gray-700 mb-2 block">To</label>
                <Input type="date" className="border-gray-300" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Supplier</label>
                <Input type="text" placeholder="Search supplier..." className="border-gray-300" />
              </div>
              <div className="w-32">
                <label className="text-sm font-medium text-gray-700 mb-2 block">Location</label>
                <select className="w-full border border-gray-300 rounded-md px-3 py-2 bg-white">
                  <option>All</option>
                </select>
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="text-sm font-medium text-gray-700 mb-2 block">GRN No</label>
                <Input type="text" placeholder="Search GRN..." className="border-gray-300" />
              </div>
              <Button type="button" className="bg-blue-500 hover:bg-blue-600 text-white shadow-sm">
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* PO Info Card */}
        <Card className="shadow-md border-gray-200">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
                <div className="h-10 w-1 bg-blue-600 rounded-full"></div>
                <h3 className="text-lg font-semibold text-gray-800">Purchase Order Details</h3>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">PO Number:</span>
                    <Badge variant="outline" className="font-mono text-blue-600 border-blue-300">
                      {poData.po_number}
                    </Badge>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-600">Order For:</span>
                    <span className="ml-2 font-medium text-gray-900">{poData.order_for}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="text-gray-600">Supplier:</span>
                    <span className="ml-2 font-medium text-gray-900">{supplier?.supplier_name || 'N/A'}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-600">Created:</span>
                    <span className="ml-2 font-medium text-gray-900">
                      {poData.created_at ? new Date(poData.created_at).toLocaleString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-3 border-t border-gray-200">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Party Invoice Number
                  </label>
                  <Input
                    type="text"
                    placeholder="Enter invoice number..."
                    className="border-gray-300"
                    value={partyInvoiceNumber}
                    onChange={(e) => setPartyInvoiceNumber(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Payment Terms
                  </label>
                  <select
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    value={paymentTerms}
                    onChange={(e) =>
                      setPaymentTerms(e.target.value === 'CASH' ? 'CASH' : 'CREDIT')
                    }
                  >
                    <option value="CREDIT">Credit - supplier is owed</option>
                    <option value="CASH">Cash - paid at the counter</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {paymentTerms === 'CASH'
                      ? 'The purchase posts and the supplier is settled from Cash in Hand.'
                      : 'The purchase posts and stays outstanding against the supplier.'}
                  </p>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Goods Received Date
                  </label>
                  <Input
                    type="datetime-local"
                    className="border-gray-300"
                    value={goodsReceivedDate}
                    onChange={(e) => setGoodsReceivedDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Items Table Card */}
        <Card className="shadow-md border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Product Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Manufacturer</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Pack</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Pieces/Pack</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                      Batch No<span className="text-red-500">*</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                      Expiry Date<span className="text-red-500">*</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                      MRP<span className="text-red-500">*</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                      Pur. Price<span className="text-red-500">*</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                      Sale Price<span className="text-red-500">*</span>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Tax (%)</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Tax Amt.</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Qty. Ord</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Qty. Rcvd</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Free</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Amount</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {items.map((item, index) => (
                    <tr key={item.id} className="hover:bg-blue-50/30 transition-colors">
                      <td className="px-4 py-2 text-center text-gray-700">{index + 1}</td>
                      <td className="px-4 py-2">
                        <div className="text-xs font-medium text-gray-900">{item.product_name}</div>
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">{item.manufacturer}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{item.pack}</td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          min="0"
                          className="w-16 h-8 px-2 text-xs text-center border-gray-300"
                          value={item.pieces_per_pack || ''}
                          onChange={(e) => handleItemChange(index, 'pieces_per_pack', parseInt(e.target.value) || 0)}
                          placeholder="e.g., 10"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="text"
                          required
                          className={`w-24 h-8 px-2 text-xs ${!item.batch_no ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                          value={item.batch_no}
                          onChange={(e) => handleItemChange(index, 'batch_no', e.target.value)}
                          placeholder="Required"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="date"
                          required
                          className={`w-32 h-8 px-2 text-xs ${!item.expiry_date ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                          value={item.expiry_date ? item.expiry_date.split('T')[0] : ''}
                          onChange={(e) => handleItemChange(index, 'expiry_date', e.target.value)}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          required
                          min="0.01"
                          className={`w-20 h-8 px-2 text-xs text-right ${item.mrp <= 0 ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                          value={item.mrp}
                          onChange={(e) => handleItemChange(index, 'mrp', parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          required
                          min="0.01"
                          className={`w-20 h-8 px-2 text-xs text-right ${item.purchase_price <= 0 ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                          value={item.purchase_price}
                          onChange={(e) => handleItemChange(index, 'purchase_price', parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          required
                          min="0.01"
                          className={`w-20 h-8 px-2 text-xs text-right ${item.sale_price <= 0 ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}`}
                          value={item.sale_price}
                          onChange={(e) => handleItemChange(index, 'sale_price', parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-16 h-8 px-2 text-xs text-right border-gray-300"
                          value={item.tax_percentage || item.gst || 0}
                          onChange={(e) => handleItemChange(index, 'tax_percentage', parseFloat(e.target.value) || 0)}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-gray-700 font-medium">
                        {(item.tax_amount || item.gst_amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-center text-xs text-gray-700">{item.order_quantity}</td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          min="0"
                          className="w-16 h-8 px-2 text-xs text-center border-gray-300"
                          value={item.received_quantity || item.order_quantity}
                          onChange={(e) => handleItemChange(index, 'received_quantity', parseInt(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          min="0"
                          className="w-16 h-8 px-2 text-xs text-center border-gray-300"
                          value={item.free_quantity || 0}
                          onChange={(e) => handleItemChange(index, 'free_quantity', parseInt(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-xs font-semibold text-gray-900">
                        ₹{item.amount?.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Totals Card */}
        <div className="flex justify-end">
          <Card className="w-96 shadow-md border-gray-200">
            <CardContent className="p-0">
              <div className="divide-y divide-gray-200">
                <div className="flex justify-between px-4 py-3 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">Subtotal</span>
                  <span className="text-sm font-semibold text-gray-900">₹{totals.subtotal.toFixed(2)}</span>
                </div>

                <div className="flex justify-between px-4 py-3 bg-white">
                  <span className="text-sm font-medium text-gray-700">Discount</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-24 h-8 px-2 text-right text-sm border-gray-300"
                    value={discount}
                    onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="flex justify-between px-4 py-3 bg-white">
                  <span className="text-sm font-medium text-gray-700">Total Tax</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="w-24 h-8 px-2 text-right text-sm border-gray-300"
                    value={manualTotalTax !== null ? manualTotalTax : totals.totalTax.toFixed(2)}
                    onChange={(e) => setManualTotalTax(parseFloat(e.target.value) || 0)}
                  />
                </div>

                <div className="flex justify-between px-4 py-3 bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">Total Amount</span>
                  <span className="text-sm font-semibold text-gray-900">₹{totals.totalAmount.toFixed(2)}</span>
                </div>

                <div className="flex justify-between px-4 py-4 bg-gradient-to-r from-blue-50 to-indigo-50">
                  <span className="text-base font-bold text-gray-800">Net Amount</span>
                  <span className="text-base font-bold text-blue-600">₹{totals.netAmount.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* GRN Status Indicator */}
        {grnStatus && (
          <div className={`p-4 rounded-lg border-2 flex items-center justify-between ${
            grnStatus === 'DRAFT'
              ? 'bg-blue-50 border-blue-300'
              : 'bg-green-50 border-green-300'
          }`}>
            <div className="flex items-center gap-3">
              {grnStatus === 'DRAFT' ? (
                <AlertCircle className="h-6 w-6 text-blue-600" />
              ) : (
                <CheckCircle className="h-6 w-6 text-green-600" />
              )}
              <div>
                <p className="text-sm font-semibold text-gray-800">GRN Status</p>
                <p className={`text-lg font-bold ${
                  grnStatus === 'DRAFT' ? 'text-blue-600' : 'text-green-600'
                }`}>
                  {grnStatus} {grnNumber && `- ${grnNumber}`}
                </p>
              </div>
            </div>
            {grnStatus === 'DRAFT' && (
              <p className="text-sm text-blue-700">
                ⚠️ Draft saved. Click <strong>Submit</strong> to add inventory.
              </p>
            )}
            {grnStatus === 'POSTED' && (
              <p className="text-sm text-green-700">
                ✅ Inventory has been updated successfully.
              </p>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-4 mt-6">
          <Button
            type="button"
            disabled={isSaving || isPosting || grnStatus === 'POSTED'}
            variant="outline"
            className="border-gray-300 hover:bg-gray-100 px-8 py-3 text-base"
            onClick={handleUpdate}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Saving Draft...
              </>
            ) : (
              'Update'
            )}
          </Button>
          <Button
            type="button"
            disabled={!grnId || isPosting || isSaving || grnStatus === 'POSTED'}
            onClick={handlePostGRN}
            className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-10 py-3 text-base shadow-md hover:shadow-lg transition-all"
          >
            {isPosting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Posting to Inventory...
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-5 w-5" />
                Submit & Add to Inventory
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default EditPurchaseOrder;
