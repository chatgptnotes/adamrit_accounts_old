import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Loader2, ArrowLeft } from 'lucide-react';
import { useCashBookEntries, useCashBookUsers, useCashBookVoucherTypes, useAllDailyTransactions, DailyTransaction } from '@/hooks/useCashBookQueries';
import { usePaymentVouchers, voucherToEntry } from '@/hooks/usePaymentVouchers';
import PatientTransactionModal from '@/components/PatientTransactionModal';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';
import { useCompanies } from '@/hooks/useCompanies';

const CashBook: React.FC = () => {
  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  // URL-persisted state
  const fromDate = searchParams.get('from') || today;
  const toDate = searchParams.get('to') || today;
  const searchNarration = searchParams.get('narration') || '';
  const searchAmount = searchParams.get('amount') || '';
  const selectedType = searchParams.get('type') || '';
  const selectedUser = searchParams.get('user') || '';
  const selectedPaymentMode = searchParams.get('payMode') || '';
  const hideNarration = searchParams.get('hideNarration') === 'true';

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setFromDate = (value: string) => updateParams({ from: value === today ? null : value });
  const setToDate = (value: string) => updateParams({ to: value === today ? null : value });
  const setSearchNarration = (value: string) => updateParams({ narration: value });
  const setSearchAmount = (value: string) => updateParams({ amount: value });
  const setSelectedType = (value: string) => updateParams({ type: value });
  const setSelectedUser = (value: string) => updateParams({ user: value });
  const setSelectedPaymentMode = (value: string) => updateParams({ payMode: value });
  const setHideNarration = (value: boolean) => updateParams({ hideNarration: value ? 'true' : null });

  // Patient autocomplete state
  const [patientSuggestions, setPatientSuggestions] = useState<Array<{id: string, name: string}>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearchingPatients, setIsSearchingPatients] = useState(false);
  const suggestionRef = useRef<HTMLDivElement>(null);

  // Modal state for patient transaction details
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<{
    patientId?: string;
    visitId?: string;
    patientName?: string;
    transactionDate?: string;
  } | null>(null);

  // Fetch ALL daily transactions from all billing tables (filtered by hospital)
  const { data: dailyTransactions, isLoading, error } = useAllDailyTransactions({
    from_date: fromDate,
    to_date: toDate,
    voucher_type: selectedType || undefined,
    search_narration: searchNarration || undefined,
    payment_mode: selectedPaymentMode || undefined
  }, hospitalConfig.name);

  // Fetch old voucher data for Opening Balance only
  const { data: cashBookData } = useCashBookEntries({
    from_date: fromDate,
    to_date: toDate
  });

  // Payment vouchers (cash paid out) for this hospital → shown as Credit rows
  const { data: paymentVouchers } = usePaymentVouchers(fromDate, toDate, hospitalConfig.name);

  // State for pharmacy credit payments (only for Hope hospital)
  const [pharmacyCreditPayments, setPharmacyCreditPayments] = useState<any[]>([]);

  // State for pharmacy CASH refunds / returns (only for Hope hospital)
  const [pharmacyRefunds, setPharmacyRefunds] = useState<any[]>([]);

  // Fetch pharmacy credit payments for Hope hospital only (CASH payments)
  useEffect(() => {
    const fetchPharmacyCreditPayments = async () => {
      // Only fetch for Hope hospital (check if name contains 'hope', exclude Ayushman)
      if (!hospitalConfig?.name || !hospitalConfig.name.toLowerCase().includes('hope')) {
        setPharmacyCreditPayments([]);
        return;
      }

      const { data, error } = await supabase
        .from('pharmacy_credit_payments')
        .select('*')
        .eq('payment_method', 'CASH')
        .ilike('hospital_name', '%hope%')
        .gte('payment_date', `${fromDate}T00:00:00`)
        .lte('payment_date', `${toDate}T23:59:59`)
        .order('payment_date', { ascending: true });

      if (!error && data) {
        setPharmacyCreditPayments(data);
      } else {
        setPharmacyCreditPayments([]);
      }
    };

    fetchPharmacyCreditPayments();
  }, [fromDate, toDate, hospitalConfig?.name]);

  // Fetch pharmacy CASH refunds (medicine_returns) for Hope hospital only
  useEffect(() => {
    const fetchPharmacyRefunds = async () => {
      // Only fetch for Hope hospital (check if name contains 'hope', exclude Ayushman)
      if (!hospitalConfig?.name || !hospitalConfig.name.toLowerCase().includes('hope')) {
        setPharmacyRefunds([]);
        return;
      }

      // medicine_returns.original_sale_id has no reliable FK to pharmacy_sales,
      // so fetch returns plainly and resolve patient names from `patients` separately.
      const { data, error } = await supabase
        .from('medicine_returns')
        .select('id, return_number, return_date, net_refund, refund_amount, refund_method, status, patient_id')
        .eq('refund_method', 'CASH')
        .eq('status', 'PROCESSED')
        .neq('is_hidden', true)
        .ilike('hospital_name', '%hope%')
        .gte('return_date', `${fromDate}T00:00:00`)
        .lte('return_date', `${toDate}T23:59:59`)
        .order('return_date', { ascending: true });

      if (error || !data || data.length === 0) {
        setPharmacyRefunds([]);
        return;
      }

      // Resolve patient names — medicine_returns.patient_id is the patients table UUID
      const patientIds = [...new Set(data.map((r: any) => r.patient_id).filter(Boolean))];
      const nameById: Record<string, string> = {};
      if (patientIds.length > 0) {
        const { data: patientRows } = await supabase
          .from('patients')
          .select('id, name')
          .in('id', patientIds);
        (patientRows || []).forEach((p: any) => { nameById[p.id] = p.name; });
      }

      setPharmacyRefunds(data.map((r: any) => ({
        ...r,
        patient_name: nameById[r.patient_id] || 'Unknown Patient',
      })));
    };

    fetchPharmacyRefunds();
  }, [fromDate, toDate, hospitalConfig?.name]);

  // Fetch users and voucher types for dropdowns
  const { data: users = [] } = useCashBookUsers();
  const { data: voucherTypes = [] } = useCashBookVoucherTypes();

  // Handler to open patient transaction modal
  const handlePatientClick = (patientId?: string, visitId?: string, patientName?: string, transactionDate?: string) => {
    setSelectedPatient({ patientId, visitId, patientName, transactionDate });
    setIsModalOpen(true);
  };

  // Patient autocomplete search function
  const searchPatients = async (term: string) => {
    if (term.length < 2) {
      setPatientSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    setIsSearchingPatients(true);
    try {
      const { data } = await supabase
        .from('patients')
        .select('id, name')
        .eq('hospital_name', hospitalConfig.name)
        .ilike('name', `%${term}%`)
        .order('name')
        .limit(10);
      setPatientSuggestions(data || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error searching patients:', error);
    }
    setIsSearchingPatients(false);
  };

  // Click outside handler to close suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handler to navigate back to Ledger Statement
  const handleBack = () => {
    navigate('/ledger-statement');
  };

  // Handler to export Cash Book to Excel
  const handleExcelExport = () => {
    if (displayEntries.length === 0) {
      alert('No data to export');
      return;
    }

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data array
    const data: any[][] = [];

    // Add hospital header
    data.push(['Drm Hope Hospitals Pvt Ltd']);
    data.push(['Shreevardhan Complex 3 Rd Floor Ramdaspet']);
    data.push(['Kamptee Road Takia Naka Nagpur']);
    data.push([]);  // Empty row

    // Add title with hospital identifier
    const hospitalIdentifier = hospitalConfig?.name === 'Hope' ? 'HOPE' : hospitalConfig?.name === 'Ayushman' ? 'Ayushman' : 'HOPE';
    data.push([`Cash (${hospitalIdentifier}) Book`]);
    data.push([]);  // Empty row

    // Add date period
    data.push([`For ${formatDateForInput(fromDate)}`]);
    data.push([]);  // Empty row

    // Add headers with voucher columns
    data.push(['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit']);

    // Counter for voucher numbers
    let voucherCounter = 1;

    // Add all entries
    displayEntries.forEach((entry) => {
      if (entry.type === 'opening-balance') {
        data.push([
          entry.date,
          entry.particulars,
          '', // No voucher type for opening balance
          '', // No voucher number for opening balance
          entry.debit > 0 ? entry.debit : '',
          entry.credit > 0 ? entry.credit : ''
        ]);
      } else if (entry.type === 'patient-summary') {
        // Add main row with patient name
        data.push([
          entry.date,
          entry.particulars,
          'Payment', // Voucher type
          voucherCounter++, // Voucher number (auto-increment)
          entry.debit > 0 ? entry.debit : '',
          entry.credit > 0 ? entry.credit : ''
        ]);
        // Add summary as a sub-row (without amounts, just detail)
        if (entry.summary) {
          data.push([
            '',
            `  ${entry.summary}`,
            '',
            '',
            '',
            ''
          ]);
        }
      }
    });

    // Add empty row before totals
    data.push([]);

    // Add total row
    data.push([
      '',
      'Total:',
      '',
      '',
      totals.totalDebit,
      totals.totalCredit
    ]);

    // Add closing balance row
    data.push([
      '',
      'By',
      'Closing Balance',
      '',
      '',
      Math.abs(totals.closingBalance)
    ]);
    data.push([
      '',
      '',
      '',
      '',
      totals.totalDebit,
      totals.totalCredit
    ]);

    // Create worksheet from data
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 },  // Date column
      { wch: 50 },  // Particulars column (wider for summary text)
      { wch: 12 },  // Vch Type column
      { wch: 8 },   // Vch No. column
      { wch: 15 },  // Debit column
      { wch: 15 }   // Credit column
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Cash Book');

    // Generate filename with date range
    const filename = `CashBook_${formatDateForInput(fromDate)}_to_${formatDateForInput(toDate)}.xlsx`.replace(/\//g, '-');

    // Save file
    XLSX.writeFile(workbook, filename);
  };

  // Prepare entries with opening balance and grouped by patient
  const displayEntries = useMemo(() => {
    const entries = [];

    // Add opening balance row
    if (cashBookData?.openingBalance) {
      entries.push({
        type: 'opening-balance' as const,
        date: fromDate,
        particulars: 'Opening Balance',
        debit: cashBookData.openingBalance.opening_balance_type === 'DR'
          ? cashBookData.openingBalance.opening_balance
          : 0,
        credit: cashBookData.openingBalance.opening_balance_type === 'CR'
          ? cashBookData.openingBalance.opening_balance
          : 0,
        patientId: undefined,
        visitId: undefined,
        patientName: undefined,
      });
    }

    // Show only CASH payment transactions (Advance + Final payments + Pharmacy for Hope only)
    if (dailyTransactions && dailyTransactions.length > 0) {
      // Filter to show ONLY payment transactions with CASH payment mode
      // IMPORTANT: Pharmacy transactions only show in Hope hospital, never in Ayushman
      const allowedTransactionTypes = ['ADVANCE_PAYMENT', 'FINAL_BILL'];
      
      // Add pharmacy only for Hope hospital (case-insensitive check)
      if (hospitalConfig?.name?.toLowerCase() === 'hope') {
        allowedTransactionTypes.push('PHARMACY');
      }

      const cashPaymentTransactions = dailyTransactions.filter((txn: DailyTransaction) =>
        allowedTransactionTypes.includes(txn.transaction_type) &&
        txn.payment_mode === 'CASH'
      );

      // Create individual entries for each cash payment transaction (no grouping)
      cashPaymentTransactions.forEach((txn: DailyTransaction) => {
        // Format transaction date
        const date = new Date(txn.transaction_date);
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

        // Determine payment type label
        const paymentType = txn.transaction_type === 'FINAL_BILL'
          ? 'Final Payment'
          : txn.transaction_type === 'PHARMACY'
            ? 'Pharmacy Payment'
            : 'Advance Payment';

        // Build summary line with payment details
        const remarksText = txn.description && txn.description !== 'Advance Payment' ? ` | ${txn.description}` : '';
        const summary = `${paymentType} | CASH: Rs ${txn.amount.toLocaleString('en-IN')}${remarksText}`;

        entries.push({
          type: 'patient-summary' as const,
          date: formattedDate,
          particulars: `${txn.patient_name || 'Unknown Patient'} - ${paymentType}`,
          summary: summary,
          debit: txn.amount,
          credit: 0,
          patientId: txn.patient_id,
          visitId: undefined,
          patientName: txn.patient_name || 'Unknown Patient',
          transactionCount: 1,
          transactionDate: txn.transaction_date
        });
      });
    }

    // Add pharmacy credit payments (for Hope hospital only, CASH payments)
    if (pharmacyCreditPayments && pharmacyCreditPayments.length > 0) {
      pharmacyCreditPayments.forEach((payment: any) => {
        const date = new Date(payment.payment_date);
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

        const remarksText = payment.remarks ? ` | ${payment.remarks}` : '';
        const summary = `Pharmacy Credit Payment | CASH: Rs ${payment.amount.toLocaleString('en-IN')} | Pharmacy Sale${remarksText}`;

        entries.push({
          type: 'patient-summary' as const,
          date: formattedDate,
          particulars: `${payment.patient_name || 'Unknown Patient'} - Pharmacy Credit Payment`,
          summary: summary,
          debit: payment.amount,
          credit: 0,
          patientId: payment.patient_id,
          visitId: payment.visit_id,
          patientName: payment.patient_name || 'Unknown Patient',
          transactionCount: 1,
          transactionDate: payment.payment_date
        });
      });
    }

    // Add pharmacy CASH refunds (for Hope hospital only) as CREDIT rows.
    // Mirrors the original PHARMACY sale DEBIT so sale + refund net to zero.
    if (pharmacyRefunds && pharmacyRefunds.length > 0) {
      pharmacyRefunds.forEach((refund: any) => {
        const date = new Date(refund.return_date);
        const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;

        // Actual cash paid out of the drawer = net_refund (refund_amount - processing_fee)
        const refundCash = Number(refund.net_refund ?? refund.refund_amount ?? 0);

        // Patient name resolved from the patients table in the fetch effect
        const patientName = refund.patient_name || 'Unknown Patient';

        const summary = `Pharmacy Refund | CASH: Rs ${refundCash.toLocaleString('en-IN')} | Return ${refund.return_number}`;

        entries.push({
          type: 'patient-summary' as const,
          date: formattedDate,
          particulars: `${patientName} - Pharmacy Refund`,
          summary: summary,
          debit: 0,
          credit: refundCash,
          patientId: refund.patient_id,
          visitId: undefined,
          patientName: patientName,
          transactionCount: 1,
          transactionDate: refund.return_date
        });
      });
    }

    // Add payment vouchers (cash paid out) as CREDIT rows, by voucher_date.
    if (paymentVouchers && paymentVouchers.length > 0) {
      paymentVouchers.forEach((v) => entries.push(voucherToEntry(v)));
    }

    return entries;
  }, [dailyTransactions, cashBookData, fromDate, pharmacyCreditPayments, pharmacyRefunds, paymentVouchers]);

  // Calculate totals for footer
  const totals = useMemo(() => {
    const totalDebit = displayEntries.reduce((sum, entry) => sum + (entry.debit || 0), 0);
    const totalCredit = displayEntries.reduce((sum, entry) => sum + (entry.credit || 0), 0);
    const closingBalance = totalDebit - totalCredit;

    return {
      totalDebit,
      totalCredit,
      closingBalance
    };
  }, [displayEntries]);

  const formatCurrency = (amount: number) => {
    if (amount === 0) return '';
    return `Rs ${amount.toLocaleString('en-IN')}`;
  };

  const formatCurrencyTotal = (amount: number) => {
    return `Rs ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDateForInput = (dateStr: string) => {
    // Convert YYYY-MM-DD to DD/MM/YYYY for display
    const date = new Date(dateStr);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Top Control Bar */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <button
            onClick={handleBack}
            className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </button>
          <h1 className="text-white text-xl font-bold">Cash Book</h1>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={handleExcelExport}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            Export To Excel
          </button>
          <button
            onClick={() => window.print()}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded text-sm font-medium print:hidden"
          >
            Print
          </button>
        </div>
      </div>

      {/* Date Picker Filter */}
      <div className="bg-gray-200 px-4 py-3 border-b border-gray-300">
        <div className="flex items-center space-x-3">
          {/* Company Filter */}
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 bg-white"
          >
            <option value="">All Companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>

          {/* From Date Picker */}
          <div className="flex items-center bg-white border border-gray-300 rounded px-2 py-1">
            <Calendar className="h-4 w-4 text-gray-500 mr-1" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-32 outline-none text-sm"
            />
          </div>

          {/* To Date Picker */}
          <div className="flex items-center bg-white border border-gray-300 rounded px-2 py-1">
            <Calendar className="h-4 w-4 text-gray-500 mr-1" />
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-32 outline-none text-sm"
            />
          </div>

          {/* Patient Name Search with Autocomplete */}
          <div className="relative" ref={suggestionRef}>
            <input
              type="text"
              placeholder="Search Patient Name..."
              value={searchNarration}
              onChange={(e) => {
                setSearchNarration(e.target.value);
                searchPatients(e.target.value);
              }}
              onFocus={() => {
                if (searchNarration.length >= 2 && patientSuggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              className="px-3 py-1.5 border border-gray-300 rounded bg-white text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48"
            />
            {/* Suggestions Dropdown */}
            {showSuggestions && patientSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-b shadow-lg max-h-48 overflow-y-auto">
                {patientSuggestions.map((patient) => (
                  <div
                    key={patient.id}
                    onClick={() => {
                      setSearchNarration(patient.name);
                      setShowSuggestions(false);
                    }}
                    className="px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm border-b border-gray-100 last:border-b-0"
                  >
                    {patient.name}
                  </div>
                ))}
              </div>
            )}
            {isSearchingPatients && (
              <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-300 rounded-b shadow-lg px-3 py-2 text-sm text-gray-500">
                Searching...
              </div>
            )}
          </div>

          {/* Search Button */}
          <button
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-1.5 rounded text-sm font-medium"
          >
            Search
          </button>
        </div>
      </div>

      {/* Date Range Display */}
      <div className="text-right px-4 py-2 text-sm font-medium text-gray-700 bg-white">
        {formatDateForInput(fromDate)} To {formatDateForInput(toDate)}
      </div>

      {/* Cash Book Table */}
      <div className="flex-1 overflow-auto px-4 bg-white">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <span className="ml-2 text-gray-600">Loading cash book entries...</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center max-w-md">
              <p className="text-red-600 font-medium text-lg mb-2">Error loading cash book</p>
              <p className="text-gray-600 text-sm mb-4">{error.message}</p>
              <div className="bg-blue-50 border border-blue-200 rounded p-4 text-left">
                <p className="text-sm font-medium text-blue-900 mb-2">Troubleshooting:</p>
                <ul className="text-xs text-gray-700 space-y-1 list-disc list-inside">
                  <li>Ensure 'Cash in Hand' account exists in chart_of_accounts table</li>
                  <li>Check if accounting migrations have been run</li>
                  <li>Verify database connection is working</li>
                </ul>
              </div>
            </div>
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-gray-600">No transactions found for the selected date range</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-blue-100 z-10">
              <tr>
                <th className="text-left py-2 px-3 font-semibold text-blue-700 border-b-2 border-gray-300 text-sm w-32">
                  Date
                </th>
                <th className="text-left py-2 px-3 font-semibold text-blue-700 border-b-2 border-gray-300 text-sm">
                  Particulars
                </th>
                <th className="text-right py-2 px-3 font-semibold text-blue-700 border-b-2 border-gray-300 text-sm w-40">
                  Debit
                </th>
                <th className="text-right py-2 px-3 font-semibold text-blue-700 border-b-2 border-gray-300 text-sm w-40">
                  Credit
                </th>
              </tr>
            </thead>
            <tbody>
              {displayEntries.map((entry, index) => {
                if (entry.type === 'opening-balance') {
                  return (
                    <tr key={index} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="py-2 px-3 align-top text-sm">{entry.date}</td>
                      <td className="py-2 px-3 align-top text-sm">
                        <div className="font-medium">{entry.particulars}</div>
                      </td>
                      <td className="py-2 px-3 text-right align-top text-sm font-medium">
                        {formatCurrency(entry.debit)}
                      </td>
                      <td className="py-2 px-3 text-right align-top text-sm font-medium">
                        {formatCurrency(entry.credit)}
                      </td>
                    </tr>
                  );
                }

                if (entry.type === 'patient-summary') {
                  return (
                    <React.Fragment key={index}>
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="py-2 px-3 align-top text-sm">{entry.date}</td>
                        <td className="py-2 px-3 align-top text-sm">
                          <div className="font-bold text-gray-900 text-base">
                            {entry.particulars}
                          </div>
                          <div className="text-xs text-gray-600 mt-1 ml-4">
                            └─ {entry.summary}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right align-top text-sm font-medium">
                          {formatCurrency(entry.debit)}
                        </td>
                        <td className="py-2 px-3 text-right align-top text-sm font-medium">
                          {formatCurrency(entry.credit)}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                }

                return null;
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t-2 border-gray-400">
              <tr>
                <td className="py-3 px-3 text-sm font-bold" colSpan={2}>
                  Total:
                </td>
                <td className="py-3 px-3 text-right text-sm font-bold text-blue-900">
                  {formatCurrencyTotal(totals.totalDebit)}
                </td>
                <td className="py-3 px-3 text-right text-sm font-bold text-blue-900">
                  {formatCurrencyTotal(totals.totalCredit)}
                </td>
              </tr>
              <tr className="bg-red-50">
                <td className="py-3 px-3 text-sm font-bold text-red-700" colSpan={2}>
                  Closing Balance:
                </td>
                <td className="py-3 px-3 text-right text-sm font-bold text-red-700" colSpan={2}>
                  {formatCurrencyTotal(Math.abs(totals.closingBalance))}
                  <span className="ml-2 text-xs">
                    {totals.closingBalance >= 0 ? '(DR)' : '(CR)'}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Patient Transaction Details Modal */}
      <PatientTransactionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        patientId={selectedPatient?.patientId}
        visitId={selectedPatient?.visitId}
        patientName={selectedPatient?.patientName}
        filterDate={selectedPatient?.transactionDate}
      />
    </div>
  );
};

export default CashBook;
