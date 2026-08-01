import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/utils/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { PatientRegistrationForm } from '@/components/PatientRegistrationForm';
import { EditPatientRegistrationDialog } from '@/components/EditPatientRegistrationDialog';
import { VisitRegistrationForm } from '@/components/VisitRegistrationForm';
import { PatientDetailsModal } from '@/components/PatientDetailsModal';
import { PatientLookup } from '@/components/PatientLookup';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { NavigationTabs } from '@/components/dashboard/NavigationTabs';
import { ActionButtons } from '@/components/dashboard/ActionButtons';
import { PatientsTable } from '@/components/dashboard/PatientsTable';
import { PatientWorkflowVisual } from '@/components/dashboard/PatientWorkflowVisual';
import { DeletePatientDialog } from '@/components/dashboard/DeletePatientDialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

// Route-level error boundary to catch and display errors without crashing the whole app
class PatientDashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PatientDashboard Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background p-6">
          <div className="max-w-7xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <h2 className="text-xl font-bold text-red-600 mb-2">Patient Dashboard Error</h2>
              <p className="text-gray-600 mb-2">Something went wrong loading this page.</p>
              <p className="text-sm text-red-500 mb-4 font-mono">{this.state.error?.message}</p>
              <button
                onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const PatientDashboardInner = () => {
  const { hospitalConfig } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL-persisted state
  const searchTerm = searchParams.get('search') || '';
  const currentPage = parseInt(searchParams.get('page') || '1');
  const itemsPerPage = 10;

  // Helper to update URL params
  const updateParams = (updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'page' && value === '1')) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    setSearchParams(newParams, { replace: true });
  };

  // Setter functions
  const setSearchTerm = (value: string) => updateParams({ search: value, page: '1' });
  const setCurrentPage = (value: number) => updateParams({ page: value.toString() });

  // Non-persisted state
  const [isRegistrationFormOpen, setIsRegistrationFormOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isVisitFormOpen, setIsVisitFormOpen] = useState(false);
  const [isPatientDetailsOpen, setIsPatientDetailsOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isPatientLookupOpen, setIsPatientLookupOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; name: string; patients_id?: string } | null>(null);
  const [patientToEdit, setPatientToEdit] = useState<any>(null);
  const [patientToDelete, setPatientToDelete] = useState<{ id: string; name: string; patients_id?: string } | null>(null);

  const { data: patients = [], isLoading, error: queryError } = useQuery({
    queryKey: ['dashboard-patients', hospitalConfig?.name || 'default'],
    queryFn: async () => {
      try {
        let patientsData: any[] = [];
        try {
          patientsData = await fetchAllRows<any>(() => {
            let query = supabase
              .from('patients')
              .select('*, patients_id, corporate')
              .order('created_at', { ascending: false })
              .order('id');
            if (hospitalConfig?.name) {
              query = query.eq('hospital_name', hospitalConfig.name);
            }
            return query;
          });
        } catch (error) {
          console.error('Error fetching patients:', error);
          return [];
        }

        // The RM is recorded either on the patient record OR on a visit. Build
        // a patient -> RM-code map from visits so patients whose RM lives on a
        // visit show the real manager instead of "Direct".
        const [visitRms, { data: rms }] = await Promise.all([
          fetchAllRows<any>(() => supabase
            .from('visits')
            .select('patient_id, relationship_manager_id, visit_date, created_at')
            .not('relationship_manager_id', 'is', null)
            .order('id')),
          supabase.from('relationship_managers').select('id, code, name'),
        ]);

        const rmById = new Map(
          (rms || []).map((r: any) => [r.id, r.code || r.name])
        );

        // Earliest visit per patient wins (credit the original referral once).
        const rmByPatient = new Map<string, string>();
        const sortedVisits = [...(visitRms || [])].sort(
          (a: any, b: any) =>
            (a.visit_date || '').localeCompare(b.visit_date || '') ||
            (a.created_at || '').localeCompare(b.created_at || '')
        );
        for (const v of sortedVisits) {
          const code = rmById.get((v as any).relationship_manager_id);
          if (code && !rmByPatient.has((v as any).patient_id)) {
            rmByPatient.set((v as any).patient_id, code as string);
          }
        }

        return patientsData.map((p: any) => ({
          ...p,
          relationship_manager: p.relationship_manager || rmByPatient.get(p.id) || null,
        }));
      } catch (err) {
        console.error('PatientDashboard query failed:', err);
        return [];
      }
    },
    retry: 1,
  });

  const handleViewPatient = (patient: { id: string; name: string; patients_id?: string }) => {
    setSelectedPatient(patient);
    setIsPatientDetailsOpen(true);
  };

  const handleVisitRegistration = (patient: { id: string; name: string; patients_id?: string }) => {
    setSelectedPatient(patient);
    setIsVisitFormOpen(true);
  };

  const handleEditPatient = (patient: any) => {
    setPatientToEdit(patient);
    setIsEditDialogOpen(true);
  };

  const handleDeletePatient = (patient: { id: string; name: string; patients_id?: string }) => {
    setPatientToDelete(patient);
    setIsDeleteDialogOpen(true);
  };

  const handlePatientDeleted = () => {
    window.location.reload();
  };

  const handlePatientLookupSelect = (patient: any) => {
    // Use patients_id if available, otherwise fallback to id
    const patientForVisit = {
      id: patient.id,
      name: patient.name,
      patients_id: patient.patients_id
    };
    setSelectedPatient(patientForVisit);
    setIsVisitFormOpen(true);
  };

  const handleNewPatientFromLookup = () => {
    setIsRegistrationFormOpen(true);
  };

  const filteredPatients = patients.filter(patient => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    // Match name or patient ID (text), and phone by digits so a partial
    // number search still finds the patient.
    const termDigits = term.replace(/\D/g, '');
    const phoneDigits = (patient.phone || '').replace(/\D/g, '');
    return (
      patient.name?.toLowerCase().includes(term) ||
      patient.patients_id?.toLowerCase().includes(term) ||
      (!!termDigits && phoneDigits.includes(termDigits))
    );
  });

  // Pagination calculations
  const totalCount = filteredPatients.length;
  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedPatients = filteredPatients.slice(startIndex, endIndex);

  // Pagination helper functions
  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPreviousPage = () => setCurrentPage(Math.max(1, currentPage - 1));
  const goToNextPage = () => setCurrentPage(Math.min(totalPages, currentPage + 1));

  const getPageNumbers = () => {
    const pages: number[] = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }
    return pages;
  };

  // Reset page to 1 when search term changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">Loading patients...</div>
        </div>
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-lg font-bold text-red-600 mb-2">Error loading patients</h2>
            <p className="text-sm text-red-500 mb-4">{(queryError as Error)?.message || 'Unknown error'}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <DashboardHeader 
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />

        <NavigationTabs activeTab="Patients" />

        <ActionButtons 
          onNewPatientClick={() => setIsRegistrationFormOpen(true)}
          onPatientLookupClick={() => setIsPatientLookupOpen(true)}
        />

        <PatientWorkflowVisual />

        <PatientsTable
          patients={paginatedPatients}
          onViewPatient={handleViewPatient}
          onVisitRegistration={handleVisitRegistration}
          onEditPatient={handleEditPatient}
          onDeletePatient={handleDeletePatient}
        />

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 bg-white rounded-lg shadow">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Showing {startIndex + 1} to {Math.min(endIndex, totalCount)} of {totalCount} patients</span>
              <span className="text-gray-400">|</span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={goToFirstPage} disabled={currentPage === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToPreviousPage} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {getPageNumbers().map((pageNum) => (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(pageNum)}
                >
                  {pageNum}
                </Button>
              ))}
              <Button variant="outline" size="sm" onClick={goToNextPage} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToLastPage} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {filteredPatients.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No patients found matching your search criteria.
          </div>
        )}

        <PatientRegistrationForm
          isOpen={isRegistrationFormOpen}
          onClose={() => setIsRegistrationFormOpen(false)}
        />

        <EditPatientRegistrationDialog
          isOpen={isEditDialogOpen}
          onClose={() => {
            setIsEditDialogOpen(false);
            setPatientToEdit(null);
          }}
          patient={patientToEdit}
        />

        <PatientLookup
          isOpen={isPatientLookupOpen}
          onClose={() => setIsPatientLookupOpen(false)}
          onPatientSelected={handlePatientLookupSelect}
          onNewPatientRegistration={handleNewPatientFromLookup}
        />

        {selectedPatient && (
          <VisitRegistrationForm
            isOpen={isVisitFormOpen}
            onClose={() => {
              setIsVisitFormOpen(false);
              setSelectedPatient(null);
            }}
            patient={selectedPatient}
          />
        )}

        {selectedPatient && (
          <PatientDetailsModal
            isOpen={isPatientDetailsOpen}
            onClose={() => {
              setIsPatientDetailsOpen(false);
              setSelectedPatient(null);
            }}
            patient={selectedPatient}
          />
        )}

        <DeletePatientDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => {
            setIsDeleteDialogOpen(false);
            setPatientToDelete(null);
          }}
          patient={patientToDelete}
          onPatientDeleted={handlePatientDeleted}
        />
      </div>
    </div>
  );
};

const PatientDashboard = () => (
  <PatientDashboardErrorBoundary>
    <PatientDashboardInner />
  </PatientDashboardErrorBoundary>
);

export default PatientDashboard;
