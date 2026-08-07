// Purchase Orders Component
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  FileText, Plus, Loader2, Eye, Edit, Trash2, Search, Lock, X,
  QrCode, Upload, Camera, Banknote, CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PurchaseOrderService, PurchaseOrder } from '@/lib/purchase-order-service';
import { SupplierService, Supplier } from '@/lib/supplier-service';
import { GRNService } from '@/lib/grn-service';
import { GoodsReceivedNote } from '@/types/pharmacy';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  VENDOR_PAYMENT_MODES,
  fetchVendorQr,
  saveVendorQr,
  payGrnBill,
  saveGrnPaymentProof,
  fetchSupplierLedgerId,
  type VendorPaymentMode,
} from '@/lib/pharmacy/vendorPayments';

interface PurchaseOrdersProps {
  onAddClick?: () => void;
  onEditClick?: (orderId: string) => void;
}

interface PurchaseOrderWithSupplier extends PurchaseOrder {
  supplier_name?: string;
}

interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  medicine_id?: string;
  product_name: string;
  manufacturer: string;
  pack: string;
  batch_no: string;
  expiry_date?: string;
  mrp: number;
  sale_price: number;
  purchase_price: number;
  tax_percentage: number;
  tax_amount: number;
  order_quantity: number;
  received_quantity?: number;
  amount: number;
  gst?: number;
  sgst?: number;
  cgst?: number;
  gst_amount?: number;
}

