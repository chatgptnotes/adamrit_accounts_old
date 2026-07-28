import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer } from 'lucide-react';
import { format } from 'date-fns';
import { useInvoiceAccess } from '@/hooks/useInvoiceAccess';
import InvoicePasswordGate from '@/components/invoice/InvoicePasswordGate';

const ViewBill = () => {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();

  // This page replays a saved bill with its own Print button. Before the gate it
  // had no lock at all, so it re-printed bills the Final Bill page refused to —
  // which is exactly the hole this closes.
  const access = useInvoiceAccess(billId);

  // Fetch real bill data from bills, bill_sections, and bill_line_items tables
  const { data: billData, isLoading } = useQuery({
    queryKey: ['view-bill', billId, access.grantToken],
    queryFn: async () => {
      if (!billId) return null;

      console.log('🔍 Fetching bill data for ID:', billId);

      // Fetch main bill record
      const { data: bill, error: billError } = await supabase
        .from('bills')
        .select(`
          *,
          patients (
            id,
            name,
            patients_id,
            age,
            gender,
            address,
            phone,
            insurance_person_no
          )
        `)
        .eq('id', billId)
        .single();

      if (billError) {
        console.error('Error fetching bill:', billError);
        throw billError;
      }

      if (!bill) {
        throw new Error('Bill not found');
      }

      // Line items come through the gated RPC rather than straight off the
      // tables. For an unlocked or corporate bill it returns content freely; for
      // a locked private bill it refuses unless the grant token is valid. Once
      // anon's SELECT on these tables is revoked, this is the only way in.
      const { data: content, error: contentError } = await (supabase as any).rpc('get_invoice_content', {
        p_bill_id: billId,
        p_grant_token: access.grantToken,
      });

      if (contentError) {
        console.error('Error fetching invoice content:', contentError);
        throw contentError;
      }

      const sections = (content as any)?.ok ? (content as any).sections : [];
      const lineItems = (content as any)?.ok ? (content as any).line_items : [];

      const billWithRelations = {
        ...bill,
        bill_sections: sections || [],
        bill_line_items: lineItems || [],
        bill_items_json: (content as any)?.ok ? (content as any).bill_items_json : null,
        bill_patient_data: (content as any)?.ok ? (content as any).bill_patient_data : null,
      };

      console.log('📊 Bill sections:', sections?.length || 0);
      console.log('📋 Bill line items:', lineItems?.length || 0);
      console.log('💰 Total amount:', bill.total_amount);

      return billWithRelations;
    },
    // Do not fetch bill content at all while the gate is up — an unauthorised
    // response should never be in the page, even unrendered.
    enabled: !!billId && !access.needsGate && !access.isLockLoading
  });

  // Patient data is now included in billData.patients

  const formatCurrency = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const handlePrint = () => {
    window.print();
  };

  const handleGoBack = () => {
    navigate(-1);
  };

  // The gate replaces the bill entirely rather than covering it, so the
  // protected content is never present in the DOM behind an overlay.
  if (access.needsGate) {
    return (
      <InvoicePasswordGate
        billNo={access.lockState?.bill_no}
        patientName={access.lockState?.patient_name}
        verifying={access.verifying}
        error={access.error}
        onUnlock={access.unlock}
        onBack={handleGoBack}
      />
    );
  }

  if (isLoading || access.isLockLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading bill details...</p>
        </div>
      </div>
    );
  }

  if (!billData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Bill Not Found</h2>
          <p className="text-gray-600 mb-4">The requested bill could not be found.</p>
          <Button onClick={handleGoBack} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  // Use patient data from bill
  const patientData = billData?.patients;

  return (
    <div className="min-h-screen bg-gray-50">
      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
            body { margin: 0; font-family: Arial, sans-serif; }
            .no-print { display: none !important; }
            .print-table { width: 100% !important; border-collapse: collapse !important; }
            .print-border { border: 1px solid black !important; }
            .print-text-center { text-align: center !important; }
            .print-text-left { text-align: left !important; }
            .print-text-right { text-align: right !important; }
            .print-font-bold { font-weight: bold !important; }
            .print-p-2 { padding: 8px !important; }
            .print-p-4 { padding: 16px !important; }
            .print-mb-4 { margin-bottom: 16px !important; }
            .print-bg-gray { background-color: #f5f5f5 !important; }
            table { page-break-inside: avoid; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          }
        `
      }} />

      <div className="max-w-6xl mx-auto p-4">
        {/* Header - Hidden in print */}
        <div className="mb-6 no-print">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                onClick={handleGoBack}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Bills
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Bill #{billData.formatted_bill_no || billData.bill_no || billData.id.slice(0, 8)}
                </h1>
                <p className="text-sm text-gray-600">
                  Created on {format(new Date(billData.created_at), 'dd/MM/yyyy')} at {format(new Date(billData.created_at), 'HH:mm:ss')}
                </p>
              </div>
            </div>
            <Button onClick={handlePrint} className="flex items-center gap-2">
              <Printer className="h-4 w-4" />
              Print Bill
            </Button>
          </div>
        </div>

        {/* Final Bill Layout - Exact match to FinalBill.tsx */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          {/* Bill Header */}
          <div className="border border-gray-300 mb-4">
            <div className="bg-gray-100 p-3 text-center border-b border-gray-300">
              <h1 className="text-xl font-bold">FINAL BILL</h1>
            </div>
            <div className="bg-gray-100 p-2 text-center border-b border-gray-300">
              <span className="font-semibold">ESIC</span>
            </div>
            <div className="p-2 text-center">
              <span className="font-semibold">CLAIM ID:</span> {billData.claim_id || billData.id.slice(0, 8)}
            </div>
          </div>

          {/* Patient Information Section */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Left Column */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-semibold">BILL NO:</span></div>
                <div>{billData.formatted_bill_no || billData.bill_no || billData.id.slice(0, 8)}</div>

                <div><span className="font-semibold">REGISTRATION NO:</span></div>
                <div>{patientData?.patient_id || patientData?.patients_id || 'N/A'}</div>

                <div><span className="font-semibold">NAME OF PATIENT:</span></div>
                <div>{patientData?.patient_name || patientData?.name || 'N/A'}</div>

                <div><span className="font-semibold">AGE:</span></div>
                <div>{patientData?.age || 'N/A'}</div>

                <div><span className="font-semibold">SEX:</span></div>
                <div>{patientData?.sex || 'N/A'}</div>

                <div><span className="font-semibold">NAME OF ESIC BENEFICIARY:</span></div>
                <div>{patientData?.patient_name || patientData?.name || 'N/A'}</div>

                <div><span className="font-semibold">RELATION WITH IP:</span></div>
                <div>SELF</div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-semibold">DATE:</span></div>
                <div>{format(new Date(billData.created_at), 'dd/MM/yyyy')}</div>

                <div><span className="font-semibold">DATE OF ADMISSION:</span></div>
                <div>{patientData?.date_of_admission ? format(new Date(patientData.date_of_admission), 'dd/MM/yyyy') : 'N/A'}</div>

                <div><span className="font-semibold">DATE OF DISCHARGE:</span></div>
                <div>{patientData?.date_of_discharge ? format(new Date(patientData.date_of_discharge), 'dd/MM/yyyy') : 'N/A'}</div>

                <div><span className="font-semibold">IP NO:</span></div>
                <div>{patientData?.mrn || 'N/A'}</div>

                <div><span className="font-semibold">SERVICE NO:</span></div>
                <div>{patientData?.patient_id || 'N/A'}</div>

                <div><span className="font-semibold">CATEGORY:</span></div>
                <div className="bg-green-200 px-2 py-1 rounded text-center">{billData.category || 'GENERAL'}</div>

                <div><span className="font-semibold">DIAGNOSIS:</span></div>
                <div>{patientData?.diagnosis_and_surgery_performed || 'No diagnosis'}</div>
              </div>
            </div>
          </div>

          {/* Bill Items Table - Read Only */}
          <div className="border border-gray-300 mb-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 p-2 text-left text-sm font-semibold">SR NO</th>
                  <th className="border border-gray-300 p-2 text-left text-sm font-semibold">ITEM</th>
                  <th className="border border-gray-300 p-2 text-center text-sm font-semibold">CGHS NABH CODE NO.</th>
                  <th className="border border-gray-300 p-2 text-center text-sm font-semibold">CGHS NABH RATE</th>
                  <th className="border border-gray-300 p-2 text-center text-sm font-semibold">QTY</th>
                  <th className="border border-gray-300 p-2 text-center text-sm font-semibold">AMOUNT</th>
                  <th className="border border-gray-300 p-2 text-center text-sm font-semibold">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {/* Render Sections */}
                {billData.bill_sections?.map((section: any, sectionIndex: number) => (
                  <React.Fragment key={section.id}>
                    <tr>
                      <td colSpan={7} className="border border-gray-300 p-2 bg-gray-50 font-semibold">
                        {section.section_title}
                      </td>
                    </tr>
                    {section.date_from && section.date_to && (
                      <tr>
                        <td className="border border-gray-300 p-2 text-center">{sectionIndex + 1}</td>
                        <td className="border border-gray-300 p-2">
                          Dt.({format(new Date(section.date_from), 'dd/MM/yyyy')} TO {format(new Date(section.date_to), 'dd/MM/yyyy')})
                        </td>
                        <td className="border border-gray-300 p-2"></td>
                        <td className="border border-gray-300 p-2"></td>
                        <td className="border border-gray-300 p-2"></td>
                        <td className="border border-gray-300 p-2"></td>
                        <td className="border border-gray-300 p-2 text-center">
                          <span className="text-green-600">✓</span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}

                {/* Render Line Items */}
                {billData.bill_line_items?.map((item: any, index: number) => (
                  <tr key={item.id}>
                    <td className="border border-gray-300 p-2 text-center">{item.sr_no || index + 1}</td>
                    <td className="border border-gray-300 p-2">{item.item_description}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.cghs_nabh_code || ''}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.cghs_nabh_rate || ''}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.qty}</td>
                    <td className="border border-gray-300 p-2 text-center">{item.amount}</td>
                    <td className="border border-gray-300 p-2 text-center">
                      <span className="text-green-600">✓</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total Amount */}
          <div className="bg-black text-white p-4">
            <div className="flex justify-between items-center">
              <span className="text-xl font-bold">TOTAL BILL AMOUNT</span>
              <span className="text-2xl font-bold">{formatCurrency(billData.total_amount || 0)}</span>
            </div>
          </div>

          {/* Signature Section */}
          <div className="mt-6 grid grid-cols-5 gap-8 text-center text-sm">
            <div>
              <div className="border-t border-gray-400 pt-2">
                <span className="font-semibold">Bill Executive</span>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-2">
                <span className="font-semibold">Cashier</span>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-2">
                <span className="font-semibold">Patient Sign</span>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-2">
                <span className="font-semibold">Cashier Head Stamp</span>
              </div>
            </div>
            <div>
              <div className="border-t border-gray-400 pt-2">
                <span className="font-semibold">Authorized Signatory</span>
              </div>
            </div>
          </div>

          {/* Footer Buttons - Read Only */}
          <div className="mt-6 flex justify-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-blue-500 rounded"></span>
              <span>Save Draft</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-gray-400 rounded"></span>
              <span>Clear Draft</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-blue-600 rounded"></span>
              <span>Save Bill</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-green-600 rounded"></span>
              <span>Save Bill</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="w-3 h-3 bg-gray-800 rounded"></span>
              <span>Print / Save PDF</span>
            </div>
          </div>

          {/* Generated Info */}
          <div className="mt-4 text-center text-xs text-gray-500">
            <p>✅ Bill saved to database. ID: {billData.id?.slice(0, 8)}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ViewBill;
