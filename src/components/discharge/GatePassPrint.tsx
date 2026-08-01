import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';
import { Building2, Shield, Clock, User, CreditCard, FileCheck } from 'lucide-react';

interface GatePassPrintProps {
  visitId: string;
}

interface GatePassData {
  id: string;
  gate_pass_number: string;
  patient_name: string;
  discharge_date: string;
  discharge_mode: string;
  bill_paid: boolean;
  payment_amount: number;
  receptionist_signature?: string;
  billing_officer_signature?: string;
  barcode_data: string;
  created_at: string;
  visit: {
    visit_id: string;
    patients: {
      patients_id: string;
      age: number;
      gender: string;
      insurance_person_no?: string;
    };
  };
}

export const GatePassPrint: React.FC<GatePassPrintProps> = ({ visitId }) => {
  const { data: gatePass, isLoading, error } = useQuery({
    queryKey: ['gate-pass', visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gate_passes')
        .select(`
          *,
          visit:visits!inner(
            visit_id,
            patients!inner(
              patients_id,
              age,
              gender,
              insurance_person_no
            )
          )
        `)
        .eq('visit.visit_id', visitId)
        // Latest pass wins: a re-discharged visit can carry two gate passes,
        // and .single() throws on both zero and multiple rows.
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as GatePassData;
    },
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <span className="ml-2">Loading gate pass...</span>
      </div>
    );
  }

  if (error || !gatePass) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600">Gate pass not found or error loading data.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-8">
      {/* Print Button - Hidden in print */}
      <div className="no-print mb-4 text-center">
        <button
          onClick={handlePrint}
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
        >
          Print Gate Pass
        </button>
      </div>

      {/* Gate Pass Content */}
      <Card className="max-w-4xl mx-auto border-2 border-black">
        <CardContent className="p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Building2 className="h-8 w-8" />
              <h1 className="text-3xl font-bold">HOPE HOSPITAL</h1>
            </div>
            <p className="text-gray-600">Hospital Management Information System</p>
            <div className="mt-4 p-4 border-2 border-black">
              <h2 className="text-2xl font-bold text-red-600">DISCHARGE GATE PASS</h2>
              <p className="text-lg font-semibold">Gate Pass No: {gatePass.gate_pass_number}</p>
            </div>
          </div>

          {/* Patient Information */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="space-y-4">
              <h3 className="text-xl font-semibold border-b-2 border-black pb-2">
                PATIENT INFORMATION
              </h3>
              <div className="space-y-2">
                <div className="flex">
                  <span className="font-semibold w-32">Name:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {gatePass.patient_name}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Patient ID:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {gatePass.visit.patients.patients_id}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Visit ID:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {gatePass.visit.visit_id}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Age/Gender:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {gatePass.visit.patients.age} years / {gatePass.visit.patients.gender}
                  </span>
                </div>
                {gatePass.visit.patients.insurance_person_no && (
                  <div className="flex">
                    <span className="font-semibold w-32">Insurance No:</span>
                    <span className="flex-1 border-b border-dotted border-black">
                      {gatePass.visit.patients.insurance_person_no}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold border-b-2 border-black pb-2">
                DISCHARGE DETAILS
              </h3>
              <div className="space-y-2">
                <div className="flex">
                  <span className="font-semibold w-32">Discharge Date:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {format(new Date(gatePass.discharge_date), 'dd/MM/yyyy')}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Discharge Time:</span>
                  <span className="flex-1 border-b border-dotted border-black">
                    {format(new Date(gatePass.discharge_date), 'HH:mm')}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Mode:</span>
                  <span className="flex-1 border-b border-dotted border-black uppercase">
                    {gatePass.discharge_mode.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex">
                  <span className="font-semibold w-32">Billing:</span>
                  <span className="flex-1">
                    <Badge 
                      variant={gatePass.bill_paid ? "default" : "destructive"}
                      className="text-lg px-4 py-1"
                    >
                      {gatePass.bill_paid ? 'CLEARED' : 'PENDING'}
                    </Badge>
                  </span>
                </div>
                {gatePass.payment_amount > 0 && (
                  <div className="flex">
                    <span className="font-semibold w-32">Amount:</span>
                    <span className="flex-1 border-b border-dotted border-black">
                      ₹ {gatePass.payment_amount.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Clearance Status */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold border-b-2 border-black pb-2 mb-4">
              CLEARANCE STATUS
            </h3>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Medical Clearance', icon: FileCheck, status: true },
                { label: 'Billing Clearance', icon: CreditCard, status: gatePass.bill_paid },
                { label: 'Administrative Clearance', icon: Shield, status: true },
              ].map((item, index) => (
                <div key={index} className="flex items-center justify-center p-4 border-2 border-black">
                  <item.icon className="h-6 w-6 mr-2" />
                  <div className="text-center">
                    <p className="font-semibold">{item.label}</p>
                    <Badge variant={item.status ? "default" : "destructive"}>
                      {item.status ? 'CLEARED' : 'PENDING'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="text-center">
              <div className="border-b-2 border-black h-16 mb-2"></div>
              <p className="font-semibold">RECEPTIONIST SIGNATURE</p>
              <p className="text-sm text-gray-600">
                Name: {gatePass.receptionist_signature || '___________________'}
              </p>
              <p className="text-sm text-gray-600">Date & Time: ___________</p>
            </div>
            <div className="text-center">
              <div className="border-b-2 border-black h-16 mb-2"></div>
              <p className="font-semibold">BILLING OFFICER SIGNATURE</p>
              <p className="text-sm text-gray-600">
                Name: {gatePass.billing_officer_signature || '___________________'}
              </p>
              <p className="text-sm text-gray-600">Date & Time: ___________</p>
            </div>
          </div>

          {/* Security Section */}
          <div className="border-4 border-red-600 p-6 mb-6">
            <h3 className="text-xl font-bold text-red-600 text-center mb-4">
              FOR SECURITY USE ONLY
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="font-semibold">Gate Pass Verified:</p>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center">
                    <input type="checkbox" className="mr-2" />
                    Yes
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" className="mr-2" />
                    No
                  </label>
                </div>
              </div>
              <div>
                <p className="font-semibold">Exit Time:</p>
                <div className="border-b border-black mt-2 h-8"></div>
              </div>
            </div>
            <div className="mt-4">
              <p className="font-semibold">Security Officer Name & Signature:</p>
              <div className="border-b border-black mt-2 h-8"></div>
            </div>
          </div>

          {/* Barcode */}
          <div className="text-center">
            <div className="border-2 border-black p-4 inline-block">
              <div className="font-mono text-sm">{gatePass.barcode_data}</div>
              <div className="text-xs text-gray-600 mt-1">Scan for verification</div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center mt-8 text-sm text-gray-600">
            <p>Generated on: {format(new Date(gatePass.created_at), 'dd/MM/yyyy HH:mm')}</p>
            <p className="font-semibold text-red-600">
              ⚠️ This gate pass is valid only for the date of discharge mentioned above
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Print Styles */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          
          body {
            margin: 0;
            padding: 0;
          }
          
          .break-page {
            page-break-after: always;
          }
          
          @page {
            margin: 0.5in;
            size: A4;
          }
        }
      `}</style>
    </div>
  );
};