import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { logActivity } from '@/lib/activity-logger';
import { CheckCircle, XCircle, FileText, Clock, IndianRupee, Search, Percent, ExternalLink, Eye, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { resolveDiscountAndFinalizeBill } from '@/lib/discountBillFinalization';

// Two-step enrichment: fetch bills first, then batch-fetch all referenced
// patients in a single .in() query. Avoids PostgREST relationship ambiguity
// from inline joins and avoids N+1 round-trips from per-row lookups.
const enrichBillsWithPatients = async (bills: any[]) => {
  if (!bills || bills.length === 0) return [];

  const patientIds = Array.from(
    new Set(bills.map((b: any) => b.patient_id).filter(Boolean))
  );

  const patientMap = new Map<string, { name?: string; registration_number?: string }>();
  if (patientIds.length > 0) {
    // patients has no registration_number column — the readable
    // registration code lives in patients_id (42703 otherwise).
    const { data: patients, error } = await supabase
      .from('patients')
      .select('id, name, patients_id')
      .in('id', patientIds);
    if (error) {
      console.warn('[BillApprovals] batch patients lookup failed:', error.message);
    }
    (patients || []).forEach((p: any) =>
      patientMap.set(p.id, { name: p.name, registration_number: p.patients_id })
    );
  }

  return bills.map((bill: any) => {
    const patient = bill.patient_id ? patientMap.get(bill.patient_id) : undefined;
    let patientName: string = patient?.name || 'Unknown';
    let registrationNumber: string = patient?.registration_number || '';

    if (patientName === 'Unknown' && bill.bill_patient_data) {
      try {
        const pd = typeof bill.bill_patient_data === 'string'
          ? JSON.parse(bill.bill_patient_data)
          : bill.bill_patient_data;
        patientName = pd?.name || pd?.patient_name || patientName;
        if (!registrationNumber) {
          registrationNumber = pd?.registration_number || '';
        }
      } catch (e) {
        console.warn('[BillApprovals] bill_patient_data parse failed for', bill.id, e);
      }
    }

    return {
      ...bill,
      patientName,
      visitId: bill.visit_id,
      registrationNumber,
    };
  });
};

const BillApprovals = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('pending');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectingBillId, setRejectingBillId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [discountRejectDialogOpen, setDiscountRejectDialogOpen] = useState(false);
  const [rejectingDiscountId, setRejectingDiscountId] = useState<string | null>(null);
  const [discountRejectionReason, setDiscountRejectionReason] = useState('');
  const [pharmacyRejectDialogOpen, setPharmacyRejectDialogOpen] = useState(false);
  const [rejectingPharmacySaleId, setRejectingPharmacySaleId] = useState<string | null>(null);
  const [pharmacyRejectionReason, setPharmacyRejectionReason] = useState('');
  const [discountSubTab, setDiscountSubTab] = useState<'visit' | 'pharmacy'>('pharmacy');

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'super_admin' || user?.role === 'ca';

  // Fetch pending bills
  const { data: pendingBills = [], isLoading } = useQuery({
    queryKey: ['pending-bill-approvals'],
    queryFn: async () => {
      const { data: bills, error } = await supabase
        .from('bills')
        .select('*')
        .eq('status', 'PENDING_APPROVAL')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return enrichBillsWithPatients(bills || []);
    },
    enabled: isAdmin,
    refetchInterval: 120000,
    staleTime: 60000,
  });

  // Fetch approved bills (APPROVED + FINALIZED)
  const { data: approvedBills = [], isLoading: isLoadingApproved } = useQuery({
    queryKey: ['approved-bills'],
    queryFn: async () => {
      const { data: bills, error } = await supabase
        .from('bills')
        .select('*')
        .in('status', ['APPROVED', 'FINALIZED'])
        .order('approved_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return enrichBillsWithPatients(bills || []);
    },
    enabled: isAdmin,
    refetchInterval: 120000,
    staleTime: 60000,
  });

  // Fetch pending discount approvals
  const { data: pendingDiscounts = [] } = useQuery({
    queryKey: ['pending-discount-approvals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_discounts')
        .select('*')
        .eq('approval_status', 'pending_approval')
        .order('created_at', { ascending: false }) as { data: any; error: any };
      if (error) return [];
      if (!data || data.length === 0) return [];
      // Batch fetch all visits in one query instead of N individual queries
      const visitIds = data.map((d: any) => d.visit_id).filter(Boolean);
      const visitMap = new Map<string, {
        visit_id: string;
        patient_type?: string;
        patients?: { name?: string; patients_id?: string };
      }>();
      if (visitIds.length > 0) {
        const { data: visits } = await supabase
          .from('visits')
          .select('id, visit_id, patient_type, patients(name, patients_id)')
          .in('id', visitIds) as { data: any };
        (visits || []).forEach((v: any) => visitMap.set(v.id, v));
      }
      return data
        .map((disc: any) => {
          const visit = disc.visit_id ? visitMap.get(disc.visit_id) : undefined;
          return {
            ...disc,
            patientName: visit?.patients?.name || 'Unknown',
            visitIdStr: visit?.visit_id || '',
            registrationNumber: visit?.patients?.patients_id || '',
            patientType: String(visit?.patient_type || '').toLowerCase().trim(),
          };
        })
        .filter((disc: any) =>
          disc.patientType === 'ipd' || disc.patientType === 'ipd (inpatient)'
        );
    },
    enabled: isAdmin,
    refetchInterval: 120000,
    staleTime: 60000,
  });

  // Fetch pending pharmacy discount approvals
  const { data: pendingPharmacyDiscounts = [] } = useQuery({
    queryKey: ['pending-pharmacy-discount-approvals', 'bill-approvals'],
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

  // Fetch pending package approvals
  const { data: pendingPackages = [] } = useQuery({
    queryKey: ['pending-package-approvals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, visit_id, patient_id, package_amount, package_includes_medicine, package_status, visit_date, patients(name, patients_id)')
        .eq('package_status', 'pending_approval')
        .order('created_at', { ascending: false }) as { data: any; error: any };
      if (error) return [];
      return (data || []).map((v: any) => ({
        ...v,
        patientName: v.patients?.name || 'Unknown',
        registrationNumber: v.patients?.patients_id || '',
      }));
    },
    enabled: isAdmin,
    refetchInterval: 120000,
    staleTime: 60000,
  });

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
      await logActivity('pharmacy_discount_approved', { sale_id: saleId, discount, approved_by: approver }, 'BillApprovals');
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
      await logActivity('pharmacy_discount_rejected', { sale_id: rejectingPharmacySaleId, reason: pharmacyRejectionReason, rejected_by: approver }, 'BillApprovals');
      toast.success('Pharmacy discount rejected. Sale cancelled. Stock restored.');
      setPharmacyRejectDialogOpen(false);
      setRejectingPharmacySaleId(null);
      setPharmacyRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['pending-pharmacy-discount-approvals'] });
    } catch { toast.error('Failed to reject pharmacy discount'); }
    setIsProcessing(false);
  };

  const handleApprovePackage = async (visitUUID: string, visitId: string, packageAmount: string) => {
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('visits')
        .update({
          package_status: 'approved',
          status: 'scheduled',
          package_approved_by: approver,
          package_approved_at: new Date().toISOString(),
        } as any)
        .eq('id', visitUUID);
      if (error) throw error;
      await logActivity('package_approved', { visit_id: visitId, package_amount: packageAmount, approved_by: approver }, 'BillApprovals');
      toast.success(`Package for visit ${visitId} approved (Rs. ${Number(packageAmount).toLocaleString('en-IN')})`);
      queryClient.invalidateQueries({ queryKey: ['pending-package-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      queryClient.invalidateQueries({ queryKey: ['currently-admitted-visits'] });
    } catch { toast.error('Failed to approve package'); }
    setIsProcessing(false);
  };

  const handleRejectPackage = async (visitUUID: string, visitId: string) => {
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('visits')
        .update({
          package_status: 'rejected',
          status: 'cancelled',
          package_approved_by: approver,
          package_approved_at: new Date().toISOString(),
        } as any)
        .eq('id', visitUUID);
      if (error) throw error;
      await logActivity('package_rejected', { visit_id: visitId, rejected_by: approver }, 'BillApprovals');
      toast.success(`Package for visit ${visitId} rejected`);
      queryClient.invalidateQueries({ queryKey: ['pending-package-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['visits'] });
    } catch { toast.error('Failed to reject package'); }
    setIsProcessing(false);
  };

  const getUserIdentifier = () => {
    const raw = localStorage.getItem('hmis_user');
    const u = raw ? JSON.parse(raw) : {};
    return u.email || u.username || 'Admin';
  };

  const handleApprove = async (billId: string, billNo: string) => {
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('bills')
        .update({
          status: 'APPROVED',
          approved_by: approver,
          approved_at: new Date().toISOString(),
          rejection_reason: null,
        } as any)
        .eq('id', billId);
      if (error) throw error;
      await logActivity('bill_approved', { bill_id: billId, bill_no: billNo, approved_by: approver }, 'BillApprovals');
      toast.success(`Bill ${billNo} approved`);
      queryClient.invalidateQueries({ queryKey: ['pending-bill-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approved-bills'] });
      queryClient.invalidateQueries({ queryKey: ['pending-bill-count'] });
    } catch { toast.error('Failed to approve bill'); }
    setIsProcessing(false);
  };

  const handleReject = async () => {
    if (!rejectingBillId || !rejectionReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      const { error } = await supabase
        .from('bills')
        .update({
          status: 'DRAFT',
          rejection_reason: rejectionReason.trim(),
          approved_by: null,
          approved_at: null,
        } as any)
        .eq('id', rejectingBillId);
      if (error) throw error;
      await logActivity('bill_rejected', { bill_id: rejectingBillId, reason: rejectionReason, rejected_by: approver }, 'BillApprovals');
      toast.success('Bill rejected and sent back for revision');
      setRejectDialogOpen(false);
      setRejectingBillId(null);
      setRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['pending-bill-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['pending-bill-count'] });
    } catch { toast.error('Failed to reject bill'); }
    setIsProcessing(false);
  };

  const handleApproveDiscount = async (discountId: string, amount: number) => {
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      await resolveDiscountAndFinalizeBill({
        discountId,
        decision: 'approved',
        approver,
      });
      await logActivity('discount_approved', { discount_id: discountId, amount, approved_by: approver }, 'BillApprovals');
      toast.success(`Discount of Rs. ${amount.toLocaleString('en-IN')} approved and bill finalized`);
      queryClient.invalidateQueries({ queryKey: ['pending-discount-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approved-bills'] });
      queryClient.invalidateQueries({ queryKey: ['final-bill'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-bill'] });
    } catch { toast.error('Failed to approve discount'); }
    setIsProcessing(false);
  };

  const handleRejectDiscount = async () => {
    if (!rejectingDiscountId || !discountRejectionReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    setIsProcessing(true);
    try {
      const approver = getUserIdentifier();
      await resolveDiscountAndFinalizeBill({
        discountId: rejectingDiscountId,
        decision: 'rejected',
        approver,
        rejectionReason: discountRejectionReason.trim(),
      });
      await logActivity('discount_rejected', { discount_id: rejectingDiscountId, reason: discountRejectionReason, rejected_by: approver }, 'BillApprovals');
      toast.success('Discount rejected and bill finalized at full value');
      setDiscountRejectDialogOpen(false);
      setRejectingDiscountId(null);
      setDiscountRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['pending-discount-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['approved-bills'] });
      queryClient.invalidateQueries({ queryKey: ['final-bill'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-bill'] });
    } catch { toast.error('Failed to reject discount'); }
    setIsProcessing(false);
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
        <div className="max-w-4xl mx-auto text-center py-20">
          <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
          <p className="text-gray-600 mt-2">Only administrators can access the bill approval dashboard.</p>
        </div>
      </div>
    );
  }

  // Generic, accent-insensitive substring matcher. Empty query matches all.
  const q = searchTerm.trim().toLowerCase();
  const matches = (...fields: any[]) =>
    !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q));

  const filteredPending = pendingBills.filter((bill: any) =>
    matches(bill.patientName, bill.bill_no, bill.formatted_bill_no, bill.registrationNumber, bill.category, bill.hospital_name)
  );

  const filteredApproved = approvedBills.filter((bill: any) =>
    matches(bill.patientName, bill.bill_no, bill.formatted_bill_no, bill.registrationNumber, bill.category, bill.hospital_name)
  );

  const filteredPharmacyDiscounts = pendingPharmacyDiscounts.filter((sale: any) =>
    matches(sale.patient_name, sale.bill_number, sale.payment_method, sale.hospital_name)
  );

  const filteredVisitDiscounts = pendingDiscounts.filter((disc: any) =>
    matches(disc.patientName, disc.registrationNumber, disc.discount_reason, disc.applied_by, disc.hospital_name)
  );

  const filteredPackages = pendingPackages.filter((pkg: any) =>
    matches(pkg.patientName, pkg.registrationNumber, pkg.visit_id)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pt-16 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary flex items-center justify-center gap-3">
            <FileText className="h-8 w-8" />
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Review, approve, and track all bills and discount requests</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('pending')}>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold">{pendingBills.length}</p>
                <p className="text-sm text-muted-foreground">Bills Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('discounts')}>
            <CardContent className="p-4 flex items-center gap-3">
              <Percent className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{pendingDiscounts.length + pendingPharmacyDiscounts.length}</p>
                <p className="text-sm text-muted-foreground">Discounts Pending</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <IndianRupee className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">
                  {pendingBills.reduce((sum: number, b: any) => sum + (Number(b.total_amount) || 0), 0).toLocaleString('en-IN')}
                </p>
                <p className="text-sm text-muted-foreground">Total Pending Amount</p>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setActiveTab('packages')}>
            <CardContent className="p-4 flex items-center gap-3">
              <Package className="h-8 w-8 text-purple-500" />
              <div>
                <p className="text-2xl font-bold">{pendingPackages.length}</p>
                <p className="text-sm text-muted-foreground">Package Approvals</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-4 relative max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search by patient, bill no, reg ID, category, hospital..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="h-4 w-4" />
              Pending Approvals
              {pendingBills.length > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs">{pendingBills.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="discounts" className="gap-2">
              <Percent className="h-4 w-4" />
              Discount Requests
              {(pendingDiscounts.length + pendingPharmacyDiscounts.length) > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs">{pendingDiscounts.length + pendingPharmacyDiscounts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="packages" className="gap-2">
              <Package className="h-4 w-4" />
              Package Approvals
              {pendingPackages.length > 0 && (
                <Badge variant="destructive" className="ml-1 text-xs">{pendingPackages.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="approved" className="gap-2">
              <CheckCircle className="h-4 w-4" />
              Approved Bills
              {approvedBills.length > 0 && (
                <Badge className="ml-1 text-xs bg-green-600">{approvedBills.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ===== TAB 1: Pending Bill Approvals ===== */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  Pending Approvals ({filteredPending.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : filteredPending.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-3" />
                    <p className="text-lg font-medium text-green-600">All caught up!</p>
                    <p className="text-sm text-muted-foreground">No bills pending approval.</p>
                  </div>
                ) : (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="p-3 text-left">Hospital</th>
                          <th className="p-3 text-left">Bill No</th>
                          <th className="p-3 text-left">Patient Name</th>
                          <th className="p-3 text-left">Category</th>
                          <th className="p-3 text-right">Amount</th>
                          <th className="p-3 text-left">Date</th>
                          <th className="p-3 text-left">Created By</th>
                          <th className="p-3 text-center">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPending.map((bill: any) => (
                          <tr key={bill.id} className="border-t hover:bg-gray-50">
                            <td className="p-3">
                              <Badge className={bill.hospital_name === 'hope' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : bill.hospital_name === 'ayushman' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-800 hover:bg-gray-100'}>
                                {bill.hospital_name === 'hope' ? 'Hope' : bill.hospital_name === 'ayushman' ? 'Ayushman' : bill.hospital_name || '-'}
                              </Badge>
                            </td>
                            <td className="p-3 font-mono font-medium">{bill.formatted_bill_no || bill.bill_no || '-'}</td>
                            <td className="p-3 font-medium">{bill.patientName}</td>
                            <td className="p-3">
                              <Badge variant="outline">{bill.category || '-'}</Badge>
                            </td>
                            <td className="p-3 text-right font-mono font-semibold">
                              Rs. {(Number(bill.total_amount) || 0).toLocaleString('en-IN')}
                            </td>
                            <td className="p-3 text-muted-foreground">
                              {bill.date ? new Date(bill.date).toLocaleDateString('en-IN') : '-'}
                            </td>
                            <td className="p-3 text-muted-foreground">{(bill as any).created_by || '-'}</td>
                            <td className="p-3">
                              <div className="flex items-center justify-center gap-2">
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(bill.id, bill.bill_no)} disabled={isProcessing}>
                                  <CheckCircle className="h-4 w-4 mr-1" /> Approve
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => { setRejectingBillId(bill.id); setRejectDialogOpen(true); }} disabled={isProcessing}>
                                  <XCircle className="h-4 w-4 mr-1" /> Reject
                                </Button>
                                {bill.visitId && (
                                  <Button size="sm" variant="outline" onClick={() => navigate(`/invoice/${bill.visitId}`)}>
                                    <Eye className="h-4 w-4 mr-1" /> View Invoice
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB 2: Pending Discount Approvals ===== */}
          <TabsContent value="discounts">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-orange-500" />
                  Pending Discount Approvals ({filteredVisitDiscounts.length + filteredPharmacyDiscounts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Sub-tab toggle */}
                <div className="flex gap-2 mb-4 border-b pb-3">
                  <button
                    onClick={() => setDiscountSubTab('pharmacy')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${discountSubTab === 'pharmacy' ? 'bg-orange-100 text-orange-800 border border-orange-300' : 'text-muted-foreground hover:bg-gray-100'}`}
                  >
                    Pharmacy Discounts
                    {pendingPharmacyDiscounts.length > 0 && (
                      <span className="ml-2 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">{pendingPharmacyDiscounts.length}</span>
                    )}
                  </button>
                  <button
                    onClick={() => setDiscountSubTab('visit')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${discountSubTab === 'visit' ? 'bg-orange-100 text-orange-800 border border-orange-300' : 'text-muted-foreground hover:bg-gray-100'}`}
                  >
                    Visit Discounts
                    {pendingDiscounts.length > 0 && (
                      <span className="ml-2 bg-orange-500 text-white text-xs rounded-full px-1.5 py-0.5">{pendingDiscounts.length}</span>
                    )}
                  </button>
                </div>

                {/* Pharmacy Discounts sub-tab */}
                {discountSubTab === 'pharmacy' && (
                  filteredPharmacyDiscounts.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        {q ? 'No pharmacy discount requests match your search.' : 'No pharmacy discount requests pending.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-orange-50">
                          <tr>
                            <th className="p-3 text-left">Hospital</th>
                            <th className="p-3 text-left">Bill No</th>
                            <th className="p-3 text-left">Patient</th>
                            <th className="p-3 text-left">Mode</th>
                            <th className="p-3 text-right">Discount</th>
                            <th className="p-3 text-right">Total Amount</th>
                            <th className="p-3 text-left">Requested By</th>
                            <th className="p-3 text-left">Date</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPharmacyDiscounts.map((sale: any) => (
                            <tr key={sale.sale_id} className="border-t hover:bg-orange-50/50">
                              <td className="p-3">
                                <Badge className={sale.hospital_name === 'hope' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : sale.hospital_name === 'ayushman' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-800 hover:bg-gray-100'}>
                                  {sale.hospital_name === 'hope' ? 'Hope' : sale.hospital_name === 'ayushman' ? 'Ayushman' : sale.hospital_name || '-'}
                                </Badge>
                              </td>
                              <td className="p-3 font-mono font-medium">{sale.bill_number || '-'}</td>
                              <td className="p-3 font-medium">{sale.patient_name || '-'}</td>
                              <td className="p-3">
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${sale.payment_method === 'CREDIT' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                                  {sale.payment_method || 'CASH'}
                                </span>
                              </td>
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
                  )
                )}

                {/* Visit Discounts sub-tab */}
                {discountSubTab === 'visit' && (
                  filteredVisitDiscounts.length === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle className="h-10 w-10 text-green-400 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        {q ? 'No visit discount requests match your search.' : 'No visit discount requests pending.'}
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-orange-50">
                          <tr>
                            <th className="p-3 text-left">Hospital</th>
                            <th className="p-3 text-left">Patient</th>
                            <th className="p-3 text-right">Discount Amount</th>
                            <th className="p-3 text-left">Reason</th>
                            <th className="p-3 text-left">Requested By</th>
                            <th className="p-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredVisitDiscounts.map((disc: any) => (
                            <tr key={disc.id} className="border-t hover:bg-orange-50/50">
                              <td className="p-3">
                                <Badge className={disc.hospital_name === 'hope' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100' : disc.hospital_name === 'ayushman' ? 'bg-green-100 text-green-800 hover:bg-green-100' : 'bg-gray-100 text-gray-800 hover:bg-gray-100'}>
                                  {disc.hospital_name === 'hope' ? 'Hope' : disc.hospital_name === 'ayushman' ? 'Ayushman' : disc.hospital_name || '-'}
                                </Badge>
                              </td>
                              <td className="p-3">
                                <div className="font-medium">{disc.patientName}</div>
                                {disc.registrationNumber && <div className="text-xs text-muted-foreground font-mono">{disc.registrationNumber}</div>}
                              </td>
                              <td className="p-3 text-right font-mono font-semibold text-orange-700">
                                Rs. {(Number(disc.discount_amount) || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="p-3 text-muted-foreground">{disc.discount_reason || '-'}</td>
                              <td className="p-3 text-muted-foreground">{disc.applied_by || '-'}</td>
                              <td className="p-3">
                                <div className="flex items-center justify-center gap-2">
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApproveDiscount(disc.id, disc.discount_amount)} disabled={isProcessing}>
                                    <CheckCircle className="h-4 w-4 mr-1" /> Approve
                                  </Button>
                                  <Button size="sm" variant="destructive" onClick={() => { setRejectingDiscountId(disc.id); setDiscountRejectDialogOpen(true); }} disabled={isProcessing}>
                                    <XCircle className="h-4 w-4 mr-1" /> Reject
                                  </Button>
                                  {disc.visitIdStr && (
                                    <Button size="sm" variant="outline" onClick={() => navigate(`/invoice/${disc.visitIdStr}`)}>
                                      <Eye className="h-4 w-4 mr-1" /> View Invoice
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB: Package Approvals ===== */}
          <TabsContent value="packages">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-purple-500" />
                  Pending Package Approvals ({filteredPackages.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredPackages.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>{q ? 'No package approvals match your search.' : 'No pending package approvals'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredPackages.map((pkg: any) => (
                      <Card key={pkg.id} className="border-2 border-purple-200 bg-purple-50/50">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="font-semibold text-lg">{pkg.patientName}</p>
                              <p className="text-sm text-muted-foreground">Visit: {pkg.visit_id}</p>
                              {pkg.registrationNumber && (
                                <p className="text-xs text-muted-foreground">Reg: {pkg.registrationNumber}</p>
                              )}
                            </div>
                            <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                              Package
                            </Badge>
                          </div>
                          <div className="bg-white rounded-lg p-3 mb-3 border">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-600">Package Amount:</span>
                              <span className="text-xl font-bold text-purple-700">
                                Rs. {Number(pkg.package_amount || 0).toLocaleString('en-IN')}
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">Includes Medicine:</span>
                              <Badge variant={pkg.package_includes_medicine ? 'default' : 'secondary'} className="text-xs">
                                {pkg.package_includes_medicine ? 'Yes' : 'No'}
                              </Badge>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-sm text-gray-600">Visit Date:</span>
                              <span className="text-sm">{pkg.visit_date || 'N/A'}</span>
                            </div>
                          </div>
                          {pkg.package_includes_medicine && (
                            <div className="bg-yellow-50 border border-yellow-300 rounded p-2 mb-3">
                              <p className="text-yellow-800 text-xs font-medium">
                                Note: The pharmacy amount included in this package cannot exceed Rs. 20,000.
                                Please call the patient and inform them that medicine costs beyond this limit will be charged separately.
                              </p>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1 bg-green-600 hover:bg-green-700"
                              onClick={() => handleApprovePackage(pkg.id, pkg.visit_id, pkg.package_amount)}
                              disabled={isProcessing}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="flex-1"
                              onClick={() => handleRejectPackage(pkg.id, pkg.visit_id)}
                              disabled={isProcessing}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB 3: Approved Bills — Card Grid with Invoice Links ===== */}
          <TabsContent value="approved">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Approved Bills ({filteredApproved.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoadingApproved ? (
                  <div className="text-center py-8 text-muted-foreground">Loading...</div>
                ) : filteredApproved.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No approved bills yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredApproved.map((bill: any) => (
                      <div
                        key={bill.id}
                        className="group border rounded-lg overflow-hidden hover:shadow-lg transition-all cursor-pointer bg-white"
                        onClick={() => bill.visitId && navigate(`/invoice/${bill.visitId}`)}
                      >
                        {/* Invoice Preview Card */}
                        <div className="bg-gradient-to-br from-gray-50 to-blue-50 p-4 border-b relative">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <FileText className="h-8 w-8 text-blue-400" />
                              {bill.hospital_name && (
                                <Badge className={bill.hospital_name === 'hope' ? 'bg-blue-100 text-blue-800 hover:bg-blue-100 text-xs' : 'bg-green-100 text-green-800 hover:bg-green-100 text-xs'}>
                                  {bill.hospital_name === 'hope' ? 'Hope' : bill.hospital_name === 'ayushman' ? 'Ayushman' : bill.hospital_name}
                                </Badge>
                              )}
                            </div>
                            <Badge className={
                              bill.status === 'FINALIZED'
                                ? 'bg-green-100 text-green-800 hover:bg-green-100'
                                : 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                            }>
                              {bill.status === 'FINALIZED' ? 'Finalized' : 'Approved'}
                            </Badge>
                          </div>
                          {/* Mini invoice preview */}
                          <div className="space-y-1 text-xs text-gray-500 border border-gray-200 rounded bg-white p-2">
                            <div className="flex justify-between">
                              <span className="font-medium text-gray-700">Invoice</span>
                              <span className="font-mono">{bill.formatted_bill_no || bill.bill_no || '-'}</span>
                            </div>
                            <hr className="border-dashed" />
                            <div className="flex justify-between">
                              <span>Patient</span>
                              <span className="text-gray-700 font-medium truncate ml-2 max-w-[120px]">{bill.patientName}</span>
                            </div>
                            {bill.registrationNumber && (
                              <div className="flex justify-between">
                                <span>Reg ID</span>
                                <span className="text-gray-700 font-mono">{bill.registrationNumber}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span>Category</span>
                              <span className="text-gray-700">{bill.category || '-'}</span>
                            </div>
                            <hr className="border-dashed" />
                            <div className="flex justify-between font-semibold text-sm text-gray-800">
                              <span>Total</span>
                              <span>Rs. {(Number(bill.total_amount) || 0).toLocaleString('en-IN')}</span>
                            </div>
                          </div>
                        </div>

                        {/* Card Footer */}
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{bill.date ? new Date(bill.date).toLocaleDateString('en-IN') : '-'}</span>
                            <span>by {(bill as any).approved_by || '-'}</span>
                          </div>
                          {bill.visitId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full group-hover:bg-blue-50 group-hover:border-blue-300 group-hover:text-blue-700 transition-colors"
                              onClick={(e) => { e.stopPropagation(); navigate(`/invoice/${bill.visitId}`); }}
                            >
                              <ExternalLink className="h-3 w-3 mr-2" />
                              Open Invoice
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Bill Reject Dialog */}
        <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Bill</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <label className="text-sm font-medium mb-2 block">Reason for rejection <span className="text-red-500">*</span></label>
              <Textarea
                placeholder="Enter the reason for rejecting this bill..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectionReason(''); }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleReject} disabled={isProcessing || !rejectionReason.trim()}>
                {isProcessing ? 'Rejecting...' : 'Reject Bill'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Pharmacy Discount Reject Dialog */}
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

        {/* Discount Reject Dialog */}
        <Dialog open={discountRejectDialogOpen} onOpenChange={setDiscountRejectDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Discount</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <label className="text-sm font-medium mb-2 block">Reason for rejection <span className="text-red-500">*</span></label>
              <Textarea
                placeholder="Enter the reason for rejecting this discount..."
                value={discountRejectionReason}
                onChange={(e) => setDiscountRejectionReason(e.target.value)}
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDiscountRejectDialogOpen(false); setDiscountRejectionReason(''); }}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRejectDiscount} disabled={isProcessing || !discountRejectionReason.trim()}>
                {isProcessing ? 'Rejecting...' : 'Reject Discount'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default BillApprovals;