const PurchaseOrders: React.FC<PurchaseOrdersProps> = ({ onAddClick, onEditClick }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // State
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<PurchaseOrderWithSupplier[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [postedGRNs, setPostedGRNs] = useState<Set<string>>(new Set()); // Track POs with POSTED GRNs
  const [grnDatesMap, setGrnDatesMap] = useState<Map<string, string>>(new Map()); // Track GRN dates by PO ID
  // The GRN behind each PO, so its bill can be paid from this row.
  const [grnByPo, setGrnByPo] = useState<Map<string, any>>(new Map());
  const [payingGrn, setPayingGrn] = useState<any | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMode, setPayMode] = useState<VendorPaymentMode>('CASH');
  const [payReference, setPayReference] = useState('');
  const [vendorQr, setVendorQr] = useState<string | null>(null);
  const [vendorLedgerId, setVendorLedgerId] = useState<string | null>(null);
  const [payProof, setPayProof] = useState<File | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const payProofInput = React.useRef<HTMLInputElement>(null);
  const payCameraInput = React.useRef<HTMLInputElement>(null);
  const vendorQrInput = React.useRef<HTMLInputElement>(null);

  // View modal state
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithSupplier | null>(null);
  const [selectedPOItems, setSelectedPOItems] = useState<PurchaseOrderItem[]>([]);
  const [selectedGRN, setSelectedGRN] = useState<GoodsReceivedNote | null>(null);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  // Filter state
  const [supplierSearch, setSupplierSearch] = useState('');
  const [poSearch, setPoSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // Pagination
  const [page, setPage] = useState(1);
  const itemsPerPage = 13;

  // Fetch data on component mount
  useEffect(() => {
    fetchData();
  }, []);

  // Apply filters whenever search terms or data changes
  useEffect(() => {
    applyFilters();
  }, [purchaseOrders, supplierSearch, poSearch, statusFilter]);

  const fetchData = async () => {
    try {
      setIsLoading(true);

      // Fetch purchase orders, suppliers, and GRNs in parallel
      const [ordersData, suppliersData, grnsData] = await Promise.all([
        PurchaseOrderService.getAll(),
        SupplierService.getAll(),
        GRNService.listGRNs(), // Fetch all GRNs
      ]);

      // Map supplier names to purchase orders
      const ordersWithSuppliers = ordersData.map(order => {
        const supplier = suppliersData.find(s => s.id === order.supplier_id);
        return {
          ...order,
          supplier_name: supplier?.supplier_name || 'N/A',
        };
      });

      // Track which POs have POSTED GRNs and GRN dates
      const postedSet = new Set<string>();
      const grnDates = new Map<string, string>();
      const grnMap = new Map<string, any>();
      grnsData.forEach(grn => {
        if (grn.status === 'POSTED' && grn.purchase_order_id) {
          postedSet.add(grn.purchase_order_id);
        }
        if (grn.purchase_order_id) {
          grnMap.set(grn.purchase_order_id, grn);
        }
        if (grn.purchase_order_id && grn.grn_date) {
          grnDates.set(grn.purchase_order_id, grn.grn_date);
        }
      });

      setPurchaseOrders(ordersWithSuppliers);
      setSuppliers(suppliersData);
      setPostedGRNs(postedSet);
      setGrnDatesMap(grnDates);
      setGrnByPo(grnMap);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch purchase orders',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...purchaseOrders];

    // Filter by supplier name
    if (supplierSearch.trim()) {
      filtered = filtered.filter(order =>
        order.supplier_name?.toLowerCase().includes(supplierSearch.toLowerCase())
      );
    }

    // Filter by PO number
    if (poSearch.trim()) {
      filtered = filtered.filter(order =>
        order.po_number.toLowerCase().includes(poSearch.toLowerCase())
      );
    }

    // Filter by status
    if (statusFilter !== 'All') {
      filtered = filtered.filter(order => order.status === statusFilter);
    }

    setFilteredOrders(filtered);
    setPage(1); // Reset to first page when filters change
  };

  const handleSearch = () => {
    applyFilters();
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  };

  const handleAddClick = () => {
    if (onAddClick) {
      onAddClick();
    } else {
      navigate('/pharmacy/purchase-orders/add');
    }
  };

  const handleEditClick = (orderId: string) => {
    if (onEditClick) {
      onEditClick(orderId);
    } else {
      navigate(`/pharmacy/purchase-orders/edit/${orderId}`);
    }
  };

  // Paying the vendor's bill from the PO row. The bill is the GRN: receiving
  // the goods booked what is owed, this posts the money going out.
  const openVendorPayment = async (grn: any) => {
    setPayingGrn(grn);
    setPayAmount(String(grn.invoice_amount ?? grn.total_amount ?? ''));
    setPayMode('CASH');
    setPayReference('');
    setPayProof(null);
    setVendorQr(null);
    const ledgerId = await fetchSupplierLedgerId(grn.supplier_id);
    setVendorLedgerId(ledgerId);
    setVendorQr(await fetchVendorQr(ledgerId));
  };

  const handleVendorQrUpload = async (file?: File) => {
    if (!file || !vendorLedgerId) return;
    try {
      setVendorQr(await saveVendorQr(vendorLedgerId, file, user?.email || null));
      toast({ title: 'QR saved', description: 'Whoever pays this vendor next scans the same code.' });
    } catch (error: any) {
      toast({ title: 'Could not save the QR', description: error?.message, variant: 'destructive' });
    } finally {
      if (vendorQrInput.current) vendorQrInput.current.value = '';
    }
  };

  const recordVendorPayment = async () => {
    if (!payingGrn) return;
    setIsPaying(true);
    try {
      const result = await payGrnBill({
        grnId: payingGrn.id,
        mode: payMode,
        amount: Number(payAmount),
        reference: payReference,
        user: user?.email || null,
      });
      if (!result.posted) throw new Error(result.reason || 'Could not record the payment');
      if (payProof) await saveGrnPaymentProof(payingGrn.id, payProof);
      toast({
        title: 'Payment recorded',
        description: `Payment voucher ${result.voucherNumber} posted.`,
      });
      setPayingGrn(null);
      await fetchData();
    } catch (error: any) {
      toast({ title: 'Could not record the payment', description: error?.message, variant: 'destructive' });
    } finally {
      setIsPaying(false);
    }
  };

  const handleViewClick = async (order: PurchaseOrderWithSupplier) => {
    try {
      setSelectedPO(order);
      setViewModalOpen(true);
      setIsLoadingItems(true);

      // Fetch PO items and GRN data in parallel
      const [items, grnList] = await Promise.all([
        PurchaseOrderService.getPurchaseOrderItems(order.id),
        GRNService.listGRNs(),
      ]);

      setSelectedPOItems(items);

      // Find GRN for this PO (if exists)
      const grn = grnList.find(g => g.purchase_order_id === order.id);
      setSelectedGRN(grn || null);
    } catch (error) {
      console.error('Error fetching PO items:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch purchase order details',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingItems(false);
    }
  };

  const handleCloseViewModal = () => {
    setViewModalOpen(false);
    setSelectedPO(null);
    setSelectedPOItems([]);
    setSelectedGRN(null);
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentOrders = filteredOrders.slice(startIndex, endIndex);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 9;

    if (totalPages <= maxPagesToShow) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (page <= 5) {
        for (let i = 1; i <= maxPagesToShow; i++) {
          pages.push(i);
        }
      } else if (page >= totalPages - 4) {
        for (let i = totalPages - maxPagesToShow + 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        for (let i = page - 4; i <= page + 4; i++) {
          pages.push(i);
        }
      }
    }

    return pages;
  };

  return (
    <div className="space-y-6 bg-gray-50 p-6 rounded-lg">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Purchase Orders</h2>
          <p className="text-sm text-gray-500 mt-1">Manage and track all purchase orders</p>
        </div>
        <div className="flex gap-3">
          <Button
            className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white shadow-md hover:shadow-lg transition-all"
            onClick={handleAddClick}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Purchase Order
          </Button>
          <Button
            variant="outline"
            className="border-gray-300 hover:bg-gray-100"
            onClick={() => navigate('/pharmacy')}
          >
            Back
          </Button>
        </div>
      </div>
      {/* Search Filters Card */}
      <Card className="shadow-md border-gray-200">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Service Provider
              </label>
              <Input
                type="text"
                placeholder="Search by supplier name..."
                className="border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={supplierSearch}
                onChange={e => setSupplierSearch(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Purchase Order No
              </label>
              <Input
                type="text"
                placeholder="Search by PO number..."
                className="border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={poSearch}
                onChange={e => setPoSearch(e.target.value)}
              />
            </div>
            <div className="w-48">
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                Status
              </label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option>All</option>
                <option>Pending</option>
                <option>Completed</option>
                <option>Cancelled</option>
              </select>
            </div>
            <Button
              className="bg-blue-500 hover:bg-blue-600 text-white shadow-sm"
              onClick={handleSearch}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>
      {/* Table Card */}
      <Card className="shadow-md border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gradient-to-r from-blue-50 to-indigo-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Sr.No.
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Purchase Order No.
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Order For
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Created Date
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Goods Received Date
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Vendor Payment
                  </th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                        <span className="text-gray-600">Loading purchase orders...</span>
                      </div>
                    </td>
                  </tr>
                ) : currentOrders.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center">
                      <div className="text-gray-500">
                        <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                        <p className="font-medium">
                          {purchaseOrders.length === 0
                            ? 'No purchase orders found'
                            : 'No purchase orders match your search'}
                        </p>
                        <p className="text-sm mt-1">
                          {purchaseOrders.length === 0 && 'Click "Add Purchase Order" to create one.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  currentOrders.map((order, index) => (
                    <tr
                      key={order.id}
                      className="hover:bg-blue-50/50 transition-colors duration-150"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">
                        {startIndex + index + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-semibold text-blue-600">
                          {order.po_number}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {order.order_for || 'Pharmacy'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {order.supplier_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        Pharmacy
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Badge
                          variant={
                            order.status === 'Completed'
                              ? 'default'
                              : order.status === 'Pending'
                              ? 'secondary'
                              : 'destructive'
                          }
                          className={
                            order.status === 'Completed'
                              ? 'bg-green-100 text-green-800 hover:bg-green-200'
                              : order.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                              : 'bg-red-100 text-red-800 hover:bg-red-200'
                          }
                        >
                          {order.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {formatDate(order.created_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {grnDatesMap.get(order.id) ? formatDate(grnDatesMap.get(order.id)!) : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {(() => {
                          const grn = grnByPo.get(order.id);
                          if (!grn || grn.status !== 'POSTED') {
                            return <span className="text-gray-400">—</span>;
                          }
                          if (grn.paid_at) {
                            return (
                              <span className="inline-flex flex-col gap-0.5">
                                <span className="inline-flex items-center gap-1 text-green-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {grn.payment_mode} · {grn.payment_voucher_no}
                                </span>
                                {grn.payment_proof_url && (
                                  <a
                                    href={grn.payment_proof_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Confirmation
                                  </a>
                                )}
                              </span>
                            );
                          }
                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => void openVendorPayment(grn)}
                            >
                              <Banknote className="h-3.5 w-3.5" /> Pay vendor
                            </Button>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            title="View"
                            className="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors"
                            onClick={() => handleViewClick(order)}
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {postedGRNs.has(order.id) ? (
                            <button
                              title="Locked - GRN already posted to inventory"
                              className="p-2 text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
                              disabled
                            >
                              <Lock className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              title="Edit"
                              className="p-2 text-green-600 hover:bg-green-100 rounded-lg transition-colors"
                              onClick={() => handleEditClick(order.id)}
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                          )}
                          {order.status !== 'Completed' ? (
                            <button
                              title="Cancel order"
                              className="p-2 text-orange-600 hover:bg-orange-100 rounded-lg transition-colors"
                              onClick={async () => {
                                if (confirm('Are you sure you want to cancel this purchase order? It will be marked as cancelled for audit trail.')) {
                                  try {
                                    await PurchaseOrderService.delete(order.id);
                                    toast({
                                      title: 'Success',
                                      description: 'Purchase order cancelled successfully',
                                    });
                                    fetchData();
                                  } catch (error) {
                                    console.error('Error cancelling purchase order:', error);
                                    toast({
                                      title: 'Error',
                                      description: 'Failed to cancel purchase order',
                                      variant: 'destructive',
                                    });
                                  }
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              title="Cannot delete completed orders"
                              className="p-2 text-gray-400 bg-gray-100 rounded-lg cursor-not-allowed"
                              disabled
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modern Pagination */}
      {!isLoading && filteredOrders.length > 0 && (
        <div className="flex items-center justify-between px-4">
          <div className="text-sm text-gray-600">
            Showing {startIndex + 1} to {Math.min(endIndex, filteredOrders.length)} of{' '}
            {filteredOrders.length} results
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => handlePageChange(page - 1)}
              className="text-gray-600 border-gray-300"
            >
              Previous
            </Button>
            <div className="flex gap-1">
              {getPageNumbers().map((pageNum) => (
                <Button
                  key={pageNum}
                  variant={page === pageNum ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handlePageChange(pageNum)}
                  className={
                    page === pageNum
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'text-gray-600 border-gray-300 hover:bg-gray-100'
                  }
                >
                  {pageNum}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => handlePageChange(page + 1)}
              className="text-gray-600 border-gray-300"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* View Purchase Order Modal */}
      <Dialog open={viewModalOpen} onOpenChange={handleCloseViewModal}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-gray-800">
              Purchase Order Details
            </DialogTitle>
            <DialogDescription>
              Read-only view of purchase order information
            </DialogDescription>
          </DialogHeader>

          {selectedPO && (
            <div className="space-y-6">
              {/* PO Header Information */}
              <Card className="shadow-md border-gray-200">
                <CardContent className="p-6">
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">PO Number:</span>
                        <Badge variant="outline" className="font-mono text-blue-600 border-blue-300">
                          {selectedPO.po_number}
                        </Badge>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-gray-600">Order For:</span>
                        <span className="ml-2 text-gray-900">{selectedPO.order_for || 'Pharmacy'}</span>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-gray-600">Supplier:</span>
                        <span className="ml-2 text-gray-900">{selectedPO.supplier_name || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="text-sm">
                        <span className="font-medium text-gray-600">Status:</span>
                        <Badge
                          variant={
                            selectedPO.status === 'Completed'
                              ? 'default'
                              : selectedPO.status === 'Pending'
                              ? 'secondary'
                              : 'destructive'
                          }
                          className={`ml-2 ${
                            selectedPO.status === 'Completed'
                              ? 'bg-green-100 text-green-800'
                              : selectedPO.status === 'Pending'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {selectedPO.status}
                        </Badge>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-gray-600">Goods Received Date:</span>
                        <span className="ml-2 text-gray-900">
                          {selectedGRN ? formatDate(selectedGRN.grn_date) : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Items Table */}
              <Card className="shadow-md border-gray-200">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
                  <CardTitle className="text-lg font-semibold">Order Items</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingItems ? (
                    <div className="p-12 text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto mb-3" />
                      <span className="text-gray-600">Loading items...</span>
                    </div>
                  ) : selectedPOItems.length === 0 ? (
                    <div className="p-12 text-center">
                      <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-gray-500">No items found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">#</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Product</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Manufacturer</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Pack</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Batch No</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Expiry</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">MRP</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Pur. Price</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Sale Price</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">GST %</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Qty</th>
                            <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {selectedPOItems.map((item, index) => (
                            <tr key={item.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-700">{index + 1}</td>
                              <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                                {item.product_name}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{item.manufacturer}</td>
                              <td className="px-4 py-3 text-sm text-gray-700">{item.pack}</td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                {item.batch_no || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                {item.expiry_date
                                  ? new Date(item.expiry_date).toLocaleDateString()
                                  : '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900">
                                ₹{item.mrp.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900">
                                ₹{item.purchase_price.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900">
                                ₹{item.sale_price.toFixed(2)}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-700">
                                {item.gst || item.tax_percentage || 0}%
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900 font-medium">
                                {item.order_quantity}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900 font-semibold">
                                ₹{item.amount.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50">
                          {(() => {
                            // Calculate financial breakdown
                            const totalTax = selectedPOItems.reduce(
                              (sum, item) => sum + (item.tax_amount || 0),
                              0
                            );
                            const subtotalBeforeTax = selectedPOItems.reduce(
                              (sum, item) => sum + (item.amount || 0),
                              0
                            );
                            const discount = selectedGRN?.discount || 0;
                            const grandTotal = subtotalBeforeTax + totalTax - discount;

                            return (
                              <>
                                <tr>
                                  <td colSpan={11} className="px-4 py-2 text-right text-sm text-gray-700">
                                    Subtotal (Before Tax):
                                  </td>
                                  <td className="px-4 py-2 text-right text-sm text-gray-900">
                                    ₹{subtotalBeforeTax.toFixed(2)}
                                  </td>
                                </tr>
                                <tr>
                                  <td colSpan={11} className="px-4 py-2 text-right text-sm text-gray-700">
                                    Tax Amount:
                                  </td>
                                  <td className="px-4 py-2 text-right text-sm text-gray-900">
                                    ₹{totalTax.toFixed(2)}
                                  </td>
                                </tr>
                                {discount > 0 && (
                                  <tr>
                                    <td colSpan={11} className="px-4 py-2 text-right text-sm text-gray-700">
                                      Discount:
                                    </td>
                                    <td className="px-4 py-2 text-right text-sm text-red-600">
                                      -₹{discount.toFixed(2)}
                                    </td>
                                  </tr>
                                )}
                                <tr className="border-t-2 border-gray-300">
                                  <td colSpan={11} className="px-4 py-3 text-right text-sm font-bold text-gray-800">
                                    Grand Total:
                                  </td>
                                  <td className="px-4 py-3 text-right text-sm font-bold text-gray-900">
                                    ₹{grandTotal.toFixed(2)}
                                  </td>
                                </tr>
                              </>
                            );
                          })()}
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Close Button */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={handleCloseViewModal}
                  className="border-gray-300 hover:bg-gray-100"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Pay the vendor: their QR to scan, the confirmation to attach */}
      <Dialog open={!!payingGrn} onOpenChange={(open) => { if (!open) setPayingGrn(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pay vendor</DialogTitle>
            <DialogDescription>
              {payingGrn?.grn_number}
              {payingGrn?.invoice_number ? ` · Invoice ${payingGrn.invoice_number}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3 text-center">
              {vendorQr ? (
                <>
                  <p className="mb-2 text-xs text-gray-500">Scan to pay this vendor</p>
                  <img src={vendorQr} alt="Vendor payment QR" className="mx-auto max-h-52 object-contain" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    disabled={!vendorLedgerId}
                    onClick={() => vendorQrInput.current?.click()}
                  >
                    Replace QR
                  </Button>
                </>
              ) : (
                <>
                  <QrCode className="mx-auto h-8 w-8 text-gray-400" />
                  <p className="mt-2 text-sm text-gray-500">
                    {vendorLedgerId
                      ? 'No QR held for this vendor yet.'
                      : 'This vendor has no ledger mapped, so no QR can be stored against it.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={!vendorLedgerId}
                    onClick={() => vendorQrInput.current?.click()}
                  >
                    <Upload className="mr-1 h-4 w-4" /> Upload vendor QR
                  </Button>
                </>
              )}
            </div>

            <div>
              <label className="text-sm font-medium">Amount paid</label>
              <Input
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Paid by</label>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {VENDOR_PAYMENT_MODES.map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={payMode === m ? 'default' : 'outline'}
                    onClick={() => setPayMode(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Reference (optional)</label>
              <Input
                value={payReference}
                placeholder="UTR / cheque number"
                onChange={(e) => setPayReference(e.target.value)}
              />
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs text-gray-500">Payment confirmation</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => payProofInput.current?.click()}>
                  <Upload className="mr-1 h-4 w-4" /> Upload
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => payCameraInput.current?.click()}
                  title="Photograph the confirmation"
                  aria-label="Photograph the confirmation"
                >
                  <Camera className="h-4 w-4" />
                </Button>
                {payProof && <span className="text-xs text-green-700">{payProof.name}</span>}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setPayingGrn(null)} disabled={isPaying}>
                Cancel
              </Button>
              <Button onClick={() => void recordVendorPayment()} disabled={isPaying}>
                {isPaying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Record payment
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <input
        ref={payProofInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => setPayProof(e.target.files?.[0] ?? null)}
      />
      <input
        ref={payCameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => setPayProof(e.target.files?.[0] ?? null)}
      />
      <input
        ref={vendorQrInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleVendorQrUpload(e.target.files?.[0])}
      />
    </div>
  );
};

export default PurchaseOrders; 