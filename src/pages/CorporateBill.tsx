// Yojna Bill v2 - saves to yojna_bills table
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { isUuid } from '@/utils/visitId';
import { BillDocumentsSection } from '@/pages/corporate-bill/BillDocumentsSection';
import { ImplantBillSection } from '@/pages/corporate-bill/ImplantBillSection';
import { ImplantStickerSection } from '@/pages/corporate-bill/ImplantStickerSection';

const CorporateBill = () => {
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalConfig?.fullName || 'Hope Hospital Nagpur';
  const { visitId } = useParams<{ visitId: string }>();
  const [loading, setLoading] = useState(true);
  const [patientInfo, setPatientInfo] = useState<any>({});
  const [patientId, setPatientId] = useState<string | undefined>();
  const [diagnosis, setDiagnosis] = useState('');
  const [rows, setRows] = useState([{ item: '', procedure: '', rate: '', qty: '', amount: '' }]);
  const [surgeryDate, setSurgeryDate] = useState('');
  const [implantName, setImplantName] = useState('');
  const [actualVisitId, setActualVisitId] = useState('');

  useEffect(() => {
    if (visitId) fetchBillData();
  }, [visitId]);

  const fetchBillData = async () => {
    try {
      setLoading(true);
      const isUUID = isUuid(visitId);
      let visit: any = null;

      if (isUUID) {
        const { data } = await supabase.from('visits').select('*, patients(*)').eq('id', visitId).single();
        visit = data;
      } else {
        const { data } = await supabase.from('visits').select('*, patients(*)').eq('visit_id', visitId).single();
        visit = data;
      }

      if (!visit) { setLoading(false); return; }
      const patient = visit.patients;
      setPatientId(patient?.id);
      const actualVisitId = visit.visit_id || visitId;
      setActualVisitId(actualVisitId);
      setSurgeryDate(visit.surgery_date ? format(new Date(visit.surgery_date), 'yyyy-MM-dd') : '');
      setImplantName(visit.package_name || '');

      // Fetch bill number from bills table
      const { data: billData } = await supabase
        .from('bills')
        .select('bill_no')
        .eq('visit_id', actualVisitId)
        .order('created_at', { ascending: false })
        .limit(1);

      const billNo = billData?.[0]?.bill_no || `BILL-${actualVisitId}`;

      setPatientInfo({
        patientName: patient?.name || '',
        age: patient?.age || '',
        gender: patient?.gender || '',
        ageSex: `${patient?.age || ''}Y / ${patient?.gender || ''}`,
        address: patient?.address || '',
        dateOfRegistration: patient?.created_at ? format(new Date(patient.created_at), 'dd-MM-yyyy') : '',
        dateOfDischarge: visit.discharge_date ? format(new Date(visit.discharge_date), 'dd-MM-yyyy') : '',
        dateOfInvoice: format(new Date(), 'dd-MM-yyyy'),
        invoiceNo: billNo,
        registrationNo: patient?.patients_id || '',
        category: patient?.corporate || 'Private',
        primaryConsultant: visit.appointment_with || '',
      });
      setDiagnosis(visit.diagnosis || '');

      // Load previously saved Yojna Bill data if exists
      const { data: savedBill } = await supabase
        .from('yojna_bills')
        .select('*')
        .eq('visit_id', actualVisitId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (savedBill && savedBill.length > 0) {
        const bill = savedBill[0];
        if (bill.items && Array.isArray(bill.items) && bill.items.length > 0) {
          setRows(bill.items.map((item: any) => ({
            item: item.item || '',
            procedure: item.procedure || '',
            rate: item.rate?.toString() || '',
            qty: item.qty?.toString() || '',
            amount: item.amount?.toString() || '',
          })));
        }
        if (bill.diagnosis) setDiagnosis(bill.diagnosis);
        // Update patient info with saved values if they exist
        if (bill.invoice_no || bill.date_of_invoice) {
          setPatientInfo(prev => ({
            ...prev,
            ...(bill.invoice_no ? { invoiceNo: bill.invoice_no } : {}),
            ...(bill.date_of_invoice ? { dateOfInvoice: bill.date_of_invoice } : {}),
          }));
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const addRow = () => {
    setRows([...rows, { item: '', procedure: '', rate: '', qty: '', amount: '' }]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: string, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    // Auto-calculate amount = rate * qty
    if (field === 'rate' || field === 'qty') {
      const rate = parseFloat(field === 'rate' ? value : newRows[index].rate) || 0;
      const qty = parseFloat(field === 'qty' ? value : newRows[index].qty) || 0;
      newRows[index].amount = (rate * qty).toString();
    }
    setRows(newRows);
  };

  const getTotal = () => rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);

  const handleSave = async () => {
    try {
      const payload = {
        visit_id: visitId,
        patient_name: patientInfo.patientName,
        registration_no: patientInfo.registrationNo,
        corporate_name: patientInfo.category,
        hospital_name: hospitalName,
        invoice_no: patientInfo.invoiceNo,
        diagnosis: diagnosis,
        primary_consultant: patientInfo.primaryConsultant,
        date_of_registration: patientInfo.dateOfRegistration,
        date_of_discharge: patientInfo.dateOfDischarge,
        date_of_invoice: patientInfo.dateOfInvoice,
        age_sex: patientInfo.ageSex,
        address: patientInfo.address,
        items: rows.filter(r => r.item || r.procedure),
        total_amount: getTotal(),
        status: 'saved'
      };
      // Check if entry exists — update instead of duplicate
      const { data: existing } = await supabase.from('yojna_bills').select('id').eq('visit_id', visitId).limit(1);
      let error;
      if (existing && existing.length > 0) {
        ({ error } = await supabase.from('yojna_bills').update(payload).eq('visit_id', visitId));
      } else {
        ({ error } = await supabase.from('yojna_bills').insert(payload));
      }
      if (error) throw error;
      alert('Yojna Bill saved successfully!');
    } catch (err: any) {
      alert('Error saving: ' + err.message);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="text-lg">Loading Yojna Bill...</div></div>;

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      {/* Toolbar */}
      <div className="print:hidden mb-4 flex gap-3 items-center bg-gray-800 text-white p-3 rounded-lg flex-wrap">
        <button onClick={() => window.print()} className="px-4 py-2 bg-green-500 rounded font-bold hover:bg-green-600">Print</button>
        <button onClick={handleSave} className="px-4 py-2 bg-blue-500 rounded font-bold hover:bg-blue-600">Save to Database</button>
        <button onClick={() => window.history.back()} className="px-4 py-2 bg-red-500 rounded font-bold hover:bg-red-600">Back</button>
        <span className="text-sm text-gray-300 ml-2">All fields are editable</span>
      </div>

      {/* Bill + Documents side panel */}
      <div className="flex flex-wrap items-start justify-center gap-4 print:block xl:flex-nowrap">
      {/* Bill */}
      <div className="w-[210mm] max-w-full shrink-0 bg-white shadow-lg print:shadow-none print:m-0 print:mx-auto">
        <div className="p-6 print:p-4" style={{ fontFamily: 'Arial, sans-serif' }}>

          <div className="text-center border-b-2 border-black pb-2 mb-0">
            <h1 className="text-xl font-bold tracking-wide">FINAL BILL</h1>
          </div>

          {/* Patient Info */}
          <table className="w-full text-sm border-collapse">
            <tbody>
              {[
                ['Name Of Patient', 'patientName'],
                ['Age/Sex', 'ageSex'],
                ['Address', 'address'],
                ['Date Of Registration', 'dateOfRegistration'],
                ['Date Of Discharge', 'dateOfDischarge'],
                ['Date Of Invoice', 'dateOfInvoice'],
                ['Invoice No.', 'invoiceNo'],
                ['Registration No.', 'registrationNo'],
                ['Category', 'category'],
                ['Primary Consultant', 'primaryConsultant'],
              ].map(([label, key], idx) => (
                <tr key={idx}>
                  <td className="py-1 font-semibold w-[200px] border border-gray-300 px-2 bg-green-50">{label}</td>
                  <td className="py-1 w-[10px] border border-gray-300 text-center">:</td>
                  <td className="py-1 border border-gray-300 px-2 font-medium" contentEditable suppressContentEditableWarning
                    onBlur={(e) => setPatientInfo({...patientInfo, [key]: e.currentTarget.textContent || ''})}>
                    {patientInfo[key]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Diagnosis */}
          <div className="border border-gray-300 border-t-0 flex text-sm">
            <div className="font-semibold px-2 py-1 w-[200px] bg-green-50 border-r border-gray-300">Diagnosis</div>
            <div className="px-2 py-1 flex-1 italic" contentEditable suppressContentEditableWarning
              onBlur={(e) => setDiagnosis(e.currentTarget.textContent || '')}>
              {diagnosis || 'N/A'}
            </div>
          </div>

          {/* Items Table - SCREEN ONLY (interactive with inputs) */}
          <table className="w-full text-sm border-collapse mt-0 print:hidden">
            <thead>
              <tr className="bg-green-50">
                <th className="border border-gray-400 px-2 py-2 text-center w-[50px]">Sr. No.</th>
                <th className="border border-gray-400 px-2 py-2 text-center w-[100px]">Item</th>
                <th className="border border-gray-400 px-2 py-2 text-center">Procedure</th>
                <th className="border border-gray-400 px-2 py-2 text-center w-[80px]">Rate</th>
                <th className="border border-gray-400 px-2 py-2 text-center w-[60px]">Qty.</th>
                <th className="border border-gray-400 px-2 py-2 text-center w-[90px]">Amount</th>
                <th className="border border-gray-400 px-2 py-2 text-center w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td className="border border-gray-400 px-2 py-2 text-center">{index + 1}</td>
                  <td className="border border-gray-400 px-1 py-1">
                    <input type="text" value={row.item} onChange={(e) => updateRow(index, 'item', e.target.value)}
                      className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="Item" />
                  </td>
                  <td className="border border-gray-400 px-1 py-1">
                    <input type="text" value={row.procedure} onChange={(e) => updateRow(index, 'procedure', e.target.value)}
                      className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="Procedure" />
                  </td>
                  <td className="border border-gray-400 px-1 py-1">
                    <input type="number" value={row.rate} onChange={(e) => updateRow(index, 'rate', e.target.value)}
                      className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="0" />
                  </td>
                  <td className="border border-gray-400 px-1 py-1">
                    <input type="number" value={row.qty} onChange={(e) => updateRow(index, 'qty', e.target.value)}
                      className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="0" />
                  </td>
                  <td className="border border-gray-400 px-2 py-2 text-center font-bold">{row.amount || ''}</td>
                  <td className="border border-gray-400 px-1 py-1 text-center whitespace-nowrap">
                    <button onClick={addRow} className="text-green-600 hover:text-green-800 font-bold text-sm mr-1" title="Add Row">+</button>
                    {rows.length > 1 && (
                      <button onClick={() => removeRow(index)} className="text-red-500 hover:text-red-700 font-bold text-sm" title="Remove Row">-</button>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="border border-gray-400 px-2 py-2 text-center" colSpan={5}>Total</td>
                <td className="border border-gray-400 px-2 py-2 text-center">{getTotal()}</td>
                <td className="border border-gray-400"></td>
              </tr>
            </tbody>
          </table>

          {/* Items Table - PRINT ONLY (static text, no inputs, no buttons) */}
          <table style={{ display: 'none' }} className="print:table w-full text-sm border-collapse mt-0">
            <thead>
              <tr style={{ backgroundColor: '#f0fdf4' }}>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', width: '50px' }}>Sr. No.</th>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', width: '100px' }}>Item</th>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>Procedure</th>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', width: '80px' }}>Rate</th>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', width: '60px' }}>Qty.</th>
                <th style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', width: '90px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{index + 1}</td>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{row.item}</td>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{row.procedure}</td>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{row.rate}</td>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{row.qty}</td>
                  <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center', fontWeight: 'bold' }}>{row.amount}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 'bold' }}>
                <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }} colSpan={5}>Total</td>
                <td style={{ border: '1px solid #9ca3af', padding: '6px 8px', textAlign: 'center' }}>{getTotal()}</td>
              </tr>
            </tbody>
          </table>



          {/* Tax Info */}
          <div className="mt-6 text-sm space-y-1">
            <div className="flex">
              <span className="font-semibold w-[200px]">Hospital Service Tax No.</span>
              <span className="w-[10px] text-center">:</span>
              <span className="ml-2 font-medium" contentEditable suppressContentEditableWarning>ABUPK3997PSD001</span>
            </div>
            <div className="flex">
              <span className="font-semibold w-[200px]">Hospitals PAN</span>
              <span className="w-[10px] text-center">:</span>
              <span className="ml-2 font-medium" contentEditable suppressContentEditableWarning>AAECD9144P</span>
            </div>
          </div>

          <div className="mt-16 text-right text-sm">
            <p className="font-bold">{hospitalName}</p>
            <p className="font-semibold">Authorized Signatory</p>
          </div>
        </div>
      </div>

        {/* Implant Bill (vendor invoice for implants used in this surgery) */}
        {actualVisitId && (
          <ImplantBillSection
            visitId={actualVisitId}
            patientName={patientInfo.patientName || ''}
            defaultBillDate={surgeryDate}
            defaultImplantName={implantName}
          />
        )}

        {/* Implant Sticker (patient-header cover sheet for pasting the implant pouch sticker) */}
        {actualVisitId && (
          <ImplantStickerSection
            visitId={actualVisitId}
            patient={{
              patientName: patientInfo.patientName || '',
              patientId: patientInfo.registrationNo || '',
              age: patientInfo.age ? `${patientInfo.age}` : '',
              sex: patientInfo.gender || '',
              admissionDate: patientInfo.dateOfRegistration || '',
              dischargeDate: patientInfo.dateOfDischarge || '',
              hospitalName,
            }}
            defaultSurgeryDate={surgeryDate}
            defaultSurgeryName={implantName}
          />
        )}

        {/* Documents side panel (hidden on print) */}
        <aside className="print:hidden w-full max-w-full shrink-0 xl:w-[340px]">
          <BillDocumentsSection patientId={patientId} patientName={patientInfo.patientName} />
        </aside>
      </div>
    </div>
  );
};

export default CorporateBill;
