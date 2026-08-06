// Enterprise Pharmacy Dashboard
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pill,
  ShoppingCart,
  FileText,
  Package,
  AlertTriangle,
  TrendingUp,
  DollarSign,
  Clock,
  Calendar,
  BarChart3,
  Plus,
  Scan
} from 'lucide-react';

// Import pharmacy components (we'll create these)
import MedicineInventory from './MedicineInventory';
import PrescriptionManagement from './PrescriptionManagement';
import PharmacyBilling from './PharmacyBilling';
import StockManagement from './StockManagement';
import PharmacyReports from './PharmacyReports';
import SupplierMaster from './SupplierMaster';
import SalesDetails from './SalesDetails';
import TreatmentSheetList from './TreatmentSheetList';
import ReturnSales from './ReturnSales';
import MedicineItems from './MedicineItems';
import DirectSaleBill from './DirectSaleBill';
import DirectSaleView from './DirectSaleView';
import PurchaseOrders from './PurchaseOrders';
import AddPurchaseOrder from './AddPurchaseOrder';
import EditPurchaseOrder from './EditPurchaseOrder';
import CreditPayments from './CreditPayments';
import LowStockMedicines from './LowStockMedicines';
import PrescriptionQueue from './PrescriptionQueue';
import PartnerOrders from './PartnerOrders';
import PrescriptionNotificationBell from './PrescriptionNotificationBell';
import { usePendingPrescriptions } from '@/hooks/usePendingPrescriptions';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle, XCircle, ShieldCheck } from 'lucide-react';
import { logActivity } from '@/lib/activity-logger';
import { toast } from 'sonner';

