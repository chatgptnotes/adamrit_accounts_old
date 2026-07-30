import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { ArrowLeft, Printer, Plus, Calendar as CalendarIcon, Save } from 'lucide-react';
import { toast } from 'sonner';

interface PhysiotherapyItem {
  id: string;
  item_name: string;
  cghs_code: string;
  cghs_rate: number;
  quantity: number;
  amount: number;
}

interface PatientData {
  visit_id: string;
  patient_name: string;
  address: string;
  age: string;
  sex: string;
  diagnosis: string;
  opd_date: string;
  corporate: string;
}

const PhysiotherapyBill = () => {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();

  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [billNo, setBillNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [items, setItems] = useState<PhysiotherapyItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [billTitle, setBillTitle] = useState('OPD BILL');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingCorporate, setIsEditingCorporate] = useState(false);
  const [corporateType, setCorporateType] = useState('CGHS');
  const [newItem, setNewItem] = useState({
    item_name: '',
    cghs_code: '',
    cghs_rate: 0,
    quantity: 1
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (visitId) {
      fetchPatientData();
    }
  }, [visitId]);

  const fetchPatientData = async () => {
    try {
      setIsLoading(true);

      const { data: visitData, error: visitError } = await supabase
        .from('visits')
        .select(`
          *,
          patients (
            name,
            address,
            age,
            gender,
            date_of_birth
          )
        `)
        .eq('visit_id', visitId)
        .single();

      if (visitError) throw visitError;

      if (visitData) {
        setPatientData({
          visit_id: visitData.visit_id,
          patient_name: visitData.patients?.name || 'N/A',
          address: visitData.patients?.address || 'N/A',
          age: visitData.patients?.age?.toString() || 'N/A',
          sex: visitData.patients?.gender || 'N/A',
          diagnosis: visitData.diagnosis || 'FOR PHYSIOTHERAPY',
          opd_date: visitData.visit_date || new Date().toISOString().split('T')[0],
          corporate: visitData.patients?.corporate || 'CGHS'
        });

        // Use saved bill number if it exists, otherwise generate new one
        const billNumber = visitData.physiotherapy_bill_number ||
                          `OH${visitData.visit_id?.replace(/[^0-9]/g, '') || Date.now()}`;
        setBillNo(billNumber);

        setCorporateType(visitData.patients?.corporate || 'CGHS');

        // Use saved dates if they exist, otherwise use defaults
        const dateFrom = visitData.physiotherapy_bill_date_from ||
                        visitData.visit_date ||
                        new Date().toISOString().split('T')[0];
        const dateTo = visitData.physiotherapy_bill_date_to ||
                      new Date().toISOString().split('T')[0];

        setStartDate(dateFrom);
        setEndDate(dateTo);

        console.log('Loaded bill data from visits table:', {
          billNumber,
          dateFrom,
          dateTo,
          hasSavedBillNumber: !!visitData.physiotherapy_bill_number,
          hasSavedDates: !!visitData.physiotherapy_bill_date_from
        });
      }

      const { data: existingItems, error: itemsError } = await supabase
        .from('physiotherapy_bill_items')
        .select('*')
        .eq('visit_id', visitId);


      if (!itemsError && existingItems && existingItems.length > 0) {
        setItems(existingItems.map(item => ({
          id: item.id,
          item_name: item.item_name,
          cghs_code: item.cghs_code,
          cghs_rate: item.cghs_rate,
          quantity: item.quantity,
          amount: Number(item.amount) || 0
        })));
      } else {
        // Create default first row if no items exist
        const { data: newRow, error: createError } = await supabase
          .from('physiotherapy_bill_items')
          .insert({
            visit_id: visitId,
            item_name: '',
            cghs_code: '',
            cghs_rate: 0,
            quantity: 1,
            amount: 0
          })
          .select()
          .single();

        if (!createError && newRow) {
          setItems([{
            id: newRow.id,
            item_name: '',
            cghs_code: '',
            cghs_rate: 0,
            quantity: 1,
            amount: 0
          }]);
        } else {
          // If database insert fails, still show a row with temporary ID
          console.error('Error creating default row:', createError);
          setItems([{
            id: 'temp-' + Date.now(),
            item_name: '',
            cghs_code: '',
            cghs_rate: 0,
            quantity: 1,
            amount: 0
          }]);
        }
      }

    } catch (error) {
      console.error('Error fetching patient data:', error);
      toast.error('Failed to load patient data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddItem = async () => {
    try {
      const amount = newItem.cghs_rate * newItem.quantity;

      const { error } = await supabase
        .from('physiotherapy_bill_items')
        .insert({
          visit_id: visitId,
          item_name: newItem.item_name,
          cghs_code: newItem.cghs_code,
          cghs_rate: newItem.cghs_rate,
          quantity: newItem.quantity,
          amount: amount
        });

      if (error) throw error;

      setShowAddDialog(false);
      setNewItem({ item_name: '', cghs_code: '', cghs_rate: 0, quantity: 1 });
      await fetchPatientData();
      toast.success('Item added successfully');
    } catch (error) {
      console.error('Error adding item:', error);
      toast.error('Failed to add item');
    }
  };

  const calculateTotal = () => {
    return items.reduce((sum, item) => sum + item.amount, 0);
  };

  const updateItem = async (index: number, field: string, value: any) => {
    const updatedItems = [...items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value
    };

    // Recalculate amount if rate or quantity changed
    if (field === 'cghs_rate' || field === 'quantity') {
      updatedItems[index].amount = updatedItems[index].cghs_rate * updatedItems[index].quantity;
    }

    setItems(updatedItems);

    // Save to database (skip if temp ID)
    try {
      const item = updatedItems[index];

      // If item has a temporary ID, create it in the database first
      if (typeof item.id === 'string' && item.id.startsWith('temp-')) {
        const { data, error } = await supabase
          .from('physiotherapy_bill_items')
          .insert({
            visit_id: visitId,
            item_name: item.item_name,
            cghs_code: item.cghs_code,
            cghs_rate: item.cghs_rate,
            quantity: item.quantity,
            amount: item.amount
          })
          .select()
          .single();

        if (!error && data) {
          updatedItems[index].id = data.id;
          setItems([...updatedItems]);
        }
      } else {
        // Update existing item
        const { error } = await supabase
          .from('physiotherapy_bill_items')
          .update({
            item_name: item.item_name,
            cghs_code: item.cghs_code,
            cghs_rate: item.cghs_rate,
            quantity: item.quantity,
            amount: item.amount
          })
          .eq('id', item.id);

        if (error) throw error;
      }
    } catch (error) {
      console.error('Error updating item:', error);
      toast.error('Failed to update item');
    }
  };

  const addNewRow = async () => {
    try {
      const { data, error } = await supabase
        .from('physiotherapy_bill_items')
        .insert({
          visit_id: visitId,
          item_name: '',
          cghs_code: '',
          cghs_rate: 0,
          quantity: 1,
          amount: 0
        })
        .select()
        .single();

      if (!error && data) {
        setItems([...items, {
          id: data.id,
          item_name: data.item_name,
          cghs_code: data.cghs_code,
          cghs_rate: data.cghs_rate,
          quantity: data.quantity,
          amount: Number(data.amount) || 0
        }]);
        toast.success('New row added');
      } else {
        // If database fails, still add row with temp ID
        setItems([...items, {
          id: 'temp-' + Date.now(),
          item_name: '',
          cghs_code: '',
          cghs_rate: 0,
          quantity: 1,
          amount: 0
        }]);
        toast.success('Row added (will save when you edit)');
      }
    } catch (error) {
      console.error('Error adding new row:', error);
      // Still add row even on error
      setItems([...items, {
        id: 'temp-' + Date.now(),
        item_name: '',
        cghs_code: '',
        cghs_rate: 0,
        quantity: 1,
        amount: 0
      }]);
      toast.success('Row added (will save when you edit)');
    }
  };

  const updateOpdDate = async (newDate: Date) => {
    try {
      const formattedDate = format(newDate, 'yyyy-MM-dd');

      // Update in database
      const { error } = await supabase
        .from('visits')
        .update({ visit_date: formattedDate })
        .eq('visit_id', visitId);

      if (error) throw error;

      // Update local state
      if (patientData) {
        setPatientData({
          ...patientData,
          opd_date: formattedDate
        });
      }

      toast.success('OPD date updated');
    } catch (error) {
      console.error('Error updating OPD date:', error);
      toast.error('Failed to update date');
    }
  };

  const updateDateRange = async (newStartDate?: Date, newEndDate?: Date) => {
    try {
      if (newStartDate) {
        setStartDate(format(newStartDate, 'yyyy-MM-dd'));
      }
      if (newEndDate) {
        setEndDate(format(newEndDate, 'yyyy-MM-dd'));
      }
      toast.success('Date range updated');
    } catch (error) {
      console.error('Error updating date range:', error);
      toast.error('Failed to update date range');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSaveBill = async () => {
    try {
      setIsSaving(true);
      const totalAmount = calculateTotal();

      console.log('Saving bill data:', {
        billNo,
        totalAmount,
        startDate,
        endDate,
        itemsCount: items.length
      });

      // Save bill summary to visits table
      const { error: visitError } = await supabase
        .from('visits')
        .update({
          physiotherapy_bill_number: billNo,
          physiotherapy_bill_total: totalAmount,
          physiotherapy_bill_date_from: startDate,
          physiotherapy_bill_date_to: endDate,
          physiotherapy_bill_generated_at: new Date().toISOString()
        })
        .eq('visit_id', visitId);

      if (visitError) {
        console.error('Error saving to visits table:', visitError);
        throw visitError;
      }

      // Delete existing items for this visit
      const { error: deleteError } = await supabase
        .from('physiotherapy_bill_items')
        .delete()
        .eq('visit_id', visitId);

      if (deleteError) {
        console.error('Error deleting old items:', deleteError);
        throw deleteError;
      }

      // Insert all current items
      if (items.length > 0) {
        const { error: itemsError } = await supabase
          .from('physiotherapy_bill_items')
          .insert(
            items.map(item => ({
              visit_id: visitId,
              item_name: item.item_name,
              cghs_code: item.cghs_code,
              cghs_rate: item.cghs_rate,
              quantity: item.quantity,
              amount: item.amount
            }))
          );

        if (itemsError) {
          console.error('Error inserting items:', itemsError);
          throw itemsError;
        }
      }

      toast.success('Bill saved successfully!');
    } catch (error) {
      console.error('Error saving bill:', error);
      toast.error('Failed to save bill');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!patientData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Patient data not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header with actions - hide on print */}
      <div className="max-w-4xl mx-auto mb-4 no-print flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => navigate('/todays-opd')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to OPD
        </Button>
        <div className="flex gap-2">
          <Button
            onClick={handleSaveBill}
            variant="default"
            disabled={isSaving}
          >
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Bill'}
          </Button>
          <Button onClick={handlePrint} variant="outline">
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {/* Bill Content - EXACT Printed Format */}
      <div className="max-w-5xl mx-auto bg-white border border-gray-300 p-8">
        {/* Header with Title and Date */}
        <div className="text-center pb-3 mb-4" style={{ borderBottom: '1px solid #000' }}>
          <h1 className="text-lg font-bold uppercase mb-1">
            <Popover open={isEditingTitle} onOpenChange={setIsEditingTitle}>
              <PopoverTrigger asChild>
                <span className="cursor-pointer hover:bg-gray-100 px-1 no-print">
                  {billTitle}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Bill Title</label>
                  <Input
                    value={billTitle}
                    onChange={(e) => setBillTitle(e.target.value)}
                    placeholder="Enter bill title"
                  />
                  <Button
                    size="sm"
                    onClick={() => setIsEditingTitle(false)}
                    className="w-full"
                  >
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <span className="print-only">{billTitle}</span>
          </h1>
          <Popover open={isEditingCorporate} onOpenChange={setIsEditingCorporate}>
            <PopoverTrigger asChild>
              <p className="text-sm cursor-pointer hover:bg-gray-100 inline-block px-2 no-print">
                {corporateType}
              </p>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-2">
                <label className="text-sm font-medium">Corporate Type</label>
                <Input
                  value={corporateType}
                  onChange={(e) => setCorporateType(e.target.value)}
                  placeholder="Enter corporate type"
                />
                <Button
                  size="sm"
                  onClick={() => setIsEditingCorporate(false)}
                  className="w-full"
                >
                  Done
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-sm print-only">{corporateType}</p>
        </div>

        {/* Date at top right */}
        <div className="text-right text-sm mb-4">
          <span className="font-medium">DATE:- {new Date().toLocaleDateString('en-GB')}</span>
        </div>

        {/* Patient Details */}
        <div className="mb-4 text-sm space-y-1">
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">BILL NO</span>
            <span className="mr-2">:</span>
            <span>{billNo}</span>
          </div>
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">NAME OF PATIENT</span>
            <span className="mr-2">:</span>
            <span>{patientData.patient_name}</span>
          </div>
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">ADDRESS</span>
            <span className="mr-2">:</span>
            <span>{patientData.address}</span>
          </div>
          <div className="h-2"></div>
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">AGE</span>
            <span className="mr-2">:</span>
            <span>{patientData.age} Yrs.</span>
          </div>
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">SEX</span>
            <span className="mr-2">:</span>
            <span>{patientData.sex}</span>
          </div>
          <div className="flex">
            <span className="w-40 font-medium text-blue-900">DIAGNOSIS</span>
            <span className="mr-2">:</span>
            <span>{patientData.diagnosis}</span>
          </div>
          <div className="flex items-center">
            <span className="w-40 font-medium text-blue-900">DATE OF OPD</span>
            <span className="mr-2">:</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent no-print">
                  <span className="underline decoration-dotted">
                    {new Date(patientData.opd_date).toLocaleDateString('en-GB')}
                  </span>
                  <CalendarIcon className="ml-1 h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(patientData.opd_date)}
                  onSelect={(date) => date && updateOpdDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <span className="print-only">{new Date(patientData.opd_date).toLocaleDateString('en-GB')}</span>
          </div>
        </div>

        {/* Items Table - EXACT format */}
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
          <thead>
            <tr style={{ border: '1px solid #000' }}>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: '70px' }}>SR.<br />NO.</th>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: 'auto' }}>ITEM</th>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: '120px' }}>CGHS<br />NABH<br />CODE No.</th>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: '120px' }}>CGHS<br />NABH<br />RATE</th>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: '80px' }}>QTY</th>
              <th className="p-3 text-center font-semibold" style={{ border: '1px solid #000', width: '120px' }}>AMOUNT</th>
              <th className="p-3 text-center font-semibold no-print" style={{ border: '1px solid #000', width: '100px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* DATE OF OPD Row */}
            <tr style={{ border: '1px solid #000' }}>
              <td colSpan={6} className="p-2.5 font-semibold text-sm" style={{ border: '1px solid #000' }}>
                DATE OF OPD
              </td>
              <td className="no-print" style={{ border: '1px solid #000' }}></td>
            </tr>

            {/* Date Range Row */}
            <tr style={{ border: '1px solid #000' }}>
              <td colSpan={6} className="p-2.5 text-sm" style={{ border: '1px solid #000' }}>
                <span className="no-print">
                  DL (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">
                        <span className="underline decoration-dotted">
                          {new Date(startDate).toLocaleDateString('en-GB')}
                        </span>
                        <CalendarIcon className="ml-1 h-3 w-3 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={new Date(startDate)}
                        onSelect={(date) => date && updateDateRange(date, undefined)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  {' '}to{' '}
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="h-auto p-0 font-normal hover:bg-transparent">
                        <span className="underline decoration-dotted">
                          {new Date(endDate).toLocaleDateString('en-GB')}
                        </span>
                        <CalendarIcon className="ml-1 h-3 w-3 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={new Date(endDate)}
                        onSelect={(date) => date && updateDateRange(undefined, date)}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  )
                </span>
                <span className="print-only">
                  DL ({new Date(startDate).toLocaleDateString('en-GB')} to {new Date(endDate).toLocaleDateString('en-GB')})
                </span>
              </td>
              <td className="no-print" style={{ border: '1px solid #000' }}></td>
            </tr>

            {/* Item Rows */}
            {items.map((item, index) => (
              <tr key={item.id} style={{ border: '1px solid #000' }}>
                <td className="p-3 text-center" style={{ border: '1px solid #000' }}>{index + 1}</td>
                <td className="p-2" style={{ border: '1px solid #000' }}>
                  <Input
                    value={item.item_name}
                    onChange={(e) => updateItem(index, 'item_name', e.target.value)}
                    className="border-0 bg-transparent h-auto p-1 text-sm no-print w-full"
                  />
                  <span className="print-only text-sm">{item.item_name}</span>
                </td>
                <td className="p-2 text-center" style={{ border: '1px solid #000' }}>
                  <Input
                    value={item.cghs_code}
                    onChange={(e) => updateItem(index, 'cghs_code', e.target.value)}
                    className="border-0 bg-transparent h-auto p-1 text-sm text-center no-print w-full"
                  />
                  <span className="print-only text-sm">{item.cghs_code}</span>
                </td>
                <td className="p-2 text-center" style={{ border: '1px solid #000' }}>
                  <Input
                    type="number"
                    value={item.cghs_rate}
                    onChange={(e) => updateItem(index, 'cghs_rate', parseFloat(e.target.value) || 0)}
                    className="border-0 bg-transparent h-auto p-1 text-sm text-center no-print w-full"
                  />
                  <span className="print-only text-sm">{item.cghs_rate}</span>
                </td>
                <td className="p-2 text-center" style={{ border: '1px solid #000' }}>
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 1)}
                    className="border-0 bg-transparent h-auto p-1 text-sm text-center no-print w-full"
                  />
                  <span className="print-only text-sm">{item.quantity}</span>
                </td>
                <td className="p-3 text-right font-medium" style={{ border: '1px solid #000' }}>{item.amount.toFixed(2)}</td>
                <td className="p-2 text-center no-print" style={{ border: '1px solid #000' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={addNewRow}
                    className="h-7 w-7 p-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}

            {/* Total Row */}
            <tr style={{ border: '1px solid #000' }}>
              <td colSpan={5} className="p-3 text-center font-bold text-base" style={{ border: '1px solid #000' }}>
                TOTAL BILL AMOUNT
              </td>
              <td className="p-3 text-right font-bold text-lg" style={{ border: '1px solid #000' }}>
                {calculateTotal().toFixed(2)}
              </td>
              <td className="no-print" style={{ border: '1px solid #000' }}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Print Styles */}
      <style>{`
        .print-only {
          display: none;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          .print-only {
            display: inline !important;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
            margin: 0;
            padding: 0;
          }
          @page {
            margin: 0.75in;
            size: A4;
          }
          /* Ensure header border line is visible */
          .text-center[style*="borderBottom"] {
            border-bottom: 1px solid #000 !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            font-size: 13px !important;
            border: 1px solid #000 !important;
          }
          table tr {
            border: 1px solid #000 !important;
          }
          table th, table td {
            border: 1px solid #000 !important;
            page-break-inside: avoid;
            padding: 10px !important;
            vertical-align: middle !important;
            line-height: 1.5;
          }
          thead th {
            font-weight: 600 !important;
            background-color: #fff !important;
            text-align: center !important;
            border: 1px solid #000 !important;
          }
          tbody td {
            border: 1px solid #000 !important;
          }
          /* Hide 7th column (Actions) completely in print */
          thead tr th:nth-child(7),
          tbody tr td:nth-child(7) {
            display: none !important;
            visibility: collapse !important;
            width: 0 !important;
            max-width: 0 !important;
            min-width: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: none !important;
            overflow: hidden !important;
            opacity: 0 !important;
          }
          /* Force table to only show 6 columns */
          table {
            table-layout: fixed !important;
          }
          thead tr,
          tbody tr {
            display: table-row !important;
          }
          /* Column widths */
          thead th:nth-child(1),
          tbody td:nth-child(1) {
            width: 70px !important;
            text-align: center !important;
          }
          thead th:nth-child(2),
          tbody td:nth-child(2) {
            width: auto !important;
            text-align: left !important;
            padding-left: 12px !important;
          }
          thead th:nth-child(3),
          tbody td:nth-child(3) {
            width: 120px !important;
            text-align: center !important;
          }
          thead th:nth-child(4),
          tbody td:nth-child(4) {
            width: 120px !important;
            text-align: center !important;
          }
          thead th:nth-child(5),
          tbody td:nth-child(5) {
            width: 80px !important;
            text-align: center !important;
          }
          thead th:nth-child(6),
          tbody td:nth-child(6) {
            width: 120px !important;
            text-align: right !important;
            padding-right: 12px !important;
          }
          /* Patient details styling */
          .text-blue-900 {
            color: #1e3a8a !important;
          }
          input {
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
          }
        }
      `}</style>
    </div>
  );
};

export default PhysiotherapyBill;
