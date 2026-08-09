import React, { useState, useEffect } from 'react';
import TreatmentSheetForm from './TreatmentSheetForm';
import TreatmentSheetPrintView from './TreatmentSheetPrintView';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { FileText, Printer, Eye, EyeOff, Download, Search, Calendar, ChevronLeft, ChevronRight, Receipt, X, Pencil, Copy, Trash2, User, RotateCcw, Wallet, Pill, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Interface for grouping sales by visit (or patient for walk-in)
interface PatientGroup {
  patient_id: string;
  patient_name: string;
  visit_id: string | null;  // null for walk-in/direct sales
  total_amount: number;
  total_discount: number;
  total_paid: number;
  latest_date: string;
  bill_count: number;
  bills: any[];
}

const dummyData = [
  {
    name: 'Shankar Patel',
    id: 'IH23D13024',
    tariff: 'Private',
    total: 0,
    paid: 0,
    discount: 0,
    refund: 0,
    return: 0,
    bal: 0,
  },
  {
    name: 'Amit Sharma',
    id: 'IH23D13025',
    tariff: 'ESIC',
    total: 1000,
    paid: 800,
    discount: 50,
    refund: 0,
    return: 0,
    bal: 150,
  },
  {
    name: 'Priya Singh',
    id: 'IH23D13026',
    tariff: 'Private',
    total: 500,
    paid: 500,
    discount: 0,
    refund: 0,
    return: 0,
    bal: 0,
  },
  {
    name: 'Rahul Verma',
    id: 'IH23D13027',
    tariff: 'ESIC',
    total: 200,
    paid: 100,
    discount: 20,
    refund: 0,
    return: 0,
    bal: 80,
  },
];

export const SalesDetails: React.FC = () => {
  const [billNo, setBillNo] = useState('');
  const [patientName, setPatientName] = useState('');
  const [allEncounter, setAllEncounter] = useState(false);
  const [date, setDate] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('ALL');
  const [paymentStatus, setPaymentStatus] = useState('ALL');
  const [saleTypeFilter, setSaleTypeFilter] = useState('ALL');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hospitalConfig } = useAuth();

  // Get saleId from URL params (for returning from Edit Sale Bill)
  const urlSaleId = searchParams.get('saleId');

  // Patient search state
  const [patientResults, setPatientResults] = useState<{name: string, patients_id: string}[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Table data state
  const [tableData, setTableData] = useState<any[]>([]);

  // Patient groups state (grouped by patient)
  const [patientGroups, setPatientGroups] = useState<PatientGroup[]>([]);

  // Selected patient for viewing bills
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [patientSales, setPatientSales] = useState<any[]>([]);
  const [patientReturns, setPatientReturns] = useState<any[]>([]);
  const [patientCreditPayments, setPatientCreditPayments] = useState<any[]>([]);
  const [showSidePanel, setShowSidePanel] = useState(false);

  // Treatment Sheet dialog
  const [showTreatmentSheet, setShowTreatmentSheet] = useState(false);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  // Panel type for different views
  const [panelType, setPanelType] = useState<'sales' | 'payment' | 'items' | 'medications' | null>(null);
  const [saleItems, setSaleItems] = useState<any[]>([]);

  // View Bill Modal state
  const [viewBillModal, setViewBillModal] = useState<any>(null);
  const [viewBillItems, setViewBillItems] = useState<any[]>([]);

  // Selected bills for printing prescriptions
  const [selectedBills, setSelectedBills] = useState<number[]>([]);

  const [totalCount, setTotalCount] = useState(0);

  // Fetch patients as user types
  useEffect(() => {
    const fetchPatients = async () => {
      if (patientName.length < 2) {
        setPatientResults([]);
        setShowDropdown(false);
        return;
      }
      setIsLoading(true);
      const { data, error } = await supabase
        .from('patients')
        .select('name, patients_id')
        .or(`name.ilike.%${patientName}%,patients_id.ilike.%${patientName}%`)
        .limit(10);
      if (!error && data) {
        setPatientResults(data);
        setShowDropdown(true);
      } else {
        setPatientResults([]);
        setShowDropdown(false);
      }
      setIsLoading(false);
    };
    fetchPatients();
  }, [patientName]);

  const handleSelectPatient = (patient: {name: string, patients_id: string}) => {
    setPatientName(`${patient.name} (${patient.patients_id})`);
    setShowDropdown(false);
  };

  // Payment mode / status / type / date-range filters, applied in the database
  // so they cover every bill and not just the ones already on screen.
  const applyBillFilters = (query: any) => {
    if (paymentMethod !== 'ALL') query = query.eq('payment_method', paymentMethod);
    if (paymentStatus !== 'ALL') {
      if (paymentStatus === 'CANCELLED') query = query.eq('status', 'cancelled');
      else query = query.eq('payment_status', paymentStatus).neq('status', 'cancelled');
    }
    if (saleTypeFilter !== 'ALL') query = query.eq('sale_type', saleTypeFilter);

    if (date || dateTo) {
      if (date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        query = query.gte('sale_date', start.toISOString());
      }
      const end = new Date(dateTo || date);
      end.setHours(23, 59, 59, 999);
      query = query.lte('sale_date', end.toISOString());
    }
    return query;
  };

  const clearFilters = () => {
    setBillNo('');
    setPatientName('');
    setDate('');
    setDateTo('');
    setPaymentMethod('ALL');
    setPaymentStatus('ALL');
    setSaleTypeFilter('ALL');
  };

  const activeFilterCount =
    (billNo.trim() ? 1 : 0) +
    (patientName.trim() ? 1 : 0) +
    (date ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (paymentMethod !== 'ALL' ? 1 : 0) +
    (paymentStatus !== 'ALL' ? 1 : 0) +
    (saleTypeFilter !== 'ALL' ? 1 : 0);

  // Fetch all sales on component mount and group by patient
  useEffect(() => {
    const fetchAllSales = async () => {
      let query = supabase
        .from('pharmacy_sales')
        .select('*', { count: 'exact' })
        .order('sale_date', { ascending: false });

      // Filter by hospital if configured
      if (hospitalConfig?.name) {
        query = query.eq('hospital_name', hospitalConfig.name);
      }

      // Apply search filters to database query (searches ALL records)
      if (billNo.trim()) {
        query = query.ilike('bill_number', `%${billNo.trim()}%`);
      }

      if (patientName.trim()) {
        // Extract patient ID from format "Name (ID)" if present
        const match = patientName.match(/\(([^)]+)\)/);
        if (match) {
          query = query.eq('patient_id', match[1]);
        } else {
          query = query.or(`patient_name.ilike.%${patientName.trim()}%,patient_id.ilike.%${patientName.trim()}%`);
        }
      }

      query = applyBillFilters(query);

      const { data, error, count } = await query;

      // Update total count for pagination
      setTotalCount(count || 0);

      // Fetch credit payments
      const { data: creditPayments } = await supabase
        .from('pharmacy_credit_payments')
        .select('patient_id, amount')
        .eq('hospital_name', hospitalConfig?.name || '');

      if (!error && data) {
        setTableData(data);

        // Group sales by visit_id (or by patient_id for walk-in/direct sales)
        const grouped: { [key: string]: PatientGroup } = {};
        data.forEach((sale: any) => {
          // Use visit_id as key if available, otherwise use patient_id with 'walkin-' prefix
          const key = sale.visit_id || `walkin-${sale.patient_id || 'unknown'}-${sale.sale_id}`;
          if (!grouped[key]) {
            grouped[key] = {
              patient_id: sale.patient_id || 'walk-in',
              patient_name: sale.patient_name || 'Walk-in',
              visit_id: sale.visit_id || null,
              total_amount: 0,
              total_discount: 0,
              total_paid: 0,
              latest_date: sale.sale_date,
              bill_count: 0,
              bills: []
            };
          }
          grouped[key].bills.push(sale);
          grouped[key].total_amount += sale.total_amount || 0;
          grouped[key].total_discount += sale.discount || 0;
          grouped[key].total_paid += sale.payment_method === 'CREDIT' ? 0 : (sale.total_amount || 0);
          grouped[key].bill_count += 1;
          // Update latest_date if this sale is more recent
          if (sale.sale_date && sale.sale_date > grouped[key].latest_date) {
            grouped[key].latest_date = sale.sale_date;
          }
        });

        // Add credit payments to total_paid
        (creditPayments || []).forEach((payment: any) => {
          const key = payment.patient_id || 'walk-in';
          if (grouped[key]) {
            grouped[key].total_paid += payment.amount || 0;
          }
        });

        // Convert to array and sort by latest_date
        const groupedArray = Object.values(grouped).sort((a, b) =>
          new Date(b.latest_date).getTime() - new Date(a.latest_date).getTime()
        );
        setPatientGroups(groupedArray);
      } else {
        setTableData([]);
        setPatientGroups([]);
      }
    };
    fetchAllSales();
  }, [hospitalConfig?.name, billNo, patientName, date, dateTo, paymentMethod, paymentStatus, saleTypeFilter]);

  // Auto-open sidebar when returning from Edit Sale Bill with saleId in URL
  useEffect(() => {
    if (urlSaleId && tableData.length > 0) {
      const sale = tableData.find((s: any) => s.sale_id?.toString() === urlSaleId);
      if (sale) {
        setSelectedPatient(sale);
        setPanelType('sales');
        setShowSidePanel(true);
      }
    }
  }, [urlSaleId, tableData]);

  // Search handler for patient or bill
  const handlePatientSearch = async () => {
    let query = supabase.from('pharmacy_sales').select('*');

    // Filter by hospital
    if (hospitalConfig?.name) {
      query = query.eq('hospital_name', hospitalConfig.name);
    }

    if (patientName.trim()) {
      // Extract patient ID from format "Name (ID)" if present
      const match = patientName.match(/\(([^)]+)\)/);
      if (match) {
        query = query.eq('patient_id', match[1]);
      } else {
        query = query.or(`patient_name.ilike.%${patientName.trim()}%,patient_id.ilike.%${patientName.trim()}%`);
      }
    }

    if (billNo.trim()) {
      query = query.eq('sale_id', parseInt(billNo.trim()));
    }

    query = applyBillFilters(query);

    const { data, error } = await query.order('sale_date', { ascending: false });

    if (!error && data) {
      setTableData(data);

      // Group sales by visit_id (same logic as initial fetch)
      const grouped: { [key: string]: PatientGroup } = {};
      data.forEach((sale: any) => {
        // Use visit_id as key if available, otherwise use patient_id with 'walkin-' prefix
        const key = sale.visit_id || `walkin-${sale.patient_id || 'unknown'}-${sale.sale_id}`;
        if (!grouped[key]) {
          grouped[key] = {
            patient_id: sale.patient_id || 'walk-in',
            patient_name: sale.patient_name || 'Walk-in',
            visit_id: sale.visit_id || null,
            total_amount: 0,
            total_discount: 0,
            total_paid: 0,
            latest_date: sale.sale_date,
            bill_count: 0,
            bills: []
          };
        }
        grouped[key].bills.push(sale);
        grouped[key].total_amount += sale.total_amount || 0;
        grouped[key].total_discount += sale.discount || 0;
        grouped[key].total_paid += sale.payment_method === 'CREDIT' ? 0 : (sale.total_amount || 0);
        grouped[key].bill_count += 1;
        if (sale.sale_date && sale.sale_date > grouped[key].latest_date) {
          grouped[key].latest_date = sale.sale_date;
        }
      });

      const groupedArray = Object.values(grouped).sort((a, b) =>
        new Date(b.latest_date).getTime() - new Date(a.latest_date).getTime()
      );
      setPatientGroups(groupedArray);
    } else {
      setTableData([]);
      setPatientGroups([]);
    }
  };

  const totalBalance = dummyData.reduce((sum, row) => sum + row.bal, 0);

  // Fetch patient returns when patient is selected
  const fetchPatientReturns = async (patientId: string, saleIds?: string[]) => {
    if (!patientId || !hospitalConfig?.name) {
      setPatientReturns([]);
      return;
    }

    // First, get the patient's internal UUID from patients table
    const { data: patientData, error: patientError } = await supabase
      .from('patients')
      .select('id')
      .eq('patients_id', patientId)
      .eq('hospital_name', hospitalConfig.name)
      .single();

    if (patientError || !patientData) {
      setPatientReturns([]);
      return;
    }

    // Build query for medicine_returns (exclude hidden ones)
    let query = supabase
      .from('medicine_returns')
      .select('*')
      .eq('patient_id', patientData.id)
      .eq('hospital_name', hospitalConfig.name)
      .neq('is_hidden', true);

    // Filter by specific sale IDs if provided (to show returns only for selected visit)
    if (saleIds && saleIds.length > 0) {
      query = query.in('original_sale_id', saleIds);
    }

    const { data, error } = await query.order('return_date', { ascending: false });

    if (!error && data) {
      setPatientReturns(data);
    } else {
      setPatientReturns([]);
    }
  };

  // Fetch credit payments received for a patient (filtered by visit_id if provided)
  const fetchPatientCreditPayments = async (patientId: string, visitId?: string | null) => {
    if (!patientId || !hospitalConfig?.name) {
      setPatientCreditPayments([]);
      return;
    }

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
      setPatientCreditPayments(data);
    } else {
      setPatientCreditPayments([]);
    }
  };

  // Fetch all bills for a patient
  const handleViewPatientBills = async (row: any) => {
    setSelectedPatient(row);
    setShowSidePanel(true);

    // Fetch all sales for this patient (with hospital filter)
    let salesQuery = supabase
      .from('pharmacy_sales')
      .select('*')
      .eq('patient_id', row.patient_id);

    // Filter by hospital
    if (hospitalConfig?.name) {
      salesQuery = salesQuery.eq('hospital_name', hospitalConfig.name);
    }

    const { data: salesData, error: salesError } = await salesQuery.order('sale_date', { ascending: false });

    if (!salesError && salesData) {
      setPatientSales(salesData);
    } else {
      setPatientSales([]);
    }

    // Fetch returns (if you have a returns table - placeholder for now)
    // const { data: returnsData } = await supabase
    //   .from('pharmacy_returns')
    //   .select('*')
    //   .eq('patient_id', row.patient_id);
    // setPatientReturns(returnsData || []);
    setPatientReturns([]); // Empty for now
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);

  const printReturnVoucher = (ret: any) => {
    const hospitalFullName = hospitalConfig?.name === 'ayushman'
      ? 'Ayushman Hospital Nagpur' : 'Hope Hospital Nagpur';
    const dateStr = ret.return_date ? new Date(ret.return_date).toLocaleDateString('en-IN') : '-';
    const html = `<!DOCTYPE html>
<html><head><title>Return Voucher - ${ret.return_number || ''}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  h2 { text-align: center; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #666; margin-bottom: 20px; }
  .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .amount { font-size: 18px; font-weight: bold; margin: 20px 0; text-align: right; }
  .totals td { padding: 4px 8px; }
  .signatures { display: flex; justify-content: space-between; margin-top: 60px; }
  .sig-box { text-align: center; border-top: 1px solid #333; padding-top: 5px; width: 180px; font-size: 11px; }
  @media print { body { padding: 15px; } }
</style></head><body>
  <h2>${hospitalFullName}</h2>
  <p class="subtitle">PHARMACY RETURN / REFUND VOUCHER</p>
  <div class="row"><div><strong>Return No:</strong> ${ret.return_number || `RET-${ret.id?.slice(0, 6)}`}</div><div><strong>Date:</strong> ${dateStr}</div></div>
  <div class="row"><div><strong>Patient:</strong> ${selectedPatient?.patient_name || selectedPatient?.name || 'N/A'}</div><div><strong>Reason:</strong> ${ret.return_reason || 'N/A'}</div></div>
  <hr/>
  <table class="totals" style="margin-left:auto">
    <tr><td>Refund Amount:</td><td style="text-align:right">${formatCurrency(ret.refund_amount || 0)}</td></tr>
    ${(ret.processing_fee || 0) > 0 ? `<tr><td>Processing Fee:</td><td style="text-align:right">- ${formatCurrency(ret.processing_fee)}</td></tr>` : ''}
    <tr style="font-weight:bold;border-top:2px solid #333"><td>Net Refund:</td><td style="text-align:right">${formatCurrency(ret.net_refund || 0)}</td></tr>
  </table>
  <p class="amount">${formatCurrency(ret.net_refund || 0)}/-</p>
  <div class="signatures">
    <div class="sig-box">Patient Signature</div>
    <div class="sig-box">Pharmacy Executive</div>
    <div class="sig-box">Authorised Signatory</div>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body></html>`;
    const printWindow = window.open('', '_blank');
    if (printWindow) { printWindow.document.write(html); printWindow.document.close(); }
  };

  const printBill = (sale: any, items: any[]) => {
    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    // Format the date/time
    const billDate = sale.sale_date ? new Date(sale.sale_date) : new Date();
    const formattedDate = `${billDate.getDate().toString().padStart(2, '0')}/${(billDate.getMonth() + 1).toString().padStart(2, '0')}/${billDate.getFullYear()} ${billDate.getHours().toString().padStart(2, '0')}:${billDate.getMinutes().toString().padStart(2, '0')}:${billDate.getSeconds().toString().padStart(2, '0')}`;

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sales Bill - ${sale.bill_number || 'SB-' + sale.sale_id}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
            font-size: 12px;
          }
          .header-container {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
          }
          .header-image {
            width: 100%;
            max-width: 100%;
            height: auto;
            margin-bottom: 5px;
          }
          .bill-title {
            text-align: center;
            color: #cc0000;
            font-size: 16px;
            font-weight: bold;
            margin: 15px 0;
            border-bottom: 2px solid #333;
            padding: 8px 0;
          }
          .bill-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ccc;
          }
          .bill-info-left, .bill-info-right {
            width: 48%;
          }
          .bill-info-row {
            display: flex;
            margin-bottom: 4px;
          }
          .bill-info-label {
            font-weight: bold;
            width: 100px;
          }
          .bill-info-value {
            flex: 1;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
            font-size: 11px;
          }
          .items-table th,
          .items-table td {
            border: 1px solid #999;
            padding: 6px 8px;
            text-align: left;
          }
          .items-table th {
            background-color: #f5f5f5;
            font-weight: bold;
            font-size: 10px;
          }
          .items-table td.amount,
          .items-table th.amount {
            text-align: right;
          }
          .items-table td.center,
          .items-table th.center {
            text-align: center;
          }
          .total-section {
            text-align: right;
            margin: 15px 0;
            font-size: 14px;
            font-weight: bold;
          }
          .total-section .net-total {
            font-size: 16px;
            border-top: 1px solid #333;
            padding-top: 5px;
            margin-top: 5px;
          }
          .signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 50px;
            padding-top: 10px;
          }
          .signature-box {
            width: 45%;
          }
          .signature-line {
            border-top: 1px solid #000;
            padding-top: 5px;
            font-size: 11px;
          }
          .footer-info {
            margin-top: 30px;
            font-size: 9px;
            color: #666;
          }
          @media print {
            body {
              padding: 10px;
            }
          }
        </style>
      </head>
      <body>
        <div class="header-container">
          <img src="/pharmacy_header.png" alt="Hope Pharmacy Header" class="header-image" />
        </div>

        <div class="bill-title">Sales Bill</div>

        <div class="bill-info">
          <div class="bill-info-left">
            <div class="bill-info-row">
              <span class="bill-info-label">Bill No:</span>
              <span class="bill-info-value">${sale.bill_number || 'SB-' + sale.sale_id}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Date:</span>
              <span class="bill-info-value">${formattedDate}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Patient:</span>
              <span class="bill-info-value">${sale.patient_name || '-'}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Prescribed by:</span>
              <span class="bill-info-value">${sale.doctor_name || '-'}</span>
            </div>
          </div>
          <div class="bill-info-right">
            <div class="bill-info-row">
              <span class="bill-info-label">Payment:</span>
              <span class="bill-info-value">${sale.payment_method || 'Cash'}</span>
            </div>
          </div>
        </div>

        <table class="items-table">
          <thead>
            <tr>
              <th style="width: 40%">Item Name</th>
              <th class="center" style="width: 8%">Pkg</th>
              <th class="center" style="width: 15%">Batch No.</th>
              <th class="center" style="width: 12%">Exp Date</th>
              <th class="center" style="width: 8%">Qty</th>
              <th class="amount" style="width: 17%">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td>${item.medication_name || item.medicine_name || '-'}</td>
                <td class="center">${item.pack_size || '1'}</td>
                <td class="center">${item.batch_number || 'N/A'}</td>
                <td class="center">${item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('en-IN') : 'N/A'}</td>
                <td class="center">${item.quantity}</td>
                <td class="amount">${parseFloat(String(item.total_price || item.total_amount || (item.unit_price * item.quantity) || 0)).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="total-section">
          ${(() => {
            const total = parseFloat(String(sale.total_amount || 0));
            const discount = parseFloat(String(sale.discount || 0));
            const subtotal = discount > 0 ? total + discount : total;
            if (discount > 0) {
              return `<div>Subtotal: Rs ${subtotal.toFixed(2)}</div>
              <div>Discount: Rs ${discount.toFixed(2)}</div>
              <div class="net-total">Net Amount: Rs ${total.toFixed(2)}</div>`;
            }
            return `<div>Total: Rs ${total.toFixed(2)}</div>`;
          })()}
        </div>

        <div class="signatures">
          <div class="signature-box">
            <div class="signature-line">Patient Signature</div>
          </div>
          <div class="signature-box" style="text-align: right;">
            <div class="signature-line">Pharmacist Signature</div>
          </div>
        </div>

        <div class="footer-info">
          <div>GST No. 27ACLPV4078L1ZQ</div>
          <div>D.L. No. 20-NAG/136/2009, 21-NAG/136/2009</div>
        </div>

        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(receiptHTML);
    printWindow.document.close();
  };

  const handlePrintBill = async (sale: any) => {
    if (sale.payment_status === 'PENDING_DISCOUNT_APPROVAL') {
      alert('Print blocked: This bill has a pending discount awaiting admin approval.\nOnce the admin approves, printing will be available here.');
      return;
    }
    const { data, error } = await supabase
      .from('pharmacy_sale_items')
      .select('*')
      .eq('sale_id', sale.sale_id);

    if (!error && data) {
      printBill(sale, data);
    }
  };

  // Print selected bills as prescriptions (2-up format)
  const printSelectedPrescriptions = async () => {
    if (selectedBills.length === 0) return;

    // Get the selected bills data — exclude pending-approval and cancelled bills from bulk print
    const selectedBillsData = selectedPatient?.bills?.filter((bill: any) =>
      selectedBills.includes(bill.sale_id) &&
      bill.payment_status !== 'PENDING_DISCOUNT_APPROVAL' &&
      bill.payment_status !== 'CANCELLED'
    ) || [];

    if (selectedBillsData.length < (selectedPatient?.bills?.filter((b: any) => selectedBills.includes(b.sale_id)).length || 0)) {
      alert('Note: Bills with pending admin approval or cancelled status were excluded from the print.');
    }

    if (selectedBillsData.length === 0) return;

    // Fetch items for all selected bills
    const billsWithItems: any[] = [];
    for (const bill of selectedBillsData) {
      const { data, error } = await supabase
        .from('pharmacy_sale_items')
        .select('*')
        .eq('sale_id', bill.sale_id);

      if (!error && data) {
        billsWithItems.push({ ...bill, items: data });
      }
    }

    const printWindow = window.open('', '', 'width=1000,height=800');
    if (!printWindow) return;

    // Generate prescriptions - one per selected bill
    const prescriptions: string[] = [];

    for (const bill of billsWithItems) {
      const billDate = bill.sale_date ? new Date(bill.sale_date) : new Date();
      const formattedDate = `${billDate.getDate().toString().padStart(2, '0')}/${(billDate.getMonth() + 1).toString().padStart(2, '0')}/${billDate.getFullYear()}`;

      const prescriptionHTML = `
        <div class="prescription">
          <div class="header-section">
            <div class="logo-row">
              <img src="/left_logo.jpeg" alt="NABH" class="left-logo" />
              <div class="title">Prescription</div>
              <img src="/right_logo.jpeg" alt="Hope Hospitals" class="right-logo" />
            </div>
            <div class="patient-info">
              <div class="info-row">
                <span class="label">Patient Name :</span>
                <span class="value">${bill.patient_name || '-'}</span>
              </div>
              <div class="info-row">
                <span class="label">Registration Number :</span>
                <span class="value">${bill.patient_id || '-'}</span>
              </div>
            </div>
          </div>
          <div class="rx-section">
            <div class="rx-header">
              <span class="rx">Rx</span>
              <span class="date">Date : ${formattedDate}</span>
            </div>
            <div class="medicines-list">
              ${bill.items.map((item: any) => `
                <div class="medicine-row">
                  <span class="medicine-name">${item.medication_name || item.medicine_name || '-'}</span>
                  <span class="medicine-qty">${item.quantity}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="doctor-signature">
            <div class="signature-line"></div>
            <span>${bill.doctor_name || 'Dr. Afzal Sheikh (MD Medicine)'}</span>
          </div>
        </div>
      `;
      prescriptions.push(prescriptionHTML);
    }

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Prescriptions</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, sans-serif;
            padding: 10px;
          }
          .prescriptions-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          .prescription {
            padding: 15px;
            page-break-inside: avoid;
            min-height: 400px;
            display: flex;
            flex-direction: column;
          }
          .header-section {
            padding-bottom: 8px;
            border-bottom: 1px solid #000;
            margin-bottom: 0;
          }
          .logo-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
          }
          .left-logo {
            width: 55px;
            height: auto;
          }
          .right-logo {
            width: 85px;
            height: auto;
          }
          .title {
            font-size: 18px;
            font-weight: bold;
            color: #c00;
            text-decoration: underline;
          }
          .patient-info {
            margin-top: 5px;
          }
          .info-row {
            display: flex;
            margin-bottom: 2px;
            font-size: 12px;
          }
          .info-row .label {
            font-weight: bold;
            width: 150px;
          }
          .info-row .value {
            flex: 1;
          }
          .rx-section {
            flex: 1;
            padding: 0;
          }
          .rx-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #000;
          }
          .rx {
            font-size: 13px;
            font-weight: normal;
            padding-left: 15px;
          }
          .date {
            font-size: 12px;
            text-align: right;
          }
          .medicines-list {
            padding: 8px 0 8px 40px;
          }
          .medicine-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 3px;
            font-size: 12px;
          }
          .medicine-name {
            flex: 1;
          }
          .medicine-qty {
            width: 50px;
            text-align: right;
          }
          .doctor-signature {
            margin-top: auto;
            padding-top: 15px;
            font-size: 12px;
            font-weight: bold;
          }
          .signature-line {
            border-top: 1px solid #000;
            margin-bottom: 8px;
          }
          @media print {
            body {
              padding: 0;
            }
            .prescriptions-container {
              gap: 10px;
            }
            .prescription {
              border: 1px solid #000;
            }
          }
          .print-btn {
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 10px 20px;
            background: #007bff;
            color: white;
            border: none;
            cursor: pointer;
            font-size: 14px;
          }
          @media print {
            .print-btn {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <button class="print-btn" onclick="window.print()">Print</button>
        <div class="prescriptions-container">
          ${prescriptions.join('')}
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(receiptHTML);
    printWindow.document.close();
  };

  // View Bill Modal handler
  const handleViewBillModal = async (bill: any) => {
    const { data, error } = await supabase
      .from('pharmacy_sale_items')
      .select('*')
      .eq('sale_id', bill.sale_id);

    if (!error && data) {
      setViewBillItems(data);
    } else {
      setViewBillItems([]);
    }
    setViewBillModal(bill);
  };

  // Mark Bill as Cancelled (soft-delete — bills can never be deleted for audit trail)
  const handleDeleteBill = async (bill: any) => {
    if (!confirm('Are you sure you want to cancel this bill? The bill will be marked as cancelled and hidden from active views. This preserves the audit trail.')) return;

    // Mark the sale as cancelled (soft-delete)
    const { error: saleError } = await (supabase as any)
      .from('pharmacy_sales')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('sale_id', bill.sale_id);

    if (saleError) {
      console.error('Error cancelling sale:', saleError);
      alert('Error cancelling bill');
      return;
    }

    // Update state - remove cancelled bill from view
    if (selectedPatient) {
      setSelectedPatient((prev: any) => ({
        ...prev,
        bills: prev.bills.filter((b: any) => b.sale_id !== bill.sale_id)
      }));
    }

    // Update patientGroups state
    setPatientGroups(prev => prev.map(group => ({
      ...group,
      bills: group.bills.filter(b => b.sale_id !== bill.sale_id),
      bill_count: group.bills.filter(b => b.sale_id !== bill.sale_id).length,
      total_amount: group.bills.filter(b => b.sale_id !== bill.sale_id).reduce((sum, b) => sum + (b.total_amount || 0), 0),
      total_paid: group.bills.filter(b => b.sale_id !== bill.sale_id).reduce((sum, b) => sum + (b.payment_method === 'CREDIT' ? 0 : (b.total_amount || 0)), 0),
      total_discount: group.bills.filter(b => b.sale_id !== bill.sale_id).reduce((sum, b) => sum + (b.discount || 0), 0)
    })).filter(group => group.bills.length > 0));

    // Update tableData
    setTableData(prev => prev.filter(s => s.sale_id !== bill.sale_id));

    alert('Bill cancelled successfully. Audit trail preserved.');
  };

  const handleOpenTreatmentSheet = (visitId: string) => {
    setSelectedVisitId(visitId);
    setShowTreatmentSheet(true);
  };

  // Open side panel with specific content type
  const handleOpenPanel = async (row: any, type: 'sales' | 'payment' | 'items' | 'medications') => {
    setSelectedPatient(row);
    setPanelType(type);
    setShowSidePanel(true);

    // Fetch sale items if needed for items or medications view
    if (type === 'items' || type === 'medications') {
      const { data, error } = await supabase
        .from('pharmacy_sale_items')
        .select('*')
        .eq('sale_id', row.sale_id);

      if (!error && data) {
        setSaleItems(data);
      } else {
        setSaleItems([]);
      }
    }
  };

  // Print payment details table
  const printPaymentDetails = () => {
    if (!selectedPatient || !selectedPatient.bills) return;

    const bills = selectedPatient.bills.filter(
      (b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED'
    );

    // Calculate totals
    const totalPaid = bills.reduce((sum: number, b: any) => {
      const isCredit = b.payment_method === 'CREDIT';
      return sum + (isCredit ? 0 : (b.total_amount || 0));
    }, 0);
    const totalDiscount = bills.reduce((sum: number, b: any) => sum + (b.discount || 0), 0);
    const totalBalance = bills.reduce((sum: number, b: any) => {
      const isCredit = b.payment_method === 'CREDIT';
      return sum + (isCredit ? (b.total_amount || 0) : 0);
    }, 0);

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    const rowsHTML = bills.map((bill: any) => {
      const isCredit = bill.payment_method === 'CREDIT';
      const paidAmt = isCredit ? 0 : (bill.total_amount || 0);
      const balance = isCredit ? (bill.total_amount || 0) : 0;
      return `
        <tr>
          <td>${bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-'}</td>
          <td class="right">${paidAmt.toFixed(2)}</td>
          <td class="right">${(bill.discount || 0).toFixed(2)}</td>
          <td class="right balance">${balance.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Details - ${selectedPatient.patient_name || 'Walk-in'}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; }
          .header { margin-bottom: 20px; }
          .patient-name { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
          .patient-id { font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #333; padding: 8px; text-align: left; font-size: 12px; }
          th { background-color: #0891b2; color: white; }
          .right { text-align: right; }
          .balance { color: #dc2626; }
          tfoot td { font-weight: bold; background-color: #f3f4f6; }
          @media print { body { padding: 10px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="patient-name">Patient Name: ${selectedPatient.patient_name || 'Walk-in'}</div>
          <div class="patient-id">Patient ID: ${selectedPatient.patient_id || '-'}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th class="right">Paid Amt</th>
              <th class="right">Discount Given</th>
              <th class="right">Credit Pending</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHTML}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="right">${totalPaid.toFixed(2)}</td>
              <td class="right">${totalDiscount.toFixed(2)}</td>
              <td class="right balance">${totalBalance.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  // Print sale details table
  const printSaleDetails = () => {
    if (!selectedPatient || !selectedPatient.bills) return;

    const bills = selectedPatient.bills.filter(
      (b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED'
    );

    // Sort bills by date ascending
    const sortedBills = [...bills].sort((a: any, b: any) =>
      new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime()
    );

    // Calculate totals
    const totalDebit = bills.reduce((sum: number, b: any) => {
      return sum + (b.payment_method !== 'CREDIT' ? (b.total_amount || 0) : 0);
    }, 0);
    const totalCredit = bills.reduce((sum: number, b: any) => {
      return sum + (b.payment_method === 'CREDIT' ? (b.total_amount || 0) : 0);
    }, 0);
    const totalBalance = totalCredit;

    // Get date range
    const startDate = sortedBills.length > 0 ? new Date(sortedBills[0]?.sale_date).toLocaleDateString('en-IN') : '-';
    const endDate = sortedBills.length > 0 ? new Date(sortedBills[sortedBills.length - 1]?.sale_date).toLocaleDateString('en-IN') : '-';

    const printWindow = window.open('', '', 'width=900,height=700');
    if (!printWindow) return;

    let runningBalance = 0;
    const rowsHTML = sortedBills.map((bill: any) => {
      const amount = bill.total_amount || 0;
      const isCredit = bill.payment_method === 'CREDIT';
      const credit = isCredit ? amount : 0;
      const debit = isCredit ? 0 : amount;
      runningBalance = runningBalance + credit;
      return `
        <tr>
          <td style="border: 1px solid #333; padding: 8px;">${bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-'}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: center;">SB-${bill.sale_id}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: right;">${debit.toFixed(2)}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: right;">${credit.toFixed(2)}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: right;">${runningBalance.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sale Details - ${selectedPatient.patient_name || 'Walk-in'}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 10px; }
          table { width: 100%; border-collapse: collapse; }
          .header { text-align: center; font-weight: bold; padding: 8px; border: 1px solid #333; }
          .subheader { text-align: center; padding: 6px; border: 1px solid #333; border-top: none; }
          .col-header { background-color: #67b7c7; color: #0c4a5c; padding: 8px; border: 1px solid #333; font-size: 12px; font-weight: bold; }
          td { font-size: 12px; }
          .total-row td { font-weight: bold; background-color: #f3f4f6; }
          @media print { body { padding: 5px; } }
        </style>
      </head>
      <body>
        <table>
          <tbody>
            <tr>
              <td colspan="5" class="header">HOPE HOSPITAL PHARMACY</td>
            </tr>
            <tr>
              <td colspan="5" class="subheader">List Of Pharmacy Sale Bills from : ${startDate} TO ${endDate}</td>
            </tr>
            <tr>
              <td colspan="5" class="subheader" style="font-weight: 500;">${selectedPatient.patient_id || '-'} ${selectedPatient.patient_name || 'Walk-in'}</td>
            </tr>
            <tr>
              <td class="col-header" style="text-align: left;">Date</td>
              <td class="col-header" style="text-align: center;">Bill No</td>
              <td class="col-header" style="text-align: right;">Debit</td>
              <td class="col-header" style="text-align: right;">Credit</td>
              <td class="col-header" style="text-align: right;">Balance</td>
            </tr>
            ${rowsHTML}
            <tr class="total-row">
              <td style="border: 1px solid #333; padding: 8px; font-weight: bold;">Total</td>
              <td style="border: 1px solid #333; padding: 8px;"></td>
              <td style="border: 1px solid #333; padding: 8px; text-align: right;">${totalDebit.toFixed(2)}</td>
              <td style="border: 1px solid #333; padding: 8px; text-align: right;">${totalCredit.toFixed(2)}</td>
              <td style="border: 1px solid #333; padding: 8px; text-align: right; font-weight: bold;">${totalBalance.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  // Print medications details table
  const printMedicationDetails = () => {
    if (!selectedPatient || saleItems.length === 0) return;

    // Get date range
    const startDate = selectedPatient.bills && selectedPatient.bills.length > 0
      ? new Date(selectedPatient.bills[selectedPatient.bills.length - 1]?.sale_date).toLocaleDateString('en-IN')
      : '-';
    const endDate = selectedPatient.bills && selectedPatient.bills.length > 0
      ? new Date(selectedPatient.bills[0]?.sale_date).toLocaleDateString('en-IN')
      : '-';

    const printWindow = window.open('', '', 'width=900,height=700');
    if (!printWindow) return;

    const rowsHTML = saleItems.map((item: any, idx: number) => {
      const amount = (item.unit_price || 0) * (item.quantity || 0);
      return `
        <tr>
          <td style="border: 1px solid #333; padding: 6px;">${idx + 1}</td>
          <td style="border: 1px solid #333; padding: 6px;">${item.medication_name || item.medicine_name}</td>
          <td style="border: 1px solid #333; padding: 6px; text-align: center;">${item.pharmacy_sales?.sale_date ? new Date(item.pharmacy_sales.sale_date).toLocaleDateString('en-IN') : '-'}</td>
          <td style="border: 1px solid #333; padding: 6px; text-align: center;">${item.quantity}</td>
          <td style="border: 1px solid #333; padding: 6px; text-align: right;">${amount.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    // Calculate total
    const totalAmount = saleItems.reduce((sum: number, item: any) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 0);

    const printHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Medication Details - ${selectedPatient.patient_name || 'Walk-in'}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 10px; }
          table { width: 100%; border-collapse: collapse; }
          .header { text-align: center; font-weight: bold; padding: 8px; border: 1px solid #333; background-color: #ffe4e6; }
          .subheader { text-align: center; padding: 6px; border: 1px solid #333; border-top: none; }
          .col-header { background-color: #67b7c7; color: #0c4a5c; padding: 6px; border: 1px solid #333; font-size: 11px; font-weight: bold; }
          td { font-size: 11px; }
          @media print { body { padding: 5px; } }
        </style>
      </head>
      <body>
        <table>
          <tbody>
            <tr>
              <td colspan="5" class="header">HOPE MULTISPECIALITY HOSPITAL & RESEARCH CENTER</td>
            </tr>
            <tr>
              <td colspan="5" class="subheader" style="font-weight: bold;">PHARMACY STATEMENT</td>
            </tr>
            <tr>
              <td colspan="5" class="subheader" style="font-weight: 500;">${selectedPatient.patient_name || 'Walk-in'}</td>
            </tr>
            <tr>
              <td colspan="5" class="subheader">List Of Issued Drugs From : ${startDate} To ${endDate}</td>
            </tr>
            <tr>
              <td class="col-header" style="text-align: left;">Sr.No.</td>
              <td class="col-header" style="text-align: left;">Service Name</td>
              <td class="col-header" style="text-align: center;">Date</td>
              <td class="col-header" style="text-align: center;">Quantity</td>
              <td class="col-header" style="text-align: right;">Amount</td>
            </tr>
            ${rowsHTML}
            <tr style="background-color: #f3f4f6; font-weight: bold; border-top: 2px solid #333;">
              <td colspan="4" style="border: 1px solid #333; padding: 6px; text-align: right;">Total</td>
              <td style="border: 1px solid #333; padding: 6px; text-align: right;">${totalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <script>window.onload = function() { window.print(); };</script>
      </body>
      </html>
    `;

    printWindow.document.write(printHTML);
    printWindow.document.close();
  };

  // Export medication details to Excel using ExcelJS for proper styling
  const exportMedicationToExcel = async () => {
    if (!selectedPatient || saleItems.length === 0) return;

    // Get date range
    const startDate = selectedPatient.bills && selectedPatient.bills.length > 0
      ? new Date(selectedPatient.bills[selectedPatient.bills.length - 1]?.sale_date).toLocaleDateString('en-IN')
      : '-';
    const endDate = selectedPatient.bills && selectedPatient.bills.length > 0
      ? new Date(selectedPatient.bills[0]?.sale_date).toLocaleDateString('en-IN')
      : '-';

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Medication Details');

    // Set column widths
    worksheet.columns = [
      { key: 'srno', width: 8 },
      { key: 'service', width: 35 },
      { key: 'date', width: 15 },
      { key: 'quantity', width: 12 },
      { key: 'amount', width: 12 }
    ];

    // Add header rows with center alignment
    const headerRow1 = worksheet.addRow(['HOPE MULTISPECIALITY HOSPITAL & RESEARCH CENTER']);
    worksheet.mergeCells('A1:E1');
    headerRow1.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow1.getCell(1).font = { bold: true, size: 12 };

    const headerRow2 = worksheet.addRow(['PHARMACY STATEMENT']);
    worksheet.mergeCells('A2:E2');
    headerRow2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow2.getCell(1).font = { bold: true };

    const headerRow3 = worksheet.addRow([selectedPatient.patient_name || 'Walk-in']);
    worksheet.mergeCells('A3:E3');
    headerRow3.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    const headerRow4 = worksheet.addRow([`List Of Issued Drugs From : ${startDate} To ${endDate}`]);
    worksheet.mergeCells('A4:E4');
    headerRow4.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Add empty row
    worksheet.addRow([]);

    // Add column headers
    const columnHeaderRow = worksheet.addRow(['Sr.No.', 'Service Name', 'Date', 'Quantity', 'Amount']);
    columnHeaderRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF67B7C7' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Add data rows
    let totalAmount = 0;
    saleItems.forEach((item: any, idx: number) => {
      const amount = (item.unit_price || 0) * (item.quantity || 0);
      totalAmount += amount;
      const row = worksheet.addRow([
        idx + 1,
        item.medication_name || item.medicine_name,
        item.pharmacy_sales?.sale_date ? new Date(item.pharmacy_sales.sale_date).toLocaleDateString('en-IN') : '-',
        item.quantity,
        amount.toFixed(2)
      ]);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      // Right align amount
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'center' };
    });

    // Add total row
    const totalRow = worksheet.addRow(['', '', '', 'Total', totalAmount.toFixed(2)]);
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      if (colNumber === 5) {
        cell.alignment = { horizontal: 'right' };
      }
    });

    // Generate filename
    const fileName = `Pharmacy_Statement_${(selectedPatient.patient_name || 'Walk-in').replace(/\s+/g, '_')}_${new Date().toLocaleDateString('en-IN').replace(/\//g, '-')}.xlsx`;

    // Download the file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  // Export sale details to Excel using ExcelJS
  const exportSaleDetailsToExcel = async () => {
    if (!selectedPatient || !selectedPatient.bills || selectedPatient.bills.length === 0) return;

    const bills = selectedPatient.bills.filter(
      (b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED'
    );

    // Sort bills by date ascending
    const sortedBills = [...bills].sort((a: any, b: any) =>
      new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime()
    );

    // Get date range
    const startDate = sortedBills.length > 0 ? new Date(sortedBills[0]?.sale_date).toLocaleDateString('en-IN') : '-';
    const endDate = sortedBills.length > 0 ? new Date(sortedBills[sortedBills.length - 1]?.sale_date).toLocaleDateString('en-IN') : '-';

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sale Details');

    // Set column widths
    worksheet.columns = [
      { key: 'date', width: 15 },
      { key: 'billno', width: 15 },
      { key: 'debit', width: 12 },
      { key: 'credit', width: 12 },
      { key: 'balance', width: 12 }
    ];

    // Add header rows with center alignment
    const headerRow1 = worksheet.addRow(['HOPE HOSPITAL PHARMACY']);
    worksheet.mergeCells('A1:E1');
    headerRow1.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow1.getCell(1).font = { bold: true, size: 12 };

    const headerRow2 = worksheet.addRow([`List Of Pharmacy Sale Bills from : ${startDate} TO ${endDate}`]);
    worksheet.mergeCells('A2:E2');
    headerRow2.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

    const headerRow3 = worksheet.addRow([`${selectedPatient.patient_id || ''} ${selectedPatient.patient_name || 'Walk-in'}`]);
    worksheet.mergeCells('A3:E3');
    headerRow3.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow3.getCell(1).font = { bold: true };

    // Add empty row
    worksheet.addRow([]);

    // Add column headers
    const columnHeaderRow = worksheet.addRow(['Date', 'Bill No', 'Debit', 'Credit', 'Balance']);
    columnHeaderRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF67B7C7' }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Add data rows with running balance
    let runningBalance = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    sortedBills.forEach((bill: any) => {
      const amount = bill.total_amount || 0;
      const isCredit = bill.payment_method === 'CREDIT';
      const credit = isCredit ? amount : 0;
      const debit = isCredit ? 0 : amount;
      runningBalance = runningBalance + credit;
      totalDebit += debit;
      totalCredit += credit;

      const row = worksheet.addRow([
        bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-',
        `SB-${bill.sale_id}`,
        debit.toFixed(2),
        credit.toFixed(2),
        runningBalance.toFixed(2)
      ]);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      // Right align numeric columns
      row.getCell(3).alignment = { horizontal: 'right' };
      row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(5).alignment = { horizontal: 'right' };
      row.getCell(2).alignment = { horizontal: 'center' };
    });

    // Add total row
    const totalRow = worksheet.addRow(['Total', '', totalDebit.toFixed(2), totalCredit.toFixed(2), runningBalance.toFixed(2)]);
    totalRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      if (colNumber >= 3) {
        cell.alignment = { horizontal: 'right' };
      }
    });

    // Generate filename
    const fileName = `Sale_Details_${(selectedPatient.patient_name || 'Walk-in').replace(/\s+/g, '_')}_${new Date().toLocaleDateString('en-IN').replace(/\//g, '-')}.xlsx`;

    // Download the file
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 flex gap-6 bg-gray-50 min-h-screen">
      {/* Left Side - Sales List */}
      <div className={showSidePanel ? "w-1/2" : "w-full"}>
        {/* Header with Title and Stats */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-cyan-100 rounded-lg">
              <Receipt className="h-6 w-6 text-cyan-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Sales History</h1>
              <p className="text-sm text-gray-500">View and manage pharmacy sales records</p>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-gray-500 text-sm">Total Patients</p>
                <p className="text-2xl font-bold text-cyan-600">{patientGroups.length}</p>
              </CardContent>
            </Card>
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-gray-500 text-sm">Total Revenue</p>
                <p className="text-2xl font-bold text-cyan-600">₹{patientGroups.reduce((sum, group) => sum + (group.total_amount || 0), 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="bg-white border border-gray-200 shadow-sm">
              <CardContent className="p-4">
                <p className="text-gray-500 text-sm">Total Bills</p>
                <p className="text-2xl font-bold text-cyan-600">{tableData.length}</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Search/Filter Card */}
        <Card className="mb-6 shadow-sm">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-end gap-4">
              {/* Bill No */}
              <div className="flex-1 min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Bill No.</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search bill..."
                    value={billNo}
                    onChange={e => setBillNo(e.target.value)}
                  />
                </div>
              </div>

              {/* Patient Name/ID */}
              <div className="flex-1 min-w-[200px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name/ID</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    className="pl-9"
                    placeholder="Search patient..."
                    value={patientName}
                    onChange={e => setPatientName(e.target.value)}
                    onFocus={() => { if (patientResults.length > 0) setShowDropdown(true); }}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  />
                  {showDropdown && (
                    <div className="absolute z-10 bg-white border rounded-lg w-full max-h-48 overflow-y-auto shadow-lg mt-1">
                      {isLoading && <div className="p-3 text-gray-500">Loading...</div>}
                      {!isLoading && patientResults.length === 0 && <div className="p-3 text-gray-500">No results</div>}
                      {!isLoading && patientResults.map((p) => (
                        <div
                          key={p.patients_id}
                          className="p-3 hover:bg-cyan-50 cursor-pointer border-b last:border-0"
                          onMouseDown={() => handleSelectPatient(p)}
                        >
                          <span className="font-medium text-gray-800">{p.name}</span>
                          <span className="text-xs text-gray-500 ml-2">({p.patients_id})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Date range */}
              <div className="min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">From date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="date"
                    className="pl-9"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">To date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="date"
                    className="pl-9"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              {/* Payment mode */}
              <div className="min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment mode</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">All modes</option>
                  <option value="CASH">Cash</option>
                  <option value="UPI">UPI</option>
                  <option value="CARD">Card</option>
                  <option value="ONLINE">Online</option>
                  <option value="CREDIT">Credit (unpaid)</option>
                </select>
              </div>

              {/* Payment status */}
              <div className="min-w-[170px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={paymentStatus}
                  onChange={e => setPaymentStatus(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">All statuses</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="PENDING">Pending</option>
                  <option value="PENDING_DISCOUNT_APPROVAL">Awaiting discount approval</option>
                  <option value="REFUNDED">Refunded</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              {/* Sale type */}
              <div className="min-w-[150px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Sale type</label>
                <select
                  value={saleTypeFilter}
                  onChange={e => setSaleTypeFilter(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ALL">All types</option>
                  <option value="PRESCRIPTION">Prescription</option>
                  <option value="other">Counter / direct</option>
                </select>
              </div>

              {/* All Encounter Checkbox */}
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 text-cyan-600 rounded border-gray-300 focus:ring-cyan-500"
                  checked={allEncounter}
                  onChange={e => setAllEncounter(e.target.checked)}
                />
                All Encounters
              </label>

              {/* Buttons */}
              <Button onClick={handlePatientSearch} className="bg-cyan-600 hover:bg-cyan-700">
                <Search className="h-4 w-4 mr-2" />
                Search
              </Button>

              {activeFilterCount > 0 && (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters ({activeFilterCount})
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Table Card - Grouped by Patient */}
        <Card className="shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-cyan-600 text-white">
                  <th className="px-4 py-3 text-left text-sm font-semibold">Patient</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Visit</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Total</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Paid</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold">Discount</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold">Date</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {patientGroups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      <Receipt className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                      <p>No sales records found</p>
                    </td>
                  </tr>
                ) : (
                  patientGroups.map((group, idx) => (
                    <tr
                      key={group.visit_id || `${group.patient_id}-${idx}`}
                      className={`bg-white hover:bg-gray-50 transition-colors cursor-pointer ${
                        selectedPatient?.visit_id === group.visit_id && selectedPatient?.patient_id === group.patient_id ? 'bg-cyan-50' : ''
                      }`}
                      onClick={() => {
                        setSelectedPatient(group);
                        setPanelType('sales');
                        setShowSidePanel(true);
                        const saleIds = group.bills.map((b: any) => b.sale_id);
                        fetchPatientReturns(group.patient_id, saleIds);
                        fetchPatientCreditPayments(group.patient_id, group.visit_id);
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{group.patient_name}</div>
                        <div className="text-xs text-gray-500">{group.patient_id}</div>
                      </td>
                      <td className="px-4 py-3">
                        {group.visit_id ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              IPD
                            </span>
                            <div className="text-xs text-gray-500 mt-1 font-mono">{group.visit_id}</div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Walk-in
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">₹{group.total_amount?.toFixed(2) ?? '0.00'}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800">₹{group.total_paid?.toFixed(2) ?? '0.00'}</td>
                      <td className="px-4 py-3 text-right text-gray-600">₹{group.total_discount?.toFixed(2) ?? '0.00'}</td>
                      <td className="px-4 py-3 text-gray-600">{group.latest_date ? new Date(group.latest_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPatient(group);
                              setPanelType('sales');
                              setShowSidePanel(true);
                              const saleIds = group.bills.map((b: any) => b.sale_id);
                              fetchPatientReturns(group.patient_id, saleIds);
                              fetchPatientCreditPayments(group.patient_id, group.visit_id);
                            }}
                            className="h-8 w-8 p-0 hover:bg-cyan-100 hover:text-cyan-600"
                            title="View All Bills"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Pass full group with all bills for payment details table
                              setSelectedPatient(group);
                              setPanelType('payment');
                              setShowSidePanel(true);
                            }}
                            className="h-8 w-8 p-0 hover:bg-green-100 hover:text-green-600"
                            title="Money Collected"
                          >
                            <Wallet className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Pass full group with all bills for sale details
                              setSelectedPatient(group);
                              setPanelType('items');
                              setShowSidePanel(true);
                            }}
                            className="h-8 w-8 p-0 hover:bg-blue-100 hover:text-blue-600"
                            title="Sale Details"
                          >
                            <Receipt className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async (e) => {
                              e.stopPropagation();
                              // Fetch all medications from all bills for this patient
                              const allSaleIds = group.bills.map((b: any) => b.sale_id);
                              const { data, error } = await supabase
                                .from('pharmacy_sale_items')
                                .select('*, pharmacy_sales!inner(sale_date)')
                                .in('sale_id', allSaleIds);

                              if (!error && data) {
                                setSaleItems(data);
                              } else {
                                setSaleItems([]);
                              }
                              setSelectedPatient(group);
                              setPanelType('medications');
                              setShowSidePanel(true);
                            }}
                            className="h-8 w-8 p-0 hover:bg-purple-100 hover:text-purple-600"
                            title="Medication Details"
                          >
                            <Pill className="h-4 w-4" />
                          </Button>
                          {group.bills[0]?.visit_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenTreatmentSheet(group.bills[0].visit_id);
                              }}
                              className="h-8 w-8 p-0 hover:bg-orange-100 hover:text-orange-600"
                              title="Treatment Sheet"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {patientGroups.length > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="px-4 py-3 font-semibold text-gray-700">Total</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-800">
                      ₹{patientGroups.reduce((sum, group) => sum + (group.total_amount || 0), 0).toFixed(2)}
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Record count */}
          {totalCount > 0 && (
            <div className="px-4 py-3 border-t bg-gray-50">
              <p className="text-sm text-gray-600">
                Showing <span className="font-medium">{patientGroups.length}</span> of{' '}
                <span className="font-medium">{totalCount}</span> records
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Right Side Panel - Shows all bills for selected patient */}
      {showSidePanel && selectedPatient && (
        <div
          key={`${selectedPatient.visit_id || 'walkin'}-${selectedPatient.patient_id}-${selectedPatient.bills?.[0]?.sale_id || ''}`}
          className="w-1/2 bg-gray-100 shadow-lg overflow-y-auto border-l border-gray-200"
        >
          <div className="p-2">
            {/* Patient Header with Print Icon */}
            <div className="flex justify-between items-center px-4 py-3 bg-gray-200 border-b mb-2">
              <span className="font-medium text-gray-800">Patient Name : {selectedPatient.patient_name || 'Walk-in'}</span>
              <div className="flex items-center gap-2">
                {/* Export Excel button - for medications and sale details panels */}
                {(panelType === 'medications' || panelType === 'items') && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 hover:bg-green-100 hover:text-green-600"
                    title="Export as Excel"
                    onClick={panelType === 'medications' ? exportMedicationToExcel : exportSaleDetailsToExcel}
                  >
                    <FileSpreadsheet className="h-4 w-4 text-green-600" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 hover:bg-gray-300"
                  title="Print"
                  onClick={() => {
                    if (panelType === 'payment') {
                      printPaymentDetails();
                    } else if (panelType === 'items') {
                      printSaleDetails();
                    } else if (panelType === 'medications') {
                      printMedicationDetails();
                    }
                  }}
                >
                  <Printer className="h-4 w-4 text-gray-600" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowSidePanel(false); setPanelType(null); setSelectedPatient(null); }}
                  className="h-8 w-8 p-0 hover:bg-gray-300"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </Button>
              </div>
            </div>

            {/* Sales Bill Table - only show for sales panel */}
            {panelType === 'sales' && (
            <>
            <div className="bg-cyan-700 py-2 px-4 text-center">
              <span className="text-sm font-semibold text-white">Sales Bill</span>
            </div>

            <div className="overflow-x-auto bg-white">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-cyan-600 text-white">
                    <th className="px-2 py-2 text-left text-xs font-semibold">Bill No.</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold">Mode</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold">Date</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Amt.</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Paid</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Disc</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Net Amt</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold">Action</th>
                    <th className="px-1 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                        title="Select all"
                        checked={
                          selectedPatient?.bills?.length > 0 &&
                          selectedPatient.bills
                            .filter((b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED')
                            .every((b: any) => selectedBills.includes(b.sale_id)) &&
                          selectedPatient.bills.some((b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED')
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedBills(
                              selectedPatient.bills
                                .filter((b: any) => b.payment_status !== 'PENDING_DISCOUNT_APPROVAL' && b.payment_status !== 'CANCELLED')
                                .map((b: any) => b.sale_id)
                            );
                          } else {
                            setSelectedBills([]);
                          }
                        }}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Show all bills for this patient */}
                  {selectedPatient.bills && selectedPatient.bills.length > 0 ? (
                    selectedPatient.bills.map((bill: any, idx: number) => {
                      const isCredit = bill.payment_method === 'CREDIT';
                      const amount = bill.total_amount || 0;
                      const paid = isCredit ? 0 : amount;
                      return (
                      <tr key={bill.sale_id || idx} className={`border-b ${bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? 'bg-amber-50 hover:bg-amber-100' : bill.payment_status === 'CANCELLED' ? 'bg-red-50 hover:bg-red-100 opacity-70' : 'bg-white hover:bg-gray-50'}`}>
                        <td className="px-2 py-2 text-gray-800">
                          <div className="flex flex-col gap-0.5">
                            <span>SB-{bill.sale_id}</span>
                            {bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' && (
                              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 border border-amber-300 rounded px-1 leading-tight w-fit">Pending Approval</span>
                            )}
                            {bill.payment_status === 'CANCELLED' && (
                              <span className="text-[10px] font-medium text-red-700 bg-red-100 border border-red-300 rounded px-1 leading-tight w-fit">Cancelled</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-gray-600">{bill.payment_method || 'Cash'}</td>
                        <td className="px-2 py-2 text-gray-600">
                          {bill.payment_method === 'CREDIT' ? (
                            <input
                              type="date"
                              defaultValue={bill.sale_date ? new Date(bill.sale_date).toISOString().split('T')[0] : ''}
                              max={new Date().toISOString().split('T')[0]}
                              onBlur={async (e) => {
                                const newDate = e.target.value;
                                if (!newDate || newDate === (bill.sale_date ? new Date(bill.sale_date).toISOString().split('T')[0] : '')) return;
                                const { error } = await supabase
                                  .from('pharmacy_sales')
                                  .update({ sale_date: new Date(newDate + 'T12:00:00').toISOString() })
                                  .eq('sale_id', bill.sale_id);
                                if (error) {
                                  alert('Failed to update date: ' + error.message);
                                } else {
                                  bill.sale_date = new Date(newDate + 'T12:00:00').toISOString();
                                }
                              }}
                              className="w-28 px-1 py-0.5 text-xs border border-blue-300 bg-blue-50 rounded focus:ring-1 focus:ring-blue-500"
                            />
                          ) : (
                            bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-'
                          )}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-800">{((bill.total_amount || 0) + (bill.discount || 0)).toFixed(2)}</td>
                        <td className="px-2 py-2 text-right text-gray-800">{paid.toFixed(2)}</td>
                        <td className="px-2 py-2 text-right text-gray-600">{(bill.discount || 0).toFixed(2)}</td>
                        <td className="px-2 py-2 text-right font-medium text-gray-800">{amount.toFixed(2)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-center gap-1">
                            {/* 1. Edit - for non-completed sales OR CREDIT (corporate/panel/insurance) */}
                            {(bill.payment_status !== 'COMPLETED' && bill.payment_status !== 'REFUNDED') || bill.payment_method === 'CREDIT' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => navigate(`/pharmacy/edit-sale/${bill.sale_id}`)}
                                className="h-6 w-6 p-0 hover:bg-cyan-100 hover:text-cyan-600"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            ) : null}
                            {/* 2. View Sales - Modal */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewBillModal(bill)}
                              className="h-6 w-6 p-0 hover:bg-cyan-100 hover:text-cyan-600"
                              title="View"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            {/* 3. Print */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePrintBill(bill)}
                              className={`h-6 w-6 p-0 ${bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? 'text-amber-400 hover:bg-amber-100' : 'hover:bg-cyan-100 hover:text-cyan-600'}`}
                              title={bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? 'Awaiting admin approval — cannot print yet' : 'Print'}
                            >
                              <Printer className="h-3 w-3" />
                            </Button>
                            {/* 4. Cancel Bill (soft-delete) */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteBill(bill)}
                              className="h-6 w-6 p-0 hover:bg-orange-100 hover:text-orange-600"
                              title="Cancel bill"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-1 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-gray-300 text-cyan-600 focus:ring-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' || bill.payment_status === 'CANCELLED'}
                            title={bill.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? 'Cannot select: awaiting admin approval' : bill.payment_status === 'CANCELLED' ? 'Cannot select: bill cancelled' : ''}
                            checked={selectedBills.includes(bill.sale_id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBills([...selectedBills, bill.sale_id]);
                              } else {
                                setSelectedBills(selectedBills.filter(id => id !== bill.sale_id));
                              }
                            }}
                          />
                        </td>
                      </tr>
                    );})
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-4 py-4 text-center text-gray-500">No bills found</td>
                    </tr>
                  )}
                  {/* Total Row */}
                  {selectedPatient.bills && selectedPatient.bills.length > 0 && (
                    <tr className="bg-gray-100 font-semibold border-t">
                      <td colSpan={3} className="px-2 py-2 text-right text-gray-700">Total :</td>
                      <td className="px-2 py-2 text-right text-gray-800">
                        {selectedPatient.bills.reduce((sum: number, b: any) => sum + ((b.total_amount || 0) + (b.discount || 0)), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-800">
                        {selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.payment_method === 'CREDIT' ? 0 : (b.total_amount || 0)), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-600">
                        {selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.discount || 0), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right font-bold text-gray-800">
                        {selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-center" colSpan={2}>
                        <Button
                          size="sm"
                          className="bg-gray-700 hover:bg-gray-800 text-xs"
                          onClick={printSelectedPrescriptions}
                          disabled={selectedBills.length === 0}
                        >
                          <Printer className="h-3 w-3 mr-1" />
                          Print Prescription {selectedBills.length > 0 && `(${selectedBills.length})`}
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Sales Return Section */}
            <div className="bg-cyan-700 py-2 px-4 mt-4">
              <span className="text-sm font-semibold text-white">Sales Return</span>
            </div>
            <div className="overflow-x-auto bg-white border border-gray-200">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-cyan-600 text-white">
                    <th className="px-2 py-2 text-left text-xs font-semibold">Bill No.</th>
                    <th className="px-2 py-2 text-left text-xs font-semibold">Date</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Total Amt</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Return Amt</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold">Discount(Rs)</th>
                    <th className="px-2 py-2 text-center text-xs font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {patientReturns && patientReturns.length > 0 ? (
                    patientReturns.map((ret: any, idx: number) => (
                      <tr key={ret.id || idx} className="bg-white border-b hover:bg-gray-50">
                        <td className="px-2 py-2 text-gray-800">{ret.return_number || `SR-${ret.id?.slice(0, 4)}`}</td>
                        <td className="px-2 py-2 text-gray-600">{ret.return_date ? new Date(ret.return_date).toLocaleDateString('en-IN') : '-'}</td>
                        <td className="px-2 py-2 text-right text-gray-800">{(ret.refund_amount || 0).toFixed(2)}</td>
                        <td className="px-2 py-2 text-right text-gray-800">{(ret.net_refund || 0).toFixed(2)}</td>
                        <td className="px-2 py-2 text-right text-gray-600">{(ret.processing_fee || 0).toFixed(2)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-cyan-100 hover:text-cyan-600"
                              title="Print Return Voucher"
                              onClick={() => printReturnVoucher(ret)}
                            >
                              <Printer className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-red-100 hover:text-red-600"
                              title="Hide return"
                              onClick={async () => {
                                if (!confirm('Hide this return? It will be hidden from the bill but kept in the database for audit.')) return;
                                const { error } = await (supabase as any).from('medicine_returns').update({ is_hidden: true }).eq('id', ret.id);
                                if (error) {
                                  toast.error('Failed to hide return');
                                } else {
                                  toast.success('Return hidden successfully');
                                  setPatientReturns(prev => prev.filter(r => r.id !== ret.id));
                                }
                              }}
                            >
                              <EyeOff className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-center text-gray-500">No returns found</td>
                    </tr>
                  )}
                  {/* Total Row */}
                  {patientReturns && patientReturns.length > 0 && (
                    <tr className="bg-gray-100 font-semibold border-t">
                      <td colSpan={2} className="px-2 py-2 text-right text-gray-700">Total :</td>
                      <td className="px-2 py-2 text-right text-gray-800">
                        {patientReturns.reduce((sum: number, r: any) => sum + (r.refund_amount || 0), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-800">
                        {patientReturns.reduce((sum: number, r: any) => sum + (r.net_refund || 0), 0).toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-600">
                        {patientReturns.reduce((sum: number, r: any) => sum + (r.processing_fee || 0), 0).toFixed(2)}
                      </td>
                      <td></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pending Amount Calculation */}
            {selectedPatient.bills && selectedPatient.bills.length > 0 && (
              <div className="bg-gray-800 text-white px-4 py-3 mt-2 rounded">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Pending Amount:</span>
                  <span className="font-bold text-lg">
                    ₹{(
                      // Total Sales Amount
                      selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0) -
                      // Total Paid (non-credit payments)
                      selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.payment_method === 'CREDIT' ? 0 : (b.total_amount || 0)), 0) -
                      // Total Returns — only returns against CREDIT bills.
                      // A return against a CASH bill self-cancels (the refund balances the
                      // cash already paid at the counter); subtracting it again would push
                      // the balance negative for a fully-paid, fully-returned cash bill.
                      (patientReturns?.reduce((sum: number, r: any) =>
                        sum + (selectedPatient.bills.some((b: any) =>
                          b.payment_method === 'CREDIT' && String(b.sale_id) === String(r.original_sale_id)
                        ) ? (r.net_refund || 0) : 0), 0) || 0) -
                      // Credit Payments Received
                      (patientCreditPayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0)
                    ).toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-gray-300 mt-1">
                  Total: ₹{selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.total_amount || 0), 0).toFixed(2)} -
                  Paid: ₹{selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.payment_method === 'CREDIT' ? 0 : (b.total_amount || 0)), 0).toFixed(2)} -
                  Returns: ₹{(patientReturns?.reduce((sum: number, r: any) =>
                    sum + (selectedPatient.bills.some((b: any) =>
                      b.payment_method === 'CREDIT' && String(b.sale_id) === String(r.original_sale_id)
                    ) ? (r.net_refund || 0) : 0), 0) || 0).toFixed(2)} -
                  Credit Received: ₹{(patientCreditPayments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0).toFixed(2)}
                </div>
              </div>
            )}
            </>
            )}

            {/* Money Collected Panel */}
            {panelType === 'payment' && (
              <>
                <div className="bg-cyan-700 py-2 px-4">
                  <span className="text-sm font-semibold text-white">Patient Name : {selectedPatient.patient_name || 'Walk-in'}</span>
                </div>
                <div className="overflow-x-auto bg-white">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-cyan-600 text-white">
                        <th className="px-3 py-2 text-left text-xs font-semibold">Date</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Paid Amt</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Discount Given</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold">Credit Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.bills && selectedPatient.bills.length > 0 ? (
                        selectedPatient.bills.map((bill: any, idx: number) => {
                          const isCredit = bill.payment_method === 'CREDIT';
                          const paidAmt = isCredit ? 0 : (bill.total_amount || 0);
                          const balance = isCredit ? (bill.total_amount || 0) : 0;
                          return (
                            <tr key={bill.sale_id || idx} className="bg-white border-b hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-800">
                                {bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-'}
                              </td>
                              <td className="px-3 py-2 text-right text-gray-800">{paidAmt.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{(bill.discount || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right text-red-600 font-medium">{balance.toFixed(2)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-center text-gray-500">No payment records found</td>
                        </tr>
                      )}
                      {/* Total Row */}
                      {selectedPatient.bills && selectedPatient.bills.length > 0 && (
                        <tr className="bg-gray-100 font-semibold border-t">
                          <td className="px-3 py-2 text-gray-700">Total</td>
                          <td className="px-3 py-2 text-right text-gray-800">
                            {selectedPatient.bills.reduce((sum: number, b: any) => {
                              const isCredit = b.payment_method === 'CREDIT';
                              return sum + (isCredit ? 0 : (b.total_amount || 0));
                            }, 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {selectedPatient.bills.reduce((sum: number, b: any) => sum + (b.discount || 0), 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-red-600 font-bold">
                            {selectedPatient.bills.reduce((sum: number, b: any) => {
                              const isCredit = b.payment_method === 'CREDIT';
                              return sum + (isCredit ? (b.total_amount || 0) : 0);
                            }, 0).toFixed(2)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Sale Details (Items) Panel */}
            {panelType === 'items' && (
              <>
                {/* Header Section */}
                <div className="bg-white border border-gray-300">
                  <div className="text-center py-2 border-b border-gray-300 font-bold text-sm">
                    HOPE HOSPITAL PHARMACY
                  </div>
                  <div className="text-center py-1 border-b border-gray-300 text-xs">
                    List Of Pharmacy Sale Bills from : {
                      selectedPatient.bills && selectedPatient.bills.length > 0
                        ? `${new Date(selectedPatient.bills[selectedPatient.bills.length - 1]?.sale_date).toLocaleDateString('en-IN')} TO ${new Date(selectedPatient.bills[0]?.sale_date).toLocaleDateString('en-IN')}`
                        : '-'
                    }
                  </div>
                  <div className="text-center py-1 border-b border-gray-300 text-xs font-medium">
                    {selectedPatient.patient_id || '-'} {selectedPatient.patient_name || 'Walk-in'}
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto bg-white border-x border-gray-300">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-cyan-100">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-cyan-800 border-b border-gray-300">Date</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-cyan-800 border-b border-gray-300">Bill No</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-cyan-800 border-b border-gray-300">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-cyan-800 border-b border-gray-300">Credit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-cyan-800 border-b border-gray-300">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPatient.bills && selectedPatient.bills.length > 0 ? (
                        (() => {
                          let runningBalance = 0;
                          // Sort bills by date ascending for running balance
                          const sortedBills = [...selectedPatient.bills].sort((a: any, b: any) =>
                            new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime()
                          );
                          return sortedBills.map((bill: any, idx: number) => {
                            const amount = bill.total_amount || 0;
                            const isCredit = bill.payment_method === 'CREDIT';
                            // Credit = unpaid (CREDIT payment method), Debit = paid (other methods)
                            const credit = isCredit ? amount : 0;
                            const debit = isCredit ? 0 : amount;
                            runningBalance = runningBalance + credit;
                            return (
                              <tr key={bill.sale_id || idx} className="bg-white border-b border-gray-200 hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-800">
                                  {bill.sale_date ? new Date(bill.sale_date).toLocaleDateString('en-IN') : '-'}
                                </td>
                                <td className="px-3 py-2 text-center text-gray-800">SB-{bill.sale_id}</td>
                                <td className="px-3 py-2 text-right text-gray-800">{debit.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right text-gray-800">{credit.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right text-gray-800">{runningBalance.toFixed(2)}</td>
                              </tr>
                            );
                          });
                        })()
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-gray-500">No bills found</td>
                        </tr>
                      )}
                      {/* Total Row */}
                      {selectedPatient.bills && selectedPatient.bills.length > 0 && (
                        <tr className="bg-gray-100 font-semibold border-t-2 border-gray-400">
                          <td className="px-3 py-2 text-gray-700">Total</td>
                          <td className="px-3 py-2"></td>
                          <td className="px-3 py-2 text-right text-gray-800">
                            {selectedPatient.bills.reduce((sum: number, b: any) => {
                              return sum + (b.payment_method !== 'CREDIT' ? (b.total_amount || 0) : 0);
                            }, 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-800">
                            {selectedPatient.bills.reduce((sum: number, b: any) => {
                              return sum + (b.payment_method === 'CREDIT' ? (b.total_amount || 0) : 0);
                            }, 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-gray-800">
                            {selectedPatient.bills.reduce((sum: number, b: any) => {
                              return sum + (b.payment_method === 'CREDIT' ? (b.total_amount || 0) : 0);
                            }, 0).toFixed(2)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Medication Details Panel */}
            {panelType === 'medications' && (
              <>
                {/* Header Section */}
                <div className="bg-white border border-gray-300">
                  <div className="text-center py-2 border-b border-gray-300 font-bold text-sm bg-pink-50">
                    HOPE MULTISPECIALITY HOSPITAL & RESEARCH CENTER
                  </div>
                  <div className="text-center py-1 border-b border-gray-300 text-xs font-semibold">
                    PHARMACY STATEMENT
                  </div>
                  <div className="text-center py-1 border-b border-gray-300 text-xs font-medium">
                    {selectedPatient.patient_name || 'Walk-in'}
                  </div>
                  <div className="text-center py-1 border-b border-gray-300 text-xs">
                    List Of Issued Drugs From : {
                      selectedPatient.bills && selectedPatient.bills.length > 0
                        ? `${new Date(selectedPatient.bills[selectedPatient.bills.length - 1]?.sale_date).toLocaleDateString('en-IN')} To ${new Date(selectedPatient.bills[0]?.sale_date).toLocaleDateString('en-IN')}`
                        : '-'
                    }
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto bg-white border-x border-b border-gray-300">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-cyan-100">
                        <th className="px-2 py-2 text-left text-xs font-semibold text-cyan-800 border-b border-gray-300">Sr.No.</th>
                        <th className="px-2 py-2 text-left text-xs font-semibold text-cyan-800 border-b border-gray-300">Service Name</th>
                        <th className="px-2 py-2 text-center text-xs font-semibold text-cyan-800 border-b border-gray-300">Date</th>
                        <th className="px-2 py-2 text-center text-xs font-semibold text-cyan-800 border-b border-gray-300">Quantity</th>
                        <th className="px-2 py-2 text-right text-xs font-semibold text-cyan-800 border-b border-gray-300">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleItems.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-gray-500">No medications found</td>
                        </tr>
                      ) : (
                        <>
                          {saleItems.map((item: any, idx: number) => {
                            const amount = (item.unit_price || 0) * (item.quantity || 0);
                            return (
                              <tr key={idx} className="bg-white border-b border-gray-200 hover:bg-gray-50">
                                <td className="px-2 py-2 text-gray-800">{idx + 1}</td>
                                <td className="px-2 py-2 text-gray-800">{item.medication_name || item.medicine_name}</td>
                                <td className="px-2 py-2 text-center text-gray-800">
                                  {item.pharmacy_sales?.sale_date ? new Date(item.pharmacy_sales.sale_date).toLocaleDateString('en-IN') : '-'}
                                </td>
                                <td className="px-2 py-2 text-center text-gray-800">{item.quantity}</td>
                                <td className="px-2 py-2 text-right text-gray-800">{amount.toFixed(2)}</td>
                              </tr>
                            );
                          })}
                          {/* Total Row */}
                          <tr className="bg-gray-100 font-semibold border-t-2 border-gray-400">
                            <td colSpan={4} className="px-2 py-2 text-right text-gray-700">Total</td>
                            <td className="px-2 py-2 text-right text-gray-800">
                              {saleItems.reduce((sum: number, item: any) => sum + ((item.unit_price || 0) * (item.quantity || 0)), 0).toFixed(2)}
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* View Bill Modal */}
      <Dialog open={!!viewBillModal} onOpenChange={(open) => !open && setViewBillModal(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bill Details - SB-{viewBillModal?.sale_id}</DialogTitle>
          </DialogHeader>
          {viewBillModal && (
            <div className="space-y-4">
              {viewBillModal.payment_status === 'PENDING_DISCOUNT_APPROVAL' && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-amber-800">
                  <span className="font-semibold">⏳ Pending Admin Approval</span>
                  <span>— The discount on this bill has not yet been authorised. Totals shown are not final.</span>
                </div>
              )}
              {viewBillModal.payment_status === 'CANCELLED' && (
                <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-red-800">
                  <span className="font-semibold">✕ Cancelled</span>
                  <span>— This sale was cancelled (discount rejected). Stock has been restored.</span>
                </div>
              )}
              {/* Bill Header Info */}
              <div className="grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg">
                <div>
                  <p className="text-sm text-gray-500">Patient Name</p>
                  <p className="font-medium">{viewBillModal.patient_name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Patient ID</p>
                  <p className="font-medium">{viewBillModal.patient_id || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Bill Date</p>
                  <p className="font-medium">{viewBillModal.sale_date ? new Date(viewBillModal.sale_date).toLocaleDateString('en-IN') : 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Payment Method</p>
                  <p className="font-medium">{viewBillModal.payment_method || 'Cash'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Doctor</p>
                  <p className="font-medium">{viewBillModal.doctor_name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Bill Number</p>
                  <p className="font-medium">{viewBillModal.bill_number || `SB-${viewBillModal.sale_id}`}</p>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-semibold mb-2">Items</h4>
                <table className="w-full text-sm border">
                  <thead className="bg-cyan-600 text-white">
                    <tr>
                      <th className="px-3 py-2 text-left">Item Name</th>
                      <th className="px-3 py-2 text-center">Qty</th>
                      <th className="px-3 py-2 text-center">Batch</th>
                      <th className="px-3 py-2 text-right">MRP</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewBillItems.length > 0 ? viewBillItems.map((item: any, idx: number) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.medication_name}</div>
                          {item.generic_name && <div className="text-xs text-gray-500">{item.generic_name}</div>}
                        </td>
                        <td className="px-3 py-2 text-center">{item.quantity}</td>
                        <td className="px-3 py-2 text-center">{item.batch_number || '-'}</td>
                        <td className="px-3 py-2 text-right">{(item.mrp || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{(item.unit_price || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{(item.total_amount || (item.unit_price * item.quantity) || 0).toFixed(2)}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-gray-500">No items found</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-end gap-8">
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Subtotal</p>
                    <p className="font-medium">{viewBillItems.reduce((sum: number, item: any) => sum + (item.total_amount || ((item.unit_price || 0) * (item.quantity || 0))), 0).toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Discount</p>
                    <p className="font-medium">{(viewBillModal.discount || 0).toFixed(2)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Total</p>
                    <p className="font-bold text-lg text-cyan-600">{(viewBillItems.reduce((sum: number, item: any) => sum + (item.total_amount || ((item.unit_price || 0) * (item.quantity || 0))), 0) - (viewBillModal.discount || 0)).toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Treatment Sheet Dialog */}
      <Dialog open={showTreatmentSheet} onOpenChange={setShowTreatmentSheet}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-8">
              <span>Treatment Sheet</span>
              <Button
                size="sm"
                onClick={() => {
                  // Get the treatment sheet content and print in new window
                  const printContent = document.querySelector('[data-treatment-sheet]');
                  if (printContent) {
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      printWindow.document.write(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                          <title>Treatment Sheet</title>
                          <style>
                            * { box-sizing: border-box; margin: 0; padding: 0; }
                            body { font-family: Arial, sans-serif; padding: 10px; }
                            .ts-table { width: 100%; border-collapse: collapse; border: 2px solid #000; table-layout: fixed; }
                            .ts-table th, .ts-table td { border: 1px solid #000; padding: 3px 4px; text-align: left; font-size: 11px; vertical-align: middle; }
                            .ts-table th { font-weight: bold; text-align: center; background-color: #f0f0f0; }
                            .ts-header { text-align: center; font-size: 14px; font-weight: bold; text-decoration: underline; margin-bottom: 6px; }
                            .ts-time-box { display: inline-block; width: 35px; height: 26px; border: 1px solid #000; margin: 1px; text-align: center; padding: 1px; font-size: 9px; vertical-align: top; }
                            .ts-time-label { font-size: 8px; display: block; line-height: 1.1; }
                            .date-section { margin-bottom: 20px; }
                            .mb-2 { margin-bottom: 8px; }
                            @media print {
                              @page { size: A4 portrait; margin: 12mm 10mm; }
                              .date-section { page-break-inside: avoid; }
                            }
                          </style>
                        </head>
                        <body>
                          ${printContent.innerHTML}
                        </body>
                        </html>
                      `);
                      printWindow.document.close();
                      printWindow.focus();
                      setTimeout(() => {
                        printWindow.print();
                        printWindow.close();
                      }, 250);
                    }
                  }
                }}
                className="flex items-center gap-2"
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </DialogTitle>
          </DialogHeader>
          {selectedVisitId && (
            <TreatmentSheetPrintView visitId={selectedVisitId} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SalesDetails; 