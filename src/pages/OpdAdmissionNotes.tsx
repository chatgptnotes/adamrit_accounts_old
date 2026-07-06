import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { ArrowLeft, Save, Printer, Loader2, FileText, EyeOff } from 'lucide-react';
import { useDebounce } from 'use-debounce';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface PatientData {
  id: string;
  visit_id?: string;
  patient_id?: string;
  patients?: {
    id: string;
    name: string;
    gender?: string;
    age?: number;
    date_of_birth?: string;
    patients_id?: string;
    address?: string;
    phone?: string;
    corporate?: string;
  };
  visit_type?: string;
  appointment_with?: string;
  diagnosis?: string;
  reason_for_visit?: string;
  created_at?: string;
}

interface OpdAdmissionNotesData {
  diagnosis: string;
  relevance_complaints: string;
  vital_bp: string;
  rx: string;
  advice: string;
  pathology_rbs: string;
  pathology_xray: string;
  pathology_ct_mri_usg: string;
  stitches_removal: string;
  dressing: string;
  speciality_injectable: string;
  doctor_signature: string;
  review: string;
}

interface DoctorOption {
  id: string;
  name: string;
  specialty?: string | null;
  is_active?: boolean | null;
}

const OpdAdmissionNotes = () => {
  const { visitId } = useParams<{ visitId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hospitalConfig } = useAuth();

  const [patientData, setPatientData] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [isLoadingDoctors, setIsLoadingDoctors] = useState(false);

  // Form state
  const [formData, setFormData] = useState<OpdAdmissionNotesData>({
    diagnosis: '',
    relevance_complaints: '',
    vital_bp: '',
    rx: '',
    advice: '',
    pathology_rbs: '',
    pathology_xray: '',
    pathology_ct_mri_usg: '',
    stitches_removal: '',
    dressing: '',
    speciality_injectable: '',
    doctor_signature: '',
    review: 'N/A',
  });

  // Debounce form data for auto-save
  const [debouncedFormData] = useDebounce(formData, 1500);

  const doctorTableName = hospitalConfig?.id === 'ayushman'
    ? 'ayushman_consultants'
    : 'hope_consultants';

  const fetchDoctors = async (currentDoctorName = formData.doctor_signature) => {
    try {
      setIsLoadingDoctors(true);

      const { data, error } = await supabase
        .from(doctorTableName)
        .select('id, name, specialty, is_active')
        .order('name');

      if (error) {
        console.error('Error fetching doctors:', error);
        setDoctors([]);
        return;
      }

      let doctorRows = (data || []) as DoctorOption[];

      if (doctorTableName === 'ayushman_consultants' && doctorRows.length === 0) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('hope_consultants')
          .select('id, name, specialty, is_active')
          .order('name');

        if (fallbackError) {
          console.error('Error fetching fallback doctors:', fallbackError);
        } else {
          doctorRows = (fallbackData || []) as DoctorOption[];
        }
      }

      const currentName = currentDoctorName?.trim();
      setDoctors(doctorRows.filter((doctor) =>
        doctor.is_active !== false || doctor.name === currentName
      ));
    } finally {
      setIsLoadingDoctors(false);
    }
  };

  // Fetch patient and visit data
  useEffect(() => {
    const fetchData = async () => {
      if (!visitId) {
        toast({
          title: "Error",
          description: "Visit ID is missing",
          variant: "destructive",
        });
        navigate(-1);
        return;
      }

      try {
        // Fetch visit data with patient details
        const { data: visitData, error: visitError } = await supabase
          .from('visits')
          .select(`
            *,
            patients!inner (
              id,
              name,
              gender,
              age,
              date_of_birth,
              patients_id,
              address,
              phone,
              corporate
            )
          `)
          .eq('visit_id', visitId)
          .single();

        if (visitError) {
          console.error('Error fetching visit data:', visitError);
          throw visitError;
        }

        setPatientData(visitData);

        // Load existing OPD admission notes if available
        if (visitData.opd_admission_notes) {
          setFormData(visitData.opd_admission_notes as OpdAdmissionNotesData);
        }
      } catch (error) {
        console.error('Error in fetchData:', error);
        toast({
          title: "Error",
          description: "Failed to load patient data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [visitId, navigate, toast]);

  useEffect(() => {
    fetchDoctors();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorTableName]);

  // Auto-save when debounced data changes
  useEffect(() => {
    const saveData = async () => {
      if (!visitId || !patientData || loading) return;

      // Check if there's actual data to save (not all empty)
      const hasData = Object.values(debouncedFormData).some(val => val.trim() !== '');
      if (!hasData) return;

      setSaving(true);

      try {
        const { error } = await supabase
          .from('visits')
          .update({
            opd_admission_notes: debouncedFormData,
            updated_at: new Date().toISOString()
          })
          .eq('visit_id', visitId);

        if (error) {
          console.error('Error saving OPD admission notes:', error);
          toast({
            title: "Save Failed",
            description: error.message,
            variant: "destructive",
          });
        } else {
          setLastSaved(new Date());
        }
      } catch (error) {
        console.error('Exception while saving:', error);
      } finally {
        setSaving(false);
      }
    };

    saveData();
  }, [debouncedFormData, visitId, patientData, loading, toast]);

  const handleInputChange = (field: keyof OpdAdmissionNotesData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const saveDoctorToMaster = async (doctorName: string) => {
    const cleanedName = doctorName.trim();
    if (!cleanedName) return;

    const { data: existingDoctors, error: findError } = await supabase
      .from(doctorTableName)
      .select('id, name, is_active')
      .ilike('name', cleanedName)
      .limit(1);

    if (findError) {
      toast({
        title: "Doctor Save Failed",
        description: findError.message,
        variant: "destructive",
      });
      return;
    }

    const existingDoctor = existingDoctors?.[0] as DoctorOption | undefined;
    if (existingDoctor) {
      if (existingDoctor.is_active === false) {
        const { error: reactivateError } = await supabase
          .from(doctorTableName)
          .update({ is_active: true })
          .eq('id', existingDoctor.id);

        if (reactivateError) {
          toast({
            title: "Doctor Save Failed",
            description: reactivateError.message,
            variant: "destructive",
          });
          return;
        }
      }
    } else {
      const { error: insertError } = await supabase
        .from(doctorTableName)
        .insert({ name: cleanedName, is_active: true });

      if (insertError) {
        toast({
          title: "Doctor Save Failed",
          description: insertError.message,
          variant: "destructive",
        });
        return;
      }
    }

    handleInputChange('doctor_signature', cleanedName);
    await fetchDoctors(cleanedName);
  };

  const hideSelectedDoctor = async () => {
    const selectedDoctorName = formData.doctor_signature?.trim();
    if (!selectedDoctorName) return;

    const matchedDoctor = doctors.find((doctor) =>
      doctor.name.toLowerCase() === selectedDoctorName.toLowerCase()
    );

    if (!matchedDoctor) {
      handleInputChange('doctor_signature', '');
      return;
    }

    const { error } = await supabase
      .from(doctorTableName)
      .update({ is_active: false })
      .eq('id', matchedDoctor.id);

    if (error) {
      toast({
        title: "Hide Failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    handleInputChange('doctor_signature', '');
    await fetchDoctors('');
    toast({
      title: "Doctor Hidden",
      description: "Doctor will not appear in future dropdowns.",
    });
  };

  const handleManualSave = async () => {
    if (!visitId) return;

    setSaving(true);

    try {
      const { error } = await supabase
        .from('visits')
        .update({
          opd_admission_notes: formData,
          updated_at: new Date().toISOString()
        })
        .eq('visit_id', visitId);

      if (error) {
        toast({
          title: "Save Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setLastSaved(new Date());
        toast({
          title: "Saved",
          description: "OPD admission notes saved successfully",
        });
      }
    } catch (error) {
      console.error('Error saving:', error);
      toast({
        title: "Error",
        description: "Failed to save OPD admission notes",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading patient data...</p>
        </div>
      </div>
    );
  }

  if (!patientData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600">Patient data not found</p>
          <Button onClick={() => navigate(-1)} className="mt-4">
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return 'N/A';
    }
  };

  // Mask the last 4 digits of the phone number for printed copies
  const maskPhone = (phone?: string) => {
    if (!phone) return 'N/A';
    if (phone.length <= 4) return 'XXXX';
    return phone.slice(0, -4) + 'XXXX';
  };

  const consultantName = formData.doctor_signature?.trim() || patientData.appointment_with || 'N/A';

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header with Actions */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-4">
          {lastSaved && (
            <span className="text-sm text-gray-500">
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {saving && (
            <div className="flex items-center gap-2 text-blue-600 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving...
            </div>
          )}
          <Button
            onClick={handleManualSave}
            disabled={saving}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            Save Now
          </Button>
          <Button
            onClick={handlePrint}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Main Form */}
      <Card className="shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-blue-100 print:bg-white">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-blue-600" />
            <div>
              <CardTitle className="text-2xl font-bold text-blue-900">
                OPD NOTES
              </CardTitle>
              <p className="text-sm text-gray-600 mt-1">
                Visit ID: {patientData.visit_id} | Date: {formatDate(patientData.created_at)}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          {/* Patient Information Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg print:border print:border-gray-300">
            <div>
              <Label className="text-xs font-semibold text-gray-600">Name</Label>
              <p className="text-sm font-medium mt-1">{patientData.patients?.name || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Age/Sex</Label>
              <p className="text-sm font-medium mt-1">
                {patientData.patients?.age || 'N/A'} / {patientData.patients?.gender || 'N/A'}
              </p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Mobile No</Label>
              <p className="text-sm font-medium mt-1">
                <span className="print:hidden">{patientData.patients?.phone || 'N/A'}</span>
                <span className="hidden print:inline">{maskPhone(patientData.patients?.phone)}</span>
              </p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Reg. No</Label>
              <p className="text-sm font-medium mt-1">{patientData.patients?.patients_id || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Visit ID</Label>
              <p className="text-sm font-medium mt-1">{patientData.visit_id || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Date</Label>
              <p className="text-sm font-medium mt-1">{formatDate(patientData.created_at)}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Treatment Type</Label>
              <p className="text-sm font-medium mt-1">{patientData.treatment_type || 'N/A'}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Address</Label>
              <p className="text-sm font-medium mt-1">{patientData.patients?.address || 'nagpur'}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Name of Consultant</Label>
              <p className="text-sm font-medium mt-1">{consultantName}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold text-gray-600">Corporate</Label>
              <p className="text-sm font-medium mt-1">{patientData.patients?.corporate || 'private'}</p>
            </div>
          </div>

          {/* Diagnosis */}
          <div className="space-y-2">
            <Label className="text-lg font-semibold text-gray-800">Diagnosis</Label>
            <Textarea
              value={formData.diagnosis}
              onChange={(e) => handleInputChange('diagnosis', e.target.value)}
              placeholder="Enter detailed diagnosis notes, symptoms, examination findings..."
              className="min-h-[100px] resize-vertical print:border-gray-400"
            />
          </div>

          {/* Relevance Complaints */}
          <div className="space-y-2">
            <Label className="text-lg font-semibold text-gray-800">Relevance Complaints</Label>
            <Textarea
              value={formData.relevance_complaints}
              onChange={(e) => handleInputChange('relevance_complaints', e.target.value)}
              placeholder="Enter relevance complaints..."
              className="min-h-[80px] resize-vertical print:border-gray-400"
            />
          </div>

          {/* Two Column Layout for Vital and RX */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print-two-column">
            {/* Left Column: Vital, Advice, Pathology */}
            <div className="space-y-6">
              {/* Vital */}
              <div className="space-y-2">
                <Label className="text-lg font-semibold text-gray-800">Vital</Label>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">B.P.</Label>
                  <Input
                    value={formData.vital_bp}
                    onChange={(e) => handleInputChange('vital_bp', e.target.value)}
                    placeholder="e.g., 120/80 mmHg"
                    className="print:border-gray-400"
                  />
                </div>
              </div>

              {/* Advice */}
              <div className="space-y-2">
                <Label className="text-lg font-semibold text-gray-800">Advice</Label>
                <Textarea
                  value={formData.advice}
                  onChange={(e) => handleInputChange('advice', e.target.value)}
                  placeholder="Enter medical advice..."
                  className="min-h-[100px] resize-vertical print:border-gray-400"
                />
              </div>

              {/* Pathology */}
              <div className="space-y-3">
                <Label className="text-lg font-semibold text-gray-800">Pathology</Label>
                <div className="space-y-3 pl-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">1. RBS</Label>
                    <Input
                      value={formData.pathology_rbs}
                      onChange={(e) => handleInputChange('pathology_rbs', e.target.value)}
                      placeholder="Random Blood Sugar value"
                      className="mt-1 print:border-gray-400"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">2. X-Ray</Label>
                    <Input
                      value={formData.pathology_xray}
                      onChange={(e) => handleInputChange('pathology_xray', e.target.value)}
                      placeholder="X-Ray details"
                      className="mt-1 print:border-gray-400"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">3. CT/MRI/USG</Label>
                    <Input
                      value={formData.pathology_ct_mri_usg}
                      onChange={(e) => handleInputChange('pathology_ct_mri_usg', e.target.value)}
                      placeholder="CT/MRI/USG details"
                      className="mt-1 print:border-gray-400"
                    />
                  </div>
                </div>
              </div>

              {/* Stitches Removal */}
              <div className="space-y-2">
                <Label className="text-lg font-semibold text-gray-800">Stitches Removal</Label>
                <Input
                  value={formData.stitches_removal}
                  onChange={(e) => handleInputChange('stitches_removal', e.target.value)}
                  placeholder="Stitches removal details"
                  className="print:border-gray-400"
                />
              </div>

              {/* Dressing */}
              <div className="space-y-2">
                <Label className="text-lg font-semibold text-gray-800">Dressing</Label>
                <Input
                  value={formData.dressing}
                  onChange={(e) => handleInputChange('dressing', e.target.value)}
                  placeholder="Dressing details"
                  className="print:border-gray-400"
                />
              </div>

              {/* Speciality Injectable */}
              <div className="space-y-2">
                <Label className="text-lg font-semibold text-gray-800">Speciality Injectable</Label>
                <Input
                  value={formData.speciality_injectable}
                  onChange={(e) => handleInputChange('speciality_injectable', e.target.value)}
                  placeholder="Speciality injectable details"
                  className="print:border-gray-400"
                />
              </div>
            </div>

            {/* Right Column: RX */}
            <div className="space-y-2">
              <Label className="text-lg font-semibold text-gray-800">RX</Label>
              <Textarea
                value={formData.rx}
                onChange={(e) => handleInputChange('rx', e.target.value)}
                placeholder="Enter prescription details..."
                className="min-h-[500px] resize-vertical print:border-gray-400"
              />
            </div>
          </div>

          {/* Footer Information */}
          <div className="border-t-2 border-gray-300 pt-2 mt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="space-y-1">
                <div>
                  <Label className="text-xs font-semibold text-gray-600">Signature:</Label>
                  <div className="border-b-2 border-gray-400 h-6 mt-1 print:h-4"></div>
                </div>
              </div>
              <div className="space-y-1">
                <div>
                  <Label className="text-xs font-semibold text-gray-600">Name of Doctor:</Label>
                  <div className="flex gap-2 print:block">
                    <div className="flex-1 print:hidden">
                      <SearchableSelect
                        options={[
                          ...doctors.map((doctor) => ({
                            value: doctor.name,
                            label: `${doctor.name}${doctor.specialty ? ` (${doctor.specialty})` : ''}`,
                          })),
                          ...(formData.doctor_signature &&
                             !doctors.some((doctor) => doctor.name === formData.doctor_signature)
                            ? [{ value: formData.doctor_signature, label: `${formData.doctor_signature} (Current)` }]
                            : []),
                        ]}
                        value={formData.doctor_signature || ''}
                        onValueChange={(value) => handleInputChange('doctor_signature', value)}
                        onCreateOption={saveDoctorToMaster}
                        placeholder={isLoadingDoctors ? "Loading doctors..." : "Enter doctor name..."}
                        searchPlaceholder="Search or add doctor..."
                        emptyText="No doctor found."
                        createOptionLabel={(input) => `Add "${input}"`}
                      />
                    </div>
                    <span className="hidden print:inline">
                      {formData.doctor_signature || 'N/A'}
                    </span>
                    {formData.doctor_signature && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={hideSelectedDoctor}
                        title="Hide doctor from future dropdowns"
                        className="print:hidden"
                      >
                        <EyeOff className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600">Review:</p>
                  <Input
                    value={formData.review}
                    onChange={(e) => handleInputChange('review', e.target.value)}
                    className="print:border-none print:bg-transparent"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div>
                  <p className="text-xs font-semibold text-gray-600">Date And Time:</p>
                  <p className="text-sm font-medium">
                    {formatDate(new Date().toISOString())} {new Date().toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600">Date:</p>
                  <p className="text-sm font-medium">{formatDate(new Date().toISOString())}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600">Time:</p>
                  <p className="text-sm font-medium">
                    {new Date().toLocaleTimeString('en-IN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Print Styles */}
      <style>
        {`
          @media print {
            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
              font-size: 9pt;
            }

            @page {
              size: A4;
              margin: 0;
            }

            /* Hide screen elements */
            button, .print\\:hidden {
              display: none !important;
            }

            /* Page container */
            .container {
              max-width: 100%;
              padding: 2.8cm 0 0.4cm 0 !important;
            }

            /* Card styling */
            .shadow-lg {
              box-shadow: none !important;
              border: 2px solid #000 !important;
              border-radius: 0 !important;
              margin-top: 2.8cm !important;
            }

            /* Header */
            .bg-gradient-to-r {
              background: white !important;
              border-bottom: 2px solid #000;
              padding: 2px !important;
            }

            /* Hide icon in print */
            .bg-gradient-to-r svg {
              display: none !important;
            }

            /* Patient info box */
            .bg-gray-50 {
              background: white !important;
              border: 2px solid #000 !important;
              padding: 2px !important;
              margin-bottom: 2px;
              display: grid !important;
              grid-template-columns: 1fr 1fr !important;
              gap: 1px 8px !important;
            }

            /* Patient info items */
            .bg-gray-50 > div {
              display: block !important;
            }

            .bg-gray-50 > div label {
              font-size: 7pt !important;
              font-weight: 600 !important;
              color: #333 !important;
              display: block !important;
              margin-bottom: 0px !important;
            }

            .bg-gray-50 > div p {
              font-size: 8pt !important;
              color: #000 !important;
              margin: 0 !important;
            }

            /* Section labels */
            label {
              font-weight: 600 !important;
              color: #000 !important;
              font-size: 8pt !important;
            }

            /* Textareas for print - Compact but readable */
            textarea {
              border: 1px solid #000 !important;
              min-height: 22px !important;
              max-height: 26px !important;
              background: white !important;
              padding: 1px 3px !important;
              font-size: 8pt !important;
              line-height: 1.2 !important;
              overflow: hidden !important;
            }

            /* Input fields */
            input {
              border: 1px solid #000 !important;
              padding: 1px 2px !important;
              background: white !important;
              font-size: 8pt !important;
            }

            /* Footer section - Clear separator */
            .border-t-2 {
              border-top: 2px solid #000 !important;
              margin-top: 4px !important;
              padding-top: 3px !important;
            }

            /* Signature line - Minimal but visible */
            .border-b-2 {
              border-bottom: 1px solid #000 !important;
              height: 6px !important;
            }

            /* Footer h-6 override */
            .h-6 {
              height: 6px !important;
            }

            /* Text sizing for print */
            .text-sm {
              font-size: 7pt !important;
            }

            .text-xs {
              font-size: 6pt !important;
            }

            /* Footer specific labels */
            .border-t-2 .text-xs {
              font-size: 6pt !important;
            }

            /* Footer specific text */
            .border-t-2 .text-sm {
              font-size: 7pt !important;
            }

            /* Card content padding */
            .p-6 {
              padding: 2px !important;
            }

            /* Two Column Layout - Critical for print */
            .print-two-column {
              display: grid !important;
              grid-template-columns: 45% 1px 54% !important;
              gap: 4px !important;
              position: relative;
              margin-top: 2px !important;
              margin-bottom: 2px !important;
            }

            /* Left column styling */
            .print-two-column > div:first-child {
              padding-right: 6px !important;
            }

            /* Add vertical separator between columns - Bold visible line */
            .print-two-column::after {
              content: '' !important;
              position: absolute !important;
              left: calc(45% + 3px) !important;
              top: 0 !important;
              bottom: 0 !important;
              width: 2px !important;
              background: #000 !important;
              border-left: 2px solid #000 !important;
              z-index: 10 !important;
            }

            /* Right column styling */
            .print-two-column > div:last-child {
              padding-left: 6px !important;
            }

            /* Ensure RX textarea matches left column height */
            .print-two-column textarea {
              min-height: 120px !important;
              max-height: 150px !important;
              height: auto !important;
              line-height: 1.2 !important;
            }

            /* Footer section - 3 columns with clear separation */
            .grid-cols-3 {
              display: grid !important;
              grid-template-columns: 1fr 1fr 1fr !important;
              gap: 8px !important;
            }

            /* Footer input in print */
            .print\\:border-none {
              border: none !important;
            }

            .print\\:bg-transparent {
              background: transparent !important;
            }

            /* Remove default margins and spacing - Optimized */
            .space-y-6 > * + * {
              margin-top: 2px !important;
            }

            .space-y-2 > * + * {
              margin-top: 1px !important;
            }

            .space-y-3 > * + * {
              margin-top: 1px !important;
            }

            .space-y-1 > * + * {
              margin-top: 0px !important;
            }

            /* Overall content spacing */
            .space-y-6 {
              gap: 2px !important;
            }

            /* Header title compact */
            .bg-gradient-to-r {
              padding: 2px !important;
            }

            /* Card title text size */
            .text-2xl {
              font-size: 14pt !important;
              font-weight: bold !important;
            }

            /* Header subtitle */
            .text-sm.text-gray-600 {
              font-size: 8pt !important;
            }

            /* Pathology section compact */
            .pl-4 {
              padding-left: 8px !important;
            }

            /* Overall layout improvements */
            .rounded-lg {
              border-radius: 0 !important;
            }

            /* Ensure proper page breaks */
            .print-two-column {
              page-break-inside: avoid !important;
            }
          }
        `}
      </style>
    </div>
  );
};

export default OpdAdmissionNotes;
