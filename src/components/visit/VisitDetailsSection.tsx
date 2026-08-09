import React, { useEffect, useRef, useState } from 'react';
import { isYojanaPanel } from '@/lib/yojanaPanel';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDiagnoses } from '@/hooks/useDiagnoses';
import { Eye, Upload, X } from 'lucide-react';
import { RegistrationDocumentSelection } from '@/components/PatientRegistrationForm/types';

interface VisitDetailsSectionProps {
  visitDate: Date;
  setVisitDate: (date: Date) => void;
  formData: {
    visitType: string;
    dialysisPartner?: string;
    appointmentWith: string;
    reasonForVisit: string;
    relationWithEmployee: string;
    status: string;
    patientType?: string;
    wardAllotted?: string;
    roomAllotted?: string;
    referringDoctor?: string;
    relationshipManager?: string;
    claimId?: string;
    cardNo?: string;
    thumbRegistrationNo?: string;
    yojanaRegistrationId?: string;
    treatmentType?: string;
    diagnosisId?: string;
    billingCategoryOverride?: string;
    aadhaarNumber?: string;
  };
  handleInputChange: (field: string, value: string) => void;
  relationshipManagerIds: string[];
  onRelationshipManagersChange: (ids: string[], managers: Array<{ id: string; name: string }>) => void;
  existingVisit?: any; // Optional existing visit data for edit mode
  patientCorporate?: string; // Patient's original corporate/yojna category
  registrationDocuments: RegistrationDocumentSelection[];
  uploadedRegistrationDocuments: Array<{
    displayName: string;
    fileUrl: string;
  }>;
  onRegistrationDocumentSelect: (label: string, file: File | null) => void;
  onRegistrationDocumentRemove: (label: string) => void;
}

