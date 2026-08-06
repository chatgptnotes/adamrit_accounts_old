
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Search, Upload, Users, Info, Database } from 'lucide-react';
import { PatientReport } from '@/components/PatientReport';
import { PatientLookup } from '@/components/PatientLookup';
import { useState } from 'react';
import { CSVImport } from '@/components/CSVImport';
import { BulkPatientImport } from '@/components/BulkPatientImport';

interface SearchAndControlsProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onAddPatientClick: () => void;
  onAddDiagnosisClick: () => void;
  patientData: Record<string, any[]>;
  diagnoses: string[];
  onImportPatients: (patients: any[]) => void;
}

export const SearchAndControls: React.FC<SearchAndControlsProps> = ({
  searchTerm,
  onSearchChange,
  onAddPatientClick,
  onAddDiagnosisClick,
  patientData,
  diagnoses,
  onImportPatients
}) => {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [isPatientLookupOpen, setIsPatientLookupOpen] = useState(false);

  const handlePatientLookupSelect = (patient: any) => {
    // Could be used to navigate to patient details or start a visit
  };

  const handleNewPatientFromLookup = () => {
    onAddPatientClick();
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onSearchChange(value);
  };

  const handleBulkImportComplete = () => {
    // Refresh the page data after bulk import
    window.location.reload();
  };

  const searchableFields = [
    "Patient names",
    "Primary diagnosis", 
    "Surgeon names",
    "Consultant names",
    "Hope surgeons/consultants",
    "Surgery procedures",
    "Complications",
    "Antibiotics",
    "Labs and radiology",
    "Other medications",
    "Diagnosis category names"
  ];

  return (
    <>
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative">
                  <Input
                    placeholder="Search name, UHID, visit ID, diagnosis or doctor..."
                    aria-label="Search patients and clinical records"
                    value={searchTerm}
                    onChange={handleSearchChange}
                    className="pl-10 pr-8"
                  />
                  <Info className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs p-3 bg-card border shadow-lg">
                <div className="text-sm">
                  <p className="font-semibold mb-2 text-foreground">Search across:</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {searchableFields.map((field, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <span className="w-1 h-1 bg-primary rounded-full flex-shrink-0"></span>
                        {field}
                      </li>
                    ))}
                  </ul>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setIsPatientLookupOpen(true)}
            variant="outline"
            className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
          >
            <Users className="h-4 w-4 mr-2" />
            Find Patient
          </Button>
          <PatientReport patientData={patientData} />
          <Button 
            onClick={() => setIsBulkImportOpen(true)} 
            variant="outline"
            className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
          >
            <Database className="h-4 w-4 mr-2" />
            Bulk Import
          </Button>
          <Button onClick={() => setIsImportOpen(true)} variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={onAddDiagnosisClick} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            Add Diagnosis Category
          </Button>
        </div>
      </div>

      <CSVImport
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={onImportPatients}
        diagnoses={diagnoses}
      />

      <BulkPatientImport
        isOpen={isBulkImportOpen}
        onClose={() => setIsBulkImportOpen(false)}
        onImportComplete={handleBulkImportComplete}
      />

      <PatientLookup
        isOpen={isPatientLookupOpen}
        onClose={() => setIsPatientLookupOpen(false)}
        onPatientSelected={handlePatientLookupSelect}
        onNewPatientRegistration={handleNewPatientFromLookup}
      />
    </>
  );
};
