
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Search, Plus, X, Activity, Pill, FileText, AlertTriangle } from 'lucide-react';

interface PatientDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  patient: {
    id: string;
    name: string;
  };
}

export const PatientDetailsModal: React.FC<PatientDetailsModalProps> = ({
  isOpen,
  onClose,
  patient
}) => {
  // Debug: Log what props the modal receives
  console.log('🎭 PatientDetailsModal Received:', {
    isOpen,
    patient,
    patientId: patient?.id,
    patientName: patient?.name,
    patientIdExists: !!patient?.id
  });

  const { data: patientDetails, isLoading } = useQuery({
    queryKey: ['patient-details', patient.id],
    queryFn: async () => {
      console.log('🔍 Fetching patient details for ID:', patient.id);

      // First get patient basic info
      const { data: patientData, error: patientError } = await supabase
        .from('patients')
        .select('*, patients_id')
        .eq('id', patient.id)
        .single();

      if (patientError) {
        console.error('❌ Error fetching patient:', patientError);
        throw patientError;
      }

      console.log('✅ Patient data fetched:', {
        name: patientData.name,
        patients_id: patientData.patients_id,
        id: patientData.id
      });

      // Get visits for this patient
      const { data: visits, error: visitsError } = await supabase
        .from('visits')
        .select(`
          id,
          visit_id,
          visit_date,
          relationship_manager_id,
          admission_date,
          surgery_date,
          discharge_date,
          visit_diagnoses(
            id,
            is_primary,
            diagnoses(id, name)
          ),
          visit_surgeries(
            cghs_surgery(id, name, category)
          ),
          visit_complications(
            complications(id, name)
          ),
          visit_labs(
            id,
            lab(id, name, private),
            status,
            ordered_date,
            result_value
          ),
          visit_radiology(
            id,
            radiology(id, name, private),
            status,
            ordered_date,
            result_value
          ),
          visit_medications(
            id,
            medications(id, name, cost),
            prescribed_date,
            dosage,
            frequency,
            duration
          ),
          visit_esic_surgeons(
            esic_surgeons!surgeon_id(id, name, specialty, department)
          ),
          visit_referees(
            referees!referee_id(id, name, specialty, institution)
          ),
          visit_hope_surgeons(
            hope_surgeons!surgeon_id(id, name, specialty, department)
          ),
          visit_hope_consultants(
            hope_consultants!consultant_id(id, name, specialty, department)
          )
        `)
        .eq('patient_id', patientData.id)
        .order('created_at', { ascending: false });

      if (visitsError) {
        console.error('Error fetching visits:', visitsError);
        throw visitsError;
      }

      // RM may live on the patient record OR on a visit. When the patient
      // record has none, fall back to the earliest visit's RM code so the
      // details view matches the dashboard (only "Direct" when truly none).
      let relationshipManager = patientData.relationship_manager || null;
      if (!relationshipManager) {
        const earliestWithRm = [...(visits || [])]
          .filter((v: any) => v.relationship_manager_id)
          .sort((a: any, b: any) =>
            (a.visit_date || '').localeCompare(b.visit_date || '')
          )[0];
        if (earliestWithRm) {
          const { data: rm } = await supabase
            .from('relationship_managers')
            .select('code, name')
            .eq('id', (earliestWithRm as any).relationship_manager_id)
            .maybeSingle();
          if (rm) relationshipManager = rm.code || rm.name || null;
        }
      }

      return {
        ...patientData,
        relationship_manager: relationshipManager,
        visits: visits || []
      };
    },
    enabled: isOpen && !!patient.id
  });

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-GB');
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
          <div className="text-center py-8">Loading patient details...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-blue-600">
            Patient Details - {patientDetails?.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Patient UID: {patientDetails?.patients_id || 'Not assigned'}
          </p>
        </DialogHeader>

        {patientDetails && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Diagnosis Section */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-blue-700">Diagnosis</h3>
                  <Button size="sm" variant="outline" className="ml-auto">
                    <Plus className="h-4 w-4 mr-1" />
                    Add New
                  </Button>
                </div>
                <p className="text-sm text-gray-600 mb-3">Search and add diagnosis, view related complications</p>
                
                <div className="relative mb-3">
                  <Input 
                    placeholder="Search diagnoses by name, ICD code, or category..."
                    className="pr-10"
                  />
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                </div>

                <div className="space-y-3">
                  {/* Primary Diagnosis */}
                  <div>
                    <h4 className="font-medium text-sm mb-2">Primary Diagnosis</h4>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        // Debug: Log the data structure

                        const primaryDiagnosis = patientDetails?.visits?.flatMap(visit =>
                          visit.visit_diagnoses?.filter(vd => vd.is_primary)
                        ).find(Boolean);


                        return primaryDiagnosis ? (
                          <Badge className="bg-blue-600 text-white">
                            {primaryDiagnosis.diagnoses?.name}
                          </Badge>
                        ) : (
                          <span className="text-sm text-gray-500">No diagnosis</span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* All Diagnoses */}
                  <div>
                    <h4 className="font-medium text-sm mb-2">All Diagnoses</h4>
                    <div className="flex flex-wrap gap-2">
                      {patientDetails?.visits?.flatMap(visit =>
                        visit.visit_diagnoses?.map(vd => (
                          <Badge key={vd.diagnoses?.id} className={`${vd.is_primary ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'} hover:bg-blue-200`}>
                            {vd.diagnoses?.name}
                            {vd.is_primary && <span className="ml-1 text-xs">(Primary)</span>}
                            <X className="h-3 w-3 ml-1 cursor-pointer" />
                          </Badge>
                        )) || []
                      )}
                      {(!patientDetails?.visits?.some(v => v.visit_diagnoses?.length > 0)) && (
                        <span className="text-sm text-gray-500">No diagnoses recorded</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* CGHS Surgery Section */}
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-5 w-5 text-green-600" />
                  <h3 className="text-lg font-semibold text-green-700">CGHS SURGERY</h3>
                </div>
                <p className="text-sm text-gray-600 mb-3">Select CGHS surgeries for the patient</p>
                
                <div className="relative mb-3">
                  <Input 
                    placeholder="Search surgeries by name or code..."
                    className="pr-10"
                  />
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Selected Surgeries</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientDetails?.visits?.flatMap(visit =>
                      visit.visit_surgeries?.map(vs => (
                        <Badge key={vs.cghs_surgery?.id} className="bg-green-100 text-green-800">
                          {vs.cghs_surgery?.name}
                        </Badge>
                      )) || []
                    )}
                    {(!patientDetails?.visits?.some(v => v.visit_surgeries?.length > 0)) && (
                      <span className="text-sm text-gray-500">No surgeries recorded</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Complications Section */}
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
                  <h3 className="text-lg font-semibold text-orange-700">Complications mapped to diagnosis</h3>
                </div>
                <p className="text-sm text-gray-600 mb-3">Monitor and manage potential complications</p>
                
                <div className="relative mb-3">
                  <Input 
                    placeholder="Search complications..."
                    className="pr-10"
                  />
                  <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Complications:</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientDetails?.visits?.flatMap(visit =>
                      visit.visit_complications?.map(vc => (
                        <Badge key={vc.complications?.id} variant="outline" className="bg-orange-100 text-orange-800">
                          {vc.complications?.name}
                        </Badge>
                      )) || []
                    )}
                    {(!patientDetails?.visits?.some(v => v.visit_complications?.length > 0)) && (
                      <p className="text-sm text-gray-500">No complications recorded</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Investigations Section */}
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-5 w-5 text-purple-600" />
                  <h3 className="text-lg font-semibold text-purple-700">Investigations:</h3>
                </div>
                
                <div className="flex gap-2 mb-3">
                  <Badge className="bg-purple-100 text-purple-800">
                    CBC
                  </Badge>
                  <Input placeholder="Enter details..." className="flex-1" />
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  <Badge variant="outline">ESR</Badge>
                  <Badge variant="outline">CRP</Badge>
                  <Badge variant="outline">X-Ray</Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-sm">Lab Tests:</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientDetails?.visits?.flatMap(visit =>
                      visit.visit_labs?.map(vl => (
                        <Badge key={vl.id} variant="outline" className="bg-purple-100 text-purple-800">
                          {vl.lab?.name} - ₹{(vl.lab?.private && vl.lab.private > 0) ? vl.lab.private : 100}
                        </Badge>
                      )) || []
                    )}
                    {(!patientDetails?.visits?.some(v => v.visit_labs?.length > 0)) && (
                      <p className="text-sm text-gray-600">None recorded</p>
                    )}
                  </div>

                  <h4 className="font-medium text-sm">Radiology:</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientDetails?.visits?.flatMap(visit =>
                      visit.visit_radiology?.map(vr => (
                        <Badge key={vr.id} variant="outline" className="bg-purple-100 text-purple-800">
                          {vr.radiology?.name} - ₹{(vr.radiology?.private && vr.radiology.private > 0) ? vr.radiology.private : 100}
                        </Badge>
                      )) || []
                    )}
                    {(!patientDetails?.visits?.some(v => v.visit_radiology?.length > 0)) && (
                      <p className="text-sm text-gray-600">None recorded</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Medications Section */}
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center gap-2 mb-3">
                  <Pill className="h-5 w-5 text-green-600" />
                  <h3 className="text-lg font-semibold text-green-700">Medications:</h3>
                </div>
                
                <div className="space-y-3">
                  <h4 className="font-medium text-sm">Prescribed Medications:</h4>
                  <div className="flex flex-wrap gap-2">
                    {patientDetails?.visits?.flatMap(visit =>
                      visit.visit_medications?.map(vm => (
                        <Badge key={vm.id} className="bg-green-100 text-green-800">
                          {vm.medications?.name} - ₹{vm.medications?.cost}
                        </Badge>
                      )) || []
                    )}
                    {(!patientDetails?.visits?.some(v => v.visit_medications?.length > 0)) && (
                      <p className="text-sm text-gray-600">None prescribed</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Basic Information Summary */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-700 mb-3">Basic Information</h3>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Relationship Manager:</span>
                    <span className="text-sm">{patientDetails?.relationship_manager || 'Direct'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Admission Date:</span>
                    <span className="text-sm">{formatDate(patientDetails?.visits?.[0]?.admission_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Surgery Date:</span>
                    <span className="text-sm">{formatDate(patientDetails?.visits?.[0]?.surgery_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Discharge Date:</span>
                    <span className="text-sm">{formatDate(patientDetails?.visits?.[0]?.discharge_date)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Surgery:</span>
                    <span className="text-sm">{patientDetails?.visits?.[0]?.visit_surgeries?.[0]?.cghs_surgery?.name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">ESIC Surgeon for follow up:</span>
                    <span className="text-sm">{patientDetails?.visits?.[0]?.visit_esic_surgeons?.[0]?.esic_surgeons?.name || 'Not assigned'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Referee:</span>
                    <span className="text-sm">{patientDetails?.visits?.[0]?.visit_referees?.[0]?.referees?.name || 'Not assigned'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Hope Surgeon:</span>
                    <span className="text-sm">{patientDetails?.visits?.[0]?.visit_hope_surgeons?.[0]?.hope_surgeons?.name || 'Not assigned'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Hope Consultants for IPD visits:</span>
                    <span className="text-sm">{patientDetails?.visits?.[0]?.visit_hope_consultants?.[0]?.hope_consultants?.name || 'Not assigned'}</span>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-lg font-semibold text-blue-700 mb-3">Contact Information</h3>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Phone:</span>
                    <span className="text-sm">{patientDetails?.phone || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Emergency Contact:</span>
                    <span className="text-sm">{patientDetails?.emergency_contact_name || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm font-medium text-gray-600">Emergency Mobile:</span>
                    <span className="text-sm">{patientDetails?.emergency_contact_mobile || '-'}</span>
                  </div>
                  {patientDetails?.second_emergency_contact_name && (
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600">Second Emergency Contact:</span>
                      <span className="text-sm">{patientDetails?.second_emergency_contact_name}</span>
                    </div>
                  )}
                  {patientDetails?.second_emergency_contact_mobile && (
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-600">Second Emergency Mobile:</span>
                      <span className="text-sm">{patientDetails?.second_emergency_contact_mobile}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
