import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Eye, CreditCard, X, Wallet, DollarSign, Calendar, User, Receipt, History, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { toast } from 'sonner';

interface CreditPatient {
  patient_id: string;
  patient_name: string;
  visit_id: string | null;
  total_credit: number;
  total_paid: number;
  total_returns: number;
  balance: number;
  bills: any[];
}

interface CreditPayment {
  id: string;
  sale_id: number;
  amount: number;
  payment_method: string;
  payment_reference: string;
  payment_date: string;
  remarks: string;
}

export const CreditPayments: React.FC = () => {
  const { hospitalConfig, user } = useAuth();
  const [creditPatients, setCreditPatients] = useState<CreditPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<CreditPatient | null>(null);
  const [patientPayments, setPatientPayments] = useState<CreditPayment[]>([]);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'UPI'>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentRemarks, setPaymentRemarks] = useState('');
  const [pharmacyExecutive, setPharmacyExecutive] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // History modal state
  const [showHistory, setShowHistory] = useState(false);
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [totalPayments, setTotalPayments] = useState(0);
  const historyItemsPerPage = 10;

  // Main list pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;

  // Fetch all credit patients
  const fetchCreditPatients = async () => {
    if (!hospitalConfig?.name) return;

    setIsLoading(true);

    // Get all CREDIT sales grouped by patient
    const { data: creditSales, error: salesError } = await supabase
      .from('pharmacy_sales')
      .select('*')
      .eq('hospital_name', hospitalConfig.name)
      .eq('payment_method', 'CREDIT')
      .order('sale_date', { ascending: false });

    if (salesError) {
      console.error('Error fetching credit sales:', salesError);
      setIsLoading(false);
      return;
    }

    // Get all payments
    const { data: payments, error: paymentsError } = await supabase
      .from('pharmacy_credit_payments')
      .select('*')
      .eq('hospital_name', hospitalConfig.name);

    if (paymentsError) {
      console.error('Error fetching payments:', paymentsError);
    }

    // Get all patients to map patient_id (string) to UUID
    const allPatients = await fetchAllRows((from, to) => supabase
      .from('patients')
      .select('id, patients_id')
      .eq('hospital_name', hospitalConfig.name)
      .order('id')
      .range(from, to));

    const patientIdToUuid: { [key: string]: string } = {};
    (allPatients || []).forEach((p: any) => {
      patientIdToUuid[p.patients_id] = p.id;
    });

    // Fetch returns (medicine_returns uses UUID in patient_id)
    const { data: returns, error: returnsError } = await supabase
      .from('medicine_returns')
      .select('*')
      .eq('hospital_name', hospitalConfig.name);

    if (returnsError) {
      console.error('Error fetching returns:', returnsError);
    }

    // Group by visit_id (or patient_id for walk-ins)
    const visitMap: { [key: string]: CreditPatient } = {};

    (creditSales || []).forEach((sale: any) => {
      // Use visit_id as key if available, otherwise use patient_id with sale_id for uniqueness
      const key = sale.visit_id || `walkin-${sale.patient_id || 'unknown'}-${sale.sale_id}`;
      if (!visitMap[key]) {
        visitMap[key] = {
          patient_id: sale.patient_id || 'walk-in',
          patient_name: sale.patient_name || 'Walk-in',
          visit_id: sale.visit_id || null,
          total_credit: 0,
          total_paid: 0,
          total_returns: 0,
          balance: 0,
          bills: []
        };
      }
      visitMap[key].total_credit += sale.total_amount || 0;
      visitMap[key].bills.push(sale);
    });

    // Add payments to totals - filter by visit_id if available
    (payments || []).forEach((payment: any) => {
      // Try to match payment to visit by visit_id first, then by patient_id for legacy payments
      if (payment.visit_id && visitMap[payment.visit_id]) {
        visitMap[payment.visit_id].total_paid += payment.amount || 0;
      } else {
        // For legacy payments without visit_id, distribute to first matching patient visit
        const matchingKey = Object.keys(visitMap).find(
          key => visitMap[key].patient_id === payment.patient_id
        );
        if (matchingKey) {
          visitMap[matchingKey].total_paid += payment.amount || 0;
        }
      }
    });

    // Add returns to totals - filter by visit's sale IDs
    Object.values(visitMap).forEach(visit => {
      const saleIds = visit.bills.map((b: any) => b.sale_id);
      const visitReturns = (returns || []).filter((ret: any) =>
        saleIds.includes(ret.original_sale_id)
      );
      visit.total_returns = visitReturns.reduce((sum: number, r: any) => sum + (r.net_refund || 0), 0);
    });

    // Calculate balance (Credit - Paid - Returns)
    Object.values(visitMap).forEach(visit => {
      visit.balance = visit.total_credit - visit.total_paid - visit.total_returns;
    });

    // Convert to array and sort by balance (highest first)
    const patientsArray = Object.values(visitMap)
      .filter(p => p.balance > 0) // Only show visits with pending balance
      .sort((a, b) => b.balance - a.balance);

    setCreditPatients(patientsArray);
    setIsLoading(false);
  };

  // Fetch payments for selected patient (filtered by visit_id if available)
  const fetchPatientPayments = async (patientId: string, visitId?: string | null) => {
    if (!hospitalConfig?.name) return;

    let query = supabase
      .from('pharmacy_credit_payments')
      .select('*')
      .eq('patient_id', patientId)
      .eq('hospital_name', hospitalConfig.name);

    // Filter by visit_id if provided
    if (visitId) {
      query = query.eq('visit_id', visitId);
    }

    const { data, error } = await query.order('payment_date', { ascending: false });

    if (!error && data) {
      setPatientPayments(data);
    } else {
      setPatientPayments([]);
    }
  };

  // Fetch payment history with pagination
  const fetchPaymentHistory = async (page: number) => {
    if (!hospitalConfig?.name) return;

    const from = (page - 1) * historyItemsPerPage;
    const to = from + historyItemsPerPage - 1;

    const { data, count, error } = await supabase
      .from('pharmacy_credit_payments')
      .select('*', { count: 'exact' })
      .eq('hospital_name', hospitalConfig.name)
      .order('payment_date', { ascending: false })
      .range(from, to);

    if (!error) {
      setAllPayments(data || []);
      setTotalPayments(count || 0);
      setHistoryPage(page);
    }
  };

  // Convert number to words (Indian numbering system)
  const numberToWords = (num: number): string => {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    if (num === 0) return 'Zero';
    if (num < 0) return 'Minus ' + numberToWords(Math.abs(num));

    let words = '';

    if (Math.floor(num / 10000000) > 0) {
      words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
      num %= 10000000;
    }
    if (Math.floor(num / 100000) > 0) {
      words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
      num %= 100000;
    }
    if (Math.floor(num / 1000) > 0) {
      words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
      num %= 1000;
    }
    if (Math.floor(num / 100) > 0) {
      words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
      num %= 100;
    }
    if (num > 0) {
      if (num < 20) {
        words += ones[num];
      } else {
        words += tens[Math.floor(num / 10)];
        if (num % 10 > 0) {
          words += ' ' + ones[num % 10];
        }
      }
    }
    return words.trim();
  };

  // Handle print receipt
  const handlePrintReceipt = (payment: any) => {
    const receiptNo = payment.id?.slice(0, 8).toUpperCase() || Date.now().toString().slice(-8);
    const amountInWords = 'Rupee ' + numberToWords(Math.round(payment.amount || 0));
    const paymentDate = new Date(payment.payment_date).toLocaleString('en-IN');

    const receiptContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Receipt - ${receiptNo}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          h3 { margin-bottom: 30px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
          td { padding: 8px 0; vertical-align: top; }
          td:first-child { width: 200px; font-weight: normal; }
          .amount { font-size: 18px; font-weight: bold; margin: 20px 0; }
          .signatures { display: flex; justify-content: space-between; margin-top: 80px; }
          .signature-box { text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <h3>Receipt No: ${receiptNo}</h3>
        <table>
          <tr>
            <td>Received with thanks from :</td>
            <td>Mr./Ms. ${payment.patient_name || 'N/A'}(${payment.patient_id || 'N/A'})</td>
          </tr>
          <tr>
            <td>The sum of :</td>
            <td>${amountInWords} Only</td>
          </tr>
          <tr>
            <td>By :</td>
            <td>${payment.payment_method || 'N/A'}</td>
          </tr>
          <tr>
            <td>Remarks :</td>
            <td>Being payment received towards pharmacy amt from pt. ${payment.patient_name || 'N/A'}${payment.payment_reference ? ' Ref: ' + payment.payment_reference : ''}</td>
          </tr>
          <tr>
            <td>Date :</td>
            <td>${paymentDate}</td>
          </tr>
        </table>
        <p class="amount">₹${(payment.amount || 0).toFixed(2)}/-</p>
        <p>Pharmacy Executive : <strong>${payment.pharmacy_executive || 'N/A'}</strong></p>
        <div class="signatures">
          <div class="signature-box">Name & Sign of Patient</div>
          <div class="signature-box">Authorised Signatory</div>
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(receiptContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 250);
    }
  };

  // Handle patient selection
  const handleSelectPatient = (patient: CreditPatient) => {
    setSelectedPatient(patient);
    setShowSidePanel(true);
    fetchPatientPayments(patient.patient_id, patient.visit_id);
  };

  // Handle receive payment
  const handleReceivePayment = async () => {
    if (isSubmitting) return; // Prevent double-click
    if (!selectedPatient || !paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const amount = parseFloat(paymentAmount);
    if (amount > selectedPatient.balance) {
      toast.error('Payment amount cannot exceed balance');
      return;
    }

    // Validate hospital config
    if (!hospitalConfig?.name) {
      toast.error('Hospital not configured');
      return;
    }

    setIsSubmitting(true);

    try {
      // Get patient UUID
      const { data: patientData } = await supabase
        .from('patients')
        .select('id')
        .eq('patients_id', selectedPatient.patient_id)
        .eq('hospital_name', hospitalConfig.name)
        .single();

      const { error } = await supabase
        .from('pharmacy_credit_payments')
        .insert({
          patient_id: selectedPatient.patient_id,
          patient_uuid: patientData?.id || null,
          patient_name: selectedPatient.patient_name,
          visit_id: selectedPatient.visit_id,  // Store visit_id for visit-level tracking
          amount: amount,
          payment_method: paymentMethod,
          payment_reference: paymentReference,
          remarks: paymentRemarks,
          pharmacy_executive: pharmacyExecutive || '',
          received_by: user?.name || 'Unknown',
          hospital_name: hospitalConfig?.name
        });

      if (error) {
        console.error('Error saving payment:', error);
        toast.error(`Failed to save payment: ${error.message}`);
        return;
      }

      toast.success(`Payment of ₹${amount.toFixed(2)} received successfully!`);

      // Reset form
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentRemarks('');
      setPharmacyExecutive('');
      setShowPaymentModal(false);

      // Refresh data
      fetchCreditPatients();
      fetchPatientPayments(selectedPatient.patient_id, selectedPatient.visit_id);

      // Update selected patient balance
      setSelectedPatient(prev => prev ? {
        ...prev,
        total_paid: prev.total_paid + amount,
        balance: prev.balance - amount
      } : null);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchCreditPatients();
  }, [hospitalConfig?.name]);

  // Filter patients by search term
  const filteredPatients = creditPatients.filter(p =>
    p.patient_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination for main list
  const totalPages = Math.ceil(filteredPatients.length / pageSize);
  const paginatedPatients = filteredPatients.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Summary stats
  const totalCredit = creditPatients.reduce((sum, p) => sum + p.total_credit, 0);
  const totalPaid = creditPatients.reduce((sum, p) => sum + p.total_paid, 0);
  const totalBalance = creditPatients.reduce((sum, p) => sum + p.balance, 0);

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className={`flex-1 p-4 ${showSidePanel ? 'w-1/2' : 'w-full'}`}>
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-cyan-600" />
            Credit Payments
          </h2>
          <p className="text-sm text-gray-500">Manage credit sales and receive payments</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="text-sm text-blue-600">Total Credit</div>
              <div className="text-2xl font-bold text-blue-700">₹{totalCredit.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-4">
              <div className="text-sm text-green-600">Total Received</div>
              <div className="text-2xl font-bold text-green-700">₹{totalPaid.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4">
              <div className="text-sm text-red-600">Pending Balance</div>
              <div className="text-2xl font-bold text-red-700">₹{totalBalance.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-4 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search patient name or ID..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="pl-10"
            />
          </div>
          <Button onClick={fetchCreditPatients} variant="outline">
            Refresh
          </Button>
          <Button
            onClick={() => { setShowHistory(true); fetchPaymentHistory(1); }}
            variant="outline"
            className="bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200"
          >
            <History className="h-4 w-4 mr-2" />
            History
          </Button>
        </div>

        {/* Credit Patients Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-cyan-600 text-white">
                    <th className="px-4 py-3 text-left text-sm font-semibold">Patient</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Visit</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">Credit Amount</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">Paid</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold">Balance</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                    </tr>
                  ) : filteredPatients.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No credit patients found</td>
                    </tr>
                  ) : (
                    paginatedPatients.map((patient, idx) => (
                      <tr
                        key={patient.visit_id || `${patient.patient_id}-${idx}`}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${selectedPatient?.visit_id === patient.visit_id && selectedPatient?.patient_id === patient.patient_id ? 'bg-cyan-50' : ''}`}
                        onClick={() => handleSelectPatient(patient)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-800">{patient.patient_name}</div>
                          <div className="text-xs text-gray-500">{patient.patient_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          {patient.visit_id ? (
                            <div>
                              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                patient.visit_id.startsWith('IH') ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                              }`}>
                                {patient.visit_id.startsWith('IH') ? 'IPD' : 'OPD'}
                              </span>
                              <div className="text-xs text-gray-500 mt-1 font-mono">{patient.visit_id}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">Walk-in</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-800">₹{patient.total_credit.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-green-600">₹{patient.total_paid.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-600">₹{patient.balance.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectPatient(patient);
                              }}
                              className="h-8 w-8 p-0"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectPatient(patient);
                                setShowPaymentModal(true);
                              }}
                              className="bg-green-600 hover:bg-green-700"
                              title="Receive Payment"
                            >
                              <Wallet className="h-4 w-4 mr-1" />
                              Pay
                            </Button>
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

        {/* Pagination Controls */}
        {filteredPatients.length > 0 && (
          <div className="flex items-center justify-between mt-4 px-2">
            <div className="text-sm text-gray-600">
              Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredPatients.length)} of {filteredPatients.length} entries
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="px-3 py-1 bg-gray-100 rounded text-sm">
                Page {currentPage} of {totalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage >= totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Side Panel */}
      {showSidePanel && selectedPatient && (
        <div
          key={`${selectedPatient.visit_id || 'walkin'}-${selectedPatient.patient_id}-${selectedPatient.bills?.[0]?.sale_id || ''}`}
          className="w-1/2 bg-gray-100 shadow-lg overflow-y-auto border-l border-gray-200"
        >
          <div className="p-4">
            {/* Patient Header */}
            <div className="flex justify-between items-center mb-4 bg-cyan-700 text-white px-4 py-3 rounded">
              <div>
                <div className="font-semibold">{selectedPatient.patient_name}</div>
                <div className="text-sm opacity-80">{selectedPatient.patient_id}</div>
                {selectedPatient.visit_id && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      selectedPatient.visit_id.startsWith('IH') ? 'bg-blue-500' : 'bg-green-500'
                    }`}>
                      {selectedPatient.visit_id.startsWith('IH') ? 'IPD' : 'OPD'}
                    </span>
                    <span className="text-xs opacity-80 font-mono">{selectedPatient.visit_id}</span>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowSidePanel(false)}
                className="text-white hover:bg-cyan-600"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Credit Bills Section */}
            <div className="mb-4">
              <div className="bg-cyan-600 text-white px-3 py-2 text-sm font-semibold rounded-t">
                Credit Bills
              </div>
              <div className="bg-white border border-t-0 rounded-b">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-3 py-2 text-left">Bill No.</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPatient.bills.map((bill: any, idx: number) => (
                      <tr key={bill.sale_id || idx} className="border-b">
                        <td className="px-3 py-2">SB-{bill.sale_id}</td>
                        <td className="px-3 py-2">{new Date(bill.sale_date).toLocaleDateString('en-IN')}</td>
                        <td className="px-3 py-2 text-right">₹{(bill.total_amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-100 font-semibold">
                      <td colSpan={2} className="px-3 py-2 text-right">Total:</td>
                      <td className="px-3 py-2 text-right">₹{selectedPatient.total_credit.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payments Received Section */}
            <div className="mb-4">
              <div className="bg-green-600 text-white px-3 py-2 text-sm font-semibold rounded-t">
                Payments Received
              </div>
              <div className="bg-white border border-t-0 rounded-b">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Method</th>
                      <th className="px-3 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patientPayments.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-gray-500">No payments received yet</td>
                      </tr>
                    ) : (
                      patientPayments.map((payment, idx) => (
                        <tr key={payment.id || idx} className="border-b">
                          <td className="px-3 py-2">{new Date(payment.payment_date).toLocaleDateString('en-IN')}</td>
                          <td className="px-3 py-2 text-right text-green-600">₹{(payment.amount || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-2 py-1 rounded text-xs ${
                              payment.payment_method === 'CASH' ? 'bg-green-100 text-green-700' :
                              payment.payment_method === 'CARD' ? 'bg-blue-100 text-blue-700' :
                              'bg-purple-100 text-purple-700'
                            }`}>
                              {payment.payment_method}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handlePrintReceipt(payment)}
                              className="text-green-600 hover:text-green-800 hover:bg-green-50"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    )}
                    {patientPayments.length > 0 && (
                      <tr className="bg-gray-100 font-semibold">
                        <td className="px-3 py-2 text-right">Total:</td>
                        <td className="px-3 py-2 text-right text-green-600">₹{selectedPatient.total_paid.toFixed(2)}</td>
                        <td></td>
                        <td></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Balance Summary */}
            <div className="bg-gray-800 text-white px-4 py-3 rounded mb-4">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Balance Due:</span>
                <span className="text-2xl font-bold">₹{selectedPatient.balance.toFixed(2)}</span>
              </div>
              <div className="text-xs text-gray-300 mt-1">
                Credit: ₹{selectedPatient.total_credit.toFixed(2)} -
                Paid: ₹{selectedPatient.total_paid.toFixed(2)} -
                Returns: ₹{selectedPatient.total_returns.toFixed(2)}
              </div>
            </div>

            {/* Receive Payment Button */}
            {selectedPatient.balance > 0 && (
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={() => setShowPaymentModal(true)}
              >
                <Wallet className="h-4 w-4 mr-2" />
                Receive Payment
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-green-600" />
              Receive Payment
            </DialogTitle>
          </DialogHeader>

          {selectedPatient && (
            <div className="space-y-4">
              {/* Patient Info */}
              <div className="bg-gray-100 p-3 rounded">
                <div className="flex items-center gap-2 mb-2">
                  <User className="h-4 w-4 text-gray-500" />
                  <span className="font-medium">{selectedPatient.patient_name}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Balance Due: <span className="font-bold text-red-600">₹{selectedPatient.balance.toFixed(2)}</span>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Amount</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Enter amount"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    onClick={() => setPaymentAmount(selectedPatient.balance.toString())}
                  >
                    Pay Full
                  </Button>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Payment Method</label>
                <div className="flex gap-2">
                  {(['CASH', 'CARD', 'UPI'] as const).map((method) => (
                    <Button
                      key={method}
                      variant={paymentMethod === method ? 'default' : 'outline'}
                      onClick={() => setPaymentMethod(method)}
                      className={`flex-1 ${paymentMethod === method ? 'bg-cyan-600' : ''}`}
                    >
                      {method === 'CASH' && <DollarSign className="h-4 w-4 mr-1" />}
                      {method === 'CARD' && <CreditCard className="h-4 w-4 mr-1" />}
                      {method === 'UPI' && <Receipt className="h-4 w-4 mr-1" />}
                      {method}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Payment Reference */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Reference (Optional)</label>
                <Input
                  placeholder="Transaction ID, cheque number, etc."
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>

              {/* Remarks */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Remarks (Optional)</label>
                <Input
                  placeholder="Any notes..."
                  value={paymentRemarks}
                  onChange={(e) => setPaymentRemarks(e.target.value)}
                />
              </div>

              {/* Pharmacy Executive */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">Pharmacy Executive</label>
                <select
                  value={pharmacyExecutive}
                  onChange={(e) => setPharmacyExecutive(e.target.value)}
                  className="w-full h-10 px-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select Executive</option>
                  <option value="Lalit">Lalit</option>
                  <option value="Ruchika">Ruchika</option>
                </select>
              </div>

              {/* Submit Button */}
              <Button
                className="w-full bg-green-600 hover:bg-green-700"
                onClick={handleReceivePayment}
                disabled={isSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
              >
                <Wallet className="h-4 w-4 mr-2" />
                {isSubmitting ? 'Processing...' : `Receive ₹${paymentAmount || '0'}`}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* History Modal */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-purple-600" />
              Payment History
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-purple-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Patient</th>
                  <th className="px-4 py-3 text-left">Visit</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Method</th>
                  <th className="px-4 py-3 text-left">Reference</th>
                  <th className="px-4 py-3 text-left">Pharmacy Executive</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {allPayments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                      No payment history found
                    </td>
                  </tr>
                ) : (
                  allPayments.map((payment, idx) => (
                    <tr key={payment.id || idx} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {new Date(payment.payment_date).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{payment.patient_name}</div>
                        <div className="text-xs text-gray-500">{payment.patient_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        {payment.visit_id ? (
                          <div>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              payment.visit_id.startsWith('IH') ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                            }`}>
                              {payment.visit_id.startsWith('IH') ? 'IPD' : 'OPD'}
                            </span>
                            <div className="text-xs text-gray-500 mt-1 font-mono">{payment.visit_id}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-green-600">
                        ₹{(payment.amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${
                          payment.payment_method === 'CASH' ? 'bg-green-100 text-green-700' :
                          payment.payment_method === 'CARD' ? 'bg-blue-100 text-blue-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {payment.payment_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {payment.payment_reference || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {payment.pharmacy_executive || '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePrintReceipt(payment)}
                          className="text-purple-600 hover:text-purple-800 hover:bg-purple-50"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPayments > 0 && (
            <div className="flex items-center justify-between border-t pt-4 mt-4">
              <div className="text-sm text-gray-600">
                Showing {((historyPage - 1) * historyItemsPerPage) + 1} to {Math.min(historyPage * historyItemsPerPage, totalPayments)} of {totalPayments} payments
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchPaymentHistory(historyPage - 1)}
                  disabled={historyPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="px-3 py-1 bg-gray-100 rounded text-sm">
                  Page {historyPage} of {Math.ceil(totalPayments / historyItemsPerPage)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchPaymentHistory(historyPage + 1)}
                  disabled={historyPage >= Math.ceil(totalPayments / historyItemsPerPage)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreditPayments;
