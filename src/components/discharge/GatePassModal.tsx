import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Building2, Shield, FileCheck, CreditCard, Printer } from 'lucide-react';

interface GatePassModalProps {
  visitId: string;
  isOpen: boolean;
  onClose: () => void;
  onDischarge?: () => void; // Optional discharge function
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

export const GatePassModal: React.FC<GatePassModalProps> = ({ visitId, isOpen, onClose, onDischarge }) => {
  const [hasPrinted, setHasPrinted] = React.useState(false);
  
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

      if (error) {
        console.error('Gate pass query error:', error);
        throw error;
      }
      return data as GatePassData;
    },
    enabled: isOpen, // Only fetch when modal is open
    retry: 3, // Retry up to 3 times in case of timing issues
    retryDelay: 1000, // Wait 1 second between retries
  });

  const handlePrint = () => {
    console.log('🖨️ Print Gate Pass clicked');
    setHasPrinted(true);
    
    const printContent = document.getElementById('gate-pass-content');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Gate Pass - ${gatePass?.gate_pass_number}</title>
              <style>
                body { 
                  margin: 0; 
                  padding: 15px; 
                  font-family: Arial, sans-serif; 
                  background: white;
                  font-size: 12px;
                }
                .gate-pass-card {
                  max-width: 750px;
                  margin: 0 auto;
                  border: 2px solid black;
                  padding: 20px;
                }
                .header { text-align: center; margin-bottom: 20px; }
                .title { font-size: 24px; font-weight: bold; margin-bottom: 4px; }
                .subtitle { color: #666; margin-bottom: 12px; font-size: 11px; }
                .gate-pass-title { 
                  border: 2px solid black; 
                  padding: 12px; 
                  margin-top: 12px;
                }
                .gate-pass-number { 
                  font-size: 18px; 
                  font-weight: bold; 
                  color: #dc2626; 
                  margin-bottom: 4px;
                }
                .section-title { 
                  font-size: 14px; 
                  font-weight: bold; 
                  border-bottom: 2px solid black; 
                  padding-bottom: 4px; 
                  margin-bottom: 10px; 
                }
                .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 20px; }
                .info-item { display: flex; margin-bottom: 6px; font-size: 11px; }
                .info-label { font-weight: bold; width: 100px; }
                .info-value { flex: 1; border-bottom: 1px dotted black; }
                .clearance-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px; }
                .clearance-item { 
                  border: 2px solid black; 
                  padding: 8px; 
                  text-align: center; 
                  font-size: 10px;
                }
                .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; margin-bottom: 20px; }
                .signature-box { text-align: center; font-size: 10px; }
                .signature-line { border-bottom: 2px solid black; height: 40px; margin-bottom: 4px; }
                .security-section { 
                  border: 3px solid #dc2626; 
                  padding: 12px; 
                  margin-bottom: 15px; 
                }
                .security-title { 
                  font-size: 14px; 
                  font-weight: bold; 
                  color: #dc2626; 
                  text-align: center; 
                  margin-bottom: 8px; 
                }
                .security-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 10px; }
                .checkbox-group { display: flex; gap: 10px; margin-top: 4px; }
                .barcode-section { text-align: center; margin-bottom: 10px; }
                .barcode-box { 
                  border: 2px solid black; 
                  padding: 8px; 
                  display: inline-block; 
                  font-family: monospace; 
                  font-size: 10px;
                }
                .footer { text-align: center; margin-top: 15px; color: #666; font-size: 10px; }
                .warning { font-weight: bold; color: #dc2626; }
                .badge-paid { background: #22c55e; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; }
                .badge-unpaid { background: #dc2626; color: white; padding: 2px 8px; border-radius: 3px; font-size: 10px; }
                .badge-cleared { background: #22c55e; color: white; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
                .badge-pending { background: #dc2626; color: white; padding: 2px 6px; border-radius: 3px; font-size: 9px; }
                @page { margin: 0.4in; size: A4; }
              </style>
            </head>
            <body>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
        printWindow.close();
      }
    }
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">Loading gate pass...</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || (!isLoading && !gatePass)) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Error Loading Gate Pass</DialogTitle>
          </DialogHeader>
          <div className="p-8 text-center">
            <p className="text-red-600 mb-4">
              {error ? `Error: ${error.message}` : 'Gate pass not found for this visit.'}
            </p>
            <p className="text-sm text-gray-600">
              Visit ID: {visitId}
            </p>
            <Button onClick={onClose} className="mt-4">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>Gate Pass #{gatePass.gate_pass_number}</span>
            <Button onClick={handlePrint} className="ml-4">
              <Printer className="mr-2 h-4 w-4" />
              Print Gate Pass
            </Button>
          </DialogTitle>
        </DialogHeader>

        <div id="gate-pass-content">
          <div className="gate-pass-card bg-white">
            {/* Header */}
            <div className="header">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Building2 className="h-6 w-6" />
                <h1 className="title">HOPE HOSPITAL</h1>
              </div>
              <p className="subtitle">Hospital Management Information System</p>
              <div className="gate-pass-title">
                <h2 className="gate-pass-number">DISCHARGE GATE PASS</h2>
                <p className="text-lg font-semibold">Gate Pass No: {gatePass.gate_pass_number}</p>
              </div>
            </div>

            {/* Patient Information */}
            <div className="info-grid">
              <div>
                <h3 className="section-title">PATIENT INFORMATION</h3>
                <div className="space-y-2">
                  <div className="info-item">
                    <span className="info-label">Name:</span>
                    <span className="info-value">{gatePass.patient_name}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Patient ID:</span>
                    <span className="info-value">{gatePass.visit.patients.patients_id}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Visit ID:</span>
                    <span className="info-value">{gatePass.visit.visit_id}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Age/Gender:</span>
                    <span className="info-value">
                      {gatePass.visit.patients.age} years / {gatePass.visit.patients.gender}
                    </span>
                  </div>
                  {gatePass.visit.patients.insurance_person_no && (
                    <div className="info-item">
                      <span className="info-label">Insurance No:</span>
                      <span className="info-value">{gatePass.visit.patients.insurance_person_no}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="section-title">DISCHARGE DETAILS</h3>
                <div className="space-y-2">
                  <div className="info-item">
                    <span className="info-label">Discharge Date:</span>
                    <span className="info-value">
                      {format(new Date(gatePass.discharge_date), 'dd/MM/yyyy')}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Discharge Time:</span>
                    <span className="info-value">
                      {format(new Date(gatePass.discharge_date), 'HH:mm')}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Mode:</span>
                    <span className="info-value">
                      {gatePass.discharge_mode.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Billing:</span>
                    <span className={gatePass.bill_paid ? 'badge-paid' : 'badge-unpaid'}>
                      {gatePass.bill_paid ? 'CLEARED' : 'PENDING'}
                    </span>
                  </div>
                  {gatePass.payment_amount > 0 && (
                    <div className="info-item">
                      <span className="info-label">Amount:</span>
                      <span className="info-value">₹ {gatePass.payment_amount.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Clearance Status */}
            <div className="mb-8">
              <h3 className="section-title">CLEARANCE STATUS</h3>
              <div className="clearance-grid">
                {[
                  { label: 'Medical Clearance', icon: FileCheck, status: true },
                  { label: 'Billing Clearance', icon: CreditCard, status: gatePass.bill_paid },
                  { label: 'Administrative Clearance', icon: Shield, status: true },
                ].map((item, index) => (
                  <div key={index} className="clearance-item">
                    <div className="text-center">
                      <p className="font-semibold">{item.label}</p>
                      <span className={item.status ? 'badge-cleared' : 'badge-pending'}>
                        {item.status ? 'CLEARED' : 'PENDING'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Signatures */}
            <div className="signature-grid">
              <div className="signature-box">
                <div className="signature-line"></div>
                <p className="font-semibold">RECEPTIONIST SIGNATURE</p>
                <p className="text-sm text-gray-600">
                  Name: {gatePass.receptionist_signature || '___________________'}
                </p>
                <p className="text-sm text-gray-600">Date & Time: ___________</p>
              </div>
              <div className="signature-box">
                <div className="signature-line"></div>
                <p className="font-semibold">BILLING OFFICER SIGNATURE</p>
                <p className="text-sm text-gray-600">
                  Name: {gatePass.billing_officer_signature || '___________________'}
                </p>
                <p className="text-sm text-gray-600">Date & Time: ___________</p>
              </div>
            </div>

            {/* Security Section */}
            <div className="security-section">
              <h3 className="security-title">FOR SECURITY USE ONLY</h3>
              <div className="security-grid">
                <div>
                  <p className="font-semibold">Gate Pass Verified:</p>
                  <div className="checkbox-group">
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
            <div className="barcode-section">
              <div className="barcode-box">
                <div className="font-mono text-sm">{gatePass.barcode_data}</div>
                <div className="text-xs text-gray-600 mt-1">Scan for verification</div>
              </div>
            </div>

            {/* Footer */}
            <div className="footer">
              <p>Generated on: {format(new Date(gatePass.created_at), 'dd/MM/yyyy HH:mm')}</p>
              <p className="warning">
                ⚠️ This gate pass is valid only for the date of discharge mentioned above
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-center gap-4 mt-6 pt-4 border-t">
          <Button 
            onClick={handlePrint} 
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 text-lg"
          >
            <Printer className="mr-2 h-5 w-5" />
            🖨️ Print Gate Pass
          </Button>
          <Button 
            onClick={() => {
              console.log('🚪 Close button clicked, hasPrinted:', hasPrinted);
              if (hasPrinted && onDischarge) {
                console.log('🏥 Discharging patient...');
                onDischarge();
              }
              onClose();
            }} 
            variant="outline" 
            className="px-6 py-3 text-lg"
          >
            {hasPrinted ? 'Discharge Patient' : 'Close'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};