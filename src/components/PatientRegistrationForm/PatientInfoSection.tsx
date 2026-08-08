
import React, { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect, SearchableSelectOption } from '@/components/ui/searchable-select';
import { EnhancedDatePicker } from '@/components/ui/enhanced-date-picker';
import { Eye, Upload, X, Loader2 } from 'lucide-react';
import { PatientFormData, RegistrationDocumentSelection } from './types';
import {
  SimilarPatientsPrompt,
  type SimilarPatientsState,
} from './SimilarPatientsPrompt';
import { useCorporateData } from '@/hooks/useCorporateData';
import { supabase } from '@/integrations/supabase/client';

interface PatientInfoSectionProps {
  formData: PatientFormData;
  dateOfBirth?: Date;
  registrationDocuments: RegistrationDocumentSelection[];
  onInputChange: (field: string, value: string) => void;
  onDateChange: (date: Date | undefined) => void;
  onPatientPhotoSelect: (file: File | null) => void;
  onRegistrationDocumentSelect: (label: string, file: File | null) => void;
  onRegistrationDocumentRemove: (label: string) => void;
  /** Duplicate-name guard: what is on screen, and what the user decided. */
  similarPatients?: SimilarPatientsState;
  onSimilarPatientsChange?: (state: SimilarPatientsState) => void;
}

