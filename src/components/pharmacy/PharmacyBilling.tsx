// Pharmacy Billing and Dispensing Component
import React, { useState, useEffect, useRef } from 'react';
import { pushPharmacySaleToTally } from '@/lib/tally-auto-push';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ShoppingCart, 
  Search, 
  Plus, 
  Minus,
  Scan,
  CreditCard,
  DollarSign,
  Receipt,
  User,
  FileText,
  Calculator,
  Trash2,
  Edit,
  Printer,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Package,
  Users,
  Calendar,
  QrCode,
  Camera,
  Upload,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDebounce } from 'use-debounce';
import { useAuth } from '@/contexts/AuthContext';
import { savePharmacySale, SaleData } from '@/lib/pharmacy-billing-service';
import { toast } from 'sonner';
import {
  fetchPharmacyReceivingQr,
  savePharmacyReceivingQr,
  savePharmacySalePaymentProof,
  fetchPharmacySaleVoucher,
} from '@/lib/pharmacy/paymentEvidence';

interface CartItem {
  id: string;
  medicine_id: string;
  batch_inventory_id: string; // ID from medicine_batch_inventory table
  item_code?: string;
  medicine_name: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  pack?: string;
  administration_time?: string;
  batch_number: string;
  expiry_date: string;
  mrp: number;
  unit_price: number; // Price per piece (tablet)
  quantity: number; // Total pieces to sell (calculated: strips * pieces_per_pack + tablets)
  qty_strips: number; // Number of full strips to sell
  qty_tablets: number; // Number of loose tablets to sell
  discount_percentage: number;
  discount_amount: number;
  tax_percentage: number;
  tax_amount: number;
  total_amount: number;
  available_stock: number; // Stock in pieces (tablets)
  pieces_per_pack: number; // e.g., 10 tablets per strip
  prescription_required: boolean;
}

interface VisitOption {
  visit_id: string;
  admission_date: string | null;
  appointment_with: string | null;
}

interface Sale {
  id: string;
  bill_number: string;
  patient_id?: string;
  patient_name?: string;
  prescription_id?: string;
  sale_date: string;
  sale_type: 'antibiotic' | 'other';
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  payment_method: 'CASH' | 'CARD' | 'UPI' | 'INSURANCE' | 'CREDIT';
  payment_reference?: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
  payment_status?: string;
  is_ot_surgical?: boolean;
  cashier_name?: string;
  items: CartItem[];
}

