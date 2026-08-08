
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InvestigationsTab from './tabs/InvestigationsTab';
import MedicationsTab from './tabs/MedicationsTab';
import FinalBillTab from './tabs/FinalBillTab';
import { EditableFinalBillTab } from './tabs/EditableFinalBillTab';
import LabTrendChart from '@/components/lab/LabTrendChart';
import RadiologyOrdersTab from './tabs/RadiologyOrdersTab';
import ProtectedFinalBillContent from '@/components/invoice/ProtectedFinalBillContent';

interface PatientTabsProps {
  patient: any;
  visitId?: string;
}

const PatientTabs = ({ patient, visitId }: PatientTabsProps) => {
  return (
    <Tabs defaultValue="investigations" className="space-y-4 no-print">
      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
        <TabsTrigger value="investigations">Investigations</TabsTrigger>
        <TabsTrigger value="trends">Lab Trends</TabsTrigger>
        <TabsTrigger value="medications">Medications</TabsTrigger>
        <TabsTrigger value="radiology">Radiology</TabsTrigger>
        <TabsTrigger value="billing">View Bill</TabsTrigger>
        <TabsTrigger value="edit-billing">Edit Bill</TabsTrigger>
      </TabsList>

      <TabsContent value="investigations" className="space-y-4">
        <InvestigationsTab patient={patient} visitId={visitId} />
      </TabsContent>

      <TabsContent value="trends" className="space-y-4">
        {patient?.id
          ? <LabTrendChart patientId={patient.id} />
          : <p className="text-sm text-muted-foreground">No patient selected.</p>
        }
      </TabsContent>

      <TabsContent value="medications" className="space-y-4">
        <MedicationsTab patient={patient} visitId={visitId} />
      </TabsContent>

      <TabsContent value="radiology" className="space-y-4">
        <RadiologyOrdersTab patient={patient} />
      </TabsContent>

      <TabsContent value="billing" className="space-y-4">
        <ProtectedFinalBillContent visitId={visitId}>
          <FinalBillTab patient={patient} visitId={visitId} />
        </ProtectedFinalBillContent>
      </TabsContent>

      <TabsContent value="edit-billing" className="space-y-4">
        <ProtectedFinalBillContent visitId={visitId}>
          <EditableFinalBillTab patient={patient} visitId={visitId || ''} />
        </ProtectedFinalBillContent>
      </TabsContent>
    </Tabs>
  );
};

export default PatientTabs;
