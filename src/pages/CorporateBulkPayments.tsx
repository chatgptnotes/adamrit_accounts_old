import React, { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Building2, Plus, ChevronDown, ChevronRight, Trash2, Pencil, IndianRupee } from 'lucide-react';
import { toast } from 'sonner';
import { useCorporateData } from '@/hooks/useCorporateData';
import {
  useCorporateBulkPayments,
  useDeleteCorporateBulkPayment,
} from '@/hooks/useCorporateBulkPayments';
import { CorporateBulkPayment } from '@/types/corporateBulkPayment';
import BulkPaymentReceiptForm from '@/components/corporate-bulk-payment/BulkPaymentReceiptForm';

const CorporateBulkPayments: React.FC = () => {
  const { hospitalConfig, user } = useAuth();
  const isSuperAdmin = user?.role === 'superadmin' || user?.role === 'super_admin' || user?.role === 'ca';
  const { corporateOptions } = useCorporateData();
  const deleteMutation = useDeleteCorporateBulkPayment();

  // Filters
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterCorporate, setFilterCorporate] = useState('all');

  // Dialog
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<CorporateBulkPayment | null>(null);

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: payments = [], isLoading } = useCorporateBulkPayments({
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    corporate_name: filterCorporate !== 'all' ? filterCorporate : undefined,
    hospital_name: hospitalConfig.name,
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async (id: string, receiptNumber: string) => {
    if (!confirm(`Delete receipt ${receiptNumber}? This will remove all patient allocations.`)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(`Receipt ${receiptNumber} deleted`);
      setExpandedRows((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (error: any) {
      toast.error(`Failed to delete: ${error.message}`);
    }
  };

  // Summary
  const totalReceipts = payments.length;
  const totalAmount = payments.reduce((sum, p) => sum + Number(p.total_amount), 0);

  // Corporate filter options with "All" prepended
  const filterOptions = useMemo(
    () => [{ value: 'all', label: 'All Corporates' }, ...corporateOptions],
    [corporateOptions]
  );

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Corporate Bulk Payment Receipts</h1>
        </div>
        <Button onClick={() => { setEditingPayment(null); setIsFormOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Receipt
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <Label className="text-sm">From Date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">To Date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Corporate</Label>
              <SearchableSelect
                options={filterOptions}
                value={filterCorporate}
                onValueChange={setFilterCorporate}
                placeholder="All Corporates"
                searchPlaceholder="Search corporates..."
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setFilterCorporate('all');
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Building2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Receipts</p>
              <p className="text-xl font-bold">{totalReceipts}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <IndianRupee className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Amount Received</p>
              <p className="text-xl font-bold">
                Rs. {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payment Receipts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : payments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No corporate bulk payment receipts found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Receipt No.</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Corporate</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Bank Name</TableHead>
                    <TableHead className="text-right">Claim Amount</TableHead>
                    <TableHead className="text-right">Total Amount</TableHead>
                    <TableHead className="text-right">Patients</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <React.Fragment key={payment.id}>
                      {/* Main Row */}
                      <TableRow
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleRow(payment.id)}
                      >
                        <TableCell>
                          {expandedRows.has(payment.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          {payment.receipt_number}
                        </TableCell>
                        <TableCell>{formatDate(payment.payment_date)}</TableCell>
                        <TableCell>{payment.corporate_name}</TableCell>
                        <TableCell>{payment.payment_mode}</TableCell>
                        <TableCell>{payment.reference_number || '-'}</TableCell>
                        <TableCell>{payment.bank_name || '-'}</TableCell>
                        <TableCell className="text-right">
                          {payment.claim_amount ? `Rs. ${Number(payment.claim_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          Rs. {Number(payment.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {(() => {
                            // Bulk amount is entered first; patient-wise entry
                            // comes later. Say plainly how much is still
                            // waiting to be allocated to patients.
                            const allocated = (payment.allocations || []).reduce(
                              (sum, alloc) => sum + (Number(alloc.amount) || 0),
                              0
                            );
                            const remaining = Number(payment.total_amount) - allocated;
                            return remaining > 0.5 ? (
                              <span
                                className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"
                                title={`Rs. ${remaining.toLocaleString('en-IN')} not yet allocated to patients`}
                              >
                                {payment.allocations?.length || 0} · Rs. {Math.round(remaining).toLocaleString('en-IN')} pending
                              </span>
                            ) : (
                              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                                {payment.allocations?.length || 0} · allocated
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-blue-500 hover:text-blue-700"
                              title="Edit / add patient-wise allocations"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingPayment(payment);
                                setIsFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {isSuperAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(payment.id, payment.receipt_number);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expanded Allocation Rows */}
                      {expandedRows.has(payment.id) && (
                        <TableRow>
                          <TableCell colSpan={11} className="bg-gray-50 p-0">
                            <div className="p-4">
                              {payment.narration && (
                                <p className="text-sm text-gray-600 mb-3">
                                  <span className="font-medium">Narration:</span>{' '}
                                  {payment.narration}
                                </p>
                              )}
                              {payment.allocations && payment.allocations.length > 0 ? (
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-10">#</TableHead>
                                      <TableHead>Patient Name</TableHead>
                                      <TableHead>Patient ID</TableHead>
                                      <TableHead>Visit ID</TableHead>
                                      <TableHead className="text-right">Bill Amount</TableHead>
                                      <TableHead className="text-right">Received Amt</TableHead>
                                      <TableHead className="text-right">Deduction</TableHead>
                                      <TableHead className="text-right">TDS</TableHead>
                                      <TableHead>Remarks</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {payment.allocations.map((alloc, idx) => (
                                      <TableRow key={alloc.id}>
                                        <TableCell className="text-center">
                                          {idx + 1}
                                        </TableCell>
                                        <TableCell className="font-medium">
                                          {alloc.patient_name}
                                        </TableCell>
                                        <TableCell>
                                          {alloc.patients_id || '-'}
                                        </TableCell>
                                        <TableCell>
                                          {alloc.visit_id || '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {alloc.bill_amount ? `Rs. ${Number(alloc.bill_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          Rs. {Number(alloc.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {alloc.deduction_amount ? `Rs. ${Number(alloc.deduction_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {alloc.tds_amount ? `Rs. ${Number(alloc.tds_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </TableCell>
                                        <TableCell>
                                          {alloc.remarks || '-'}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              ) : (
                                <p className="text-sm text-gray-500">
                                  Patient-wise entry pending — open the pencil to allocate this receipt to patients.
                                </p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Receipt Dialog */}
      <Dialog open={isFormOpen} onOpenChange={(open) => {
        setIsFormOpen(open);
        if (!open) setEditingPayment(null);
      }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingPayment ? 'Edit Corporate Bulk Payment Receipt' : 'New Corporate Bulk Payment Receipt'}
            </DialogTitle>
          </DialogHeader>
          <BulkPaymentReceiptForm
            key={editingPayment?.id || 'new'}
            editData={editingPayment}
            onSuccess={() => {
              setIsFormOpen(false);
              setEditingPayment(null);
            }}
            onCancel={() => {
              setIsFormOpen(false);
              setEditingPayment(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CorporateBulkPayments;