const PharmacyDashboard: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'overview';
  const [selectedTab, setSelectedTab] = useState(initialTab);
  const [directSaleSubTab, setDirectSaleSubTab] = useState('bill'); // 'bill' or 'view'
  const [purchaseOrderView, setPurchaseOrderView] = useState<'list' | 'add' | 'edit'>('list');
  const [selectedPurchaseOrderId, setSelectedPurchaseOrderId] = useState<string | null>(null);
  const [autoOpenPrescriptionId, setAutoOpenPrescriptionId] = useState<string | null>(null);
  const [pharmacyRejectDialogOpen, setPharmacyRejectDialogOpen] = useState(false);
  const [rejectingPharmacySaleId, setRejectingPharmacySaleId] = useState<string | null>(null);
  const [pharmacyRejectionReason, setPharmacyRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [approvalListDialogOpen, setApprovalListDialogOpen] = useState(false);

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'super_admin' || user?.role === 'ca';

  const { data: pendingPharmacyDiscounts = [], refetch: refetchPendingDiscounts } = useQuery({
    queryKey: ['pending-pharmacy-discount-approvals', 'dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pharmacy_sales')
        .select('sale_id, bill_number, patient_name, patient_id, discount, discount_percentage, total_amount, created_by, created_at, hospital_name, payment_method')
        .eq('payment_status', 'PENDING_DISCOUNT_APPROVAL')
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    },
    enabled: isAdmin,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const getUserIdentifier = () => {
    try {
      const raw = localStorage.getItem('hmis_user');
      const u = raw ? JSON.parse(raw) : {};
      return u.email || u.username || 'Admin';
    } catch {
      return 'Admin';
    }
  };

  const restorePharmacyStock = async (saleId: string) => {
    const { data: items } = await supabase
      .from('pharmacy_sale_items')
      .select('medicine_id, batch_number, quantity')
      .eq('sale_id', saleId);
    if (!items) return;
    for (const item of items) {
      if (!item.medicine_id || !item.batch_number) continue;
      const { data: batch } = await supabase
        .from('medicine_batch_inventory')
        .select('id, current_stock, sold_quantity')
        .eq('medicine_id', item.medicine_id)
        .eq('batch_number', item.batch_number)
        .single();
      if (!batch) continue;
      await supabase
        .from('medicine_batch_inventory')
        .update({
          current_stock: (batch.current_stock || 0) + item.quantity,
          sold_quantity: Math.max(0, (batch.sold_quantity || 0) - item.quantity),
          updated_at: new Date().toISOString()
        } as any)
        .eq('id', batch.id);
    }
  };

  const handleApprovePharmacyDiscount = async (saleId: string, discount: number) => {
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('pharmacy_sales')
        .update({ payment_status: 'COMPLETED', updated_at: new Date().toISOString() } as any)
        .eq('sale_id', saleId);
      if (error) throw error;
      await logActivity('pharmacy_discount_approved', { sale_id: saleId, discount, approved_by: approver }, 'PharmacyDashboard');
      toast.success(`Pharmacy discount of Rs. ${discount.toLocaleString('en-IN')} approved`);
      queryClient.invalidateQueries({ queryKey: ['pending-pharmacy-discount-approvals'] });
    } catch { toast.error('Failed to approve pharmacy discount'); }
    setIsProcessing(false);
  };

  const handleRejectPharmacyDiscount = async () => {
    if (!rejectingPharmacySaleId || !pharmacyRejectionReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('pharmacy_sales')
        .update({ payment_status: 'CANCELLED', updated_at: new Date().toISOString() } as any)
        .eq('sale_id', rejectingPharmacySaleId);
      if (error) throw error;
      await restorePharmacyStock(rejectingPharmacySaleId);
      await logActivity('pharmacy_discount_rejected', { sale_id: rejectingPharmacySaleId, reason: pharmacyRejectionReason, rejected_by: approver }, 'PharmacyDashboard');
      toast.success('Pharmacy discount rejected. Sale cancelled. Stock restored.');
      setPharmacyRejectDialogOpen(false);
      setRejectingPharmacySaleId(null);
      setPharmacyRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['pending-pharmacy-discount-approvals'] });
    } catch { toast.error('Failed to reject pharmacy discount'); }
    setIsProcessing(false);
  };

  // Update tab when URL changes (e.g., returning from Edit Sale Bill)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      setSelectedTab(tab);
    }
  }, [searchParams]);

  // Live-refresh the discount-approval list when pharmacy sales change,
  // so a newly submitted bill appears immediately instead of waiting for
  // the 60s poll.
  useEffect(() => {
    if (!isAdmin) return;
    const channel = (supabase as any)
      .channel('pharmacy-discount-approvals')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pharmacy_sales' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['pending-pharmacy-discount-approvals'] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, queryClient]);

  // Live pending-prescription data (replaces hardcoded mock below).
  // Called ONCE here and threaded into the bell as props so we don't open
  // two realtime channels with the same name.
  const { count: pendingPrescriptionsCount, recent: pendingPrescriptionsRecent } =
    usePendingPrescriptions();

  // Mock data for dashboard - will be replaced with real data from hooks
  const dashboardData = {
    todaySales: 45,
    todayRevenue: 125750,
    lowStockItems: 8,
    nearExpiryItems: 15,
    totalMedicines: 1247,
    monthRevenue: 3876540,
    prescriptionsProcessed: 567
  };

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 0
    }).format(amount);

  const recentActivities = [
    { id: 1, type: 'sale', description: 'Medicine dispensed to Patient #1234', time: '2 min ago', amount: 450 },
    { id: 2, type: 'prescription', description: 'New prescription received from Dr. Smith', time: '5 min ago' },
    { id: 3, type: 'stock', description: 'Low stock alert: Paracetamol 500mg', time: '10 min ago', critical: true },
    { id: 4, type: 'sale', description: 'OTC sale completed', time: '15 min ago', amount: 125 },
    { id: 5, type: 'expiry', description: 'Medicines expiring in 30 days', time: '1 hour ago', critical: true }
  ];

  const topSellingMedicines = [
    { name: 'Paracetamol 500mg', sold: 145, revenue: 7250 },
    { name: 'Amoxicillin 250mg', sold: 89, revenue: 8900 },
    { name: 'Ibuprofen 400mg', sold: 67, revenue: 6700 },
    { name: 'Cetrizine 10mg', sold: 54, revenue: 2700 },
    { name: 'Omeprazole 20mg', sold: 43, revenue: 4300 }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Pill className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Pharmacy Management</h1>
            <p className="text-muted-foreground">
              Enterprise-level pharmacy operations and inventory management
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              aria-label={`${pendingPharmacyDiscounts.length} pending discount approvals`}
              onClick={() => { refetchPendingDiscounts(); setApprovalListDialogOpen(true); }}
            >
              <ShieldCheck className={pendingPharmacyDiscounts.length > 0 ? 'h-5 w-5 text-orange-600' : 'h-5 w-5 text-muted-foreground'} />
              {pendingPharmacyDiscounts.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-semibold leading-none">
                  {pendingPharmacyDiscounts.length > 99 ? '99+' : pendingPharmacyDiscounts.length}
                </span>
              )}
            </Button>
          )}
          <PrescriptionNotificationBell
            count={pendingPrescriptionsCount}
            recent={pendingPrescriptionsRecent}
            onViewAll={() => setSelectedTab('prescriptions')}
            onRowClick={(id) => {
              setSelectedTab('prescriptions');
              setAutoOpenPrescriptionId(id);
            }}
          />
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-12 bg-blue-50 rounded-md">
          <div className="flex flex-row items-center gap-x-4 w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="direct-sale">Direct Sale</TabsTrigger>
          <TabsTrigger value="billing">Sale Bill</TabsTrigger>
          <TabsTrigger value="view_sales">View Sales</TabsTrigger>
          <TabsTrigger value="return-sales">Return Sales</TabsTrigger>
          <TabsTrigger value="credit-payments">Credit Payments</TabsTrigger>
            <TabsTrigger value="stock-mgmt">Stock Mgmt</TabsTrigger>
          <TabsTrigger value="manufacturer">Manufacturer</TabsTrigger>
          <TabsTrigger value="supplier">Supplier</TabsTrigger>
          <TabsTrigger value="purchase-order">Purchase Order</TabsTrigger>
          <TabsTrigger value="low-stock">Low Stock</TabsTrigger>
          <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
          <TabsTrigger value="partner-orders">Partner Orders</TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="discount-approvals" className="relative">
              Discount Approvals
              {pendingPharmacyDiscounts.length > 0 && (
                <span className="ml-1 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{pendingPharmacyDiscounts.length}</span>
              )}
            </TabsTrigger>
          )}
          </div>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Today's Sales</p>
                    <p className="text-2xl font-bold text-green-600">{dashboardData.todaySales}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Revenue: {formatCurrency(dashboardData.todayRevenue)}
                    </p>
                  </div>
                  <ShoppingCart className="h-8 w-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending Prescriptions</p>
                    <p className="text-2xl font-bold text-orange-600">{pendingPrescriptionsCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Awaiting processing
                    </p>
                  </div>
                  <FileText className="h-8 w-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Stock Alerts</p>
                    <p className="text-2xl font-bold text-red-600">{dashboardData.lowStockItems}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Low stock items
                    </p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Medicines</p>
                    <p className="text-2xl font-bold">{dashboardData.totalMedicines}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      In inventory
                    </p>
                  </div>
                  <Package className="h-8 w-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Button
                  variant="outline"
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('direct-sale')}
                >
                  <ShoppingCart className="h-6 w-6 mb-2" />
                  <span>Direct Sale</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('billing')}
                >
                  <ShoppingCart className="h-6 w-6 mb-2" />
                  <span>Sale Bill</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col py-4"
                  onClick={() => setSelectedTab('items')}
                >
                  <Plus className="h-6 w-6 mb-2" />
                  <span>Add Medicine</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="h-auto flex-col py-4"
                >
                  <Scan className="h-6 w-6 mb-2" />
                  <span>Barcode Scan</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dashboard Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Activities */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Recent Activities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recentActivities.map((activity) => (
                    <div key={activity.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          activity.critical ? 'bg-red-500' : 
                          activity.type === 'sale' ? 'bg-green-500' : 'bg-blue-500'
                        }`} />
                        <div>
                          <p className="text-sm font-medium">{activity.description}</p>
                          <p className="text-xs text-muted-foreground">{activity.time}</p>
                        </div>
                      </div>
                      {activity.amount && (
                        <span className="text-sm font-semibold text-green-600">
                          {formatCurrency(activity.amount)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Top Selling Medicines */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Top Selling Medicines
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topSellingMedicines.map((medicine, index) => (
                    <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium">{medicine.name}</p>
                        <p className="text-xs text-muted-foreground">{medicine.sold} units sold</p>
                      </div>
                      <span className="text-sm font-semibold">
                        {formatCurrency(medicine.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Additional Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Revenue Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Today</span>
                    <span className="font-semibold">{formatCurrency(dashboardData.todayRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">This Month</span>
                    <span className="font-semibold">{formatCurrency(dashboardData.monthRevenue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Average/Day</span>
                    <span className="font-semibold">{formatCurrency(dashboardData.monthRevenue / 30)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Critical Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Low Stock</span>
                    <span className="bg-red-100 text-red-800 px-2 py-1 rounded text-xs font-medium">
                      {dashboardData.lowStockItems}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Near Expiry</span>
                    <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded text-xs font-medium">
                      {dashboardData.nearExpiryItems}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm">Pending Orders</span>
                    <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-medium">
                      3
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Prescriptions Processed</span>
                    <span className="font-semibold">{dashboardData.prescriptionsProcessed}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Average Processing Time</span>
                    <span className="font-semibold">4.2 min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Customer Satisfaction</span>
                    <span className="font-semibold">98.5%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="items">
          <MedicineItems />
        </TabsContent>

        <TabsContent value="direct-sale">
          <div className="space-y-4">
            {/* Sub-tabs for Direct Sale */}
            <div className="flex gap-2 border-b pb-2">
              <Button
                variant={directSaleSubTab === 'bill' ? 'default' : 'outline'}
                onClick={() => setDirectSaleSubTab('bill')}
                className="px-6"
              >
                Bill
              </Button>
              <Button
                variant={directSaleSubTab === 'view' ? 'default' : 'outline'}
                onClick={() => setDirectSaleSubTab('view')}
                className="px-6"
              >
                View
              </Button>
            </div>

            {/* Content based on selected sub-tab */}
            {directSaleSubTab === 'bill' && <DirectSaleBill />}
            {directSaleSubTab === 'view' && <DirectSaleView />}
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <PharmacyBilling />
        </TabsContent>

        <TabsContent value="stock-mgmt">
          <StockManagement />
        </TabsContent>

        <TabsContent value="reports">
          <PharmacyReports />
        </TabsContent>

        <TabsContent value="manufacturer">
          <SupplierMaster activeTab="manufacturer" />
        </TabsContent>

        <TabsContent value="supplier">
          <SupplierMaster activeTab="supplier" />
        </TabsContent>

        <TabsContent value="view_sales">
          <SalesDetails />
        </TabsContent>

        <TabsContent value="return-sales">
          <ReturnSales />
        </TabsContent>

        <TabsContent value="credit-payments">
          <CreditPayments />
        </TabsContent>

        <TabsContent value="low-stock">
          <LowStockMedicines />
        </TabsContent>

        <TabsContent value="partner-orders">
          <PartnerOrders />
        </TabsContent>

        <TabsContent value="purchase-order">
          <div className="space-y-4">
            {/* Sub-tabs for Purchase Order */}
            <div className="flex gap-2 border-b pb-2">
              <Button
                variant={purchaseOrderView === 'list' ? 'default' : 'outline'}
                onClick={() => setPurchaseOrderView('list')}
                className="px-6"
              >
                Purchase Order List
              </Button>
              <Button
                variant={purchaseOrderView === 'add' ? 'default' : 'outline'}
                onClick={() => setPurchaseOrderView('add')}
                className="px-6"
              >
                Add Purchase Order
              </Button>
            </div>

            {/* Content based on selected sub-tab */}
            {purchaseOrderView === 'list' && (
              <PurchaseOrders
                onAddClick={() => setPurchaseOrderView('add')}
                onEditClick={(orderId) => {
                  setSelectedPurchaseOrderId(orderId);
                  setPurchaseOrderView('edit');
                }}
              />
            )}
            {purchaseOrderView === 'add' && (
              <AddPurchaseOrder onBack={() => setPurchaseOrderView('list')} />
            )}
            {purchaseOrderView === 'edit' && selectedPurchaseOrderId && (
              <EditPurchaseOrder
                purchaseOrderId={selectedPurchaseOrderId}
                onBack={() => {
                  setPurchaseOrderView('list');
                  setSelectedPurchaseOrderId(null);
                }}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="prescriptions">
          <PrescriptionQueue
            autoOpenPrescriptionId={autoOpenPrescriptionId}
            onAutoOpenHandled={() => setAutoOpenPrescriptionId(null)}
          />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="discount-approvals">
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="h-5 w-5 text-orange-500" />
                <h2 className="text-lg font-semibold">Pharmacy Discount Approvals</h2>
                {pendingPharmacyDiscounts.length > 0 && (
                  <Badge variant="destructive">{pendingPharmacyDiscounts.length} pending</Badge>
                )}
              </div>

              {pendingPharmacyDiscounts.length === 0 ? (
                <div className="text-center py-16 border rounded-lg bg-gray-50">
                  <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                  <p className="text-lg font-medium text-green-600">All caught up!</p>
                  <p className="text-sm text-muted-foreground">No pharmacy discount requests pending approval.</p>
                </div>
              ) : (
                <div className="overflow-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-orange-50 border-b">
                      <tr>
                        <th className="p-3 text-left">Hospital</th>
                        <th className="p-3 text-left">Bill No</th>
                        <th className="p-3 text-left">Patient</th>
                        <th className="p-3 text-right">Discount</th>
                        <th className="p-3 text-right">Total Amount</th>
                        <th className="p-3 text-left">Requested By</th>
                        <th className="p-3 text-left">Date</th>
                        <th className="p-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingPharmacyDiscounts.map((sale: any) => (
                        <tr key={sale.sale_id} className="border-t hover:bg-orange-50/50">
                          <td className="p-3">
                            <Badge className={sale.hospital_name === 'hope' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : sale.hospital_name === 'ayushman' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-800 hover:bg-gray-100'}>
                              {sale.hospital_name === 'hope' ? 'Hope' : sale.hospital_name === 'ayushman' ? 'Ayushman' : sale.hospital_name || '-'}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono font-medium">{sale.bill_number || '-'}</td>
                          <td className="p-3 font-medium">{sale.patient_name || '-'}</td>
                          <td className="p-3 text-right font-mono font-semibold text-orange-700">
                            Rs. {(Number(sale.discount) || 0).toLocaleString('en-IN')}
                            {sale.discount_percentage > 0 && (
                              <span className="text-xs text-orange-500 ml-1">({sale.discount_percentage}%)</span>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono font-semibold">
                            Rs. {(Number(sale.total_amount) || 0).toLocaleString('en-IN')}
                          </td>
                          <td className="p-3 text-muted-foreground">{sale.created_by || '-'}</td>
                          <td className="p-3 text-muted-foreground">
                            {sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-IN') : '-'}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprovePharmacyDiscount(sale.sale_id, sale.discount)} disabled={isProcessing}>
                                <CheckCircle className="h-4 w-4 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => { setRejectingPharmacySaleId(sale.sale_id); setPharmacyRejectDialogOpen(true); }} disabled={isProcessing}>
                                <XCircle className="h-4 w-4 mr-1" /> Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </TabsContent>
        )}
      </Tabs>

      {/* Approval List Dialog */}
      <Dialog open={approvalListDialogOpen} onOpenChange={setApprovalListDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-4 rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-full p-2">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h2 className="text-white font-semibold text-lg">Discount Approvals</h2>
                  <p className="text-orange-100 text-xs">Pharmacy sales pending admin review</p>
                </div>
              </div>
              {pendingPharmacyDiscounts.length > 0 && (
                <span className="bg-white text-orange-600 text-sm font-bold px-3 py-1 rounded-full">
                  {pendingPharmacyDiscounts.length} pending
                </span>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
            {pendingPharmacyDiscounts.length === 0 ? (
              <div className="text-center py-14">
                <div className="bg-green-50 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                </div>
                <p className="text-base font-semibold text-green-700">All caught up!</p>
                <p className="text-sm text-muted-foreground mt-1">No pharmacy discount requests pending approval.</p>
              </div>
            ) : (
              pendingPharmacyDiscounts.map((sale: any) => (
                <div key={sale.sale_id} className="border rounded-xl p-4 bg-white hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4">
                    {/* Left: patient + bill info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge className={sale.hospital_name === 'hope' ? 'bg-blue-100 text-blue-700 hover:bg-blue-100 text-xs' : sale.hospital_name === 'ayushman' ? 'bg-green-100 text-green-700 hover:bg-green-100 text-xs' : 'bg-gray-100 text-gray-700 hover:bg-gray-100 text-xs'}>
                          {sale.hospital_name === 'hope' ? 'Hope' : sale.hospital_name === 'ayushman' ? 'Ayushman' : sale.hospital_name || 'Unknown'}
                        </Badge>
                        <span className="font-mono text-xs text-muted-foreground">{sale.bill_number || 'No Bill No.'}</span>
                      </div>
                      <p className="font-semibold text-gray-900 truncate">{sale.patient_name || 'Unknown Patient'}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>By <span className="font-medium text-gray-700">{sale.created_by || '-'}</span></span>
                        <span>·</span>
                        <span>{sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span>
                      </div>
                    </div>

                    {/* Center: amounts */}
                    <div className="text-right shrink-0">
                      <div className="inline-flex items-center gap-1 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1 mb-1">
                        <span className="text-xs text-orange-600 font-medium">Discount</span>
                        <span className="text-orange-700 font-bold text-sm">
                          ₹{(Number(sale.discount) || 0).toLocaleString('en-IN')}
                        </span>
                        {sale.discount_percentage > 0 && (
                          <span className="text-orange-400 text-xs">({sale.discount_percentage}%)</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Total: <span className="font-semibold text-gray-800">₹{(Number(sale.total_amount) || 0).toLocaleString('en-IN')}</span>
                      </p>
                    </div>

                    {/* Right: actions */}
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white gap-1"
                        onClick={() => handleApprovePharmacyDiscount(sale.sale_id, sale.discount)}
                        disabled={isProcessing}
                      >
                        <CheckCircle className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1"
                        onClick={() => { setRejectingPharmacySaleId(sale.sale_id); setPharmacyRejectDialogOpen(true); }}
                        disabled={isProcessing}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-6 py-3 flex justify-end bg-gray-50 rounded-b-lg">
            <Button variant="outline" onClick={() => setApprovalListDialogOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reject Confirmation Dialog */}
      <Dialog open={pharmacyRejectDialogOpen} onOpenChange={setPharmacyRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Pharmacy Discount</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Reason for rejection <span className="text-red-500">*</span></label>
            <Textarea
              placeholder="Enter the reason for rejecting this pharmacy discount..."
              value={pharmacyRejectionReason}
              onChange={(e) => setPharmacyRejectionReason(e.target.value)}
              rows={3}
            />
            <p className="text-xs text-muted-foreground mt-2">The pharmacy sale will be cancelled. The pharmacist will need to create a new sale without the discount.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPharmacyRejectDialogOpen(false); setPharmacyRejectionReason(''); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRejectPharmacyDiscount} disabled={isProcessing || !pharmacyRejectionReason.trim()}>
              {isProcessing ? 'Rejecting...' : 'Reject & Cancel Sale'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PharmacyDashboard;