const PharmacyBilling: React.FC = () => {
  const { hospitalConfig, isAdmin, user } = useAuth();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [saleType, setSaleType] = useState<'antibiotic' | 'other'>('other');
  const [patientInfo, setPatientInfo] = useState({ id: '', name: '', phone: '', corporate: '' });
  const [prescriptionId, setPrescriptionId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'UPI' | 'INSURANCE' | 'CREDIT'>('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState(0);
  const [orderDiscount, setOrderDiscount] = useState(0); // Order-level discount amount
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [pendingApprovalDbSaleId, setPendingApprovalDbSaleId] = useState<number | null>(null);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]); // YYYY-MM-DD
  const [isOtSurgical, setIsOtSurgical] = useState(false);

  // Invoice-before-payment: Generate Invoice saves the bill unpaid and the
  // database posts its JV; Complete Sale then settles the same bill and the
  // database posts the receipt. Nothing here writes a voucher directly.
  const [invoiceSaleId, setInvoiceSaleId] = useState<number | null>(null);
  const [invoiceBillNumber, setInvoiceBillNumber] = useState('');
  const [invoiceVoucher, setInvoiceVoucher] = useState<string | null>(null);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);

  // The pharmacy's own QR (patient scans it) and the confirmation that comes back.
  const [receivingQrUrl, setReceivingQrUrl] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [pendingProof, setPendingProof] = useState<File | null>(null);
  const [isSavingProof, setIsSavingProof] = useState(false);
  // Invoices raised but never settled — a bill can be generated and the
  // patient walk away, and until now nothing could pick that bill back up.
  const [unpaidInvoices, setUnpaidInvoices] = useState<any[]>([]);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [busyInvoiceId, setBusyInvoiceId] = useState<number | null>(null);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const proofCameraRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  
  const [patientSearchResults, setPatientSearchResults] = useState<any[]>([]);
  const [isSearchingPatient, setIsSearchingPatient] = useState(false);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  const [debouncedPatientName] = useDebounce(patientInfo.name, 300);
  const [debouncedPatientId] = useDebounce(patientInfo.id, 300);

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debouncedSearchTerm] = useDebounce(searchTerm, 300);

  const [visitId, setVisitId] = useState('');
  const [visitOptions, setVisitOptions] = useState<VisitOption[]>([]);
  const [doctorName, setDoctorName] = useState('');
  const [allEncounter, setAllEncounter] = useState(false);
  const [encounterType, setEncounterType] = useState('OPD');

  const [doctorSearchTerm, setDoctorSearchTerm] = useState('');
  const [showDoctorResults, setShowDoctorResults] = useState(false);
  const [doctorSuggestions, setDoctorSuggestions] = useState<Array<{name: string}>>([]);

  // Sale type options for allowed values (as per DB constraint)
  const saleTypeOptions = [
    { value: 'antibiotic', label: 'Antibiotic' },
    { value: 'other', label: 'Other' },
  ];

  useEffect(() => {
    const searchMedicines = async () => {
      if (debouncedSearchTerm.length < 2) {
        setSearchResults([]);
        return;
      }

      setIsSearching(true);

      try {
        // Step 1: Search medicine_master directly (works correctly with Supabase)
        const { data: medicines, error: medError } = await supabase
          .from('medicine_master')
          .select('id, medicine_name, generic_name, type')
          .eq('is_deleted', false)
          .or(`medicine_name.ilike.%${debouncedSearchTerm}%,generic_name.ilike.%${debouncedSearchTerm}%`)
          .limit(20);

        if (medError) {
          console.error('Error searching medicines:', medError);
          setSearchResults([]);
          setIsSearching(false);
          return;
        }

        if (!medicines || medicines.length === 0) {
          setSearchResults([]);
          setIsSearching(false);
          return;
        }

        // Step 2: Get batch inventory for these medicines
        const medicineIds = medicines.map((m: any) => m.id);
        console.log('🔍 DEBUG: Found medicines in medicine_master:', medicines.map(m => ({ 
          name: m.medicine_name, 
          id: m.id 
        })));
        console.log('🔍 DEBUG: Searching for batch inventory with medicine_ids:', medicineIds);
        
        const { data: batches, error: batchError } = await supabase
          .from('medicine_batch_inventory')
          .select('id, medicine_id, batch_number, expiry_date, current_stock, selling_price, mrp, pieces_per_pack')
          .in('medicine_id', medicineIds)
          .eq('is_active', true)
          .eq('is_expired', false)
          .gt('current_stock', 0)
          .order('expiry_date', { ascending: true }); // FEFO - First Expiry First Out
          
        console.log('🔍 DEBUG: Found batches in medicine_batch_inventory:', batches?.map(b => ({ 
          medicine_id: b.medicine_id, 
          batch: b.batch_number, 
          stock: b.current_stock 
        })) || []);
        console.log('🔍 DEBUG: Batch query error:', batchError);

        if (batchError) {
          console.error('Error fetching batches:', batchError);
        }

        // Step 3: Map results - one entry per batch for batch-wise display
        const mappedData: any[] = [];
        medicines.forEach((med: any) => {
          const medBatches = batches?.filter((b: any) => b.medicine_id === med.id) || [];
          medBatches.forEach((batch: any) => {
            mappedData.push({
              id: batch.id,                    // batch inventory id
              medicine_id: med.id,             // FK to medicine_master
              name: med.medicine_name,
              generic_name: med.generic_name || '',
              strength: '',
              dosage: med.type || '',
              stock: batch.current_stock || 0, // Now stored in pieces (tablets)
              pieces_per_pack: batch.pieces_per_pack || 1,
              price_per_strip: batch.selling_price || 0,
              mrp: batch.mrp || 0,
              item_code: '',
              batch_number: batch.batch_number || 'N/A',
              expiry_date: batch.expiry_date || 'N/A'
            });
          });
        });

        setSearchResults(mappedData);
      } catch (error) {
        console.error('Error in medicine search:', error);
        setSearchResults([]);
      }

      setIsSearching(false);
    };

    searchMedicines();
  }, [debouncedSearchTerm]);

  useEffect(() => {
    const searchPatientsByName = async () => {
      if (debouncedPatientName.length < 2) {
        setPatientSearchResults([]);
        setShowPatientDropdown(false);
        return;
      }
      
      const justSelected = patientSearchResults.find(p => p.name === debouncedPatientName);
      if (justSelected && justSelected.patients_id === patientInfo.id) {
          return;
      }

      setIsSearchingPatient(true);
      const { data, error } = await supabase
        .from('patients')
        .select('name, patients_id, corporate')
        .eq('hospital_name', hospitalConfig.name)
        .ilike('name', `%${debouncedPatientName}%`)
        .limit(5);

      if (!error) {
        setPatientSearchResults(data || []);
        setShowPatientDropdown(true);
      }
      setIsSearchingPatient(false);
    };

    searchPatientsByName();
  }, [debouncedPatientName]);

  useEffect(() => {
    const searchPatientsById = async () => {
      if (debouncedPatientId.length < 2) {
        return;
      }
      
      if (patientInfo.name && patientInfo.id === debouncedPatientId) {
          return;
      }

      setIsSearchingPatient(true);
      const { data, error } = await supabase
        .from('patients')
        .select('name, patients_id, corporate')
        .eq('hospital_name', hospitalConfig.name)
        .eq('patients_id', debouncedPatientId)
        .single();

      if (data) {
        setPatientInfo({ id: data.patients_id, name: data.name, phone: '', corporate: data.corporate || '' });
        setShowPatientDropdown(false);
      }
      setIsSearchingPatient(false);
    };

    searchPatientsById();
  }, [debouncedPatientId]);

  // Poll for approval status when a pending discount sale has been submitted
  useEffect(() => {
    if (!pendingApprovalDbSaleId) return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('pharmacy_sales')
        .select('payment_status')
        .eq('sale_id', pendingApprovalDbSaleId)
        .single();
      if (!data) return;
      if (data.payment_status === 'COMPLETED') {
        setCompletedSale(prev => prev ? { ...prev, payment_status: 'COMPLETED' } : prev);
        toast.success('Admin approved the discount. You can now print the bill!');
        setPendingApprovalDbSaleId(null);
      } else if (data.payment_status === 'CANCELLED') {
        setCompletedSale(prev => prev ? { ...prev, payment_status: 'CANCELLED' } : prev);
        toast.error('Admin rejected the discount. The sale has been cancelled.');
        setPendingApprovalDbSaleId(null);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [pendingApprovalDbSaleId]);

  useEffect(() => {
    const fetchVisitsForPatient = async () => {
      if (!patientInfo.id || patientInfo.id.length < 2) {
        setVisitOptions([]);
        setVisitId('');
        setDoctorName('');
        return;
      }
      // 1. Get patient row from patients table using patients_id
      const { data: patientRows, error: patientError } = await supabase
        .from('patients')
        .select('id')
        .eq('hospital_name', hospitalConfig.name)
        .eq('patients_id', patientInfo.id)
        .limit(1);
      if (patientError || !patientRows || patientRows.length === 0) {
        setVisitOptions([]);
        setVisitId('');
        setDoctorName('');
        return;
      }
      const patientRow = patientRows[0];
      // 2. Use id to get visits with appointment_with and admission_date, sorted by created_at DESC
      const { data: visits, error: visitError } = await supabase
        .from('visits')
        .select('visit_id, created_at, appointment_with, admission_date')
        .eq('patient_id', patientRow.id)
        .order('created_at', { ascending: false });
      if (visitError || !visits || visits.length === 0) {
        setVisitOptions([]);
        setVisitId('');
        setDoctorName('');
        setEncounterType('OPD');
        return;
      }
      // Store visit objects with IPD/OPD info
      const visitOptionsData: VisitOption[] = visits.map(v => ({
        visit_id: v.visit_id,
        admission_date: v.admission_date,
        appointment_with: v.appointment_with
      }));
      setVisitOptions(visitOptionsData);
      setVisitId(visits[0].visit_id); // Auto-select latest
      setDoctorName(visits[0].appointment_with || ''); // Set doctor name from first visit
      // Set encounter type based on admission_date
      setEncounterType(visits[0].admission_date ? 'IPD' : 'OPD');
    };
    fetchVisitsForPatient();
  }, [patientInfo.id]);

  // Fetch doctor name and update encounter type when visit ID changes
  useEffect(() => {
    const fetchVisitDetails = async () => {
      if (!visitId) {
        setDoctorName('');
        setEncounterType('OPD');
        return;
      }

      // First check if we have the visit in our cached options
      const cachedVisit = visitOptions.find(v => v.visit_id === visitId);
      if (cachedVisit) {
        setDoctorName(cachedVisit.appointment_with || '');
        setEncounterType(cachedVisit.admission_date ? 'IPD' : 'OPD');
        return;
      }

      // If not cached, fetch from database
      const { data, error } = await supabase
        .from('visits')
        .select('appointment_with, admission_date')
        .eq('visit_id', visitId)
        .single();

      if (data && !error) {
        setDoctorName(data.appointment_with || '');
        setEncounterType(data.admission_date ? 'IPD' : 'OPD');
      }
    };

    fetchVisitDetails();
  }, [visitId, visitOptions]);

  const handleSelectPatient = (patient: { name: string, patients_id: string, corporate?: string | null }) => {
    setPatientInfo({ name: patient.name, id: patient.patients_id, phone: '', corporate: patient.corporate || '' });
    setShowPatientDropdown(false);
  };

  // Fetch doctor names from ayushman_consultants table
  const searchDoctors = async (searchTerm: string) => {
    if (searchTerm.length < 2) {
      setDoctorSuggestions([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('ayushman_consultants')
        .select('name')
        .ilike('name', `%${searchTerm}%`)
        .limit(10);

      if (error) throw error;

      // Remove duplicates based on name
      const uniqueDoctors = data?.reduce((acc: Array<{name: string}>, curr: any) => {
        if (curr.name && !acc.some(d => d.name === curr.name)) {
          acc.push({ name: curr.name });
        }
        return acc;
      }, []) || [];

      setDoctorSuggestions(uniqueDoctors);
    } catch (error: any) {
      console.error('Error searching doctors:', error);
    }
  };

  // Handle doctor name search
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (doctorSearchTerm) {
        searchDoctors(doctorSearchTerm);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
  }, [doctorSearchTerm]);

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { 
      style: 'currency', 
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount);

  const addToCart = (medicine: any) => {
    console.log('🏥 Adding medicine to cart:', {
      batch_inventory_id: medicine.id,
      medicine_id: medicine.medicine_id,
      name: medicine.name,
      generic_name: medicine.generic_name,
      batch_number: medicine.batch_number,
      full_medicine_object: medicine
    });

    // Check by batch_inventory_id since each batch is unique
    const existingItem = cart.find(item => item.batch_inventory_id === medicine.id);

    if (existingItem) {
      // Check if we can add more
      if (existingItem.quantity + 1 > existingItem.available_stock) {
        alert(`Cannot add more. Only ${existingItem.available_stock} units in stock for ${existingItem.medicine_name} (Batch: ${existingItem.batch_number}).`);
        return;
      }
      updateQuantity(existingItem.id, existingItem.quantity + 1);
    } else {
      const piecesPerPack = medicine.pieces_per_pack || 1;
      const newItem: CartItem = {
        id: Date.now().toString(),
        medicine_id: medicine.medicine_id, // FK to medicine_master
        batch_inventory_id: medicine.id, // ID from medicine_batch_inventory
        item_code: medicine.item_code || '',
        medicine_name: medicine.name || 'Unknown Medicine',
        generic_name: medicine.generic_name || '',
        strength: medicine.strength || '',
        dosage_form: medicine.dosage || '',
        pack: '',
        administration_time: '',
        batch_number: medicine.batch_number || 'BATCH-001',
        expiry_date: medicine.expiry_date || '',
        mrp: medicine.mrp || medicine.price_per_strip || 0,
        unit_price: (medicine.price_per_strip || 0) / piecesPerPack, // Price per tablet = strip price ÷ pieces per pack
        quantity: 0, // Start with 0 quantity - user must select strips/tablets
        qty_strips: 0, // Default to 0 strips
        qty_tablets: 0, // Default to 0 loose tablets
        discount_percentage: 0,
        discount_amount: 0,
        tax_percentage: 0, // Selling price already includes tax
        tax_amount: 0,
        total_amount: 0,
        available_stock: medicine.stock || 0, // Now in pieces (tablets)
        pieces_per_pack: piecesPerPack,
        prescription_required: medicine.prescription_required || false
      };

      // Calculate amounts based on total pieces (qty_strips * pieces_per_pack + qty_tablets)
      const totalPieces = newItem.quantity; // Already calculated as piecesPerPack (1 strip)
      const subtotal = newItem.unit_price * totalPieces;
      const discountAmount = (subtotal * newItem.discount_percentage) / 100;
      const taxableAmount = subtotal - discountAmount;
      const taxAmount = 0;
      const totalAmount = taxableAmount;

      newItem.discount_amount = discountAmount;
      newItem.tax_amount = taxAmount;
      newItem.total_amount = totalAmount;

      console.log('✅ New cart item created:', {
        medicine_id: newItem.medicine_id,
        medicine_name: newItem.medicine_name,
        qty_strips: newItem.qty_strips,
        qty_tablets: newItem.qty_tablets,
        total_quantity: newItem.quantity,
        pieces_per_pack: newItem.pieces_per_pack
      });

      setCart(prev => [...prev, newItem]);
    }
  };

  const updateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    // Find the item to check available stock
    const existingItem = cart.find(i => i.id === itemId);
    if (existingItem && newQuantity > existingItem.available_stock) {
      alert(`Cannot add more than ${existingItem.available_stock} units. Only ${existingItem.available_stock} in stock for ${existingItem.medicine_name} (Batch: ${existingItem.batch_number}).`);
      return;
    }

    setCart(prev => prev.map(item => {
      if (item.id === itemId) {
        const subtotal = item.unit_price * newQuantity;
        const discountAmount = (subtotal * item.discount_percentage) / 100;
        const taxableAmount = subtotal - discountAmount;
        const taxAmount = 0;
        const totalAmount = taxableAmount;
        
        return {
          ...item,
          quantity: newQuantity,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total_amount: totalAmount
        };
      }
      return item;
    }));
  };

  const updateDiscount = (itemId: string, discountPercentage: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === itemId) {
        const subtotal = item.unit_price * item.quantity;
        const discountAmount = (subtotal * discountPercentage) / 100;
        const taxableAmount = subtotal - discountAmount;
        const taxAmount = 0;
        const totalAmount = taxableAmount;
        
        return {
          ...item,
          discount_percentage: discountPercentage,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total_amount: totalAmount
        };
      }
      return item;
    }));
  };

  const removeFromCart = (itemId: string) => {
    setCart(prev => prev.filter(item => item.id !== itemId));
  };

  const clearCart = () => {
    setCart([]);
    setPatientInfo({ id: '', name: '', phone: '', corporate: '' });
    setPrescriptionId('');
    setDiscountPercentage(0);
    setOrderDiscount(0); // Reset order-level discount
    setPaymentReference('');
    setVisitId('');
    setIsOtSurgical(false);
    setInvoiceSaleId(null);
    setInvoiceBillNumber('');
    setInvoiceVoucher(null);
    setProofUrl(null);
    setPendingProof(null);
  };

  const calculateTotals = () => {
    const subtotal = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    const itemDiscount = cart.reduce((sum, item) => sum + item.discount_amount, 0);
    const totalDiscount = itemDiscount + orderDiscount; // Include order-level discount
    const totalTax = cart.reduce((sum, item) => sum + item.tax_amount, 0);
    const itemTotal = cart.reduce((sum, item) => sum + item.total_amount, 0);
    const totalAmount = Math.ceil(Math.max(0, itemTotal - orderDiscount)); // Round up to whole number

    return { subtotal, totalDiscount, totalTax, totalAmount, orderDiscount };
  };

  const getVisitUUID = async (visitIdString: string) => {
    // Fetch the UUID (id) for the selected visit_id string
    const { data, error } = await supabase
      .from('visits')
      .select('id')
      .eq('visit_id', visitIdString)
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return data[0].id;
  };

  // The pharmacy's receiving QR, loaded once — the patient scans this to pay.
  useEffect(() => {
    fetchPharmacyReceivingQr()
      .then((qr) => setReceivingQrUrl(qr?.qrUrl ?? null))
      .catch(() => setReceivingQrUrl(null));
  }, []);

  const buildSaleData = (billNumber: string, totals: ReturnType<typeof calculateTotals>, paymentStatus: string): SaleData => ({
    sale_type: saleType,
    patient_id: patientInfo.id || undefined,
    visit_id: visitId || undefined,
    patient_name: patientInfo.name || undefined,
    prescription_number: prescriptionId || undefined,
    hospital_name: hospitalConfig?.name || undefined,
    bill_number: billNumber,
    sale_date: patientInfo.corporate ? new Date(saleDate + 'T12:00:00').toISOString() : undefined,
    subtotal: totals.subtotal,
    discount: totals.totalDiscount,
    discount_percentage: discountPercentage,
    tax_gst: totals.totalTax,
    tax_percentage: 0,
    total_amount: totals.totalAmount,
    payment_method: paymentMethod,
    payment_status: paymentStatus as SaleData['payment_status'],
    is_ot_surgical: isOtSurgical,
    created_by: user?.email || user?.username || undefined,
    items: cart.map(item => ({
      medicine_id: item.medicine_id,
      medicine_name: item.medicine_name,
      generic_name: item.generic_name,
      batch_number: item.batch_number || 'N/A',
      expiry_date: item.expiry_date,
      quantity: item.quantity,
      pack_size: 1,
      loose_quantity: 0,
      unit_price: item.unit_price,
      mrp: item.unit_price,
      discount_percentage: item.discount_percentage,
      discount_amount: item.discount_amount,
      tax_percentage: item.tax_percentage,
      tax_amount: item.tax_amount,
      total_amount: item.total_amount,
      manufacturer: undefined,
      dosage_form: item.dosage_form,
      strength: item.strength,
      is_implant: false,
    })),
  });

  /**
   * Generate Invoice — the bill exists and is owed, but nothing has been paid.
   * Saving it fires the database trigger that posts the JV (Dr Pharmacy
   * Debtors, Cr Medicine Sales). Stock still moves at Complete Sale.
   */
  const generateInvoice = async () => {
    if (cart.length === 0) {
      toast.error('Add medicines to the cart first');
      return;
    }
    if (!visitId) {
      toast.error('Enter the Visit ID before generating the invoice');
      return;
    }
    setIsGeneratingInvoice(true);
    try {
      const totals = calculateTotals();
      const billNumber = `BILL${Date.now()}`;
      const response = await savePharmacySale(buildSaleData(billNumber, totals, 'PENDING'));
      if (!response.success || !response.sale_id) {
        throw new Error(response.error || 'Could not save the invoice');
      }
      setInvoiceSaleId(response.sale_id);
      setInvoiceBillNumber(billNumber);

      if (pendingProof) {
        await savePharmacySalePaymentProof(response.sale_id, pendingProof, user?.email || null);
        setPendingProof(null);
      }

      const voucher = await fetchPharmacySaleVoucher(response.sale_id, 'INV');
      setInvoiceVoucher(voucher);
      toast.success(
        voucher
          ? `Invoice ${billNumber} generated — journal ${voucher} posted.`
          : `Invoice ${billNumber} generated.`,
      );
    } catch (error: any) {
      toast.error(error?.message || 'Could not generate the invoice');
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  /** The bank / UPI confirmation. Held until the bill exists, then attached. */
  const onProofSelected = async (file?: File) => {
    if (!file) return;
    const saleId = invoiceSaleId;
    if (!saleId) {
      setPendingProof(file);
      toast.info('Confirmation held — it will be attached when the invoice is generated.');
      return;
    }
    setIsSavingProof(true);
    try {
      const url = await savePharmacySalePaymentProof(saleId, file, user?.email || null);
      setProofUrl(url);
      toast.success('Payment confirmation saved against this bill.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the confirmation');
    } finally {
      setIsSavingProof(false);
      if (proofInputRef.current) proofInputRef.current.value = '';
      if (proofCameraRef.current) proofCameraRef.current.value = '';
    }
  };

  const onReceivingQrSelected = async (file?: File) => {
    if (!file) return;
    try {
      const url = await savePharmacyReceivingQr(file, user?.email || null);
      setReceivingQrUrl(url);
      toast.success('Pharmacy QR saved — patients can scan it from now on.');
    } catch (error: any) {
      toast.error(error?.message || 'Could not save the QR');
    } finally {
      if (qrInputRef.current) qrInputRef.current.value = '';
    }
  };

  const loadUnpaidInvoices = async () => {
    let query = supabase
      .from('pharmacy_sales')
      .select('sale_id, bill_number, patient_name, total_amount, sale_date, payment_method')
      .eq('payment_status', 'PENDING')
      .neq('status', 'cancelled')
      .gt('total_amount', 0)
      .order('sale_date', { ascending: false })
      .limit(20);
    if (hospitalConfig?.name) query = query.eq('hospital_name', hospitalConfig.name);
    const { data } = await query;
    setUnpaidInvoices(data || []);
  };

  useEffect(() => {
    void loadUnpaidInvoices();
  }, [hospitalConfig?.name]);

  /** Money arrived later: mark the bill paid and the database posts the receipt. */
  const settleInvoice = async (saleId: number, method: string) => {
    setBusyInvoiceId(saleId);
    try {
      const { error } = await supabase
        .from('pharmacy_sales')
        .update({ payment_method: method, payment_status: 'COMPLETED' })
        .eq('sale_id', saleId);
      if (error) throw new Error(error.message);
      const receipt = await fetchPharmacySaleVoucher(saleId, 'REC').catch(() => null);
      toast.success(receipt ? `Settled — receipt ${receipt} posted.` : 'Settled.');
      setSettlingId(null);
      await loadUnpaidInvoices();
    } catch (error: any) {
      toast.error(error?.message || 'Could not settle this invoice');
    } finally {
      setBusyInvoiceId(null);
    }
  };

  /** The sale never happened: withdraw the bill and its journal. */
  const cancelInvoice = async (saleId: number, billNumber: string) => {
    if (!window.confirm(`Withdraw invoice ${billNumber}? Its journal is cancelled too.`)) return;
    setBusyInvoiceId(saleId);
    try {
      const { data, error } = await (supabase as any).rpc('cancel_pharmacy_sale_invoice', {
        p_sale_id: saleId,
        p_user: user?.email || user?.username || null,
      });
      if (error) throw new Error(error.message);
      if (data?.cancelled) {
        toast.success(`Invoice ${data.bill_number} withdrawn — journal ${data.journal} cancelled.`);
      } else {
        toast.error(data?.reason || 'Could not cancel this invoice');
      }
      await loadUnpaidInvoices();
    } catch (error: any) {
      toast.error(error?.message || 'Could not cancel this invoice');
    } finally {
      setBusyInvoiceId(null);
    }
  };

  const processSale = async () => {
    if (cart.length === 0) {
      alert('Cart is empty');
      return;
    }
    if (!visitId) {
      alert('Please enter Visit ID');
      return;
    }
    setIsProcessingPayment(true);
    // Get the UUID for the selected visit_id string
    const visitUUID = await getVisitUUID(visitId);
    if (!visitUUID) {
      alert('Could not find visit UUID for selected Visit ID.');
      setIsProcessingPayment(false);
      return;
    }
    // Simulate payment processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    const totals = calculateTotals();
    // An invoice raised earlier IS this bill — settle that row rather than
    // writing a second one, so the JV and the receipt share a bill number.
    const billNumber = invoiceBillNumber || `BILL${Date.now()}`;
    const sale: Sale = {
      id: Date.now().toString(),
      bill_number: billNumber,
      patient_id: patientInfo.id || undefined,
      patient_name: patientInfo.name || undefined,
      prescription_id: prescriptionId || undefined,
      sale_date: patientInfo.corporate ? new Date(saleDate + 'T12:00:00').toISOString() : new Date().toISOString(),
      sale_type: saleType,
      subtotal: totals.subtotal,
      discount_amount: totals.totalDiscount,
      tax_amount: totals.totalTax,
      total_amount: totals.totalAmount,
      paid_amount: totals.totalAmount,
      balance_amount: 0,
      payment_method: paymentMethod,
      payment_reference: paymentReference,
      status: 'COMPLETED',
      payment_status: (totals.totalDiscount > 0 && !isAdmin) ? 'PENDING_DISCOUNT_APPROVAL' : 'COMPLETED',
      is_ot_surgical: isOtSurgical,
      cashier_name: 'Current User',
      items: [...cart]
    };
    // Note: visit_medications insert removed - using medicine_master which has different FK
    // The pharmacy sale is saved to pharmacy_sales and pharmacy_sale_items tables

    // Debug logging

    // Save to pharmacy_sales and pharmacy_sale_items tables

    const settledStatus = (totals.totalDiscount > 0 && !isAdmin)
      ? 'PENDING_DISCOUNT_APPROVAL'
      : 'COMPLETED';

    // Insert, or settle the invoice that was already generated. Either way the
    // database posts the vouchers: the JV when the bill appears, the receipt
    // when it is marked paid.
    let response: { success: boolean; sale_id?: number; error?: string };
    if (invoiceSaleId) {
      // Only the two fields the settlement changes. updated_by is a uuid
      // column and an email address in it fails the whole update — which is
      // what stopped Complete Sale after an invoice had been generated.
      const { error: settleError } = await supabase
        .from('pharmacy_sales')
        .update({
          payment_method: paymentMethod,
          payment_status: settledStatus,
        })
        .eq('sale_id', invoiceSaleId);
      response = settleError
        ? { success: false, error: settleError.message }
        : { success: true, sale_id: invoiceSaleId };
    } else {
      response = await savePharmacySale(buildSaleData(billNumber, totals, settledStatus));
    }

    if (!response.success) {
      console.error('❌ Error saving to pharmacy_sales:', response.error);
      alert('Error saving sale: ' + response.error);
      setIsProcessingPayment(false);
      return;
    }


    // Fire-and-forget: push pharmacy sale to Tally
    pushPharmacySaleToTally({
      invoiceNumber: billNumber,
      patientName: patientInfo?.name || 'Walk-in',
      date: new Date().toISOString().split('T')[0],
      totalAmount: totals.totalAmount,
      items: cart.map(item => ({
        medicineName: item.medicine_name,
        quantity: item.quantity,
        amount: item.total_amount,
      })),
    }).catch(console.error);

    // Deduct stock from medicine_batch_inventory table (batch-wise stock tracking)
    console.log('Cart data:', JSON.stringify(cart.map(item => ({
      batch_inventory_id: item.batch_inventory_id,
      medicine_id: item.medicine_id,
      medicine_name: item.medicine_name,
      batch_number: item.batch_number,
      quantity: item.quantity
    })), null, 2));

    for (const item of cart) {
      try {
        console.log(`\n🔄 Processing medicine: ${item.medicine_name} (Batch: ${item.batch_number}, Inventory ID: ${item.batch_inventory_id})`);

        // Get current stock from medicine_batch_inventory
        const { data: currentBatch, error: fetchError } = await supabase
          .from('medicine_batch_inventory')
          .select('current_stock, batch_number, sold_quantity')
          .eq('id', item.batch_inventory_id)
          .single();

        if (fetchError) {
          console.error(`❌ Error fetching stock for batch ${item.batch_inventory_id}:`, fetchError);
          alert(`Error: Could not fetch stock for ${item.medicine_name} (Batch: ${item.batch_number}). Error: ${fetchError.message}`);
          continue;
        }

        if (!currentBatch) {
          console.error(`❌ Batch not found in medicine_batch_inventory table: ${item.batch_inventory_id}`);
          alert(`Error: ${item.medicine_name} (Batch: ${item.batch_number}) not found in inventory`);
          continue;
        }

        const currentStock = currentBatch.current_stock || 0;
        const newStock = currentStock - item.quantity;
        const currentSoldQty = currentBatch.sold_quantity || 0;
        const newSoldQty = currentSoldQty + item.quantity;

        console.log(`📊 Stock Update Details:`);

        // Check if stock would go negative
        if (newStock < 0) {
          console.warn(`⚠️ Insufficient stock for ${item.medicine_name}. Available: ${currentStock}, Requested: ${item.quantity}`);
          alert(`Warning: Insufficient stock for ${item.medicine_name} (Batch: ${item.batch_number}). Available: ${currentStock}, Sold: ${item.quantity}. Stock set to 0.`);
        }

        // Update the stock in medicine_batch_inventory (use Math.max to prevent negative)
        // Must update both current_stock AND sold_quantity to satisfy check_current_stock_valid constraint
        const { data: updateData, error: updateError } = await supabase
          .from('medicine_batch_inventory')
          .update({
            current_stock: Math.max(0, newStock),
            sold_quantity: newSoldQty,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.batch_inventory_id)
          .select();

        if (updateError) {
          console.error(`❌ Error updating stock for batch ${item.batch_inventory_id}:`, updateError);
          alert(`Error updating stock for ${item.medicine_name} (Batch: ${item.batch_number}): ${updateError.message}`);
        } else {
        }
      } catch (error: any) {
        console.error('❌ Exception in stock update:', error);
        alert(`Exception during stock update for ${item.medicine_name}: ${error.message}`);
      }
    }

    // The confirmation screenshot belongs to the bill it paid.
    if (pendingProof && response.sale_id) {
      try {
        await savePharmacySalePaymentProof(response.sale_id, pendingProof, user?.email || null);
      } catch (error: any) {
        toast.error(`Sale saved, but the confirmation did not attach: ${error?.message || error}`);
      }
    }

    setCompletedSale(sale);
    setIsProcessingPayment(false);

    if (totals.totalDiscount > 0 && !isAdmin) {
      setPendingApprovalDbSaleId(response.sale_id);
      toast.info('Bill submitted for admin discount approval. You will be notified when approved.');
    } else {
      // The receipt is posted by the database; report the number it issued.
      const receipt = response.sale_id
        ? await fetchPharmacySaleVoucher(response.sale_id, 'REC').catch(() => null)
        : null;
      toast.success(
        receipt ? `Sale completed — receipt ${receipt} posted.` : 'Sale completed successfully!',
      );
    }

    void loadUnpaidInvoices();
    clearCart();
  };

  const filteredMedicines = searchResults.filter(medicine =>
    medicine.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medicine.generic_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totals = calculateTotals();

  const printReceipt = () => {
    if (!completedSale) return;
    if (completedSale.payment_status === 'PENDING_DISCOUNT_APPROVAL' || completedSale.payment_status === 'CANCELLED') return;

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    const billDate = new Date(completedSale.sale_date);
    const formattedDate = `${billDate.getDate().toString().padStart(2, '0')}/${(billDate.getMonth() + 1).toString().padStart(2, '0')}/${billDate.getFullYear()} ${billDate.getHours().toString().padStart(2, '0')}:${billDate.getMinutes().toString().padStart(2, '0')}:${billDate.getSeconds().toString().padStart(2, '0')}`;

    const receiptHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sales Bill - ${completedSale.bill_number}</title>
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
              <span class="bill-info-value">${completedSale.bill_number}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Date:</span>
              <span class="bill-info-value">${formattedDate}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Patient:</span>
              <span class="bill-info-value">${completedSale.patient_name || '-'}</span>
            </div>
            <div class="bill-info-row">
              <span class="bill-info-label">Prescribed by:</span>
              <span class="bill-info-value">${completedSale.doctor_name || '-'}</span>
            </div>
          </div>
          <div class="bill-info-right">
            <div class="bill-info-row">
              <span class="bill-info-label">Payment:</span>
              <span class="bill-info-value">${completedSale.payment_method}</span>
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
            ${completedSale.items.map(item => `
              <tr>
                <td>${item.medicine_name}</td>
                <td class="center">${item.pieces_per_pack || '1'}</td>
                <td class="center">${item.batch_number || 'N/A'}</td>
                <td class="center">${item.expiry_date || 'N/A'}</td>
                <td class="center">${item.quantity}</td>
                <td class="amount">${parseFloat(String(item.total_amount || 0)).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="total-section">
          ${(() => {
            const discount = completedSale.discount_amount || 0;
            const subtotal = completedSale.subtotal || (completedSale.total_amount + discount);
            if (discount > 0) {
              return `<div>Subtotal: Rs ${subtotal.toFixed(2)}</div>
              <div>Discount Given: Rs ${discount.toFixed(2)}</div>
              <div class="net-total">Net Amount: Rs ${completedSale.total_amount.toFixed(2)}</div>`;
            }
            return `<div>Total: Rs ${completedSale.total_amount.toFixed(2)}</div>`;
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

  return (
    <>
      <style>{`
        /* Hide number input spinners */
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>
      <div className="space-y-6">
        {/* Invoices raised but not yet paid. Settling one posts its receipt;
            withdrawing one cancels the bill and its journal. Stock is not
            touched either way — the medicines only move when a sale is
            completed from the cart. */}
        {unpaidInvoices.length > 0 && (
          <Card className="border-amber-300 bg-amber-50/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-amber-900">
                Unpaid invoices ({unpaidInvoices.length})
              </CardTitle>
              <p className="text-xs text-amber-800">
                Generated but never completed. Settle when the money comes in, or withdraw the
                bill if the sale did not happen. Medicines are not deducted from stock by either.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {unpaidInvoices.map((inv) => (
                <div
                  key={inv.sale_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {inv.patient_name || 'Walk-in'}{' '}
                      <span className="font-normal text-muted-foreground">
                        · ₹{Number(inv.total_amount).toLocaleString('en-IN')}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inv.bill_number}
                      {inv.sale_date ? ` · ${new Date(inv.sale_date).toLocaleDateString('en-IN')}` : ''}
                    </p>
                  </div>

                  {settlingId === inv.sale_id ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-xs text-muted-foreground">Paid by</span>
                      {['CASH', 'CARD', 'UPI'].map((method) => (
                        <Button
                          key={method}
                          size="sm"
                          variant="outline"
                          disabled={busyInvoiceId === inv.sale_id}
                          onClick={() => void settleInvoice(inv.sale_id, method)}
                        >
                          {method}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" onClick={() => setSettlingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={busyInvoiceId === inv.sale_id}
                        onClick={() => setSettlingId(inv.sale_id)}
                      >
                        {busyInvoiceId === inv.sale_id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Settle'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyInvoiceId === inv.sale_id}
                        onClick={() => void cancelInvoice(inv.sale_id, inv.bill_number)}
                      >
                        Withdraw
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-2xl font-bold">Pharmacy Billing & Dispensing</h2>
            <p className="text-sm text-muted-foreground">
              Process sales, dispense medications, and manage payments
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={clearCart}>
            Clear Cart
          </Button>
          <Button variant="outline">
            <Scan className="h-4 w-4 mr-2" />
            Scan Barcode
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Medicine Search and Cart */}
        <div className="lg:col-span-2 space-y-6">
          {/* Sale Type and Patient Info */}
          <Card>
            <CardHeader>
              <CardTitle>Sale Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="text-sm font-medium">Patient Name / ID</label>
                  <div className="relative">
                    <Input
                      placeholder="Type To Search"
                      value={patientInfo.name}
                      onChange={(e) => setPatientInfo(prev => ({...prev, name: e.target.value}))}
                      onFocus={() => { if (patientInfo.name) setShowPatientDropdown(true); }}
                      onBlur={() => setTimeout(() => setShowPatientDropdown(false), 100)}
                    />
                    {showPatientDropdown && patientSearchResults.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border rounded mt-1 max-h-60 overflow-y-auto">
                        {isSearchingPatient
                          ? <div className="p-2">Searching...</div>
                          : patientSearchResults.map(p => (
                              <div
                                key={p.patients_id}
                                className="p-2 hover:bg-gray-100 cursor-pointer"
                                onMouseDown={() => handleSelectPatient(p)}
                              >
                                {p.name} ({p.patients_id})
                              </div>
                            ))
                        }
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center space-x-2 pb-2">
                    <input
                      type="checkbox"
                      checked={allEncounter}
                      onChange={(e) => setAllEncounter(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm font-medium">All Encounter</span>
                  </label>
                  <Badge
                    variant={encounterType === 'IPD' ? 'default' : 'secondary'}
                    className={`mb-2 ${encounterType === 'IPD' ? 'bg-blue-500 hover:bg-blue-600' : 'bg-green-500 hover:bg-green-600 text-white'}`}
                  >
                    {encounterType}
                  </Badge>
                </div>
                <div className="relative">
                  <label className="text-sm font-medium">Doctor Name</label>
                  <Input
                    placeholder="Type To Search"
                    value={doctorSearchTerm || doctorName}
                    onChange={(e) => {
                      setDoctorSearchTerm(e.target.value);
                      setDoctorName(e.target.value);
                      setShowDoctorResults(true);
                    }}
                    onFocus={() => {
                      if (doctorSearchTerm && doctorSuggestions.length > 0) {
                        setShowDoctorResults(true);
                      }
                    }}
                    onBlur={() => setTimeout(() => setShowDoctorResults(false), 200)}
                  />
                  {showDoctorResults && doctorSuggestions.length > 0 && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {doctorSuggestions.map((doctor, index) => (
                        <div
                          key={index}
                          className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                          onClick={() => {
                            setDoctorName(doctor.name);
                            setDoctorSearchTerm('');
                            setShowDoctorResults(false);
                          }}
                        >
                          <div className="font-medium text-gray-900">{doctor.name}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-sm font-medium">Corporate</label>
                  <Input
                    placeholder="Corporate"
                    value={patientInfo.corporate}
                    readOnly
                    className="bg-gray-50"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Bill Date</label>
                  <Input
                    type="date"
                    value={saleDate}
                    onChange={(e) => setSaleDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    disabled={!patientInfo.corporate}
                    className={patientInfo.corporate ? 'border-blue-400 bg-blue-50' : 'bg-gray-50'}
                  />
                  {!patientInfo.corporate && (
                    <p className="text-xs text-gray-400 mt-1">Backdating available for corporate/panel/yojana patients only</p>
                  )}
                </div>
                <div className="flex items-center">
                  <label
                    htmlFor="ot-surgical-sale"
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                  >
                    <Checkbox
                      id="ot-surgical-sale"
                      checked={isOtSurgical}
                      onCheckedChange={(checked) => setIsOtSurgical(checked === true)}
                    />
                    <span className="text-sm font-medium">OT Surgical</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">Sale Type</label>
                  <select
                    className="w-full p-2 border rounded"
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value as any)}
                  >
                    {saleTypeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Patient ID</label>
                  <Input
                    placeholder="Enter patient ID"
                    value={patientInfo.id}
                    onChange={(e) => setPatientInfo(prev => ({ ...prev, id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Visit ID</label>
                  {visitOptions.length > 0 ? (
                    <select
                      className="w-full p-2 border rounded"
                      value={visitId}
                      onChange={e => setVisitId(e.target.value)}
                    >
                      <option value="">Select visit ID</option>
                      {visitOptions.map((v) => (
                        <option key={v.visit_id} value={v.visit_id}>
                          {v.visit_id} ({v.admission_date ? 'IPD' : 'OPD'})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      placeholder="Enter visit ID"
                      value={visitId}
                      onChange={e => setVisitId(e.target.value)}
                    />
                  )}
                </div>
              </div>
              {saleType === 'antibiotic' && (
                <div>
                  <label className="text-sm font-medium">Prescription ID</label>
                  <Input
                    placeholder="Enter prescription ID"
                    value={prescriptionId}
                    onChange={(e) => setPrescriptionId(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Medicine Search */}
          <Card>
            <CardHeader>
              <CardTitle>Add Medicines</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search medicines by name or generic name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                
                {searchTerm && (
                  <div className="max-h-60 overflow-y-auto border rounded">
                    {isSearching && <div className="p-4 text-center">Searching...</div>}
                    {!isSearching && searchResults.map((medicine) => (
                      <div
                        key={medicine.id}
                        className="p-3 border-b hover:bg-gray-50 cursor-pointer"
                        onClick={() => addToCart(medicine)}
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            <div className="font-medium">{medicine.name}</div>
                            <div className="text-sm text-muted-foreground">
                              Batch: <span className="font-semibold">{medicine.batch_number}</span> | Exp: <span className={medicine.expiry_date && new Date(medicine.expiry_date) < new Date() ? 'text-red-500 font-semibold' : ''}>{medicine.expiry_date || 'N/A'}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Stock: <span className={medicine.stock < 10 ? 'text-orange-500 font-semibold' : 'text-green-600'}>{Math.floor(medicine.stock / (medicine.pieces_per_pack || 1))} Strips + {medicine.stock % (medicine.pieces_per_pack || 1)} Tablets</span> | MRP: {formatCurrency(medicine.mrp || 0)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-green-600">{formatCurrency(medicine.price_per_strip || 0)}</div>
                            <div className="text-xs text-muted-foreground">Selling Price</div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!isSearching && searchResults.length === 0 && searchTerm.length > 1 && (
                      <div className="p-4 text-center text-muted-foreground">
                        No medicines found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Shopping Cart */}
          <Card>
            <CardHeader>
              <CardTitle>Shopping Cart ({cart.length} items)</CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">Cart is empty</p>
                  <p className="text-sm text-muted-foreground">Search and add medicines to get started</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <p className="text-xs text-blue-600 mb-2">Enter quantity in Strips or individual Tablets</p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead>Strips</TableHead>
                        <TableHead>Tablets</TableHead>
                        <TableHead>MRP</TableHead>
                        <TableHead>Price/Pc</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Administration Time</TableHead>
                        <TableHead>Batch No.</TableHead>
                        <TableHead>Stock Available</TableHead>
                        <TableHead>Expiry Date</TableHead>
                        <TableHead>#</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cart.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="min-w-[150px]">
                              <Input
                                className="w-full text-xs font-medium mb-1"
                                value={item.medicine_name}
                                onChange={(e) => {
                                  setCart(prev => prev.map(i =>
                                    i.id === item.id ? { ...i, medicine_name: e.target.value } : i
                                  ));
                                }}
                              />
                              <Input
                                className="w-full text-xs text-muted-foreground"
                                value={item.generic_name || ''}
                                onChange={(e) => {
                                  setCart(prev => prev.map(i =>
                                    i.id === item.id ? { ...i, generic_name: e.target.value } : i
                                  ));
                                }}
                                placeholder="Generic name"
                              />
                            </div>
                          </TableCell>
                          {/* Strips - editable */}
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const newStrips = Math.max(0, item.qty_strips - 1);
                                  const totalQty = (newStrips * item.pieces_per_pack) + item.qty_tablets;
                                  if (totalQty <= item.available_stock) {
                                    const subtotal = item.unit_price * totalQty;
                                    const discountAmount = (subtotal * item.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    setCart(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, qty_strips: newStrips, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                    ));
                                  }
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                className="w-14 text-center text-xs h-6"
                                value={item.qty_strips}
                                onChange={(e) => {
                                  const newStrips = Math.max(0, parseInt(e.target.value) || 0);
                                  const totalQty = (newStrips * item.pieces_per_pack) + item.qty_tablets;
                                  if (totalQty <= item.available_stock) {
                                    const subtotal = item.unit_price * totalQty;
                                    const discountAmount = (subtotal * item.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    setCart(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, qty_strips: newStrips, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                    ));
                                  } else {
                                    alert(`Cannot exceed available stock of ${item.available_stock} tablets.`);
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const newStrips = item.qty_strips + 1;
                                  const totalQty = (newStrips * item.pieces_per_pack) + item.qty_tablets;
                                  if (totalQty <= item.available_stock) {
                                    const subtotal = item.unit_price * totalQty;
                                    const discountAmount = (subtotal * item.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    setCart(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, qty_strips: newStrips, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                    ));
                                  } else {
                                    alert(`Cannot exceed available stock of ${item.available_stock} tablets.`);
                                  }
                                }}
                                disabled={((item.qty_strips + 1) * item.pieces_per_pack + item.qty_tablets) > item.available_stock}
                                className="h-6 w-6 p-0"
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          {/* Tablets - editable for loose tablets */}
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const newTablets = Math.max(0, item.qty_tablets - 1);
                                  const totalQty = (item.qty_strips * item.pieces_per_pack) + newTablets;
                                  const subtotal = item.unit_price * totalQty;
                                  const discountAmount = (subtotal * item.discount_percentage) / 100;
                                  const taxableAmount = subtotal - discountAmount;
                                  const taxAmount = 0;
                                  const totalAmount = taxableAmount;
                                  setCart(prev => prev.map(i =>
                                    i.id === item.id ? { ...i, qty_tablets: newTablets, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                  ));
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                type="number"
                                className="w-14 text-center text-xs h-6"
                                value={item.qty_tablets}
                                onChange={(e) => {
                                  const newTablets = Math.max(0, parseInt(e.target.value) || 0);
                                  const totalQty = (item.qty_strips * item.pieces_per_pack) + newTablets;
                                  if (totalQty <= item.available_stock) {
                                    const subtotal = item.unit_price * totalQty;
                                    const discountAmount = (subtotal * item.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    setCart(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, qty_tablets: newTablets, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                    ));
                                  } else {
                                    alert(`Cannot exceed available stock of ${item.available_stock} tablets.`);
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const newTablets = item.qty_tablets + 1;
                                  const totalQty = (item.qty_strips * item.pieces_per_pack) + newTablets;
                                  if (totalQty <= item.available_stock) {
                                    const subtotal = item.unit_price * totalQty;
                                    const discountAmount = (subtotal * item.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    setCart(prev => prev.map(i =>
                                      i.id === item.id ? { ...i, qty_tablets: newTablets, quantity: totalQty, discount_amount: discountAmount, tax_amount: taxAmount, total_amount: totalAmount } : i
                                    ));
                                  } else {
                                    alert(`Cannot exceed available stock of ${item.available_stock} tablets.`);
                                  }
                                }}
                                disabled={(item.qty_strips * item.pieces_per_pack + item.qty_tablets + 1) > item.available_stock}
                                className="h-6 w-6 p-0"
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                          {/* MRP */}
                          <TableCell>
                            <Input
                              type="number"
                              className="w-24 text-xs"
                              value={item.mrp || 0}
                              onChange={(e) => {
                                const newMrp = parseFloat(e.target.value) || 0;
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, mrp: newMrp } : i
                                ));
                              }}
                            />
                          </TableCell>
                          {/* Price/Pc */}
                          <TableCell>
                            <Input
                              type="number"
                              className="w-24 text-xs"
                              value={item.unit_price}
                              onChange={(e) => {
                                const newPrice = parseFloat(e.target.value) || 0;
                                setCart(prev => prev.map(i => {
                                  if (i.id === item.id) {
                                    const subtotal = newPrice * i.quantity;
                                    const discountAmount = (subtotal * i.discount_percentage) / 100;
                                    const taxableAmount = subtotal - discountAmount;
                                    const taxAmount = 0;
                                    const totalAmount = taxableAmount;
                                    return {
                                      ...i,
                                      unit_price: newPrice,
                                      discount_amount: discountAmount,
                                      tax_amount: taxAmount,
                                      total_amount: totalAmount
                                    };
                                  }
                                  return i;
                                }));
                              }}
                            />
                          </TableCell>
                          {/* Amount */}
                          <TableCell>
                            <Input
                              type="number"
                              className="w-24 text-xs font-medium"
                              value={item.total_amount}
                              onChange={(e) => {
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, total_amount: parseFloat(e.target.value) || 0 } : i
                                ));
                              }}
                            />
                          </TableCell>
                          {/* Administration Time */}
                          <TableCell>
                            <select
                              className="w-32 p-1 border rounded text-xs"
                              value={item.administration_time || ''}
                              onChange={(e) => {
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, administration_time: e.target.value } : i
                                ));
                              }}
                            >
                              <option value="">Please Select</option>
                              <option value="BREAKFAST TIME">BREAKFAST TIME</option>
                              <option value="LUNCH TIME">LUNCH TIME</option>
                              <option value="HS">HS</option>
                              <option value="SOS">SOS</option>
                            </select>
                          </TableCell>
                          {/* Batch No. */}
                          <TableCell>
                            <select
                              className="w-32 p-1 border rounded text-xs"
                              value={item.batch_number || ''}
                              onChange={(e) => {
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, batch_number: e.target.value } : i
                                ));
                              }}
                            >
                              <option value="">Select</option>
                              <option value={item.batch_number}>{item.batch_number}</option>
                            </select>
                          </TableCell>
                          {/* Stock Available */}
                          <TableCell>
                            <Input
                              type="number"
                              className="w-20 text-xs"
                              value={item.available_stock}
                              onChange={(e) => {
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, available_stock: parseFloat(e.target.value) || 0 } : i
                                ));
                              }}
                            />
                          </TableCell>
                          {/* Expiry Date */}
                          <TableCell>
                            <Input
                              type="date"
                              className="w-32 text-xs"
                              value={item.expiry_date || ''}
                              onChange={(e) => {
                                setCart(prev => prev.map(i =>
                                  i.id === item.id ? { ...i, expiry_date: e.target.value } : i
                                ));
                              }}
                            />
                          </TableCell>
                          {/* Delete */}
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => removeFromCart(item.id)}
                              className="h-6 w-6 p-0 text-red-500"
                            >
                              ✕
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Button className="mt-4" variant="outline">
                    Add More
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Order Summary and Payment */}
        <div className="space-y-6">
          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatCurrency(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-green-600">
                <span>Discount:</span>
                <div className="flex items-center gap-2">
                  <span>₹</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={orderDiscount || ''}
                    onChange={(e) => setOrderDiscount(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-24 h-8 text-right text-green-600"
                  />
                </div>
              </div>
              {orderDiscount > 0 && !isAdmin && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800">
                  <strong>Admin approval required.</strong> This bill will be saved as pending until an admin approves the discount.
                </div>
              )}
              {totals.totalDiscount > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Total Discount:</span>
                  <span>-{formatCurrency(totals.totalDiscount)}</span>
                </div>
              )}
              <hr />
              <div className="flex justify-between font-bold text-lg">
                <span>Total:</span>
                <span>₹{totals.totalAmount}</span>
              </div>
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {['CASH', 'CARD', 'UPI', 'CREDIT'].map((method) => (
                  <Button
                    key={method}
                    variant={paymentMethod === method ? "default" : "outline"}
                    onClick={() => setPaymentMethod(method as any)}
                    className="h-12"
                  >
                    {method === 'CASH' && <DollarSign className="h-4 w-4 mr-2" />}
                    {method === 'CARD' && <CreditCard className="h-4 w-4 mr-2" />}
                    {method}
                  </Button>
                ))}
              </div>
              
              {paymentMethod !== 'CASH' && (
                <Input
                  placeholder="Payment reference/transaction ID"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              )}

              {/* The pharmacy's own QR — the patient scans this to pay. */}
              {paymentMethod !== 'CASH' && paymentMethod !== 'CREDIT' && (
                <div className="rounded-md border p-3 text-center">
                  {receivingQrUrl ? (
                    <>
                      <p className="text-xs text-gray-500 mb-2">Show this to the patient to scan</p>
                      <img
                        src={receivingQrUrl}
                        alt="Pharmacy payment QR"
                        className="mx-auto max-h-56 object-contain"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2"
                        onClick={() => qrInputRef.current?.click()}
                      >
                        Replace QR
                      </Button>
                    </>
                  ) : (
                    <>
                      <QrCode className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-500">
                        No pharmacy QR uploaded yet.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => qrInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4 mr-2" /> Upload pharmacy QR
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* The confirmation that comes back from the bank / UPI app. */}
              {paymentMethod !== 'CASH' && (
                <div className="rounded-md border p-3">
                  <p className="text-xs text-gray-500 mb-2">Payment confirmation</p>
                  {proofUrl ? (
                    <a
                      href={proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline"
                    >
                      <FileText className="h-4 w-4" /> Confirmation attached
                    </a>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSavingProof}
                        onClick={() => proofInputRef.current?.click()}
                      >
                        {isSavingProof
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Upload className="h-4 w-4 mr-2" />}
                        Upload
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSavingProof}
                        onClick={() => proofCameraRef.current?.click()}
                        title="Photograph the confirmation"
                        aria-label="Photograph the confirmation"
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                      {pendingProof && (
                        <span className="self-center text-xs text-amber-700">
                          Held — attaches with the invoice
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <input
                ref={proofInputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => void onProofSelected(e.target.files?.[0])}
              />
              <input
                ref={proofCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onProofSelected(e.target.files?.[0])}
              />
              <input
                ref={qrInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onReceivingQrSelected(e.target.files?.[0])}
              />
            </CardContent>
          </Card>

          {/* Process Payment */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              {/* Invoice first: the bill is owed and its journal is posted,
                  before any money changes hands. */}
              {invoiceSaleId ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <strong>Invoice {invoiceBillNumber}</strong> generated
                  {invoiceVoucher ? <> — journal <strong>{invoiceVoucher}</strong> posted.</> : '.'}
                  <div className="text-xs mt-0.5">
                    Complete the sale to record the payment and post the receipt.
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full h-12 text-base"
                  onClick={generateInvoice}
                  disabled={cart.length === 0 || isGeneratingInvoice || isProcessingPayment}
                >
                  {isGeneratingInvoice ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating invoice...
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4 mr-2" />
                      Generate Invoice - ₹{totals.totalAmount}
                    </>
                  )}
                </Button>
              )}

              <Button
                className="w-full h-12 text-lg"
                onClick={processSale}
                disabled={cart.length === 0 || isProcessingPayment}
              >
                {isProcessingPayment ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : totals.totalDiscount > 0 && !isAdmin ? (
                  <>
                    <Clock className="h-4 w-4 mr-2" />
                    Submit for Approval - ₹{totals.totalAmount}
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Complete Sale - ₹{totals.totalAmount}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Sale Completion Dialog */}
      <Dialog open={!!completedSale} onOpenChange={() => { setCompletedSale(null); setPendingApprovalDbSaleId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-center">
              {completedSale?.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? (
                <>
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mx-auto mb-2">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                  <span className="text-amber-600">Pending Admin Approval</span>
                </>
              ) : completedSale?.payment_status === 'CANCELLED' ? (
                <>
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-2">
                    <XCircle className="h-6 w-6 text-red-600" />
                  </div>
                  <span className="text-red-600">Discount Rejected by Admin</span>
                </>
              ) : (
                <>
                  <CheckCircle className="h-6 w-6 mx-auto mb-2 text-green-600" />
                  <span className="text-green-600">Sale Completed Successfully!</span>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {completedSale && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold">{completedSale.bill_number}</div>
                <div className="text-muted-foreground">
                  {new Date(completedSale.sale_date).toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Total Amount:</span>
                  <span className="font-bold">{formatCurrency(completedSale.total_amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Payment Method:</span>
                  <span>{completedSale.payment_method}</span>
                </div>
                {completedSale.patient_name && (
                  <div className="flex justify-between">
                    <span>Patient:</span>
                    <span>{completedSale.patient_name}</span>
                  </div>
                )}
              </div>

              {completedSale.payment_status === 'PENDING_DISCOUNT_APPROVAL' ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center space-y-1">
                  <p className="text-amber-800 font-medium text-sm">Bill printing is blocked until admin approves the discount.</p>
                  <p className="text-amber-600 text-xs">Checking for approval every 15 seconds. Once approved, you can print from View Sales.</p>
                </div>
              ) : completedSale.payment_status === 'CANCELLED' ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center space-y-1">
                  <p className="text-red-800 font-medium text-sm">Admin rejected the discount. This sale has been cancelled.</p>
                  <p className="text-red-600 text-xs">Please create a new sale without the discount if needed.</p>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button className="w-full" onClick={printReceipt}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print Receipt
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
};

export default PharmacyBilling;