export const PatientInfoSection: React.FC<PatientInfoSectionProps> = ({
  formData,
  dateOfBirth,
  registrationDocuments,
  onInputChange,
  onDateChange,
  onPatientPhotoSelect,
  onRegistrationDocumentSelect,
  onRegistrationDocumentRemove,
  similarPatients,
  onSimilarPatientsChange,
}) => {
  const corporateKey = formData.corporate.trim().toLowerCase();
  const isEsicCorporate = corporateKey.includes('esic');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const registrationInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);

  const handleRegistrationDocumentView = (file: File) => {
    const url = URL.createObjectURL(file);
    const previewWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (previewWindow) {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      URL.revokeObjectURL(url);
    }
  };

  // Relationship Managers for the selectable RM field. Patient can pick a
  // registered RM or choose "Direct" when they came without a referral.
  const [relationshipManagers, setRelationshipManagers] = React.useState<
    Array<{ id: string; name: string; code: string | null }>
  >([]);
  const [isLoadingRMs, setIsLoadingRMs] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const fetchRMs = async () => {
      setIsLoadingRMs(true);
      const { data, error } = await supabase
        .from('relationship_managers')
        .select('id, name, code')
        .order('code');
      if (cancelled) return;
      if (error) {
        console.error('Error fetching relationship managers:', error);
        setRelationshipManagers([]);
      } else {
        setRelationshipManagers(data || []);
      }
      setIsLoadingRMs(false);
    };
    fetchRMs();
    return () => {
      cancelled = true;
    };
  }, []);

  // Typeable RM field — displays the RM name, but stores the code on
  // formData.relationshipManager (same shape the rest of the app expects).
  const [rmTypedName, setRmTypedName] = React.useState<string>('');
  const [rmSaving, setRmSaving] = React.useState<boolean>(false);

  // Keep the visible text in sync with whatever formData currently has
  // (so external resets / edit-mode loads display the right thing).
  React.useEffect(() => {
    const val = formData.relationshipManager;
    if (!val) {
      setRmTypedName('');
      return;
    }
    if (val === 'Direct') {
      setRmTypedName('Direct');
      return;
    }
    // val is either a code (preferred) or a name. Resolve to the name.
    const byCode = relationshipManagers.find((m) => m.code === val);
    if (byCode) {
      setRmTypedName(byCode.name);
      return;
    }
    const byName = relationshipManagers.find(
      (m) => m.name.trim().toLowerCase() === val.trim().toLowerCase(),
    );
    setRmTypedName(byName ? byName.name : val);
  }, [formData.relationshipManager, relationshipManagers]);

  // Resolve the typed value: blank → cleared, "Direct" → Direct, existing
  // master entry → that entry's code, otherwise INSERT a new master row and
  // use the newly-generated code. Run on blur and on Enter. Idempotent —
  // re-blurring on an unchanged value is a no-op.
  const resolveRmTyped = async (typedRaw: string) => {
    const trimmed = typedRaw.trim();
    const currentVal = formData.relationshipManager ?? '';

    // Empty input → mark as Direct (cleared).
    if (!trimmed) {
      if (currentVal !== '') onInputChange('relationshipManager', '');
      return;
    }

    // Explicit Direct.
    if (trimmed.toLowerCase() === 'direct') {
      if (currentVal !== 'Direct') onInputChange('relationshipManager', 'Direct');
      setRmTypedName('Direct');
      return;
    }

    // Try existing master entry (case-insensitive).
    const match = relationshipManagers.find(
      (m) => m.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (match) {
      const codeOrName = match.code || match.name;
      // Idempotence: nothing to do if formData already holds this exact RM.
      if (currentVal === codeOrName) {
        // Just normalize the visible text to the canonical name.
        if (rmTypedName !== match.name) setRmTypedName(match.name);
        return;
      }
      onInputChange('relationshipManager', codeOrName);
      setRmTypedName(match.name);
      return;
    }

    // Not in local cache — could mean (a) truly new, or (b) added by another
    // session since we loaded. Try a live re-check before inserting.
    setRmSaving(true);
    try {
      const { data: existing } = await supabase
        .from('relationship_managers')
        .select('id, name, code')
        .ilike('name', trimmed)
        .limit(1);
      if (existing && existing.length > 0) {
        const row = existing[0] as { id: string; name: string; code: string | null };
        const codeOrName = row.code || row.name;
        onInputChange('relationshipManager', codeOrName);
        setRmTypedName(row.name);
        // Backfill local cache so the next blur is a fast path.
        setRelationshipManagers((prev) =>
          prev.some((m) => m.id === row.id)
            ? prev
            : [...prev, { id: row.id, name: row.name, code: row.code }],
        );
        return;
      }

      // Truly new → INSERT.
      const { data: inserted, error } = await supabase
        .from('relationship_managers')
        .insert([{ name: trimmed }])
        .select('id, name, code')
        .single();
      if (error) {
        // Likely a race (case-insensitive unique index collision). Recover by
        // re-fetching that exact name and using the existing row.
        const { data: refetched } = await supabase
          .from('relationship_managers')
          .select('id, name, code')
          .ilike('name', trimmed)
          .limit(1);
        if (refetched && refetched.length > 0) {
          const row = refetched[0] as { id: string; name: string; code: string | null };
          const codeOrName = row.code || row.name;
          onInputChange('relationshipManager', codeOrName);
          setRmTypedName(row.name);
          setRelationshipManagers((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, { id: row.id, name: row.name, code: row.code }],
          );
          return;
        }
        throw error;
      }
      const row = inserted as { id: string; name: string; code: string | null };
      const codeOrName = row.code || row.name;
      onInputChange('relationshipManager', codeOrName);
      setRmTypedName(row.name);
      setRelationshipManagers((prev) => [
        ...prev,
        { id: row.id, name: row.name, code: row.code },
      ]);
    } catch (err) {
      console.error('Failed to resolve RM:', err);
      alert(`Could not add new RM "${trimmed}". ${err instanceof Error ? err.message : ''}`);
      // Revert visible text to the prior saved value so we don't store stray text.
      const prior = formData.relationshipManager;
      const byCode = prior ? relationshipManagers.find((m) => m.code === prior) : null;
      setRmTypedName(byCode?.name ?? (prior ?? ''));
    } finally {
      setRmSaving(false);
    }
  };

  // Fetch corporate options dynamically from database
  const { corporateOptions, loading: corporateLoading, error: corporateError, refetch: refetchCorporate } = useCorporateData();

  // Log for debugging
  React.useEffect(() => {
    console.log('🏢 Corporate options loaded:', corporateOptions.length, 'options');
    if (corporateError) {
      console.error('❌ Error loading corporate options:', corporateError);
    }
  }, [corporateOptions, corporateError]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      onPatientPhotoSelect(file);
      // Store file name in form data
      onInputChange('patientPhoto', file.name);
    }
  };

  const handleFileRemove = () => {
    setSelectedFile(null);
    onPatientPhotoSelect(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    onInputChange('patientPhoto', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };
  return (
    <div className="bg-blue-50 p-4 rounded-lg">
      <h3 className="text-lg font-semibold text-blue-700 mb-4">UID Patient Information</h3>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Patient Name */}
        <div className="space-y-2">
          <Label htmlFor="patientName" className="text-sm font-medium">
            Patient Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="patientName"
            placeholder="Patient Name"
            value={formData.patientName}
            onChange={(e) => onInputChange('patientName', e.target.value)}
            className="w-full"
            required
          />
          {/* A patient who has been here before must not be registered twice. */}
          {similarPatients && onSimilarPatientsChange && (
            <SimilarPatientsPrompt
              typedName={formData.patientName}
              hospitalName={formData.hospitalName}
              value={similarPatients}
              onChange={onSimilarPatientsChange}
            />
          )}
        </div>

        {/* Corporate */}
        <div className="space-y-2">
          <Label htmlFor="corporate" className="text-sm font-medium">
            Corporate <span className="text-red-500">*</span>
            {corporateLoading && (
              <Loader2 className="inline-block ml-2 h-3 w-3 animate-spin" />
            )}
          </Label>
          <SearchableSelect
            options={corporateOptions}
            value={formData.corporate}
            onValueChange={(value) => onInputChange('corporate', value)}
            placeholder={corporateLoading ? "Loading corporates..." : "Select Corporate"}
            searchPlaceholder="Type to search..."
            emptyText="No corporate option found."
            disabled={corporateLoading}
          />
          {corporateError && (
            <p className="text-xs text-red-500 mt-1">
              Error loading corporates. Using default options.
            </p>
          )}
        </div>

        {/* Age */}
        <div className="space-y-2">
          <Label htmlFor="age" className="text-sm font-medium">
            Age <span className="text-red-500">*</span>
          </Label>
          <Input
            id="age"
            type="number"
            placeholder="Age"
            value={formData.age}
            onChange={(e) => onInputChange('age', e.target.value)}
            className="w-full"
            min="0"
            max="150"
          />
        </div>

        {/* Gender */}
        <div className="space-y-2">
          <Label htmlFor="gender" className="text-sm font-medium">
            Gender <span className="text-red-500">*</span>
          </Label>
          <Select value={formData.gender} onValueChange={(value) => onInputChange('gender', value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label htmlFor="phone" className="text-sm font-medium">
            Phone <span className="text-red-500">*</span>
          </Label>
          <Input
            id="phone"
            type="tel"
            placeholder="Phone Number"
            value={formData.phone}
            onChange={(e) => onInputChange('phone', e.target.value)}
            className="w-full"
            pattern="[0-9]{10}"
          />
        </div>

        {/* Address */}
        <div className="space-y-2">
          <Label htmlFor="address" className="text-sm font-medium">
            Address <span className="text-red-500">*</span>
          </Label>
          <Input
            id="address"
            placeholder="Address"
            value={formData.address}
            onChange={(e) => onInputChange('address', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="Email"
            value={formData.email}
            onChange={(e) => onInputChange('email', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Date of Birth */}
        <div className="space-y-2">
          <EnhancedDatePicker
            label="Date of Birth"
            value={dateOfBirth}
            onChange={onDateChange}
            placeholder="Select date of birth"
            isDOB={true}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mt-4">
        {/* Patient's Photo */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Patient's Photo</Label>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={handleUploadClick}
          >
            {previewUrl ? (
              <div className="relative">
                <img
                  src={previewUrl}
                  alt="Patient preview"
                  className="mx-auto h-20 w-20 object-cover rounded-lg mb-2"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFileRemove();
                  }}
                  className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="text-xs text-gray-600">{selectedFile?.name}</div>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-6 w-6 text-gray-400 mb-2" />
                <div className="text-sm text-gray-500">Choose file</div>
                <div className="text-xs text-gray-400 mt-1">No file chosen</div>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        <div className="lg:col-span-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Aadhar/Passport */}
            <div className="space-y-2">
              <Label htmlFor="aadharPassport" className="text-sm font-medium">
                Aadhar/Passport
              </Label>
              <Input
                id="aadharPassport"
                placeholder="Aadhar/Passport"
                value={formData.aadharPassport}
                onChange={(e) => onInputChange('aadharPassport', e.target.value)}
                className="w-full"
              />
            </div>

            {/* Ayushman ID */}
            <div className="space-y-2">
              <Label htmlFor="ayushmanId" className="text-sm font-medium">
                Ayushman ID
              </Label>
              <Input
                id="ayushmanId"
                placeholder="Ayushman card ID"
                value={formData.ayushmanId}
                onChange={(e) => onInputChange('ayushmanId', e.target.value)}
                className="w-full"
              />
            </div>

            {/* Aadhar ID */}
            <div className="space-y-2">
              <Label htmlFor="aadharId" className="text-sm font-medium">
                Aadhar ID
              </Label>
              <Input
                id="aadharId"
                placeholder="Aadhar number"
                value={formData.aadharId}
                onChange={(e) => onInputChange('aadharId', e.target.value)}
                className="w-full"
              />
            </div>

            {registrationDocuments.length > 0 ? (
              <div className="col-span-full">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {registrationDocuments.map((document) => (
                    <div key={document.label} className="space-y-2">
                      <Label className="text-sm font-medium break-words leading-5">
                        {document.label}
                      </Label>
                      <div className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                        <div className="min-w-0 flex-1 text-sm text-muted-foreground">
                          {document.file ? (
                            <span className="block truncate text-foreground" title={document.file.name}>
                              {document.file.name}
                            </span>
                          ) : (
                            <span>Choose file</span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {document.file ? (
                            <button
                              type="button"
                              onClick={() => handleRegistrationDocumentView(document.file as File)}
                              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => registrationInputRefs.current[document.label]?.click()}
                            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <Upload className="h-3 w-3" />
                            {document.file ? 'Change' : 'Browse'}
                          </button>
                          {document.file ? (
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
                          ) : null}
                        </div>
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
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">

        {/* Quarter/Plot No. */}
        <div className="space-y-2">
          <Label htmlFor="quarterPlotNo" className="text-sm font-medium">
            Quarter/Plot No.
          </Label>
          <Input
            id="quarterPlotNo"
            placeholder="Quarter/Plot No."
            value={formData.quarterPlotNo}
            onChange={(e) => onInputChange('quarterPlotNo', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Ward */}
        <div className="space-y-2">
          <Label htmlFor="ward" className="text-sm font-medium">
            Ward
          </Label>
          <Input
            id="ward"
            placeholder="Ward"
            value={formData.ward}
            onChange={(e) => onInputChange('ward', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Panchayat */}
        <div className="space-y-2">
          <Label htmlFor="panchayat" className="text-sm font-medium">
            Panchayat
          </Label>
          <Input
            id="panchayat"
            placeholder="Panchayat"
            value={formData.panchayat}
            onChange={(e) => onInputChange('panchayat', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Relationship Manager — typeable: pick an existing RM, "Direct" for
            walk-ins, or type a brand-new name to auto-add it to the master. */}
        <div className="space-y-2">
          <Label htmlFor="relationshipManager" className="text-sm font-medium">
            Relationship Manager
          </Label>
          <Input
            id="relationshipManager"
            type="text"
            list="patient-reg-rm-datalist"
            value={rmTypedName}
            onChange={(e) => setRmTypedName(e.target.value)}
            onBlur={(e) => resolveRmTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                resolveRmTyped(rmTypedName);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder={
              isLoadingRMs
                ? 'Loading…'
                : rmSaving
                  ? 'Adding new RM…'
                  : 'Type RM name, "Direct", or a new name to auto-add'
            }
            disabled={isLoadingRMs || rmSaving}
          />
          <datalist id="patient-reg-rm-datalist">
            <option value="Direct">No RM</option>
            {relationshipManagers.map((m) => (
              <option key={m.id} value={m.name}>{m.code || 'New'}</option>
            ))}
          </datalist>
          {formData.relationshipManager && formData.relationshipManager !== 'Direct' && (
            <p className="text-xs text-gray-500">
              Stored as code: <span className="font-mono">{formData.relationshipManager}</span>
            </p>
          )}
        </div>

        {/* Pin Code */}
        <div className="space-y-2">
          <Label htmlFor="pinCode" className="text-sm font-medium">
            Pin Code
          </Label>
          <Input
            id="pinCode"
            placeholder="Pin Code"
            value={formData.pinCode}
            onChange={(e) => onInputChange('pinCode', e.target.value)}
            className="w-full"
            pattern="[0-9]{6}"
          />
        </div>

        {/* State */}
        <div className="space-y-2">
          <Label htmlFor="state" className="text-sm font-medium">
            State
          </Label>
          <Input
            id="state"
            placeholder="State"
            value={formData.state}
            onChange={(e) => onInputChange('state', e.target.value)}
            className="w-full"
          />
        </div>

        {/* City/Town */}
        <div className="space-y-2">
          <Label htmlFor="cityTown" className="text-sm font-medium">
            City/Town
          </Label>
          <Input
            id="cityTown"
            placeholder="City/Town"
            value={formData.cityTown}
            onChange={(e) => onInputChange('cityTown', e.target.value)}
            className="w-full"
          />
        </div>

        {/* Blood Group */}
        <div className="space-y-2">
          <Label htmlFor="bloodGroup" className="text-sm font-medium">
            Blood Group
          </Label>
          <Select value={formData.bloodGroup} onValueChange={(value) => onInputChange('bloodGroup', value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Blood Group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A+">A+</SelectItem>
              <SelectItem value="A-">A-</SelectItem>
              <SelectItem value="B+">B+</SelectItem>
              <SelectItem value="B-">B-</SelectItem>
              <SelectItem value="AB+">AB+</SelectItem>
              <SelectItem value="AB-">AB-</SelectItem>
              <SelectItem value="O+">O+</SelectItem>
              <SelectItem value="O-">O-</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Spouse Name */}
        <div className="space-y-2">
          <Label htmlFor="spouseName" className="text-sm font-medium">
            Spouse Name
          </Label>
          <Input
            id="spouseName"
            placeholder="Spouse Name"
            value={formData.spouseName}
            onChange={(e) => onInputChange('spouseName', e.target.value)}
            className="w-full"
          />
        </div>
      </div>

      {/* ESIC Insurance Person No - Only show if Corporate is ESIC */}
      {isEsicCorporate && (
        <div className="mt-4">
          <div className="space-y-2">
            <Label htmlFor="insurancePersonNo" className="text-sm font-medium">
              ESIC Insurance Person No. <span className="text-red-500">*</span>
            </Label>
            <Input
              id="insurancePersonNo"
              placeholder="Insurance Person No."
              value={formData.insurancePersonNo}
              onChange={(e) => onInputChange('insurancePersonNo', e.target.value)}
              className="w-full md:w-1/3"
              required
            />
          </div>
        </div>
      )}
    </div>
  );
};