export const VisitDetailsSection: React.FC<VisitDetailsSectionProps> = ({
  visitDate,
  setVisitDate,
  formData,
  handleInputChange,
  relationshipManagerIds,
  onRelationshipManagersChange,
  existingVisit,
  patientCorporate,
  registrationDocuments,
  uploadedRegistrationDocuments,
  onRegistrationDocumentSelect,
  onRegistrationDocumentRemove,
}) => {
  const { hospitalConfig } = useAuth();
  const isEmergencyVisit = formData.patientType === 'Emergency'
    || ['emergency', 'casualty'].includes((formData.visitType || '').trim().toLowerCase());
  const { diagnoses, isLoading: isLoadingDiagnoses, addDiagnosisAsync } = useDiagnoses();
  const [doctors, setDoctors] = useState<Array<{ id: string; name: string; specialty: string | null; is_active?: boolean | null }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Referees state
  const [referees, setReferees] = useState<Array<{ id: string; name: string; specialty: string | null; institution: string | null }>>([]);
  const [isLoadingReferees, setIsLoadingReferees] = useState(true);

  // Relationship Managers state
  const [relationshipManagers, setRelationshipManagers] = useState<Array<{ id: string; name: string; code: string | null; contact_no: string | null }>>([]);
  const [isLoadingRelationshipManagers, setIsLoadingRelationshipManagers] = useState(true);

  // Ward and Room Management
  const [wards, setWards] = useState<Array<{ ward_id: string; ward_type: string; maximum_rooms: number; is_private?: boolean; has_attached_washroom?: boolean; room_number?: string | null }>>([]);
  const [isLoadingWards, setIsLoadingWards] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<number[]>([]);
  const [selectedWard, setSelectedWard] = useState<{ ward_id: string; maximum_rooms: number } | null>(null);
  // ward_id -> currently-admitted patient count, for live Available/Full status
  const [wardOccupancy, setWardOccupancy] = useState<Record<string, number>>({});
  const registrationInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const normalizeDocumentLabel = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const uploadedDocumentsByLabel = new Map<string, { displayName: string; fileUrl: string }>();
  for (const document of uploadedRegistrationDocuments) {
    const key = normalizeDocumentLabel(document.displayName);
    if (!uploadedDocumentsByLabel.has(key)) uploadedDocumentsByLabel.set(key, document);
  }

  const viewDocument = (file: File | null, fileUrl: string | undefined) => {
    if (file) {
      const url = URL.createObjectURL(file);
      const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
      if (previewWindow) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      else URL.revokeObjectURL(url);
      return;
    }
    if (fileUrl) window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Determine table based on hospital. Use the stable config id; display names
        // can change without changing the database table mapping.
        const tableName = hospitalConfig?.id === 'ayushman'
          ? 'ayushman_consultants'
          : 'hope_consultants';


        const { data, error } = await supabase
          .from(tableName)
          .select('id, name, specialty, is_active')
          .order('name');

        if (error) {
          console.error('Error fetching doctors:', error);
          setError('Failed to load doctors');
          setDoctors([]);
        } else {
          if (hospitalConfig?.id === 'ayushman' && (!data || data.length === 0)) {
            const { data: fallbackData, error: fallbackError } = await supabase
              .from('hope_consultants')
              .select('id, name, specialty, is_active')
              .order('name');

            if (fallbackError) {
              console.error('Error fetching fallback doctors:', fallbackError);
              setError('Failed to load doctors');
              setDoctors([]);
            } else {
              setDoctors((fallbackData || []).filter((doctor) =>
                doctor.is_active !== false || doctor.name === formData.appointmentWith
              ));
            }
          } else {
            setDoctors((data || []).filter((doctor) =>
              doctor.is_active !== false || doctor.name === formData.appointmentWith
            ));
          }
        }
      } catch (error) {
        console.error('Exception while fetching doctors:', error);
        setError('Failed to load doctors');
        setDoctors([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDoctors();
  }, [hospitalConfig?.id, formData.appointmentWith]);

  // Fetch referees from referees table
  useEffect(() => {
    const fetchReferees = async () => {
      try {
        setIsLoadingReferees(true);

        const { data, error } = await supabase
          .from('referees')
          .select('id, name, specialty, institution')
          .order('name');

        if (error) {
          console.error('Error fetching referees:', error);
          setReferees([]);
        } else {
          setReferees(data || []);
        }
      } catch (error) {
        console.error('Exception while fetching referees:', error);
        setReferees([]);
      } finally {
        setIsLoadingReferees(false);
      }
    };

    fetchReferees();
  }, []);

  // Fetch relationship managers from relationship_managers table
  useEffect(() => {
    const fetchRelationshipManagers = async () => {
      try {
        setIsLoadingRelationshipManagers(true);

        const { data, error } = await supabase
          .from('relationship_managers')
          .select('id, name, code, contact_no')
          .order('code');

        if (error) {
          console.error('Error fetching relationship managers:', error);
          setRelationshipManagers([]);
        } else {
          setRelationshipManagers(data || []);
        }
      } catch (error) {
        console.error('Exception while fetching relationship managers:', error);
        setRelationshipManagers([]);
      } finally {
        setIsLoadingRelationshipManagers(false);
      }
    };

    fetchRelationshipManagers();
  }, []);

  // Fetch wards from room_management table
  useEffect(() => {
    const fetchWards = async () => {
      try {
        setIsLoadingWards(true);

        // select('*') so this keeps working before/after the private-room
        // columns (is_private, has_attached_washroom, room_number) are added.
        // Only this hospital's wards — the master is per-hospital and showing
        // both tenants' wards produces duplicate-looking entries.
        let wardQuery = (supabase as any)
          .from('room_management')
          .select('*')
          .order('ward_type');
        if (hospitalConfig?.name) {
          wardQuery = wardQuery.eq('hospital_name', hospitalConfig.name);
        }
        const { data, error } = await wardQuery;

        if (error) {
          console.error('Error fetching wards:', error);
          setWards([]);
        } else {
          const wardRows = data || [];
          setWards(wardRows);

          // Live occupancy per ward (currently-admitted = discharge_date null)
          // drives the Available / Partially Occupied / Full labels below.
          const wardIds = wardRows.map((w: any) => w.ward_id).filter(Boolean);
          if (wardIds.length > 0) {
            const { data: visits } = await (supabase as any)
              .from('visits')
              .select('ward_allotted, discharge_date')
              .in('ward_allotted', wardIds)
              .is('discharge_date', null);
            const counts: Record<string, number> = {};
            (visits || []).forEach((v: { ward_allotted: string | null }) => {
              if (v.ward_allotted) counts[v.ward_allotted] = (counts[v.ward_allotted] || 0) + 1;
            });
            setWardOccupancy(counts);
          }
        }
      } catch (error) {
        console.error('Exception while fetching wards:', error);
        setWards([]);
      } finally {
        setIsLoadingWards(false);
      }
    };

    fetchWards();
  }, [hospitalConfig?.name]);

  // Update available rooms when ward is selected - fetch occupied rooms and filter them out
  useEffect(() => {
    const fetchAvailableRooms = async () => {
      if (formData.wardAllotted) {
        const ward = wards.find(w => w.ward_id === formData.wardAllotted);
        if (ward) {
          setSelectedWard({ ward_id: ward.ward_id, maximum_rooms: ward.maximum_rooms });

          try {
            // Fetch all occupied rooms for this ward (where discharge_date is NULL)
            const { data: occupiedVisits, error } = await supabase
              .from('visits')
              .select('room_allotted, id')
              .eq('ward_allotted', formData.wardAllotted)
              .is('discharge_date', null);

            if (error) {
              console.error('Error fetching occupied rooms:', error);
              // If error, show all rooms as fallback
              const rooms = Array.from({ length: ward.maximum_rooms }, (_, i) => i + 1);
              setAvailableRooms(rooms);
              return;
            }

            // Get list of occupied room numbers
            const occupiedRooms = occupiedVisits
              ?.map(v => parseInt(v.room_allotted))
              .filter(room => !isNaN(room)) || [];

            // If in edit mode, exclude current visit's room from occupied list
            const currentRoomNumber = existingVisit?.room_allotted ? parseInt(existingVisit.room_allotted) : null;
            const filteredOccupiedRooms = currentRoomNumber
              ? occupiedRooms.filter(room => room !== currentRoomNumber)
              : occupiedRooms;


            // Generate all room numbers and filter out occupied ones
            const allRooms = Array.from({ length: ward.maximum_rooms }, (_, i) => i + 1);
            const availableRoomsList = allRooms.filter(room => !filteredOccupiedRooms.includes(room));

            setAvailableRooms(availableRoomsList);
          } catch (error) {
            console.error('Exception while fetching occupied rooms:', error);
            // If exception, show all rooms as fallback
            const rooms = Array.from({ length: ward.maximum_rooms }, (_, i) => i + 1);
            setAvailableRooms(rooms);
          }
        }
      } else {
        setSelectedWard(null);
        setAvailableRooms([]);
      }
    };

    fetchAvailableRooms();
  }, [formData.wardAllotted, wards, existingVisit]);

  // Check room availability
  const checkAvailability = async () => {
    if (!formData.wardAllotted) {
      alert('Please select a ward first');
      return;
    }

    try {
      // Fetch all occupied rooms for this ward
      const { data, error } = await supabase
        .from('visits')
        .select('room_allotted')
        .eq('ward_allotted', formData.wardAllotted)
        .not('room_allotted', 'is', null);

      if (error) {
        console.error('Error checking availability:', error);
        alert('Failed to check availability');
        return;
      }

      const occupiedRooms = data.map(v => parseInt(v.room_allotted));
      const totalRooms = selectedWard?.maximum_rooms || 0;
      const allRooms = Array.from({ length: totalRooms }, (_, i) => i + 1);
      const available = allRooms.filter(room => !occupiedRooms.includes(room));

      alert(`Available rooms: ${available.length}\nOccupied rooms: ${occupiedRooms.length}\nTotal rooms: ${totalRooms}\n\nAvailable: ${available.join(', ')}`);
    } catch (error) {
      console.error('Error checking availability:', error);
      alert('Failed to check availability');
    }
  };

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setVisitDate(date);
    }
  };

  // Show ward/room fields only for IPD or Emergency patients
  const showWardRoomFields = formData.patientType === 'IPD' ||
                             formData.patientType === 'IPD (Inpatient)' ||
                             formData.patientType === 'Emergency';

  return (
    <div className="bg-blue-50 p-4 rounded-lg">
      <h3 className="text-lg font-semibold text-blue-700 mb-4">Visit Details</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Row 1 */}
        <div className="space-y-2">
          <EnhancedDatePicker
            label="Visit Date"
            value={visitDate}
            onChange={handleDateChange}
            placeholder="Select visit date"
            isDOB={false}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="patientType" className="text-sm font-medium">
            Patient Type <span className="text-red-500">*</span>
          </Label>
          <Select value={formData.patientType || ''} onValueChange={(value) => handleInputChange('patientType', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Patient Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPD">OPD (Outpatient)</SelectItem>
              <SelectItem value="IPD">IPD (Inpatient)</SelectItem>
              <SelectItem value="Emergency">Emergency</SelectItem>
              <SelectItem value="Dialysis">Dialysis</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Row 2 */}
        <div className="space-y-2">
          <Label htmlFor="visitType" className="text-sm font-medium">
            Visit Type <span className="text-red-500">*</span>
          </Label>
          <Select value={formData.visitType} onValueChange={(value) => handleInputChange('visitType', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Visit Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consultation">Consultation</SelectItem>
              <SelectItem value="follow-up">Follow-up</SelectItem>
              <SelectItem value="surgery">Surgery</SelectItem>
              <SelectItem value="emergency">Emergency</SelectItem>
              <SelectItem value="routine-checkup">Routine Checkup</SelectItem>
              <SelectItem value="patient-admission">Patient Admission</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formData.visitType.toLowerCase() === 'dialysis' && (
          <div className="space-y-2">
            <Label htmlFor="dialysisPartner" className="text-sm font-medium">
              Dialysis Partner <span className="text-red-500">*</span>
            </Label>
            <Select value={formData.dialysisPartner || ''} onValueChange={(value) => handleInputChange('dialysisPartner', value)}>
              <SelectTrigger><SelectValue placeholder="Select Dialysis Partner" /></SelectTrigger>
              <SelectContent><SelectItem value="NephroPlus">NephroPlus</SelectItem></SelectContent>
            </Select>
          </div>
        )}

        {/* Billing Category Override - only for Yojna/corporate patients */}
        {patientCorporate && patientCorporate.toLowerCase().trim() !== 'private' && (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="billingCategoryOverride" className="text-sm font-medium">
              Billing Category
            </Label>
            <p className="text-xs text-gray-500">
              Patient registered as: <span className="font-semibold text-blue-700">{patientCorporate}</span>
            </p>
            {(formData.visitType === 'follow-up' || formData.visitType === 'routine-checkup') && (
              <div className="bg-yellow-50 border border-yellow-300 rounded p-2 text-xs text-yellow-800">
                Review visits for Yojna patients are typically billed at private rates
              </div>
            )}
            <Select
              value={formData.billingCategoryOverride || ''}
              onValueChange={(value) => handleInputChange('billingCategoryOverride', value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Same as registration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="same_as_registration">Same as registration</SelectItem>
                <SelectItem value="private">Private</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {registrationDocuments.length > 0 && (
          <div className="space-y-3 md:col-span-2 rounded-md border border-blue-100 bg-white/60 p-3">
            <div>
              <Label className="text-sm font-medium">Corporate Documents</Label>
              <p className="text-xs text-muted-foreground">
                Existing documents are marked uploaded. You can add any missing document before saving this visit.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {registrationDocuments.map((document) => {
                const uploadedDocument = uploadedDocumentsByLabel.get(normalizeDocumentLabel(document.label));
                const hasFile = Boolean(document.file || uploadedDocument);

                return (
                  <div key={document.label} className="space-y-1.5 rounded-md border border-input bg-background p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <Label className="text-xs font-medium leading-4">{document.label}</Label>
                      <span className={`shrink-0 text-[11px] font-medium ${hasFile ? 'text-green-600' : 'text-amber-600'}`}>
                        {hasFile ? (document.file ? 'New file' : 'Uploaded') : 'Missing'}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={document.file?.name || uploadedDocument?.displayName}>
                        {document.file?.name || uploadedDocument?.displayName || 'No file selected'}
                      </div>
                      {hasFile && (
                        <button
                          type="button"
                          onClick={() => viewDocument(document.file, uploadedDocument?.fileUrl)}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => registrationInputRefs.current[document.label]?.click()}
                        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <Upload className="h-3 w-3" />
                        {document.file ? 'Change' : 'Browse'}
                      </button>
                      {document.file && (
                        <button
                          type="button"
                          onClick={() => {
                            onRegistrationDocumentRemove(document.label);
                            const input = registrationInputRefs.current[document.label];
                            if (input) input.value = '';
                          }}
                          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                        >
                          <X className="h-3 w-3" />
                          Remove
                        </button>
                      )}
                    </div>
                    <input
                      ref={(element) => {
                        registrationInputRefs.current[document.label] = element;
                      }}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      onChange={(event) => onRegistrationDocumentSelect(document.label, event.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="appointmentWith" className="text-sm font-medium">
            Appointment With <span className="text-red-500">*</span>
          </Label>
          <SearchableSelect
            options={[
              { value: 'none', label: 'None' },
              ...(formData.appointmentWith &&
                 formData.appointmentWith !== 'none' &&
                 !doctors.some(d => d.name === formData.appointmentWith)
                ? [{ value: formData.appointmentWith, label: `${formData.appointmentWith} (Current)` }]
                : []),
              ...doctors.map((doctor) => ({
                value: doctor.name,
                label: `${doctor.name}${doctor.specialty ? ` (${doctor.specialty})` : ''}`
              }))
            ]}
            value={formData.appointmentWith || ''}
            onValueChange={(value) => handleInputChange('appointmentWith', value)}
            placeholder={
              isLoading
                ? "Loading doctors..."
                : error
                ? "Error loading doctors"
                : doctors.length === 0
                ? "No doctors available"
                : "Select Doctor"
            }
            searchPlaceholder="Search doctors..."
            emptyText="No doctor found."
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          {!isLoading && !error && doctors.length === 0 && (
            <p className="text-sm text-gray-500">No doctors found in the database</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="reasonForVisit" className="text-sm font-medium">
            Reason for Visit <span className="text-red-500">*</span>
          </Label>
          <Input
            id="reasonForVisit"
            placeholder="Reason for visit"
            value={formData.reasonForVisit}
            onChange={(e) => handleInputChange('reasonForVisit', e.target.value)}
          />
        </div>

        {/* Diagnosis */}
        <div className="space-y-2">
          <Label htmlFor="diagnosisId" className="text-sm font-medium">
            Diagnosis
          </Label>
          <SearchableSelect
            options={[
              { value: 'none', label: 'None' },
              ...diagnoses.map((d) => ({
                value: d.id,
                label: d.name
              }))
            ]}
            value={formData.diagnosisId || ''}
            onValueChange={(value) => handleInputChange('diagnosisId', value === 'none' ? '' : value)}
            placeholder={
              isLoadingDiagnoses
                ? "Loading diagnoses..."
                : "Select or type Diagnosis"
            }
            searchPlaceholder="Search or type a new diagnosis..."
            emptyText="No diagnosis found."
            onCreateOption={async (name) => {
              try {
                const created = await addDiagnosisAsync({ name });
                if (created?.id) {
                  handleInputChange('diagnosisId', created.id);
                }
              } catch {
                /* toast is surfaced by the useDiagnoses mutation */
              }
            }}
          />
        </div>

        {/* Row 3 */}
        <div className="space-y-2">
          <Label htmlFor="relationWithEmployee" className="text-sm font-medium">
            Relation with Employee
          </Label>
          <Select value={formData.relationWithEmployee} onValueChange={(value) => handleInputChange('relationWithEmployee', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Relation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">Self</SelectItem>
              <SelectItem value="spouse">Spouse</SelectItem>
              <SelectItem value="child">Child</SelectItem>
              <SelectItem value="parent">Parent</SelectItem>
              <SelectItem value="dependent">Dependent</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="status" className="text-sm font-medium">
            Status
          </Label>
          <Select value={formData.status} onValueChange={(value) => handleInputChange('status', value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Referring Doctor */}
        <div className="space-y-2">
          <Label htmlFor="referringDoctor" className="text-sm font-medium">
            Referring Doctor <span className="text-red-500">*</span>
          </Label>
          <SearchableSelect
            options={[
              { value: 'none', label: 'None' },
              ...referees.map((referee) => ({
                value: referee.name,
                label: `${referee.name}${referee.specialty ? ` (${referee.specialty})` : ''}`
              }))
            ]}
            value={formData.referringDoctor || ''}
            onValueChange={(value) => handleInputChange('referringDoctor', value)}
            placeholder={
              isLoadingReferees
                ? "Loading referees..."
                : referees.length === 0
                ? "No referees available"
                : "Select Referring Doctor"
            }
            searchPlaceholder="Search referees..."
            emptyText="No referee found."
          />
        </div>

        {/* Relationship Managers */}
        <div className="space-y-2">
          <Label htmlFor="relationshipManager" className="text-sm font-medium">
            Relationship Managers <span className="text-red-500">*</span>
          </Label>
          {relationshipManagerIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {relationshipManagerIds.map((id, index) => {
                const manager = relationshipManagers.find((item) => item.id === id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    {manager?.name || 'Manager'}{index === 0 ? ' · Primary' : ''}
                    <button type="button" aria-label="Remove relationship manager" onClick={() => {
                      const next = relationshipManagerIds.filter((item) => item !== id);
                      onRelationshipManagersChange(next, relationshipManagers);
                    }}><X className="h-3 w-3" /></button>
                  </span>
                );
              })}
            </div>
          )}
          <SearchableSelect
            options={[
              ...relationshipManagers.filter((manager) => !relationshipManagerIds.includes(manager.id)).map((manager) => ({
                value: manager.id,
                label: manager.code ? `${manager.name} (${manager.code})` : manager.name
              }))
            ]}
            value=""
            onValueChange={(value) => {
              if (!value || relationshipManagerIds.length >= 3) return;
              const selected = relationshipManagers.find((manager) => manager.id === value);
              const isDirectSelection = selected?.name.trim().toLowerCase() === 'direct';
              const hasDirect = relationshipManagerIds.some((id) => relationshipManagers.find((manager) => manager.id === id)?.name.trim().toLowerCase() === 'direct');
              if ((isDirectSelection && relationshipManagerIds.length > 0) || (hasDirect && !isDirectSelection)) return;
              onRelationshipManagersChange([...relationshipManagerIds, value], relationshipManagers);
            }}
            placeholder={
              isLoadingRelationshipManagers
                ? "Loading..."
                : relationshipManagers.length === 0
                ? "No managers available"
                : relationshipManagerIds.length >= 3 ? "Maximum three managers selected" : "Add Relationship Manager"
            }
            searchPlaceholder="Search managers..."
            emptyText="No manager found."
          />
        </div>

        {/* Aadhaar number — held on the patient, asked for here so a visit is
            never registered against an unidentified patient. Emergency
            arrivals are exempt: the card can follow, the treatment cannot. */}
        <div className="space-y-2">
          <Label htmlFor="aadhaarNumber" className="text-sm font-medium">
            Aadhaar Number{' '}
            {isEmergencyVisit
              ? <span className="text-xs font-normal text-muted-foreground">(optional in an emergency)</span>
              : <span className="text-red-500">*</span>}
          </Label>
          <Input
            id="aadhaarNumber"
            inputMode="numeric"
            placeholder="12 digits"
            value={formData.aadhaarNumber || ''}
            onChange={(e) =>
              handleInputChange('aadhaarNumber', e.target.value.replace(/\D/g, '').slice(0, 12))
            }
          />
          <p className="text-xs text-muted-foreground">
            Saved on the patient's record — asked once, then shown on every later visit.
          </p>
        </div>

        {/* Claim Id */}
        <div className="space-y-2">
          <Label htmlFor="claimId" className="text-sm font-medium">
            Claim Id <span className="text-red-500">*</span>
          </Label>
          <Input
            id="claimId"
            placeholder="Enter Claim Id"
            value={formData.claimId || ''}
            onChange={(e) => handleInputChange('claimId', e.target.value)}
          />
        </div>

        {/* Card No */}
        <div className="space-y-2">
          <Label htmlFor="cardNo" className="text-sm font-medium">
            Card No
          </Label>
          <Input
            id="cardNo"
            placeholder="Enter Card No"
            value={formData.cardNo || ''}
            onChange={(e) => handleInputChange('cardNo', e.target.value)}
          />
        </div>

        {/* Thumb Registration No. */}
        <div className="space-y-2">
          <Label htmlFor="thumbRegistrationNo" className="text-sm font-medium">
            Thumb Registration No. <span className="text-red-500">*</span>
          </Label>
          <Input
            id="thumbRegistrationNo"
            placeholder="Enter Thumb Registration No."
            value={formData.thumbRegistrationNo || ''}
            onChange={(e) => handleInputChange('thumbRegistrationNo', e.target.value)}
          />
        </div>

        {/* Yojana Registration ID — the key that matches this patient to
            their government-portal row. Only shown for Yojana panels, where
            it is required: without it, portal reconciliation falls back to
            matching names, which drift. */}
        {isYojanaPanel(patientCorporate) && (
          <div className="space-y-2">
            <Label htmlFor="yojanaRegistrationId" className="text-sm font-medium">
              Yojana Registration ID{' '}
              {/* The portal issues this per IPD case — an OPD visit has none
                  yet, so it is only required on an admission. */}
              {['IPD', 'IPD (Inpatient)', 'Emergency'].includes(formData.patientType || '')
                ? <span className="text-red-500">*</span>
                : <span className="text-xs font-normal text-muted-foreground">(optional for OPD)</span>}
            </Label>
            <Input
              id="yojanaRegistrationId"
              placeholder="As printed on the Yojana card"
              value={formData.yojanaRegistrationId || ''}
              onChange={(e) => handleInputChange('yojanaRegistrationId', e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Matches this patient to the government portal — claims and extension
              alerts depend on it.
            </p>
          </div>
        )}

        {/* Treatment Type */}
        <div className="space-y-2">
          <Label htmlFor="treatmentType" className="text-sm font-medium">
            Treatment Type <span className="text-red-500">*</span>
          </Label>
          <Select
            value={formData.treatmentType || ''}
            onValueChange={(value) => handleInputChange('treatmentType', value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Treatment Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Conservative">Conservative</SelectItem>
              <SelectItem value="Surgical">Surgical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Row 4 - Ward and Room Allocation (Only for IPD/Emergency) */}
        {showWardRoomFields && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="wardAllotted" className="text-sm font-medium">
                  Ward Allotted <span className="text-red-500">*</span>
                </Label>
                <button
                  type="button"
                  onClick={checkAvailability}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  Check Availability
                </button>
              </div>
              <Select
                value={formData.wardAllotted || ''}
                onValueChange={(value) => {
                  handleInputChange('wardAllotted', value);
                  // Reset room when ward changes
                  handleInputChange('roomAllotted', '');
                }}
                disabled={isLoadingWards}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isLoadingWards
                        ? "Loading wards..."
                        : wards.length === 0
                        ? "No wards available"
                        : "Select Ward"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {wards.map((ward) => {
                    const occupied = wardOccupancy[ward.ward_id] || 0;
                    const isFull = occupied >= ward.maximum_rooms;
                    const status = occupied <= 0 ? 'Available' : isFull ? 'Full' : 'Partially Occupied';
                    // Private rooms show washroom + live availability; full rooms
                    // cannot be selected. Non-private wards keep the plain label.
                    const label = ward.is_private
                      ? `${ward.ward_type} · ${ward.maximum_rooms} bed${ward.maximum_rooms === 1 ? '' : 's'} · ${ward.has_attached_washroom ? 'Washroom' : 'No washroom'} · ${status} (${occupied}/${ward.maximum_rooms})`
                      : `${ward.ward_type} (Max: ${ward.maximum_rooms} beds)`;
                    return (
                      <SelectItem key={ward.ward_id} value={ward.ward_id} disabled={ward.is_private && isFull}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="roomAllotted" className="text-sm font-medium">
                Room Allotted <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.roomAllotted || ''}
                onValueChange={(value) => handleInputChange('roomAllotted', value)}
                disabled={!formData.wardAllotted || availableRooms.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Please Select" />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((roomNum) => (
                    <SelectItem key={roomNum} value={roomNum.toString()}>
                      Bed {roomNum}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.wardAllotted && availableRooms.length === 0 && (
                <p className="text-xs text-gray-500">No rooms available in selected ward</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
