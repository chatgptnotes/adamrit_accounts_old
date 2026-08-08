import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Search, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LabsSection } from '@/components/DoctorView/LabsSection';
import { RadiologySection } from '@/components/DoctorView/RadiologySection';
import { MedicationsSection } from '@/components/DoctorView/MedicationsSection';
import { PrintRxSection } from '@/components/DoctorView/PrintRxSection';

const DoctorView = () => {
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patients')
        .select('id, name, date_of_birth, age, phone, gender')
        .order('name')
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: selectedPatient } = useQuery({
    queryKey: ['patient-details', selectedPatientId],
    queryFn: async () => {
      if (!selectedPatientId) return null;
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('id', selectedPatientId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedPatientId,
  });

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectPatient = (patient) => {
    setSelectedPatientId(patient.id);
    setSearchTerm('');
    setShowDropdown(false);
  };

  const calculateAge = (dob) => {
    if (!dob) return 'N/A';
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Stethoscope className="h-8 w-8 text-blue-600" />
            <h1 className="text-4xl font-bold text-primary">Doctor Unified View</h1>
          </div>
          <p className="text-lg text-muted-foreground">
            Complete patient information - Labs, Radiology, Medications & Prescriptions
          </p>
        </div>

        <Card className="mb-6 shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">Select Patient</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search patient by name..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                className="pl-10"
              />

              {showDropdown && (
                <div className="absolute z-50 w-full mt-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
                  {filteredPatients.length > 0 ? (
                    filteredPatients.map((patient) => (
                      <div
                        key={patient.id}
                        onClick={() => handleSelectPatient(patient)}
                        className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-b-0 transition-colors"
                      >
                        <div className="font-semibold text-gray-900">{patient.name}</div>
                        <div className="text-sm text-gray-600">
                          ID: {patient.id.slice(0, 8)}... | Age: {patient.age} | Phone: {patient.phone}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-4 text-center text-gray-500">No patients found</div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedPatient ? (
          <>
            <Card className="mb-6 shadow-lg bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-2xl text-gray-900">{selectedPatient.name}</CardTitle>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                      <div>
                        <span className="text-gray-600">Patient ID:</span>
                        <p className="font-semibold text-gray-900">{selectedPatient.patients_id}</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Age:</span>
                        <p className="font-semibold text-gray-900">
                          {calculateAge(selectedPatient.date_of_birth)} years
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Gender:</span>
                        <p className="font-semibold text-gray-900">{selectedPatient.gender || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Phone:</span>
                        <p className="font-semibold text-gray-900">{selectedPatient.phone}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className="bg-blue-600 text-white px-4 py-2">ACTIVE</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-green-700 border-green-300 hover:bg-green-50"
                      onClick={() => {
                        window.location.href =
                          '/home-collection?patient_name=' +
                          encodeURIComponent(selectedPatient.name) +
                          '&mobile=' +
                          encodeURIComponent(selectedPatient.phone || '');
                      }}
                    >
                      <Home className="w-3.5 h-3.5" />
                      Book Home Collection
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            <Card className="shadow-lg">
              <CardContent className="pt-6">
                <Tabs defaultValue="labs" className="w-full">
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 mb-6">
                    <TabsTrigger value="labs" className="flex items-center gap-2">
                      <span>📊</span>
                      <span className="hidden sm:inline">Labs</span>
                    </TabsTrigger>
                    <TabsTrigger value="radiology" className="flex items-center gap-2">
                      <span>📷</span>
                      <span className="hidden sm:inline">Radiology</span>
                    </TabsTrigger>
                    <TabsTrigger value="medications" className="flex items-center gap-2">
                      <span>💊</span>
                      <span className="hidden sm:inline">Medications</span>
                    </TabsTrigger>
                    <TabsTrigger value="print-rx" className="flex items-center gap-2">
                      <span>🖨️</span>
                      <span className="hidden sm:inline">Rx</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="labs" className="mt-6">
                    <LabsSection patientId={selectedPatient.id} />
                  </TabsContent>

                  <TabsContent value="radiology" className="mt-6">
                    <RadiologySection patientId={selectedPatient.id} />
                  </TabsContent>

                  <TabsContent value="medications" className="mt-6">
                    <MedicationsSection patientId={selectedPatient.id} />
                  </TabsContent>

                  <TabsContent value="print-rx" className="mt-6">
                    <PrintRxSection patientId={selectedPatient.id} patient={selectedPatient} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </>
        ) : (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">
              👆 Select a patient to view their complete medical information
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorView;
