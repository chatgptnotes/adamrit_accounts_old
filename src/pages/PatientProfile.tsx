import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import PatientClinicalSidebar from '@/components/PatientClinicalSidebar';
import PatientHeader from '@/components/patient/PatientHeader';
import PatientInfoCards from '@/components/patient/PatientInfoCards';
import DischargeInfo from '@/components/patient/DischargeInfo';
import PatientTabs from '@/components/patient/PatientTabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Search } from 'lucide-react';

type PatientSearchRow = {
  id: string;
  name: string | null;
  patients_id: string | null;
  phone: string | null;
  age: number | null;
  gender: string | null;
  created_at: string | null;
};

const PatientProfile = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const patientId = searchParams.get('patient');
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [activeSection, setActiveSection] = useState('clinical-mgmt');

  const { data: patient, isLoading: patientLoading } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      if (!patientId) return null;
      
      
      // Use select('*') to avoid FK join failures when diagnosis_id is null
      const { data, error } = await supabase
        .from('patients')
        .select('*')
        .eq('id', patientId)
        .single();

      if (error) {
        console.error('Error fetching patient:', error);
        throw error;
      }
      
      
      return data;
    },
    enabled: !!patientId
  });

  const { data: searchResults = [], isLoading: searchLoading } = useQuery({
    queryKey: ['patient-profile-search', patientSearchTerm],
    queryFn: async () => {
      const term = patientSearchTerm.trim();
      if (term.length < 2) return [];

      const safe = term.replace(/[%,]/g, '');
      const { data, error } = await supabase
        .from('patients')
        .select('id, name, patients_id, phone, age, gender, created_at')
        .or(`name.ilike.%${safe}%,patients_id.ilike.%${safe}%,phone.ilike.%${safe}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error searching patients:', error);
        throw error;
      }

      return (data || []) as PatientSearchRow[];
    },
    enabled: !patientId,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patient-visits', patientId],
    queryFn: async () => {
      if (!patientId) return [];
      
      const { data, error } = await supabase
        .from('visits')
        .select('*')
        .eq('patient_id', patientId)
        .order('visit_date', { ascending: false });
      
      if (error) {
        console.error('Error fetching visits:', error);
        throw error;
      }
      
      return data || [];
    },
    enabled: !!patientId
  });

  // Function removed - not needed anymore

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not provided';
    return format(new Date(dateString), 'dd/MM/yyyy');
  };

  const calculateAge = (admissionDate: string) => {
    if (!admissionDate) return 'Unknown';
    const today = new Date();
    const admission = new Date(admissionDate);
    const ageInYears = Math.floor((today.getTime() - admission.getTime()) / (1000 * 60 * 60 * 24 * 365));
    return `${ageInYears} years`;
  };

  if (patientLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading patient profile...</div>
        </div>
      </div>
    );
  }

  if (!patientId) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Search patient profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Input
                  value={patientSearchTerm}
                  onChange={(e) => setPatientSearchTerm(e.target.value)}
                  placeholder="Search by name, patient ID, or phone"
                />
                <p className="text-sm text-muted-foreground">
                  Open a profile by selecting a patient below. Direct links should use <code>?patient=&lt;id&gt;</code>.
                </p>
              </div>

              {searchLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Searching...</div>
              ) : searchResults.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {patientSearchTerm.trim().length < 2
                    ? 'Type at least 2 characters to search.'
                    : 'No patients found.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent"
                      onClick={() => {
                        const nextParams = new URLSearchParams(searchParams);
                        nextParams.set('patient', p.id);
                        setSearchParams(nextParams, { replace: true });
                      }}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{p.name || 'Unnamed patient'}</div>
                          <div className="text-sm text-muted-foreground">
                            {p.patients_id || 'No patient ID'}
                            {p.phone ? ` - ${p.phone}` : ''}
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {p.gender || '-'}
                          {p.age != null ? ` - ${p.age}y` : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="text-center">Patient not found</div>
          <div className="text-center">
            <Button
              variant="outline"
              onClick={() => {
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('patient');
                setSearchParams(nextParams, { replace: true });
                setPatientSearchTerm('');
              }}
            >
              Search another patient
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-6 space-y-6 print-hidden">
        {/* Header */}
        <PatientHeader 
          patient={patient} 
          patientId={patientId} 
          calculateAge={calculateAge}
          visits={visits}
        />

        {/* Patient Info Cards */}
        <PatientInfoCards 
          patient={patient} 
          formatDate={formatDate} 
          visits={visits} 
        />

        <DischargeInfo patient={patient} formatDate={formatDate} />
      </div>

      {/* Main Content Area with Sidebar and Tabs - Full Height Below Patient Details */}
      <div className="flex h-screen print-hidden">
        {/* Clinical Sidebar - Fixed Position */}
        <div className="flex-shrink-0 print-hidden">
          <PatientClinicalSidebar
            onSectionChange={setActiveSection}
            activeSection={activeSection}
          />
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 p-6">
          <PatientTabs patient={patient} visitId={visits.length > 0 ? visits[0].visit_id : undefined} />
        </div>
      </div>
    </div>
  );
};

export default PatientProfile;
