import React, { useEffect } from 'react';
import { format } from 'date-fns';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const DischargeInvoice = () => {
  const { visitId } = useParams<{ visitId: string }>();

  // Fetch visit and patient data
  const { data: visitData, isLoading: isLoadingVisit } = useQuery({
    queryKey: ['discharge-invoice-visit', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('visits')
        .select(`
          *,
          patients (*),
          diagnosis:diagnosis_id (id, name)
        `)
        .eq('visit_id', visitId)
        .single();

      if (error) {
        console.error('Error fetching visit data:', error);
        return null;
      }

      return data;
    },
    enabled: !!visitId
  });

  // Fetch bill data for invoice number
  const { data: billData } = useQuery({
    queryKey: ['discharge-invoice-bill', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('bills')
        .select('*')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) console.error('Error fetching bill:', error);
      return data;
    },
    enabled: !!visitId
  });

  // Fetch all financial data from service tables like FinalBill does
  const { data: financialTotals, isLoading: isLoadingFinancial } = useQuery({
    queryKey: ['discharge-invoice-financial', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      console.log('🔍 Fetching financial data for visit:', visitId);

      // First get visit UUID
      const { data: visitUUID, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitUUID) {
        console.error('❌ Error fetching visit UUID:', visitError);
        return { totalAmount: 0, amountPaid: 0, discount: 0 };
      }


      // Fetch all service data in parallel
      const [
        labData,
        radiologyData,
        medicationData,
        clinicalData,
        mandatoryData,
        accommodationData,
        advancePaymentData,
        discountData
      ] = await Promise.all([
        supabase.from('visit_labs').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_radiology').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_medications').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_clinical_services').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_mandatory_services').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_accommodations').select('*').eq('visit_id', visitUUID.id),
        supabase.from('advance_payment').select('advance_amount').eq('visit_id', visitId),
        supabase.from('financial_summary').select('discount_total').eq('visit_id', visitId).maybeSingle()
      ]);

      // Calculate totals
      const labTotal = labData.data?.filter(item => !item.is_hidden).reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      const radiologyTotal = radiologyData.data?.reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      const medicationTotal = medicationData.data?.reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      const clinicalTotal = clinicalData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;
      const mandatoryTotal = mandatoryData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;
      const accommodationTotal = accommodationData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;

      const totalAmount = labTotal + radiologyTotal + medicationTotal + clinicalTotal + mandatoryTotal + accommodationTotal;
      const amountPaid = advancePaymentData.data?.reduce((sum, item) => sum + (parseFloat(item.advance_amount || '0') || 0), 0) || 0;
      const discount = parseFloat(discountData.data?.discount_total || '0') || 0;

      console.log('💰 Calculated totals:', {
        labTotal, radiologyTotal, medicationTotal, clinicalTotal, mandatoryTotal, accommodationTotal,
        totalAmount, amountPaid, discount
      });

      return { totalAmount, amountPaid, discount };
    },
    enabled: !!visitId
  });

  // Fetch final payment
  const { data: finalPaymentData } = useQuery({
    queryKey: ['discharge-invoice-final-payment', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      const { data, error } = await supabase
        .from('final_payments')
        .select('*')
        .eq('visit_id', visitId)
        .maybeSingle();

      if (error) console.error('Error fetching final payment:', error);
      return data;
    },
    enabled: !!visitId
  });

  // Fetch category subtotals for display (not individual items)
  const { data: lineItems } = useQuery({
    queryKey: ['discharge-invoice-line-items', visitId],
    queryFn: async () => {
      if (!visitId) return [];

      // First get visit UUID
      const { data: visitUUID, error: visitError } = await supabase
        .from('visits')
        .select('id')
        .eq('visit_id', visitId)
        .single();

      if (visitError || !visitUUID) return [];

      // Fetch all service data
      const [labData, radiologyData, medicationData, clinicalData, mandatoryData, accommodationData] = await Promise.all([
        supabase.from('visit_labs').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_radiology').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_medications').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_clinical_services').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_mandatory_services').select('*').eq('visit_id', visitUUID.id),
        supabase.from('visit_accommodations').select('*').eq('visit_id', visitUUID.id)
      ]);

      // Calculate category subtotals
      const categoryTotals: any[] = [];

      const labTotal = labData.data?.filter(item => !item.is_hidden).reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      if (labTotal > 0) {
        categoryTotals.push({
          description: 'Laboratory Charges',
          category: 'Laboratory',
          amount: labTotal,
          code: ''
        });
      }

      const radiologyTotal = radiologyData.data?.reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      if (radiologyTotal > 0) {
        categoryTotals.push({
          description: 'Radiology Charges',
          category: 'Radiology',
          amount: radiologyTotal,
          code: ''
        });
      }

      const medicationTotal = medicationData.data?.reduce((sum, item) => sum + (parseFloat(item.cost || '0') || 0), 0) || 0;
      if (medicationTotal > 0) {
        categoryTotals.push({
          description: 'Pharmacy Charges',
          category: 'Pharmacy',
          amount: medicationTotal,
          code: ''
        });
      }

      const clinicalTotal = clinicalData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;
      if (clinicalTotal > 0) {
        categoryTotals.push({
          description: 'Clinical Services',
          category: 'Clinical',
          amount: clinicalTotal,
          code: ''
        });
      }

      const mandatoryTotal = mandatoryData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;
      if (mandatoryTotal > 0) {
        categoryTotals.push({
          description: 'Mandatory Services',
          category: 'Mandatory',
          amount: mandatoryTotal,
          code: ''
        });
      }

      const accommodationTotal = accommodationData.data?.reduce((sum, item) => sum + (parseFloat(item.amount || '0') || 0), 0) || 0;
      if (accommodationTotal > 0) {
        categoryTotals.push({
          description: 'Accommodation Charges',
          category: 'Accommodation',
          amount: accommodationTotal,
          code: ''
        });
      }

      console.log('📋 Category subtotals for invoice:', categoryTotals);
      return categoryTotals;
    },
    enabled: !!visitId
  });

  // Auto-print when data is loaded
  useEffect(() => {
    if (!isLoadingVisit && !isLoadingFinancial && visitData && financialTotals) {
      // Small delay to ensure rendering is complete and data is available
      setTimeout(() => {
        window.print();
      }, 1000);
    }
  }, [isLoadingVisit, isLoadingFinancial, visitData, financialTotals]);

  if (isLoadingVisit || isLoadingFinancial) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading invoice data...</div>
      </div>
    );
  }

  if (!visitData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">Error loading visit data. Please check the visit ID.</div>
      </div>
    );
  }

  const patient = visitData.patients;

  // Use financial totals data for calculations
  const totalAmount = financialTotals?.totalAmount || 0;
  const amountPaid = financialTotals?.amountPaid || 0;
  const discount = financialTotals?.discount || 0;
  const finalPayment = parseFloat(finalPaymentData?.amount || '0');
  const balance = totalAmount - amountPaid - discount - finalPayment;

  // Convert number to words (simple implementation)
  const numberToWords = (num: number): string => {
    if (num === 0) return 'Zero';
    // This is a simplified version - you might want to use a library for complete implementation
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 !== 0 ? ' ' + numberToWords(num % 100) : '');
    if (num < 100000) return numberToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 !== 0 ? ' ' + numberToWords(num % 1000) : '');
    return 'Rupee ' + numberToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 !== 0 ? ' ' + numberToWords(num % 100000) : '');
  };

  return (
    <div className="p-8 bg-white min-h-screen" style={{ fontFamily: 'Arial, sans-serif' }}>
      {/* Print styles */}
      <style>{`
        @media print {
          body {print-color-adjust: exact; -webkit-print-color-adjust: exact;}
          @page {margin: 0.5cm; size: A4;}
        }
      `}</style>

      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="text-sm">{format(new Date(), 'dd/MM/yyyy, HH:mm')}</div>
        <div className="text-center">
          <h1 className="text-xl font-bold">Hospital Management System Billings</h1>
        </div>
        <div className="w-32"></div>
      </div>

      <div className="border-2 border-black p-4">
        {/* Patient Information Table */}
        <table className="w-full text-sm mb-4">
          <tbody>
            <tr>
              <td className="font-semibold py-1" style={{ width: '25%' }}>Name Of Patient</td>
              <td className="py-1">: {patient?.name || 'N/A'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Age/Sex</td>
              <td className="py-1">: {patient?.age || 'N/A'}Y {patient?.gender || 'N/A'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Address</td>
              <td className="py-1">: {patient?.address || 'N/A'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Date Of Registration</td>
              <td className="py-1">
                : {visitData.admission_date ? format(new Date(visitData.admission_date), 'dd/MM/yyyy HH:mm:ss') : 'N/A'}
              </td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Date Of Discharge</td>
              <td className="py-1">
                : {visitData.discharge_date ? format(new Date(visitData.discharge_date), 'dd/MM/yyyy HH:mm:ss') : 'N/A'}
              </td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Invoice No.</td>
              <td className="py-1">: {billData?.formatted_bill_no || billData?.bill_no || 'N/A'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Registration No.</td>
              <td className="py-1">: {patient?.registration_no || visitId}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Category</td>
              <td className="py-1">: {visitData.patient_type || 'PMJAY'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Primary Consultant</td>
              <td className="py-1">: {visitData.appointment_with || 'N/A'}</td>
            </tr>
            <tr>
              <td className="font-semibold py-1">Credit period (in days)</td>
              <td className="py-1">: 000</td>
            </tr>
          </tbody>
        </table>

        {/* Diagnosis */}
        <div className="mb-4">
          <div className="font-semibold text-sm">Diagnosis</div>
          <div className="text-sm">
            {visitData.diagnosis?.name || 'N/A'}
          </div>
        </div>

        {/* Surgeries */}
        <div className="mb-4">
          <div className="font-semibold text-sm">Surgeries</div>
          <div className="text-sm">
            {/* This would need to be fetched from surgeries table - placeholder for now */}
            Surgical procedures listed here
          </div>
        </div>

        {/* Charges Table */}
        <table className="w-full border-collapse border border-black text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-2 text-left" style={{ width: '5%' }}>Sr. No.</th>
              <th className="border border-black p-2 text-left" style={{ width: '50%' }}>Item</th>
              <th className="border border-black p-2 text-center" style={{ width: '15%' }}>CGHS Code No.</th>
              <th className="border border-black p-2 text-right" style={{ width: '10%' }}>Rate</th>
              <th className="border border-black p-2 text-center" style={{ width: '10%' }}>Qty.</th>
              <th className="border border-black p-2 text-right" style={{ width: '15%' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineItems && lineItems.length > 0 ? (
              lineItems.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="border border-black p-2 text-center">{idx + 1}</td>
                  <td className="border border-black p-2">{item.description || item.category || 'Service Charge'}</td>
                  <td className="border border-black p-2 text-center">{item.code || ''}</td>
                  <td className="border border-black p-2 text-right">{item.amount.toLocaleString('en-IN')}</td>
                  <td className="border border-black p-2 text-center">—</td>
                  <td className="border border-black p-2 text-right">{item.amount.toLocaleString('en-IN')}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="border border-black p-4 text-center text-gray-500">
                  No charges available. Total amount shown below.
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={5} className="border border-black p-2 text-right font-bold">Total</td>
              <td className="border border-black p-2 text-right font-bold">
                Rs {totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Amount Summary */}
        <div className="flex justify-between text-sm mb-4">
          <div>
            <div className="font-semibold">Amount Chargeable (in words)</div>
            <div>{numberToWords(Math.floor(totalAmount))} Only</div>
          </div>
          <div className="text-right">
            <table className="border-collapse">
              <tbody>
                <tr>
                  <td className="border border-black p-2 font-semibold">Amount Paid</td>
                  <td className="border border-black p-2 text-right">
                    {amountPaid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
                {discount > 0 && (
                  <tr>
                    <td className="border border-black p-2 font-semibold">Discount Given</td>
                    <td className="border border-black p-2 text-right">
                      Rs. {discount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="border border-black p-2 font-semibold">Balance</td>
                  <td className="border border-black p-2 text-right">
                    Rs. {balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Hospital Details */}
        <div className="text-sm mb-4">
          <div>Hospital Service Tax No. : <strong>ABUPK3897PSD001</strong></div>
          <div>Hospitals PAN : <strong>AAECD9144P</strong></div>
          <div className="mt-2">Signature of Patient :</div>
        </div>

        {/* Footer Signature Section */}
        <div className="flex justify-end text-sm mt-8">
          <div className="text-right">
            <div className="font-bold">Hope Hospital</div>
            <div className="mt-8">
              <div>Bill Manager Cashier Med Supdt. Authorised</div>
              <div className="ml-32">Signatory</div>
            </div>
          </div>
        </div>

        {/* Note */}
        <div className="text-xs mt-4 border-t border-black pt-2">
          <strong>NOTE:</strong> ** indicates that calculated price may vary. Please ask for "Detailed Bill" to see the details.
        </div>
      </div>
    </div>
  );
};

export default DischargeInvoice;
