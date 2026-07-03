import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Pill, FileText, Clipboard } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useVisitMedicalData } from '@/hooks/useVisitMedicalData';
import { useMedicalDataMutations } from '@/hooks/useMedicalDataMutations';

interface MedicationsTabProps {
  patient: any;
  visitId?: string;
}

const MedicationsTab = ({ patient, visitId }: MedicationsTabProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [fromDay, setFromDay] = useState('1');
  const [toDay, setToDay] = useState('7');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMedications, setSelectedMedications] = useState<string[]>([]);

  // Get current visit's medical data
  const { medications: currentMedications } = useVisitMedicalData(visitId);
  
  // Get mutations for storing data
  const { addMedications, isAddingMedications } = useMedicalDataMutations();

  // Fetch medications from database
  const { data: medications = [] } = useQuery({
    queryKey: ['medications', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('medication')
        .select('*')
        .order('name')
        .limit(100);
      if (searchTerm) {
        query = query.ilike('name', `%${searchTerm}%`);
      }
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching medications:', error);
        throw error;
      }
      
      return data;
    }
  });

  const filteredMedications = medications.filter(med =>
    med.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleMedicationToggle = (medicationId: string) => {
    setSelectedMedications(prev =>
      prev.includes(medicationId)
        ? prev.filter(id => id !== medicationId)
        : [...prev, medicationId]
    );
  };

  const handleSave = () => {
    if (!visitId || selectedMedications.length === 0) {
      console.error('No visit ID or medications selected');
      return;
    }

    const medicationsToAdd = selectedMedications.map(medicationId => ({
      medication_id: medicationId,
      medication_type: 'other', // Default type, could be made configurable
      dosage: '1 tablet', // Default dosage, could be made configurable
      frequency: 'BID', // Default frequency, could be made configurable
      duration: `${toDay} days`,
      route: 'oral'
    }));

    addMedications({ 
      visitId, 
      medications: medicationsToAdd 
    });
    setSelectedMedications([]);
  };

  const handlePrescription = () => {
    navigate('/prescriptions');
  };

  const handleTreatmentSheet = () => {
    const patientId = searchParams.get('patient');
    navigate(`/treatment-sheet?patient=${patientId}`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pill className="h-5 w-5" />
            <CardTitle>Medications</CardTitle>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handlePrescription}
              className="flex items-center gap-1 px-3 py-1 h-8 text-xs"
            >
              <FileText className="h-3 w-3" />
              Prescription
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleTreatmentSheet}
              className="flex items-center gap-1 px-3 py-1 h-8 text-xs"
            >
              <Clipboard className="h-3 w-3" />
              Treatment Sheet
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">To be given</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Day Range Selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm">Showing medications for:</span>
            <Badge variant="outline" className="bg-blue-100 text-blue-800">
              D{fromDay}
            </Badge>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 7 }, (_, i) => (
              <Button
                key={i + 1}
                variant={fromDay === String(i + 1) ? "default" : "outline"}
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => {
                  setFromDay(String(i + 1));
                  setToDay(String(i + 1));
                }}
              >
                D{i + 1}
              </Button>
            ))}
          </div>

          <div className="text-sm text-muted-foreground">
            {currentMedications.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-medium text-sm">Current Medications:</h4>
                {currentMedications.map((medication) => (
                  <div key={medication.id} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm">{medication.medication_name}</span>
                    <Badge variant="outline" className="text-xs">
                      {medication.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              'No medications saved for this day.'
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm">Day</span>
            <Input
              type="number"
              value={fromDay}
              onChange={(e) => setFromDay(e.target.value)}
              className="w-16 h-8"
              min="1"
            />
            <span className="text-sm">to</span>
            <Input
              type="number"
              value={toDay}
              onChange={(e) => setToDay(e.target.value)}
              className="w-16 h-8"
              min="1"
            />
          </div>

          {/* Search */}
          <Input
            placeholder="Search medicine..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />

          {/* Medications List */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Select from all medications:</h4>
            <div className="max-h-48 overflow-y-auto space-y-2 border rounded p-2">
              {filteredMedications.map((medication) => (
                <div key={medication.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={medication.id}
                    checked={selectedMedications.includes(medication.id)}
                    onCheckedChange={() => handleMedicationToggle(medication.id)}
                  />
                  <label htmlFor={medication.id} className="text-sm cursor-pointer flex-1">
                    {medication.name}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            className="w-full"
            disabled={selectedMedications.length === 0 || isAddingMedications || !visitId}
          >
            {isAddingMedications ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MedicationsTab;
