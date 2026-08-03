import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calendar, Printer, Edit2, Trash2, Eye } from 'lucide-react';
import { usePaymentByVoucherNo } from '@/hooks/useCashBookQueries';
import { useLedgerStatementData, useLedgerBalances } from '@/hooks/useLedgerStatement';
import { printReceipt } from '@/utils/receiptPrinter';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import PaymentDetailsModal from '@/components/PaymentDetailsModal';
import { PatientDetailsModal } from '@/components/PatientDetailsModal';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useCompanies } from '@/hooks/useCompanies';

const LedgerStatement: React.FC = () => {
  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: companies = [] } = useCompanies();
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  // URL-persisted state
  const mrnNo = searchParams.get('mrn') || '';
  const accountName = searchParams.get('account') || 'Saraswat Bank';
  const fromDate = searchParams.get('from') || today;
  const toDate = searchParams.get('to') || today;
  const searchNarration = searchParams.get('narration') || '';
  const searchAmount = searchParams.get('amount') || '';
  const paymentModeFilter = searchParams.get('payMode') || 'ONLINE';

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'from' && value === today) || (key === 'to' && value === today) || (key === 'account' && value === 'Saraswat Bank') || (key === 'payMode' && value === 'ONLINE')) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setMrnNo = (value: string) => updateParams({ mrn: value });
  const setAccountName = (value: string) => updateParams({ account: value });
  const setFromDate = (value: string) => updateParams({ from: value });
  const setToDate = (value: string) => updateParams({ to: value });
  const setSearchNarration = (value: string) => updateParams({ narration: value });
  const setSearchAmount = (value: string) => updateParams({ amount: value });
  const setPaymentModeFilter = (value: string | undefined) => updateParams({ payMode: value || null });

  // Non-persisted state
  const [hideNarration, setHideNarration] = useState(false);
  const [activeMenuItem, setActiveMenuItem] = useState('Ledger Statement');
  const [printingVoucherNo, setPrintingVoucherNo] = useState<string | undefined>(undefined);
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; account_name: string }>>([]);

  // Fetch bank accounts from database
  useEffect(() => {
    const fetchBankAccounts = async () => {
      try {
        const { data, error } = await supabase
          .from('chart_of_accounts')
          .select('id, account_name, account_code')
          .eq('account_group', 'Bank Accounts')
          .eq('is_active', true)
          .order('account_name');

        if (error) throw error;

        // No hardcoded fallback. The placeholder ids ('1', '2') match no
        // account, so selecting one silently produces an empty statement that
        // looks like a real ledger with no activity. Showing nothing at all is
        // honest; showing a bank that does not exist is not.
        // The same bank exists once per company under an identical name; the
        // statement matches by name, so one entry covers all of them.
        const seen = new Set<string>();
        setBankAccounts((data ?? []).filter(a => {
          if (seen.has(a.account_name)) return false;
          seen.add(a.account_name);
          return true;
        }));

        if (!data || data.length === 0) {
          toast.error('No bank accounts are configured.');
        }
      } catch (err) {
        console.error('Exception fetching bank accounts:', err);
        setBankAccounts([]);
        toast.error('Failed to load bank accounts');
      }
    };

    fetchBankAccounts();
  }, []);

  // Auto-set ONLINE mode for bank accounts by default
  useEffect(() => {
    const upper = accountName.toUpperCase();
    if (upper.includes('SARASWAT') ||
        upper.includes('STATE BANK OF INDIA') ||
        upper.includes('CANARA BANK')) {
      setPaymentModeFilter('ONLINE');
    }
  }, [accountName]);

  // Fetch ledger data from database
  const { data: ledgerData, isLoading: isLoadingLedger, error: ledgerError } = useLedgerStatementData({
    accountName,
    fromDate,
    toDate,
    mrnFilter: mrnNo || undefined,
    paymentModeFilter,
  });

  // Calculate balances
  const balances = useLedgerBalances(ledgerData);

  // Debug: Log ledger data to check patient_id values
  useEffect(() => {
    if (ledgerData && ledgerData.length > 0) {
      console.log('📊 Ledger Data Sample (first 3 entries):',
        ledgerData.slice(0, 3).map(entry => ({
          patient_name: entry.patient_name,
          mrn_number: entry.mrn_number,
          patient_id: entry.patient_id,
          patient_id_is_null: entry.patient_id === null,
          voucher_number: entry.voucher_number
        }))
      );
    }
  }, [ledgerData]);

  // State for Payment Details Modal
  const [selectedVoucherNo, setSelectedVoucherNo] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // State for Patient Details Modal
  const [patientToView, setPatientToView] = useState<{ id: string; name: string } | null>(null);
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);

  // Fetch payment data when printing is triggered
  const { data: paymentData, isLoading: isLoadingPayment, error: paymentError } = usePaymentByVoucherNo(printingVoucherNo);

  // Effect to handle printing once data is loaded
  React.useEffect(() => {
    if (printingVoucherNo && paymentData) {
      try {
        printReceipt(paymentData);
        toast.success('Receipt opened for printing');
      } catch (error) {
        console.error('Error printing receipt:', error);
        toast.error('Failed to print receipt');
      } finally {
        // Reset the printing state
        setPrintingVoucherNo(undefined);
      }
    }

    if (printingVoucherNo && paymentError) {
      console.error('Error fetching payment data:', paymentError);
      toast.error('Failed to fetch payment details. Please try again.');
      setPrintingVoucherNo(undefined);
    }
  }, [paymentData, paymentError, printingVoucherNo]);

  // Menu items for the left sidebar
  const sidebarMenuItems = [
    { label: 'Ledger Statement', bgColor: 'bg-gray-400' },
    { label: 'Cash Book', bgColor: 'bg-gray-300' },
    { label: 'Day Book', bgColor: 'bg-gray-300' },
    { label: 'Patient Ledger', bgColor: 'bg-gray-300' },
  ];

  const handleMenuClick = (menuLabel: string) => {
    setActiveMenuItem(menuLabel);

    // Navigate based on menu item
    switch (menuLabel) {
      case 'Cash Book':
        navigate('/cash-book');
        break;
      case 'Ledger Statement':
        // Already on this page
        break;
      case 'Day Book':
        navigate('/day-book');
        break;
      case 'Patient Ledger':
        navigate('/patient-ledger');
        break;
      default:
        break;
    }
  };

  const handleSearch = () => {
    // TODO: Implement search functionality
  };

  const handlePrint = () => {
    window.print();
  };

  const handlePrintReceipt = (voucherNo: string) => {
    if (isLoadingPayment) {
      toast.info('Please wait, loading payment data...');
      return;
    }
    setPrintingVoucherNo(voucherNo);
  };

  const handlePatientClick = (patientId: string, patientName: string) => {
    console.log('🔍 Patient Click Debug:', {
      patientId,
      patientName,
      hasPatientId: !!patientId,
      patientIdType: typeof patientId
    });

    if (patientId) {
      setPatientToView({ id: patientId, name: patientName });
      setIsPatientModalOpen(true);
    } else {
      console.warn('⚠️ Patient ID is null/undefined - modal will not open properly');
    }
  };

  const getPaymentTypeBadge = (paymentType: string) => {
    switch (paymentType) {
      case 'ADVANCE_PAYMENT':
        return <Badge className="bg-green-500 hover:bg-green-600">Advance</Badge>;
      case 'ADVANCE_REFUND':
        return <Badge className="bg-orange-500 hover:bg-orange-600">Refund</Badge>;
      case 'FINAL_PAYMENT':
        return <Badge className="bg-blue-500 hover:bg-blue-600">Final</Badge>;
      default:
        return <Badge variant="secondary">Other</Badge>;
    }
  };

  const formatCurrency = (amount: number) => {
    if (amount === 0) return '';
    return `Rs ${amount.toLocaleString('en-IN')}`;
  };

  const formatDateForDisplay = (dateStr: string) => {
    return dateStr;
  };

  // Helper to format date as DD/MM/YYYY
  const formatDateForExcel = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  // Handler to export Ledger Statement to Excel
  const handleExcelExport = () => {
    if (!ledgerData || ledgerData.length === 0) {
      toast.error('No data to export');
      return;
    }

    // Create workbook
    const workbook = XLSX.utils.book_new();

    // Prepare data array
    const data: any[][] = [];

    // Add title with account name
    data.push([`Ledger : ${accountName}`]);

    // Add date range
    data.push([`${formatDateForExcel(fromDate)} To ${formatDateForExcel(toDate)}`]);
    data.push([]);  // Empty row

    // Add headers
    data.push(['Date', 'Particulars', 'Voucher Type', 'Voucher No.', 'Debit', 'Credit']);

    // Add all transaction entries
    ledgerData.forEach((entry) => {
      // Build particulars string with patient name and narration
      const particulars = entry.narration
        ? `${entry.patient_name}\nNarration : ${entry.narration}`
        : entry.patient_name;

      data.push([
        formatDateForExcel(entry.voucher_date),
        particulars,
        entry.voucher_type || '',
        entry.voucher_number || '',
        entry.debit_amount > 0 ? entry.debit_amount : '',
        entry.credit_amount > 0 ? entry.credit_amount : ''
      ]);
    });

    // Add empty row before balance summary
    data.push([]);

    // Add Opening Balance with Dr/Cr label
    const openingBalanceLabel = balances.openingBalance >= 0 ? 'Dr' : 'Cr';
    data.push([
      '',
      'Opening Balance',
      '',
      '',
      '',
      `${Math.abs(balances.openingBalance).toFixed(2)} ${openingBalanceLabel}`
    ]);

    // Add Current Balance with totals in respective columns
    data.push([
      '',
      'Current Balance :',
      '',
      '',
      balances.currentDebit.toFixed(2),
      balances.currentCredit.toFixed(2)
    ]);

    // Add Closing Balance with Dr/Cr label
    const closingBalanceLabel = balances.closingBalance >= 0 ? 'Dr' : 'Cr';
    data.push([
      '',
      'Closing Balance',
      '',
      '',
      '',
      `${Math.abs(balances.closingBalance).toFixed(2)} ${closingBalanceLabel}`
    ]);

    // Create worksheet from data
    const worksheet = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 },  // Date column
      { wch: 50 },  // Particulars column
      { wch: 15 },  // Voucher Type column
      { wch: 12 },  // Voucher No. column
      { wch: 15 },  // Debit column
      { wch: 15 }   // Credit column
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ledger Statement');

    // Generate filename with date range
    const sanitizedAccountName = accountName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Ledger_${sanitizedAccountName}_${formatDateForExcel(fromDate)}_to_${formatDateForExcel(toDate)}.xlsx`.replace(/\//g, '-');

    // Save file
    XLSX.writeFile(workbook, filename);

    toast.success('Excel file downloaded successfully');
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top Control Bar */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-2 flex justify-between items-center">
        <h1 className="text-white text-xl font-bold">Ledger Vouchers</h1>
        <div className="flex space-x-2">
          <button
            onClick={handleExcelExport}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            Export To Excel
          </button>
          <button
            onClick={handlePrint}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded text-sm font-medium"
          >
            Print
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-gray-500 px-4 py-3 border-b border-gray-400">
        <div className="flex items-center space-x-3">
          {/* Company Filter */}
          <div className="flex items-center">
            <label className="text-white font-semibold text-sm mr-2">Company</label>
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 w-52 bg-white"
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>

          {/* MRN# Input */}
          <div className="flex items-center">
            <label className="text-white font-semibold text-sm mr-2">MRN#</label>
            <input
              type="text"
              value={mrnNo}
              onChange={(e) => setMrnNo(e.target.value)}
              placeholder="Enter Patient MRN No."
              className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 w-48"
            />
          </div>

          {/* Account Dropdown */}
          <div className="flex items-center">
            <label className="text-white font-semibold text-sm mr-2">Account</label>
            <select
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 w-64 bg-white"
            >
              {bankAccounts.map((bank) => (
                <option key={bank.id} value={bank.account_name}>
                  {bank.account_name}
                </option>
              ))}
            </select>
          </div>

          {/* From Date Picker */}
          <div className="flex items-center bg-white border border-gray-300 rounded px-2 py-1">
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-32 outline-none text-sm"
            />
            <Calendar className="h-4 w-4 text-gray-500 ml-1" />
          </div>

          {/* To Date Picker */}
          <div className="flex items-center bg-white border border-gray-300 rounded px-2 py-1">
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-32 outline-none text-sm"
            />
            <Calendar className="h-4 w-4 text-gray-500 ml-1" />
          </div>

          {/* Search by Narration */}
          <input
            type="text"
            value={searchNarration}
            onChange={(e) => setSearchNarration(e.target.value)}
            placeholder="Search by Narration"
            className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 w-48"
          />

          {/* Search by Amount */}
          <input
            type="text"
            value={searchAmount}
            onChange={(e) => setSearchAmount(e.target.value)}
            placeholder="Search by Amount"
            className="px-3 py-1.5 border border-gray-300 rounded text-sm outline-none focus:border-blue-500 w-40"
          />

          {/* Search Button */}
          <button
            onClick={handleSearch}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-1.5 rounded text-sm font-medium"
          >
            Search
          </button>

          {/* Hide Narration Checkbox */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="hideNarration"
              checked={hideNarration}
              onChange={(e) => setHideNarration(e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="hideNarration" className="text-white text-sm font-medium">
              Hide Narration
            </label>
          </div>
        </div>
      </div>

      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Menu */}
        <div className="w-60 bg-gray-200 border-r border-gray-300 overflow-y-auto">
          <div className="py-2">
            {sidebarMenuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => handleMenuClick(item.label)}
                className={`w-full text-left px-4 py-2 text-sm font-medium border-b border-gray-400 hover:bg-gray-400 transition-colors ${
                  item.label === activeMenuItem ? item.bgColor : 'bg-gray-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6 bg-white">
          {accountName ? (
            <div>
              {/* Ledger Header */}
              <div className="flex justify-between items-center mb-4 pb-2 border-b-2 border-yellow-400">
                <h2 className="text-xl font-bold">
                  Ledger : {accountName}
                </h2>
                <p className="text-sm font-medium text-gray-700">
                  {formatDateForDisplay(fromDate)} To {formatDateForDisplay(toDate)}
                </p>
              </div>

              {/* Loading and Error States */}
              {isLoadingLedger && (
                <div className="text-center py-8 text-gray-500">
                  Loading ledger data...
                </div>
              )}
              {ledgerError && (
                <div className="text-center py-8 text-red-500">
                  Error loading ledger data: {ledgerError.message}
                </div>
              )}
              {!isLoadingLedger && ledgerData && ledgerData.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No transactions found for the selected criteria
                </div>
              )}

              {/* Ledger Table */}
              {!isLoadingLedger && ledgerData && ledgerData.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-blue-100">
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Date
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Particulars
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        MRN #
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Visit ID
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Payment Type
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Voucher Type
                      </th>
                      <th className="text-left py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Voucher No.
                      </th>
                      <th className="text-right py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Debit
                      </th>
                      <th className="text-right py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Credit
                      </th>
                      <th className="text-center py-2 px-3 font-semibold text-blue-700 border border-gray-300 text-sm">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerData?.map((entry, index) => (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          {new Date(entry.voucher_date).toLocaleDateString('en-GB')}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          <div
                            className="font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                            onClick={() => handlePatientClick(entry.patient_id, entry.patient_name)}
                            title="Click to view patient details"
                          >
                            {entry.patient_name}
                          </div>
                          {!hideNarration && (
                            <div className="text-xs text-gray-600 italic mt-1">
                              Narration : {entry.narration}
                            </div>
                          )}
                          {entry.payment_mode && (
                            <div className="text-xs text-gray-500 mt-1">
                              Mode: {entry.payment_mode}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          <span className="font-mono text-blue-700">
                            {entry.mrn_number || '-'}
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          <span className="font-mono text-gray-700">
                            {entry.visit_id || '-'}
                          </span>
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          {getPaymentTypeBadge(entry.payment_type)}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          {entry.voucher_type}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm align-top">
                          {entry.voucher_number}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm text-right align-top font-medium">
                          {formatCurrency(entry.debit_amount || 0)}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm text-right align-top font-medium">
                          {formatCurrency(entry.credit_amount || 0)}
                        </td>
                        <td className="py-2 px-3 border border-gray-300 text-sm text-center align-top">
                          <div className="flex justify-center space-x-2">
                            <button
                              className="text-blue-600 hover:text-blue-800 transition-colors"
                              onClick={() => handlePrintReceipt(entry.voucher_number)}
                              title="Print Receipt"
                              disabled={isLoadingPayment}
                            >
                              <Printer className="h-4 w-4" />
                            </button>
                            <button
                              className="text-purple-600 hover:text-purple-800"
                              onClick={() => handlePatientClick(entry.patient_id, entry.patient_name)}
                              title="View Patient Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {/* Balance Summary */}
              {!isLoadingLedger && ledgerData && ledgerData.length > 0 && (
              <div className="mt-6 border-t-2 border-gray-300 pt-4">
                <div className="flex justify-end">
                  <div className="text-right space-y-2">
                    <div className="flex justify-between">
                      <span className="font-semibold mr-8">Opening Balance :</span>
                      <span>Rs {balances.openingBalance.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} Dr</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold mr-8">Current Balance :</span>
                      <div>
                        <span>Rs {balances.currentDebit.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} Dr</span>
                        <span className="ml-4">Rs {balances.currentCredit.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} Cr</span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-semibold mr-8">Closing Balance :</span>
                      <span>Rs {balances.closingBalance.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})} Dr</span>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-lg">
                Select an account or enter search criteria to view ledger statement
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Patient Details Modal */}
      {patientToView && (
        <PatientDetailsModal
          isOpen={isPatientModalOpen}
          onClose={() => setIsPatientModalOpen(false)}
          patient={patientToView}
        />
      )}
    </div>
  );
};

export default LedgerStatement;
