
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, FileText } from 'lucide-react';
import { format } from 'date-fns';
import TreatmentSheetForm from '../components/pharmacy/TreatmentSheetForm';

const TreatmentSheet = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const patientId = searchParams.get('patient');
  const { hospitalConfig } = useAuth();

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', patientId, hospitalConfig.name],
    queryFn: async () => {
      if (!patientId) return null;
      
      const { data, error } = await supabase
        .from('patients')
        .select(`
          *,
          diagnoses(name)
        `)
        .eq('id', patientId)
        .eq('hospital_name', hospitalConfig.name)
        .maybeSingle();
      
      if (error) {
        console.error('Error fetching patient:', error);
        throw error;
      }
      
      return data;
    },
    enabled: !!patientId
  });

  const handleBack = () => {
    navigate(-1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">Loading treatment sheet...</div>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <TreatmentSheetForm onClose={() => {}} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              onClick={handleBack}
              className="h-10 w-10 p-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6" />
              <h1 className="text-3xl font-bold">Treatment Sheet</h1>
            </div>
          </div>
        </div>

        {/* Treatment Sheet Content */}
        <Card>
          <CardHeader className="text-center border-b">
            <div className="flex justify-between items-center mb-4">
              <div className="w-20 h-20 bg-gray-200 flex items-center justify-center text-sm">
                NABH Logo
              </div>
              <div className="flex-1 text-center">
                <h1 className="text-2xl font-bold">HOPE HOSPITAL</h1>
                <p className="text-sm text-muted-foreground">Treatment Sheet</p>
              </div>
              <div className="w-20 h-20 bg-gray-200 flex items-center justify-center text-sm">
                Hope Logo
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-6">
            {/* Patient Information */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <h3 className="font-semibold mb-2">Patient Information</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">Name:</span> {patient.name}</p>
                  <p><span className="font-medium">Patient ID:</span> {patient.patients_id || 'Not assigned'}</p>
                  <p><span className="font-medium">Age:</span> {patient.age} years</p>
                  <p><span className="font-medium">Gender:</span> {patient.gender}</p>
                  <p><span className="font-medium">Phone:</span> {patient.phone}</p>
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">Admission Details</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">Admission Date:</span> {patient.admission_date ? format(new Date(patient.admission_date), 'dd/MM/yyyy') : 'Not provided'}</p>
                  <p><span className="font-medium">Ward:</span> {patient.ward || 'Not assigned'}</p>
                  <p><span className="font-medium">Diagnosis:</span> {patient.diagnoses?.name || patient.primary_diagnosis}</p>
                  <p><span className="font-medium">Consultant:</span> {patient.consultant || 'Not assigned'}</p>
                </div>
              </div>
            </div>

            {/* Treatment Schedule */}
            <div className="mb-6">
              <h3 className="font-semibold mb-4">Treatment Schedule</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-3 py-2 text-left">Date</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Time</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Treatment/Medication</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Dosage</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Route</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Column 1</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Column 2</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Given By</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Signature</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 15 }, (_, index) => (
                      <tr key={index}>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Vital Signs */}
            <div className="mb-6">
              <h3 className="font-semibold mb-4">Vital Signs Record</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-gray-300">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-3 py-2 text-left">Date</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Time</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Temperature</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Blood Pressure</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Pulse</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Respiration</th>
                      <th className="border border-gray-300 px-3 py-2 text-left">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: 10 }, (_, index) => (
                      <tr key={index}>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                        <td className="border border-gray-300 px-3 py-4"></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes Section */}
            <div className="mb-6">
              <h3 className="font-semibold mb-4">Doctor's Notes</h3>
              <div className="border border-gray-300 min-h-32 p-3">
                {/* Empty space for handwritten notes */}
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-3 gap-6 mt-8">
              <div className="text-center">
                <div className="border-t border-gray-400 pt-2">
                  <p className="text-sm">Doctor's Signature</p>
                </div>
              </div>
              <div className="text-center">
                <div className="border-t border-gray-400 pt-2">
                  <p className="text-sm">Nurse's Signature</p>
                </div>
              </div>
              <div className="text-center">
                <div className="border-t border-gray-400 pt-2">
                  <p className="text-sm">Date</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TreatmentSheet;
